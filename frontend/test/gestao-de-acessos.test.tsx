// @vitest-environment jsdom
//
// A aba PERMISSÕES: mexer na matriz NÃO grava — a linha fica marcada e o rodapé lista o
// que vai mudar; só "Salvar alterações" posta, um pedido por diferença; "Descartar"
// volta ao que está no banco.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestaoDeAcessos } from '../src/components/acessos/GestaoDeAcessos.tsx';
import type { MatrizDeAcesso } from '../src/services/acessoService.ts';
import { useRascunhoDeAcessos } from '../src/store/rascunhoDeAcessosStore.ts';

const MATRIZ: MatrizDeAcesso = {
  eu: { usuario: 'chefe@sebratel.com.br', papel: 'admin' },
  telas: [
    { id: 'visao-geral', nome: 'VISÃO GERAL', modo: 'lista' },
    { id: 'diario', nome: 'DIÁRIO', modo: 'lista' },
  ],
  pessoas: [{ email: 'ana@sebratel.com.br', papel: 'viewer', fixo: false, telas: ['visao-geral'] }],
  pedidos: [],
  banco: { ok: true, origem: 'banco' },
};

let posts: { url: string; corpo: unknown }[] = [];

beforeEach(() => {
  posts = [];
  useRascunhoDeAcessos.getState().descarta();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const corpo: unknown = JSON.parse(String(init.body));
        posts.push({ url, corpo });
        return new Response(
          JSON.stringify({
            ...MATRIZ,
            pessoas: [{ ...MATRIZ.pessoas[0]!, ...(corpo as object) }],
          }),
        );
      }
      if (url === '/api/admin/sessoes') return new Response(JSON.stringify({ sessoes: [] }));
      if (url === '/api/admin/uso?dias=30') {
        return new Response(
          JSON.stringify({
            dias: 30,
            pessoasAtivas: 1,
            geradoEm: '2026-10-15T12:00:00.000Z',
            telas: [
              {
                id: 'visao-geral',
                nome: 'VISÃO GERAL',
                aberturas: 4,
                pessoas: 1,
                ultimaAbertura: '2026-10-15T12:00:00.000Z',
              },
              { id: 'diario', nome: 'DIÁRIO', aberturas: 0, pessoas: 0, ultimaAbertura: null },
            ],
          }),
        );
      }
      return new Response(JSON.stringify(MATRIZ));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function monta() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GestaoDeAcessos />
    </QueryClientProvider>,
  );
}

test('marcar a caixa não grava; só "Salvar alterações" posta', async () => {
  monta();
  const caixa = await screen.findByLabelText('ana@sebratel.com.br abre DIÁRIO');
  const salvar = screen.getByRole('button', { name: 'Salvar alterações' }) as HTMLButtonElement;
  expect(salvar.disabled).toBe(true);
  expect(screen.getByText('Nenhuma alteração pendente.')).toBeTruthy();

  fireEvent.click(caixa);
  expect(posts).toEqual([]);
  expect(screen.getByText('1 alteração(ões) por salvar')).toBeTruthy();
  expect(screen.getByText('ana@sebratel.com.br: VISÃO GERAL, DIÁRIO')).toBeTruthy();
  expect(useRascunhoDeAcessos.getState().pendentes).toBe(1);

  fireEvent.click(salvar);
  await waitFor(() => expect(screen.getByText('Nenhuma alteração pendente.')).toBeTruthy());
  expect(posts).toEqual([
    {
      url: '/api/admin/acessos/pessoa',
      corpo: { email: 'ana@sebratel.com.br', telas: ['visao-geral', 'diario'] },
    },
  ]);
});

test('mostra KPIs e a aba sem abertura no cartão de uso', async () => {
  monta();
  expect(await screen.findByText('Mais aberta')).toBeTruthy();
  expect(screen.getByText('Sem abertura')).toBeTruthy();
  expect(screen.getByText('Nunca no período')).toBeTruthy();
  expect(screen.getByRole('combobox', { name: 'Período do uso das abas' })).toBeTruthy();
});

test('"Descartar" volta ao que está no banco sem postar nada', async () => {
  monta();
  const caixa = (await screen.findByLabelText(
    'ana@sebratel.com.br abre DIÁRIO',
  )) as HTMLInputElement;
  fireEvent.click(caixa);
  expect(caixa.checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
  expect(caixa.checked).toBe(false);
  expect(screen.getByText('Nenhuma alteração pendente.')).toBeTruthy();
  expect(posts).toEqual([]);
});

test('a lixeira só marca a remoção; o pedido sai no salvar', async () => {
  monta();
  fireEvent.click(await screen.findByLabelText('Remover ana@sebratel.com.br'));
  expect(posts).toEqual([]);
  expect(screen.getByText('ana@sebratel.com.br: perde todos os acessos')).toBeTruthy();
  expect(screen.getByLabelText('Manter ana@sebratel.com.br')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
  await waitFor(() =>
    expect(posts).toEqual([
      { url: '/api/admin/acessos/remove', corpo: { email: 'ana@sebratel.com.br' } },
    ]),
  );
});
