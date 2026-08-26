// A forma de um gráfico: o que é eixo, o que é série, e de que cor.
//
// **Separado do componente de propósito.** Aqui não há JSX, então `npm test` cobre a
// parte que erra em silêncio — qual campo virou eixo, qual virou empilhamento, se a
// linha e as colunas cabem na mesma escala. O SVG do `Grafico.tsx` só desenha o que
// esta função decidiu.
//
// O que existia antes não era gráfico: uma lista de barras horizontais em `div`, uma
// linha por ponto, sem eixo e sem olhar o papel das chaves. A `AGENDA + CAPACIDADE POR
// TURNO` — coluna empilhada com linha por cima — saía como 31 tiras, e a `TAXAS DE
// PRODUTIVIDADE`, que empilha 4 status por dia, saía como 124.

import type { DadosDeGrafico, TipoDeValor, Valor } from './api.ts';
import { formata } from './formato.ts';

/** O desenho: o que o tipo do PBIP pede. */
export type Forma = 'colunas' | 'barras' | 'linhas';

export interface SerieMontada {
  nome: string;
  cor: string;
  /** Coluna/barra, ou linha por cima delas (o papel `Y2` do PBIP). */
  desenho: 'area' | 'linha';
  /** Um valor por categoria, na ordem de `categorias`. `null` = sem dado ali. */
  valores: (number | null)[];
  /** A chave de identidade da série — é ela que fixa a cor. Ver `corDaSerie`. */
  chave: string;
}

export interface CategoriaMontada {
  rotulo: string;
  /** Os valores das chaves de eixo, para o clique que filtra. */
  valores: Valor[];
}

export interface GraficoMontado {
  forma: Forma;
  /** Empilha as áreas (uma pilha por categoria) em vez de agrupar lado a lado. */
  empilha: boolean;
  /** Normaliza cada pilha para 100% — o `hundredPercentStackedColumnChart`. */
  percentual: boolean;
  categorias: CategoriaMontada[];
  series: SerieMontada[];
  /**
   * Por que a linha foi para um painel próprio, ou `null` quando ela cabe junto.
   *
   * **Eixo duplo é proibido**, e não por gosto: duas escalas no mesmo desenho fazem o
   * cruzamento entre a coluna e a linha depender do fator que alguém escolheu para
   * alinhá-las, e o leitor lê como correlação uma coisa que é arbitrária. O Power BI
   * usa eixo secundário aqui; quando as duas grandezas são comparáveis (capacidade e
   * protocolos do mesmo dia), uma escala só dá o mesmo desenho **sem** a mentira.
   * Quando não são, o certo é separar os painéis, não esticar a escala.
   */
  facetada: string | null;
  /** Avisos honestos sobre o que não foi desenhado, e por quê. Vão para a tela. */
  avisos: string[];
}

/**
 * As cores das séries.
 *
 * Validadas com o script do guia de dataviz contra o fundo branco do cartão
 * (`node scripts/validate_palette.js ... --surface "#FFFFFF"`), não escolhidas a olho:
 * banda de luminosidade, piso de croma, separação em deuteranopia/tritanopia e
 * contraste. A ordem é fixa e a cor segue a **identidade** da série, nunca a posição
 * dela na lista — um filtro que tira uma série não pode repintar as que ficaram, ou
 * quem aprendeu "manhã é azul" passa a ler o gráfico errado.
 */
const SLOTS: readonly string[] = [
  '#2a78d6', // azul
  '#eb6834', // laranja
  '#1baf7a', // aqua
  '#eda100', // amarelo
  '#e87ba4', // magenta
  '#4a3aa7', // violeta
  '#008300', // verde
  '#e34948', // vermelho
];

