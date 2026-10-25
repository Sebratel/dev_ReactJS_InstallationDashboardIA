// O overlay do tempo real sobre a pasta AO VIVO (`overlaySobreBuscaAoVivo`).
//
// O delta do poller é a verdade completa desde o `corte` dele — mas só para o que ele
// vigia (protocolos com agenda dos últimos 7 dias, `realtime-poll.yaml`). Mesclado com o
// corte original sobre a pasta ao vivo, que é mais nova que o corte, a linha de um
// protocolo que o poller não vigia e que mudou depois do corte saía como APAGADA.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mesclador, overlaySobreBuscaAoVivo, type OverlayDeTabela } from '../src/overlay-realtime.ts';

const MARCA = ['Data Relato'];
const corteDoPoller = new Date('2026-10-25T10:00:00Z');
const buscadoEm = '2026-10-25T13:00:00.000Z';

/** A pasta ao vivo, buscada às 13h. */
const daBusca = [
  // Protocolo antigo, sem nada depois do corte.
  { protocolo: '1', 'data relato': new Date('2026-10-02T09:00:00Z'), relato: 'a' },
  // Protocolo com agenda no começo do mês (fora da vigia de 7 dias) e relato às 11h.
  { protocolo: '2', 'data relato': new Date('2026-10-25T11:00:00Z'), relato: 'b' },
  // Protocolo vigiado, como estava às 13h.
  { protocolo: '3', 'data relato': new Date('2026-10-25T12:00:00Z'), relato: 'c' },
];

/** O delta do poller às 13h05: o protocolo 3 mudou de novo. */
const delta: OverlayDeTabela = {
  linhas: [
    { protocolo: '3', 'data relato': new Date('2026-10-25T12:00:00Z'), relato: 'c' },
    { protocolo: '3', 'data relato': new Date('2026-10-25T13:04:00Z'), relato: 'c2' },
  ],
  corte: corteDoPoller,
  chave: ['Protocolo'],
  marca: MARCA,
};

const porProtocolo = (ls: readonly Record<string, unknown>[]) =>
  ls.map((l) => `${l['protocolo']}:${l['relato']}`).sort();

test('com o corte do poller, a mescla apagava o relato que a busca trouxe e o poller não vigia', () => {
  const mesclado = mesclador(delta)(daBusca);
  assert.deepEqual(porProtocolo(mesclado), ['1:a', '3:c', '3:c2'], 'o protocolo 2 sumia — o defeito');
});

test('com o corte no instante da busca: o delta substitui o que reentregou, e nada da busca some', () => {
  const ov = overlaySobreBuscaAoVivo(new Map([['field agenda', delta]]), buscadoEm).get('field agenda')!;
  assert.equal(ov.corte.toISOString(), buscadoEm);
  assert.deepEqual(porProtocolo(mesclador(ov)(daBusca)), ['1:a', '2:b', '3:c', '3:c2']);
  assert.equal(delta.corte, corteDoPoller, 'o overlay do snapshot não muda');
});

test('busca mais velha que o corte do poller: vale o corte do poller', () => {
  const ov = overlaySobreBuscaAoVivo(new Map([['field agenda', delta]]), '2026-10-25T08:00:00.000Z').get('field agenda')!;
  assert.equal(ov.corte.getTime(), corteDoPoller.getTime());
});
