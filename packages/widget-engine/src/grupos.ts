// O agrupamento de um visual: uma linha por combinação distinta das chaves.
//
// **É a peça que separa um card de todo o resto.** Um card é um número; uma tabela
// ou um gráfico é *um número por grupo*, e o grupo é um contexto de filtro próprio.
// Toda a diferença entre "total geral" e "por equipe" mora aqui.
//
// A regra que dá forma ao arquivo: **o grupo é um filtro, não um recorte de
// linhas.** Poderia ser tentador calcular a agregação sobre as linhas do grupo
// diretamente — seria mais rápido e estaria errado para medida. `[Ticket]` é
// `DIVIDE([Total], [Itens])`, e as duas medidas de dentro precisam enxergar o
// contexto de filtro do grupo, não uma lista de linhas que alguém separou por fora.
// Filtrando, a propagação por relacionamento (2b.5) também vem de graça: agrupar
// por `'CALENDARIO INSTALADO'[MÊS]` restringe `PROTOCOLOS GERAL` sem que este
// arquivo saiba que existe relacionamento.

import { normalizeName as normaliza } from '../../semantic-model/src/model.ts';
import {
  NIVEIS_DE_HIERARQUIA,
  projecaoDeHierarquia,
  type EvalScope,
  type Evaluator,
} from '../../measure-engine/src/evaluator.ts';
import type { TableFilter } from '../../measure-engine/src/filter.ts';
import type { Row } from '../../measure-engine/src/dataset.ts';
import { BLANK, DaxEvalError, isBlank, type DaxValue, identityKey } from '../../measure-engine/src/value.ts';
import { Navegador, caminhoAte, escolheAncora, type Aresta } from './expansao.ts';
import type { CampoSpec } from './spec.ts';

/** Uma coluna por que o visual agrupa. */
export interface Chave {
  tabela: string;
  coluna: string;
  /**
   * Nível da hierarquia de datas, quando a chave é `'T'[Data].[Mês]` em vez de
   * `'T'[Data]`. `null` é o caso comum — a coluna crua.
   */
  nivel: string | null;
  /** O rótulo que o visual dá a ela na tela. */
  nome: string | null;
}

/**
 * O valor de uma chave numa linha.
 *
 * Para coluna crua é o valor da célula; para nível de hierarquia é a **projeção**
 * do nível sobre a data. `BLANK` fica `BLANK` em vez de virar mês nenhum: uma
 * linha sem data não pertence a janeiro.
 */
export function valorDaChave(chave: Chave, linha: Row, ev: Evaluator, onde: string): DaxValue {
  return projetaNivel(chave, ev.columnValue(chave.tabela, chave.coluna, linha), onde);
}

/**
 * Aplica o nível da hierarquia a um valor **já lido** da coluna.
 *
 * Existe separado porque no agrupamento entre tabelas o valor não vem da linha
 * corrente: vem de outra tabela, seguindo o relacionamento. A projeção é a mesma
 * dos dois lados, e uma cópia dela é uma segunda resposta possível para `março`.
 */
export function projetaNivel(chave: Chave, v: DaxValue, onde: string): DaxValue {
  if (!chave.nivel) return v;
  if (isBlank(v)) return BLANK;
  if (!(v instanceof Date)) {
    throw new DaxEvalError(
      `${onde}: nível .[${chave.nivel}] exige coluna de data, e ` +
        `'${chave.tabela}'[${chave.coluna}] trouxe ${JSON.stringify(v)}.`,
    );
  }
  return projecaoDeHierarquia(chave.nivel)!(v);
}

export interface Grupo {
  /** O valor de cada chave, na ordem em que as chaves foram pedidas. */
  valores: DaxValue[];
  /** Escopo com o grupo aplicado como filtro e o agrupamento declarado. */
  escopo: EvalScope;
}

/**
 * O campo está **em jogo** no visual?
 *
 * `active: false` é o nível de hierarquia que a tela não mostra — o `Dia` de um
 * gráfico que está exibindo por mês. Agrupar por ele daria um ponto por dia num
 * gráfico que tem um ponto por mês: muitos pontos a mais, e nenhum erro.
 *
 * `null` (302 das 448 projeções) é poço de um campo só, onde a pergunta de drill
 * não se coloca — conta como em jogo. A distinção entre `null` e `true` existe na
 * spec para **não afirmar** um estado que o PBIP não declarou; aqui os dois levam
 * ao mesmo lugar, e é só aqui que isso é decidido.
 */
export function campoAtivo(campo: CampoSpec): boolean {
  return campo.active !== false;
}

/**
 * As chaves de um campo de visual.
 *
 * Aceita `column` e `hierarchy_level`. O segundo (`'T'[Data].[Mês]`) não é coluna
 * da tabela: é uma projeção da coluna de data, e é o eixo de 10 dos 16 gráficos.
 * Ele entra em escopo sob chave própria, **não** sob a da coluna base — ver o
 * comentário de `scopeWithGrouping`.
 */
