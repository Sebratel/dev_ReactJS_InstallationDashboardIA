// De uma página do relatório para o JSON que a tela consome.
//
// **Nada de cálculo mora aqui.** As engines já sabem calcular card, tabela,
// gráfico e matriz; este arquivo só decide a **forma da resposta** e três coisas
// que são de API, não de engine:
//
// 1. **Um visual que falha não derruba a página.** São 306 visuais no relatório e
//    189 deles não têm número nenhum (imagem, caixa de texto, forma, segmentação).
//    Dos que têm, um erro é informação — vira `erro` naquele visual, com a
//    mensagem inteira, e a página soma quantos falharam. O que **não** pode
//    acontecer é o erro sumir: por isso ele viaja no payload e é contado.
// 2. **Tabela grande não vai inteira.** As duas tabelas de detalhe de
//    `protocolos-detalhados` têm 32.462 linhas e 23,8 MB de JSON somadas. A
//    resposta manda uma janela e **diz o total** — corte silencioso seria pior que
//    o peso.
// 3. **O tipo do valor viaja junto.** JSON não tem data: sem o tipo por coluna, a
//    tela não sabe se `"2026-03-15T00:00:00.000Z"` é uma data ou um texto que por
//    acaso se parece com uma. É a mesma razão do formato do snapshot.

import {
  calculaCard,
  calculaGrafico,
  calculaMatriz,
  calculaTabela,
  dataDaPagina,
  ignoraDataDaTela,
  NOTA_HORIZONTE,
  TIPOS_DE_GRAFICO,
} from '../../packages/widget-engine/src/index.ts';
import type { DashboardSpec, FiltroSpec, VisualSpec } from '../../packages/widget-engine/src/spec.ts';
import { TIPO_DE_TELA } from '../../packages/widget-engine/src/filtro-url.ts';
import type { Evaluator } from '../../packages/measure-engine/src/evaluator.ts';
import { isBlank, type DaxValue } from '../../packages/measure-engine/src/value.ts';

/**
 * A coluna que uma segmentação (`slicer`) recorta, quando a tela consegue recortá-la.
 *
 * **Por que a segmentação viaja no payload.** Ela não produz número — nunca produziu —
 * mas produz *escolha*, e sem a coluna a tela não tem como desenhar um controle: ela
 * desenhava uma caixa morta rotulada "sem número". Com a coluna, o mesmo visual vira o
 * filtro que o relatório sempre teve.
 */
export interface Segmentacao {
  tabela: string;
  coluna: string;
  rotulo: string;
  /**
   * Nível da hierarquia de datas que esta segmentação recorta, quando é uma.
   *
   * A tela o devolve intacto no filtro; é ele que faz a comparação acontecer sobre
   * `YEAR(data)` em vez de sobre a data.
   */
  nivel?: string;
  /**
   * Por que esta segmentação **não** filtra, quando não filtra.
   *
   * Presente é o caso interessante: a tela desenha o controle desabilitado com este
   * motivo, em vez de um controle que parece funcionar e não muda número nenhum. Uma
   * segmentação que finge filtrar é a mesma classe de erro que um BLANK calado.
   */
  naoFiltra?: string;
  /**
   * Os níveis, quando a segmentação é uma HIERARQUIA que não reduz a um nível só.
   *
   * Existe para a rota `/valores` distinguir estruturalmente esse caso dos outros
   * dois motivos de `naoFiltra` — sem ter de ler a frase em português do
   * `naoFiltra`, que é texto para humano e pode ser reescrito a qualquer momento.
   *
   * A tela usa a lista para montar a árvore Ano > Mês > Dia, que É o controle certo
   * para um poço de drill: a escolha ali é um caminho, e um caminho precisa dos
   * níveis todos.
   */
  niveis?: string[];
}

/** Quantas linhas de tabela a resposta manda quando ninguém pede outra coisa. */
export const LINHAS_PADRAO = 200;
/** Teto duro. Acima disto a resposta passa de dezenas de MB e o navegador engasga. */
export const LINHAS_MAXIMO = 5000;

/** O tipo de um valor, para a tela saber formatar. `null` quando é BLANK. */
export type TipoDeValor = 'number' | 'string' | 'boolean' | 'date' | null;

export function tipoDe(v: DaxValue): TipoDeValor {
  if (isBlank(v)) return null;
  if (v instanceof Date) return 'date';
  const t = typeof v;
  return t === 'number' || t === 'string' || t === 'boolean' ? t : 'string';
}

