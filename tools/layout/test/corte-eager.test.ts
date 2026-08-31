import assert from 'node:assert/strict';
import test from 'node:test';
import { idsIniciais, N_FAIXAS_EAGER } from '../src/corte-eager.ts';
import type { LayoutSpec } from '../src/schema.ts';

function layout(faixas: LayoutSpec['faixas'], kpis: LayoutSpec['kpis'] = []): LayoutSpec {
  return { pagina: 'x', base: 'x', kpis, faixas, ocultos: [], improvements: [] };
}

test('N_FAIXAS_EAGER é 2 — o mesmo corte de "duas faixas = uma tela" de estilo.css', () => {
  assert.equal(N_FAIXAS_EAGER, 2);
});

test('idsIniciais: página com menos faixas que o corte pede tudo, igual a hoje', () => {
  const l = layout([
    { altura: 'grafico', colunas: [{ visual: 'g1', span: 12, render: 'x' }] },
  ]);
  assert.deepEqual(idsIniciais(l), ['g1']);
});

test('idsIniciais: kpis sempre entram, mesmo com faixas de sobra', () => {
  const l = layout(
    [
      { altura: 'grafico', colunas: [{ visual: 'g1', span: 12, render: 'x' }] },
      { altura: 'tabela', colunas: [{ visual: 't1', span: 12, render: 'x' }] },
      { altura: 'matriz', colunas: [{ visual: 'm1', span: 12, render: 'x' }] },
    ],
    [{ visual: 'k1', enfase: 'normal' }, { visual: 'k2', enfase: 'normal' }],
  );
  // agendamento-field-like: 3 faixas, só as 2 primeiras entram eager — m1 fica de fora.
  assert.deepEqual(idsIniciais(l), ['k1', 'k2', 'g1', 't1']);
});

test('idsIniciais: faixa de várias colunas conta como UMA faixa, não uma por coluna', () => {
  const l = layout([
    {
      altura: 'grafico',
      colunas: [
        { visual: 'c1', span: 4, render: 'x' },
        { visual: 'c2', span: 4, render: 'x' },
        { visual: 'c3', span: 4, render: 'x' },
      ],
    },
    { altura: 'tabela', colunas: [{ visual: 't1', span: 12, render: 'x' }] },
    { altura: 'matriz', colunas: [{ visual: 'm1', span: 12, render: 'x' }] },
  ]);
  // visao-geral-like: 1 faixa de 3 compactos + 1 de tabela = 2 faixas, ambas eager.
  assert.deepEqual(idsIniciais(l), ['c1', 'c2', 'c3', 't1']);
});

test('idsIniciais: sem faixa nenhuma (capa) devolve só os kpis', () => {
  const l = layout([], [{ visual: 'k1', enfase: 'normal' }]);
  assert.deepEqual(idsIniciais(l), ['k1']);
});
