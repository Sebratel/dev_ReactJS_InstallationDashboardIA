// O conteúdo de um gráfico: um valor por série, por ponto do eixo.
//
// **A forma medida (07/08/2026).** São 16 gráficos em 8 tipos de visual
// (`lineStackedColumnComboChart` 6, `columnChart` 3, `clusteredBarChart` 2,
// `lineChart` 2, e um de cada de `barChart`, `clusteredColumnChart`,
// `hundredPercentStackedColumnChart`). Os papéis são exatamente quatro: `Category`
// e `Series` agrupam, `Y` e `Y2` são os valores. Nenhum outro papel aparece — e é
// por isso que qualquer outro erra alto em vez de ser ignorado: um papel novo é uma
// dimensão que o gráfico ganhou no Power BI, e ignorá-la daria menos pontos do que
// a tela tem.
//
// **Por que um gráfico é a mesma máquina que uma tabela.** Um ponto de gráfico é
// uma linha de tabela desenhada: mesmo agrupamento, mesmo contexto de filtro, mesma
// ordem de filtros. A diferença é só de arrumação — a tabela põe chaves e valores
// lado a lado, o gráfico separa o eixo das séries. Por isso `agrupar` é
// compartilhado e este arquivo não recalcula nada.
//
// **O eixo de datas.** 10 dos 16 agrupam por `[Data].[Ano]`, `.[Mês]` e `.[Dia]`,
// que é a hierarquia automática de datas. Os três níveis vêm sempre juntos na spec;
// quem diz quais estão na tela é o `active` (ACHADOS.md #32). Aqui isso já chega
// resolvido: os inativos não são chave, não são ponto, não existem.

import type { EvalScope, Evaluator } from '../../measure-engine/src/evaluator.ts';
import { DaxEvalError, type DaxValue } from '../../measure-engine/src/value.ts';
import { escopoComFiltros, valorDoCampo } from './card.ts';
import { predicadoDeGrupo, separaFiltros, traduzFiltros } from './filtro.ts';
import { agrupar, campoAtivo, chaveDoCampo, type Chave } from './grupos.ts';
import type { CampoSpec, DashboardSpec, FiltroSpec, VisualSpec } from './spec.ts';

/** Papéis que agrupam. `Series` é a segunda dimensão (a legenda). */
const PAPEIS_DE_CHAVE = ['Category', 'Series'] as const;
/** Papéis que viram número. `Y2` é o eixo secundário do combo. */
const PAPEIS_DE_VALOR = ['Y', 'Y2'] as const;

export interface SerieDeGrafico {
  nome: string | null;
  /** `Y` é o eixo principal, `Y2` o secundário — a escala é outra. */
  papel: string;
}

export interface ChaveDeGrafico extends Chave {
  /** `Category` (eixo) ou `Series` (legenda). */
  papel: string;
}

export interface PontoDeGrafico {
  /** O valor de cada chave, na ordem de `chaves`. */
  categoria: DaxValue[];
  /** O valor de cada série, na ordem de `series`. */
  valores: DaxValue[];
}

export interface ValorDeGrafico {
  dashboard: string;
  visual: string;
  /** O tipo de visual do PBIP — é ele que decide barra, linha ou combo. */
  tipo: string;
  chaves: ChaveDeGrafico[];
  series: SerieDeGrafico[];
  pontos: PontoDeGrafico[];
  /** `origem` de cada filtro aplicado, de linha e de grupo. */
  filtros: string[];
}

/** Os tipos de visual que este arquivo calcula. Medido, não deduzido do nome. */
export const TIPOS_DE_GRAFICO: readonly string[] = [
  'barChart',
  'clusteredBarChart',
  'clusteredColumnChart',
  'columnChart',
  'hundredPercentStackedColumnChart',
  'lineChart',
  'lineStackedColumnComboChart',
];

/** Todos os gráficos de um dashboard, na ordem em que a spec os traz. */
export function graficosDoDashboard(dash: DashboardSpec): VisualSpec[] {
  return (dash.visuals ?? []).filter((v) => TIPOS_DE_GRAFICO.includes(v.type));
}