/** O tipo de uma coluna: o primeiro não-branco decide, `null` se todos forem. */
function tipoDaColuna(valores: readonly DaxValue[]): TipoDeValor {
  for (const v of valores) {
    const t = tipoDe(v);
    if (t !== null) return t;
  }
  return null;
}

/** Data vira ISO; o resto atravessa. BLANK é `null`, que é o que a tela desenha. */
function serializa(v: DaxValue): unknown {
  if (isBlank(v)) return null;
  return v instanceof Date ? v.toISOString() : v;
}

/** Teto do termo de busca. Acima disto é colagem acidental, não pesquisa. */
export const TERMO_MAXIMO = 100;

export interface Janela {
  de: number;
  linhas: number;
  /**
   * O termo do campo "Filtrar…" da tabela, já em minúsculas e sem espaço nas pontas.
   *
   * **Por que ele viaja até aqui, e não fica na tela.** Ele ficava: `Tabela.tsx`
   * peneirava `d.linhas`, que são as 200 linhas da janela JÁ baixada. Numa tabela de
   * 95.157 linhas isso são 476 janelas, e achar um protocolo exigia clicar até a
   * janela onde ele estava para só então o filtro servir — o que não é buscar, é
   * adivinhar a página. Com o termo aqui, o recorte acontece sobre o resultado
   * inteiro.
   *
   * **E o custo é quase nada porque ele entra DEPOIS do cálculo.** `dadosDo` calcula
   * o `Completo` uma vez e o memoiza; o termo só muda o `slice` em `janelaDe`. É a
   * mesma razão pela qual `chaveDoCompleto` (`cache-resposta.ts`) NÃO o inclui e
   * `chaveDaResposta` inclui: se ele entrasse na chave do completo, cada tecla
   * digitada recalcularia as 33.462 linhas — os 2,9 s por clique que o
   * `CacheDeVisual` existe para não pagar.
   */
  termo?: string;
}

/**
 * Uma linha casa com o termo se QUALQUER célula dela o contiver.
 *
 * **Esta função veio da tela, palavra por palavra** (`Tabela.tsx`,
 * `linhasFiltradasEOrdenadas`), e veio inteira de propósito: escrever uma segunda
 * regra de casamento aqui faria a busca mudar de resultado ao mudar de lado, e o
 * sintoma seria "sumiu uma linha que eu tinha visto", sem erro nenhum.
 *
 * Opera sobre a linha **já serializada** — data virou ISO em `serializa`, e é essa a
 * forma que a tela comparava. Casar contra o `Date` cru daria outro resultado.
 *
 * `null`/`undefined` nunca casam: BLANK não é texto vazio que contém tudo.
 */
export function casaComTermo(linha: readonly unknown[], termo: string): boolean {
  for (const v of linha) {
    if (v === null || v === undefined) continue;
    if (String(v).toLowerCase().includes(termo)) return true;
  }
  return false;
}

/**
 * Onde o resultado **inteiro** de um visual paginável é guardado entre um pedido e
 * outro. Quem implementa é `backend/api/src/cache-visual.ts`; aqui só o contrato.
 *
 * **Por que este arquivo precisa saber disso.** Tabela e matriz calculam todas as
 * linhas e devolvem uma janela. Sem memória entre pedidos, clicar em "próxima"
 * recalcula as 33.462 linhas para serializar 200 — 2,9 s por clique, medido. Com
 * ela, o cálculo acontece uma vez e cada janela é um `slice`.
 *
 * É opcional em todo lugar de propósito: `backend/tools/paginas` e `backend/tools/paridade` chamam
 * `calculaPagina` uma vez por página e nada teriam a ganhar guardando resultado —
 * só pagariam a memória.
 */
export interface MemoDeCompletos {
  le(visualId: string): unknown | undefined;
  guarda(visualId: string, completo: unknown): void;
}

/**
 * O resultado inteiro de uma tabela: todas as linhas, já serializadas.
 *
 * `especie` não viaja na resposta — ela existe para que `janelaDe` recorte a forma
 * certa sem receber o tipo do visual por fora, que seria um segundo lugar por onde
 * tabela e matriz poderiam divergir.
 */
export interface TabelaCompleta {
  especie: 'tabela';
  colunas: {
    nome: string | null;
    tipo: TipoDeValor;
    chave: boolean;
    /** A entidade e a propriedade de origem da coluna — o alvo de um clique na linha. */
    tabela: string | null;
    coluna: string | null;
    /** Nível da hierarquia de datas (`Ano`, `Mês`) quando a coluna é um deles. */
    nivel: string | null;
    /** Só presente (e `true`) em coluna de porcentagem de visual nativo — ver `tabela.ts`. */
    percentual?: true;
  }[];
  linhas: unknown[][];
  linhasTotais: number;
  filtros: string[];
}

