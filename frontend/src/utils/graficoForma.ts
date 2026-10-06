// A forma de um gráfico: o que é eixo, o que é série, e de que cor.
//
// **Separado do componente de propósito.** Aqui não há JSX, então `npm test` cobre a
// parte que erra em silêncio — qual campo virou eixo, qual virou empilhamento, se a
// linha e as colunas cabem na mesma escala. O SVG do `Grafico.tsx` só desenha o que
// esta função decidiu.

import type { DadosDeGrafico, TipoDeValor, Valor } from '../services/dashboardService.ts';
import { formata } from './formato.ts';

/** O desenho: o que o tipo do PBIP pede. */
export type Forma = 'colunas' | 'barras' | 'linhas';

export interface SerieMontada {
  nome: string;
  cor: string;
  desenho: 'area' | 'linha';
  valores: (number | null)[];
  chave: string;
}

export interface CategoriaMontada {
  rotulo: string;
  valores: Valor[];
}

export interface GraficoMontado {
  forma: Forma;
  empilha: boolean;
  percentual: boolean;
  categorias: CategoriaMontada[];
  series: SerieMontada[];
  facetada: string | null;
  avisos: string[];
}

/**
 * As cores das séries — bordô Sebratel.
 *
 * A ordem é fixa e a cor segue a **identidade** da série, nunca a posição dela na
 * lista: um filtro que tira uma série não pode repintar as que ficaram, ou quem
 * aprendeu "bordô é instalação" passa a ler o gráfico errado.
 *
 * **Estes hexadecimais são a exceção consciente à regra "nenhum hex fora do
 * `:root`".** Cor de série vai para atributo SVG (`fill`, `stroke`), que não lê
 * variável de CSS por caminho de dado. Se `estilo.css` mudar, mude aqui junto.
 *
 * Antes daqui isto era a paleta CRUA do Power BI (azul, laranja, aqua, amarelo,
 * magenta, violeta...) — oito matizes sem relação com a marca e escolhidos por
 * matiz, não por luminância.
 *
 * **Separação medida em OKLab (x100).** Piso: 15 em visão normal, 8 em daltonismo.
 *
 *                     normal   deutan   tritan
 *   bordô x dourado     41,4     38,0     56,8   <- os dois primeiros
 *   bordô x cinza       17,0     10,8     89,6
 *   dourado x cinza     33,3     34,1    126,5
 *
 * Pior par vizinho da lista: **19,8**. Pior caso em daltonismo entre os três
 * primeiros: **10,8**, acima do piso 8. A separação vem de LUMINÂNCIA (bordô
 * escuro, dourado claro, cinza no meio), e luminância sobrevive a qualquer
 * dicromacia — matiz não.
 *
 * **O dourado tem só 2,0:1 contra o branco do card**, e isso é aceito: a série é
 * uma área PREENCHIDA, não um traço fino, e o mínimo de 3:1 do WCAG 1.4.11 vale
 * para contorno de gráfico essencial. Barra sólida se enxerga bem a 2:1 — o que
 * não se enxerga é texto, e por isso o dourado de LETRA é outro token
 * (`--pbi-gold-600`).
 *
 * A contrapartida do padrão continua valendo: **legenda sempre presente** com 2+
 * séries e rótulo direto no extremo da linha. Identidade nunca fica só na cor.
 */
const SLOTS: readonly string[] = [
  '#880F17', // bordô          — a série principal (--pbi-primary)
  '#D9B300', // dourado        — a segunda, o par histórico do bordô
  '#605E5C', // cinza          — a terceira (--pbi-muted)
  '#C9707A', // bordô claro    — a quarta
  '#f0e199', // dourado claro
  '#A19F9D', // cinza claro
  '#252423', // tinta          (--pbi-ink)
  '#C8C6C4', // neutro         — "Outros", nunca uma categoria de verdade
];

const POR_SIGNIFICADO: ReadonlyMap<string, string> = new Map([
  ['produtivo', '#1baf7a'],
  ['inconclusivo', '#2a78d6'],
  ['improdutivo', '#d03b3b'],
  ['sem acao', '#eda100'],
]);

