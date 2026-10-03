import assert from 'node:assert/strict';
import test from 'node:test';
import { validaLayout } from '../src/valida.ts';
import type { LayoutSpec } from '../src/schema.ts';

function layout(parcial: Partial<LayoutSpec> = {}): LayoutSpec {
  return {
    pagina: 'p',
    base: 'backend/specs/dashboards/p.spec.yaml',
    kpis: [],
    faixas: [],
    ocultos: [],
    improvements: [],
    ...parcial,
  };
}

test('layout completo e consistente não gera problema', () => {
  const l = layout({
    kpis: [{ visual: 'k1', enfase: 'normal' }],
    faixas: [
      { altura: 'grafico', colunas: [{ visual: 'g1', span: 6, render: 'columnChart' }, { visual: 'g2', span: 6, render: 'columnChart' }] },
    ],
    ocultos: [{ visual: 's1', porque: 'segmentação' }],
  });
  assert.deepEqual(validaLayout(l, ['k1', 'g1', 'g2', 's1']), []);
});

test('visual do spec que não aparece em lugar nenhum é problema', () => {
  const l = layout({ kpis: [{ visual: 'k1', enfase: 'normal' }] });
  const problemas = validaLayout(l, ['k1', 'k2']);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0]!.mensagem, /'k2'.*não aparece/);
});

test('visual repetido em duas listas é problema', () => {
  const l = layout({
    kpis: [{ visual: 'k1', enfase: 'normal' }],
    ocultos: [{ visual: 'k1', porque: 'duplicado por engano' }],
  });
  const problemas = validaLayout(l, ['k1']);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0]!.mensagem, /'k1'.*2 vezes/);
});

test('visual citado no layout que não existe no spec é problema', () => {
  const l = layout({ kpis: [{ visual: 'fantasma', enfase: 'normal' }] });
  const problemas = validaLayout(l, []);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0]!.mensagem, /'fantasma'.*não existe/);
});

test('spans que não somam 12 são problema', () => {
  const l = layout({
    faixas: [{ altura: 'grafico', colunas: [{ visual: 'g1', span: 4, render: 'columnChart' }] }],
  });
  const problemas = validaLayout(l, ['g1']);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0]!.mensagem, /somam 4, tem de somar 12/);
});

test('altura fora das classes que estilo.css sabe desenhar é problema', () => {
  const l = layout({
    faixas: [{ altura: 'gigante' as LayoutSpec['faixas'][number]['altura'], colunas: [{ visual: 'g1', span: 12, render: 'columnChart' }] }],
  });
  const problemas = validaLayout(l, ['g1']);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0]!.mensagem, /'gigante'.*não é uma classe válida/);
});

test('faixa com título aparece na mensagem, para localizar o problema no arquivo', () => {
  const l = layout({
    faixas: [{ titulo: 'Gráficos e tendências', altura: 'grafico', colunas: [{ visual: 'g1', span: 4, render: 'columnChart' }] }],
  });
  const problemas = validaLayout(l, ['g1']);
  assert.match(problemas[0]!.mensagem, /"Gráficos e tendências"/);
});
