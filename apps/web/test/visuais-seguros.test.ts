// Testes do Marco A (A4): Nenhum visual derruba a página.
//
// O critério do handoff (§A4):
// "um visual que erra mostra o erro no card e o resto da página segue calculando;
// existe um teste por tipo de visual (card, tabela, matriz, gráfico) que falha se
// a guarda for removida. São 117 visuais em 14 páginas — o teste é por tipo, não por visual."

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const web = path.resolve(import.meta.dirname, '..');
const le = (...p: string[]) => fs.readFileSync(path.join(web, ...p), 'utf8');

function semComentario(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const visualTsx = semComentario(le('src', 'componentes', 'Visual.tsx'));
const visualProntoTsx = semComentario(le('src', 'componentes', 'VisualPronto.tsx'));
const cardTsx = semComentario(le('src', 'componentes', 'Card.tsx'));
const graficoTsx = semComentario(le('src', 'componentes', 'Grafico.tsx'));
const tabelaTsx = semComentario(le('src', 'componentes', 'Tabela.tsx'));
const matrizTsx = semComentario(le('src', 'componentes', 'Matriz.tsx'));
const roscaTsx = semComentario(le('src', 'componentes', 'Rosca.tsx'));
const rankingBarraTsx = semComentario(le('src', 'componentes', 'RankingBarra.tsx'));
const errorBoundaryTsx = semComentario(le('src', 'componentes', 'VisualErrorBoundary.tsx'));

test('A4.1 - Visual.tsx isola cada visual com VisualErrorBoundary', () => {
  assert.match(
    visualTsx,
    /<VisualErrorBoundary\s+visual=\{props\.visual\}>/,
    'Visual.tsx deve encapsular cada visual com VisualErrorBoundary para que um erro não desmonte a página',
  );
  assert.ok(
    errorBoundaryTsx.includes('getDerivedStateFromError'),
    'VisualErrorBoundary deve implementar getDerivedStateFromError',
  );
  assert.ok(
    errorBoundaryTsx.includes('sub="erro de renderização"'),
    'VisualErrorBoundary deve renderizar Cartao com subtítulo identificando o erro',
  );
});

test('A4.2 - VisualPronto trata erro da API e ausência de dados sem quebrar', () => {
  assert.match(
    visualProntoTsx,
    /if\s*\(\s*visual\.erro\s*\)\s*\{[\s\S]*?<Cartao[\s\S]*?<Erro>\{visual\.erro\}<\/Erro>/,
    'VisualPronto deve conter guarda explícita para visual.erro com Cartao e Erro',
  );
  assert.match(
    visualProntoTsx,
    /if\s*\(\s*!visual\.dados\s*\)\s*\{[\s\S]*?<Cartao[\s\S]*?Sem dados disponíveis/,
    'VisualPronto deve conter guarda para !visual.dados exibindo Cartao amigável',
  );
});

test('A4.3 - Card: guarda contra dados nulos e propriedades aninhadas ausentes', () => {
  assert.match(
    cardTsx,
    /const d = visual\.dados as DadosDeCard \| undefined;[\s\S]*?if \(!d\) return null;/,
    'Card.tsx deve validar se d existe antes de acessar propriedades',
  );
  assert.match(
    cardTsx,
    /d\.origem\?\.kind/,
    'Card.tsx deve usar optional chaining ao acessar d.origem.kind',
  );
  assert.match(
    cardTsx,
    /filtros\.length/,
    'Card.tsx deve proteger acesso a d.filtros',
  );
});

test('A4.4 - Grafico: guarda contra dados nulos, series e pontos ausentes', () => {
  assert.match(
    graficoTsx,
    /d && d\.series && d\.pontos \? montaGrafico\(d\) : null/,
    'Grafico.tsx deve conferir d.series e d.pontos antes de chamar montaGrafico',
  );
  assert.match(
    graficoTsx,
    /if \(!d \|\| !g \|\| !gTudo\) \{[\s\S]*?<Cartao[\s\S]*?Sem dados disponíveis para o gráfico/,
    'Grafico.tsx deve exibir Cartao de fallback quando dados ou gráfico estiverem ausentes',
  );
});

test('A4.5 - Tabela: guarda contra dados nulos, colunas e linhas ausentes', () => {
  assert.match(
    tabelaTsx,
    /if \(!d \|\| !d\.colunas \|\| !d\.linhas\) \{[\s\S]*?<Cartao[\s\S]*?Sem dados disponíveis para a tabela/,
    'Tabela.tsx deve exibir Cartao de fallback quando colunas ou linhas estiverem ausentes',
  );
});

test('A4.6 - Matriz: guarda contra dados nulos, colunas e linhas ausentes', () => {
  assert.match(
    matrizTsx,
    /if \(!d \|\| !d\.colunas \|\| !d\.linhas\) \{[\s\S]*?<Cartao[\s\S]*?Sem dados disponíveis para a matriz/,
    'Matriz.tsx deve exibir Cartao de fallback quando colunas ou linhas estiverem ausentes',
  );
});

test('A4.7 - Formas alternativas (Rosca e RankingBarra) também têm guardas contra nulos', () => {
  assert.match(
    roscaTsx,
    /if \(!d \|\| !d\.colunas \|\| !d\.linhas\)/,
    'Rosca.tsx deve validar d.colunas e d.linhas',
  );
  assert.match(
    rankingBarraTsx,
    /if \(!d \|\| !gTudo\)/,
    'RankingBarra.tsx deve validar d e gTudo',
  );
});