function chaveDeCor(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function ordemNaPilha(nome: string): number {
  const chaves = [...POR_SIGNIFICADO.keys()];
  const i = chaves.indexOf(chaveDeCor(nome));
  return i < 0 ? chaves.length : i;
}

export function corDaSerie(nome: string, indice: number): string {
  return POR_SIGNIFICADO.get(chaveDeCor(nome)) ?? SLOTS[indice % SLOTS.length]!;
}

/**
 * Os slots que somem no TEMA ESCURO, e a troca mínima que os salva.
 *
 * Uma cor de série cuja luminância bate com a do fundo escuro não fica discreta:
 * ela **desaparece**, sem erro no console e sem teste falhando. Foi visto na tela:
 * uma série inteira do AGENDAMENTO FIELD não existia nem na legenda nem nas
 * colunas, e o gráfico mostrava metade do dado que dizia mostrar.
 *
 * Medido contra a superfície escura `#252423` (mínimo 3:1, WCAG 1.4.11 para
 * elemento gráfico). Três slots reprovam e só eles trocam — mexer nos outros faria
 * a mesma série mudar de cor entre temas sem motivo:
 *
 *   0 bordô   #880F17  1,57  ->  #E08B94  6,12   bordô claro
 *   2 cinza   #605E5C  2,40  ->  #C8C6C4  9,10   cinza claro
 *   6 tinta   #252423  1,00  ->  #F3F2F1 13,86
 *   7 Outros  #C8C6C4  9,10  ->  #605E5C  2,40   recessivo, ver abaixo
 *
 * O slot 2 foi para `#C8C6C4` e não para um cinza médio porque `#8A8886`, a
 * escolha óbvia, ficava a **11,2** do bordô claro vizinho — abaixo do piso 15.
 * Com `#C8C6C4` os vizinhos medem 16,4 e 21,1.
 *
 * O slot 7 abaixo de 3:1 é DELIBERADO e não é desvio novo: no tema claro ele mede
 * 1,55:1 (`#C8C6C4` sobre branco). "Outros" tem de ser recessivo — ele nunca
 * carrega uma categoria de verdade.
 */
const NO_ESCURO: Readonly<Record<string, string>> = {
  '#880F17': '#E08B94',
  '#605E5C': '#C8C6C4',
  '#252423': '#F3F2F1',
  '#C8C6C4': '#605E5C',
};

/**
 * Traduz uma cor de série para o tema em uso.
 *
 * Fica FORA de `corDaSerie` de propósito: aquela função é pura e a suíte fixa o
 * resultado dela por índice. Tema é decisão de renderização, não de forma — quem
 * sabe o tema é a tela, então é lá que a tradução se aplica.
 *
 * Cor de ESTADO (`POR_SIGNIFICADO`) não entra: aquelas quatro foram medidas e
 * passam nos dois fundos.
 */
export function corNoTema(cor: string, isDark = false): string {
  if (!isDark) return cor;
  return NO_ESCURO[cor] ?? cor;
}

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
 * Teto de cardinalidade — GUARDA, não "o que cabe na tela".
 *
 * Ele valia **62** e esse número era "quantas colunas cabem num card", de quando o
 * gráfico não paginava. Agora quem faz caber é a janela de categorias do
 * `Grafico.tsx` (medida, com paginador), e o teto antigo passou a **cortar dado que
 * a paginação alcançaria**: na AGENDAMENTO FIELD eram 87 categorias, o paginador
 * dizia "38–62 de 62" e as outras 25 não existiam para ele. Paginador que anuncia um
 * total menor que o real é pior que nenhum — ele afirma que você viu tudo.
 *
 * O que sobra é o papel de guarda contra cardinalidade patológica: eixo montado
 * sobre uma coluna de identidade (protocolo, contrato) traria dezenas de milhares de
 * categorias, e aí o custo é de montar os objetos, não de desenhar — o desenho já é
 * limitado pela página. Mil cobre com folga o que a operação tem (366 dias do ano,
 * equipes, cidades, tipos) e ainda para um acidente.
 */
export const MAXIMO_DE_CATEGORIAS = 1000;

export function montaGrafico(d: DadosDeGrafico): GraficoMontado {
  const base = POR_TIPO[d.tipo] ?? { forma: 'colunas' as Forma, empilha: false, percentual: false };
  const avisos: string[] = [];

  const chaves = (d.chaves as ChaveDoGrafico[]) ?? [];
  const iEixo = chaves
    .map((_, i) => i)
    .filter((i) => (chaves[i]!.papel ?? 'Category') === 'Category');
  const iLegenda = chaves.map((_, i) => i).filter((i) => chaves[i]!.papel === 'Series');

  const tipoDe = (i: number): TipoDeValor => d.tiposDeChave[i] ?? null;
  const rotuloDaParte = (v: Valor | undefined, i: number): string =>
    chaves[i]?.nivel === 'Ano' && typeof v === 'number'
      ? String(v)
      : formata(v ?? null, tipoDe(i)).texto;
  const rotulo = (vals: Valor[], idx: number[]): string =>
    idx.map((i) => rotuloDaParte(vals[i], i)).join(' / ') || '—';

  const categorias: CategoriaMontada[] = [];
  const posDaCategoria = new Map<string, number>();
  for (const p of d.pontos) {
    const chave = JSON.stringify(iEixo.map((i) => p.categoria[i] ?? null));
    if (posDaCategoria.has(chave)) continue;
    posDaCategoria.set(chave, categorias.length);
    categorias.push({
      rotulo: rotulo(p.categoria, iEixo),
      valores: iEixo.map((i) => p.categoria[i] ?? null),
    });
  }

  const mapa = new Map<string, SerieMontada>();
  const ordem: string[] = [];

  for (const p of d.pontos) {
    const cat = posDaCategoria.get(JSON.stringify(iEixo.map((i) => p.categoria[i] ?? null)))!;
    const sufixo = iLegenda.length ? rotulo(p.categoria, iLegenda) : '';

    d.series.forEach((s, k) => {
      const nomeDoValor = s.nome ?? '(sem rótulo)';
      const nome = sufixo
        ? d.series.length > 1
          ? `${sufixo} · ${nomeDoValor}`
          : sufixo
        : nomeDoValor;
      const chave = `${k} ${sufixo}`;
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
    // Chegar aqui agora é anormal — a paginação alcança tudo abaixo do teto. Este
    // aviso passou a significar PERDA DE DADO, e é por isso que ele diz o que fazer.
    avisos.push(
      `${categorias.length} categorias neste eixo, e o teto é ${MAXIMO_DE_CATEGORIAS}: ` +
        `${cortadas} ficaram FORA e o paginador não as alcança. Agrupe o eixo (mês em vez ` +
        `de dia) ou filtre — não é limite de desenho, é dado que não está na conta.`,
    );
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

function tetoDasAreas(series: readonly SerieMontada[], empilha: boolean): number {
  const areas = series.filter((s) => s.desenho === 'area');
  if (areas.length === 0) return 0;
  if (!empilha) return maiorValorDe(areas);
  const n = areas[0]!.valores.length;
  let teto = 0;
  for (let i = 0; i < n; i++)
    teto = Math.max(
      teto,
      areas.reduce((a, s) => a + (s.valores[i] ?? 0), 0),
    );
  return teto;
}

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
 * Luminância relativa (WCAG) de uma cor hex sólida — sRGB linearizado, os mesmos
 * coeficientes 0,2126/0,7152/0,0722 que produzem os contrastes documentados no
 * `CLAUDE.md` (bordô sobre branco: 9,87:1 — reproduzido por esta função, não copiado).
 */
function luminanciaRelativa(hex: string): number {
  const canais = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = canais.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contraste(l1: number, l2: number): number {
  const claro = Math.max(l1, l2);
  const escuro = Math.min(l1, l2);
  return (claro + 0.05) / (escuro + 0.05);
}

const LUMINANCIA_TINTA = luminanciaRelativa('#252423'); // --pbi-ink

/**
 * O texto de dentro da BARRA DE RANKING (Fase L6, §8: rótulo dentro da barra em vez de
 * numa coluna à parte) — decide entre branco e tinta pela cor real do preenchimento,
 * não por um par fixo tema-claro/tema-escuro.
 *
 * **Por que não fixar por tema.** `corNoTema` troca o bordô cheio (`#880F17`, claro)
 * pelo bordô claro (`#E08B94`, escuro) no tema escuro — a MESMA barra muda de luminância
 * entre temas. Um par fixo "branco no claro, tinta no escuro" teria acertado por
 * coincidência aqui e errado na primeira cor de série que não seguisse esse padrão
 * (`--pbi-gold`, por exemplo, é claro nos dois temas). Medir a cor que realmente vai
 * para a tela é o que generaliza.
 *
 * Verificado à mão para os dois casos deste visual: `#880F17` dá 9,87:1 contra branco e
 * 1,57:1 contra tinta (escolhe branco); `#E08B94` dá 2,53:1 contra branco e 6,12:1
 * contra tinta (escolhe tinta) — os dois acima do piso WCAG AA de 4,5:1 para texto.
 */
export function corDoRotuloSobre(hexDeFundo: string): string {
  const lFundo = luminanciaRelativa(hexDeFundo);
  return contraste(lFundo, 1) >= contraste(lFundo, LUMINANCIA_TINTA) ? '#FFFFFF' : '#252423';
}

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
