import {
  pegaPagina,
  type DadosDeMatriz,
  type DadosDeTabela,
  type FiltroDaTela,
  type PaginaCalculada,
  type Valor,
} from './dashboardService.ts';

// O lote casa com o teto por pedido do servidor (`LINHAS_MAXIMO`, calcula.ts): o
// visual é calculado INTEIRO a cada pedido, então cada lote a mais é a tabela toda
// recalculada. Pedir o máximo de uma vez faz a maioria das exportações caber numa
// requisição só — 1 cálculo em vez de N —, sem depender do cache de visual (que em
// produção tem orçamento pequeno e recusa as tabelas grandes). Medido em 21/10/2026:
// com 1.000, "Protocolos Distintos" (2.750 linhas) levava 6 lotes e ~80 s.
export const LINHAS_POR_LOTE_DE_EXPORTACAO = 5_000;

export interface ProgressoDeExportacao {
  baixadas: number;
  total: number;
}

export interface PedidoDeExportacao {
  pagina: string;
  visual: string;
  filtros: readonly FiltroDaTela[];
  busca?: string;
  aoProgredir?: (progresso: ProgressoDeExportacao) => void;
}

export type BuscaDeExportacao = (
  id: string,
  filtros: readonly FiltroDaTela[],
  opcoes: { visual: string; de: number; linhas: number; busca?: string },
  signal: AbortSignal | undefined,
  clicados: readonly { tabela: string; coluna: string }[],
  origem: 'export',
) => Promise<PaginaCalculada>;

type DadosPaginados = {
  linhas: Valor[][];
  linhasTotais: number;
  de: number;
};

function dadosDoVisual<T extends DadosPaginados>(
  pagina: PaginaCalculada,
  visual: string,
  valido: (dados: unknown) => dados is T,
): T {
  const encontrado = pagina.visuais.find((item) => item.id === visual);
  if (!encontrado || !valido(encontrado.dados)) {
    throw new Error('O visual não devolveu dados exportáveis. Atualize a tela e tente novamente.');
  }
  return encontrado.dados;
}

function ehTabela(dados: unknown): dados is DadosDeTabela {
  return (
    typeof dados === 'object' &&
    dados !== null &&
    Array.isArray((dados as DadosDeTabela).colunas) &&
    Array.isArray((dados as DadosDeTabela).linhas)
  );
}

function ehMatriz(dados: unknown): dados is DadosDeMatriz {
  return (
    typeof dados === 'object' &&
    dados !== null &&
    Array.isArray((dados as DadosDeMatriz).colunas) &&
    Array.isArray((dados as DadosDeMatriz).linhas) &&
    Array.isArray((dados as DadosDeMatriz).celulas)
  );
}

async function coletaEmLotes<T extends DadosPaginados>(
  pedido: PedidoDeExportacao,
  valido: (dados: unknown) => dados is T,
  buscaPagina: BuscaDeExportacao = pegaPagina,
): Promise<T[]> {
  const lotes: T[] = [];
  let de = 0;
  let total: number | undefined;
  let dadoDe: string | null | undefined;

  do {
    const pagina = await buscaPagina(
      pedido.pagina,
      pedido.filtros,
      {
        visual: pedido.visual,
        de,
        linhas: LINHAS_POR_LOTE_DE_EXPORTACAO,
        busca: pedido.busca || undefined,
      },
      undefined,
      [],
      'export',
    );
    const dados = dadosDoVisual(pagina, pedido.visual, valido);
    if (dados.de !== de || (dados.linhas.length === 0 && de < dados.linhasTotais)) {
      throw new Error('A exportação recebeu uma página incompleta. Tente novamente.');
    }
    if (total === undefined) {
      total = dados.linhasTotais;
      dadoDe = pagina.dadoDe;
    } else if (dados.linhasTotais !== total || pagina.dadoDe !== dadoDe) {
      throw new Error('Os dados foram atualizados durante a exportação. Tente novamente.');
    }
    lotes.push(dados);
    de += dados.linhas.length;
    pedido.aoProgredir?.({ baixadas: de, total });
  } while (de < (total ?? 0));

  return lotes;
}

export async function coletaTabelaCompleta(
  pedido: PedidoDeExportacao,
  buscaPagina?: BuscaDeExportacao,
): Promise<DadosDeTabela> {
  const lotes = await coletaEmLotes(pedido, ehTabela, buscaPagina);
  const primeiro = lotes[0]!;
  return {
    ...primeiro,
    de: 0,
    linhas: lotes.flatMap((lote) => lote.linhas),
  };
}

export async function coletaMatrizCompleta(
  pedido: PedidoDeExportacao,
  buscaPagina?: BuscaDeExportacao,
): Promise<DadosDeMatriz> {
  const lotes = await coletaEmLotes(pedido, ehMatriz, buscaPagina);
  const primeiro = lotes[0]!;
  return {
    ...primeiro,
    de: 0,
    linhas: lotes.flatMap((lote) => lote.linhas),
    celulas: lotes.flatMap((lote) => lote.celulas),
  };
}
