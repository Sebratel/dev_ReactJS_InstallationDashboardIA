// A forma de um gráfico: o que é eixo, o que é série, e de que cor.
//
// **Separado do componente de propósito.** Aqui não há JSX, então `npm test` cobre a
// parte que erra em silêncio — qual campo virou eixo, qual virou empilhamento, se a
// linha e as colunas cabem na mesma escala. O SVG do `Grafico.tsx` só desenha o que
// esta função decidiu.

import type { DadosDeGrafico, TipoDeValor, Valor } from './api.ts';
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

const POR_SIGNIFICADO: ReadonlyMap<string, string> = new Map([
  ['produtivo', '#1baf7a'],
  ['inconclusivo', '#2a78d6'],
  ['improdutivo', '#d03b3b'],
  ['sem acao', '#eda100'],
]);

function chaveDeCor(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

function ordemNaPilha(nome: string): number {
  const chaves = [...POR_SIGNIFICADO.keys()];
  const i = chaves.indexOf(chaveDeCor(nome));
  return i < 0 ? chaves.length : i;
}

export function corDaSerie(nome: string, indice: number): string {
  return POR_SIGNIFICADO.get(chaveDeCor(nome)) ?? SLOTS[indice % SLOTS.length]!;
}

export function corNoTema(cor: string, isDark = false): string {
  if (!isDark) return cor;
  if (cor === '#2a78d6') return '#4ba3ff';
  if (cor === '#eb6834') return '#ff8c5a';
  if (cor === '#1baf7a') return '#3cdba2';
  return cor;
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

export const MAXIMO_DE_CATEGORIAS = 62;

export function montaGrafico(d: DadosDeGrafico): GraficoMontado {
  const base = POR_TIPO[d.tipo] ?? { forma: 'colunas' as Forma, empilha: false, percentual: false };
  const avisos: string[] = [];

  const chaves = (d.chaves as ChaveDoGrafico[]) ?? [];
  const iEixo = chaves.map((_, i) => i).filter((i) => (chaves[i]!.papel ?? 'Category') === 'Category');
  const iLegenda = chaves.map((_, i) => i).filter((i) => chaves[i]!.papel === 'Series');

  const tipoDe = (i: number): TipoDeValor => d.tiposDeChave[i] ?? null;
  const rotuloDaParte = (v: Valor | undefined, i: number): string =>
    chaves[i]?.nivel === 'Ano' && typeof v === 'number' ? String(v) : formata(v ?? null, tipoDe(i)).texto;
  const rotulo = (vals: Valor[], idx: number[]): string =>
    idx.map((i) => rotuloDaParte(vals[i], i)).join(' / ') || '—';

  const categorias: CategoriaMontada[] = [];
  const posDaCategoria = new Map<string, number>();
  for (const p of d.pontos) {
    const chave = JSON.stringify(iEixo.map((i) => p.categoria[i] ?? null));
    if (posDaCategoria.has(chave)) continue;
    posDaCategoria.set(chave, categorias.length);
    categorias.push({ rotulo: rotulo(p.categoria, iEixo), valores: iEixo.map((i) => p.categoria[i] ?? null) });
  }

  const mapa = new Map<string, SerieMontada>();
  const ordem: string[] = [];

  for (const p of d.pontos) {
    const cat = posDaCategoria.get(JSON.stringify(iEixo.map((i) => p.categoria[i] ?? null)))!;
    const sufixo = iLegenda.length ? rotulo(p.categoria, iLegenda) : '';

    d.series.forEach((s, k) => {
      const nomeDoValor = s.nome ?? '(sem rótulo)';
      const nome = sufixo ? (d.series.length > 1 ? `${sufixo} · ${nomeDoValor}` : sufixo) : nomeDoValor;
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
  for (let i = 0; i < n; i++) teto = Math.max(teto, areas.reduce((a, s) => a + (s.valores[i] ?? 0), 0));
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
