// O cache do resultado inteiro de um visual.
//
// **O teste que dá razão ao arquivo é o do orçamento.** Guardar 33 mil linhas por
// visual só é aceitável enquanto houver um teto e um despejo — sem eles, um relatório
// com muitos recortes de segmentação empurraria a API para fora da memória, e trocar
// "a próxima página demora" por "a API morreu" seria um péssimo negócio.

import assert from 'node:assert/strict';
import test from 'node:test';
import { CacheDeVisual, estimaBytes, TETO_PADRAO_MB } from '../src/cache-visual.ts';

/** Um valor com tamanho previsível, para os testes de orçamento. */
function pesa(bytes: number): string {
  return 'x'.repeat(Math.max(0, Math.floor((bytes - 16) / 2)));
}

test('guarda e devolve', () => {
  const c = new CacheDeVisual();
  c.guarda('a', { linhas: [[1, 2]] });
  assert.deepEqual(c.le('a'), { linhas: [[1, 2]] });
  assert.equal(c.le('b'), undefined, 'chave que não existe é undefined, não erro');
});

test('o que não coube some, e o mais recente fica', () => {
  const c = new CacheDeVisual({ tetoBytes: 1000 });
  c.guarda('a', pesa(400));
  c.guarda('b', pesa(400));
  c.guarda('c', pesa(400));
  assert.equal(c.le('a'), undefined, 'o mais antigo saiu');
  assert.ok(c.le('b') !== undefined);
  assert.ok(c.le('c') !== undefined);
  assert.ok(c.bytes <= 1000, `o orçamento tem de ser respeitado, e são ${c.bytes} bytes`);
});

/**
 * **O "R" de LRU.** Sem isto a classe seria FIFO, e a tabela que a pessoa está
 * paginando agora — a mais lida de todas — sairia por ser a mais antiga a entrar.
 */
test('ler protege: quem sai é o menos usado recentemente, não o mais velho', () => {
  const c = new CacheDeVisual({ tetoBytes: 1000 });
  c.guarda('a', pesa(400));
  c.guarda('b', pesa(400));
  c.le('a'); // 'a' volta a ser o recente
  c.guarda('c', pesa(400));
  assert.ok(c.le('a') !== undefined, 'a foi lido há pouco e tem de ficar');
  assert.equal(c.le('b'), undefined, 'b é o que estava parado');
});

test('regravar a mesma chave não conta duas vezes', () => {
  const c = new CacheDeVisual({ tetoBytes: 10_000 });
  c.guarda('a', pesa(400));
  const um = c.bytes;
  c.guarda('a', pesa(400));
  assert.equal(c.bytes, um, 'o mesmo visual recalculado substitui, não acumula');
  assert.equal(c.itens, 1);
});

/**
 * Uma entrada maior que o teto inteiro esvaziaria o cache para sair no pedido
 * seguinte. Recusar é o certo — **e avisar é obrigatório**: um cache que descarta
 * calado é indistinguível de um cache que funciona, e manda quem investiga a
 * lentidão procurar no lugar errado.
 */
test('entrada maior que o teto é recusada, e a recusa aparece', () => {
  const avisos: string[] = [];
  const c = new CacheDeVisual({ tetoBytes: 500, aoRecusar: (k) => avisos.push(k) });
  c.guarda('gigante', pesa(5000));
  assert.equal(c.le('gigante'), undefined);
  assert.equal(c.itens, 0);
  assert.equal(c.bytes, 0, 'o que não entrou não pode contar no orçamento');
  assert.deepEqual(avisos, ['gigante']);
});

test('recusar não derruba o que já estava guardado', () => {
  const c = new CacheDeVisual({ tetoBytes: 500, aoRecusar: () => {} });
  c.guarda('a', pesa(200));
  c.guarda('gigante', pesa(5000));
  assert.ok(c.le('a') !== undefined, 'o visual pequeno continua servindo');
});

test('teto zero desliga sem ruído', () => {
  const avisos: string[] = [];
  const c = new CacheDeVisual({ tetoBytes: 0, aoRecusar: (k) => avisos.push(k) });
  c.guarda('a', { linhas: [] });
  assert.equal(c.le('a'), undefined);
  assert.deepEqual(avisos, [], 'quem desligou de propósito não quer um aviso por pedido');
});

test('limpa esvazia e zera a conta', () => {
  const c = new CacheDeVisual({ tetoBytes: 10_000 });
  c.guarda('a', pesa(400));
  c.limpa();
  assert.equal(c.itens, 0);
  assert.equal(c.bytes, 0);
  assert.equal(c.le('a'), undefined);
});

test('limpaPagina: só a página tocada some, o resto do cache fica quente', () => {
  const c = new CacheDeVisual({ tetoBytes: 10_000 });
  c.guarda('full:v1:local:agendamento-field:sha:v1:c1:d1', pesa(200));
  c.guarda('full:v1:outro-usuario:agendamento-field:sha:v2:c1:d1', pesa(200));
  c.guarda('full:v1:local:visao-geral:sha:v1:c1:d1', pesa(200));

  const removidas = c.limpaPagina('agendamento-field');

  assert.equal(removidas, 2, 'as duas entradas de agendamento-field (usuários diferentes)');
  assert.equal(c.le('full:v1:local:agendamento-field:sha:v1:c1:d1'), undefined);
  assert.equal(c.le('full:v1:outro-usuario:agendamento-field:sha:v2:c1:d1'), undefined);
  assert.notEqual(
    c.le('full:v1:local:visao-geral:sha:v1:c1:d1'),
    undefined,
    'visao-geral não usa a tabela que mudou — não podia sair do cache',
  );
});

test('limpaPagina: nome de página que é prefixo de outra não confunde (agenda vs agenda-2)', () => {
  const c = new CacheDeVisual({ tetoBytes: 10_000 });
  c.guarda('full:v1:local:agenda:sha:v1:c1:d1', pesa(200));
  c.guarda('full:v1:local:agenda-2:sha:v1:c1:d1', pesa(200));
  c.limpaPagina('agenda');
  assert.equal(c.le('full:v1:local:agenda:sha:v1:c1:d1'), undefined);
  assert.notEqual(c.le('full:v1:local:agenda-2:sha:v1:c1:d1'), undefined);
});

/**
 * A estimativa não precisa ser exata — precisa **não subestimar**. Subestimar é o
 * único erro que importa aqui: ele deixa o orçamento estourar em silêncio, que é
 * exatamente o que o orçamento existe para impedir.
 */
test('a estimativa cobre o tamanho do JSON, nunca fica abaixo dele', () => {
  const amostras: unknown[] = [
    null,
    42,
    'texto qualquer',
    [1, 2, 3],
    { a: 'x', b: [1, 2, { c: 'y' }] },
    Array.from({ length: 200 }, (_, i) => [i, `linha ${i}`, null, true]),
  ];
  for (const a of amostras) {
    const json = JSON.stringify(a).length;
    assert.ok(
      estimaBytes(a) >= json,
      `estimou ${estimaBytes(a)} para um JSON de ${json}: subestimar fura o orçamento`,
    );
  }
});

test('o teto padrão é grande o bastante para o relatório inteiro sem filtro', () => {
  // Medido em 17/08/2026: todos os visuais pagináveis das 14 páginas somam ~55 MB de
  // JSON (ACHADOS #70). O padrão precisa caber isso com folga, senão o despejo começa
  // antes mesmo de alguém aplicar uma segmentação.
  assert.ok(TETO_PADRAO_MB >= 128, `${TETO_PADRAO_MB} MB é pouco para ~55 MB de resultado`);
});
