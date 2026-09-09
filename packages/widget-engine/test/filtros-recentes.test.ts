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

test('`agendamento-field` abre no mês CORRENTE, não no último fechado', () => {
  // Decisão do Erick (09/09). Não é preferência de janela: a matriz de chuva da
  // página filtra `Clima/ Tempo[Tipo] = "Previsão"`, e previsão só existe de hoje
  // para frente. Sob mês fechado a interseção é vazia, toda célula sai vazia, a
  // poda derruba os dois eixos e a tela mostra `0 × 0 · 26 podada(s)` — em
  // QUALQUER mês, não só neste. Se esta linha voltar para `'mes'`, o visual volta
  // a nascer vazio e o defeito não dá erro nenhum para avisar.
  assert.equal(resumo(filtrosPadrao('agendamento-field', EM)), 'Ano=2026+Mês=setembro');
  assert.equal(resumo(filtrosPadrao('visao-geral', EM)), 'Ano=2026+Mês=agosto');
});

test('o aquecimento de `agendamento-field` começa no mês corrente e anda para trás', () => {
  // O primeiro recorte tem de ser o de abertura (mesma regra do teste acima), e
  // agora a abertura é setembro — não agosto.
  const r = filtrosRecentes('agendamento-field', EM);
  assert.deepEqual(r[0], filtrosPadrao('agendamento-field', EM));
  assert.deepEqual(r.map(resumo), [
    'Ano=2026+Mês=setembro',
    'Ano=2026+Mês=agosto',
    'Ano=2026+Mês=julho',
  ]);
});

test('mês corrente também vira o ano para trás sem inventar mês 13', () => {
  const r = filtrosRecentes('agendamento-field', new Date('2026-01-10T12:00:00Z'));
  assert.deepEqual(r.map(resumo), [
    'Ano=2026+Mês=janeiro',
    'Ano=2025+Mês=dezembro',
    'Ano=2025+Mês=novembro',
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
