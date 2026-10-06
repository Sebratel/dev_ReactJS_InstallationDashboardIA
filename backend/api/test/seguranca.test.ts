// Perímetro de segurança da API, ponta a ponta: headers, CSRF, rate limiting,
// `__proto__` no corpo, erro 500 sem detalhe em produção. Cada caso aqui é
// algo que FALHARIA sem a mudança correspondente — ver o plano que trouxe
// este arquivo (endurecimento de perímetro, 17/09/2026).
//
// Mesmo padrão de `servidor.test.ts`: `Servidor` real, `http.listen(0)`,
// `fetch` de verdade — não um mock de router.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Servidor } from '../src/servidor.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB = path.join(ROOT, 'frontend', 'dist');

function dirVazio(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'api-seguranca-'));
}

interface OpcoesServidor {
  tokenInterno?: string;
  cookieSecure?: boolean;
  confiaNoProxy?: boolean;
  producao?: boolean;
  firebaseProjectId?: string;
  /** Sobrescreve `identifica` para lançar — o jeito mais simples de produzir
   *  um 500 determinístico sem depender de nenhum estado quebrado de verdade. */
  identificaQuebrado?: boolean;
  agora?: () => Date;
}

async function sobe(opts: OpcoesServidor = {}): Promise<{
  base: string;
  busca: (rota: string, init?: RequestInit) => Promise<Response>;
  fecha: () => Promise<void>;
}> {
  const servidor = new Servidor({
    root: ROOT,
    snapshotDir: dirVazio(),
    webDir: WEB,
    agora: opts.agora ?? (() => new Date('2026-09-17T12:00:00.000Z')),
    // Sem provedor configurado: cai no bypass `dev-local` — estes testes são
    // sobre perímetro, não sobre quem está logado.
    ...(opts.tokenInterno !== undefined ? { tokenInterno: opts.tokenInterno } : {}),
    ...(opts.cookieSecure !== undefined ? { cookieSecure: opts.cookieSecure } : {}),
    ...(opts.confiaNoProxy !== undefined ? { confiaNoProxy: opts.confiaNoProxy } : {}),
    ...(opts.producao !== undefined ? { producao: opts.producao } : {}),
    ...(opts.firebaseProjectId !== undefined ? { firebaseProjectId: opts.firebaseProjectId } : {}),
    ...(opts.identificaQuebrado
      ? {
          identifica: () => {
            throw new Error('detalhe interno sensível: /caminho/de/disco/que/ninguem/de/fora/devia/ver');
          },
        }
      : {}),
  });
  const servidorHttp = servidor.criaHttp();
  await new Promise<void>((ok) => servidorHttp.listen(0, '127.0.0.1', ok));
  const { port } = servidorHttp.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    busca: (rota, init) => fetch(`${base}${rota}`, init),
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        servidorHttp.close(() => ok());
      }),
  };
}

// ----------------------------------------------------------------- headers

test('headers de segurança: presentes num 200', async () => {
  const s = await sobe();
  try {
    const r = await s.busca('/api/saude');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.ok(r.headers.get('permissions-policy'));
    const csp = r.headers.get('content-security-policy');
    assert.ok(csp, 'sem Content-Security-Policy');
    assert.doesNotMatch(csp!, /unsafe-eval/);
    assert.match(csp!, /accounts\.google\.com/, 'CSP tem de liberar o GIS, senão o login quebra');
  } finally {
    await s.fecha();
  }
});

// Este caso existe por um defeito medido, não por hipótese: com o CSP sem
// `apis.google.com`, o clique em "Entrar com Google" morria em
// "Não foi possível entrar com o Google" — o `signInWithPopup` do Firebase
// carrega o `gapi` de lá para montar o iframe-relé, e o bloqueio só aparecia
// no console do navegador (17/09/2026, Chromium de verdade contra a tela real).
test('CSP: libera o gapi (apis.google.com), sem o qual o login por Firebase não abre', async () => {
  const s = await sobe();
  try {
    const r = await s.busca('/api/saude');
    const csp = r.headers.get('content-security-policy')!;
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src '));
    assert.ok(scriptSrc, 'sem script-src');
    assert.match(scriptSrc!, /https:\/\/apis\.google\.com/);
  } finally {
    await s.fecha();
  }
});

