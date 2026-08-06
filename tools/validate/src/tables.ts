#!/usr/bin/env node
// `npm run validate:tables` — de onde vem cada coluna que o modelo declara, e
// o `rowCount` do golden é comparável com o Power BI?
//
// É o quarto nível de verificação, e responde a pergunta que faltava:
//
//   npm test          o código respeita as specs
//   validate:model    o DAX aponta para tabela/coluna que existe **no modelo**
//   validate:queries  as queries rodam no ERP e devolvem o quê
//   validate:tables   as colunas do modelo existem no que a fonte devolve  ← aqui
//
// A diferença entre o segundo e o quarto é a razão de existir. `validate:model`
// confere modelo contra modelo: 'PROTOCOLOS GERAL'[HORA CRIADO] é declarada na
// spec da tabela, então passa. Mas `HORA CRIADO` **não sai do SELECT** — nasce
// num passo M (`DateTime.Time([DATA CRIADO])`). Contra dado real, uma coluna
// assim chega vazia, e vazio não dá erro: dá zero, BLANK, ou um filtro que não
// casa nada. Sem banco nenhum é possível saber disso antes.
//
// Não precisa de credencial: lê as specs e os goldens já commitados.
//
// Sai com código 1 quando uma coluna **citada pelo DAX** não é explicada nem
// pelo golden nem por um passo M. Aí ninguém pode entregá-la.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { extractRefs } from '../../../packages/semantic-model/src/refs.ts';
import type { ModelTable } from '../../../packages/semantic-model/src/types.ts';
import {
  MScanError,
  normalizeColumn,
  originOf,
  rowCountComparable,
  scanM,
  type MScan,
} from './mlayer.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export type Procedencia =
  | 'sql'
  | 'm'
  | 'dax'
  | 'nao-conferivel'
  | 'sem-explicacao';

// Havia aqui um `ehDuplicataDeAlias`, para explicar `CONTRATOS[CIDADE2]` quando o
// golden só tinha `CIDADE`. **Removido em 06/08/2026, porque a causa foi corrigida
// na raiz:** o SELECT de `contratos` pede `ac.city "CIDADE"` duas vezes e o golden
// perdia a segunda — não por causa do M, mas porque o `postgresRunner` pedia o
// resultado no modo objeto, que colapsa colunas de mesmo nome antes de a linha
// existir (ACHADOS #19). Com `rowMode: 'array'` a duplicata é preservada com o mesmo
// sufixo que o ODBC usa, e `CIDADE2` agora casa direto como `sql`.
//
// A heurística não fica "por segurança": ela classificava como explicada uma coluna
// ausente do golden, então um golden velho passaria a leitura em silêncio em vez de
// pedir `npm run validate:queries`. Sem ela, esse caso cai em `sem-explicacao`, que
// é o alarme certo.

export interface ColunaVerificada {
  readonly table: string;
  readonly column: string;
  /** Nome procurado na fonte (`source_column`, ou o próprio nome). */
  readonly source: string;
  readonly procedencia: Procedencia;
  /** Passo M que a criou, quando `procedencia === 'm'`. */
  readonly step: string | null;
  /** A coluna é citada por alguma das 134 expressões DAX? */
  readonly noDax: boolean;
}

export interface TabelaVerificada {
  readonly table: string;
  readonly queryRef: string | null;
  readonly calculada: boolean;
  readonly temGolden: boolean;
  readonly scanErro: string | null;
  readonly rowCountComparavel: boolean | null;
  readonly efeitosDeLinha: readonly string[];
  readonly colunas: readonly ColunaVerificada[];
}

interface Golden {
  queryId: string;
  rowCount: number;
  columns: { name: string }[];
}

function lerGoldens(dir: string): Map<string, Golden> {
  const out = new Map<string, Golden>();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.golden.json'))) {
    const g = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Golden;
    out.set(g.queryId, g);
  }
  return out;
}

