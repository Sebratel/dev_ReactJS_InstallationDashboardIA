// @vitest-environment jsdom
//
// Regressão dos dois defeitos que obrigavam o usuário a dar refresh manual:
// 1) `usePaginaAberta` não repassava `meta: { tempoReal: true }` ao `useQuery`, então o
//    SSE e o relógio de 60s (`invalidaAbertura`) ignoravam a página aberta.
// 2) `ConteudoDoRelatorio` montava `VisualGridSection` com `visuais=[]` antes de
//    `paginaCalculada` chegar, disparando rajada de `VisualNaDobra`.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRef, type ReactNode } from 'react';

vi.hoisted(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: () => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
});

import { usePaginaAberta } from '../src/hooks/useDadosDaTela.ts';
import { ConteudoDoRelatorio } from '../src/pages/dashboard/ConteudoDoRelatorio.tsx';
import { chavesDeConsulta, type LayoutSpec } from '../src/services/dashboardService.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const layoutExemplo: LayoutSpec = {
  pagina: 'visao-geral',
  base: '02-visao-geral.spec.yaml',
  kpis: [],
  faixas: [
    {
      altura: 'grafico',
      colunas: [{ visual: 'v1', span: 12, render: 'grafico' }],
    },
  ],
  ocultos: [],
  improvements: [],
};

describe('atualização automática e abertura do relatório', () => {
  it('usePaginaAberta preserva meta.tempoReal e revalida quando SSE/relógio invalida', async () => {
    let chamadas = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        chamadas++;
        return new Response(
          JSON.stringify({
            id: 'visao-geral',
            dadoDe: `2026-11-23T18:0${chamadas}:00Z`,
            visuais: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => usePaginaAberta('visao-geral', layoutExemplo, [], []), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data?.dadoDe).toBe('2026-11-23T18:01:00Z'));
    expect(chamadas).toBe(1);

    // Simula exatamente o predicate de `invalidaAbertura` em `useTempoReal.ts`.
    await act(async () => {
      await qc.invalidateQueries({
        queryKey: chavesDeConsulta.pagina('visao-geral'),
        predicate: (query) => query.meta?.tempoReal === true,
      });
    });

    await waitFor(() => expect(result.current.data?.dadoDe).toBe('2026-11-23T18:02:00Z'));
    expect(chamadas).toBe(2);
  });

  it('ConteudoDoRelatorio não monta VisualNaDobra antes de paginaCalculada chegar', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { queryByText } = render(
      <QueryClientProvider client={qc}>
        <ConteudoDoRelatorio
          abaAberta="visao-geral"
          paginaCalculada={null}
          layout={layoutExemplo}
          visuais={[]}
          filtros={[]}
          clicados={[]}
          saude={null}
          quantidadeDeTelas={1}
          emConferencia={false}
          temErro={false}
          aoFiltrarAlvos={() => undefined}
          aoPreverAlvos={() => undefined}
          refDoEspacoAntesDosVisuais={createRef<HTMLDivElement>()}
        />
      </QueryClientProvider>,
    );

    expect(queryByText('fora da tela')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
