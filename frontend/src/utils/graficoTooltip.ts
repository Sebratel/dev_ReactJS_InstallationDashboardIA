// Decisão pura do conteúdo e da posição do tooltip rico dos gráficos (mini-barras
// proporcionais + dica de filtro). Sem JSX: testável direto no Vitest.

import type { TipoDeValor } from '../services/dashboardService.ts';
import { formata, inteiro } from './formato.ts';

export interface ItemDoTooltip {
  chave: string;
  nome: string;
  cor: string;
  /** Valor principal formatado (ex.: "92%", "1.240", "5,3"). */
  valorTexto: string;
  /** Detalhe complementar opcional (ex.: valor absoluto ao lado do "%"). */
  detalheTexto?: string;
  /** Proporção entre 0 e 1 usada na mini-barra horizontal. */
  proporcao: number;
}

export interface DadosDoTooltip {
  titulo: string;
  subtitulo?: string;
  itens: readonly ItemDoTooltip[];
  totalTexto?: string;
  dica?: string;
}

export interface PosicaoDoPonteiro {
  x: number;
  y: number;
}

export interface DimensoesDoTooltip {
  largura: number;
  altura: number;
}

const FOLGA_PONTEIRO = 14;
const MARGEM_TELA = 12;

/**
 * Posição fixa na viewport sem sair pelas bordas direita/inferior nem colar na esquerda/topo.
 */
export function calculaPosicaoTooltip(
  pos: PosicaoDoPonteiro,
  caixa: DimensoesDoTooltip,
  viewport: DimensoesDoTooltip,
): { left: number; top: number } {
  const cabeDireita = pos.x + FOLGA_PONTEIRO + caixa.largura <= viewport.largura - MARGEM_TELA;
  const xBruto = cabeDireita ? pos.x + FOLGA_PONTEIRO : pos.x - FOLGA_PONTEIRO - caixa.largura;

  const cabeAbaixo = pos.y + FOLGA_PONTEIRO + caixa.altura <= viewport.altura - MARGEM_TELA;
  const yBruto = cabeAbaixo ? pos.y + FOLGA_PONTEIRO : pos.y - FOLGA_PONTEIRO - caixa.altura;

  const maxLeft = Math.max(MARGEM_TELA, viewport.largura - caixa.largura - MARGEM_TELA);
  const maxTop = Math.max(MARGEM_TELA, viewport.altura - caixa.altura - MARGEM_TELA);

  return {
    left: Math.min(Math.max(MARGEM_TELA, xBruto), maxLeft),
    top: Math.min(Math.max(MARGEM_TELA, yBruto), maxTop),
  };
}

/** Formata percentual para o tooltip: inteiro quando redondo, 1 casa quando quebrado. */
export function formataPercentual(pct: number): string {
  const arredondado = Math.round(pct * 10) / 10;
  if (Math.abs(arredondado - Math.round(arredondado)) < 1e-9) {
    return `${Math.round(arredondado)}%`;
  }
  return `${arredondado.toFixed(1).replace('.', ',')}%`;
}

export interface SerieParaTooltip {
  chave: string;
  nome: string;
  cor: string;
  valores: readonly (number | null)[];
}

function formataValorDaSerie(valor: number, tipo: TipoDeValor, casas: number | null): string {
  if (tipo === 'number' || tipo === null) {
    return formata(valor, 'number', casas !== null ? { casas } : undefined).texto;
  }
  return formata(valor, tipo).texto;
}

function proporcaoSegura(valor: number, referencia: number): number {
  if (referencia <= 0 || valor <= 0) return 0;
  return Math.min(1, valor / referencia);
}

function referenciaDaBarra(
  empilhaOuPercentual: boolean,
  somaPositiva: number,
  maxCategoria: number,
  qtdSeries: number,
  maxReferencia?: number,
): number {
  if (empilhaOuPercentual) return somaPositiva;
  if (qtdSeries === 1 && maxReferencia && maxReferencia > 0) return maxReferencia;
  return maxCategoria;
}

/**
 * Monta o tooltip de uma categoria de `Grafico.tsx` (colunas empilhadas, 100% empilhadas,
 * colunas agrupadas, linhas ou combos).
 */
