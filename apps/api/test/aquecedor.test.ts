// O reaquecimento automático.
//
// **O que estes testes guardam é que o aquecedor não mente sobre ter feito o
// serviço.** Ele existe para que o custo do primeiro pedido depois de um refresh caia
// no servidor e não em quem está esperando na frente da tela. Um aquecedor que se
// declara pronto sem estar devolve a lentidão para a pessoa, e ainda tira a única
// pista de que ela ia acontecer.
//
// Tudo é injetado — `buscar`, `agora`, `carimbo`. Um teste que dependesse de
// temporizador de verdade esperaria 5 s para afirmar o que acontece em 5 ms, e um que
// subisse a API viraria demo.

import assert from 'node:assert/strict';
import test from 'node:test';
import { Aquecedor } from '../src/aquecedor.ts';

const PAGINAS = { dashboards: [{ id: 'capa' }, { id: 'visao-geral' }] };

/** Uma API de mentira que anota o que pediram para ela. */
function apiFalsa(opts: { falha?: Set<string>; status?: Map<string, number> } = {}): {
  buscar: typeof fetch;
  pedidos: string[];
} {
  const pedidos: string[] = [];
  const buscar = (async (url: string | URL): Promise<Response> => {
    const u = String(url);
    if (u.endsWith('/api/dashboards')) {
      return new Response(JSON.stringify(PAGINAS), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const id = decodeURIComponent(u.split('/').pop() ?? '');
    pedidos.push(id);
    if (opts.falha?.has(id)) throw new Error('ECONNRESET');
    return new Response('{}', { status: opts.status?.get(id) ?? 200 });
  }) as unknown as typeof fetch;
  return { buscar, pedidos };
}

function silencio(): (l: string) => void {
  return () => {};
}

test('aquece no arranque: o restart não devolve a tela branca de dois minutos', async () => {
  const { buscar, pedidos } = apiFalsa();
  const a = new Aquecedor({ base: 'http://x', carimbo: () => 'c1', buscar, anuncia: silencio() });

  const p = await a.tenta();
  assert.ok(p !== null, 'a primeira volta sempre aquece — não há nada aquecido antes dela');
  assert.deepEqual(pedidos, ['capa', 'visao-geral']);
  assert.equal(p.obsoleta, false);
  assert.equal(p.paginas.length, 2);
});

test('sem mudança no disco, não reaquece — o laço não gasta CPU à toa', async () => {
  const { buscar, pedidos } = apiFalsa();
  const a = new Aquecedor({ base: 'http://x', carimbo: () => 'c1', buscar, anuncia: silencio() });

  await a.tenta();
  assert.equal(pedidos.length, 2);
  assert.equal(await a.tenta(), null, 'mesmo carimbo, nada a fazer');
  assert.equal(await a.tenta(), null);
  assert.equal(pedidos.length, 2, 'nenhum pedido a mais');
});

/**
 * O caso que dá nome ao arquivo: `npm run snapshot` rodou.
 */
test('carimbo novo reaquece — é o "se atualiza a cada atualização"', async () => {
  const { buscar, pedidos } = apiFalsa();
  let carimbo = 'c1';
  const a = new Aquecedor({ base: 'http://x', carimbo: () => carimbo, buscar, anuncia: silencio() });

  await a.tenta();
  assert.deepEqual(pedidos, ['capa', 'visao-geral']);

  carimbo = 'c2';
  const p = await a.tenta();
  assert.ok(p !== null);
  assert.deepEqual(pedidos, ['capa', 'visao-geral', 'capa', 'visao-geral']);
});

/**
 * A virada da meia-noite conta como mudança, porque o `carimbo` que entra aqui é a
 * identidade completa (`Servidor.identidadeAtual`): dado **e** dia. Um aquecedor que
 * vigiasse só o dado dormiria exatamente no instante em que o cache inteiro morre.
 */
test('a virada do dia também reaquece', async () => {
  const { buscar, pedidos } = apiFalsa();
  let identidade = 'c1@2026-08-07';
  const a = new Aquecedor({
    base: 'http://x',
    carimbo: () => identidade,
    buscar,
    anuncia: silencio(),
  });

  await a.tenta();
  assert.equal(pedidos.length, 2);

  identidade = 'c1@2026-08-08'; // mesmo disco, outro dia
  assert.ok((await a.tenta()) !== null, 'o dia mudou e o TODAY() de 32 expressões junto');
  assert.equal(pedidos.length, 4);
});

/**
 * Um refresh que termina **durante** o aquecimento deixa inalcançável tudo o que
 * acabou de ser calculado. O aquecedor não pode ir dormir achando que fez o serviço:
 * seria a pior das duas hipóteses — gastou o tempo e a tela continua fria.
 */
test('carimbo que muda no meio da passada não conta como aquecido', async () => {
  const { buscar, pedidos } = apiFalsa();
  // O disco já está em `c2` quando a passada termina — é o refresh que acabou no meio
  // dela. A passada foi pedida para `c1` e aqueceu chaves de `c1`.
  const a = new Aquecedor({ base: 'http://x', carimbo: () => 'c2', buscar, anuncia: silencio() });

  const p = await a.passada('c1');
  assert.equal(p.obsoleta, true, 'o que foi aquecido já nasceu velho');
  assert.equal(pedidos.length, 2);

  // E a próxima volta tem de recomeçar, em vez de achar que está tudo quente.
  assert.ok((await a.tenta()) !== null, 'passada obsoleta não marca nada como aquecido');
  assert.equal(pedidos.length, 4);
});

/**
 * Duas passadas ao mesmo tempo dobrariam o pico de memória de uma máquina de 16 GB
 * para recalcular o que a primeira já está calculando.
 */
test('não roda duas passadas ao mesmo tempo', async () => {
  const pedidos: string[] = [];
  let solta: (() => void) | null = null;
  const presa = new Promise<void>((ok) => {
    solta = ok;
  });
  const buscar = (async (url: string | URL): Promise<Response> => {
    const u = String(url);
    if (u.endsWith('/api/dashboards')) return new Response(JSON.stringify(PAGINAS), { status: 200 });
    pedidos.push(decodeURIComponent(u.split('/').pop() ?? ''));
    await presa; // a primeira passada fica pendurada aqui
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;

  const a = new Aquecedor({ base: 'http://x', carimbo: () => 'c1', buscar, anuncia: silencio() });
  const primeira = a.tenta();
  await new Promise((r) => setImmediate(r));

  assert.equal(await a.tenta(), null, 'a segunda desiste enquanto a primeira corre');
  solta!();
  await primeira;
  assert.deepEqual(pedidos, ['capa', 'visao-geral'], 'cada página foi pedida uma vez só');
});

/**
 * O aquecedor é conveniência, não caminho crítico: ele nunca pode derrubar a API.
 */
test('página que falha não interrompe as outras nem lança', async () => {
  const { buscar, pedidos } = apiFalsa({
    falha: new Set(['capa']),
    status: new Map([['visao-geral', 409]]),
  });
  const linhas: string[] = [];
  const a = new Aquecedor({
    base: 'http://x',
    carimbo: () => 'c1',
    buscar,
    anuncia: (l) => linhas.push(l),
  });

  const p = await a.passada('c1');
  assert.deepEqual(pedidos, ['capa', 'visao-geral'], 'a falha da primeira não parou a segunda');
  assert.equal(p.paginas[0]?.status, null, 'rede caiu: sem status');
  assert.equal(p.paginas[1]?.status, 409);
  // E nenhuma das duas some calada — um aquecedor mudo é indistinguível de um que
  // não está rodando.
  assert.ok(linhas.some((l) => l.includes('capa')), 'a falha de rede aparece');
  assert.ok(linhas.some((l) => l.includes('409')), 'o status inesperado aparece');
});

test('API que não responde a lista não derruba nada — a próxima volta tenta', async () => {
  const buscar = (async (): Promise<Response> => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  const a = new Aquecedor({ base: 'http://x', carimbo: () => 'c1', buscar, anuncia: silencio() });
  const p = await a.passada('c1');
  assert.deepEqual(p.paginas, []);
});

test('para() encerra o laço', async () => {
  const { buscar } = apiFalsa();
  const a = new Aquecedor({ base: 'http://x', carimbo: () => 'c1', buscar, anuncia: silencio() });
  a.inicia();
  a.para();
  a.para(); // idempotente
});