export interface MatrizCompleta {
  especie: 'matriz';
  chavesDeLinha: unknown;
  chavesDeColuna: unknown;
  medidas: unknown;
  linhas: unknown[][];
  colunas: unknown[][];
  tiposDeLinha: TipoDeValor[];
  tiposDeColuna: TipoDeValor[];
  tiposDeMedida: TipoDeValor[];
  celulas: unknown[][][];
  linhasTotais: number;
  descartadas: unknown;
  filtros: string[];
}

export type Completo = TabelaCompleta | MatrizCompleta;

export interface VisualCalculado {
  id: string;
  tipo: string;
  posicao: VisualSpec['position'];
  /** O título do relatório (`VisualSpec.title`), quando o visual tem um. */
  titulo?: string;
  /** Um dos quatro tipos de conteúdo, ou `null` quando o visual não calcula. */
  conteudo: 'card' | 'tabela' | 'grafico' | 'matriz' | null;
  /** Por que não calcula, quando `conteudo` é `null`. */
  semCalculo?: string;
  /**
   * Colunas fora da carga por decisão que este visual precisa, como `'T'[c]`.
   *
   * Presente só nos visuais sob demanda. É o que a tela usa para desenhar "abrir" em
   * vez de "erro", e o que diz ao pedido seguinte o que carregar.
   */
  sobDemanda?: string[];
  /** Presente só nas segmentações. Ver `Segmentacao`. */
  segmentacao?: Segmentacao;
  /**
   * Uma ressalva de leitura, para a tela escrever no cabeçalho do visual.
   *
   * Hoje só o horizonte de previsão a usa (`NOTA_HORIZONTE`): aquele visual ignora
   * o mês do seletor, e quem olha precisa saber disso ao comparar com os vizinhos.
   */
  nota?: string;
  erro?: string;
  dados?: unknown;
  /**
   * Quanto este visual custou, em ms.
   *
   * **Existe porque a página inteira em milissegundos não diz onde gastar esforço.**
   * `agendamento-field` levava 104 minutos e a suspeita apontava para o carregamento;
   * eram 90% de uma coluna calculada (ACHADOS #46). Cada rodada de suspeita custava
   * uma hora de relógio. Um número por visual troca a suspeita por uma lista ordenada.
   */
  ms: number;
}

export interface PaginaCalculada {
  id: string;
  nome: string;
  tamanho: DashboardSpec['size'];
  /** ISO da materialização mais antiga entre as tabelas usadas. */
  dadoDe: string | null;
  visuais: VisualCalculado[];
  resumo: { calculados: number; falharam: number; semCalculo: number };
  ms: number;
}

/** Tipos de visual que não produzem número — medidos na base, não deduzidos. */
const SEM_CALCULO: Record<string, string> = {
  image: 'imagem',
  textbox: 'caixa de texto',
  shape: 'forma',
  slicer: 'segmentação de dados',
  advancedSlicerVisual: 'segmentação de dados',
  actionButton: 'botão',
  basicShape: 'forma',
};

/** Os dois tipos de segmentação que o relatório usa. */
const SEGMENTACOES = new Set(['slicer', 'advancedSlicerVisual']);

/**
 * A coluna que uma segmentação recorta — ou o motivo de ela não recortar nada.
 *
 * **Dois formatos filtram.** `kind: 'column'` é o caso direto. `kind:
 * 'hierarchy_level'` é a segmentação de Ano/Mês/Dia sobre uma hierarquia de datas:
 * ela não filtra a coluna, filtra uma **projeção** dela, e por isso devolve o
 * `nivel` junto — é ele que faz `traduzFiltros` comparar `YEAR(data)` em vez de
 * `data`. Sem o nível o filtro não sai errado em silêncio: o guarda de espécie do
 * `filtro.ts` recusa comparar número com data e erra alto. O nível é o que torna a
 * segmentação **possível**.
 *
 * **Uma hierarquia com mais de um nível ativo não filtra.** Ela é um controle de
 * *drill* — Ano → Mês → Dia — e a escolha do usuário ali não é um conjunto de
 * valores de um nível, é um caminho. Tratá-la como se fosse o primeiro nível
 * aplicaria um filtro que o usuário não pediu.
 */
