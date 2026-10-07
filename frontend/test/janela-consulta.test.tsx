// @vitest-environment jsdom
//
// `useJanela` no React Query: a primeira janela é a resposta da página (sem pedido), a
// janela seguinte e a busca pedem só este visual, uma resposta atrasada de um pedido
// abandonado não pinta por cima da atual, e a página recalculada volta ao começo.

import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useJanela } from '../src/hooks/useJanela.ts';
import type { VisualCalculado } from '../src/services/dashboardService.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const visual = (de: number, rotulo = ''): VisualCalculado =>
  ({ id: 'v1', tipo: 'tableEx', dados: { de, rotulo } }) as never;

/** `fetch` falso: cada pedido fica pendente até o teste responder por `responde(url)`. */
function fetchFalso() {
  const pendentes = new Map<string, (v: VisualCalculado) => void>();
  const urls: string[] = [];
  const abortados: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: { signal?: AbortSignal }) => {
      urls.push(url);
      return new Promise((ok, falha) => {
        init?.signal?.addEventListener('abort', () => {
          abortados.push(url);
          falha(new DOMException('abortado', 'AbortError'));
        });
        pendentes.set(url, (v) => ok(new Response(JSON.stringify({ visuais: [v] }))));
      });
    }),
  );
  const responde = async (trecho: string, v: VisualCalculado) => {
    // A busca é o último parâmetro da URL: `busca=178` só casa com o fim exato.
    const url = [...pendentes.keys()].find((u) => u.includes(trecho + '&') || u.endsWith(trecho))!;
    await act(async () => pendentes.get(url)!(v));
  };
  return { urls, abortados, responde };
}

function monta(inicial: VisualCalculado, termo = '') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const envolve = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(
    (p: { inicial: VisualCalculado; termo: string }) => useJanela('pg', p.inicial, [], p.termo),
    { wrapper: envolve, initialProps: { inicial, termo } },
  );
}

test('a primeira janela é a resposta da página: nada é pedido', () => {
  const f = fetchFalso();
  const inicial = visual(0);
  const { result } = monta(inicial);
  expect(result.current.visual).toBe(inicial);
  expect(result.current.carregando).toBe(false);
  expect(f.urls).toEqual([]);
});

test('a janela seguinte pede só este visual e mantém a atual até chegar', async () => {
  const f = fetchFalso();
  const inicial = visual(0);
  const { result } = monta(inicial);
  act(() => result.current.vaiPara(200));
  await waitFor(() => expect(f.urls).toHaveLength(1));
  expect(f.urls[0]).toContain('visual=v1');
  expect(f.urls[0]).toContain('de=200');
  expect(result.current.visual).toBe(inicial);
  expect(result.current.carregando).toBe(true);
  await f.responde('de=200', visual(200));
  await waitFor(() => expect(result.current.visual.dados).toEqual({ de: 200, rotulo: '' }));
  expect(result.current.carregando).toBe(false);
  // Voltar ao começo é a resposta da página, na hora.
  act(() => result.current.vaiPara(0));
  expect(result.current.visual).toBe(inicial);
});

test('resposta atrasada de uma busca abandonada não pinta por cima da atual', async () => {
  const f = fetchFalso();
  const inicial = visual(0);
  const { result, rerender } = monta(inicial, '178');
  await waitFor(() => expect(f.urls).toHaveLength(1));
  rerender({ inicial, termo: '1784218' });
  await waitFor(() => expect(f.urls).toHaveLength(2));
  await f.responde('busca=1784218', visual(0, 'novo'));
  await waitFor(() => expect(result.current.visual.dados).toEqual({ de: 0, rotulo: 'novo' }));
  // O pedido de `178` foi cancelado ao trocar a chave; responder depois não muda nada.
  expect(f.abortados).toContain(f.urls[0]);
  await f.responde('busca=178', visual(0, 'velho'));
  await new Promise((r) => setTimeout(r, 30));
  expect(result.current.visual.dados).toEqual({ de: 0, rotulo: 'novo' });
});

test('a página recalculada volta a janela ao começo', async () => {
  const f = fetchFalso();
  const { result, rerender } = monta(visual(0));
  act(() => result.current.vaiPara(400));
  await waitFor(() => expect(f.urls).toHaveLength(1));
  await f.responde('de=400', visual(400));
  await waitFor(() => expect(result.current.visual.dados).toEqual({ de: 400, rotulo: '' }));
  const nova = visual(0, 'recalculada');
  rerender({ inicial: nova, termo: '' });
  expect(result.current.visual).toBe(nova);
});

test('limpar a busca volta ao começo, e não à janela de antes da busca', async () => {
  const f = fetchFalso();
  const inicial = visual(0);
  const { result, rerender } = monta(inicial);
  act(() => result.current.vaiPara(200));
  await waitFor(() => expect(f.urls).toHaveLength(1));
  await f.responde('de=200', visual(200));
  await waitFor(() => expect(result.current.visual.dados).toEqual({ de: 200, rotulo: '' }));
  rerender({ inicial, termo: 'x' });
  rerender({ inicial, termo: '' });
  expect(result.current.visual).toBe(inicial);
});