test('CSP: frame-src ganha o domínio do projeto Firebase (o iframe de popup mora lá)', async () => {
  const s = await sobe({ firebaseProjectId: 'projeto-de-teste' });
  try {
    const r = await s.busca('/api/saude');
    const csp = r.headers.get('content-security-policy')!;
    const frameSrc = csp.split('; ').find((d) => d.startsWith('frame-src '));
    assert.ok(frameSrc, 'sem frame-src — o iframe cairia no default-src e seria bloqueado');
    assert.match(frameSrc!, /https:\/\/projeto-de-teste\.firebaseapp\.com/);
  } finally {
    await s.fecha();
  }
});

test('CSP: sem Firebase configurado, nenhum firebaseapp.com liberado à toa', async () => {
  const s = await sobe();
  try {
    const r = await s.busca('/api/saude');
    assert.doesNotMatch(r.headers.get('content-security-policy')!, /firebaseapp\.com/);
  } finally {
    await s.fecha();
  }
});

test('headers de segurança: presentes num 404 (arquivo estático ausente)', async () => {
  const s = await sobe();
  try {
    const r = await s.busca('/arquivo-que-nunca-existiu.txt');
    assert.equal(r.status, 404);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(r.headers.get('content-security-policy'));
  } finally {
    await s.fecha();
  }
});

test('headers de segurança: presentes até num 500', async () => {
  const s = await sobe({ identificaQuebrado: true });
  try {
    const r = await s.busca('/api/dashboards');
    assert.equal(r.status, 500);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(r.headers.get('content-security-policy'));
  } finally {
    await s.fecha();
  }
});

test('Strict-Transport-Security: ausente sem cookieSecure (sem TLS, HSTS seria uma promessa falsa)', async () => {
  const s = await sobe();
  try {
    const r = await s.busca('/api/saude');
    assert.equal(r.headers.get('strict-transport-security'), null);
  } finally {
    await s.fecha();
  }
});

test('Strict-Transport-Security: presente quando cookieSecure está ligado', async () => {
  const s = await sobe({ cookieSecure: true });
  try {
    const r = await s.busca('/api/saude');
    assert.ok(r.headers.get('strict-transport-security'));
  } finally {
    await s.fecha();
  }
});

// -------------------------------------------------------------- erro 500

test('erro interno fora de produção: mensagem original, para ajudar a depurar local', async () => {
  const s = await sobe({ identificaQuebrado: true, producao: false });
  try {
    const r = await s.busca('/api/dashboards');
    assert.equal(r.status, 500);
    const corpo = (await r.json()) as { erro: string; id: string };
    assert.match(corpo.erro, /detalhe interno sensível/);
    assert.ok(corpo.id);
  } finally {
    await s.fecha();
  }
});

test('erro interno em produção: mensagem genérica — o detalhe fica só no log', async () => {
  const s = await sobe({ identificaQuebrado: true, producao: true });
  try {
    const r = await s.busca('/api/dashboards');
    assert.equal(r.status, 500);
    const corpo = (await r.json()) as { erro: string; id: string };
    assert.equal(corpo.erro, 'Erro interno.');
    assert.doesNotMatch(corpo.erro, /caminho de disco/);
    assert.ok(corpo.id, 'sem id, ninguém acha a linha certa no log');
  } finally {
    await s.fecha();
  }
});

// ------------------------------------------------------------------- CSRF

test('CSRF: POST /auth/interno com Origin de outro host é recusado (403)', async () => {
  const s = await sobe({ tokenInterno: 'segredo-de-teste' });
  try {
    const r = await s.busca('/auth/interno', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://atacante.exemplo' },
      body: JSON.stringify({ token: 'segredo-de-teste' }),
    });
    assert.equal(r.status, 403);
  } finally {
    await s.fecha();
  }
});

