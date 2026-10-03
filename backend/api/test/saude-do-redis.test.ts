// A saúde tem de dizer que o Redis caiu — e não pode derrubar a API por isso.
//
// **O defeito que originou este arquivo aconteceu ao vivo em 08/09/2026**, no
// meio da medição da F2: o container do Redis seguia "Up 38 hours", a porta
// parou de aceitar conexão, e a API MORREU com
//
//     [ioredis] Unhandled error event: AggregateError [ECONNREFUSED]
//
// contra as 25 linhas de `index.ts` que prometem que Redis fora do ar é miss, e
// não exceção. O ouvinte de `'error'` consertou a morte; o que faltava era a
// metade silenciosa: `GET /api/saude` continuava respondendo
// `adapter: "MemoryCache+RedisCache"` — o nome do arranjo montado na subida, não
// o estado dele agora. Uma API degradada parecia saudável.
//
// O teste que mais importa aqui é o último: degradado responde **200**. O
// healthcheck do `docker-compose.prod.yml` testa `r.ok`, então um 503 faria o
// Docker reiniciar a API em laço por causa de um cache OPCIONAL — degradação
// prevista virando indisponibilidade real.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SaudeDoRedis, redisAusente, semSegredo } from '../src/saude-do-redis.ts';
import { Servidor } from '../src/servidor.ts';
import type { EstadoDoRedis } from '../src/saude-do-redis.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB = path.join(ROOT, 'frontend', 'dist');

const relogio = (): (() => Date) => {
  let t = Date.parse('2026-09-08T12:00:00.000Z');
  return () => new Date((t += 60_000));
};

// ------------------------------------------------------------------ a peça

test('o estado inicial é "ocioso": configurado e ainda sem conexão', () => {
  // `lazyConnect` só abre a conexão na primeira operação, então logo depois da
  // subida não há nem sucesso nem falha. Dizer "ok" aqui seria mentira, e dizer
  // "degradado" seria alarme falso a cada restart.
  const s = new SaudeDoRedis(relogio());
  assert.equal(s.estado().status, 'ocioso');
  assert.equal(s.estado().falhas, 0);
});

test('uma falha vira "degradado", e diz qual foi a operação', () => {
  const s = new SaudeDoRedis(relogio());
  assert.equal(s.falhou('conexão', new Error('connect ECONNREFUSED 127.0.0.1:6379')), true);
  const e = s.estado();
  assert.equal(e.status, 'degradado');
  assert.equal(e.falhas, 1);
  assert.equal(e.ultimaOperacao, 'conexão');
  assert.match(e.ultimoErro ?? '', /ECONNREFUSED/);
});

test('só a TRANSIÇÃO devolve true — é o que impede centenas de linhas de log iguais', () => {
  // Um Redis inalcançável emite `'error'` a cada tentativa de reconexão do
  // driver. Sem esta distinção, a primeira linha (a que interessa) ficaria
  // soterrada em segundos. A contagem continua subindo — ela é que vai para a
  // saúde.
  const s = new SaudeDoRedis(relogio());
  assert.equal(s.falhou('conexão', new Error('a')), true);
  assert.equal(s.falhou('conexão', new Error('b')), false);
  assert.equal(s.falhou('get', new Error('c')), false);
  assert.equal(s.estado().falhas, 3);
});

test('quando o Redis volta, o contador de falhas NÃO zera', () => {
  // É o número que distingue "caiu uma vez às 3h" de "está piscando". Um
  // `status: "ok"` com 4.000 falhas é uma conexão instável, e o instantâneo
  // sozinho nunca contaria isso — que é exatamente a informação que faltava
  // quando o Redis desta máquina ficou "Up" com a porta recusando conexão.
  const s = new SaudeDoRedis(relogio());
  s.falhou('conexão', new Error('caiu'));
  assert.equal(s.conectou(), true, 'voltar a conectar é uma transição');
  const e = s.estado();
  assert.equal(e.status, 'ok');
  assert.equal(e.falhas, 1);
  assert.equal(e.ultimoErro, 'caiu', 'o último erro continua legível depois da volta');
  assert.equal(s.conectou(), false, 'um segundo "ready" não é transição nenhuma');
});

test('o "desde" acompanha a mudança de estado, não o relógio', () => {
  const s = new SaudeDoRedis(relogio());
  const inicio = s.estado().desde;
  s.falhou('conexão', new Error('caiu'));
  const caiu = s.estado().desde;
  assert.notEqual(caiu, inicio, 'entrar em degradado reinicia o relógio do status');
  s.falhou('conexão', new Error('de novo'));
  assert.equal(s.estado().desde, caiu, 'continuar caído não reinicia — o que se lê é "caído desde"');
});

