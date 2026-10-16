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
import type { Materializacao, TableFilter } from '../../measure-engine/src/filter.ts';
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
  return leitorDaChave(chave, ev, onde)(linha);
}

/**
 * O mesmo que `leitorDaChave`, mas entregando a CHAVE DE IDENTIDADE.
 *
 * Para chave crua (o caso comum — sem nível) isto é `Evaluator.leitorDeIdentidade`
 * direto, e aí a chave sai do dicionário da coluna sem tocar no valor. Com nível há
 * projeção pelo meio, que é função do VALOR e não do id, então o caminho é o de
 * sempre.
 */
export function leitorDeIdentidadeDaChave(
  chave: Chave,
  ev: Evaluator,
  onde: string,
): (linha: Row) => string {
  if (!chave.nivel) return ev.leitorDeIdentidade(chave.tabela, chave.coluna);
  const ler = leitorDaChave(chave, ev, onde);
  return (linha: Row): string => identityKey(ler(linha));
}

/**
 * Um leitor de UMA chave, para quem vai aplicá-la a muitas linhas.
 *
 * `valorDaChave` normaliza o nome da tabela e o da coluna a cada célula, e os dois
 * laços que mais a chamam têm a chave FIXA: o `keep` de um filtro de grupo (uma
 * linha por vez, a tabela inteira) e a enumeração de combinações do eixo. Esta
 * fábrica tira a normalização de dentro deles; ver `Evaluator.leitorDeColuna`.
 *
 * Perfilado em 14/09/2026 na página `instalacao-reincidente` — a mais cara das 14,
 * e 74% dela num só visual de tabela que cruza três entidades: `normalizeName`
 * custava 483 ms, dos quais **423 ms vinham de `columnValue` por baixo daqui**.
 *
 * `valorDaChave` continua existindo e agora passa por aqui. Para uma leitura só o
 * fecho é desperdício, mas é desperdício de uma alocação — e ter dois corpos de
 * projeção de nível seria uma segunda resposta possível para `março`, que é
 * exatamente o que o comentário de `projetaNivel` existe para impedir.
 */