export function segmentacaoDe(v: VisualSpec): Segmentacao | undefined {
  if (!SEGMENTACOES.has(v.type)) return undefined;

  const campos = (v.fields ?? []).filter((c) => c.role === 'Values');
  if (campos.length === 0) return undefined;

  const primeiro = campos[0]!;
  if (!primeiro.entity || !primeiro.property) return undefined;

  const base = {
    tabela: primeiro.entity,
    coluna: primeiro.property,
    rotulo: primeiro.name ?? primeiro.property,
  };

  if (campos.some((c) => c.kind === 'hierarchy_level')) {
    // `active !== false` — a mesma regra de `campoAtivo` do widget-engine. `null`
    // conta como ativo e é distinto de `true`: o PBIP não declara estado em poço de
    // um campo só (ACHADOS #32). Duplicar a regra com `=== true` faria esta função
    // discordar do agrupamento sobre a mesma spec.
    const ativos = campos.filter((c) => c.active !== false);

    if (ativos.length !== 1) {
      return {
        ...base,
        niveis: ativos.map((c) => c.level ?? '?'),
        naoFiltra:
          `segmentação de hierarquia com ${ativos.length} níveis ativos ` +
          `(${ativos.map((c) => c.level ?? '?').join('/')}). Ela é um controle de drill, ` +
          `e a escolha ali é um caminho, não um conjunto de valores de um nível — ` +
          `filtrar pelo primeiro aplicaria um filtro que ninguém pediu.`,
      };
    }

    const nivel = ativos[0]!.level;
    if (!nivel) {
      return { ...base, naoFiltra: 'nível de hierarquia sem nome do nível na spec.' };
    }
    return { ...base, coluna: ativos[0]!.property ?? base.coluna, nivel, rotulo: ativos[0]!.name ?? base.rotulo };
  }

  // Um `kind` novo do Power BI cai aqui. Desabilitar dizendo o nome é melhor que
  // presumir que se comporta como coluna: presumir é o caminho do zero calado.
  if (primeiro.kind !== 'column') {
    return { ...base, naoFiltra: `segmentação com kind '${primeiro.kind}', que a tela não sabe filtrar.` };
  }

  return base;
}

function conteudoDe(tipo: string): VisualCalculado['conteudo'] {
  if (tipo === 'card' || tipo === 'multiRowCard') return 'card';
  if (tipo === 'tableEx' || tipo === 'table') return 'tabela';
  if (tipo === 'pivotTable' || tipo === 'matrix') return 'matriz';
  if (TIPOS_DE_GRAFICO.includes(tipo)) return 'grafico';
  return null;
}

/**
 * Chamado ao fim de cada visual, se quem chamou quiser acompanhar.
 *
 * **Existe porque uma página pode levar 40 minutos.** Sem isto, `npm run paginas`
 * fica meia hora sem escrever nada e a única saída aparece no fim — então descobrir
 * qual visual é o caro custa a execução inteira, e interromper para investigar joga
 * fora tudo o que já foi calculado. Com isto, o visual caro se denuncia enquanto ainda
 * está rodando o seguinte.
 */
export type AoTerminarVisual = (v: VisualCalculado, indice: number, total: number) => void;

/**
 * Uma página do relatório, calculada.
 *
 * O `memo` é o único parâmetro que muda o **custo** sem mudar o resultado: com ele,
 * tabela e matriz calculadas uma vez servem todas as janelas seguintes por `slice`.
 * Quem chama uma vez por página (`backend/tools/paginas`, `backend/tools/paridade`) não passa nada e
 * não paga nada; quem serve cliques (`backend/api/src/servidor.ts`) passa.
 */