/**
 * Separa os campos ativos do gráfico em chaves e séries.
 *
 * Diferente da tabela, aqui o critério é o **papel**, não a presença de agregação:
 * num gráfico o eixo e o valor são poços distintos do visual, e o PBIP já os
 * separou. Um campo de `Category` com agregação seria um eixo que agrega — coisa
 * que nenhum dos 16 tem, e que erra alto se aparecer.
 */
export function separaPapeis(
  visual: VisualSpec,
  onde: string,
): { chaves: ChaveDeGrafico[]; series: { campo: CampoSpec; serie: SerieDeGrafico }[] } {
  const campos = (visual.fields ?? []).filter(campoAtivo);
  const chaves: ChaveDeGrafico[] = [];
  const series: { campo: CampoSpec; serie: SerieDeGrafico }[] = [];

  for (const campo of campos) {
    if ((PAPEIS_DE_CHAVE as readonly string[]).includes(campo.role)) {
      if (campo.aggregation) {
        throw new DaxEvalError(
          `${onde}: campo de ${campo.role} com agregação '${campo.aggregation}' em ` +
            `'${campo.entity}'[${campo.property}]. Eixo não agrega — nos 16 gráficos ` +
            `do relatório nenhum faz isso, e tratar como eixo perderia a agregação.`,
        );
      }
      chaves.push({ ...chaveDoCampo(campo, onde), papel: campo.role });
    } else if ((PAPEIS_DE_VALOR as readonly string[]).includes(campo.role)) {
      series.push({ campo, serie: { nome: campo.name ?? null, papel: campo.role } });
    } else {
      throw new DaxEvalError(
        `${onde}: papel '${campo.role}' não é eixo nem valor de gráfico. ` +
          `Os 16 gráficos do relatório usam ${[...PAPEIS_DE_CHAVE, ...PAPEIS_DE_VALOR].join(', ')}. ` +
          `Um papel novo é uma dimensão a mais no visual, e ignorá-lo daria menos ` +
          `pontos do que a tela mostra.`,
      );
    }
  }
  return { chaves, series };
}

/**
 * A identidade de um campo (entidade + propriedade), para casar filtro com field.
 *
 * `JSON.stringify` e não um separador cru pela mesma razão de `chaveDeCampo` em
 * `apps/web/src/rota.ts`: nome de tabela e coluna desta base trazem espaço e
 * acento (`PROTOCOLOS GERAL`, `TÉCNICO 2`), e um separador que apareça dentro do
 * próprio valor quebraria a chave em silêncio.
 */
function chaveDeEntidadeEPropriedade(entity: string, property: string): string {
  return JSON.stringify([entity, property]);
}

/**
 * Os filtros do visual, sem os que travam um campo que a tela não mostra.
 *
 * **O caso que expôs isto (09/09/2026).** "Total por Instalador Referência"
 * (`visao-geral/7db40203ca467b8165c6`) tem `TÉCNICO 1` ativo no eixo e `TÉCNICO 2`
 * — um segundo instalador, presente em pouquíssimos protocolos — como `Category`
 * **inativo** (`active: false`, ACHADOS.md #32: nível de hierarquia que a tela
 * não mostra). O PBIP também traz um filtro `not_in [null]` para CADA um dos
 * dois campos do poço, inclusive o inativo. Aplicando os dois sempre, todo
 * protocolo com `TÉCNICO 2` em branco — quase todos — saía do cálculo, e o
 * gráfico ficava vazio (`pontos: []`) mesmo com dado de sobra para `TÉCNICO 1`.
 * Confirmado ao vivo contra o relatório original: ele mostra a lista cheia.
 *
 * `camposAtivos`/`ehChave` já resolvem o equivalente em `tabela.ts` para CHAVE de
 * agrupamento — um campo inativo não vira coluna nem agrupa. Esta função é a
 * mesma regra para FILTRO: um filtro cujo alvo só existe em campos inativos do
 * visual não é a escolha de quem está olhando a tela agora, e aplicá-lo é a
 * mesma classe de erro.
 *
 * **Só filtro de VISUAL passa por aqui.** Filtro de PÁGINA (`dash.filters`) não
 * nasce de um campo deste visual — não tem "ativo" para checar, e continua
 * intocado.
 */
