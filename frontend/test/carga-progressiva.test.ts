import assert from 'node:assert/strict';
import { test } from 'vitest';
import { idsIniciais, N_FAIXAS_EAGER } from '../src/utils/cargaProgressiva.ts';
import type { LayoutSpec } from '../src/services/dashboardService.ts';

function layout(faixas: LayoutSpec['faixas'], kpis: LayoutSpec['kpis'] = []): LayoutSpec {
  return { pagina: 'x', base: 'x', kpis, faixas, ocultos: [], improvements: [] };
}

// Até 28/09/2026 era 4 (ACHADOS #94); virou 'todas' porque a tela tem de abrir pronta
// (ACHADOS #162). Os testes abaixo exercitam o MECANISMO do corte com 4, explícito.
test('N_FAIXAS_EAGER cobre todas as faixas — a abertura pede a página inteira (ACHADOS #162)', () => {
  assert.equal(N_FAIXAS_EAGER, Number.POSITIVE_INFINITY);
});

test('idsIniciais sem corte explícito: página de 9 faixas vem inteira, nada fica para a rolagem', () => {
  const faixas = Array.from({ length: 9 }, (_, i) => ({
    altura: 'tabela' as const,
    colunas: [{ visual: `f${i}`, span: 12, render: 'x' }],
  }));
  const l = { pagina: 'x', base: 'x', kpis: [], faixas, ocultos: [], improvements: [] };
  assert.equal(idsIniciais(l).length, 9);
});

test('idsIniciais: página com menos faixas que o corte pede tudo, igual a hoje', () => {
  const l = layout([{ altura: 'grafico', colunas: [{ visual: 'g1', span: 12, render: 'x' }] }]);
  assert.deepEqual(idsIniciais(l, 4), ['g1']);
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
    [
      { visual: 'k1', enfase: 'normal' },
      { visual: 'k2', enfase: 'normal' },
    ],
  );
  // agendamento-field-like: 5 faixas, só as 4 primeiras entram eager — m1 fica de fora.
  assert.deepEqual(idsIniciais(l, 4), ['k1', 'k2', 'g1', 'g2', 't1', 't2']);
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
  assert.deepEqual(idsIniciais(l, 4), ['c1', 'c2', 'c3', 't1', 't2', 'g1']);
});

test('idsIniciais: sem faixa nenhuma (capa) devolve só os kpis', () => {
  const l = layout([], [{ visual: 'k1', enfase: 'normal' }]);
  assert.deepEqual(idsIniciais(l, 4), ['k1']);
});
