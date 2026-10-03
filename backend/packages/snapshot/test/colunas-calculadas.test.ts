// Materializar coluna calculada no snapshot (ACHADOS #47).
//
// O teste que importa não é o de que a coluna é gravada — é o do **guarda**. Uma
// coluna calculada em disco é um valor congelado que o avaliador usa sem
// desconfiar; sem a conferência de `sha256`, mudar o DAX no Power BI deixaria o
// relatório servindo o número velho sem nenhum sinal.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { carrega } from '../src/carrega.ts';
import {
  esqueceCalculadas,
  materializaColunas,
  materializaColunasPorGrao,
  materializaveis,
} from '../src/colunas-calculadas.ts';
import { escreve, le, shaDeDax, type Escalar } from '../src/formato.ts';
import { SemanticModel, type ModelColumn } from '../../semantic-model/src/model.ts';
import type { DashboardSpec } from '../../widget-engine/src/spec.ts';

const AGORA = new Date(Date.UTC(2026, 7, 8, 12, 0, 0));

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

/** Modelo com uma tabela de query, uma coluna calculada própria e uma que cita outra. */
function monta(daxDobro = "'T'[valor] * 2") {
  const model = new SemanticModel();
  model.addTable({
    id: 't', name: 'T', queryRef: 'q-t',
    columns: [
      col('valor'),
      col('DOBRO', { calculated: true, dax: daxDobro }),
      col('DE_FORA', { calculated: true, dax: "CALCULATE(MAX('OUTRA'[x]))" }),
    ],
  });
  model.addTable({ id: 'outra', name: 'OUTRA', queryRef: 'q-outra', columns: [col('x')] });
  return model;
}

/** A semente do plano sai de `entities_used`/`entity` — ver `plano.ts`. */
const DASH: DashboardSpec[] = [
  {
    id: 'p',
    name: 'P',
    visuals: [
      {
        id: 'v',
        type: 'card',
        position: {},
        entities_used: ['T'],
        fields: [{ kind: 'column', entity: 'T', property: 'DOBRO' }],
      },
    ],
  } as never,
];

test('só materializa coluna que depende da própria tabela', () => {
  const model = monta();
  const nomes = materializaveis(model.table('T')!, model).map((c) => c.nome);
  assert.deepEqual(nomes, ['DOBRO'], 'DE_FORA cita OUTRA e não pode ser materializada aqui');
});

test('materializaColunas escreve o valor nas linhas e devolve o sha do DAX', () => {
  const model = monta();
  const linhas = [{ valor: 3 }, { valor: 5 }];
  const m = materializaColunas(model.table('T')!, model, linhas, AGORA);
  assert.deepEqual(m.colunas, ['DOBRO']);
  assert.equal(linhas[0]!.DOBRO, 6);
  assert.equal(linhas[1]!.DOBRO, 10);
  assert.equal(m.daxSha.get('DOBRO'), shaDeDax("'T'[valor] * 2"));
});

test('somenteColunas restringe o alvo, e --coluna-nome que não existe dá zero colunas', () => {
  const model = monta();
  const linhas = [{ valor: 3 }, { valor: 5 }];
  const m = materializaColunas(model.table('T')!, model, linhas, AGORA, new Set(['dobro']));
  assert.deepEqual(m.colunas, ['DOBRO']);
  assert.equal(linhas[0]!.DOBRO, 6);

  const nada = materializaColunas(model.table('T')!, model, [{ valor: 1 }], AGORA, new Set(['nao-existe']));
  assert.deepEqual(nada.colunas, []);
});

test('coluna isolada que cita uma irmã calculada resolve a irmã sozinha (ACHADOS #82)', () => {
  // O caso real é RankAtualProtocolo lendo RankDataProtocolo em FIELD AGENDA: pedir só
  // a dependente, num processo que nunca calculou a outra, tem de bastar — é o que
  // torna seguro isolar cada coluna calculada num filho próprio.
  const model = new SemanticModel();
  model.addTable({
    id: 't', name: 'T', queryRef: 'q-t',
    columns: [
      col('valor'),
      col('DOBRO', { calculated: true, dax: "'T'[valor] * 2" }),
      col('DOBRO_MAIS_UM', { calculated: true, dax: "'T'[DOBRO] + 1" }),
    ],
  });
  const linhas = [{ valor: 3 }];
  const m = materializaColunas(model.table('T')!, model, linhas, AGORA, new Set(['dobro_mais_um']));
  assert.deepEqual(m.colunas, ['DOBRO_MAIS_UM'], 'só a pedida entra no retorno');
  assert.equal(linhas[0]!.DOBRO_MAIS_UM, 7, 'mas o valor está certo: a irmã foi resolvida por dentro');
});

// ─────────────────────────── grão reduzido (ACHADOS #86)

