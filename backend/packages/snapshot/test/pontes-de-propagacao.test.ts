// Nenhuma página pode ficar sem uma tabela-PONTE do seu próprio caminho de filtro.
//
// **O defeito que isto reprova (QA D-21, ACHADOS #260).** No Relatório do Mês o seletor
// de tipo mora em `PROTOCOLOS` e dois cartões leem `FIELD AGENDA`. O caminho existe no
// modelo, em três saltos:
//
//     PROTOCOLOS -> PROTOCOLOS GERAL -> Status Protocolo Dia -> FIELD AGENDA
//
// As duas pontas entravam no fechamento porque algum visual as nomeia. O MEIO não: ele é
// só ponte. E a travessia de `filter.ts` pula aresta cuja tabela não está carregada
// (`if (!dataset.hasTable(a.source)) continue`), então o filtro morria no meio e os
// cartões devolviam o número **sem recorte e sem erro**. É a família do erro silencioso
// que este projeto mais teme: a medida roda, devolve número, e o número responde outra
// pergunta.
//
// Um teste por página seria uma lista para alguém esquecer de atualizar. Este varre as
// 14 e cobra zero — então uma ponte nova, criada por um visual novo ou por um
// relacionamento novo, reprova sozinha no dia em que aparecer.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildPropagation } from '../../measure-engine/src/propagation.ts';
import { SemanticModel, normalizeName } from '../../semantic-model/src/model.ts';
import { loadDashboards } from '../../widget-engine/src/spec.ts';
import { planeja } from '../src/plano.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');

/**
 * As tabelas no MEIO de um caminho de propagação entre duas de `dentro`.
 *
 * Reimplementado aqui de propósito, a partir do grafo: se `plano.ts` parar de fechar as
 * pontes, este cálculo independente continua achando-as e o teste reprova. Um teste que
 * chamasse a função do `plano.ts` concordaria com ela até quando ela estivesse errada.
 *
 * **Caminho simples no RELACIONAMENTO** — nenhum usado duas vezes, a mesma regra do "não
 * voltar por onde veio" de `filter.ts`. Sem isso, um relacionamento `bothDirections`
 * conta como ponte sozinho (A -> X -> A pela mesma aresta, que não propaga nada).
 */
function pontesQueFaltam(dentro: ReadonlySet<string>, model: SemanticModel): string[] {
  const prop = buildPropagation(model, (t, c) => () => {
    throw new Error(`só o grafo é usado aqui; '${t}'[${c}] não deveria ser lido.`);
  });
  const saindoDe = new Map<string, { para: string; rel: string }[]>();
  for (const t of model.tables.values()) {
    for (const a of prop.incoming(normalizeName(t.name))) {
      const l = saindoDe.get(a.source) ?? [];
      l.push({ para: a.target, rel: a.relationship });
      saindoDe.set(a.source, l);
    }
  }

  const achadas = new Set<string>();
  for (const partida of dentro) {
    const caminho: string[] = [];
    const rels = new Set<string>();
    const anda = (aqui: string): void => {
      for (const { para, rel } of saindoDe.get(aqui) ?? []) {
        if (rels.has(rel) || caminho.includes(para)) continue;
        if (dentro.has(para)) {
          for (const m of caminho) achadas.add(m);
          continue;
        }
        rels.add(rel);
        caminho.push(para);
        anda(para);
        caminho.pop();
        rels.delete(rel);
      }
    };
    anda(partida);
  }
  return [...achadas].filter((k) => !dentro.has(k));
}

const model = SemanticModel.fromSpecsDir(SPECS);
const dashboards = loadDashboards(SPECS);

test('nenhuma página fica sem uma tabela-ponte do próprio caminho de filtro (QA D-21)', () => {
  const faltando: string[] = [];
  for (const d of dashboards) {
    const dentro = new Set(planeja([d], model).tabelas.map((t) => normalizeName(t.nome)));
    for (const k of pontesQueFaltam(dentro, model)) {
      faltando.push(`${d.id}: falta '${model.table(k)?.name ?? k}'`);
    }
  }
  assert.deepEqual(
    faltando,
    [],
    'Sem a ponte, o filtro morre no meio do caminho e o visual devolve número sem recorte, calado.',
  );
});

/**
 * O caso concreto do QA, nomeado: se alguém desfizer a quinta aresta do fechamento, o
 * teste acima reprova em bloco e este diz QUAL era o caminho.
 */
test('Status Protocolo Dia entra no Relatório do Mês como ponte, não como visual', () => {
  const dash = dashboards.find((d) => d.id === 'relatorio-do-mes')!;
  const plano = planeja([dash], model);
  const ponte = plano.tabelas.find((t) => normalizeName(t.nome) === 'status protocolo dia');
  assert.ok(ponte, 'sem ela, o filtro de TIPO não alcança AGENDADOS nem MÉDIA AGENDADA');
  assert.match(ponte.porque, /ponte de propagação/);

  // As duas pontas do caminho continuam lá, senão a ponte não ligaria nada.
  const nomes = new Set(plano.tabelas.map((t) => normalizeName(t.nome)));
  for (const ponta of ['protocolos', 'protocolos geral', 'field agenda']) {
    assert.ok(nomes.has(ponta), `a ponta '${ponta}' saiu do fechamento`);
  }
});