export function montaTooltipDeCategoria(params: {
  rotulo: string;
  series: readonly SerieParaTooltip[];
  indice: number;
  empilha: boolean;
  percentual: boolean;
  tipo: TipoDeValor;
  casas: number | null;
  podeClicar: boolean;
  maxReferencia?: number;
}): DadosDoTooltip | null {
  const { rotulo, series, indice, empilha, percentual, tipo, casas, podeClicar } = params;
  const presentes = series
    .map((serie) => ({ serie, valor: serie.valores[indice] ?? null }))
    .filter(
      (entrada): entrada is { serie: SerieParaTooltip; valor: number } => entrada.valor !== null,
    );

  if (presentes.length === 0) return null;

  const ordenados =
    presentes.length > 1
      ? [...presentes].sort((primeiro, segundo) => segundo.valor - primeiro.valor)
      : presentes;

  const somaPositiva = ordenados.reduce((acc, item) => acc + Math.max(0, item.valor), 0);
  const maxCategoria = ordenados.reduce((acc, item) => Math.max(acc, Math.max(0, item.valor)), 0);
  const refBarra = referenciaDaBarra(
    empilha || percentual,
    somaPositiva,
    maxCategoria,
    ordenados.length,
    params.maxReferencia,
  );

  const itens: ItemDoTooltip[] = ordenados.map(({ serie, valor }) => {
    const proporcao = proporcaoSegura(valor, refBarra);
    if (percentual) {
      const pct = somaPositiva > 0 ? (Math.max(0, valor) / somaPositiva) * 100 : 0;
      return {
        chave: serie.chave,
        nome: serie.nome,
        cor: serie.cor,
        valorTexto: formataPercentual(pct),
        detalheTexto: formataValorDaSerie(valor, tipo, casas),
        proporcao,
      };
    }
    const detalhe =
      empilha && ordenados.length > 1 && somaPositiva > 0
        ? formataPercentual((Math.max(0, valor) / somaPositiva) * 100)
        : undefined;
    return {
      chave: serie.chave,
      nome: serie.nome,
      cor: serie.cor,
      valorTexto: formataValorDaSerie(valor, tipo, casas),
      detalheTexto: detalhe,
      proporcao,
    };
  });

  const mostraTotal = (empilha || percentual) && ordenados.length > 1;
  return {
    titulo: rotulo,
    subtitulo: percentual ? '100% empilhado' : undefined,
    itens,
    totalTexto: mostraTotal ? formataValorDaSerie(somaPositiva, tipo, casas) : undefined,
    dica: podeClicar ? 'Clique para filtrar' : undefined,
  };
}

/** Monta o tooltip de uma fatia de `Rosca.tsx`. */
export function montaTooltipDeRosca(params: {
  rotulo: string;
  valor: number;
  cor: string;
  total: number;
}): DadosDoTooltip {
  const { rotulo, valor, cor, total } = params;
  const proporcao = proporcaoSegura(valor, total);
  return {
    titulo: rotulo,
    itens: [
      {
        chave: rotulo,
        nome: 'Participação',
        cor,
        valorTexto: inteiro(valor),
        detalheTexto: formataPercentual(proporcao * 100),
        proporcao,
      },
    ],
    totalTexto: inteiro(total),
  };
}

/** Monta o tooltip de uma linha de `RankingBarra.tsx`. */
export function montaTooltipDeRanking(params: {
  rotulo: string;
  valor: number | null;
  posicao: number;
  totalItens: number;
  maior: number;
  somaTotal: number;
  cor: string;
  tipo: TipoDeValor;
  nomeMedida: string | null;
  podeClicar: boolean;
}): DadosDoTooltip | null {
  const {
    rotulo,
    valor,
    posicao,
    totalItens,
    maior,
    somaTotal,
    cor,
    tipo,
    nomeMedida,
    podeClicar,
  } = params;
  if (valor === null) return null;

  const proporcao = proporcaoSegura(valor, maior);
  const participacao =
    somaTotal > 0 && valor > 0 ? formataPercentual((valor / somaTotal) * 100) : undefined;
  return {
    titulo: rotulo,
    subtitulo: `${posicao}º de ${inteiro(totalItens)}`,
    itens: [
      {
        chave: rotulo,
        nome: nomeMedida || 'Valor',
        cor,
        valorTexto: formata(valor, tipo).texto,
        detalheTexto: participacao,
        proporcao,
      },
    ],
    dica: podeClicar ? 'Clique para filtrar' : undefined,
  };
}