/** Colunas citadas por qualquer DAX do modelo (medida, coluna ou tabela calculada). */
export function colunasCitadasNoDax(model: SemanticModel): Set<string> {
  const out = new Set<string>();
  const expressoes: { dax: string; tabela: string }[] = [
    ...model.measures.map((m) => ({ dax: m.dax, tabela: m.table })),
    ...model.calculatedColumns.map(({ table, column }) => ({ dax: column.dax!, tabela: table.name })),
    ...model.calculatedTables.map((t) => ({ dax: t.tableDax!, tabela: t.name })),
  ];
  for (const { dax, tabela } of expressoes) {
    for (const r of extractRefs(dax)) {
      if (r.kind === 'column') {
        out.add(`${normalizeColumn(r.table)}|${normalizeColumn(r.column)}`);
      } else if (r.kind === 'bare') {
        // `[Coluna]` sem qualificar resolve na tabela dona da expressão.
        out.add(`${normalizeColumn(tabela)}|${normalizeColumn(r.name)}`);
      }
    }
  }
  return out;
}

export function verificarTabela(
  t: ModelTable,
  opts: {
    scan: MScan | null;
    scanErro: string | null;
    golden: Golden | null;
    citadas: Set<string>;
  },
): TabelaVerificada {
  const { scan, scanErro, golden, citadas } = opts;
  const reais = new Set((golden?.columns ?? []).map((c) => normalizeColumn(c.name)));

  const colunas: ColunaVerificada[] = [];
  for (const c of t.columns) {
    if (c.calculated) continue; // DAX, não vem da fonte
    const source = c.sourceColumn ?? c.name;
    const noDax = citadas.has(`${normalizeColumn(t.name)}|${normalizeColumn(c.name)}`);

    let procedencia: Procedencia;
    let step: string | null = null;
    const daM = scan ? originOf(scan, source) : null;

    if (t.tableDax) {
      // Tabela calculada: a coluna não vem de fonte nenhuma — ela é uma coluna do
      // resultado do DAX da tabela, casada por `sourceColumn`. Quem confere isso é
      // a materialização (fase 2b.7), que exige **bijeção** entre as colunas
      // declaradas e as que o DAX devolve. Antes desta fase as 10 caíam em
      // `nao-conferivel`, junto com as de gsheets/web — e isso lia como "não se
      // sabe", quando na verdade se sabe e há teste.
      procedencia = 'dax';
    } else if (golden && reais.has(normalizeColumn(source))) {
      procedencia = 'sql';
    } else if (daM) {
      procedencia = 'm';
      step = daM.step;
    } else if (!golden || scanErro) {
      // Sem golden (gsheets/web/inline) ou com M ilegível, não há como afirmar
      // nem negar. Declarar como "sem explicação" seria alarme falso.
      procedencia = 'nao-conferivel';
    } else {
      procedencia = 'sem-explicacao';
    }
    colunas.push({ table: t.name, column: c.name, source, procedencia, step, noDax });
  }

  return {
    table: t.name,
    queryRef: t.queryRef,
    calculada: Boolean(t.tableDax),
    temGolden: Boolean(golden),
    scanErro,
    rowCountComparavel: scan ? rowCountComparable(scan) : null,
    efeitosDeLinha: scan
      ? scan.rowEffects.map((r) => `${r.func} (${r.direction}) em '${r.step}': ${r.reason}`)
      : [],
    colunas,
  };
}

