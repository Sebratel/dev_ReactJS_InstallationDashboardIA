// @vitest-environment jsdom
//
// A lista de sessões da tela "Acessos" (S2 de docs/PLANO-SEGURANCA.md): mostra quem, de
// onde e até quando; "Derrubar" manda o e-mail para `/api/admin/sessoes/derruba` e a
// lista passa a ser a que o servidor devolveu.

import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessoesAtivas } from '../src/components/acessos/SessoesAtivas.tsx';
import type { SessaoAtiva } from '../src/services/acessoService.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sessao = (usuario: string, ip: string): SessaoAtiva => ({
  usuario,
  ip,
  criadaEm: '2026-10-14T11:00:00.000Z',
  ultimoUso: '2026-10-14T12:00:00.000Z',
  expiraEm: '2026-10-14T19:00:00.000Z',
});

function monta() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SessoesAtivas eu="chefe@sebratel.com.br" />
    </QueryClientProvider>,
  );
}

test('lista as sessões com IP; "Derrubar" posta o e-mail e mostra a lista nova', async () => {
  const pedidos: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      pedidos.push({ url, ...(init ? { init } : {}) });
      if (url === '/api/admin/sessoes/derruba') {
        return new Response(
          JSON.stringify({ derrubadas: 1, sessoes: [sessao('chefe@sebratel.com.br', '10.0.0.1')] }),
        );
      }
      return new Response(
        JSON.stringify({
          sessoes: [
            sessao('chefe@sebratel.com.br', '10.0.0.1'),
            sessao('fulano@sebratel.com.br', '10.0.0.9'),
          ],
        }),
      );
    }),
  );
  monta();
  expect(await screen.findByText('fulano@sebratel.com.br')).toBeTruthy();
  expect(screen.getByText('10.0.0.9')).toBeTruthy();
  expect(screen.getByText('Sessões abertas (2)')).toBeTruthy();

  const botoes = screen.getAllByRole('button', { name: 'Derrubar' });
  fireEvent.click(botoes[1]!);
  await waitFor(() => expect(screen.queryByText('fulano@sebratel.com.br')).toBeNull());

  const post = pedidos.find((p) => p.url === '/api/admin/sessoes/derruba');
  expect(post?.init?.method).toBe('POST');
  expect(JSON.parse(String(post?.init?.body))).toEqual({ email: 'fulano@sebratel.com.br' });
  expect(screen.getByText('Sessões abertas (1)')).toBeTruthy();
});

test('403 do servidor aparece como erro, não como lista vazia', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ erro: 'Só administrador vê e derruba sessões.' }), {
          status: 403,
        }),
    ),
  );
  monta();
  expect(await screen.findByText('Só administrador vê e derruba sessões.')).toBeTruthy();
});