export function calculaPagina(
  dash: DashboardSpec,
  ev: Evaluator,
  janela: Janela = { de: 0, linhas: LINHAS_PADRAO },
  aoTerminar?: AoTerminarVisual,
  memo?: MemoDeCompletos,
  /** As colunas cujo filtro nasceu de clique. Ver `filtrosDoVisual`. */
  clicados: readonly { tabela: string; coluna: string }[] = [],
): PaginaCalculada {
  const inicio = Date.now();
  const visuais: VisualCalculado[] = [];
  const total = (dash.visuals ?? []).length;
  let calculados = 0;
  let falharam = 0;
  let semCalculo = 0;

  for (const v of dash.visuals ?? []) {
    const conteudo = conteudoDe(v.type);
    const tVisual = Date.now();
    const base: VisualCalculado = {
      id: v.id,
      tipo: v.type,
      posicao: v.position,
      ...(v.title ? { titulo: v.title } : {}),
      conteudo,
      ms: 0,
    };

    if (conteudo === null) {
      semCalculo++;
      const seg = segmentacaoDe(v);
      const feito: VisualCalculado = {
        ...base,
        semCalculo: SEM_CALCULO[v.type] ?? `tipo '${v.type}' não calcula`,
        ...(seg ? { segmentacao: seg } : {}),
      };
      visuais.push(feito);
      aoTerminar?.(feito, visuais.length, total);
      continue;
    }

    // Visual que amarra coluna deixada fora da carga por decisão não é falha: é um
    // visual **sob demanda**. Ver `backend/specs/_catalog/projecao.yaml`.
    //
    // A checagem vem antes do cálculo, e não depois do erro, por um motivo: depois do
    // erro seria adivinhação — a mensagem viria de dentro do avaliador, misturada com
    // erros de verdade. Aqui a página sabe, antes de tentar, que a coluna não está.
    const faltando = colunasSobDemanda(v, ev);
    if (faltando.length > 0) {
      semCalculo++;
      const feito = {
        ...base,
        conteudo: null,
        semCalculo: `sob demanda: ${faltando.join(', ')}`,
        sobDemanda: faltando,
      };
      visuais.push(feito);
      aoTerminar?.(feito, visuais.length, total);
      continue;
    }

    try {
      // Cada visual vê os filtros da página MENOS os campos que ele próprio desenha e
      // que vieram de clique — ver `filtrosDoVisual`. Sem clique, é o mesmo `dash`.
      const filtrosAqui = filtrosDoVisual(dash.filters ?? [], v, clicados, dash.id);
      const dashAqui =
        filtrosAqui === dash.filters ? dash : { ...dash, filters: [...filtrosAqui] };
      // A tela escreve isto no cabeçalho: um visual que desobedece o seletor em
      // silêncio é pior que um visual vazio. Ver `semDataDaTela`.
      if (ignoraDataDaTela(dash.id, v.id)) base.nota = NOTA_HORIZONTE;
      base.dados = dadosDo(conteudo, dashAqui, v, ev, janela, memo);
      calculados++;
    } catch (err) {
      falharam++;
      // A mensagem inteira, não um resumo: as das engines dizem o que fazer, e
      // encurtá-las aqui jogaria fora a parte útil.
      base.erro = err instanceof Error ? err.message : String(err);
    }
    // Também no caminho do erro: um visual que falha depois de 20 minutos é uma
    // informação diferente de um que falha na hora.
    base.ms = Date.now() - tVisual;
    visuais.push(base);
    aoTerminar?.(base, visuais.length, total);
  }

  return {
    id: dash.id,
    nome: dash.name,
    tamanho: dash.size,
    dadoDe: null,
    visuais,
    resumo: { calculados, falharam, semCalculo },
    ms: Date.now() - inicio,
  };
}

/**
 * AUTO-EXCLUSÃO: o visual que MOSTRA um campo é calculado sem o filtro daquele campo.
 *
 * **O que ela conserta.** Sem isto, clicar em SÃO LEOPOLDO no gráfico de cidades
 * deixa uma barra só — e some justamente a comparação que motivou o clique. Medido em
 * 28/08/2026 na VISÃO GERAL: o gráfico "TOTAL por CIDADE" caía de 6 categorias para 1.
 * O visual clicado tem de DESTACAR, não colapsar.
 *
 * **Só o que veio de CLIQUE se auto-exclui**, e essa distinção é o coração da função.
 * Um seletor filtra tudo, inclusive o visual que desenha aquela coluna — é assim no
 * Power BI e é o que a pessoa espera do controle que ela mesma abriu. Se a regra fosse
 * "todo filtro da tela se auto-exclui", o gráfico por Data Ano passaria a ignorar o
 * seletor de período e mostraria a base inteira — mais lento e simplesmente errado.
 * Por isso a lista `clicados` viaja em parâmetro próprio (`?clicado=`), separada dos
 * `?filtro=`.
 *
 * **"Mostra" quer dizer campo não-medida**: eixo, série, linha ou coluna de matriz. Uma
 * medida sobre a coluna não conta — `COUNT(cidade)` não desenha cidade nenhuma, e
 * excluir o filtro ali daria um número do universo inteiro num card que se diz filtrado.
 *
 * **Custo zero sem clique**: com `clicados` vazio a função devolve a mesma referência de
 * filtros que entrou, e nenhum visual paga nada.
 */
