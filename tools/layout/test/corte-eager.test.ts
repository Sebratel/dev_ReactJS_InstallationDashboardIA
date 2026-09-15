import assert from 'node:assert/strict';
import test from 'node:test';
import { idsIniciais, idsRestantes, N_FAIXAS_EAGER } from '../src/corte-eager.ts';
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

// ── idsRestantes: o complemento ────────────────────────────────────────────────
// A dupla `idsIniciais`/`idsRestantes` tem de PARTIR o layout: sem sobra (visual que
// ninguém aquece nem pede) e sem repetição (visual calculado duas vezes por passada).
// Os testes abaixo cobram a partição, não a implementação — é ela que continua valendo
// no dia em que o corte eager mudar de forma pela terceira vez.

test('idsRestantes: sobra a faixa que passou do corte — e só ela', () => {
  const l = layout(
    [
      { altura: 'grafico', colunas: [{ visual: 'g1', span: 12, render: 'x' }] },
      { altura: 'grafico', colunas: [{ visual: 'g2', span: 12, render: 'x' }] },
      { altura: 'tabela', colunas: [{ visual: 't1', span: 12, render: 'x' }] },
      { altura: 'tabela', colunas: [{ visual: 't2', span: 12, render: 'x' }] },
      { altura: 'matriz', colunas: [{ visual: 'm1', span: 12, render: 'x' }] },
    ],
    [{ visual: 'k1', enfase: 'normal' }],
  );
  assert.deepEqual(idsRestantes(l), ['m1']);
});

test('idsRestantes: página inteira acima do corte não deixa sobra', () => {
  const l = layout(
    [{ altura: 'tabela', colunas: [{ visual: 't1', span: 12, render: 'x' }] }],
    [{ visual: 'k1', enfase: 'normal' }],
  );
  assert.deepEqual(idsRestantes(l), []);
});

test('idsRestantes: KPI e segmentação nunca sobram — a abertura já pede os dois', () => {
  // Se um dia sobrassem, o aquecedor de fundo os calcularia DE NOVO a cada passada,
  // e a barra de filtros dependeria da rolagem para existir.
  const l = layout(
    [
      { altura: 'grafico', colunas: [{ visual: 'g1', span: 12, render: 'x' }] },
      { altura: 'grafico', colunas: [{ visual: 'g2', span: 12, render: 'x' }] },
      { altura: 'tabela', colunas: [{ visual: 't1', span: 12, render: 'x' }] },
      { altura: 'tabela', colunas: [{ visual: 't2', span: 12, render: 'x' }] },
      { altura: 'matriz', colunas: [{ visual: 'm1', span: 12, render: 'x' }] },
    ],
    [{ visual: 'k1', enfase: 'normal' }],
    [
      { visual: 's1', porque: 'vira controle de filtro na barra (segmentação), não card da grade' },
      { visual: 'img1', porque: "tipo 'image' não calcula e não vira segmentação — hoje invisível na tela" },
    ],
  );
  assert.deepEqual(idsRestantes(l), ['m1']);
});

test('idsIniciais + idsRestantes partem o layout: sem sobra e sem repetição', () => {
  const faixas = Array.from({ length: 9 }, (_, i) => ({
    altura: 'tabela' as const,
    colunas: [
      { visual: `f${i}a`, span: 6, render: 'x' },
      { visual: `f${i}b`, span: 6, render: 'x' },
    ],
  }));
  const l = layout(
    faixas,
    [{ visual: 'k1', enfase: 'normal' }],
    [{ visual: 's1', porque: 'vira controle de filtro na barra (segmentação), não card da grade' }],
  );

  const eager = idsIniciais(l);
  const restantes = idsRestantes(l);
  const todos = [
    'k1',
    's1',
    ...faixas.flatMap((f) => f.colunas.map((c) => c.visual)),
  ];

  assert.deepEqual([...eager, ...restantes].sort(), [...todos].sort(), 'nenhum visual fica de fora');
  assert.deepEqual(
    eager.filter((id) => restantes.includes(id)),
    [],
    'nenhum visual é aquecido duas vezes',
  );
  // `img1` não existe aqui de propósito: o que não calcula não entra em nenhum dos dois.
  assert.equal(restantes.length, (9 - N_FAIXAS_EAGER) * 2);
});
