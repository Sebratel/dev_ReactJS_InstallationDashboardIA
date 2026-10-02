// O conteúdo de um visual `pivotTable` — a matriz do Power BI.
//
// **A forma medida (07/08/2026).** São 8, e são uniformes: papéis `Rows`, `Columns`
// e `Values`, todas as chaves `kind: column` (nenhum nível de hierarquia), e no
// máximo uma chave por eixo. Sete têm os dois eixos; um tem só linhas, com três
// medidas lado a lado.
//
// **O que separa a matriz da tabela, e é o cerne deste arquivo.** Numa tabela, cada
// linha é uma combinação: as combinações que não existem simplesmente não aparecem.
// Numa matriz, os dois eixos são agrupados **em separado** — as colunas são as
// mesmas em todas as linhas —, e cada célula é o cruzamento. Uma célula sem dado é
// vazia, não some; quem some é a linha ou a coluna **inteira** que ficou vazia.
//
// Reaproveitar `agrupar` com as chaves das duas direções juntas daria a leitura de
// tabela: só as combinações existentes, e aí cada linha teria um conjunto de colunas
// diferente. Não é uma matriz — é uma tabela com cara de matriz.
//
// **O filtro sobre agregado vale por célula.** A consulta que o Power BI monta para
// um visual é um `SUMMARIZECOLUMNS` sobre **todas** as colunas de eixo juntas, e o
// filtro de agregado é um HAVING sobre esse agrupamento. Numa matriz isso é a
// célula, não a linha. Aplicá-lo por linha derrubaria linhas inteiras onde a tela
// apaga uma célula só. São 3 dos 8.

import type { EvalScope, Evaluator } from '../../measure-engine/src/evaluator.ts';
import { DaxEvalError, isBlank, type DaxValue } from '../../measure-engine/src/value.ts';
import { escopoComFiltros, valorDoCampo } from './card.ts';
import { predicadoDeGrupo, separaFiltros, traduzFiltros } from './filtro.ts';
import { campoAtivo, chaveDoCampo, prepara, type Chave } from './grupos.ts';
import type { CampoSpec, DashboardSpec, VisualSpec } from './spec.ts';

/** Uma posição de eixo: os valores das chaves daquela direção. */
export interface EixoDeMatriz {
  valores: DaxValue[];
}

export interface ValorDeMatriz {
  dashboard: string;
  visual: string;
  chavesDeLinha: Chave[];
  chavesDeColuna: Chave[];
  /** Os rótulos das medidas, na ordem da spec. */
  medidas: (string | null)[];
  linhas: EixoDeMatriz[];
  colunas: EixoDeMatriz[];
  /** `celulas[linha][coluna][medida]`. */
  celulas: DaxValue[][][];
  /** `origem` de cada filtro aplicado, de linha e de célula. */
  filtros: string[];
  /**
   * Quantas posições de eixo sumiram por ficarem inteiras vazias.
   *
   * Fica no resultado de propósito: é a única parte do cálculo que **descarta**
   * coisa, e sem o número o descarte seria invisível.
   */
  descartadas: { linhas: number; colunas: number };
}

/** Todos os `pivotTable` de um dashboard, na ordem em que a spec os traz. */
export function matrizesDoDashboard(dash: DashboardSpec): VisualSpec[] {
  return (dash.visuals ?? []).filter((v) => v.type === 'pivotTable');
}

/**
 * Separa os campos ativos da matriz por papel.
 *
 * `Rows` e `Columns` agrupam, `Values` vira número. Papel fora dos três erra alto:
 * os 8 do relatório usam só esses, e um papel novo é uma dimensão a mais no visual.
 */
