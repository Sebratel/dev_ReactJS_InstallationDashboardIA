// @vitest-environment jsdom
//
// `useAbaixoDaDobra`: depois da abertura, os visuais fora da dobra são pedidos um por
// vez, com `origem=prefetch`, na MESMA chave que o cartão lê ao aparecer — e o que um
// aviso do servidor invalidou é buscado de novo.

import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAbaixoDaDobra } from '../src/hooks/useAbaixoDaDobra.ts';
import { consultaDoVisual } from '../src/hooks/useVisualSobDemanda.ts';
import { chavesDeConsulta, type LayoutSpec } from '../src/services/dashboardService.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LAYOUT = {
  pagina: 'pg',
  kpis: [],
  // As `N_FAIXAS_EAGER` (4) primeiras vão na abertura; o resto é fora da dobra.
  faixas: [
    ...['topo1', 'topo2', 'topo3', 'topo4'].map((visual) => ({
      altura: 'grafico',
      colunas: [{ visual, span: 12 }],
    })),
    { altura: 'tabela', colunas: [{ visual: 'fim1', span: 12 }] },
    { altura: 'tabela', colunas: [{ visual: 'fim2', span: 12 }] },
  ],
  ocultos: [],
} as unknown as LayoutSpec;

/** `fetch` falso que responde o visual pedido em `?visual=` e conta quantos voam juntos. */
function fetchFalso() {
  const urls: string[] = [];
  let emVoo = 0;
  let maxEmVoo = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      emVoo++;
      maxEmVoo = Math.max(maxEmVoo, emVoo);
      await new Promise((r) => setTimeout(r, 5));
      emVoo--;
      const id = new URL(url, 'http://x').searchParams.get('visual');
      return new Response(JSON.stringify({ visuais: [{ id, tipo: 'tableEx', dados: {} }] }));
    }),
  );
  return { urls, maxEmVoo: () => maxEmVoo };
}

function monta(ativo: boolean) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const envolve = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const h = renderHook((p: { ativo: boolean }) => useAbaixoDaDobra('pg', LAYOUT, [], [], p.ativo), {
    wrapper: envolve,
    initialProps: { ativo },
  });
  return { qc, ...h };
}

test('nada sai enquanto a abertura não terminou', async () => {
  const f = fetchFalso();
  monta(false);
  await new Promise((r) => setTimeout(r, 30));
  expect(f.urls).toEqual([]);
});

test('pede só o que está fora da dobra, um por vez, como prefetch, na chave do cartão', async () => {
  const f = fetchFalso();
  const { qc } = monta(true);
  await waitFor(() => expect(f.urls).toHaveLength(2));
  expect(f.maxEmVoo()).toBe(1);
  expect(f.urls.every((u) => u.includes('origem=prefetch'))).toBe(true);
  expect(f.urls.some((u) => u.includes('visual=topo'))).toBe(false);
  for (const id of ['fim1', 'fim2']) {
    await waitFor(() =>
      expect(qc.getQueryData(consultaDoVisual('pg', id, []).queryKey)).toMatchObject({ id }),
    );
  }
});

test('o que o aviso do servidor invalidou é buscado de novo; o fresco não', async () => {
  const f = fetchFalso();
  const { qc, rerender } = monta(true);
  await waitFor(() => expect(f.urls).toHaveLength(2));
  await waitFor(() =>
    expect(qc.getQueryData(consultaDoVisual('pg', 'fim2', []).queryKey)).toBeTruthy(),
  );

  // A página recarrega (ativo cai e volta) sem aviso: nada de novo.
  rerender({ ativo: false });
  rerender({ ativo: true });
  await new Promise((r) => setTimeout(r, 30));
  expect(f.urls).toHaveLength(2);

  // O aviso do servidor invalida a página inteira, e com ela o fim da página.
  await qc.invalidateQueries({ queryKey: chavesDeConsulta.pagina('pg') });
  rerender({ ativo: false });
  rerender({ ativo: true });
  await waitFor(() => expect(f.urls).toHaveLength(4));
});
