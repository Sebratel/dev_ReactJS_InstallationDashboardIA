// A `particao` de `nativas.ts` é uma AFIRMAÇÃO: "toda linha de saída depende só das
// linhas de entrada com a mesma chave". `carrega.ts` confia nela para recalcular só os
// protocolos que o tempo real trouxe (ACHADOS #169). Este teste é a prova: recalcular
// em parte e juntar com o resto tem de dar exatamente a tabela recalculada inteira.
//
// A prova sobre o dado real (12.987 linhas, 0 divergências nos três modos — congelada,
// parcial, inteira) foi feita em 02/10/2026 contra o snapshot; aqui fica a versão que
// roda em todo `npm test`, com os casos que separam protocolo de dia.

import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDaAgenda, chaveDeParticao, statusProtocoloDia } from '../src/nativas.ts';
import type { Escalar } from '../src/formato.ts';

const d = (dia: number, h = 9) => new Date(Date.UTC(2026, 9, dia, h));

/** Linha de FIELD AGENDA com as colunas que as traduções leem. */
function fa(protocolo: string, dia: number, extra: Record<string, Escalar> = {}): Record<string, Escalar> {
  return {
    protocolo,
    'slot agenda': d(dia),
    data: new Date(Date.UTC(2026, 9, dia)),
    'data relato': d(dia, 14),
    base: 'Base Canoas (Ativação)',
    turno: 'Manhã',
    rankdataprotocolo: 1,
    'tipo de protocolo': 'TEC - Instalação de Fibra',
    categoriaprodutividade: null,
    skill: null,
    ...extra,
  };
}

const AGENDA = [
  fa('100', 1),
  fa('100', 2, { categoriaprodutividade: 'Improdutiva', skill: 'TEC' }),
  fa('200', 1, { skill: 'TEC' }),
  fa('200', 3),
  fa('300', 2),
  // Caixa diferente do mesmo protocolo: o collation do motor junta os dois.
  fa('abc', 4),
  fa('ABC', 4, { skill: 'TEC' }),
];
const GERAL = [
  { 'n°protocolo': '100', 'data instalação': d(1) },
  { 'n°protocolo': '300', 'data instalação': d(2) },
];

const chave = (l: Record<string, Escalar>) =>
  Object.keys(l).sort().map((k) => `${k}=${l[k] instanceof Date ? (l[k] as Date).toISOString() : String(l[k])}`).join('|');
const ordena = (ls: Record<string, Escalar>[]) => ls.map(chave).sort();

/** O que `recalculoParcial` faz: mantém o resto, recalcula as chaves tocadas. */
function parcial(
  inteira: Record<string, Escalar>[],
  tocadas: string[],
  calcula: (recortes: Record<string, Escalar>[][]) => Record<string, Escalar>[],
  fontes: { linhas: Record<string, Escalar>[]; coluna: string }[],
): Record<string, Escalar>[] {
  const k = new Set(tocadas.map(chaveDeParticao));
  const mantidas = inteira.filter((l) => !k.has(chaveDeParticao(l['protocolo'] ?? null)));
  const recortes = fontes.map((f) => f.linhas.filter((l) => k.has(chaveDeParticao(l[f.coluna] ?? null))));
  return [...mantidas, ...calcula(recortes)];
}

test('Status Protocolo Dia: recalcular só os protocolos tocados dá a tabela inteira', () => {
  const inteira = statusProtocoloDia(AGENDA, GERAL);
  for (const tocadas of [['100'], ['200', '300'], ['abc'], ['ABC', '100', '999']]) {
    const p = parcial(inteira, tocadas, ([f, g]) => statusProtocoloDia(f!, g!), [
      { linhas: AGENDA, coluna: 'protocolo' },
      { linhas: GERAL, coluna: 'n°protocolo' },
    ]);
    assert.deepEqual(ordena(p), ordena(inteira), `tocadas: ${tocadas.join(',')}`);
  }
});

test('calendar: DISTINCT (Protocolo, Data) — e o recálculo parcial dá a tabela inteira', () => {
  const inteira = calendarDaAgenda(AGENDA);
  // 100/1, 100/2, 200/1, 200/3, 300/2, abc/4 (abc e ABC são o mesmo protocolo).
  assert.equal(inteira.length, 6);
  for (const tocadas of [['200'], ['ABC'], ['100', '300']]) {
    const p = parcial(inteira, tocadas, ([f]) => calendarDaAgenda(f!), [{ linhas: AGENDA, coluna: 'protocolo' }]);
    assert.deepEqual(ordena(p), ordena(inteira), `tocadas: ${tocadas.join(',')}`);
  }
});

test('a mudança de um protocolo aparece só nele', () => {
  const antes = statusProtocoloDia(AGENDA, GERAL);
  // O 200 instalou no dia 3: vira Produtivo nesse dia, e nada mais muda.
  const geralDepois = [...GERAL, { 'n°protocolo': '200', 'data instalação': d(3) }];
  const depois = parcial(antes, ['200'], ([f, g]) => statusProtocoloDia(f!, g!), [
    { linhas: AGENDA, coluna: 'protocolo' },
    { linhas: geralDepois, coluna: 'n°protocolo' },
  ]);
  assert.deepEqual(ordena(depois), ordena(statusProtocoloDia(AGENDA, geralDepois)));
  const do200dia3 = depois.find((l) => l['protocolo'] === '200' && (l['dia'] as Date).getUTCDate() === 3);
  assert.equal(do200dia3?.['status'], 'Produtivo');
});