export function separaEixos(
  visual: VisualSpec,
  onde: string,
): { linha: Chave[]; coluna: Chave[]; medidas: CampoSpec[] } {
  const linha: Chave[] = [];
  const coluna: Chave[] = [];
  const medidas: CampoSpec[] = [];

  for (const campo of (visual.fields ?? []).filter(campoAtivo)) {
    if (campo.role === 'Rows') linha.push(chaveDoCampo(campo, onde));
    else if (campo.role === 'Columns') coluna.push(chaveDoCampo(campo, onde));
    else if (campo.role === 'Values') medidas.push(campo);
    else {
      throw new DaxEvalError(
        `${onde}: papel '${campo.role}' não é linha, coluna nem valor de matriz. ` +
          `Os 8 pivotTable do relatório usam Rows, Columns e Values.`,
      );
    }
  }
  return { linha, coluna, medidas };
}

/**
 * Calcula uma matriz.
 *
 * A ordem dos filtros é a mesma de tabela e gráfico: o de linha vale **antes** de
 * agrupar e decide o que entra na conta; o de agregado vale **depois**, sobre a
 * célula. Trocar a ordem não dá erro — dá outro número.
 */
export function calculaMatriz(
  dash: DashboardSpec,
  visual: VisualSpec,
  ev: Evaluator,
): ValorDeMatriz {
  const onde = `${dash.id}/${visual.id}`;
  if (visual.type !== 'pivotTable') {
    throw new DaxEvalError(`${onde}: não é pivotTable, é '${visual.type}'.`);
  }

  const { linha: chavesDeLinha, coluna: chavesDeColuna, medidas } = separaEixos(visual, onde);
  if (medidas.length === 0) {
    throw new DaxEvalError(
      `${onde}: matriz sem nenhum campo em Values — não há o que pôr nas células. ` +
        `Uma matriz só de eixos é uma tabela, e é outro visual.`,
    );
  }
  if (chavesDeLinha.length === 0 && chavesDeColuna.length === 0) {
    throw new DaxEvalError(
      `${onde}: matriz sem eixo nenhum. Sem linha e sem coluna sobra uma célula só, ` +
        `que é um card — e card é outro visual.`,
    );
  }

  const { deLinha, deGrupo } = separaFiltros([...(dash.filters ?? []), ...(visual.filters ?? [])]);
  const filtros = traduzFiltros(deLinha, ev, onde);
  const base = escopoComFiltros(ev, filtros);
  const having = deGrupo.map((f) => predicadoDeGrupo(f, ev, onde));

  // **Os dois eixos são agrupados sobre a mesma base, em separado.** É o que faz as
  // colunas serem as mesmas em todas as linhas.
  const eixoLinha = prepara(chavesDeLinha, base, ev, onde);
  const eixoColuna = prepara(chavesDeColuna, base, ev, onde);
  const declaracao = [...eixoLinha.declaracao, ...eixoColuna.declaracao];

  const celulas = eixoLinha.grupos.map((gl) =>
    eixoColuna.grupos.map((gc) => {
      const juntos = [...eixoLinha.filtrosDe(gl.valores), ...eixoColuna.filtrosDe(gc.valores)];
      const comFiltro = ev.scopeWithFilter(base, base.filter.with(juntos));
      const escopo = ev.scopeWithGrouping(comFiltro, declaracao);
      // O HAVING é da célula: reprovada, ela fica vazia — e é isso que faz uma linha
      // ou coluna inteira sumir quando nenhuma das células dela passa.
      if (!having.every((h) => h.passa(escopo))) return medidas.map(() => null as DaxValue);
      // `base` é o total do visual — sem linha e sem coluna.
      return medidas.map((m) => valorDoCampo(m, escopo, ev, onde, base));
    }),
  );

  return ordenaEixosDeData(
    montaSemVazios(
      { dashboard: dash.id, visual: visual.id, chavesDeLinha, chavesDeColuna },
      medidas.map((m) => m.name ?? null),
      eixoLinha.grupos.map((g) => ({ valores: g.valores })),
      eixoColuna.grupos.map((g) => ({ valores: g.valores })),
      celulas,
      [...filtros.map((f) => f.origem), ...having.map((h) => h.origem)],
    ),
  );
}