test('CSRF: POST /auth/interno com Origin igual ao próprio host passa (não é 403)', async () => {
  const s = await sobe({ tokenInterno: 'segredo-de-teste' });
  try {
    const r = await s.busca('/auth/interno', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: s.base },
      body: JSON.stringify({ token: 'segredo-de-teste' }),
    });
    assert.equal(r.status, 200);
  } finally {
    await s.fecha();
  }
});

test('CSRF: POST /auth/interno sem Origin nem Referer passa (chamada servidor-a-servidor, ex. backend/tools/tela)', async () => {
  const s = await sobe({ tokenInterno: 'segredo-de-teste' });
  try {
    const r = await s.busca('/auth/interno', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'segredo-de-teste' }),
    });
    assert.equal(r.status, 200);
  } finally {
    await s.fecha();
  }
});

// --------------------------------------------------------- rate limiting

test('rate limiting: /auth/interno bloqueia depois do teto de tentativas, com Retry-After', async () => {
  const s = await sobe({ tokenInterno: 'segredo-de-teste' });
  try {
    // O teto é 10/5min (LIMITE_AUTH_TENTATIVAS em servidor.ts) — token ERRADO
    // de propósito, para não deslogar o cenário com sessão criada no meio.
    let ultima: Response | undefined;
    for (let i = 0; i < 11; i++) {
      ultima = await s.busca('/auth/interno', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'chute-errado' }),
      });
    }
    assert.equal(ultima!.status, 429);
    assert.ok(Number(ultima!.headers.get('retry-after')) > 0);
  } finally {
    await s.fecha();
  }
});

test('rate limiting: a janela libera de novo depois de passar o tempo', async () => {
  let relogio = new Date('2026-09-17T12:00:00.000Z');
  const s = await sobe({ tokenInterno: 'segredo-de-teste', agora: () => relogio });
  try {
    for (let i = 0; i < 10; i++) {
      await s.busca('/auth/interno', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'chute-errado' }),
      });
    }
    const bloqueado = await s.busca('/auth/interno', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'chute-errado' }),
    });
    assert.equal(bloqueado.status, 429);

    // Passa da janela (5 min + folga) — LIMITE_AUTH_TENTATIVAS/JANELA_AUTH_MS em servidor.ts.
    relogio = new Date(relogio.getTime() + 5 * 60_000 + 1_000);

    const depoisDaJanela = await s.busca('/auth/interno', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'segredo-de-teste' }),
    });
    assert.equal(depoisDaJanela.status, 200, 'a janela deveria ter liberado de novo');
  } finally {
    await s.fecha();
  }
});

// Achado do teste de intrusão ASVS (17/09/2026): com `ipDoPedido` confiando em
// `X-Real-IP` sem condição, 25/25 tentativas de brute force passaram trocando o
// header a cada pedido, com o balde do IP real já saturado — cada IP forjado
// ganhava um balde novo. Sem proxy declarado (o padrão), a chave TEM de ser o
// socket, que o cliente não escolhe, senão o rate limit é decorativo.
test('rate limiting: sem proxy confiável, X-Real-IP forjado NÃO abre balde novo (bypass fechado)', async () => {
  const s = await sobe({ tokenInterno: 'segredo-de-teste' }); // confiaNoProxy: false (padrão)
  try {
    // Todos vêm do mesmo socket (127.0.0.1); o X-Real-IP muda a cada pedido e
    // deve ser IGNORADO. Teto 10/5min → a 11ª tem de bloquear mesmo assim.
    let ultima: Response | undefined;
    for (let i = 0; i < 11; i++) {
      ultima = await s.busca('/auth/interno', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-real-ip': `10.0.0.${i}` },
        body: JSON.stringify({ token: 'chute-errado' }),
      });
    }
    assert.equal(ultima!.status, 429, 'X-Real-IP forjado não pode contornar o rate limit sem proxy');
    assert.ok(Number(ultima!.headers.get('retry-after')) > 0);
  } finally {
    await s.fecha();
  }
});

