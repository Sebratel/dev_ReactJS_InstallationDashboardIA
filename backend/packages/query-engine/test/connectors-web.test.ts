// Testes do buscador HTTP.
//
// O que estes testes protegem é a **quarta camada do guard read-only**. As outras
// três vivem no Postgres e não dizem nada sobre HTTP: sem o que está aqui, uma
// expressão M passaria a escolher com quem a plataforma fala e por qual verbo.
//
// Nenhum toca a rede — `fetchImpl` é injetado.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buscadorWeb,
  endpointsDe,
  TIMEOUT_WEB_PADRAO_MS,
  WebError,
} from '../src/connectors-web.ts';

const PERMITIDOS = ['https://archive-api.open-meteo.com', 'https://api.open-meteo.com'];

/** `fetch` de mentira: grava o que recebeu e devolve o corpo pedido. */
function fakeFetch(corpo = '{"ok":true}', init: Partial<Response> = {}) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL, i?: RequestInit) => {
    chamadas.push({ url: String(url), init: i ?? {} });
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      statusText: init.statusText ?? 'OK',
      arrayBuffer: async () => new TextEncoder().encode(corpo).buffer,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, chamadas };
}

// ───────────────────────────────────────────────── caminho normal

test('busca devolve os bytes do corpo', async () => {
  const { impl } = fakeFetch('{"daily":{"time":["2026-01-01"]}}');
  const buscar = buscadorWeb({ permitidos: PERMITIDOS, fetchImpl: impl });
  const bytes = await buscar({ url: 'https://api.open-meteo.com/v1/forecast', headers: {} });
  assert.equal(Buffer.from(bytes).toString('utf8'), '{"daily":{"time":["2026-01-01"]}}');
});

test('repassa os headers do pedido', async () => {
  const { impl, chamadas } = fakeFetch();
  const buscar = buscadorWeb({ permitidos: PERMITIDOS, fetchImpl: impl });
  await buscar({
    url: 'https://api.open-meteo.com/v1/forecast',
    headers: { 'Accept-Encoding': 'identity' },
  });
  assert.deepEqual(chamadas[0]!.init.headers, { 'Accept-Encoding': 'identity' });
});

// ───────────────────────────────────────────────── o guard

test('o método é sempre GET — não há como pedir outro', async () => {
  const { impl, chamadas } = fakeFetch();
  const buscar = buscadorWeb({ permitidos: PERMITIDOS, fetchImpl: impl });
  await buscar({ url: 'https://api.open-meteo.com/v1/forecast', headers: {} });
  assert.equal(chamadas[0]!.init.method, 'GET');
});

test('host fora da allowlist é recusado, e o erro lista os permitidos', async () => {
  const { impl, chamadas } = fakeFetch();
  const buscar = buscadorWeb({ permitidos: PERMITIDOS, fetchImpl: impl });
  await assert.rejects(
    () => buscar({ url: 'https://exemplo.invalido/v1/dados', headers: {} }),
    (e: Error) => {
      assert.ok(e instanceof WebError);
      assert.match(e.message, /exemplo\.invalido/);
      assert.match(e.message, /api\.open-meteo\.com/);
      return true;
    },
  );
  // O que mais importa: recusou ANTES de sair da máquina.
  assert.equal(chamadas.length, 0);
});

test('subdomínio não herda a permissão do domínio', async () => {
  const { impl } = fakeFetch();
  const buscar = buscadorWeb({ permitidos: ['https://api.open-meteo.com'], fetchImpl: impl });
  await assert.rejects(
    () => buscar({ url: 'https://mau.api.open-meteo.com/v1/x', headers: {} }),
    WebError,
  );
});

test('host parecido não passa por prefixo', async () => {
  const { impl } = fakeFetch();
  const buscar = buscadorWeb({ permitidos: ['https://api.open-meteo.com'], fetchImpl: impl });
  await assert.rejects(
    () => buscar({ url: 'https://api.open-meteo.com.invalido/v1/x', headers: {} }),
    WebError,
  );
});

test('esquema file: é recusado — leria o disco da máquina', async () => {
  const { impl, chamadas } = fakeFetch();
  const buscar = buscadorWeb({ permitidos: PERMITIDOS, fetchImpl: impl });
  await assert.rejects(
    () => buscar({ url: 'file:///etc/passwd', headers: {} }),
    (e: Error) => {
      assert.match(e.message, /file:/);
      return true;
    },
  );
  assert.equal(chamadas.length, 0);
});