test('a senha da URL não vaza pela saúde', () => {
  // `/api/saude` fica FORA da guarda de sessão de propósito (é o healthcheck do
  // container que bate nela), então tudo que sai por aqui é público para quem
  // alcança a porta. As mensagens do driver normalmente trazem só
  // `ECONNREFUSED host:porta` — mas as de autenticação podem ecoar a URL
  // inteira, e a URL inteira tem a senha.
  assert.equal(
    semSegredo('falha em redis://padrao:s3nh4-real@redis-prod:6379/0'),
    'falha em redis://***@redis-prod:6379/0',
  );
  assert.equal(semSegredo('rediss://user:pw@host'), 'rediss://***@host');
  assert.equal(
    semSegredo('connect ECONNREFUSED 172.18.0.3:6379'),
    'connect ECONNREFUSED 172.18.0.3:6379',
    'sem credencial no texto, nada é mexido — o operador precisa do host para diagnosticar',
  );

  const s = new SaudeDoRedis(relogio());
  s.falhou('conexão', new Error('NOAUTH em redis://admin:segredo@10.0.0.5:6379'));
  assert.ok(!(s.estado().ultimoErro ?? '').includes('segredo'));
});

test('redisAusente() devolve um objeto NOVO a cada chamada', () => {
  // Ele sai no corpo de um JSON. Uma constante compartilhada convidaria alguém
  // a mutá-la um dia, e a mutação valeria para todas as respostas seguintes.
  const a = redisAusente();
  const b = redisAusente();
  assert.equal(a.status, 'ausente');
  assert.notEqual(a, b);
});

// -------------------------------------------------------------------- HTTP

function dirVazio(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'saude-redis-'));
}

async function sobe(estadoDoRedis?: () => EstadoDoRedis): Promise<{
  saude: () => Promise<{ resposta: Response; corpo: Record<string, unknown> }>;
  fecha: () => Promise<void>;
}> {
  const servidor = new Servidor({
    root: ROOT,
    snapshotDir: dirVazio(),
    webDir: WEB,
    agora: () => new Date('2026-09-08T12:00:00.000Z'),
    ...(estadoDoRedis ? { estadoDoRedis } : {}),
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    saude: async () => {
      const resposta = await fetch(`http://127.0.0.1:${port}/api/saude`);
      return { resposta, corpo: (await resposta.json()) as Record<string, unknown> };
    },
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.closeAllConnections?.();
        http.close(() => ok());
      }),
  };
}

test('sem REDIS_URL a saúde diz "ausente" — e não omite o campo', async () => {
  // Omitir seria pior que dizer: um campo faltando é indistinguível de uma
  // versão antiga da API, e o operador não saberia se a informação não existe
  // ou se o servidor é velho.
  const s = await sobe();
  try {
    const { corpo } = await s.saude();
    const cache = corpo.cache as { adapter: string; redis: EstadoDoRedis };
    assert.equal(cache.redis.status, 'ausente');
    assert.equal(cache.redis.falhas, 0);
    assert.equal(cache.adapter, 'MemoryCache');
  } finally {
    await s.fecha();
  }
});

test('Redis DEGRADADO aparece na saúde — e ela continua respondendo 200', async () => {
  // O teste que mais importa deste arquivo, nas duas metades:
  //
  //   1. a degradação tem de ser VISÍVEL. `adapter` sozinho diz o que foi
  //      montado na subida e continua dizendo "MemoryCache+RedisCache" para
  //      sempre, com o Redis no chão. Era assim que uma API degradada parecia
  //      saudável.
  //   2. a degradação NÃO pode virar 503. O healthcheck do
  //      `docker-compose.prod.yml` é
  //      `fetch(...).then(r => process.exit(r.ok ? 0 : 1))`, então um 503 aqui
  //      faria o Docker reiniciar a API em laço por causa de um cache opcional.
  const s = await sobe(() => ({
    status: 'degradado',
    falhas: 12,
    desde: '2026-09-08T11:59:00.000Z',
    ultimoErro: 'connect ECONNREFUSED 172.18.0.3:6379',
    ultimaOperacao: 'conexão',
  }));
  try {
    const { resposta, corpo } = await s.saude();
    assert.equal(resposta.status, 200, 'Redis caído não pode derrubar o healthcheck do container');
    assert.equal(resposta.ok, true);

    const cache = corpo.cache as { redis: EstadoDoRedis };
    assert.equal(cache.redis.status, 'degradado');
    assert.equal(cache.redis.falhas, 12);
    assert.equal(cache.redis.ultimaOperacao, 'conexão');
    assert.match(cache.redis.ultimoErro ?? '', /ECONNREFUSED/);
  } finally {
    await s.fecha();
  }
});