export function verificarModelo(specsDir: string, goldenDir: string): TabelaVerificada[] {
  const model = SemanticModel.fromSpecsDir(specsDir);
  const registry = QueryRegistry.fromSpecsDir(specsDir);
  const goldens = lerGoldens(goldenDir);
  const citadas = colunasCitadasNoDax(model);

  const out: TabelaVerificada[] = [];
  for (const t of [...model.tables.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    let scan: MScan | null = null;
    let scanErro: string | null = null;
    if (t.queryRef && registry.has(t.queryRef)) {
      const m = registry.get(t.queryRef).m_expression;
      if (m) {
        try {
          scan = scanM(m);
        } catch (e) {
          if (!(e instanceof MScanError)) throw e;
          scanErro = e.message;
        }
      }
    }
    out.push(
      verificarTabela(t, {
        scan,
        scanErro,
        golden: (t.queryRef && goldens.get(t.queryRef)) || null,
        citadas,
      }),
    );
  }
  return out;
}

// ── relatório ────────────────────────────────────────────────────────────────

function main(): void {
  const tabelas = verificarModelo(path.join(ROOT, 'specs'), path.join(ROOT, 'specs', 'golden'));

  console.log('Analytics Platform — procedência das colunas do modelo\n');

  const conta = (p: Procedencia) =>
    tabelas.reduce((a, t) => a + t.colunas.filter((c) => c.procedencia === p).length, 0);
  const total = tabelas.reduce((a, t) => a + t.colunas.length, 0);

  console.log('── Resumo ────────────────────────────────────────────────────');
  console.log(`  ${total} colunas físicas em ${tabelas.length} tabelas`);
  console.log(`  ${conta('sql')} vêm do SELECT (confirmadas contra o golden)`);
  console.log(`  ${conta('m')} nascem num passo M (Power Query)`);
  console.log(`  ${conta('dax')} vêm do DAX da própria tabela (calculada, materializada)`);
  console.log(`  ${conta('nao-conferivel')} sem golden para conferir`);
  console.log(`  ${conta('sem-explicacao')} sem explicação`);

  const calculadas = tabelas.filter((t) => t.calculada);
  console.log(`\n  ${calculadas.length} tabelas são DAX puro (linhas vêm de expressão):`);
  for (const t of calculadas) {
    const cols = t.colunas.map((c) => `${c.column} ← ${c.source}`).join(', ');
    console.log(`      ${t.table}: ${cols}`);
  }

  console.log('\n── Colunas que nascem em M (o dado real não as traz) ──────────');
  for (const t of tabelas) {
    const emM = t.colunas.filter((c) => c.procedencia === 'm');
    if (emM.length === 0) continue;
    const comDax = emM.filter((c) => c.noDax);
    console.log(`  ${t.table} — ${emM.length} coluna(s), ${comDax.length} usada(s) no DAX`);
    for (const c of emM.filter((x) => x.noDax)) {
      console.log(`      [DAX] ${c.column}  ←  passo '${c.step}'`);
    }
  }

  console.log('\n── rowCount do golden é comparável com o Power BI? ────────────');
  const incomparaveis = tabelas.filter((t) => t.rowCountComparavel === false);
  const comparaveis = tabelas.filter((t) => t.rowCountComparavel === true);
  console.log(`  ${comparaveis.length} sim, ${incomparaveis.length} NÃO.`);
  console.log('  Onde é "não", o M mexe na contagem depois do SQL:');
  for (const t of incomparaveis) {
    console.log(`      ${t.table} (${t.queryRef})`);
    for (const e of t.efeitosDeLinha) console.log(`          ${e}`);
  }

  const ilegiveis = tabelas.filter((t) => t.scanErro);
  if (ilegiveis.length) {
    console.log('\n── M que o scanner não lê estaticamente ──────────────────────');
    for (const t of ilegiveis) console.log(`  ${t.table}: ${t.scanErro}`);
  }

  const semExplicacao = tabelas.flatMap((t) => t.colunas.filter((c) => c.procedencia === 'sem-explicacao'));
  const bloqueantes = semExplicacao.filter((c) => c.noDax);
  console.log('\n─────────────────────────────────────────────────────────────');
  if (semExplicacao.length === 0) {
    console.log('Toda coluna física é explicada pelo SQL ou por um passo M.');
  } else {
    console.log(`${semExplicacao.length} coluna(s) sem explicação, ${bloqueantes.length} citada(s) no DAX:`);
    for (const c of semExplicacao) {
      console.log(`  ${c.noDax ? '[DAX]' : '[   ]'} ${c.table}[${c.column}] → procurada como '${c.source}'`);
    }
  }
  if (bloqueantes.length > 0) {
    console.log('\nColuna citada pelo DAX e que ninguém entrega = medida errada contra dado real.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