export function chaveDoCampo(campo: CampoSpec, onde: string): Chave {
  if (campo.kind !== 'column' && campo.kind !== 'hierarchy_level') {
    throw new DaxEvalError(
      `${onde}: campo de tipo '${campo.kind}' não é chave de agrupamento. ` +
        `Agrupam 'column' e 'hierarchy_level'.`,
    );
  }
  if (!campo.entity || !campo.property) {
    throw new DaxEvalError(
      `${onde}: chave sem tabela ou coluna (entity=${JSON.stringify(campo.entity)}, ` +
        `property=${JSON.stringify(campo.property)}).`,
    );
  }
  if (campo.kind === 'column') {
    return { tabela: campo.entity, coluna: campo.property, nivel: null, nome: campo.name ?? null };
  }

  if (!campo.level) {
    throw new DaxEvalError(
      `${onde}: nível de hierarquia sem nome do nível em ` +
        `'${campo.entity}'[${campo.property}]. Sem ele não dá para saber se o eixo é ` +
        `por ano ou por dia — e a diferença é de 365 vezes no número de pontos.`,
    );
  }
  if (!projecaoDeHierarquia(campo.level)) {
    throw new DaxEvalError(
      `${onde}: nível de hierarquia de datas não suportado: ` +
        `'${campo.entity}'[${campo.property}].[${campo.level}]. ` +
        `Suportados: ${NIVEIS_DE_HIERARQUIA.join(', ')}.`,
    );
  }
  return {
    tabela: campo.entity,
    coluna: campo.property,
    nivel: campo.level,
    nome: campo.name ?? null,
  };
}

/**
 * Agrupa: uma entrada por combinação distinta de valores das chaves.
 *
 * **As combinações saem de varrer uma tabela só — a âncora.** Com as chaves numa
 * tabela só, é ela mesma. Com chaves de tabelas diferentes, é aquela cuja *tabela
 * expandida* cobre as outras: varrê-la seguindo os relacionamentos dá exatamente as
 * combinações que existem, uma vez cada (ver `expansao.ts`). O produto cartesiano
 * criaria linhas que a tela não mostra; varrer uma sem seguir o caminho perderia as
 * colunas das outras.
 *
 * A ordem das combinações é a de **primeira aparição** nas linhas visíveis, não
 * ordenada: a ordenação de um visual é propriedade dele (`Table.Sort` do PBIP),
 * e inventar uma aqui esconderia que ela ainda não foi lida.
 */
export function agrupar(chaves: readonly Chave[], base: EvalScope, ev: Evaluator, onde: string): Grupo[] {
  return prepara(chaves, base, ev, onde).grupos;
}

/**
 * O agrupamento com a **construção de filtro exposta**.
 *
 * `agrupar` basta para tabela e gráfico, onde cada linha é uma combinação e pronto.
 * A matriz precisa de mais: os dois eixos são agrupados **em separado** (as colunas
 * da matriz são as mesmas em todas as linhas), e cada célula é o cruzamento de uma
 * combinação de linha com uma de coluna. Cruzar exige os filtros dos dois lados
 * juntos, num `with()` único — daí `filtrosDe`.
 */
export interface Agrupamento {
  grupos: Grupo[];
  /** Os `TableFilter` que definem uma combinação de valores destas chaves. */
  filtrosDe: (valores: readonly DaxValue[]) => TableFilter[];
  /** As chaves, no formato que `scopeWithGrouping` espera. */
  declaracao: [string, string, string | null][];
}

export function prepara(
  chaves: readonly Chave[],
  base: EvalScope,
  ev: Evaluator,
  onde: string,
): Agrupamento {
  const declaracao: [string, string, string | null][] = chaves.map((c) => [
    c.tabela,
    c.coluna,
    c.nivel,
  ]);

  if (chaves.length === 0) {
    // Sem chave é o total: um grupo só, sem filtro, e `ISINSCOPE` responde FALSE
    // para tudo. É o caso que faz `[Faixa 1 Premiação Total]` calcular.
    return {
      grupos: [{ valores: [], escopo: ev.scopeWithGrouping(base, []) }],
      filtrosDe: () => [],
      declaracao,
    };
  }

  const plano = planeja(chaves, base, ev, onde);
  const combinacoes = enumeraCombinacoes(chaves, plano, base, ev, onde);

  // Todos os filtros do grupo num `with()` único — pelo mesmo motivo que os filtros
  // de página e visual: dentro de um `with()` os novos não se substituem entre si.
  // Em chamadas separadas, a segunda chave apagaria a primeira e o "grupo" seria
  // mais largo do que é.
  const filtrosDe = (valores: readonly DaxValue[]): TableFilter[] =>
    chaves.flatMap((c, i) => filtrosDaChave(c, valores[i]!, i, plano, base, ev, onde));

  const grupos = [...combinacoes.values()].map((valores) => {
    const comFiltro = ev.scopeWithFilter(base, base.filter.with(filtrosDe(valores)));
    return { valores, escopo: ev.scopeWithGrouping(comFiltro, declaracao) };
  });

  return { grupos, filtrosDe, declaracao };
}