function filtrosDoVisual(
  filtros: readonly FiltroSpec[],
  v: VisualSpec,
  clicados: readonly { tabela: string; coluna: string }[],
  pagina: string,
): readonly FiltroSpec[] {
  return semAutoExcluidos(semDataDaTela(filtros, v, pagina), v, clicados);
}

/**
 * HORIZONTE DE PREVISÃO: o visual que mostra previsão sai do recorte de MÊS da tela.
 *
 * **Por que isto não é a auto-exclusão de novo.** A auto-exclusão é sobre o campo que
 * o visual DESENHA, e vale só para clique. Aqui é sobre a grandeza: previsão é uma
 * janela que anda todo dia, e mês é uma caixa com borda no dia 30 ou 31. Em 28/09 a
 * previsão de 01/10 a 13/10 já existe; qualquer filtro de "setembro" a joga fora, e
 * a matriz encolhe até esvaziar na virada — exatamente o defeito do ACHADOS #103,
 * que trocar o mês fechado pelo corrente apenas adiou por um mês.
 *
 * **Só a coluna de data que a PÁGINA trava sai, e só se veio da tela.** O visual
 * continua obedecendo os filtros da spec do relatório (é desenho do relatório, não
 * escolha de quem explora) e qualquer outro recorte da tela. Ver
 * `HORIZONTE_DE_PREVISAO` em `filtros-padrao.ts` para a lista, que é fechada de
 * propósito.
 */
function semDataDaTela(
  filtros: readonly FiltroSpec[],
  v: VisualSpec,
  pagina: string,
): readonly FiltroSpec[] {
  if (!ignoraDataDaTela(pagina, v.id)) return filtros;
  const data = dataDaPagina(pagina);
  if (!data) return filtros;
  return filtros.filter(
    (f) => f.type !== TIPO_DE_TELA || f.entity !== data.tabela || f.property !== data.coluna,
  );
}

/**
 * Os únicos papéis que "colapsam" quando filtrados sem exclusão: eixo/série de
 * gráfico (`grafico.ts`: `PAPEIS_DE_CHAVE`) e linha/coluna de matriz (`matriz.ts`).
 * `Values` fica de fora de propósito — é o papel de TODA coluna de uma tabela plana
 * (`tableEx`), inclusive a chave (N°PROTOCOLO). Uma tabela não desenha "TÉCNICO 1"
 * como dimensão que colapsaria a um grupo só: ela lista um registro por linha, e
 * filtrar por TÉCNICO 1 é encolher a lista, não apagar uma comparação.
 *
 * **O defeito que isto corrige, medido em 09/09/2026 na VISÃO GERAL.** Clicar numa
 * barra do ranking "TOTAL por INSTALADOR REFERÊNCIA" (campo TÉCNICO 1) filtrava os
 * KPIs e os outros gráficos certo, mas a tabela "PROTOCOLO · DATA CRIADO · ..."
 * continuava com as 94.166 linhas de sempre — porque TÉCNICO 1 também é um dos 23
 * campos `Values` que a tabela lista, e o código anterior tratava "aparece nos
 * campos do visual" como sinônimo de "é o eixo que este visual desenharia", quando o
 * próprio comentário desta função já dizia a intenção certa ("eixo, série, linha ou
 * coluna de matriz") — só o `kind !== 'measure'` da checagem não bastava para
 * cumpri-la, porque toda coluna de tabela também tem `kind: 'column'`.
 */
const PAPEIS_DE_AGRUPAMENTO = new Set(['Category', 'Series', 'Rows', 'Columns']);

function semAutoExcluidos(
  filtros: readonly FiltroSpec[],
  v: VisualSpec,
  clicados: readonly { tabela: string; coluna: string }[],
): readonly FiltroSpec[] {
  if (clicados.length === 0) return filtros;

  const mostrados = new Set<string>();
  for (const c of v.fields ?? []) {
    if (!PAPEIS_DE_AGRUPAMENTO.has(c.role) || !c.entity || !c.property) continue;
    mostrados.add(`${c.entity}
${c.property}`);
  }
  if (mostrados.size === 0) return filtros;

  const excluir = new Set(
    clicados
      .filter((c) => mostrados.has(`${c.tabela}
${c.coluna}`))
      .map((c) => `${c.tabela}
${c.coluna}`),
  );
  if (excluir.size === 0) return filtros;

  // SÓ O FILTRO VINDO DA TELA sai. Um filtro da spec do relatório sobre a mesma coluna
  // é desenho do relatório, não escolha de quem está explorando — no Power BI o filtro
  // de página recorta o visual inclusive quando ele desenha aquele campo. Descartá-lo
  // aqui mostraria, num único visual, um universo maior do que o da página inteira.
  // `TIPO_DE_TELA` é o marcador que `filtro-url.ts` já carimba em tudo que veio de `?filtro=`.
  return filtros.filter(
    (f) => f.type !== TIPO_DE_TELA || !excluir.has(`${f.entity ?? ''}
${f.property ?? ''}`),
  );
}