test('materializaColunasPorGrao: calcula uma vez por grupo e copia para as duplicatas', () => {
  const model = new SemanticModel();
  model.addTable({
    id: 't', name: 'T', queryRef: 'q-t',
    columns: [
      col('protocolo'), col('slot'), col('relato'),
      col('DOBRO', { calculated: true, dax: "'T'[protocolo] * 2" }),
    ],
  });
  // Duas "linhas de slot" (protocolo 10 e 20), cada uma multiplicada 3x por relato —
  // exatamente a forma de field-agenda antes/depois dos joins de relato/skill.
  const linhas: Record<string, unknown>[] = [];
  for (const p of [10, 20]) for (const relato of ['r1', 'r2', 'r3']) linhas.push({ protocolo: p, slot: 1, relato });

  const m = materializaColunasPorGrao(model.table('T')!, model, linhas as never, AGORA, ['protocolo', 'slot'], new Set(['dobro']));
  assert.deepEqual(m.colunas, ['DOBRO']);
  // Só a chave NORMALIZADA fica nas linhas aqui — de propósito (ver o comentário da
  // função): a de exibição é reposta depois, por quem revisita a tabela inteira, pra
  // não deixar `rows` com chave não normalizada bem no meio de duas adoções.
  const dobro = (l: Record<string, unknown>) => l.dobro as number;
  assert.ok(linhas.filter((l) => l.protocolo === 10).every((l) => dobro(l) === 20));
  assert.ok(linhas.filter((l) => l.protocolo === 20).every((l) => dobro(l) === 40));
  assert.equal(linhas[0]!.DOBRO, undefined, 'a de exibição NÃO fica — quebraria o adotaTabela seguinte');
});

test('materializaColunasPorGrao dá o MESMO resultado que materializaColunas no conjunto inteiro, com FILTER/RANKX (o caso real)', () => {
  // Mesma forma de RankDataProtocolo/RankAtualProtocolo de FIELD AGENDA: um FILTER
  // que a `Dataset` ADOTADA enxerga por inteiro. Isolar por grão só é seguro se o
  // resultado bater com calcular sobre a tabela cheia, duplicada — é isto que este
  // teste prova, não só o argumento de que "deveria bater".
  const model = new SemanticModel();
  model.addTable({
    id: 't', name: 'T', queryRef: 'q-t',
    columns: [
      col('protocolo'), col('slot'), col('relato'),
      col('RANK', {
        calculated: true,
        // O alias do SELECTCOLUMNS repete o nome de uma coluna que a tabela BASE já
        // tem ("slot") de propósito: é exatamente o padrão do RankDataProtocolo real
        // (alias "Data", que também é o nome de uma calculada de FIELD AGENDA) — com
        // `valor` omitido, RANKX reavalia `expr` no escopo de FORA da tabela derivada
        // para ranquear "o valor desta própria linha", e isso só resolve se existir
        // uma coluna com esse nome na tabela de origem.
        dax: `
          VAR P = 'T'[protocolo]
          VAR Slots = DISTINCT(SELECTCOLUMNS(FILTER('T', 'T'[protocolo] = P), "slot", 'T'[slot]))
          RETURN RANKX(Slots, [slot], , ASC, DENSE)
        `,
      }),
      col('RANK_MAX', { calculated: true, dax: "CALCULATE(MAX('T'[RANK]), FILTER('T', 'T'[protocolo] = 'T'[protocolo]))" }),
    ],
  });
  const base: Record<string, unknown>[] = [];
  for (const p of [1, 2]) {
    for (const slot of [5, 3, 5, 3, 7]) {
      for (const relato of ['a', 'b']) base.push({ protocolo: p, slot, relato });
    }
  }
  const viaGrao = base.map((r) => ({ ...r }));
  const viaCheio = base.map((r) => ({ ...r }));

  const mGrao = materializaColunasPorGrao(model.table('T')!, model, viaGrao as never, AGORA, ['protocolo', 'slot'], new Set(['rank', 'rank_max']));
  const mCheio = materializaColunas(model.table('T')!, model, viaCheio as never, AGORA, new Set(['rank', 'rank_max']));

  assert.deepEqual(mGrao.colunas.sort(), mCheio.colunas.sort());
  // Comparando pela chave NORMALIZADA nos dois lados: `viaGrao` só tem essa (a de
  // exibição é reposta depois, pela passada seguinte que este teste não chama);
  // `viaCheio` tem as duas, mas a normalizada é a que os dois têm em comum.
  assert.deepEqual(
    viaGrao.map((r) => (r as never as { rank: number }).rank),
    viaCheio.map((r) => (r as never as { rank: number }).rank),
  );
  assert.deepEqual(
    viaGrao.map((r) => (r as never as { rank_max: number }).rank_max),
    viaCheio.map((r) => (r as never as { rank_max: number }).rank_max),
  );
});

