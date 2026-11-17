// O recorte final: o que a sonda e quem consome a fonte ao vivo aplicam igual.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Escalar } from '../../snapshot/src/formato.ts';
import { aplicaRecorte, celula, texto } from '../src/recorte.ts';

const AGENDA = { tipo: 'protocolos-com-data-no-periodo', protocolo: 'Protocolo', data: 'Slot Agenda' } as const;
const dia = (d: string) => new Date(`${d}T00:00:00Z`);
const l = (protocolo: string, slot: string): Record<string, Escalar> => ({ protocolo, 'slot agenda': dia(slot) });

test('protocolo com um horário no período entra com TODAS as linhas dele — o rank conta os dias do protocolo', () => {
  const linhas = [l('1', '2026-10-13'), l('1', '2026-09-30'), l('2', '2026-10-25')];
  const r = aplicaRecorte(linhas, AGENDA, { desde: '2026-10-12', ate: '2026-10-19' });
  assert.deepEqual(r.map((x) => texto(celula(x, 'Slot Agenda'))).sort(), [
    '2026-09-30T00:00:00.000Z',
    '2026-10-13T00:00:00.000Z',
  ]);
});

test('protocolo reagendado para fora do período sai — a régua é o Slot Agenda final', () => {
  const r = aplicaRecorte([l('3', '2026-10-25')], AGENDA, { desde: '2026-10-12', ate: '2026-10-19' });
  assert.equal(r.length, 0);
});

test('o fim do período é exclusivo e o início inclusivo', () => {
  const linhas = [l('4', '2026-10-12'), l('5', '2026-10-19')];
  const r = aplicaRecorte(linhas, AGENDA, { desde: '2026-10-12', ate: '2026-10-19' });
  assert.deepEqual(r.map((x) => celula(x, 'Protocolo')), ['4']);
});

test('recorte por lista compara o protocolo como texto', () => {
  const linhas: Record<string, Escalar>[] = [{ 'n°protocolo': '10' }, { 'n°protocolo': '11' }];
  const r = aplicaRecorte(linhas, { tipo: 'protocolos-da-lista', protocolo: 'N°PROTOCOLO' }, { protocolos: ['11'] });
  assert.deepEqual(r, [{ 'n°protocolo': '11' }]);
});

test('data fora do formato recusa em vez de recortar errado', () => {
  assert.throws(() => aplicaRecorte([], AGENDA, { desde: '12/10/2026', ate: '2026-10-19' }), /AAAA-MM-DD/);
});
