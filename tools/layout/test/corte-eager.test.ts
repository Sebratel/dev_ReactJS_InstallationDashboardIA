import assert from 'node:assert/strict';
import test from 'node:test';
import { idsIniciais, N_FAIXAS_EAGER } from '../src/corte-eager.ts';
import type { LayoutSpec } from '../src/schema.ts';

function layout(
  faixas: LayoutSpec['faixas'],
  kpis: LayoutSpec['kpis'] = [],
  ocultos: LayoutSpec['ocultos'] = [],
): LayoutSpec {
  return { pagina: 'x', base: 'x', kpis, faixas, ocultos, improvements: [] };
}

test('N_FAIXAS_EAGER é 4 — cobre o piso de altura de página densa (ACHADOS #94)', () => {
  assert.equal(N_FAIXAS_EAGER, 4);
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
      { altura: 'grafico', colunas: [{ visual: 'g2', span: 12, render: 'x' }] },
      { altura: 'tabela', colunas: [{ visual: 't1', span: 12, render: 'x' }] },
      { altura: 'tabela', colunas: [{ visual: 't2', span: 12, render: 'x' }] },
      { altura: 'matriz', colunas: [{ visual: 'm1', span: 12, render: 'x' }] },
    ],
    [{ visual: 'k1', enfase: 'normal' }, { visual: 'k2', enfase: 'normal' }],
  );
  // agendamento-field-like: 5 faixas, só as 4 primeiras entram eager — m1 fica de fora.
  assert.deepEqual(idsIniciais(l), ['k1', 'k2', 'g1', 'g2', 't1', 't2']);
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
    { altura: 'tabela', colunas: [{ visual: 't2', span: 12, render: 'x' }] },
    { altura: 'grafico', colunas: [{ visual: 'g1', span: 12, render: 'x' }] },
    { altura: 'matriz', colunas: [{ visual: 'm1', span: 12, render: 'x' }] },
  ]);
  // visao-geral-like: 1 faixa de 3 compactos + 3 de largura cheia = 4 faixas, todas
  // eager (a de 3 colunas conta como 1, não 3) — m1 (a 5ª) fica de fora.
  assert.deepEqual(idsIniciais(l), ['c1', 'c2', 'c3', 't1', 't2', 'g1']);
});

test('idsIniciais: sem faixa nenhuma (capa) devolve só os kpis', () => {
  const l = layout([], [{ visual: 'k1', enfase: 'normal' }]);
  assert.deepEqual(idsIniciais(l), ['k1']);
});

test('idsIniciais: segmentação oculta da grade entra eager — é a barra de filtros', () => {
  // O defeito medido em 09/09 na VISÃO GERAL: sete slicers calculavam certo no
  // servidor e nunca chegavam na abertura, porque só kpis/faixas alimentavam o
  // corte. Ver o comentário de `idsDeSegmentacao` em `corte-eager.ts`.
  const l = layout(
    [{ altura: 'tabela', colunas: [{ visual: 't1', span: 12, render: 'x' }] }],
    [{ visual: 'k1', enfase: 'normal' }],
    [
      { visual: 's1', porque: 'vira controle de filtro na barra (segmentação), não card da grade' },
      { visual: 's2', porque: 'vira controle de filtro na barra (segmentação), não card da grade' },
      { visual: 'img1', porque: "tipo 'image' não calcula e não vira segmentação — hoje invisível na tela" },
    ],
  );
  assert.deepEqual(idsIniciais(l), ['k1', 's1', 's2', 't1']);
});
