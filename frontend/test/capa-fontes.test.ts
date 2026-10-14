// A idade de cada família de fontes na capa.
//
// Ela media só a carga cheia: numa query vigiada pelo poller a carga é a rede de segurança
// de 60 min, e a capa dizia "há 50min" com o dado de segundos atrás — enquanto a PROTOCOLOS
// GERAL, sem poll, podia ter meia hora e aparecer como "há 1min" ao lado (14/10/2026).

import { expect, test } from 'vitest';
import { situacaoDaFonte } from '../src/utils/capaConteudo.ts';
import type { RespostaSaude } from '../src/utils/avisoSaude.ts';

const AGORA = Date.parse('2026-10-14T13:00:00Z');
const minAtras = (n: number) => new Date(AGORA - n * 60_000).toISOString();

const saude = (confirmadoEm: string | null): RespostaSaude => ({
  refresh: {
    queries: [
      {
        id: 'contratos-telefonia',
        ultimaCarga: minAtras(5),
        idadeDias: 0,
        status: 'ok',
        grupo: 'quente',
      },
      {
        id: 'protocolos-telefonia',
        ultimaCarga: minAtras(50),
        idadeDias: 0,
        status: 'ok',
        grupo: 'frio',
      },
    ],
  },
  agendador: {
    grupos: [
      { id: 'quente', intervaloMinutos: 15, ultimoSucesso: null },
      { id: 'frio', intervaloMinutos: 60, ultimoSucesso: null },
    ],
  },
  poller: { porQuery: [{ query: 'protocolos-telefonia', intervaloMs: 12_000, confirmadoEm }] },
});

const TELEFONIA = ['contratos-telefonia', 'protocolos-telefonia'];

test('o poll em dia dá a idade: a família fica com a da query sem poll', () => {
  const s = situacaoDaFonte(TELEFONIA, saude(new Date(AGORA - 10_000).toISOString()), AGORA);
  expect(s?.idade).toBe('há 5min');
  expect(s?.cadencia).toBe('15 min');
});

test('sem poll, vale a carga cheia — e a cadência é a do grupo', () => {
  const s = situacaoDaFonte(TELEFONIA, saude(null), AGORA);
  expect(s?.idade).toBe('há 50min');
  expect(s?.cadencia).toBe('60 min');
});

test('poll parado não dá frescor', () => {
  const s = situacaoDaFonte(TELEFONIA, saude(minAtras(20)), AGORA);
  expect(s?.idade).toBe('há 50min');
});

test('família só de poll mostra a cadência em segundos', () => {
  const s = situacaoDaFonte(
    ['protocolos-telefonia'],
    saude(new Date(AGORA - 10_000).toISOString()),
    AGORA,
  );
  expect(s?.idade).toBe('agora');
  expect(s?.cadencia).toBe('12 s');
});
