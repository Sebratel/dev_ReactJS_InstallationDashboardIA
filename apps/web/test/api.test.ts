import assert from 'node:assert/strict';
import test from 'node:test';
import { ehAbortError, pega } from '../src/services/dashboardService.ts';

test('ehAbortError: reconhece o DOMException que fetch() lança ao abortar', () => {
  assert.equal(ehAbortError(new DOMException('The user aborted a request.', 'AbortError')), true);
});

test('ehAbortError: outro DOMException não é abort', () => {
  assert.equal(ehAbortError(new DOMException('nope', 'NotFoundError')), false);
});

test('ehAbortError: erro comum não é abort', () => {
  assert.equal(ehAbortError(new Error('falhou')), false);
  assert.equal(ehAbortError('string qualquer'), false);
  assert.equal(ehAbortError(null), false);
});

// ------------------------------------------------------------------ pega(): queda e teto
//
// `fetch` e relógio falsos: a regra é "repete o que é fora-do-ar por instantes, e só
// isso". As esperas reais (1, 3 e 6 s) ficam fora — `dorme` só anota.

function resposta(status: number, corpo: unknown = {}): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
}

/** Um `fetch` que devolve, em ordem, o que a lista mandar (Response ou erro a lançar). */
function roteiro(passos: (Response | Error)[]): { fetch: typeof fetch; chamadas: () => number } {
  let n = 0;
  const f = (async () => {
    const p = passos[Math.min(n++, passos.length - 1)]!;
    if (p instanceof Error) throw p;
    return p.clone();
  }) as unknown as typeof fetch;
  return { fetch: f, chamadas: () => n };
}

test('pega: 503 do proxy durante o reinício é repetido, e a tela recebe o dado', async () => {
  const r = roteiro([resposta(503), resposta(502), resposta(200, { ok: 1 })]);
  const dormidas: number[] = [];
  const corpo = await pega<{ ok: number }>('/api/x', undefined, {
    fetch: r.fetch,
    dorme: async (ms) => void dormidas.push(ms),
  });
  assert.deepEqual(corpo, { ok: 1 });
  assert.equal(r.chamadas(), 3);
  assert.deepEqual(dormidas, [1_000, 3_000], 'espera crescente');
});

test('pega: rede caída (TypeError do fetch) também é repetida', async () => {
  const r = roteiro([new TypeError('Failed to fetch'), resposta(200, { ok: 2 })]);
  assert.deepEqual(await pega('/api/x', undefined, { fetch: r.fetch, dorme: async () => {} }), { ok: 2 });
});

test('pega: 500 NÃO é repetido — é a API dizendo o que deu errado, e a mensagem dela chega', async () => {
  const r = roteiro([resposta(500, { erro: 'snapshot ausente: rode npm run snapshot' }), resposta(200)]);
  await assert.rejects(pega('/api/x', undefined, { fetch: r.fetch, dorme: async () => {} }), /snapshot ausente/);
  assert.equal(r.chamadas(), 1);
});

test('pega: fora do ar além das tentativas vira erro, com o HTTP', async () => {
  const r = roteiro([resposta(502)]);
  await assert.rejects(pega('/api/x', undefined, { fetch: r.fetch, dorme: async () => {} }), /HTTP 502/);
  assert.equal(r.chamadas(), 4, '1 + 3 novas tentativas');
});

test('pega: API travada estoura o teto como ERRO, não como cancelamento, e não repete', async () => {
  let chamadas = 0;
  const pendura = ((_url: string, init?: RequestInit) => {
    chamadas += 1;
    return new Promise((_ok, falha) => init!.signal!.addEventListener('abort', () => falha(init!.signal!.reason)));
  }) as unknown as typeof fetch;
  const err = await pega('/api/x', undefined, { fetch: pendura, tetoMs: 20, dorme: async () => {} }).catch((e) => e);
  assert.match(String(err), /não respondeu em 0 s/);
  assert.equal(ehAbortError(err), false, 'se parecesse cancelamento, a tela o engoliria em silêncio');
  assert.equal(chamadas, 1);
});

test('pega: quem chamou cancelou durante a espera — sai AbortError, sem nova tentativa', async () => {
  const r = roteiro([resposta(503), resposta(200)]);
  const freio = new AbortController();
  const err = await pega('/api/x', freio.signal, {
    fetch: r.fetch,
    dorme: (_ms, signal) => {
      freio.abort();
      return Promise.reject(signal!.reason);
    },
  }).catch((e) => e);
  assert.equal(ehAbortError(err), true);
  assert.equal(r.chamadas(), 1);
});
