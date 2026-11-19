// @vitest-environment jsdom
//
// As SETAS da faixa de navegação (19/11/2026). O que elas consertam não aparece em
// teste de unidade: a faixa rolava, mas sem barra visível, sem roda horizontal no
// notebook e sem botão — a última aba ficava cortada e inalcançável no mouse.
//
// jsdom não faz layout, então `clientWidth`/`scrollWidth` são fixados aqui: o que se
// testa é a DECISÃO (mostrar a seta de que lado, e o que o clique faz), não a medida —
// a conta da medida está em `rolagem-horizontal.test.ts`.

import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NavDeTelas } from '../src/components/layout/NavDeTelas.tsx';
import type { DashboardDaLista } from '../src/services/dashboardService.ts';

afterEach(cleanup);

const PAGINAS: DashboardDaLista[] = [
  { id: 'capa', nome: 'CAPA', visuais: 2, pronta: true },
  { id: 'visao-geral', nome: 'VISÃO GERAL', visuais: 9, pronta: true },
  { id: 'metas', nome: 'METAS', visuais: 3, pronta: true },
];

/** Fixa a geometria da `<nav>` e dá a ela os métodos de rolagem que o jsdom não tem. */
function geometria(scrollLeft: number, clientWidth: number, scrollWidth: number) {
  const scrollBy = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  for (const [nome, valor] of [
    ['clientWidth', clientWidth],
    ['scrollWidth', scrollWidth],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, nome, { configurable: true, value: valor });
  }
  Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
    configurable: true,
    value: scrollLeft,
    writable: true,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollBy', { configurable: true, value: scrollBy });
  return scrollBy;
}

function monta() {
  return render(<NavDeTelas paginas={PAGINAS} atual="capa" aoEscolher={() => {}} />);
}

test('faixa que cabe inteira não ganha seta — cromo só quando há para onde ir', () => {
  geometria(0, 1200, 1200);
  const { container } = monta();
  expect(container.querySelectorAll('button[title="Mais abas"]')).toHaveLength(0);
  expect(container.querySelectorAll('button[title="Abas anteriores"]')).toHaveLength(0);
});

test('faixa que transborda ganha a seta da direita, e o clique rola quase uma tela', () => {
  const scrollBy = geometria(0, 1366, 1600);
  const { container } = monta();
  expect(container.querySelector('button[title="Abas anteriores"]')).toBeNull();
  const direita = container.querySelector<HTMLButtonElement>('button[title="Mais abas"]')!;
  fireEvent.click(direita);
  expect(scrollBy).toHaveBeenCalledWith({ left: 1025, behavior: 'smooth' });
});

test('rolada até o fim, a seta vira para a esquerda e o clique volta', () => {
  const scrollBy = geometria(234, 1366, 1600);
  const { container } = monta();
  expect(container.querySelector('button[title="Mais abas"]')).toBeNull();
  fireEvent.click(container.querySelector<HTMLButtonElement>('button[title="Abas anteriores"]')!);
  expect(scrollBy).toHaveBeenCalledWith({ left: -1025, behavior: 'smooth' });
});

test('a seta fica fora da ordem de tabulação e do leitor de tela', () => {
  // Quem usa teclado já tabula direto para a próxima aba; a seta é ajuda de mouse e
  // não pode virar dois tab-stops a mais em toda tela.
  geometria(0, 1366, 1600);
  const { container } = monta();
  const seta = container.querySelector<HTMLButtonElement>('button[title="Mais abas"]')!;
  expect(seta.tabIndex).toBe(-1);
  expect(seta.getAttribute('aria-hidden')).toBe('true');
});

test('o esmaecido da borda segue o lado que tem aba escondida', () => {
  geometria(0, 1366, 1600);
  const { container } = monta();
  const nav = container.querySelector('nav.nav-telas')!;
  expect(nav.getAttribute('data-esq')).toBe('nao');
  expect(nav.getAttribute('data-dir')).toBe('sim');
});
