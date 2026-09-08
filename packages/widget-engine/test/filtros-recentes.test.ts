// Os recortes que o aquecimento adianta — ver `filtrosRecentes`.
//
// **O defeito que isto ataca, medido em 08/09/2026.** Uma combinação de filtro
// que ninguém pediu ainda custa ~1,6 s (só ~0,2 s é cálculo; o resto é montar
// 137 mil linhas em memória). A MESMA combinação, pedida de novo, custa 2–3 ms.
// O filtro nunca foi caro — cara é a primeira vez.
//
// Trocar de mês é a interação mais comum do relatório, e caía na primeira vez
// toda vez, porque o aquecimento só preparava o recorte de ABERTURA.
//
// REGRA DE SAÍDA: nada aqui imprime valor de linha.

import assert from 'node:assert/strict';
import test from 'node:test';
import { filtrosPadrao, filtrosRecentes } from '../src/filtros-padrao.ts';

const EM = new Date('2026-09-08T12:00:00Z');
const resumo = (fs: { nivel?: string; valores: unknown[] }[]): string =>
  fs.map((f) => `${f.nivel}=${String(f.valores[0])}`).join('+');

test('o PRIMEIRO recorte é exatamente o de abertura — o aquecimento não pode trocar o padrão', () => {
  // Se esta ordem inverter, a página passa a abrir num mês que o aquecimento
  // preparou em segundo lugar, e a primeira visita volta a pagar o cálculo.
  const r = filtrosRecentes('visao-geral', EM);
  assert.deepEqual(r[0], filtrosPadrao('visao-geral', EM));
});

test('página de mês adianta o mês padrão e os anteriores', () => {
  const r = filtrosRecentes('visao-geral', EM);
  assert.deepEqual(r.map(resumo), [
    'Ano=2026+Mês=agosto',
    'Ano=2026+Mês=julho',
    'Ano=2026+Mês=junho',
  ]);
});

test('a virada de ano anda para trás sem inventar mês 13', () => {
  const r = filtrosRecentes('visao-geral', new Date('2026-02-10T12:00:00Z'));
  assert.deepEqual(r.map(resumo), [
    'Ano=2026+Mês=janeiro',
    'Ano=2025+Mês=dezembro',
    'Ano=2025+Mês=novembro',
  ]);
});

test('página de ANO adianta menos: um ano a mais custa um recorte inteiro', () => {
  // `instalacao-reincidente` leva ~30 s a frio. Adiantar 2024 gastaria isso para
  // entregar um período que quase ninguém abre.
  const r = filtrosRecentes('manutencao-inicial', EM);
  assert.deepEqual(r.map(resumo), ['Ano=2026', 'Ano=2025']);
});

test('página sem filtro padrão não adianta nada', () => {
  // `capa` abre sem recorte; inventar um aqueceria uma chave que ninguém pede —
  // o desperdício que a regra 1 da F4 proíbe.
  assert.deepEqual(filtrosRecentes('capa', EM), []);
  assert.deepEqual(filtrosRecentes(null, EM), []);
});

test('recortes repetidos não viram aquecimento duplicado', () => {
  // Com `quantos` maior do que existe de distinto, a mesma chave sairia duas
  // vezes e o aquecedor pagaria o mesmo cálculo de novo.
  const r = filtrosRecentes('manutencao-inicial', EM, 9);
  assert.equal(new Set(r.map(resumo)).size, r.length);
});