/**
 * As colunas sob demanda que este visual amarra — vazio no caso normal.
 *
 * Só campo de visual e filtro de visual: se uma **medida** dependesse de coluna
 * omitida, o certo seria errar alto, e o avaliador já faz isso. Sob demanda é uma
 * decisão sobre o que a tela mostra, não sobre o que a conta pode ignorar.
 */
function colunasSobDemanda(v: VisualSpec, ev: Evaluator): string[] {
  const fora: string[] = [];
  const olha = (entity: string | null, property: string | null): void => {
    if (!entity || !property) return;
    if (ev.dataset.omitida(entity, property)) {
      const rotulo = `'${entity}'[${property}]`;
      if (!fora.includes(rotulo)) fora.push(rotulo);
    }
  };
  for (const c of v.fields ?? []) if (c.kind !== 'measure') olha(c.entity, c.property);
  for (const f of v.filters ?? []) olha(f.entity, f.property);
  return fora;
}

/**
 * Os dados de um visual, na janela pedida.
 *
 * Card e gráfico não têm janela e são calculados direto. Tabela e matriz passam pelo
 * `memo`: o resultado inteiro é calculado **uma vez** e cada janela sai de um `slice`
 * dele. Sem `memo` o comportamento é o de antes — calcula inteiro, recorta, descarta.
 */
function dadosDo(
  conteudo: NonNullable<VisualCalculado['conteudo']>,
  dash: DashboardSpec,
  v: VisualSpec,
  ev: Evaluator,
  janela: Janela,
  memo?: MemoDeCompletos,
): unknown {
  if (conteudo === 'tabela' || conteudo === 'matriz') {
    const guardado = memo?.le(v.id) as Completo | undefined;
    // A espécie é conferida, e não suposta: uma spec editada entre dois pedidos pode
    // trocar o tipo do visual com o mesmo id, e recortar uma matriz como tabela
    // devolveria uma tabela vazia sem erro nenhum — número plausível e errado.
    const completo =
      guardado?.especie === conteudo
        ? guardado
        : conteudo === 'tabela'
          ? tabelaCompleta(dash, v, ev)
          : matrizCompleta(dash, v, ev);
    if (completo !== guardado) memo?.guarda(v.id, completo);
    return janelaDe(completo, janela);
  }

  if (conteudo === 'card') {
    const r = calculaCard(dash, v, ev);
    return {
      nome: r.nome,
      valor: serializa(r.valor),
      tipoDoValor: tipoDe(r.valor),
      origem: r.origem,
      filtros: r.filtros,
    };
  }

  const r = calculaGrafico(dash, v, ev);
  return {
    tipo: r.tipo,
    chaves: r.chaves,
    series: r.series,
    tiposDeSerie: r.series.map((_, i) => tipoDaColuna(r.pontos.map((p) => p.valores[i]!))),
    tiposDeChave: r.chaves.map((_, i) => tipoDaColuna(r.pontos.map((p) => p.categoria[i]!))),
    pontos: r.pontos.map((p) => ({
      categoria: p.categoria.map(serializa),
      valores: p.valores.map(serializa),
    })),
    filtros: r.filtros,
  };
}

/**
 * A tabela inteira, serializada.
 *
 * **Serializar tudo é trabalho novo, e é o trabalho certo.** Antes, só a janela
 * passava por `serializa` — mas o `tipoDaColuna` de cada coluna já varria todas as
 * linhas, então a varredura completa sempre esteve aqui. O que muda é o `map` sobre
 * o resultado inteiro, uma vez, em troca de todas as janelas seguintes saírem de um
 * `slice`. Guardar a forma crua da engine em vez desta seria pior: lá cada célula é
 * um objeto `{valor, chave}`, e são duas células por valor útil.
 */