test('depois de materializaColunasPorGrao, uma segunda passada na tabela INTEIRA não quebra (adotaTabela exige chave normalizada)', () => {
  // Reproduz o defeito real, achado ao vivo contra field-agenda: `Data`/
  // `RankAtualProtocolo`/etc. (grão reduzido) e `ClassificacaoRelato`/
  // `CategoriaProdutividade` (grão fino) são calculadas em DUAS chamadas
  // separadas — a segunda (aqui, `materializaColunas` sem filtro, como
  // `materializaColunasDaTabela` faz) chama `dataset.adotaTabela` de novo, e ele
  // erra alto se QUALQUER linha tiver sobrado com chave de exibição.
  const model = new SemanticModel();
  model.addTable({
    id: 't', name: 'T', queryRef: 'q-t',
    columns: [
      col('protocolo'), col('slot'), col('relato'),
      col('DOBRO', { calculated: true, dax: "'T'[protocolo] * 2" }),
      col('RELATO_MAIUSCULO', { calculated: true, dax: "'T'[relato] & \"!\"" }),
    ],
  });
  const linhas: Record<string, unknown>[] = [];
  for (const p of [10, 20]) for (const relato of ['r1', 'r2', 'r3']) linhas.push({ protocolo: p, slot: 1, relato });

  materializaColunasPorGrao(model.table('T')!, model, linhas as never, AGORA, ['protocolo', 'slot'], new Set(['dobro']));
  // Não pode lançar: se sobrou chave 'DOBRO' (exibição) em qualquer linha, quebra aqui.
  const m2 = materializaColunas(model.table('T')!, model, linhas as never, AGORA);
  assert.deepEqual(m2.colunas.sort(), ['DOBRO', 'RELATO_MAIUSCULO']);
  assert.equal(linhas[0]!.DOBRO, 20, 'a de exibição é reposta por esta segunda passada');
  assert.equal(linhas[0]!.RELATO_MAIUSCULO, 'r1!');
});

test('o sha ignora reindentação, mas não mudança de conta', () => {
  // Reindentar no Power BI não muda o que a coluna calcula; invalidar 950 MB de
  // snapshot por um espaço seria um alarme que ensina a ignorar alarmes.
  assert.equal(shaDeDax("'T'[valor] * 2"), shaDeDax("  'T'[valor]   *  2\n"));
  assert.notEqual(shaDeDax("'T'[valor] * 2"), shaDeDax("'T'[valor] * 3"));
});

// ───────────────────────────────────────────────── o guarda

/** Grava um snapshot de uma tabela e devolve o diretório temporário. */
async function gravaSnapshot(model: SemanticModel, daxSha: Map<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
  const linhas: Record<string, never>[] = [{ valor: 3 }, { valor: 5 }] as never;
  materializaColunas(model.table('T')!, model, linhas as never, AGORA);
  await escreve(
    path.join(dir, 'q-t.jsonl'),
    { query: 'q-t', tabelas: ['T'], geradoEm: AGORA.toISOString() },
    ['valor', 'DOBRO'],
    linhas as never,
    daxSha,
  );
  await escreve(
    path.join(dir, 'q-outra.jsonl'),
    { query: 'q-outra', tabelas: ['OUTRA'], geradoEm: AGORA.toISOString() },
    ['x'],
    [{ x: 1 }],
  );
  return dir;
}

test('a coluna materializada é lida do arquivo, não recalculada', async () => {
  const model = monta();
  const dir = await gravaSnapshot(model, new Map([['DOBRO', shaDeDax("'T'[valor] * 2")]]));
  const { cabecalho } = await le(path.join(dir, 'q-t.jsonl'));
  const dobro = cabecalho.colunas.find((c) => c.nome === 'DOBRO')!;
  assert.equal(dobro.daxSha, shaDeDax("'T'[valor] * 2"), 'o sha viaja no cabeçalho');
  assert.equal(dobro.tipo, 'number');
});

test('DAX mudado desde a materialização ERRA ALTO, e diz o comando', async () => {
  // O guarda inteiro existe para este caso. Sem ele o relatório serviria o valor
  // do DAX antigo, calado — e ninguém teria por onde perceber.
  const dir = await gravaSnapshot(monta(), new Map([['DOBRO', shaDeDax("'T'[valor] * 2")]]));
  const depois = monta("'T'[valor] * 3"); // alguém mexeu no Power BI e reextraiu
  await assert.rejects(
    () => carrega({ dir, model: depois, dashboards: DASH, now: AGORA }),
    (e: Error) => {
      assert.match(e.message, /desatualizado/);
      assert.match(e.message, /DOBRO/);
      assert.match(e.message, /npm run snapshot/, 'a mensagem tem de dizer o que fazer');
      return true;
    },
  );
});

