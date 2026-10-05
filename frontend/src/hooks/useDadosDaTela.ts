// O estado do servidor que a tela lê, no React Query (fase 2 de
// `docs/PLANO-PADROES-FRONTEND.md`). Substitui os caches feitos à mão do `App.tsx`:
// `layoutsVistos`, `paginasVistas`, o `useState` da saúde e os efeitos que os enchiam.
//
// Quem diz que um dado mudou é o servidor (`/api/eventos`), com `invalidateQueries`:
// por isso nada aqui envelhece sozinho (`staleTime: Infinity`, ver `queryClient.ts`).
// Uma consulta invalidada que está na tela busca de novo MANTENDO o dado atual — nunca
// volta para o esqueleto (`feedback-tudo-pre-carregado`).

import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import {
  chavesDeConsulta,
  listaDashboards,
  pegaLayout,
  pegaPagina,
  pegaSaude,
  pegaValores,
  urlDaPagina,
  type FiltroDaTela,
  type LayoutSpec,
} from '../services/dashboardService.ts';
import { idsIniciais } from '../utils/cargaProgressiva.ts';

type Clicados = readonly { tabela: string; coluna: string }[];

/** A lista de páginas. As páginas de DICA (`tooltip`) saem aqui — ver `App.tsx`. */
export function useDashboards() {
  return useQuery({
    queryKey: chavesDeConsulta.dashboards,
    queryFn: () => listaDashboards(),
    select: (r) => r.dashboards.filter((d) => d.tooltip !== true),
  });
}

/** A forma da página: não depende de filtro nem de clique, e não muda em runtime. */
export function useLayout(id: string | null) {
  return useQuery({
    queryKey: chavesDeConsulta.layout(id ?? ''),
    queryFn: ({ signal }) => pegaLayout(id!, signal),
    enabled: id !== null,
  });
}

/**
 * A chave e a busca da ABERTURA de uma página (os visuais acima da dobra). Uma função
 * só para o efeito da tela e os três pré-carregamentos (fundo, aba sob o cursor e barra
 * sob o cursor): duas montagens da mesma chave divergiriam, e o pré-carregamento
 * encheria uma entrada que a tela nunca lê.
 */
export function consultaDaAbertura(
  id: string,
  layout: LayoutSpec,
  filtros: readonly FiltroDaTela[],
  clicados: Clicados,
  /** Só a vizinhança passa: ver `pegaPagina`. A chave é a mesma com ou sem. */
  origem?: 'prefetch',
) {
  const opcoes = { visuais: idsIniciais(layout) };
  return {
    queryKey: chavesDeConsulta.pagina(id, urlDaPagina(id, filtros, opcoes, clicados)),
    queryFn: ({ signal }: { signal: AbortSignal }) => pegaPagina(id, filtros, opcoes, signal, clicados, origem),
  };
}

/**
 * A abertura da página aberta. `placeholderData` mantém a página anterior na tela
 * enquanto a combinação nova chega — o que o `App.tsx` fazia com
 * `setCarregando(pagina === null)`. Quem lê confere o `id` (`paginaValida`): o dado de
 * OUTRA página nunca é mostrado como se fosse desta.
 */
export function usePaginaAberta(
  id: string | null,
  layout: LayoutSpec | undefined,
  filtros: readonly FiltroDaTela[],
  clicados: Clicados,
) {
  const consulta = id && layout ? consultaDaAbertura(id, layout, filtros, clicados) : null;
  return useQuery({
    queryKey: consulta?.queryKey ?? chavesDeConsulta.pagina('', ''),
    queryFn: consulta?.queryFn ?? (() => Promise.reject(new Error('sem página'))),
    enabled: consulta !== null,
    placeholderData: keepPreviousData,
  });
}

/**
 * A saúde das cargas. A cada 2 min, independente do resto: com a tela parada, é o
 * único jeito de perceber que o dado PAROU — parado é justamente não chegar aviso
 * nenhum (ACHADOS #160).
 */
export function useSaude() {
  return useQuery({
    queryKey: chavesDeConsulta.saude,
    queryFn: ({ signal }) => pegaSaude(signal),
    refetchInterval: 120_000,
  });
}

/** Pré-carrega a abertura de uma página com os filtros dela, sem tocar na tela. */
export async function preCarregaAbertura(
  qc: QueryClient,
  id: string,
  filtros: readonly FiltroDaTela[],
  clicados: Clicados = [],
): Promise<void> {
  const layout = await qc.fetchQuery({
    queryKey: chavesDeConsulta.layout(id),
    queryFn: ({ signal }) => pegaLayout(id, signal),
  });
  await qc.prefetchQuery(consultaDaAbertura(id, layout, filtros, clicados));
}

/**
 * Os valores de uma segmentação. Buscados de novo só no "Atualizar"
 * (`invalidateQueries(['valores', página])`): a lista muda raramente, e buscá-la a cada
 * aviso do servidor seria trabalho dele por nada. Enquanto busca de novo, a lista atual
 * fica na tela; só uma segmentação DIFERENTE começa vazia.
 */
export function useValoresDaSegmentacao(pagina: string, tabela: string, coluna: string, nivel?: string | null) {
  const q = useQuery({
    queryKey: chavesDeConsulta.valores(pagina, tabela, coluna, nivel),
    queryFn: ({ signal }) => pegaValores(pagina, tabela, coluna, nivel ?? undefined, signal),
  });
  return {
    opcoes: q.data?.valores ?? null,
    cortado: q.data?.cortado ?? false,
    erro: q.error ? (q.error instanceof Error ? q.error.message : String(q.error)) : null,
  };
}
