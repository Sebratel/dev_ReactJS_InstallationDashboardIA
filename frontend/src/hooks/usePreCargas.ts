// Os pré-carregamentos que não são da página aberta: as outras páginas em segundo
// plano, a aba sob o cursor e o clique sob o cursor (barra de gráfico e valor de
// filtro). Nenhum mexe em estado visível: só deixam a resposta no cache do React Query
// para o clique achá-la pronta. A vizinhança do estado é outro hook (`useVizinhanca`).

import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  DashboardDaLista,
  FiltroDaTela,
  LayoutSpec,
  Valor,
} from '../services/dashboardService.ts';
import { filtrosPadrao } from '../utils/filtrosPadrao.ts';
import type { AlvoDeFiltro, CampoClicado } from '../utils/rota.ts';
import { consultaDaAbertura, preCarregaAbertura } from './useDadosDaTela.ts';
import { aplicaClique, aplicaSeletor } from './useEstadoDaTela.ts';

export interface PreCargas {
  /** A aba sob o cursor (FASE L5, R6). */
  prefetchaPagina: (id: string) => void;
  cancelaPrefetch: () => void;
  /** A barra/categoria clicável sob o cursor, num gráfico já aberto. */
  aoPreverAlvos: (alvos: readonly AlvoDeFiltro[]) => void;
  /** O chip ou a opção de seletor sob o cursor (ACHADOS #179). */
  aoPreverFiltro: (tabela: string, coluna: string, valores: Valor[], nivel?: string | null) => void;
  /** O "Limpar filtros" sob o cursor: a página sem filtro nenhum. */
  aoPreverLimpeza: () => void;
}

/** Em touch, hover e clique chegam quase juntos — sem esta guarda, todo toque
 *  dispararia DOIS pedidos (o prefetch e o de verdade) em vez de um adiantado. */
const temCursor = (): boolean => window.matchMedia('(pointer: fine)').matches;

export function usePreCargas(
  paginas: readonly DashboardDaLista[] | undefined,
  atual: string | null,
  layout: LayoutSpec | null,
  filtros: FiltroDaTela[],
  clicados: CampoClicado[],
): PreCargas {
  const qc = useQueryClient();

  // Pré-carregamento em segundo plano, sequencial, das outras páginas prontas —
  // depois de a página inicial abrir, para não disputar a API com ela. Uma vez por
  // carga da tela.
  const paginaInicial = useRef(atual);
  const fundoIniciado = useRef(false);
  useEffect(() => {
    if (!paginas || fundoIniciado.current) return;
    fundoIniciado.current = true;
    const inicial =
      paginaInicial.current ?? paginas.find((d) => d.pronta)?.id ?? paginas[0]?.id ?? null;
    void (async () => {
      // Pequena pausa para a página em exibição carregar com prioridade máxima
      await new Promise((resolve) => setTimeout(resolve, 800));
      for (const d of paginas) {
        if (!d.pronta || d.id === inicial) continue;
        try {
          await preCarregaAbertura(qc, d.id, filtrosPadrao(d.id));
          // Intervalo leve entre páginas de fundo para manter a API responsiva
          await new Promise((resolve) => setTimeout(resolve, 300));
        } catch {
          // Pré-carregamento em background silencioso
        }
      }
    })();
  }, [paginas, qc]);

  // FASE L5, R6 — a aba sob o cursor.
  const timeoutHover = useRef<number | null>(null);
  const cancelaPrefetch = useCallback(() => {
    if (timeoutHover.current !== null) {
      window.clearTimeout(timeoutHover.current);
      timeoutHover.current = null;
    }
  }, []);
  const prefetchaPagina = useCallback(
    (id: string) => {
      if (!temCursor()) return;
      cancelaPrefetch();
      // "Intenção de hover": só adianta o pedido se o mouse ficar parado ali um
      // instante — um mouse só de passagem por cima de várias abas não pode disparar
      // uma rajada de prefetch, um por aba.
      timeoutHover.current = window.setTimeout(() => {
        timeoutHover.current = null;
        // Prefetch é otimização: falhar aqui não pode aparecer em lugar nenhum visível.
        // O clique real tenta de novo e, se falhar, é ELE que mostra o erro.
        preCarregaAbertura(qc, id, filtrosPadrao(id)).catch(() => undefined);
      }, 60);
    },
    [cancelaPrefetch, qc],
  );

  // HOVER-PREFETCH DO CLIQUE — a mesma ideia, um nível mais fundo: a barra/categoria de
  // um gráfico já aberto, ou um valor de filtro.
  //
  // Pedido do usuário em 09/09/2026: clicar num técnico (94 categorias no ranking)
  // media ~1,5 s de resposta — sempre, e só no PRIMEIRO clique naquele técnico. O
  // servidor guarda por combinação EXATA de filtro+clicado, então toda combinação nova
  // recalcula a página. Não dá para aquecer as 94 de uma vez, mas o intervalo entre o
  // mouse pousar e o clique de verdade é sobra para adiantar exatamente a combinação
  // que a pessoa está mirando. O React Query junta o pedido a caminho com o do clique.
  //
  // A previsão repete a conta do clique de verdade (`aplicaClique`, `aplicaSeletor`):
  // outra conta daria outra URL, e o pré-carregamento encheria uma chave que o clique
  // nunca lê.
  const timeoutHoverClique = useRef<number | null>(null);
  const prefetchaPrevisao = useCallback(
    (prever: () => { filtros: FiltroDaTela[]; clicados: CampoClicado[] }) => {
      if (!temCursor() || !atual || !layout) return;
      if (timeoutHoverClique.current !== null) window.clearTimeout(timeoutHoverClique.current);
      timeoutHoverClique.current = window.setTimeout(() => {
        timeoutHoverClique.current = null;
        const p = prever();
        void qc.prefetchQuery(consultaDaAbertura(atual, layout, p.filtros, p.clicados));
      }, 150);
    },
    [atual, layout, qc],
  );

  const aoPreverAlvos = useCallback(
    (alvos: readonly AlvoDeFiltro[]) =>
      prefetchaPrevisao(() => aplicaClique(filtros, clicados, alvos, filtrosPadrao(atual))),
    [prefetchaPrevisao, atual, filtros, clicados],
  );

  const aoPreverFiltro = useCallback(
    (tabela: string, coluna: string, valores: Valor[], nivel?: string | null) =>
      prefetchaPrevisao(() => aplicaSeletor(filtros, clicados, tabela, coluna, valores, nivel)),
    [prefetchaPrevisao, filtros, clicados],
  );

  const aoPreverLimpeza = useCallback(
    () => prefetchaPrevisao(() => ({ filtros: [], clicados: [] })),
    [prefetchaPrevisao],
  );

  return { prefetchaPagina, cancelaPrefetch, aoPreverAlvos, aoPreverFiltro, aoPreverLimpeza };
}
