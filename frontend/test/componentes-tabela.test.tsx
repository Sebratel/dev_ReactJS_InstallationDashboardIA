// @vitest-environment jsdom
//
// A `Tabela` sobrevive a perder e recuperar os dados entre dois renders.
//
// Até a fase 4 ela chamava `useState`/`useMemo` DEPOIS do `return` de "sem dados"
// (ACHADOS #181): no render sem dados aqueles hooks não rodavam, e o React derrubava a
// árvore com "Rendered more hooks than during the previous render". O ESLint pega a
// forma do defeito; este teste pega o efeito.

import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render as renderSemCache,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Tabela } from '../src/components/visuais/Tabela.tsx';
import type { DadosDeTabela, VisualCalculado } from '../src/services/dashboardService.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// A `Tabela` pagina pelo React Query (`useJanela`); a primeira janela é a própria
// resposta da página, então nenhum pedido sai daqui.
const render = (ui: ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const envolve = (el: ReactElement) => <QueryClientProvider client={qc}>{el}</QueryClientProvider>;
  const r = renderSemCache(envolve(ui));
  return { ...r, rerender: (el: ReactElement) => r.rerender(envolve(el)) };
};

const dados: DadosDeTabela = {
  colunas: [
    { nome: 'Protocolo', tipo: 'string', chave: true, tabela: null, coluna: null },
    { nome: 'Data', tipo: 'date', chave: true, tabela: null, coluna: null },
  ],
  linhas: [
    ['P1', '2026-10-01T00:00:00.000Z'],
    ['P2', '2026-10-02T00:00:00.000Z'],
  ],
  linhasTotais: 2,
  de: 0,
  filtros: [],
};

const visual = (d: DadosDeTabela | undefined): VisualCalculado =>
  ({
    id: 'v1',
    tipo: 'tableEx',
    posicao: null,
    titulo: 'Protocolos',
    conteudo: 'tabela',
    dados: d,
    ms: 0,
  }) as never;

test('dados → sem dados → dados, sem derrubar a árvore', () => {
  const { rerender } = render(<Tabela pagina="p" visual={visual(dados)} filtros={[]} />);
  expect(screen.getByText('P1')).toBeTruthy();

  rerender(<Tabela pagina="p" visual={visual(undefined)} filtros={[]} />);
  expect(screen.getByText('Sem dados disponíveis para a tabela.')).toBeTruthy();

  rerender(<Tabela pagina="p" visual={visual(dados)} filtros={[]} />);
  expect(screen.getByText('P2')).toBeTruthy();
});

test('abre ordenada pela primeira coluna de data, da mais nova para a mais velha', () => {
  render(<Tabela pagina="p" visual={visual(dados)} filtros={[]} />);
  const celulas = screen.getAllByText(/^P\d$/).map((e) => e.textContent);
  expect(celulas).toEqual(['P2', 'P1']);
});

test('voltar uma página na fronteira de duas fatias mostra as linhas de antes, não o começo', async () => {
  // 400 linhas: a abertura traz as 200 primeiras, o servidor manda as outras 200.
  const fatia = (de: number): DadosDeTabela => ({
    colunas: [{ nome: 'Protocolo', tipo: 'string', chave: true, tabela: null, coluna: null }],
    linhas: Array.from({ length: 200 }, (_, i) => [`P${de + i}`]),
    linhasTotais: 400,
    de,
    filtros: [],
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const de = Number(new URL(url, 'http://x').searchParams.get('de') ?? 0);
      return new Response(JSON.stringify({ visuais: [visual(fatia(de))] }));
    }),
  );
  render(<Tabela pagina="p" visual={visual(fatia(0))} filtros={[]} />);
  for (let i = 0; i < 10; i++) fireEvent.click(screen.getByText('próxima'));
  await waitFor(() => expect(screen.getByText('201–220 de 400 linhas')).toBeTruthy());
  expect(screen.getByText('P200')).toBeTruthy();

  fireEvent.click(screen.getByText('anterior'));
  await waitFor(() => expect(screen.getByText('181–200 de 400 linhas')).toBeTruthy());
  expect(screen.getByText('P180')).toBeTruthy();
});

// O clique na linha filtra pela primeira coluna COM ORIGEM, não por `colunas[0]`. A
// tabela que abre com a contagem (`.` = COUNT(Protocolo), origem `null`) mandava
// `Protocolo = 1` — a contagem no lugar do protocolo — e derrubava a página inteira
// no guarda de espécie (agendamento-field, 14/10/2026).
test('o clique pula a coluna de contagem e filtra pelo protocolo', () => {
  const comContagem: DadosDeTabela = {
    colunas: [
      { nome: '.', tipo: 'number', chave: false, tabela: null, coluna: null },
      {
        nome: 'Protocolo',
        tipo: 'string',
        chave: true,
        tabela: 'FIELD AGENDA',
        coluna: 'Protocolo',
      },
    ],
    linhas: [[1, '1848469']],
    linhasTotais: 1,
    de: 0,
    filtros: [],
  };
  const aoFiltrar = vi.fn();
  render(<Tabela pagina="p" visual={visual(comContagem)} filtros={[]} aoFiltrar={aoFiltrar} />);
  fireEvent.click(screen.getByText('1848469'));
  expect(aoFiltrar).toHaveBeenCalledWith([
    { tabela: 'FIELD AGENDA', coluna: 'Protocolo', nivel: null, valor: '1848469' },
  ]);
});

test('sem coluna com origem, a linha não é clicável', () => {
  render(<Tabela pagina="p" visual={visual(dados)} filtros={[]} aoFiltrar={vi.fn()} />);
  expect(screen.getByText('P1').closest('tr')!.className).not.toContain('linha-clicavel');
});
