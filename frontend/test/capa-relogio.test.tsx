// @vitest-environment jsdom
//
// A idade das fontes na capa anda sozinha, sem clique.
//
// O defeito (Erick, 22/10/2026): "a atualização dos dados nessa parte só se atualiza se eu
// clicar em atualizar agora". A idade era calculada com `Date.now()` no render, e a capa
// parada não redesenhava — "há 23min" ficava congelado.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Capa } from '../src/components/capa/Capa.tsx';
import type { RespostaSaude } from '../src/utils/avisoSaude.ts';

const AGORA = Date.parse('2026-10-22T13:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const saude: RespostaSaude = {
  refresh: {
    queries: [
      {
        id: 'contratos-telefonia',
        ultimaCarga: new Date(AGORA - 3 * 60_000).toISOString(),
        idadeDias: 0,
        status: 'ok',
      },
      {
        id: 'protocolos-telefonia',
        ultimaCarga: new Date(AGORA - 3 * 60_000).toISOString(),
        idadeDias: 0,
        status: 'ok',
      },
    ],
  },
};

const linhaDaTelefonia = () => screen.getByText('Telefonia').closest('tr')!.textContent ?? '';

test('a idade de uma fonte avança com o tempo, sem novo dado e sem clique', () => {
  render(<Capa saude={saude} telas={11} />);
  expect(linhaDaTelefonia()).toContain('há 3min');

  // Cinco minutos de tela parada: nenhuma prop nova, nenhum clique.
  act(() => {
    vi.advanceTimersByTime(5 * 60_000);
  });

  expect(linhaDaTelefonia()).toContain('há 8min');
});
