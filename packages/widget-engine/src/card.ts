// O valor que um visual `card` mostra.
//
// O card é o caso mais barato de conferir do relatório inteiro: **um** número, sem
// eixo, sem ordenação, sem "top N" — dá para olhar a tela e comparar. É por isso que
// o Widget Engine começa por ele e não pela tabela ou pelo gráfico.
//
// Medido nas specs de 06/08/2026, os 64 cards são uniformes: todos com exatamente
// **um** campo, todos em `role: Values`. As agregações usadas são `min` 22,
// `count` 10, `count_non_null` 4, e 28 são medida nomeada. Nada de `sum`, `avg` ou
// `max` em card — o mapa abaixo cobre as seis de qualquer jeito, porque a próxima
// fatia (gráficos) usa as outras.
//
// **Por que a agregação vira nó de AST em vez de texto DAX.** Gerar `SUM('T'[C])`
// como texto e reparsear obrigaria a escapar nomes, e os nomes desta base incluem
// `#APURAÇÃO PREMIAÇÃO` e `ALOCAÇÃO PATRIMONIO.ALOCADO POR:`. Um escape errado daria
// erro de sintaxe no melhor caso e a coluna errada no pior. Montando o nó direto,
// não há texto para escapar — e a implementação que roda é a mesma
// `functions.ts` das medidas, com as mesmas regras de BLANK e de coluna calculada.

import type { CallNode, ColumnRefNode, Position } from '../../measure-engine/src/ast.ts';
import type { EvalScope, Evaluator } from '../../measure-engine/src/evaluator.ts';
import type { TableFilter } from '../../measure-engine/src/filter.ts';
import { DaxEvalError, type DaxValue } from '../../measure-engine/src/value.ts';
import { traduzFiltros } from './filtro.ts';
import type { CampoSpec, DashboardSpec, VisualSpec } from './spec.ts';

/**
 * Agregação do PBIP -> função DAX.
 *
 * `count` (`Function: 2`) é o único item **em aberto**, e está isolado aqui de
 * propósito: a evidência de dentro do relatório aponta para contagem distinta (o card
 * que alguém batizou de `CLIENTES DISTINTOS` é `Function: 2`), e o tamanho da dúvida
 * foi medido — 8 das 10 cartas `count` estão sobre colunas 100% distintas, onde as
 * duas leituras dão o mesmo número, sobrando 2 de 64 cards. A confirmação de cinco
 * segundos está em docs/PERGUNTAS-NEGOCIO.md #6. Se a resposta for "não distinto",
 * muda-se **esta linha**.
 */
export const FUNCAO_DA_AGREGACAO: Record<string, string> = {
  sum: 'SUM',
  avg: 'AVERAGE',
  count: 'DISTINCTCOUNT',
  min: 'MIN',
  max: 'MAX',
  count_non_null: 'COUNTA',
};

/** Nó sintético: não veio de texto, então não há posição real a apontar. */
const SEM_POSICAO: Position = { start: 0, line: 1, col: 1 };

export interface ValorDeCard {
  dashboard: string;
  visual: string;
  /** O rótulo que aparece na tela (`displayName` do PBIP). */
  nome: string | null;
  valor: DaxValue;
  /** Como o número foi obtido — para conferência contra a tela, não para exibir. */
  origem:
    | { kind: 'aggregation'; table: string; column: string; aggregation: string; funcao: string }
    | { kind: 'measure'; measure: string };
  /** `origem` de cada `TableFilter` aplicado, de página e de visual juntos. */
  filtros: string[];
}

/**
 * O único campo de um card. Falha alto se o visual não tiver a forma medida — um
 * card com dois campos mostraria um dos dois, e escolher qual em silêncio é
 * inventar.
 */
function campoUnico(v: VisualSpec, onde: string): CampoSpec {
  const valores = (v.fields ?? []).filter((f) => f.role === 'Values');
  if (valores.length !== 1 || (v.fields ?? []).length !== valores.length) {
    throw new DaxEvalError(
      `${onde}: card com ${v.fields?.length ?? 0} campo(s) (${valores.length} em Values). ` +
        `Os 64 cards do relatório têm exatamente um, em Values. ` +
        `Roles presentes: ${[...new Set((v.fields ?? []).map((f) => f.role))].join(', ') || '(nenhum)'}.`,
    );
  }
  return valores[0]!;
}

/**
 * Calcula o número de um card.
 *
 * Os filtros de página e de visual entram num `with()` **único**. Em duas etapas o
 * de visual apagaria o de página quando tocassem a mesma coluna — ver o comentário
 * de cabeçalho de `filtro.ts`.
 */