export function semFiltroDeCampoInativo(
  filtros: readonly FiltroSpec[],
  visual: VisualSpec,
): FiltroSpec[] {
  const campos = visual.fields ?? [];
  const comAtivo = new Set<string>();
  const comInativo = new Set<string>();
  for (const c of campos) {
    if (!c.entity || !c.property) continue;
    (campoAtivo(c) ? comAtivo : comInativo).add(chaveDeEntidadeEPropriedade(c.entity, c.property));
  }
  if (comInativo.size === 0) return [...filtros];

  return filtros.filter((f) => {
    if (!f.entity || !f.property) return true;
    const chave = chaveDeEntidadeEPropriedade(f.entity, f.property);
    return !comInativo.has(chave) || comAtivo.has(chave);
  });
}

/**
 * Calcula um gráfico.
 *
 * A ordem dos filtros é a mesma da tabela e pelo mesmo motivo: o de linha decide o
 * que entra na conta e vale antes de agrupar; o de grupo (`COUNT(x) > 0`) decide
 * quais pontos sobrevivem e só pode valer depois. Dois dos 16 têm HAVING.
 */
export function calculaGrafico(
  dash: DashboardSpec,
  visual: VisualSpec,
  ev: Evaluator,
): ValorDeGrafico {
  const onde = `${dash.id}/${visual.id}`;
  if (!TIPOS_DE_GRAFICO.includes(visual.type)) {
    throw new DaxEvalError(
      `${onde}: não é gráfico, é '${visual.type}'. ` +
        `Calculáveis: ${TIPOS_DE_GRAFICO.join(', ')}.`,
    );
  }
  if ((visual.fields ?? []).length === 0) {
    throw new DaxEvalError(`${onde}: gráfico sem campo nenhum.`);
  }

  const { chaves, series } = separaPapeis(visual, onde);
  if (series.length === 0) {
    throw new DaxEvalError(
      `${onde}: gráfico sem nenhum campo em Y ou Y2 — não há o que desenhar. ` +
        `Dos ${visual.fields!.length} campos, ${(visual.fields ?? []).filter((c) => !campoAtivo(c)).length} ` +
        `estão inativos (ACHADOS.md #32).`,
    );
  }

  const { deLinha, deGrupo } = separaFiltros([
    ...(dash.filters ?? []),
    ...semFiltroDeCampoInativo(visual.filters ?? [], visual),
  ]);
  const filtros = traduzFiltros(deLinha, ev, onde);
  const base = escopoComFiltros(ev, filtros);
  const having = deGrupo.map((f) => predicadoDeGrupo(f, ev, onde));
  // **As tabelas de onde saem os números.** Só importam quando as chaves são
  // dimensões que não se alcançam: aí o fato que as liga é o que produz os valores,
  // e não uma tabela qualquer do modelo. Ver `escolheAncora`.
  const tabelasDosValores = series.map((s) => s.campo.entity).filter((t): t is string => !!t);
  const grupos = agrupar(chaves, base, ev, onde, tabelasDosValores).filter((g) =>
    having.every((h) => h.passa(g.escopo)),
  );

  const pontos = grupos.map((grupo): PontoDeGrafico => ({
    categoria: grupo.valores,
    valores: series.map(({ campo }) => valorDoCampo(campo, grupo.escopo, ev, onde, base)),
  }));

  return {
    dashboard: dash.id,
    visual: visual.id,
    tipo: visual.type,
    chaves,
    series: series.map((s) => s.serie),
    pontos,
    filtros: [...filtros.map((f) => f.origem), ...having.map((h) => h.origem)],
  };
}

/** Reexportado para quem monta escopo por fora (teste de cobertura). */
export type { EvalScope };