/**
 * Cores com significado, por nome de série.
 *
 * **A paleta do Power BI não passa no teste de daltonismo.** Verde `Produtivo` ao lado
 * de vermelho `Improdutivo` mede ΔE 4,1 em deuteranopia — o piso é 8 —, e as duas
 * fatias empilhadas viram uma só para quem tem a deficiência mais comum. A correção não
 * foi trocar o significado das cores, foi **afastar as duas na pilha**: `Inconclusivo`
 * entra entre elas, e aí nenhum par vizinho fica abaixo do piso (deutan 19,8, tritan
 * 9,6, visão normal 24,0 — medidos, não estimados).
 *
 * A ordem das chaves aqui é a ordem da pilha, e é ela que faz a validação passar.
 */
const POR_SIGNIFICADO: ReadonlyMap<string, string> = new Map([
  ['produtivo', '#1baf7a'],
  ['inconclusivo', '#2a78d6'],
  ['improdutivo', '#d03b3b'],
  ['sem acao', '#eda100'],
]);

/** Sem acento e sem caixa, para `Sem Ação` e `SEM AÇÃO` caírem na mesma chave. */
function chaveDeCor(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/** A posição de uma série na pilha: as de significado conhecido na ordem do mapa. */
function ordemNaPilha(nome: string): number {
  const chaves = [...POR_SIGNIFICADO.keys()];
  const i = chaves.indexOf(chaveDeCor(nome));
  return i < 0 ? chaves.length : i;
}

/**
 * A cor de uma série. Nome com significado manda; o resto pega o slot seguinte.
 *
 * `indice` é a posição da série na **primeira** montagem do gráfico, não na atual —
 * quem chama passa o índice estável. É o que impede o repinte quando uma série sai.
 */
export function corDaSerie(nome: string, indice: number): string {
  return POR_SIGNIFICADO.get(chaveDeCor(nome)) ?? SLOTS[indice % SLOTS.length]!;
}

/** `columnChart` do PBIP é empilhado; `clusteredColumnChart` é agrupado. */
const POR_TIPO: Record<string, { forma: Forma; empilha: boolean; percentual: boolean }> = {
  columnChart: { forma: 'colunas', empilha: true, percentual: false },
  clusteredColumnChart: { forma: 'colunas', empilha: false, percentual: false },
  barChart: { forma: 'barras', empilha: true, percentual: false },
  clusteredBarChart: { forma: 'barras', empilha: false, percentual: false },
  hundredPercentStackedColumnChart: { forma: 'colunas', empilha: true, percentual: true },
  lineChart: { forma: 'linhas', empilha: false, percentual: false },
  lineStackedColumnComboChart: { forma: 'colunas', empilha: true, percentual: false },
};

interface ChaveDoGrafico {
  tabela?: string;
  coluna?: string;
  nome?: string | null;
  nivel?: string | null;
  papel?: string;
}

const num = (v: Valor): number | null => (typeof v === 'number' ? v : null);

/**
 * Acima disto o eixo não caberia num rótulo legível por categoria.
 *
 * Corta **e diz** — a contagem cortada vai para `avisos`. Um gráfico que mostra 50 de
 * 400 pontos sem avisar é pior que um que não mostra nada: parece o conjunto inteiro.
 */
export const MAXIMO_DE_CATEGORIAS = 62;

/**
 * Monta o gráfico a partir do que a API mandou.
 *
 * `Category` é eixo. `Series` é a dimensão de empilhamento — o campo de legenda, que
 * o desenho antigo ignorava e que por isso virava mais um ponto no eixo.
 */
export function montaGrafico(d: DadosDeGrafico): GraficoMontado {
  const base = POR_TIPO[d.tipo] ?? { forma: 'colunas' as Forma, empilha: false, percentual: false };
  const avisos: string[] = [];

  const chaves = (d.chaves as ChaveDoGrafico[]) ?? [];
  const iEixo = chaves.map((_, i) => i).filter((i) => (chaves[i]!.papel ?? 'Category') === 'Category');
  const iLegenda = chaves.map((_, i) => i).filter((i) => chaves[i]!.papel === 'Series');

  const tipoDe = (i: number): TipoDeValor => d.tiposDeChave[i] ?? null;
  // O nível [Ano] da hierarquia de datas chega como `number` puro (2025), e
  // `formata()` aplica o separador de milhar do pt-BR a qualquer number — "2.025".
  // Ano não é quantidade: nunca leva separador de milhar, então este nível pula o
  // formatador genérico.
  const rotuloDaParte = (v: Valor | undefined, i: number): string =>
    chaves[i]?.nivel === 'Ano' && typeof v === 'number' ? String(v) : formata(v ?? null, tipoDe(i)).texto;
  const rotulo = (vals: Valor[], idx: number[]): string =>
    idx.map((i) => rotuloDaParte(vals[i], i)).join(' / ') || '—';

  // Categorias na ordem em que a engine as trouxe — ela já ordenou pelo eixo, e
  // reordenar aqui faria o desenho discordar da matriz da mesma página.
  const categorias: CategoriaMontada[] = [];
  const posDaCategoria = new Map<string, number>();
  for (const p of d.pontos) {
    const chave = JSON.stringify(iEixo.map((i) => p.categoria[i] ?? null));
    if (posDaCategoria.has(chave)) continue;
    posDaCategoria.set(chave, categorias.length);
    categorias.push({ rotulo: rotulo(p.categoria, iEixo), valores: iEixo.map((i) => p.categoria[i] ?? null) });
  }

  // As séries: uma por valor do PBIP, multiplicada pelos valores distintos da legenda.
  //
  // A linha (`Y2`) fica de fora da multiplicação quando não há legenda; quando há, ela
  // é desenhada **por valor da legenda**, e não como um total. Somar seria inventar: as
  // medidas de `Y2` do relatório são `DISTINCTCOUNT` e `avg`, que não se somam — o total
  // de dois grupos não é a soma dos dois. Ver `avisos`.
  const mapa = new Map<string, SerieMontada>();
  const ordem: string[] = [];

  for (const p of d.pontos) {
    const cat = posDaCategoria.get(JSON.stringify(iEixo.map((i) => p.categoria[i] ?? null)))!;
    const sufixo = iLegenda.length ? rotulo(p.categoria, iLegenda) : '';

    d.series.forEach((s, k) => {
      const nomeDoValor = s.nome ?? '(sem rótulo)';
      const nome = sufixo ? (d.series.length > 1 ? `${sufixo} · ${nomeDoValor}` : sufixo) : nomeDoValor;
      const chave = `${k} ${sufixo}`;
      let serie = mapa.get(chave);
      if (!serie) {
        serie = {
          nome,
          chave,
          cor: corDaSerie(nome, ordem.length),
          desenho: s.papel === 'Y2' ? 'linha' : 'area',
          valores: new Array<number | null>(categorias.length).fill(null),
        };
        mapa.set(chave, serie);
        ordem.push(chave);
      }
      const v = num(p.valores[k] ?? null);
      if (v !== null) serie.valores[cat] = v;
    });
  }

  let series = ordem.map((c) => mapa.get(c)!);

  // Ordem da pilha: as séries de significado conhecido primeiro, na ordem que fez a
  // validação de daltonismo passar. As outras ficam como vieram.
  if (series.some((s) => POR_SIGNIFICADO.has(chaveDeCor(s.nome)))) {
    series = [...series].sort((a, b) => ordemNaPilha(a.nome) - ordemNaPilha(b.nome));
  }

  if (iLegenda.length > 0 && series.some((s) => s.desenho === 'linha')) {
    avisos.push(
      `a linha aparece uma por ${chaves[iLegenda[0]!]!.nome ?? 'valor da legenda'}, não como total: ` +
        `a medida foi calculada dentro de cada grupo, e somar grupos não dá o total de uma ` +
        `medida não aditiva (DISTINCTCOUNT, média).`,
    );
  }

  const cortadas = categorias.length - Math.min(categorias.length, MAXIMO_DE_CATEGORIAS);
  if (cortadas > 0) {
    avisos.push(`${cortadas} de ${categorias.length} categorias fora do desenho — as primeiras ${MAXIMO_DE_CATEGORIAS} estão à mostra.`);
  }

  const facetada = decideFaceta(series, base.empilha);
  if (facetada) avisos.push(facetada);

  return {
    forma: base.forma,
    empilha: base.empilha && series.filter((s) => s.desenho === 'area').length > 1,
    percentual: base.percentual,
    categorias: categorias.slice(0, MAXIMO_DE_CATEGORIAS),
    series: series.map((s) => ({ ...s, valores: s.valores.slice(0, MAXIMO_DE_CATEGORIAS) })),
    facetada,
    avisos,
  };
}

/**
 * O maior valor de um conjunto de séries, por laço.
 *
 * **Existe para não usar `Math.max(0, ...serie.flatMap(…))`.** O spread vira um
 * argumento de função por valor, e toda engine tem teto para isso: passado ele, o motor
 * estoura com `Maximum call stack size exceeded` em vez de devolver um número. Quando
 * isso acontece dentro do `useMemo` de um visual, o React derruba a árvore e a página
 * fica em branco — foi assim que `diario-instalacao` parou de abrir em 25/08/2026 (a
 * matriz de PROTOCOLOS PRODUTIVIDADE, 38.864 linhas). Aqui as séries são recortadas por
 * `MAXIMO_DE_CATEGORIAS` e o estouro é improvável, mas o padrão é o mesmo e o custo de
 * não repeti-lo é zero.
 */
export function maiorValorDe(
  series: readonly { valores: readonly (number | null)[] }[],
  inicial = 0,
): number {
  let maior = inicial;
  for (const s of series) {
    for (const v of s.valores) {
      if (v !== null && v > maior) maior = v;
    }
  }
  return maior;
}

/** O maior valor que a área ocupa: o topo da pilha, ou a maior série solta. */
function tetoDasAreas(series: readonly SerieMontada[], empilha: boolean): number {
  const areas = series.filter((s) => s.desenho === 'area');
  if (areas.length === 0) return 0;
  if (!empilha) return maiorValorDe(areas);
  const n = areas[0]!.valores.length;
  let teto = 0;
  for (let i = 0; i < n; i++) teto = Math.max(teto, areas.reduce((a, s) => a + (s.valores[i] ?? 0), 0));
  return teto;
}

/**
 * Acima deste fator a linha e as colunas não dividem escala.
 *
 * Numa escala só, uma linha 6× menor que as colunas é um fio rente ao chão: existe,
 * não se lê. Aí o painel próprio mostra a forma dela de verdade — e continua sem
 * afirmar um cruzamento que não está no dado.
 */
const FATOR_MAXIMO = 6;

function decideFaceta(series: readonly SerieMontada[], empilha: boolean): string | null {
  const linhas = series.filter((s) => s.desenho === 'linha');
  if (linhas.length === 0) return null;
  const teto = tetoDasAreas(series, empilha);
  if (teto === 0) return null;
  const tetoLinha = maiorValorDe(linhas);
  if (tetoLinha === 0) return null;

  const fator = Math.max(teto / tetoLinha, tetoLinha / teto);
  if (fator <= FATOR_MAXIMO) return null;
  return (
    `a linha está em painel próprio: a escala dela é ${fator.toFixed(0)}× a das colunas. ` +
    `No Power BI isto é um eixo secundário, e duas escalas no mesmo desenho fazem o ` +
    `cruzamento entre linha e coluna depender do fator escolhido para alinhá-las.`
  );
}

/**
 * Marcas do eixo em números redondos, do zero ao teto.
 *
 * Exportada porque é conta, e conta se testa: um eixo que não fecha em número redondo
 * obriga o leitor a interpolar de cabeça toda vez que um valor não tem rótulo direto.
 */
export function marcasDoEixo(teto: number, quantas = 4): number[] {
  if (!Number.isFinite(teto) || teto <= 0) return [0];
  const cru = teto / quantas;
  const grandeza = 10 ** Math.floor(Math.log10(cru));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * grandeza).find((p) => p >= cru) ?? 10 * grandeza;
  const marcas: number[] = [];
  for (let v = 0; v <= teto + passo / 2; v += passo) marcas.push(Number(v.toFixed(10)));
  return marcas;
}

export { tetoDasAreas };
