// Propagação de filtro por relacionamento.
//
// Este arquivo responde uma pergunta só: **de quais tabelas o filtro chega numa
// tabela, e por qual coluna**. Quem viaja por essas arestas é o
// `FilteredContext`; aqui só está o grafo.
//
// Por que isso é uma fase própria e não um detalhe: até agora nada propagava.
// `Contagem Solicitacao 2026` é
//     CALCULATE(COUNT('PROTOCOLOS GERAL'[SOLICITACAO]),
//               'CALENDARIO INSTALADO'[DATA INSTALADO] >= DATE(2026,1,1))
// — o filtro pousava em `CALENDARIO INSTALADO` e o `COUNT` contava
// `PROTOCOLOS GERAL` inteira. A medida **rodava**, e devolvia o total de todos os
// anos com cara de total de 2026. É o pior tipo de erro que este projeto pode
// produzir, e por isso ele é o caso de verificação da fase.
//
// DIREÇÃO. O filtro anda do lado "one" (`to_*`) para o lado "many" (`from_*`), e
// com `cross_filter: bothDirections` anda nos dois sentidos. Isso vale também
// para os seis relacionamentos many-to-many desta base: no TMDL, direção única
// sempre significa `to` → `from`.
//
// RELACIONAMENTO INATIVO. Um dos 22 é `active: false`
// (`PROTOCOLOS PRODUTIVIDADE[SOLICITACAO]` → `PROTOCOLOS GERAL[SOLICITACAO]`).
// Ele só valeria dentro de `USERELATIONSHIP`, e essa função **não aparece em
// nenhuma das 127 expressões** — conferido, não suposto. Então ele fica fora do
// grafo e não há nada a implementar por ele. Se um dia aparecer, o avaliador
// falha alto na função e este comentário deixa de valer.

import { normalizeName, type SemanticModel } from '../../semantic-model/src/model.ts';
import type { Row } from './dataset.ts';
import type { DaxValue } from './value.ts';

/** Uma direção de um relacionamento: por onde o filtro entra numa tabela. */
export interface PropagationEdge {
  /**
   * Id do relacionamento. É a chave do "não voltar por onde veio": um filtro
   * atravessa cada relacionamento **uma vez** no caminho. Sem isso, um
   * `bothDirections` viraria laço imediato — A restringe B, B restringe A.
   */
  readonly relationship: string;
  /** Tabela de onde o filtro vem, normalizada (chave do grafo). */
  readonly source: string;
  /** Tabela que o filtro restringe, normalizada. */
  readonly target: string;
  /** Nomes como estão no modelo — usados para resolver coluna e para erro. */
  readonly sourceTable: string;
  readonly sourceColumn: string;
  readonly targetTable: string;
  readonly targetColumn: string;
}

/**
 * O grafo mais a resolução de valor de coluna de junção.
 *
 * `joinValue` é injetado, e não é firula: **cinco das colunas de junção desta
 * base são calculadas** — entre elas `'PROTOCOLOS GERAL'[DATA INSTALAÇÃO]`, que
 * é justamente a do caso de verificação, e `'#APURAÇÃO PREMIAÇÃO'[INSTALADOR_PAD]`,
 * que é calculada do lado "one". Ler a coluna direto da linha devolveria vazio
 * para todas elas e a junção não casaria nada, calada. Só o avaliador sabe
 * calcular DAX, então ele empresta essa capacidade ao contexto de filtro.
 */
export interface Propagation {
  /** Arestas que chegam na tabela dada. */
  incoming(target: string): readonly PropagationEdge[];
  joinValue(table: string, column: string, row: Row): DaxValue;
}

/** Como a aresta aparece numa mensagem de erro. */
export function describeEdge(e: PropagationEdge): string {
  return `'${e.sourceTable}'[${e.sourceColumn}] -> '${e.targetTable}'[${e.targetColumn}]`;
}

export function buildPropagation(
  model: SemanticModel,
  joinValue: (table: string, column: string, row: Row) => DaxValue,
): Propagation {
  const porDestino = new Map<string, PropagationEdge[]>();

  const adiciona = (e: PropagationEdge): void => {
    const lista = porDestino.get(e.target);
    if (lista) lista.push(e);
    else porDestino.set(e.target, [e]);
  };

  for (const r of model.relationships) {
    if (!r.active) continue;
    adiciona({
      relationship: r.id,
      source: normalizeName(r.toTable),
      target: normalizeName(r.fromTable),
      sourceTable: r.toTable,
      sourceColumn: r.toColumn,
      targetTable: r.fromTable,
      targetColumn: r.fromColumn,
    });
    if (r.crossFilter === 'bothDirections') {
      adiciona({
        relationship: r.id,
        source: normalizeName(r.fromTable),
        target: normalizeName(r.toTable),
        sourceTable: r.fromTable,
        sourceColumn: r.fromColumn,
        targetTable: r.toTable,
        targetColumn: r.toColumn,
      });
    }
  }

  return {
    incoming: (target) => porDestino.get(normalizeName(target)) ?? [],
    joinValue,
  };
}

/** Grafo vazio: nada propaga. Só para testar o mecanismo de substituição isolado. */
export const NO_PROPAGATION: Propagation = {
  incoming: () => [],
  joinValue: (table, column) => {
    throw new Error(`NO_PROPAGATION não resolve '${table}'[${column}] — não deveria ser chamado.`);
  },
};