test('rate limiting: com proxy confiável, X-Real-IP volta a ser a chave (cada IP, seu balde)', async () => {
  const s = await sobe({ tokenInterno: 'segredo-de-teste', confiaNoProxy: true });
  try {
    // Atrás de um proxy que reescreve X-Real-IP, o header é a verdade: 20
    // pedidos de 20 IPs distintos são 20 clientes distintos, nenhum bloqueado.
    let bloqueados = 0;
    for (let i = 0; i < 20; i++) {
      const r = await s.busca('/auth/interno', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-real-ip': `10.0.0.${i}` },
        body: JSON.stringify({ token: 'chute-errado' }),
      });
      if (r.status === 429) bloqueados++;
    }
    assert.equal(bloqueados, 0, 'IPs distintos (via proxy) não deveriam se bloquear entre si');

    // E o mesmo IP, repetido além do teto, bloqueia — a contagem por chave vale.
    let ultima: Response | undefined;
    for (let i = 0; i < 11; i++) {
      ultima = await s.busca('/auth/interno', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-real-ip': '10.9.9.9' },
        body: JSON.stringify({ token: 'chute-errado' }),
      });
    }
    assert.equal(ultima!.status, 429, 'o mesmo X-Real-IP além do teto tem de bloquear');
  } finally {
    await s.fecha();
  }
});

test('rate limiting /api: o prefetch tem balde próprio e não gasta a cota de quem clica', async () => {
  const s = await sobe();
  // Conta quantos de `n` pedidos levaram 429 — o status dos outros não importa aqui
  // (o snapshot é vazio), só se o limitador deixou passar.
  const negados = async (n: number, rota: string) => {
    let quantos = 0;
    for (let i = 0; i < n; i++) if ((await s.busca(rota)).status === 429) quantos++;
    return quantos;
  };
  try {
    // 600 especulativos (LIMITE_PREFETCH_POR_MINUTO) passam, e o 601º não: o balde
    // existe, não é uma porta aberta por declarar `origem=prefetch`.
    assert.equal(await negados(600, '/api/dashboards?origem=prefetch'), 0);
    assert.equal(await negados(1, '/api/dashboards?origem=prefetch'), 1);
    // A cota interativa está intacta: 300 (LIMITE_API_POR_MINUTO) passam, o 301º não.
    // Antes do balde próprio, os 600 de cima já teriam esgotado esta.
    assert.equal(await negados(300, '/api/dashboards'), 0);
    assert.equal(await negados(1, '/api/dashboards'), 1);
  } finally {
    await s.fecha();
  }
});

// ------------------------------------------------------- prototype pollution

test('__proto__ no corpo de /auth/google não contamina Object.prototype', async () => {
  const s = await sobe();
  try {
    await s.busca('/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: 'qualquer', __proto__: { poluido: true } }),
    });
    assert.equal(({} as Record<string, unknown>).poluido, undefined);
  } finally {
    await s.fecha();
  }
});

// -------------------------------------------------------------- limites

test('header maior que maxHeaderSize (16 KB): 431, e o servidor continua atendendo', async () => {
  const s = await sobe();
  try {
    // `fetch` não serve aqui: o undici recusa o header gigante do lado do
    // cliente e o pedido nunca chega ao servidor — é preciso o `node:http` cru.
    const porta = Number(new URL(s.base).port);
    const status = await new Promise<number>((resolve, reject) => {
      const pedido = http.request(
        { host: '127.0.0.1', port: porta, path: '/api/saude', headers: { 'x-grande': 'a'.repeat(20_000) } },
        (resposta) => {
          resposta.resume();
          resolve(resposta.statusCode ?? 0);
        },
      );
      pedido.on('error', reject);
      pedido.end();
    });
    assert.equal(status, 431, 'esperado 431 Request Header Fields Too Large');

    const depois = await s.busca('/api/saude');
    assert.equal(depois.status, 200, 'o pedido gigante não pode derrubar o processo');
  } finally {
    await s.fecha();
  }
});

test('corpo maior que o teto (8 KB) em /auth/google: 400, não 500 e não trava o processo', async () => {
  const s = await sobe();
  try {
    const corpoGigante = JSON.stringify({ idToken: 'x'.repeat(20_000) });
    const r = await s.busca('/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: corpoGigante,
    });
    assert.equal(r.status, 400);
  } finally {
    await s.fecha();
  }
});