test('allowlist vazia falha na construção, não no primeiro pedido', () => {
  assert.throws(() => buscadorWeb({ permitidos: [] }), WebError);
});

test('allowlist aceita host puro além de origem', async () => {
  const { impl } = fakeFetch();
  const buscar = buscadorWeb({ permitidos: ['api.open-meteo.com'], fetchImpl: impl });
  const bytes = await buscar({ url: 'https://api.open-meteo.com/v1/forecast', headers: {} });
  assert.ok(bytes.byteLength > 0);
});

// ───────────────────────────────────────────────── falhas

test('status não-2xx erra, e o corpo do terceiro NÃO entra na mensagem', async () => {
  const { impl } = fakeFetch('<html>segredo do outro lado</html>', {
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
  });
  const buscar = buscadorWeb({ permitidos: PERMITIDOS, fetchImpl: impl });
  await assert.rejects(
    () => buscar({ url: 'https://api.open-meteo.com/v1/forecast', headers: {} }),
    (e: Error) => {
      assert.match(e.message, /429/);
      assert.doesNotMatch(e.message, /segredo/);
      return true;
    },
  );
});

test('falha de rede vira WebError dizendo a URL', async () => {
  const impl = (async () => {
    throw new Error('getaddrinfo ENOTFOUND');
  }) as unknown as typeof fetch;
  const buscar = buscadorWeb({ permitidos: PERMITIDOS, fetchImpl: impl });
  await assert.rejects(
    () => buscar({ url: 'https://api.open-meteo.com/v1/forecast', headers: {} }),
    (e: Error) => {
      assert.ok(e instanceof WebError);
      assert.match(e.message, /api\.open-meteo\.com/);
      assert.match(e.message, /ENOTFOUND/);
      return true;
    },
  );
});

test('timeout diz o teto em ms, não "AbortError"', async () => {
  const impl = (async () => {
    const e = new Error('The operation was aborted due to timeout');
    e.name = 'TimeoutError';
    throw e;
  }) as unknown as typeof fetch;
  const buscar = buscadorWeb({ permitidos: PERMITIDOS, timeoutMs: 1234, fetchImpl: impl });
  await assert.rejects(
    () => buscar({ url: 'https://api.open-meteo.com/v1/forecast', headers: {} }),
    (e: Error) => {
      assert.match(e.message, /1234 ms/);
      return true;
    },
  );
});

test('o sinal de abort chega ao fetch com o teto default', async () => {
  const { impl, chamadas } = fakeFetch();
  const buscar = buscadorWeb({ permitidos: PERMITIDOS, fetchImpl: impl });
  await buscar({ url: 'https://api.open-meteo.com/v1/forecast', headers: {} });
  assert.ok(chamadas[0]!.init.signal instanceof AbortSignal);
  assert.equal(TIMEOUT_WEB_PADRAO_MS, 30_000);
});

// ───────────────────────────────────────────────── allowlist a partir das specs

test('endpointsDe junta, deduplica e ordena', () => {
  assert.deepEqual(
    endpointsDe([
      { endpoints: ['https://b.example', 'https://a.example'] },
      { endpoints: ['https://a.example'] },
      {},
    ]),
    ['https://a.example', 'https://b.example'],
  );
});

test('a spec de clima-tempo declara os dois endpoints que o M usa', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const yaml = (await import('yaml')).default;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const spec = yaml.parse(
    fs.readFileSync(path.join(root, 'backend', 'specs', '_catalog', 'queries', 'clima-tempo.spec.yaml'), 'utf8'),
  ) as { endpoints?: string[]; m_expression?: string };

  // Sem isto, a allowlist ficaria vazia e a query erraria na construção — o que é
  // seguro, mas o sintoma apareceria longe da causa.
  assert.ok(spec.endpoints?.length, 'clima-tempo precisa de endpoints na spec');
  // Todo host que o M chama tem de estar declarado. É a checagem que pega o dia em
  // que alguém acrescentar um `Web.Contents` para outra API no Power BI.
  const hosts = [...spec.m_expression!.matchAll(/Web\.Contents\(\s*"([^"]+)"/g)].map(
    (m) => new URL(m[1]!).host,
  );
  const permitidos = new Set(spec.endpoints!.map((e) => new URL(e).host));
  for (const h of new Set(hosts)) {
    assert.ok(permitidos.has(h), `o M chama ${h}, que não está em endpoints`);
  }
});