/** Como as combinações vão ser enumeradas. `null` = todas as chaves numa tabela só. */
interface Plano {
  ancora: string;
  navegador: Navegador;
  /** Um caminho por chave, na ordem das chaves. Vazio quando a chave é da âncora. */
  caminhos: Aresta[][];
}

/**
 * Resolve âncora e caminhos **uma vez**: eles dependem das tabelas, não da linha.
 *
 * Devolve `null` quando todas as chaves são da mesma tabela — o caso comum, que não
 * precisa de expansão nenhuma.
 */
function planeja(
  chaves: readonly Chave[],
  base: EvalScope,
  ev: Evaluator,
  onde: string,
): Plano | null {
  const tabelas = [...new Map(chaves.map((c) => [normaliza(c.tabela), c.tabela])).values()];
  if (tabelas.length === 1) return null;
  const ancora = escolheAncora(tabelas, ev.model, onde);
  return {
    ancora,
    navegador: new Navegador(ev, base),
    caminhos: chaves.map((c) => caminhoAte(ev.model, ancora, c.tabela, onde)),
  };
}

/**
 * Os filtros que definem o grupo para uma chave.
 *
 * Para chave da própria tabela varrida, um filtro sobre a coluna, e pronto.
 *
 * **Para chave de outra tabela com valor em branco, o filtro tem de ser sobre a
 * âncora.** Filtrar `'EQUIPES'[REGIAO] = BLANK` não seleciona nada: não existe
 * linha de EQUIPES com região em branco — o branco é o que a *linha de OS* enxerga
 * quando a chave estrangeira não casa. O DAX resolve isso com a "linha em branco"
 * que todo relacionamento ganha; aqui ela não existe, e filtrar a dimensão
 * esvaziaria o grupo inteiro. O número sairia BLANK onde a tela mostra 500.
 *
 * `columns` é a coluna **base** mesmo quando a chave é um nível de hierarquia: é ela
 * que o filtro restringe, e é ela que um `CALCULATE(..., 'T'[DATA] = x)` de dentro
 * de uma medida deve sobrepor. Fosse a chave do nível, o filtro do eixo sobreviveria
 * ao CALCULATE e o número sairia menor sem dizer por quê.
 */
function filtrosDaChave(
  c: Chave,
  valor: DaxValue,
  i: number,
  plano: Plano | null,
  base: EvalScope,
  ev: Evaluator,
  onde: string,
): TableFilter[] {
  const alvo = identityKey(valor);
  const rotulo = `'${c.tabela}'[${c.coluna}]${c.nivel ? `.[${c.nivel}]` : ''}`;

  const remota = plano !== null && normaliza(c.tabela) !== normaliza(plano.ancora);
  if (remota && isBlank(valor)) {
    const caminho = plano.caminhos[i]!;
    return [{
      table: normaliza(plano.ancora),
      // Nenhuma coluna declarada: este filtro não é sobre uma coluna da âncora, é
      // sobre *para onde a linha aponta*. Declarar coluna faria um CALCULATE sobre
      // ela derrubar o grupo inteiro.
      columns: new Set<string>(),
      origem: `${onde}: grupo ${rotulo} em branco (linha sem correspondência)`,
      keep: (row: Row) => plano.navegador.segue(caminho, row) === null,
    }];
  }

  return [{
    table: normaliza(c.tabela),
    columns: new Set([normaliza(c.coluna)]),
    origem: `${onde}: grupo ${rotulo}`,
    keep: (row: Row) => identityKey(valorDaChave(c, row, ev, onde)) === alvo,
  }];
}

/**
 * As combinações distintas das chaves, na ordem de primeira aparição.
 *
 * Uma tabela só é o caso comum e barato: varre as linhas visíveis e lê as colunas.
 * Mais de uma exige a **âncora** e o caminho até cada tabela — e o caminho é
 * percorrido por linha, não uma vez, porque cada linha da âncora aponta para uma
 * linha diferente da dimensão.
 */
function enumeraCombinacoes(
  chaves: readonly Chave[],
  plano: Plano | null,
  base: EvalScope,
  ev: Evaluator,
  onde: string,
): Map<string, DaxValue[]> {
  const combinacoes = new Map<string, DaxValue[]>();
  const guarda = (valores: DaxValue[]): void => {
    const k = valores.map(identityKey).join(' ');
    if (!combinacoes.has(k)) combinacoes.set(k, valores);
  };

  if (plano === null) {
    for (const linha of base.filter.rowsOf(chaves[0]!.tabela)) {
      guarda(chaves.map((c) => valorDaChave(c, linha, ev, onde)));
    }
    return combinacoes;
  }

  for (const linha of base.filter.rowsOf(plano.ancora)) {
    guarda(
      chaves.map((c, i) =>
        projetaNivel(c, plano.navegador.valor(plano.caminhos[i]!, linha, c.tabela, c.coluna), onde),
      ),
    );
  }
  return combinacoes;
}