export function calculaCard(dash: DashboardSpec, visual: VisualSpec, ev: Evaluator): ValorDeCard {
  const onde = `${dash.id}/${visual.id}`;
  if (visual.type !== 'card') {
    throw new DaxEvalError(`${onde}: não é card, é '${visual.type}'.`);
  }
  const campo = campoUnico(visual, onde);

  const filtros = traduzFiltros(
    [...(dash.filters ?? []), ...(visual.filters ?? [])],
    ev,
    onde,
  );
  const escopo = escopoComFiltros(ev, filtros);

  return {
    dashboard: dash.id,
    visual: visual.id,
    nome: campo.name ?? null,
    valor: valorDoCampo(campo, escopo, ev, onde),
    origem: origemDoCampo(campo, onde),
    filtros: filtros.map((f) => f.origem),
  };
}

/** Escopo raiz com os filtros aplicados de uma vez. */
export function escopoComFiltros(ev: Evaluator, filtros: readonly TableFilter[]): EvalScope {
  const raiz = ev.rootScope();
  return ev.scopeWithFilter(raiz, raiz.filter.with(filtros));
}

function origemDoCampo(campo: CampoSpec, onde: string): ValorDeCard['origem'] {
  if (campo.kind === 'measure') {
    if (!campo.property) throw new DaxEvalError(`${onde}: medida sem nome.`);
    return { kind: 'measure', measure: campo.property };
  }
  if (campo.kind === 'aggregation') {
    const { tabela, coluna, agregacao, funcao } = partesDaAgregacao(campo, onde);
    return { kind: 'aggregation', table: tabela, column: coluna, aggregation: agregacao, funcao };
  }
  throw new DaxEvalError(`${onde}: campo de card com kind '${campo.kind}'.`);
}

function partesDaAgregacao(campo: CampoSpec, onde: string) {
  const { entity: tabela, property: coluna, aggregation: agregacao } = campo;
  if (!tabela || !coluna) {
    throw new DaxEvalError(
      `${onde}: agregação sem tabela ou coluna (entity=${JSON.stringify(tabela)}, ` +
        `property=${JSON.stringify(coluna)}).`,
    );
  }
  if (!agregacao) {
    throw new DaxEvalError(
      `${onde}: campo agrega '${tabela}'[${coluna}] e não diz **como**. ` +
        `Sem a função não há um número, há vários — é o defeito de docs/ACHADOS.md #28.`,
    );
  }
  const funcao = FUNCAO_DA_AGREGACAO[agregacao];
  if (!funcao) {
    throw new DaxEvalError(
      `${onde}: agregação '${agregacao}' sem função DAX correspondente. ` +
        `Conhecidas: ${Object.keys(FUNCAO_DA_AGREGACAO).join(', ')}. ` +
        `Um 'desconhecidaN' aqui veio do PBIP usando uma função nova (mediana, desvio, ` +
        `variância) — o lugar de nomeá-la é tools/extractor.`,
    );
  }
  return { tabela, coluna, agregacao, funcao };
}

/** O valor de um campo `Values` num escopo já filtrado. */
export function valorDoCampo(
  campo: CampoSpec,
  escopo: EvalScope,
  ev: Evaluator,
  onde: string,
): DaxValue {
  if (campo.kind === 'measure') {
    if (!campo.property) throw new DaxEvalError(`${onde}: medida sem nome.`);
    return ev.measureInScope(campo.property, escopo);
  }
  if (campo.kind === 'aggregation') {
    const { tabela, coluna, funcao } = partesDaAgregacao(campo, onde);
    const ref: ColumnRefNode = { type: 'ColumnRef', table: tabela, column: coluna, pos: SEM_POSICAO };
    const chamada: CallNode = { type: 'Call', name: funcao, args: [ref], pos: SEM_POSICAO };
    return ev.evaluate(chamada, escopo);
  }
  throw new DaxEvalError(
    `${onde}: campo com kind '${campo.kind}' não é calculável como valor único. ` +
      `Card só tem column/aggregation/measure; hierarchy_level e arithmetic aparecem ` +
      `em eixo e em "% do total", que são a próxima fatia.`,
  );
}

/** Todos os cards de um dashboard, na ordem em que a spec os traz. */
export function cardsDoDashboard(dash: DashboardSpec): VisualSpec[] {
  return (dash.visuals ?? []).filter((v) => v.type === 'card');
}
