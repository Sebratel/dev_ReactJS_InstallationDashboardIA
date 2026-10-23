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
  type PaginaCalculada,
} from '../services/dashboardService.ts';
import { idsIniciais } from '../utils/cargaProgressiva.ts';
import { consultaDoVisual } from './useVisualSobDemanda.ts';

type Clicados = readonly { tabela: string; coluna: string }[];

/** Quem está logado — sai do MESMO pedido da lista de páginas (mesma chave), sem rede a mais. */
export function useEu() {
  return useQuery({
    queryKey: chavesDeConsulta.dashboards,
    queryFn: () => listaDashboards(),
    select: (r) => r.eu ?? null,
  });
}

/** A lista de páginas — só as que a conta pode abrir (filtro do servidor). As páginas
 *  de DICA (`tooltip`) saem aqui — ver `App.tsx`. */
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
    meta: { tempoReal: true },
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      pegaPagina(id, filtros, opcoes, signal, clicados, origem),
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

/** Os visuais que o servidor deixou fora da abertura por serem caros (`sobDemanda`). */
export function idsSobDemanda(p: PaginaCalculada | null | undefined): string[] {
  return (p?.visuais ?? []).filter((v) => v.sobDemanda).map((v) => v.id);
}

/**
 * Pré-carrega um ESTADO inteiro da tela: a abertura e, quando ela volta, os visuais
 * `sobDemanda` dela.
 *
 * **O defeito (20/10/2026, teste de cliques no staging).** O pré-carregamento (hover e
 * vizinhança) enchia só a chave da abertura. Os visuais caros — 5 na
 * `agendamento-field` — ficavam de fora, e o clique "adiantado" ainda esperava cada um
 * deles: 6 pedidos em `miss`, até 11 s. Com `origem`, os visuais vão um por vez, para a
 * vizinhança não virar rajada; sem ela (hover), juntos, porque o clique vem logo.
 */
export async function preCarregaEstado(
  qc: QueryClient,
  id: string,
  layout: LayoutSpec,
  filtros: readonly FiltroDaTela[],
  clicados: Clicados,
  origem?: 'prefetch',
): Promise<void> {
  const p = await qc.fetchQuery(consultaDaAbertura(id, layout, filtros, clicados, origem));
  const visuais = idsSobDemanda(p).map(
    (v) => () => qc.prefetchQuery(consultaDoVisual(id, v, filtros, clicados, origem)),
  );
  if (origem) for (const busca of visuais) await busca();
  else await Promise.all(visuais.map((busca) => busca()));
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
  await preCarregaEstado(qc, id, layout, filtros, clicados);
}

/**
 * Os valores de uma segmentação. Buscados de novo só no "Atualizar"
 * (`invalidateQueries(['valores', página])`): a lista muda raramente, e buscá-la a cada
 * aviso do servidor seria trabalho dele por nada. Enquanto busca de novo, a lista atual
 * fica na tela; só uma segmentação DIFERENTE começa vazia.
 */
export function useValoresDaSegmentacao(
  pagina: string,
  tabela: string,
  coluna: string,
  nivel?: string | null,
) {
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
