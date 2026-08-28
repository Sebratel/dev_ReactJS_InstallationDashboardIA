import assert from 'node:assert/strict';
import test from 'node:test';
import { agrupaPorLinha, linhasComAlturaDivergente, type CaixaMedida } from '../src/geometria.ts';

test('caixas com o mesmo top viram um grupo só', () => {
  const caixas: CaixaMedida[] = [
    { id: 'a', top: 100, height: 283 },
    { id: 'b', top: 100, height: 283 },
    { id: 'c', top: 400, height: 283 },
  ];
  const grupos = agrupaPorLinha(caixas);
  assert.equal(grupos.length, 2);
  assert.equal(grupos[0]!.length, 2);
  assert.equal(grupos[1]!.length, 1);
});

test('top dentro do epsilon ainda conta como a mesma linha', () => {
  const caixas: CaixaMedida[] = [
    { id: 'a', top: 100, height: 283 },
    { id: 'b', top: 101.5, height: 283 },
  ];
  assert.equal(agrupaPorLinha(caixas, 2).length, 1);
});

test('mesma linha, mesma altura: não é problema', () => {
  const grupos = agrupaPorLinha([
    { id: 'a', top: 100, height: 283 },
    { id: 'b', top: 100, height: 283 },
  ]);
  assert.deepEqual(linhasComAlturaDivergente(grupos), []);
});

test('mesma linha, alturas diferentes: é o defeito que a Fase L2 existe para achar', () => {
  const grupos = agrupaPorLinha([
    { id: 'a', top: 100, height: 475 },
    { id: 'b', top: 100, height: 112 },
  ]);
  const problemas = linhasComAlturaDivergente(grupos);
  assert.equal(problemas.length, 1);
  assert.deepEqual(problemas[0]!.ids, ['a', 'b']);
});

test('linha sozinha (um cartão largo) nunca diverge de si mesma', () => {
  const grupos = agrupaPorLinha([{ id: 'a', top: 100, height: 900 }]);
  assert.deepEqual(linhasComAlturaDivergente(grupos), []);
});

test('divergência menor que o epsilon não conta (o clamp arredonda)', () => {
  const grupos = agrupaPorLinha([
    { id: 'a', top: 100, height: 283.2 },
    { id: 'b', top: 100, height: 283.8 },
  ]);
  assert.deepEqual(linhasComAlturaDivergente(grupos, 1), []);
});