function tabelaCompleta(dash: DashboardSpec, v: VisualSpec, ev: Evaluator): TabelaCompleta {
  const r = calculaTabela(dash, v, ev);
  return {
    especie: 'tabela',
    colunas: r.colunas.map((nome, i) => ({
      nome,
      tipo: tipoDaColuna(r.linhas.map((l) => l[i]!.valor)),
      chave: r.linhas[0]?.[i]?.chave ?? true,
      tabela: r.origemDasColunas[i]?.tabela ?? null,
      coluna: r.origemDasColunas[i]?.coluna ?? null,
      nivel: r.origemDasColunas[i]?.nivel ?? null,
      ...(r.percentuais[i] ? { percentual: true as const } : {}),
    })),
    linhas: r.linhas.map((l) => l.map((c) => serializa(c.valor))),
    linhasTotais: r.linhas.length,
    filtros: r.filtros,
  };
}

function matrizCompleta(dash: DashboardSpec, v: VisualSpec, ev: Evaluator): MatrizCompleta {
  const r = calculaMatriz(dash, v, ev);
  return {
    especie: 'matriz',
    chavesDeLinha: r.chavesDeLinha,
    chavesDeColuna: r.chavesDeColuna,
    medidas: r.medidas,
    linhas: r.linhas.map((l) => l.valores.map(serializa)),
    colunas: r.colunas.map((c) => c.valores.map(serializa)),
    tiposDeLinha: r.chavesDeLinha.map((_, i) => tipoDaColuna(r.linhas.map((l) => l.valores[i]!))),
    tiposDeColuna: r.chavesDeColuna.map((_, i) => tipoDaColuna(r.colunas.map((c) => c.valores[i]!))),
    // O tipo de cada medida, varrendo as células dela. Sem isto a tela teria de
    // adivinhar pelo formato do valor — e adivinhar é justamente o que o tipo
    // explícito existe para evitar (uma medida de data viraria texto).
    tiposDeMedida: r.medidas.map((_, m) =>
      tipoDaColuna(r.celulas.flatMap((linha) => linha.map((celula) => celula[m]!))),
    ),
    celulas: r.celulas.map((linha) => linha.map((celula) => celula.map(serializa))),
    linhasTotais: r.linhas.length,
    descartadas: r.descartadas,
    filtros: r.filtros,
  };
}

/**
 * A janela recortada de um resultado inteiro — com a busca aplicada ANTES do recorte.
 *
 * `especie` fica de fora do que sai daqui: ela é de dentro do cache, e a tela nunca a
 * viu. Os demais campos saem idênticos ao que a resposta sempre teve — este recorte
 * não é um formato novo, é o mesmo `slice` que estava embutido no cálculo.
 *
 * **A ordem importa e é o ponto inteiro da busca no servidor:** filtrar e DEPOIS
 * cortar é procurar na tabela; cortar e depois filtrar é o que a tela fazia sozinha, e
 * é procurar na página. Com 200 linhas por janela e 95.157 linhas em `PROTOCOLOS
 * GERAL`, a segunda ordem obriga a acertar a janela antes de poder buscar.
 *
 * **`linhasTotais` passa a contar o resultado da busca**, porque é dele que o
 * paginador tira quantas janelas existem — se continuasse sendo o total bruto, uma
 * busca de 3 linhas anunciaria 476 páginas vazias. O total bruto continua disponível
 * em `totalSemBusca`, que é o que deixa a tela dizer "3 de 95.157".
 *
 * **A MATRIZ IGNORA O TERMO, de propósito.** Ela não tem campo de busca na tela, e as
 * `celulas` são indexadas pela posição da linha: filtrar `linhas` sem reindexar
 * `celulas` desalinharia as duas e cada número apareceria na linha errada — a classe
 * de erro que este projeto não pode cometer. Se um dia a matriz ganhar busca, os dois
 * arrays têm de ser recortados pelos MESMOS índices, num passo só.
 */
export function janelaDe(completo: Completo, janela: Janela): unknown {
  const ate = janela.de + janela.linhas;
  if (completo.especie === 'tabela') {
    const { especie: _, linhas, ...resto } = completo;
    const termo = janela.termo;
    const achadas = termo ? linhas.filter((l) => casaComTermo(l, termo)) : linhas;
    return {
      ...resto,
      linhas: achadas.slice(janela.de, ate),
      linhasTotais: achadas.length,
      ...(termo ? { totalSemBusca: completo.linhasTotais } : {}),
      de: janela.de,
    };
  }
  const { especie: _, linhas, celulas, ...resto } = completo;
  return {
    ...resto,
    linhas: linhas.slice(janela.de, ate),
    celulas: celulas.slice(janela.de, ate),
    de: janela.de,
  };
}
