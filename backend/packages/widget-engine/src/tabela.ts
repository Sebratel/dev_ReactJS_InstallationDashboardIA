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
import { DaxEvalError, isBlank, type DaxValue } from '../../measure-engine/src/value.ts';
import { escopoComFiltros, valorDoCampo } from './card.ts';
import { predicadoDeGrupo, separaFiltros, traduzFiltros } from './filtro.ts';
import { agrupar, campoAtivo, chaveDoCampo, type Chave } from './grupos.ts';
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
  /**
   * A entidade e a propriedade de origem de cada coluna, na MESMA ordem de `colunas`.
   *
   * É o que falta para um clique numa LINHA da tabela virar filtro — o mesmo papel que
   * `ChaveDoGrafico` (`graficoClique.ts`) já cumpre para o eixo de um gráfico. Campo
   * calculado (medida, agregação, `%`) não tem uma coluna de origem única e sai como
   * `null` nos dois — clicar numa célula dele não filtra nada, e o alvo de clique já
   * descarta entradas sem tabela/coluna.
   *
   * **A agregação também é `null`, embora tenha `entity`/`property`.** O `.` de
   * `agendamento-field` é `COUNT('FIELD AGENDA'[Protocolo])`: devolver a coluna fazia o
   * clique mandar `Protocolo = 1` — a contagem no lugar do protocolo —, e a página
   * inteira caía no guarda de espécie (14/10/2026; 6 tabelas começam assim).
   *
   * `nivel` acompanha a chave de hierarquia de datas: o valor da célula é o do nível
   * (`2026`), não a data, e sem ele o filtro comparava ano com data.
   */
  origemDasColunas: { tabela: string | null; coluna: string | null; nivel: string | null }[];
  /**
   * Coluna que a tela escreve como porcentagem (`0,0529` → `5,3%`). Só em visual NATIVO,
   * quando o campo é medida com formato `%` no catálogo. Nos visuais do PBIP fica tudo
   * `false`: cinco tabelas de lá têm coluna "%" cuja escala nunca foi conferida, e
   * mudá-las aqui seria mexer em número de tela sem paridade.
   */
  percentuais: boolean[];
  linhas: CelulaTabela[][];
  /** `origem` de cada `TableFilter` de página e de visual. */
  filtros: string[];
}

/** A primeira coluna (da esquerda) que tem pelo menos um valor de data. `-1` se nenhuma tiver. */
function indiceDaPrimeiraColunaDeData(linhas: readonly CelulaTabela[][], nColunas: number): number {
  for (let i = 0; i < nColunas; i += 1) {
    if (linhas.some((l) => l[i]!.valor instanceof Date)) return i;
  }
  return -1;
}

/**
 * Ordena pela primeira coluna de data, da mais NOVA para a mais VELHA — a ordem que faz
 * sentido para quem abre uma lista de protocolos (ou qualquer outra tabela plana datada):
 * o registro de hoje no topo, o mais antigo no fim.
 *
 * Sem isto a ordem é a que `agrupar` devolve (essencialmente a ordem de chegada no
 * snapshot), que não é nem crescente nem decrescente de propósito — é só a ordem em que
 * os grupos foram vistos. O clique no cabeçalho da coluna (`Tabela.tsx`) continua livre
 * para trocar; isto é só o estado inicial, antes de qualquer clique.
 *
 * BLANK fica sempre no fim, nos dois lados da comparação — não tem "mais novo" nem "mais
 * velho" que dizer sobre uma data ausente.
 */
function ordenaPorDataPadrao(linhas: CelulaTabela[][], nColunas: number): CelulaTabela[][] {
  const i = indiceDaPrimeiraColunaDeData(linhas, nColunas);
  if (i < 0) return linhas;
  return [...linhas].sort((a, b) => {
    const va = a[i]!.valor;
    const vb = b[i]!.valor;
    if (isBlank(va)) return isBlank(vb) ? 0 : 1;
    if (isBlank(vb)) return -1;
    return (vb as Date).getTime() - (va as Date).getTime();
  });
}

/**
 * Linha de tabela nativa em que nenhuma célula calculada tem valor não entra — é o que
 * o Power BI faz por padrão ("mostrar itens sem dados" desligado). Só vale para visual
 * nativo (`spec.ts`): nos do PBIP, que só têm colunas, a regra nunca foi medida, e
 * aplicá-la ali mudaria contagem de linha em silêncio.
 */
function temAlgumNumero(linha: CelulaTabela[]): boolean {
  return linha.some((c) => !c.chave && !isBlank(c.valor));
}

