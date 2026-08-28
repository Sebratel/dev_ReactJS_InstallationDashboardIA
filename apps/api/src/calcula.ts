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
  TIPOS_DE_GRAFICO,
} from '../../../packages/widget-engine/src/index.ts';
import type { DashboardSpec, FiltroSpec, VisualSpec } from '../../../packages/widget-engine/src/spec.ts';
import { TIPO_DE_TELA } from '../../../packages/widget-engine/src/filtro-url.ts';
import type { Evaluator } from '../../../packages/measure-engine/src/evaluator.ts';
import { isBlank, type DaxValue } from '../../../packages/measure-engine/src/value.ts';

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

export interface Janela {
  de: number;
  linhas: number;
}

/**
 * Onde o resultado **inteiro** de um visual paginável é guardado entre um pedido e
 * outro. Quem implementa é `apps/api/src/cache-visual.ts`; aqui só o contrato.
 *
 * **Por que este arquivo precisa saber disso.** Tabela e matriz calculam todas as
 * linhas e devolvem uma janela. Sem memória entre pedidos, clicar em "próxima"
 * recalcula as 33.462 linhas para serializar 200 — 2,9 s por clique, medido. Com
 * ela, o cálculo acontece uma vez e cada janela é um `slice`.
 *
 * É opcional em todo lugar de propósito: `tools/paginas` e `tools/paridade` chamam
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
  colunas: { nome: string | null; tipo: TipoDeValor; chave: boolean }[];
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
 * Quem chama uma vez por página (`tools/paginas`, `tools/paridade`) não passa nada e
 * não paga nada; quem serve cliques (`apps/api/src/servidor.ts`) passa.
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
    const base: VisualCalculado = { id: v.id, tipo: v.type, posicao: v.position, conteudo, ms: 0 };

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
    // visual **sob demanda**. Ver `specs/_catalog/projecao.yaml`.
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
      const filtrosAqui = filtrosDoVisual(dash.filters ?? [], v, clicados);
      const dashAqui =
        filtrosAqui === dash.filters ? dash : { ...dash, filters: [...filtrosAqui] };
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
): readonly FiltroSpec[] {
  if (clicados.length === 0) return filtros;

  const mostrados = new Set<string>();
  for (const c of v.fields ?? []) {
    if (c.kind === 'measure' || !c.entity || !c.property) continue;
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
 * A janela recortada de um resultado inteiro.
 *
 * `especie` fica de fora do que sai daqui: ela é de dentro do cache, e a tela nunca a
 * viu. Os demais campos saem idênticos ao que a resposta sempre teve — este recorte
 * não é um formato novo, é o mesmo `slice` que estava embutido no cálculo.
 */
export function janelaDe(completo: Completo, janela: Janela): unknown {
  const ate = janela.de + janela.linhas;
  if (completo.especie === 'tabela') {
    const { especie: _, linhas, ...resto } = completo;
    return { ...resto, linhas: linhas.slice(janela.de, ate), de: janela.de };
  }
  const { especie: _, linhas, celulas, ...resto } = completo;
  return {
    ...resto,
    linhas: linhas.slice(janela.de, ate),
    celulas: celulas.slice(janela.de, ate),
    de: janela.de,
  };
}
