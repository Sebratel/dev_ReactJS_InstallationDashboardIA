// @vitest-environment jsdom
//
// `useEstadoDaTela` contra o roteador de verdade (fase 3): o que cada ação faz com a URL
// e com o histórico.
//
// O caso que importa mais é o segundo: a árvore de período chama `mudaFiltro` duas vezes
// num clique só (Dia e Mês). Se a ação lesse o estado do último render, a segunda
// apagaria a primeira — e o filtro de dia sumiria sem erro nenhum.

import { afterEach, beforeEach, expect, test } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { useEstadoDaTela, type EstadoDaTela } from '../src/hooks/useEstadoDaTela.ts';
import { leRota } from '../src/utils/rota.ts';

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, '', '/?pagina=capa'));

/** Renderiza o hook e devolve uma função que lê o estado do último render. */
function monta(): () => EstadoDaTela {
  let ultimo: EstadoDaTela | null = null;
  function Sonda() {
    ultimo = useEstadoDaTela();
    return null;
  }
  render(
    <BrowserRouter>
      <Sonda />
    </BrowserRouter>,
  );
  return () => ultimo!;
}

const naUrl = () => leRota(window.location.search, window.location.pathname);

test('duas mudanças de filtro na mesma ação: as duas ficam', () => {
  const estado = monta();
  act(() => {
    estado().mudaFiltro('calendar', 'Data', [6], 'Dia');
    estado().mudaFiltro('calendar', 'Data', ['julho'], 'Mês');
  });
  expect(naUrl().filtros.map((f) => f.nivel)).toEqual(['Dia', 'Mês']);
  expect(estado().filtros.map((f) => f.nivel)).toEqual(['Dia', 'Mês']);
});

test('seletor SUBSTITUI no histórico; clique num visual EMPILHA', () => {
  const estado = monta();
  const antes = window.history.length;
  act(() => estado().mudaFiltro('T', 'cidade', ['Canoas']));
  expect(window.history.length).toBe(antes);
  act(() => estado().aoFiltrarAlvos([{ tabela: 'T', coluna: 'equipe', valor: 'A' }]));
  expect(window.history.length).toBe(antes + 1);
  expect(naUrl().clicados).toEqual([{ tabela: 'T', coluna: 'equipe' }]);
});

test('trocar de aba volta para / e para o filtro padrão da página nova', () => {
  window.history.replaceState(null, '', '/visao-geral?filtro=x');
  const estado = monta();
  act(() => estado().escolhe('capa'));
  expect(window.location.pathname).toBe('/');
  expect(estado().atual).toBe('capa');
  expect(estado().filtros).toEqual([]);
});