/**
 * Põe em ordem crescente o eixo cuja primeira chave é data — como o cabeçalho de
 * datas da matriz do Power BI.
 *
 * `agrupar` devolve a ordem de primeira aparição no snapshot. Enquanto a carga era
 * inteira isso coincidia com a ordem do SQL; com a field-agenda incremental (ACHADOS
 * #165) as linhas costuradas entram no fim, e a VISÃO PRODUTIVA passou a abrir com
 * 03/10, 05/10, 07/10, 10/10, 21/10, 06/10, 02/10 (medido em 02/10/2026).
 *
 * Só eixo de DATA: a ordem de um eixo de texto (Sem Ação, Inconclusivo, Improdutivo,
 * Produtivo) é a "classificar por coluna" do modelo, que não foi extraída — ordenar
 * alfabeticamente seria inventar uma. Data tem uma ordem só. BLANK vai para o fim.
 */
function ordenaEixosDeData(m: ValorDeMatriz): ValorDeMatriz {
  const ordemPorData = (eixo: readonly EixoDeMatriz[]): number[] | null => {
    const datas = eixo.map((e) => e.valores[0]);
    if (!datas.some((v) => v instanceof Date)) return null;
    if (!datas.every((v) => v instanceof Date || isBlank(v))) return null;
    const ms = (v: unknown) => (v instanceof Date ? v.getTime() : Number.POSITIVE_INFINITY);
    return eixo.map((_, i) => i).sort((a, b) => ms(datas[a]) - ms(datas[b]) || a - b);
  };

  const oL = ordemPorData(m.linhas);
  const oC = ordemPorData(m.colunas);
  if (!oL && !oC) return m;
  const linhas = oL ?? m.linhas.map((_, i) => i);
  const colunas = oC ?? m.colunas.map((_, j) => j);
  return {
    ...m,
    linhas: linhas.map((i) => m.linhas[i]!),
    colunas: colunas.map((j) => m.colunas[j]!),
    celulas: linhas.map((i) => colunas.map((j) => m.celulas[i]![j]!)),
  };
}

/**
 * Tira as linhas e colunas **inteiramente** vazias.
 *
 * É o comportamento padrão da matriz do Power BI, e sem ele um eixo de datas traria
 * um mês de colunas onde a tela mostra os poucos dias com dado. A propriedade que
 * desliga isso ("mostrar itens sem dados") **não é lida do PBIP** — se algum visual
 * a tiver ligada, esta função tira colunas que a tela mostra. Por isso o resultado
 * carrega quantas foram descartadas: o descarte fica contável em vez de invisível.
 *
 * Uma célula reprovada pelo HAVING conta como vazia aqui, e é assim que o HAVING
 * chega a apagar a linha toda quando nenhuma célula dela passa.
 */
function montaSemVazios(
  ids: { dashboard: string; visual: string; chavesDeLinha: Chave[]; chavesDeColuna: Chave[] },
  medidas: (string | null)[],
  linhas: EixoDeMatriz[],
  colunas: EixoDeMatriz[],
  celulas: DaxValue[][][],
  filtros: string[],
): ValorDeMatriz {
  const temDado = (vs: DaxValue[]): boolean => vs.some((v) => !isBlank(v));
  const linhasVivas = linhas.map((_, i) => celulas[i]!.some(temDado));
  const colunasVivas = colunas.map((_, j) => celulas.some((linha) => temDado(linha[j]!)));

  return {
    ...ids,
    medidas,
    linhas: linhas.filter((_, i) => linhasVivas[i]),
    colunas: colunas.filter((_, j) => colunasVivas[j]),
    celulas: celulas
      .filter((_, i) => linhasVivas[i])
      .map((linha) => linha.filter((_, j) => colunasVivas[j])),
    filtros,
    descartadas: {
      linhas: linhasVivas.filter((v) => !v).length,
      colunas: colunasVivas.filter((v) => !v).length,
    },
  };
}
