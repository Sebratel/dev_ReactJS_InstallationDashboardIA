// @vitest-environment jsdom
//
// A `Tabela` sobrevive a perder e recuperar os dados entre dois renders.
//
// Até a fase 4 ela chamava `useState`/`useMemo` DEPOIS do `return` de "sem dados"
// (ACHADOS #181): no render sem dados aqueles hooks não rodavam, e o React derrubava a
// árvore com "Rendered more hooks than during the previous render". O ESLint pega a
// forma do defeito; este teste pega o efeito.

import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Tabela } from '../src/components/visuais/Tabela.tsx';
import type { DadosDeTabela, VisualCalculado } from '../src/services/dashboardService.ts';

afterEach(cleanup);

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
