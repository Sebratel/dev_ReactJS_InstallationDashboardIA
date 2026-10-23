// @vitest-environment jsdom
//
// Os visuais `sobDemanda` no pré-carregamento e no clique (teste de cliques no staging,
// 20/10/2026): o estado pré-carregado inclui os visuais caros, e o clique os pede junto
// com a abertura em vez de esperar ela voltar.

import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { preCarregaEstado } from '../src/hooks/useDadosDaTela.ts';
import { useSobDemandaJunto } from '../src/hooks/useSobDemandaJunto.ts';
import { consultaDoVisual } from '../src/hooks/useVisualSobDemanda.ts';
import type { FiltroDaTela, LayoutSpec } from '../src/services/dashboardService.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LAYOUT = {
  pagina: 'pg',
  kpis: [],
  faixas: [{ altura: 'tabela', colunas: [{ visual: 'leve', span: 12 }] }],
  ocultos: [],
} as unknown as LayoutSpec;

/** Abertura (`visual=leve`) devolve um visual caro marcado `sobDemanda`; os demais, ele mesmo. */
function fetchFalso() {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      const ids = new URL(url, 'http://x').searchParams.getAll('visual');
      const visuais = ids.includes('leve')
        ? [
            { id: 'leve', tipo: 'card', dados: {} },
            { id: 'caro', tipo: 'tableEx', sobDemanda: ['FIELD AGENDA'] },
          ]
        : ids.map((id) => ({ id, tipo: 'tableEx', dados: {} }));
      return new Response(JSON.stringify({ id: 'pg', visuais }));
    }),
  );
  return urls;
}

const novoQc = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
const CIDADE: FiltroDaTela[] = [{ tabela: 'T', coluna: 'CIDADE', valores: ['Canoas'] }];

test('o estado pré-carregado inclui os visuais sobDemanda, com a mesma origem', async () => {
  const urls = fetchFalso();
  const qc = novoQc();
  await preCarregaEstado(qc, 'pg', LAYOUT, CIDADE, [], 'prefetch');
  const caro = urls.filter((u) => u.includes('visual=caro'));
  expect(caro).toHaveLength(1);
  expect(caro[0]).toContain('origem=prefetch');
  expect(qc.getQueryData(consultaDoVisual('pg', 'caro', CIDADE).queryKey)).toMatchObject({
    id: 'caro',
  });
});

test('no clique, os visuais caros saem junto, sem esperar a abertura', async () => {
  const urls = fetchFalso();
  const qc = novoQc();
  const envolve = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { rerender } = renderHook(
    (p: { filtros: FiltroDaTela[] }) => useSobDemandaJunto('pg', p.filtros, [], ['caro']),
    { wrapper: envolve, initialProps: { filtros: [] as FiltroDaTela[] } },
  );
  rerender({ filtros: CIDADE });
  await waitFor(() =>
    expect(urls.some((u) => u.includes('visual=caro') && u.includes('Canoas'))).toBe(true),
  );
  // Interativo: é a resposta do clique, não pré-carregamento de fundo.
  expect(urls.every((u) => !u.includes('origem='))).toBe(true);
});