// ------------------------------------------------ id com encoding malformado

// Achado do teste de intrusão ASVS V5.1.4 (17/09/2026): `%` sem dois
// hexadecimais atrás fazia `decodeURIComponent` lançar, e a exceção subia até
// virar 500 — sujando o contador `erros_500`. Entrada malformada é 400 do
// cliente. Usa `node:http` cru: o undici normaliza/recusa `%ZZ` no cliente e o
// pedido nunca chegaria ao servidor.
test('id com percent-encoding inválido (%ZZ) responde 400, não 500', async () => {
  const s = await sobe();
  const porta = Number(new URL(s.base).port);
  const pede = (caminho: string): Promise<number> =>
    new Promise((resolve, reject) => {
      const pedido = http.request({ host: '127.0.0.1', port: porta, path: caminho }, (r) => {
        r.resume();
        resolve(r.statusCode ?? 0);
      });
      pedido.on('error', reject);
      pedido.end();
    });
  try {
    for (const ruim of ['/api/dashboards/%ZZ', '/api/dashboards/%', '/api/dashboards/%c0%ae']) {
      assert.equal(await pede(ruim), 400, `${ruim} devia ser 400, não 500`);
    }
    // Bem-formado mas inexistente segue sendo 404 (não foi afetado pela guarda).
    assert.equal(await pede('/api/dashboards/%2e%2e%2f'), 404);
    // E o processo continua atendendo.
    assert.equal(await pede('/api/saude'), 200);
  } finally {
    await s.fecha();
  }
});

// ------------------------------------------------ log de evento de segurança

// Achado do teste de intrusão ASVS V7.2 (17/09/2026, gap A09): nenhuma negativa
// de segurança (401/403/429) registrava evento — brute force, enumeração de
// sessão e varredura de CSRF passavam invisíveis. Agora cada uma emite uma linha
// `[seg]` por `console.warn`, com metadado só (nunca corpo, token ou PII).
function capturaWarn(): { linhas: string[]; restaura: () => void } {
  const original = console.warn;
  const linhas: string[] = [];
  console.warn = (...args: unknown[]) => {
    linhas.push(args.map((a) => String(a)).join(' '));
  };
  return { linhas, restaura: () => { console.warn = original; } };
}

test('log de segurança: 401 de sessão ausente emite linha [seg] com metadado, sem token', async () => {
  // Com Firebase configurado não há bypass `dev-local`: /api/* sem cookie dá 401.
  const s = await sobe({ firebaseProjectId: 'projeto-de-teste' });
  const cap = capturaWarn();
  try {
    const r = await s.busca('/api/dashboards');
    assert.equal(r.status, 401);
    const linha = cap.linhas.find((l) => l.startsWith('[seg]'));
    assert.ok(linha, 'sem linha [seg] no log da negativa');
    assert.match(linha!, /status=401/);
    assert.match(linha!, /motivo=sessao-ausente-ou-invalida/);
    assert.match(linha!, /rota=\/api\/dashboards/);
  } finally {
    cap.restaura();
    await s.fecha();
  }
});

test('log de segurança: token interno inválido (brute force) emite [seg], sem o valor tentado', async () => {
  const s = await sobe({ tokenInterno: 'segredo-de-teste' });
  const cap = capturaWarn();
  try {
    const r = await s.busca('/auth/interno', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: s.base },
      body: JSON.stringify({ token: 'chute-errado-do-atacante' }),
    });
    assert.equal(r.status, 401);
    const linha = cap.linhas.find((l) => l.startsWith('[seg]') && /token-interno-invalido/.test(l));
    assert.ok(linha, 'sem linha [seg] para o token inválido');
    assert.match(linha!, /status=401/);
    // O valor tentado NUNCA pode aparecer no log.
    assert.doesNotMatch(linha!, /chute-errado-do-atacante/);
  } finally {
    cap.restaura();
    await s.fecha();
  }
});
