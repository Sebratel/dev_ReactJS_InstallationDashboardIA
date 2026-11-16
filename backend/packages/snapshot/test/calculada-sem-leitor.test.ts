// Coluna física carregada em TODA página porque uma calculada órfã a cita.
//
// **O vazamento que isto fecha (13/11/2026).** `colunas-usadas.ts` dobra o DAX de TODAS
// as medidas e de TODAS as colunas calculadas do modelo, de propósito: errar para MANTER
// custa memória, errar para TIRAR faz a página não abrir. O efeito colateral é que uma
// calculada que nenhum visual alcança continua segurando as colunas físicas que ela lê —
// em todas as páginas, para sempre, sem ninguém ler o resultado.
//
// Foi o caso de `PROTOCOLOS GERAL[TURNO CRIADO]`: o nome dela aparecia UMA vez no
// repositório (a própria declaração), e ela mantinha `[HORA CRIADO]` viva — **6,48 MB
// por página**, 18% do piso que a PROTOCOLOS GERAL impõe às 13 páginas. Medido sobre o
// snapshot de produção de 13/11/2026 (ACHADOS #262).
//
// **Por que uma LISTA e não "zero".** Sobrou 1,05 MB em seis casos pequenos, e tirá-los
// mexeria em medida e em tabela calculada — risco desproporcional ao byte. A lista é o
// inventário medido: o teste reprova no dia em que aparecer um caso NOVO, ou quando um
// destes mudar de tamanho a ponto de valer a conversa. Lista que ninguém revisa apodrece;
// esta tem o custo de cada linha escrito ao lado, que é o que torna a revisão possível.
//
// O alcance aqui é REIMPLEMENTADO a partir dos visuais, não importado de
// `colunas-usadas.ts`: um teste que chamasse a mesma função concordaria com ela até
// quando ela estivesse errada.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SemanticModel, normalizeName } from '../../semantic-model/src/model.ts';
import { extractRefs } from '../../semantic-model/src/refs.ts';
import { loadDashboards } from '../../widget-engine/src/spec.ts';
import { colunasUsadas } from '../src/colunas-usadas.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');

const model = SemanticModel.fromSpecsDir(SPECS);
const dashboards = loadDashboards(SPECS);

const chave = (t: string, c: string): string => `${normalizeName(t)}\u0000${normalizeName(c)}`;

/**
 * As colunas que os VISUAIS alcançam — campo, filtro, ponta de relacionamento, e o fecho
 * disso por medida, coluna calculada e tabela calculada.
 *
 * A diferença para `colunasUsadas` é uma só, e é o ponto do teste: aqui o DAX de uma
 * medida ou de uma calculada só entra se ela mesma for alcançada.
 */
function alcancadasPelosVisuais(): Set<string> {
  const colunas = new Set<string>();
  const medidas = new Set<string>();
  const fila: { tipo: 'col' | 'med'; tabela: string; coluna?: string }[] = [];

  const poeColuna = (t: string, c: string): void => {
    const k = chave(t, c);
    if (colunas.has(k)) return;
    colunas.add(k);
    fila.push({ tipo: 'col', tabela: t, coluna: c });
  };
  const poeMedida = (nome: string): void => {
    const k = normalizeName(nome);
    if (medidas.has(k)) return;
    medidas.add(k);
    fila.push({ tipo: 'med', tabela: nome });
  };
  const daDax = (dax: string | null | undefined): void => {
    if (!dax) return;
    for (const r of extractRefs(dax)) {
      if (r.kind === 'column') poeColuna(r.table, r.column);
      // `extractRefs` não tem kind 'measure': medida aparece como `bare`, porque
      // `[X]` sozinho é medida OU coluna da tabela em contexto de linha.
      else if (r.kind === 'bare') {
        // `[X]` sem tabela é medida OU coluna da tabela em contexto de linha. Marca as
        // duas leituras, como `colunas-usadas.ts` faz: aqui também o lado seguro é manter.
        if (model.measure(r.name)) poeMedida(r.name);
        for (const t of model.tables.values()) {
          if (t.columns.some((c) => normalizeName(c.name) === normalizeName(r.name))) {
            poeColuna(t.name, r.name);
          }
        }
      }
    }
  };

  for (const d of dashboards) {
    for (const f of d.filters ?? []) {
      if (f.entity && f.property) poeColuna(f.entity, f.property);
      for (const cond of f.conditions ?? []) {
        const p = (cond as { left_property?: string | null }).left_property;
        if (f.entity && p) poeColuna(f.entity, p);
      }
    }
    for (const v of d.visuals ?? []) {
      for (const c of v.fields ?? []) {
        if (!c.entity || !c.property) continue;
        if (c.kind === 'measure') poeMedida(c.property);
        else poeColuna(c.entity, c.property);
      }
      for (const f of v.filters ?? []) {
        if (f.entity && f.property) poeColuna(f.entity, f.property);
        for (const cond of f.conditions ?? []) {
          const p = (cond as { left_property?: string | null }).left_property;
          if (f.entity && p) poeColuna(f.entity, p);
        }
      }
    }
  }
  // As duas pontas de todo relacionamento: sem elas a propagação para de achar a chave.
  for (const r of model.relationships) {
    poeColuna(r.fromTable, r.fromColumn);
    poeColuna(r.toTable, r.toColumn);
  }
  // Tabela calculada: as linhas dela nascem do DAX, que lê colunas físicas de outras.
  for (const t of model.tables.values()) daDax(t.tableDax);

  while (fila.length > 0) {
    const it = fila.pop()!;
    if (it.tipo === 'med') {
      daDax(model.measure(it.tabela)?.dax);
      continue;
    }
    const col = model
      .table(it.tabela)
      ?.columns.find((c) => normalizeName(c.name) === normalizeName(it.coluna!));
    if (col?.calculated) daDax(col.dax);
  }
  return colunas;
}

