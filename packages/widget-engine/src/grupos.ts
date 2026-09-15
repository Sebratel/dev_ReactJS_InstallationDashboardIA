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

  const filtrosDe = (valores: readonly DaxValue[]): TableFilter[] => {
    // A chave de identidade de cada valor tem DOIS consumidores aqui — o filtro de
    // cada chave, que compara com ela, e a busca da combinação, que as concatena —
    // e era calculada uma vez para cada um. Medido em 14/09/2026 nas 14 páginas,
    // `identityKey` gastava 666 ms chamada de `filtrosDaChave` e mais 507 ms de
    // `chaveDeValores`, sobre exatamente os mesmos valores.
    const alvos = valores.map(identityKey);
    const filtros = chaves.flatMap((c, i) =>
      filtrosDaChave(c, preparos[i]!, valores[i]!, alvos[i]!, i, plano, base, ev, onde),
    );
    const combinacao = combinacoes.get(alvos.join(SEPARADOR_DE_CHAVE));
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

  const grupos = [...combinacoes.values()].map(({ valores }) => {
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
): Map<string, Combinacao> {
  const combinacoes = new Map<string, Combinacao>();
  const guarda = (valores: DaxValue[], linha: Row): void => {
    const k = chaveDeValores(valores);
    const achada = combinacoes.get(k);
    if (achada) achada.linhas.push(linha);
    else combinacoes.set(k, { valores, linhas: [linha], materializacao: null });
  };

  if (plano === null) {
    // Um leitor por chave, montados antes do laço — são as MESMAS chaves em todas
    // as linhas, e este laço percorre a tabela visível inteira.
    //
    // **A chave vem direto, e o VALOR só quando o grupo é novo.** Este laço roda uma
    // vez por linha visível e os grupos são muito menos que as linhas: montar o
    // array de valores em todas elas era descartá-lo em quase todas. E a chave sai
    // do dicionário da coluna quando há um (`leitorDeIdentidadeDaChave`), sem passar
    // pelo valor — que é justamente o caso desta varredura, sobre tabela física.
    const leitores = chaves.map((c) => leitorDaChave(c, ev, onde));
    const identidades = chaves.map((c) => leitorDeIdentidadeDaChave(c, ev, onde));
    // Uma chave é o caso comum, e aí a chave da combinação É a chave de identidade
    // do valor — `[x].join(' ')` é `x`.
    const unica = identidades.length === 1 ? identidades[0]! : null;
    for (const linha of base.filter.rowsOf(chaves[0]!.tabela)) {
      let k: string;
      if (unica !== null) {
        k = unica(linha);
      } else {
        k = identidades[0]!(linha);
        for (let i = 1; i < identidades.length; i++) {
          k += SEPARADOR_DE_CHAVE + identidades[i]!(linha);
        }
      }
      const achada = combinacoes.get(k);
      if (achada) achada.linhas.push(linha);
      else {
        combinacoes.set(k, {
          valores: leitores.map((ler) => ler(linha)),
          linhas: [linha],
          materializacao: null,
        });
      }
    }
    return combinacoes;
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

  // ⚠ **MEDIDO E RECUSADO (15/09/2026): trocar este `map` por um buffer reusado.**
  //
  // Este laço aloca, por linha da âncora, um FECHO novo (a seta captura `linha`, então
  // não dá para içá-la), o array que o `map` devolve, e — dentro de `chaveDeValores` —
  // um segundo array. Três objetos por linha para produzir uma string, quase todos
  // descartados sem ninguém ler, num laço que o perfil apontava com 18,1% do tempo
  // próprio da página mais cara. Parecia o alvo óbvio.
  //
  // A versão com um `Array` reusado e a chave concatenada sem intermediário é **PIOR**,
  // em `agendamento-field`, 4 pares com ordem alternada:
  //
  //     map     4774  4714  4821  4759     média 4.767 ms
  //     buffer  5052  5180  5136  5305     média 5.168 ms      4/4 para o `map`
  //
  // Não é empate: o buffer perde 8,4%, nos quatro pares. A leitura mais provável é que
  // o array do `map` nasce empacotado e morre jovem — o coletor o varre sem copiar —
  // enquanto o buffer é um objeto VELHO reescrito a cada linha, e escrever ponteiro em
  // objeto velho custa barreira de escrita e trabalho de geração antiga.
  //
  // Confirmação da mesma lei, pela terceira vez nesta campanha: no V8 **alocação
  // efêmera não é o custo; trabalho repetido é**. O que o caminho preparado ganhou
  // (+33,1%, 4/4) era repetição de verdade — remontar a chave de um memo por linha.
  //
  // ⚠ A primeira medição disto deu "2 de 4, empate" e estava no armazenamento ERRADO
  // (objeto; a API usa colunar — achado #118). Refeita na régua certa, virou perda
  // clara. **O número acima é o que vale.**
  //
  // Fica o `map`, que é mais claro E mais rápido. Se alguém voltar a esta linha com a
  // mesma ideia: ela foi tentada duas vezes, e os números estão aqui.
  for (const linha of base.filter.rowsOf(plano.ancora)) {
    guarda(
      chaves.map((c, j) => projetaNivel(c, leitores[j]!(linha), onde)),
      linha,
    );
  }
  return combinacoes;
}

/**
 * O que separa uma chave de identidade da seguinte dentro da chave de combinação.
 *
 * **Existe como constante porque a chave é montada em três lugares** — `filtrosDe`
 * (que já tem as identidades calculadas), o laço de tabela única e o laço com âncora
 * (os dois últimos concatenam sem array intermediário, por custo). Três cópias de um
 * literal é como uma delas muda sozinha e dois grupos que deviam ser o mesmo passam a
 * ser dois, sem erro nenhum — com um número menor em cada, na tela.
 *
 * Não é preciso ser um separador impossível nos valores: `identityKey` já distingue
 * `"a b"` de `"a"` e `"b"` pelo tipo que carrega na chave.
 */
const SEPARADOR_DE_CHAVE = ' ';

/**
 * A chave de identidade de uma combinação de valores.
 *
 * É a definição de referência do formato. Os dois laços quentes montam a mesma string
 * sem o array intermediário do `map`; `grupos-chave.test.ts` afirma que as três formas
 * concordam.
 */
export function chaveDeValores(valores: readonly DaxValue[]): string {
  return valores.map(identityKey).join(SEPARADOR_DE_CHAVE);
}