export function leitorDaChave(
  chave: Chave,
  ev: Evaluator,
  onde: string,
): (linha: Row) => DaxValue {
  const ler = ev.leitorDeColuna(chave.tabela, chave.coluna);
  // Coluna crua é o caso comum: sem nível, não há projeção a aplicar, e o leitor
  // da coluna já é a resposta inteira.
  if (!chave.nivel) return ler;
  return (linha: Row): DaxValue => projetaNivel(chave, ler(linha), onde);
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
export function agrupar(
  chaves: readonly Chave[],
  base: EvalScope,
  ev: Evaluator,
  onde: string,
  tabelasDosValores: readonly string[] = [],
): Grupo[] {
  return prepara(chaves, base, ev, onde, tabelasDosValores).grupos;
}

/**
 * Só os VALORES das combinações distintas, na mesma ordem de `agrupar` — sem escopo.
 *
 * **Existe para a tabela que só tem chaves** (`tabela.ts`). Ali ninguém lê o escopo do
 * grupo: sem célula calculada e sem filtro de grupo, a linha é a própria combinação.
 * Montá-lo mesmo assim custava, por grupo, um filtro por chave, o carimbo de
 * materialização e dois escopos novos — na tabela de detalhe da `visao-geral` (99.447
 * grupos × 23 chaves, 16/10/2026) era isso que levava o cálculo a ~1 GB de heap. As
 * linhas de cada combinação também não são guardadas: só serviam à materialização.
 *
 * A enumeração é a MESMA de `agrupar` (`planeja` + `enumeraCombinacoes`), então a
 * distinção e a ordem de primeira aparição não podem divergir entre os dois caminhos.
 */
export function combinacoesDistintas(
  chaves: readonly Chave[],
  base: EvalScope,
  ev: Evaluator,
  onde: string,
): DaxValue[][] {
  if (chaves.length === 0) return [[]];
  const plano = planeja(chaves, base, ev, onde, []);
  return enumeraCombinacoes(chaves, plano, base, ev, onde, false).lista.map((c) => c.valores);
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
  tabelasDosValores: readonly string[] = [],
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

  const plano = planeja(chaves, base, ev, onde, tabelasDosValores);
  const combinacoes = enumeraCombinacoes(chaves, plano, base, ev, onde);
  // A tabela que a varredura percorreu — é dela que as linhas materializadas são.
  const ancora = normaliza(plano?.ancora ?? chaves[0]!.tabela);

  // Todos os filtros do grupo num `with()` único — pelo mesmo motivo que os filtros
  // de página e visual: dentro de um `with()` os novos não se substituem entre si.
  // Em chamadas separadas, a segunda chave apagaria a primeira e o "grupo" seria
  // mais largo do que é.
  //
  // **E todos levam o mesmo carimbo de materialização.** A varredura que descobriu
  // as combinações já separou as linhas de cada uma; entregá-las junto poupa o
  // contexto de filtro de revarrer a tabela a cada grupo (ACHADOS #38). O carimbo é
  // do grupo inteiro, não de um filtro: se `ALL()` derrubar qualquer um deles, as
  // linhas deixam de valer e o contexto volta ao predicado exato.
  // Uma vez por CHAVE, fora do laço das combinações: `filtrosDe` roda uma vez por
  // combinação do eixo (numa matriz, uma por célula) e as chaves são as mesmas em
  // todas elas. Ver `preparaChave`.
  const preparos = chaves.map((c) =>
    preparaChave(c, plano ? normaliza(plano.ancora) : null, onde),
  );
  // A busca por texto, montada só se alguém pedir uma combinação por um array que não
  // é o dela.
  let indicePorChave: Map<string, Combinacao> | null = null;
  const porChave = (): Map<string, Combinacao> =>
    (indicePorChave ??= new Map(combinacoes.lista.map((c) => [chaveDeValores(c.valores), c])));

  const filtrosDe = (valores: readonly DaxValue[]): TableFilter[] => {
    // A chave de identidade de cada valor tem DOIS consumidores aqui — o filtro de
    // cada chave, que compara com ela, e a busca da combinação, que as concatena —
    // e era calculada uma vez para cada um. Medido em 14/09/2026 nas 14 páginas,
    // `identityKey` gastava 666 ms chamada de `filtrosDaChave` e mais 507 ms de
    // `chaveDeValores`, sobre exatamente os mesmos valores.
    //
    // ⚠ **Não tente memoizar este `map` pela identidade do array `valores`.**
    // `Grupo.valores` É o mesmo objeto que `Combinacao.valores`, nunca copiado, então
    // a identidade é de fato estável ao longo do laço da matriz — e é exatamente por
    // isso que a ideia ocorre a quem passa por aqui. Ela já foi tentada em quatro
    // variantes e medida em 15/09/2026: [ACHADOS](../../../docs/ACHADOS.md) **#109,
    // RESULTADO NEGATIVO**. A melhor delas semeava o memo no nascimento da combinação
    // e chegou a **100,0% de acerto** — e mesmo assim o A/B sobre 11 pares deu 6 a 5.
    // Um cara ou coroa. O motivo: `identityKey` já é um `Map.get` no caso comum, e
    // trocá-lo por um `WeakMap.get` mais duas leituras de propriedade é trocar hash
    // por hash. O achado fecha com *"ninguém precisa tentar isto de novo"*.
    const alvos = valores.map(identityKey);
    const filtros = chaves.flatMap((c, i) =>
      filtrosDaChave(c, preparos[i]!, valores[i]!, alvos[i]!, i, plano, base, ev, onde),
    );
    // **Pela identidade do array, e isso NÃO é o #109.** Lá a troca era `identityKey`
    // (um `Map.get`) por um `WeakMap.get` — hash por hash. Aqui é a chave da combinação
    // inteira: juntar as N identidades numa string nova e calcular o hash dela, que nas
    // tabelas de relato tem o tamanho do texto do relato, por grupo (#179). Quem passa
    // um array que não veio de `grupos` (nenhum chamador hoje) cai na busca por texto.
    const combinacao =
      combinacoes.porValores.get(valores) ?? porChave().get(alvos.join(SEPARADOR_DE_CHAVE));
    if (!combinacao || filtros.length === 0) return filtros;
    combinacao.materializacao ??= {
      marca: {},
      filtros: filtros.length,
      tabela: ancora,
      linhas: combinacao.linhas,
    };
    const grupo = combinacao.materializacao;
    // Guarda para o caso de um chamador montar um número diferente de filtros para a
    // mesma combinação: aí o carimbo mentiria sobre quantos esperar, e a conferência
    // de validade do contexto passaria quando não devia.
    if (grupo.filtros !== filtros.length) return filtros;
    return filtros.map((f) => ({ ...f, grupo }));
  };

  const grupos = combinacoes.lista.map(({ valores }) => {
    const comFiltro = ev.scopeWithFilter(base, base.filter.with(filtrosDe(valores)));
    return { valores, escopo: ev.scopeWithGrouping(comFiltro, declaracao) };
  });

  return { grupos, filtrosDe, declaracao };
}

/** Uma combinação de valores e as linhas da âncora que caem nela. */
interface Combinacao {
  valores: DaxValue[];
  linhas: Row[];
  /** Criada na primeira vez que os filtros do grupo são montados, e reusada. */
  materializacao: Materializacao | null;
}

/** As combinações de um agrupamento, e os dois jeitos de achar uma delas. */
interface Combinacoes {
  /** Na ordem de primeira aparição. O índice é o número dado por `NumeradorDeCombinacoes`. */
  lista: Combinacao[];
  /**
   * A combinação pelo array `valores` dela. É o caminho de `filtrosDe`: quem a chama
   * passa `Grupo.valores`, que É `Combinacao.valores`, nunca copiado.
   */
  porValores: Map<readonly DaxValue[], Combinacao>;
}

/**
 * Dá a cada combinação de chaves um número **denso, na ordem de primeira aparição** —
 * sem montar a chave de texto da combinação.
 *
 * **Por que existe (ACHADOS #179).** As tabelas de relato da `agendamento-field` agrupam
 * a FIELD AGENDA inteira (~620 mil linhas) por 6 a 12 colunas, uma delas o texto livre
 * do relato, e saem com 130 a 145 mil grupos. Concatenar as identidades criava, por
 * linha, uma string nova do tamanho do relato, e o `Map` a achatava e calculava o hash
 * dela inteira — metade do tempo da tabela.
 *
 * Aqui cada identidade vira um inteiro (`interna`, um mapa por chave; quem lê do
 * dicionário colunar nem passa por ele mais de uma vez por código, ver
 * `leitorDeNumeroDaChave`), e cada par (combinação até aqui, inteiro da chave seguinte)
 * vira o número da combinação maior numa `TabelaDePares`.
 *
 * Duas linhas recebem o mesmo número **se e só se** as identidades são iguais chave a
 * chave — a mesma regra de `chaveDeValores`, que `grupos-chave.test.ts` confere.
 */
export class NumeradorDeCombinacoes {
  private readonly ids: Map<string, number>[];
  private readonly pares: TabelaDePares[];

  constructor(chaves: number) {
    this.ids = Array.from({ length: chaves }, () => new Map<string, number>());
    this.pares = Array.from({ length: chaves }, () => new TabelaDePares());
  }

  /** O inteiro de uma identidade na chave `j`: denso, na ordem de primeira aparição. */
  interna(j: number, identidade: string): number {
    const ids = this.ids[j]!;
    let id = ids.get(identidade);
    if (id === undefined) {
      id = ids.size;
      ids.set(identidade, id);
    }
    return id;
  }

  /**
   * O número da combinação `g` estendida pelo inteiro `id` da chave `j` (j ≥ 1). Com uma
   * chave só, o número da combinação é o próprio inteiro dela.
   */
  junta(g: number, j: number, id: number): number {
    return this.pares[j]!.numero(g, id);
  }
}

/**
 * Um mapa (inteiro, inteiro) → número denso, em endereçamento aberto sobre `Int32Array`.
 *
 * Existe porque o `Map<number, number>` com a chave `g * 2^26 + id` foi medido e perdeu:
 * a chave passa de 2^31, vira número alocado no heap, e `junta` ficou com 2 s de tempo
 * próprio em três rodadas das tabelas de relato (#179). Aqui nada é alocado por linha.
 */
class TabelaDePares {
  private a = new Int32Array(1024);
  private b = new Int32Array(1024);
  private v = new Int32Array(1024).fill(-1);
  private n = 0;

  numero(x: number, y: number): number {
    const { a, b, v } = this;
    const mascara = v.length - 1;
    let i = espalha(x, y) & mascara;
    for (;;) {
      const achado = v[i]!;
      if (achado < 0) break;
      if (a[i] === x && b[i] === y) return achado;
      i = (i + 1) & mascara;
    }
    const novo = this.n++;
    a[i] = x;
    b[i] = y;
    v[i] = novo;
    // Metade cheia: dobra. Acima disso a sondagem linear degrada depressa.
    if (this.n * 2 > v.length) this.cresce();
    return novo;
  }

  private cresce(): void {
    const { a, b, v } = this;
    const tamanho = v.length * 2;
    const mascara = tamanho - 1;
    this.a = new Int32Array(tamanho);
    this.b = new Int32Array(tamanho);
    this.v = new Int32Array(tamanho).fill(-1);
    for (let k = 0; k < v.length; k++) {
      if (v[k]! < 0) continue;
      let i = espalha(a[k]!, b[k]!) & mascara;
      while (this.v[i]! >= 0) i = (i + 1) & mascara;
      this.a[i] = a[k]!;
      this.b[i] = b[k]!;
      this.v[i] = v[k]!;
    }
  }
}

/** Mistura dois inteiros num hash de 32 bits (o finalizador do murmur3). */
function espalha(x: number, y: number): number {
  let h = Math.imul(x, 0x9e3779b1) ^ y;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return h ^ (h >>> 16);
}

/**
 * Um leitor do INTEIRO de uma chave numa linha, para o `NumeradorDeCombinacoes`.
 *
 * Coluna crua do armazenamento colunar: o código do dicionário é canonizado UMA vez por
 * código (`Int32Array`, preguiçoso) — dois códigos com a mesma identidade, como
 * `'Canoas'` e `'CANOAS'`, caem no mesmo inteiro porque passam por `interna` com a mesma
 * chave. O resto (coluna calculada, nível de hierarquia, linha de fora do armazenamento)
 * vai pela identidade, para o mesmo espaço de inteiros.
 */
function leitorDeNumeroDaChave(
  c: Chave,
  j: number,
  numerador: NumeradorDeCombinacoes,
  ev: Evaluator,
  onde: string,
): (linha: Row) => number {
  const identidade = leitorDeIdentidadeDaChave(c, ev, onde);
  if (c.nivel) return (linha) => numerador.interna(j, identidade(linha));
  const codigo = ev.leitorDeCodigo(c.coluna);
  let canonico = new Int32Array(0);
  return (linha) => {
    const k = codigo.ler(linha);
    if (k < 0) return numerador.interna(j, identidade(linha));
    if (canonico.length === 0) canonico = new Int32Array(codigo.tamanho()).fill(-1);
    let n = canonico[k]!;
    if (n < 0) n = canonico[k] = numerador.interna(j, codigo.chave(k));
    return n;
  };
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
  tabelasDosValores: readonly string[],
): Plano | null {
  const tabelas = [...new Map(chaves.map((c) => [normaliza(c.tabela), c.tabela])).values()];
  if (tabelas.length === 1) return null;
  const ancora = escolheAncora(tabelas, ev.model, onde, tabelasDosValores);
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
/**
 * O que de um filtro de grupo **não depende do valor** — montado uma vez por chave.
 *
 * `filtrosDaChave` roda uma vez por combinação do eixo, e numa matriz uma vez por
 * célula. Tudo aqui era refeito a cada uma: quatro normalizações de nome, dois
 * literais de gabarito e um `Set` de um elemento. Medido em 14/09/2026 nas 14
 * páginas, `normalizeName` gastava 668 ms chamada daqui.
 *
 * **O `Set` sai compartilhado entre os filtros**, o que é seguro porque ninguém
 * escreve em `TableFilter.columns` — ele é lido para decidir o que `ALL()` derruba.
 * Se um dia alguém precisar mexer nele, tem de copiar antes; está escrito aqui
 * porque o erro seria silencioso e longe da causa.
 */
interface PreparoDaChave {
  readonly tabela: string;
  readonly coluna: string;
  readonly colunas: Set<string>;
  readonly origem: string;
  readonly origemEmBranco: string;
  /** A chave é de outra tabela que não a âncora do plano? */
  readonly remota: boolean;
}

function preparaChave(c: Chave, ancora: string | null, onde: string): PreparoDaChave {
  const coluna = normaliza(c.coluna);
  const tabela = normaliza(c.tabela);
  const rotulo = `'${c.tabela}'[${c.coluna}]${c.nivel ? `.[${c.nivel}]` : ''}`;
  return {
    tabela,
    coluna,
    colunas: new Set([coluna]),
    origem: `${onde}: grupo ${rotulo}`,
    origemEmBranco: `${onde}: grupo ${rotulo} em branco (linha sem correspondência)`,
    remota: ancora !== null && tabela !== ancora,
  };
}

function filtrosDaChave(
  c: Chave,
  p: PreparoDaChave,
  valor: DaxValue,
  /** `identityKey(valor)`, já calculada por quem chama. Ver `filtrosDe`. */
  alvo: string,
  i: number,
  plano: Plano | null,
  base: EvalScope,
  ev: Evaluator,
  onde: string,
): TableFilter[] {
  if (p.remota && isBlank(valor)) {
    const caminho = plano!.caminhos[i]!;
    // Preguiçoso pelo mesmo motivo do `chaveDe` logo abaixo, e com mais razão:
    // preparar o caminho constrói os índices dos saltos, e cada índice varre uma
    // tabela visível inteira. Este filtro é montado uma vez por COMBINAÇÃO, e o
    // `keep` só roda quando a varredura acontece.
    let anda: ((row: Row) => Row | null) | null = null;
    return [{
      table: normaliza(plano!.ancora),
      // Nenhuma coluna declarada: este filtro não é sobre uma coluna da âncora, é
      // sobre *para onde a linha aponta*. Declarar coluna faria um CALCULATE sobre
      // ela derrubar o grupo inteiro.
      columns: new Set<string>(),
      origem: p.origemEmBranco,
      keep: (row: Row) => (anda ??= plano!.navegador.preparaCaminho(caminho))(row) === null,
    }];
  }

  // **Preguiçoso, e isso foi medido.** Este filtro é montado uma vez por COMBINAÇÃO
  // do eixo, e o `keep` só roda quando a varredura acontece — quando o índice de
  // igualdade resolve o grupo, ele não vê linha nenhuma. Montar o leitor aqui fora
  // custava duas normalizações por combinação para nada, e nas 14 páginas isso era
  // MAIOR que o ganho: A/B intercalado de 14/09/2026, a versão ansiosa ganhou 1 de 4
  // pares e ficou 1,4% pior no total, mesmo sendo 14% melhor na página que eu mirei.
  let chaveDe: ((row: Row) => string) | null = null;
  return [{
    table: p.tabela,
    columns: p.colunas,
    origem: p.origem,
    igualdade: !c.nivel && !isBlank(valor) ? { coluna: p.coluna, valor } : undefined,
    keep: (row: Row) => (chaveDe ??= leitorDeIdentidadeDaChave(c, ev, onde))(row) === alvo,
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
  /** `false` quando ninguém vai materializar o grupo — ver `combinacoesDistintas`. */
  guardaLinhas = true,
): Combinacoes {
  const lista: Combinacao[] = [];
  const porValores = new Map<readonly DaxValue[], Combinacao>();
  const numerador = new NumeradorDeCombinacoes(chaves.length);
  const n = chaves.length;
  // O número da combinação é denso e na ordem de primeira aparição: é o índice dela em
  // `lista`, e um número novo é sempre `lista.length`.
  const guarda = (g: number, linha: Row, valores: () => DaxValue[]): void => {
    const achada = lista[g];
    if (achada !== undefined) {
      if (guardaLinhas) achada.linhas.push(linha);
      return;
    }
    const nova: Combinacao = { valores: valores(), linhas: guardaLinhas ? [linha] : [], materializacao: null };
    lista.push(nova);
    porValores.set(nova.valores, nova);
  };

  if (plano === null) {
    // Um leitor por chave, montados antes do laço — são as MESMAS chaves em todas
    // as linhas, e este laço percorre a tabela visível inteira.
    //
    // **O número vem direto, e o VALOR só quando o grupo é novo.** Este laço roda uma
    // vez por linha visível e os grupos costumam ser muito menos que as linhas: montar
    // o array de valores em todas elas era descartá-lo em quase todas. E o número sai
    // do código do dicionário da coluna quando há um (`leitorDeNumeroDaChave`), sem
    // passar pelo valor nem pela identidade — que é justamente o caso desta varredura,
    // sobre tabela física.
    const leitores = chaves.map((c) => leitorDaChave(c, ev, onde));
    const numeros = chaves.map((c, j) => leitorDeNumeroDaChave(c, j, numerador, ev, onde));
    for (const linha of base.filter.rowsOf(chaves[0]!.tabela)) {
      let g = numeros[0]!(linha);
      for (let j = 1; j < n; j++) g = numerador.junta(g, j, numeros[j]!(linha));
      guarda(g, linha, () => leitores.map((ler) => ler(linha)));
    }
    return { lista, porValores };
  }

  // Um leitor por chave, montados antes do laço — pelo mesmo motivo do ramo acima:
  // são as MESMAS chaves em todas as linhas, e este laço percorre a âncora visível
  // inteira. `plano.navegador.valor` refazia, POR LINHA, a resolução de nome que só
  // depende da tabela: a chave do memo de `indice` (duas `normalizeName` e uma
  // string nova a hashear), a normalização de `columnValue` em cada salto, e o
  // `identityKey` que o leitor de identidade tira direto do dicionário.
  //
  // Ansioso aqui e preguiçoso em `filtrosDaChave`, e a diferença não é gosto: este
  // laço percorre TODAS as linhas da âncora sempre que chega aqui, então o preparo
  // se paga na primeira; lá o `keep` pode nunca rodar.
  const leitores = chaves.map((c, i) =>
    plano.navegador.leitorDeValor(plano.caminhos[i]!, c.tabela, c.coluna),
  );

  // ⚠ **MEDIDO E RECUSADO (15/09/2026): trocar o `map` de valores por um buffer
  // reusado.** A versão anterior deste laço montava, por linha, o array de valores
  // (`chaves.map`) e a chave concatenada dele. Reusar um `Array` para os valores ficou
  // 8,4% PIOR em `agendamento-field` (4/4 pares): o array do `map` nasce e morre jovem,
  // e o buffer é um objeto velho reescrito a cada linha, com barreira de escrita. A lei
  // que ficou da campanha: no V8 **alocação efêmera não é o custo; trabalho repetido
  // é**.
  //
  // O que saiu em 05/10/2026 (#179) foi o trabalho repetido: a string da combinação,
  // nova a cada linha e com o hash calculado sobre ela inteira. Agora cada valor passa
  // pela identidade (memoizada em `identityKey`) e vira número. O `map` fica: é ele que
  // a medição acima manteve, e ler os valores de novo só para o grupo novo dobraria a
  // navegação justamente onde quase toda linha é um grupo.
  for (const linha of base.filter.rowsOf(plano.ancora)) {
    const valores = chaves.map((c, j) => projetaNivel(c, leitores[j]!(linha), onde));
    let g = numerador.interna(0, identityKey(valores[0]!));
    for (let j = 1; j < n; j++) g = numerador.junta(g, j, numerador.interna(j, identityKey(valores[j]!)));
    guarda(g, linha, () => valores);
  }
  return { lista, porValores };
}

/**
 * O que separa uma chave de identidade da seguinte dentro da chave de combinação.
 *
 * **Existe como constante porque a chave é montada em dois lugares** — `filtrosDe`
 * (que já tem as identidades calculadas) e `chaveDeValores`. Duas cópias de um literal
 * é como uma delas muda sozinha e dois grupos que deviam ser o mesmo passam a ser dois,
 * sem erro nenhum — com um número menor em cada, na tela.
 *
 * Não é preciso ser um separador impossível nos valores: `identityKey` já distingue
 * `"a b"` de `"a"` e `"b"` pelo tipo que carrega na chave.
 */
const SEPARADOR_DE_CHAVE = ' ';

/**
 * A chave de identidade de uma combinação de valores.
 *
 * É a definição de referência do formato. Os laços de `enumeraCombinacoes` não a montam
 * (numeram, ver `NumeradorDeCombinacoes`); `grupos-chave.test.ts` afirma que numerar e
 * comparar por esta chave separam os grupos do mesmo jeito.
 */
export function chaveDeValores(valores: readonly DaxValue[]): string {
  return valores.map(identityKey).join(SEPARADOR_DE_CHAVE);
}