/**
 * Os casos conhecidos, medidos sobre o snapshot de produção em 13/11/2026 — `tabela |
 * coluna | MB por página`. Cada um cabe numa linha porque o custo é pequeno; o que não
 * cabe aqui é caso novo.
 */
const CONHECIDOS = new Map<string, string>([
  [chave('FIELD AGENDA', 'RankAtualProtocolo'), '0,60 MB — medida QtdProtocolosPorRankAtual, que nenhum visual pede'],
  [chave('BACKLOG AGENDADO FUTURO', 'data_inicio_slot'), '0,22 MB'],
  [chave('PROTOCOLOS GERAL', 'ITEM'), '0,10 MB — calculada CONDICAO ITEM, sem leitor'],
  [chave('PROTOCOLOS PRODUTIVIDADE', 'TÉCNICO TROCA'), '0,09 MB'],
  [chave('CALENDARIO AGENDAMENTO', 'Num Semana'), 'arredonda para 0,00 MB'],
  [chave('CALENDARIO CRIADO', 'data_vigente'), 'arredonda para 0,00 MB'],
]);

test('nenhuma coluna física NOVA é carregada sem um visual que a alcance', () => {
  const alcancadas = alcancadasPelosVisuais();
  const mantidas = colunasUsadas(dashboards, model);

  const novas: string[] = [];
  for (const t of model.tables.values()) {
    const precisa = mantidas.get(normalizeName(t.name));
    if (!precisa) continue;
    for (const c of t.columns) {
      if (c.calculated) continue; // calculada não é lida do disco por `omissiveis`.
      const k = chave(t.name, c.name);
      if (!precisa.has(normalizeName(c.name))) continue; // já podada na carga.
      if (alcancadas.has(k)) continue;
      if (CONHECIDOS.has(k)) continue;
      novas.push(`'${t.name}'[${c.name}]`);
    }
  }

  assert.deepEqual(
    novas,
    [],
    'Estas colunas entram na memória de toda página e nenhum visual chega nelas. ' +
      'Quem as segura é uma medida ou uma calculada que ninguém alcança — foi assim que ' +
      "'PROTOCOLOS GERAL'[HORA CRIADO] custou 6,48 MB por página. Ou a órfã sai do " +
      'modelo, ou entra em CONHECIDOS com o custo medido ao lado.',
  );
});

test('TURNO CRIADO não volta, e HORA CRIADO continua fora da carga', () => {
  const pg = model.table('PROTOCOLOS GERAL')!;
  assert.equal(
    pg.columns.some((c) => normalizeName(c.name) === normalizeName('TURNO CRIADO')),
    false,
    'a calculada órfã voltou — com ela volta HORA CRIADO, 6,48 MB em cada uma das 13 páginas',
  );
  const precisa = colunasUsadas(dashboards, model).get(normalizeName('PROTOCOLOS GERAL'))!;
  assert.equal(
    precisa.has(normalizeName('HORA CRIADO')),
    false,
    'alguém voltou a citar PROTOCOLOS GERAL[HORA CRIADO] em DAX; confira se o leitor é real',
  );
});

test('a órfã que não custa memória fica: TURNO ALOCADO continua no modelo', () => {
  // `HR. ALOCAÇÃO` é exibida pela `l-mapa`, então apagar `TURNO ALOCADO` não tiraria
  // byte nenhum — só afastaria o modelo do relatório original de graça. A assimetria é
  // a regra desta decisão, e está aqui para não ser "arrumada" por engano.
  const pg = model.table('PROTOCOLOS GERAL')!;
  assert.ok(pg.columns.some((c) => normalizeName(c.name) === normalizeName('TURNO ALOCADO')));
  const precisa = colunasUsadas(dashboards, model).get(normalizeName('PROTOCOLOS GERAL'))!;
  assert.ok(precisa.has(normalizeName('HR. ALOCAÇÃO')));
});