test('coluna que deixou de ser calculada no modelo também erra alto', async () => {
  const dir = await gravaSnapshot(monta(), new Map([['DOBRO', shaDeDax("'T'[valor] * 2")]]));
  const depois = new SemanticModel();
  depois.addTable({ id: 't', name: 'T', queryRef: 'q-t', columns: [col('valor')] });
  depois.addTable({ id: 'outra', name: 'OUTRA', queryRef: 'q-outra', columns: [col('x')] });
  await assert.rejects(
    () => carrega({ dir, model: depois, dashboards: DASH, now: AGORA }),
    /não existe mais|não é mais coluna calculada/,
  );
});

test('sha que confere carrega sem erro', async () => {
  const model = monta();
  const dir = await gravaSnapshot(model, new Map([['DOBRO', shaDeDax("'T'[valor] * 2")]]));
  const c = await carrega({ dir, model, dashboards: DASH, now: AGORA });
  assert.equal(c.linhasPorTabela.get('T'), 2);
});

// --------------------------------------------------------------------------
// O CONJUNTO MISTO DA CARGA INCREMENTAL (22/09/2026)
//
// `mescla()` devolve linhas antigas (de `le()`, JÁ com a calculada preenchida sob
// a chave normalizada) misturadas com linhas novas (da busca, sem nenhuma).
// `columnValue` não reavalia o que já está na linha, e `adotaTabela` monta as
// colunas físicas como a UNIÃO das chaves — as duas coisas juntas produzem dois
// estragos calados, e nenhum guarda existente os pega.
//
// A chave AQUI é a normalizada de propósito: é a que `le()` devolve. Com a de
// exibição, `adotaTabela` erra alto ("a chave 'DOBRO' não está normalizada") e o
// defeito nunca chega a acontecer — foi o que escondeu isto até agora.

test('conjunto misto SEM apagar: a antiga congela e a NOVA sai null', () => {
  const model = monta();
  const linhas: Record<string, Escalar>[] = [
    { valor: 3, dobro: 999 }, // veio de `le()`: já traz o valor de uma carga anterior
    { valor: 5 }, // veio da busca de agora
  ];
  materializaColunas(model.table('T')!, model, linhas, AGORA);

  // Este teste DOCUMENTA o comportamento errado, para que o conserto abaixo tenha
  // contra o que ser medido. Se algum dia ele começar a reprovar porque os dois
  // valores saíram certos, o conserto virou desnecessário — e aí é este teste que
  // sai, não o de baixo.
  //
  // Confere a chave de EXIBIÇÃO porque é ela que vai para o arquivo (`escreve` a
  // procura por `c.nome`): é o valor que a tela leria amanhã.
  assert.equal(linhas[0]!.DOBRO, 999, 'a linha antiga foi reavaliada — columnValue mudou de comportamento');
  assert.equal(linhas[1]!.DOBRO, null, 'a linha nova saiu com valor — adotaTabela mudou de comportamento');
});

test('esqueceCalculadas: o conjunto misto volta a sair inteiro e certo', () => {
  const model = monta();
  const linhas: Record<string, Escalar>[] = [{ valor: 3, dobro: 999 }, { valor: 5 }];

  const tocadas = esqueceCalculadas(model.table('T')!, model, linhas);
  assert.equal(tocadas, 1, 'só a linha antiga tinha o que apagar');

  materializaColunas(model.table('T')!, model, linhas, AGORA);
  assert.equal(linhas[0]!.DOBRO, 6, 'o valor velho sobreviveu — é o congelamento de Status SLA');
  assert.equal(linhas[1]!.DOBRO, 10, 'a linha nova saiu null — é a união de chaves de adotaTabela');
});

test('esqueceCalculadas apaga as DUAS formas da chave', () => {
  const model = monta();
  // `materializaColunas` grava as duas: a normalizada (memoização de `columnValue`)
  // e a de exibição (é ela que vai no cabeçalho do arquivo). Apagar só uma deixaria
  // a outra reabastecendo a primeira na volta seguinte.
  const linhas: Record<string, Escalar>[] = [{ valor: 3, dobro: 999, DOBRO: 999 }];
  esqueceCalculadas(model.table('T')!, model, linhas);
  assert.ok(!('dobro' in linhas[0]!), 'sobrou a chave normalizada');
  assert.ok(!('DOBRO' in linhas[0]!), 'sobrou a chave de exibição');
  assert.equal(linhas[0]!.valor, 3, 'apagou coluna que não é calculada');
});

test('esqueceCalculadas não mexe em linha que não tem calculada — a carga completa', () => {
  const model = monta();
  const linhas: Record<string, Escalar>[] = [{ valor: 3 }, { valor: 5 }];
  assert.equal(esqueceCalculadas(model.table('T')!, model, linhas), 0);
  assert.deepEqual(linhas, [{ valor: 3 }, { valor: 5 }]);
});