/** A ordem declarada em `ordem` do visual nativo; BLANK sempre no fim. */
function ordenaNativo(
  linhas: CelulaTabela[][],
  campos: readonly CampoSpec[],
  visual: VisualSpec,
  onde: string,
): CelulaTabela[][] {
  if (!visual.ordem) return linhas;
  const i = campos.findIndex((c) => c.name === visual.ordem!.campo);
  if (i < 0) {
    throw new DaxEvalError(`${onde}: 'ordem' aponta o campo '${visual.ordem.campo}', que a tabela não tem.`);
  }
  const sinal = visual.ordem.desc ? -1 : 1;
  return [...linhas].sort((a, b) => {
    const va = a[i]!.valor;
    const vb = b[i]!.valor;
    if (isBlank(va)) return isBlank(vb) ? 0 : 1;
    if (isBlank(vb)) return -1;
    const ka = va instanceof Date ? va.getTime() : typeof va === 'number' ? va : String(va);
    const kb = vb instanceof Date ? vb.getTime() : typeof vb === 'number' ? vb : String(vb);
    return ka < kb ? -sinal : ka > kb ? sinal : 0;
  });
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
  for (const c of camposAtivos(visual)) {
    if (ehChave(c)) chaves.push(chaveDoCampo(c, onde));
    else calculados.push(c);
  }
  return { chaves, calculados };
}

/**
 * O campo agrupa, em vez de virar célula calculada?
 *
 * `column` e `hierarchy_level` **sem** função de agregação. Uma coluna com
 * `aggregation` é `MIN('T'[C])`, que é um número; sem ela é a coluna, que é chave.
 */
function ehChave(c: CampoSpec): boolean {
  return (c.kind === 'column' || c.kind === 'hierarchy_level') && !c.aggregation;
}

/**
 * Os campos que a tela mostra.
 *
 * Campo inativo não é "não agrupa" — é **não aparece**. Ele é um nível de
 * hierarquia acima do drill corrente, e deixá-lo como coluna criaria uma coluna que
 * a tela não tem. Ver ACHADOS.md #32.
 */
export function camposAtivos(visual: VisualSpec): CampoSpec[] {
  return (visual.fields ?? []).filter(campoAtivo);
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
  if ((visual.fields ?? []).length === 0) {
    throw new DaxEvalError(`${onde}: tabela sem campo nenhum.`);
  }
  const campos = camposAtivos(visual);
  if (campos.length === 0) {
    throw new DaxEvalError(
      `${onde}: todos os ${visual.fields!.length} campos da tabela estão inativos. ` +
        `A tela não mostraria coluna nenhuma, e isso não é uma tabela vazia — é uma ` +
        `leitura errada do estado de drill (ACHADOS.md #32).`,
    );
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
  for (const c of campos) if (ehChave(c)) indiceDaChave.set(c, n++);

  const linhas = grupos.map((grupo) =>
    campos.map((campo): CelulaTabela => {
      const i = indiceDaChave.get(campo);
      if (i !== undefined) {
        return { nome: campo.name ?? null, valor: grupo.valores[i]!, chave: true };
      }
      // `base` é o total do visual: o denominador de um campo `% do total`, que
      // precisa da mesma conta sem o agrupamento da linha.
      const valor = valorDoCampo(campo, grupo.escopo, ev, onde, base);
      return { nome: campo.name ?? null, valor, chave: false };
    }),
  );

  return {
    dashboard: dash.id,
    visual: visual.id,
    colunas: campos.map((c) => c.name ?? null),
    origemDasColunas: campos.map((c) =>
      ehChave(c)
        ? {
            tabela: c.entity,
            coluna: c.property,
            nivel: c.kind === 'hierarchy_level' ? (c.level ?? null) : null,
          }
        : { tabela: null, coluna: null, nivel: null },
    ),
    percentuais: campos.map(
      (c) =>
        visual.origem === 'nativo' &&
        c.kind === 'measure' &&
        (ev.model.measure(c.property ?? '')?.format ?? '').includes('%'),
    ),
    linhas:
      visual.origem === 'nativo'
        ? ordenaNativo(linhas.filter(temAlgumNumero), campos, visual, onde)
        : ordenaPorDataPadrao(linhas, campos.length),
    filtros: [...filtros.map((f) => f.origem), ...having.map((h) => h.origem)],
  };
}

/** Todos os `tableEx` de um dashboard, na ordem em que a spec os traz. */
export function tabelasDoDashboard(dash: DashboardSpec): VisualSpec[] {
  return (dash.visuals ?? []).filter((v) => v.type === 'tableEx');
}

/** Reexportado para quem monta escopo por fora (teste de cobertura). */
export type { EvalScope };
