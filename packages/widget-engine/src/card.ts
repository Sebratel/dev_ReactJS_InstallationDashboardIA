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
import { BLANK, DaxEvalError, isBlank, toNumber, type DaxValue } from '../../measure-engine/src/value.ts';
import { FUNCAO_DA_AGREGACAO } from './agregacao.ts';
import { traduzFiltros } from './filtro.ts';
import type { CampoSpec, DashboardSpec, VisualSpec } from './spec.ts';

export { FUNCAO_DA_AGREGACAO };

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

/**
 * O valor de um campo `Values` num escopo já filtrado.
 *
 * `escopoDoTotal` é o escopo do visual **antes de agrupar** — o que um `ScopedEval`
 * de escopo vazio pede, e o denominador de um "% do total". Onde não há agrupamento
 * (o card) ele é o próprio escopo, e é por isso que tem padrão.
 */
export function valorDoCampo(
  campo: CampoSpec,
  escopo: EvalScope,
  ev: Evaluator,
  onde: string,
  escopoDoTotal: EvalScope = escopo,
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
  if (campo.kind === 'arithmetic') {
    return valorAritmetico(campo, escopo, ev, onde, escopoDoTotal);
  }
  if (campo.kind === 'scoped_eval') {
    return valorEscopado(campo, ev, onde, escopoDoTotal);
  }
  throw new DaxEvalError(
    `${onde}: campo '${campo.name ?? campo.property}' tem kind '${campo.kind}' e não é ` +
      `calculável como valor único. Calculáveis: column (com agregação), aggregation, ` +
      `measure, arithmetic e scoped_eval. ` +
      (campo.kind === 'hierarchy_level'
        ? `hierarchy_level é um nível da hierarquia de data ('${campo.entity}'[${campo.property}].` +
          `[${campo.level}]) — ele é eixo, e como célula precisaria ser projetado da coluna.`
        : `Nenhuma delas.`),
  );
}

/**
 * `ScopedEval(expr, [])` — a expressão avaliada **sem o agrupamento do visual**.
 *
 * É o denominador do "% do total": a mesma contagem, no visual inteiro em vez de na
 * linha. O escopo vazio é o que dá esse significado; escopo **não** vazio retém
 * parte do eixo, e é outra coisa — que esta base não usa, daí a recusa.
 *
 * Note o que fica de fora: `escopoDoTotal` mantém os filtros de página e de visual.
 * "Total" aqui é o do visual, não o da tabela. Fosse o da tabela, cada porcentagem
 * sairia menor e a coluna não somaria 100%.
 */
function valorEscopado(
  campo: CampoSpec,
  ev: Evaluator,
  onde: string,
  escopoDoTotal: EvalScope,
): DaxValue {
  const niveis = campo.scope ?? [];
  if (niveis.length > 0) {
    throw new DaxEvalError(
      `${onde}: ScopedEval com escopo de ${niveis.length} nível(is) ` +
        `(${JSON.stringify(niveis).slice(0, 120)}). Só o escopo vazio — "o total do ` +
        `visual" — ocorre nesta base. Escopo não vazio retém parte do eixo, e tratá-lo ` +
        `como vazio daria um denominador maior e porcentagens menores.`,
    );
  }
  if (!campo.expression) {
    throw new DaxEvalError(`${onde}: ScopedEval sem expressão dentro.`);
  }
  return valorDoCampo(campo.expression, escopoDoTotal, ev, onde, escopoDoTotal);
}

/**
 * `Arithmetic` — a conta entre dois campos. Nesta base é sempre `A / total(A)`, o
 * "% do total".
 *
 * **Cada operando é calculado no seu próprio escopo**, e é isso que faz a conta ter
 * sentido: o de cima na linha, o de baixo no visual inteiro. Calculados os dois, a
 * conta em si é feita aqui, sobre valores — não há como delegá-la ao avaliador,
 * porque não existe nó de AST que carregue "um valor já calculado".
 */
function valorAritmetico(
  campo: CampoSpec,
  escopo: EvalScope,
  ev: Evaluator,
  onde: string,
  escopoDoTotal: EvalScope,
): DaxValue {
  if (!campo.left || !campo.right) {
    throw new DaxEvalError(
      `${onde}: campo aritmético sem os dois operandos ` +
        `(left=${campo.left ? 'ok' : 'faltando'}, right=${campo.right ? 'ok' : 'faltando'}).`,
    );
  }
  const conta = CONTA_DA_ARITMETICA[campo.operator ?? ''];
  if (!conta) {
    throw new DaxEvalError(
      `${onde}: operador aritmético '${campo.operator}' desconhecido. ` +
        `Conhecidos: ${Object.keys(CONTA_DA_ARITMETICA).join(', ')}. ` +
        `Um 'desconhecidoN' aqui veio do PBIP usando um operador novo, e o lugar de ` +
        `nomeá-lo é tools/extractor.`,
    );
  }
  const rotulo = `${onde}: ${campo.operator} de '${campo.name ?? '(sem nome)'}'`;
  return conta(
    valorDoCampo(campo.left, escopo, ev, onde, escopoDoTotal),
    valorDoCampo(campo.right, escopo, ev, onde, escopoDoTotal),
    rotulo,
  );
}

/**
 * Os quatro operadores de `Arithmetic`.
 *
 * Só `divide` ocorre hoje. Os outros três estão aqui porque o mapa do extrator os
 * nomeia, e um mapa pela metade viraria recusa onde existe resposta.
 *
 * **`divide` segue `DIVIDE` do DAX, não `/`:** denominador zero **ou BLANK** dá
 * BLANK, não infinito. É o que a tela mostra numa linha sem denominador, e é o
 * único ponto em que as duas leituras divergem — `/` mostraria `∞` numa coluna de
 * porcentagem. `toNumber` é o mesmo do avaliador, então BLANK conta como 0 nas
 * outras três e texto continua errando alto.
 */
const CONTA_DA_ARITMETICA: Record<string, (a: DaxValue, b: DaxValue, onde: string) => DaxValue> = {
  add: (a, b, onde) => toNumber(a, onde) + toNumber(b, onde),
  subtract: (a, b, onde) => toNumber(a, onde) - toNumber(b, onde),
  multiply: (a, b, onde) => toNumber(a, onde) * toNumber(b, onde),
  divide: (a, b, onde) =>
    isBlank(b) || toNumber(b, onde) === 0 ? BLANK : toNumber(a, onde) / toNumber(b, onde),
};

/** Todos os cards de um dashboard, na ordem em que a spec os traz. */
export function cardsDoDashboard(dash: DashboardSpec): VisualSpec[] {
  return (dash.visuals ?? []).filter((v) => v.type === 'card');
}
