// A linha "vs ano anterior" do KPI (`kpis[].comparado`).

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { comparativo } from '../src/utils/comparativo.ts';

test('contagem: variação relativa, verde quando sobe e maior é melhor', () => {
  assert.deepEqual(comparativo(31988, 30113, { percentual: false, melhor: 'maior' }), {
    seta: '▲',
    texto: '+6,2%',
    tom: 'bom',
  });
  assert.equal(comparativo(42482, 45255, { percentual: false, melhor: 'maior' })!.tom, 'ruim');
});

test('prazo: cair é bom quando menor é melhor', () => {
  assert.deepEqual(comparativo(2.86, 3.8, { percentual: false, melhor: 'menor' }), {
    seta: '▼',
    texto: '−24,7%',
    tom: 'bom',
  });
});

test('taxa: diferença em pontos percentuais, não variação relativa da taxa', () => {
  assert.deepEqual(comparativo(0.753, 0.665, { percentual: true, melhor: 'maior' }), {
    seta: '▲',
    texto: '+8,8 p.p.',
    tom: 'bom',
  });
});

test('empate e referência zero', () => {
  assert.equal(comparativo(100, 100, { percentual: false, melhor: 'maior' })!.seta, '=');
  assert.equal(
    comparativo(5, 0, { percentual: false, melhor: 'maior' }),
    null,
    'variação sobre zero não existe',
  );
  assert.equal(comparativo(Number.NaN, 1, { percentual: false, melhor: 'maior' }), null);
});
