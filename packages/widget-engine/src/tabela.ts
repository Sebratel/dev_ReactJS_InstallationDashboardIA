// O conteúdo de um visual `tableEx` — a tabela plana do Power BI.
//
// **A forma medida (06/08/2026): os 29 `tableEx` do relatório têm todos os campos
// em `role: Values`, e nenhum papel de eixo.** Isso não quer dizer que a tabela não
// agrupa. Quer dizer que quem agrupa são os próprios campos: os que **não** trazem
// função de agregação são as chaves, e os que trazem são as células calculadas.
//
// É a semântica do Power BI e ela surpreende quem espera "detalhe": uma tabela com
// três colunas de texto e nenhuma medida mostra as **combinações distintas** das
// três, não uma linha por registro. Tratar isso como listagem crua daria uma tabela
// muito maior que a da tela, com cara de dado a mais em vez de erro.
//
// Dos 195 campos, 163 são coluna crua, 21 agregação, 7 medida, 2 nível de
// hierarquia e 2 aritméticos.

import type { EvalScope, Evaluator } from '../../measure-engine/src/evaluator.ts';
import { DaxEvalError, type DaxValue } from '../../measure-engine/src/value.ts';
import { escopoComFiltros, valorDoCampo } from './card.ts';
import { predicadoDeGrupo, separaFiltros, traduzFiltros } from './filtro.ts';
import { agrupar, chaveDoCampo, type Chave } from './grupos.ts';
import type { CampoSpec, DashboardSpec, VisualSpec } from './spec.ts';

export interface CelulaTabela {
  /** O rótulo da coluna na tela (`displayName` do PBIP). */
  nome: string | null;
  valor: DaxValue;
  /** `true` se a coluna é chave de agrupamento, `false` se é calculada. */
  chave: boolean;
}

export interface ValorDeTabela {
  dashboard: string;
  visual: string;
  /** Os nomes das colunas, na ordem em que a spec as traz. */
  colunas: (string | null)[];
  linhas: CelulaTabela[][];
  /** `origem` de cada `TableFilter` de página e de visual. */
  filtros: string[];
}

/**
 * Separa os campos em chaves e calculados.
 *
 * O critério é ter função de agregação, não o `kind`: `kind: column` **sem**
 * `aggregation` é chave, e é o caso de 163 dos 195 campos. Um campo `aggregation`
 * é sempre calculado, e `measure` também.
 */
export function separaCampos(
  visual: VisualSpec,
  onde: string,
): { chaves: Chave[]; calculados: CampoSpec[] } {
  const campos = visual.fields ?? [];
  const foraDeValues = campos.filter((c) => c.role !== 'Values');
  if (foraDeValues.length > 0) {
    throw new DaxEvalError(
      `${onde}: tabela com campo fora de Values (${[...new Set(foraDeValues.map((c) => c.role))].join(', ')}). ` +
        `Os 29 tableEx do relatório têm tudo em Values; papel de eixo é do pivotTable, ` +
        `que é outra fatia.`,
    );
  }

  const chaves: Chave[] = [];
  const calculados: CampoSpec[] = [];
  for (const c of campos) {
    if (c.kind === 'column' && !c.aggregation) chaves.push(chaveDoCampo(c, onde));
    else calculados.push(c);
  }
  return { chaves, calculados };
}

/**
 * Calcula uma tabela.
 *
 * A ordem das colunas é a da spec, que é a da tela — por isso chaves e calculados
 * são reunidos no fim em vez de saírem separados: uma tabela com a coluna de
 * contagem no meio (e há uma, `agendamento-field`) mostraria as colunas trocadas.
 */
export function calculaTabela(dash: DashboardSpec, visual: VisualSpec, ev: Evaluator): ValorDeTabela {
  const onde = `${dash.id}/${visual.id}`;
  if (visual.type !== 'tableEx') {
    throw new DaxEvalError(`${onde}: não é tableEx, é '${visual.type}'.`);
  }
  const campos = visual.fields ?? [];
  if (campos.length === 0) {
    throw new DaxEvalError(`${onde}: tabela sem campo nenhum.`);
  }

  const { chaves } = separaCampos(visual, onde);

  // **Os dois tipos de filtro entram em momentos diferentes, e a ordem é a regra.**
  // O de linha restringe o que entra na conta e vale **antes** de agrupar; o de
  // grupo (`COUNT(x) > 0`) decide quais grupos sobrevivem e só pode valer **depois**,
  // porque antes de existir grupo não há o que agregar. Trocar a ordem não dá erro:
  // dá outro número.
  const { deLinha, deGrupo } = separaFiltros([...(dash.filters ?? []), ...(visual.filters ?? [])]);
  const filtros = traduzFiltros(deLinha, ev, onde);
  const base = escopoComFiltros(ev, filtros);
  const having = deGrupo.map((f) => predicadoDeGrupo(f, ev, onde));
  const grupos = agrupar(chaves, base, ev, onde).filter((g) => having.every((h) => h.passa(g.escopo)));

  // Qual chave é cada campo, para remontar a ordem da spec sem procurar por nome
  // (dois campos podem ter o mesmo `displayName`; em `agendamento-field` há um `.`).
  const indiceDaChave = new Map<CampoSpec, number>();
  let n = 0;
  for (const c of campos) if (c.kind === 'column' && !c.aggregation) indiceDaChave.set(c, n++);

  const linhas = grupos.map((grupo) =>
    campos.map((campo): CelulaTabela => {
      const i = indiceDaChave.get(campo);
      if (i !== undefined) {
        return { nome: campo.name ?? null, valor: grupo.valores[i]!, chave: true };
      }
      return { nome: campo.name ?? null, valor: valorDoCampo(campo, grupo.escopo, ev, onde), chave: false };
    }),
  );

  return {
    dashboard: dash.id,
    visual: visual.id,
    colunas: campos.map((c) => c.name ?? null),
    linhas,
    filtros: [...filtros.map((f) => f.origem), ...having.map((h) => h.origem)],
  };
}

/** Todos os `tableEx` de um dashboard, na ordem em que a spec os traz. */
export function tabelasDoDashboard(dash: DashboardSpec): VisualSpec[] {
  return (dash.visuals ?? []).filter((v) => v.type === 'tableEx');
}

/** Reexportado para quem monta escopo por fora (teste de cobertura). */
export type { EvalScope };
