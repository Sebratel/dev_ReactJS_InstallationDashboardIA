#!/usr/bin/env node
// `npm run probe:redis` — o Redis do `.env` responde, e o cache funciona nele?
//
// **Por que um probe e não "confia no `npm run api`".** A API degrada de propósito:
// Redis fora do ar vira miss, e ela sobe e serve normalmente. Isso é o desenho certo
// para produção e péssimo para configurar — sem este programa, `REDIS_URL` errado
// parece funcionar, e a única pista seria a página estar lenta.
//
// **REGRA DE SAÍDA: nunca imprime credencial.** A URL aparece mascarada — host e
// porta sim, usuário e senha nunca. A saída é segura para colar em ticket.
//
// Ele escreve **uma** chave, com TTL curto, sob o prefixo do `.env`, e a apaga no
// fim. É a única ferramenta do repositório que escreve em algum lugar, e o lugar é o
// cache — a regra 3 é sobre não escrever no **ERP**, e continua inteira.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv, loadConfig } from '../../../packages/query-engine/src/config.ts';
import { RedisCache } from '../../../packages/query-engine/src/cache-redis.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);

/** `redis://user:senha@host:6379/0` → `redis://***@host:6379/0`. */
export function mascara(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = '***';
      u.password = '';
    }
    return u.toString();
  } catch {
    return '<URL ilegível>';
  }
}

const cfg = loadConfig();
const url = cfg.redis.url;
const prefixo = cfg.redis.keyPrefix;
const definidaNoEnv = Boolean(process.env.REDIS_URL);

console.log('Probe do Redis');
console.log(`  URL      ${mascara(url)}`);
console.log(`  prefixo  ${prefixo}`);
if (!definidaNoEnv) {
  console.log(`\n  ⚠ REDIS_URL não está no .env — isto é o default do código.`);
  console.log(`    O Redis do Portainer não está em 'localhost': o 172.24.0.x que o`);
  console.log(`    Portainer mostra é IP interno da rede Docker e não sai de lá. Use o`);
  console.log(`    host do servidor do Portainer, ex.: REDIS_URL=redis://SERVIDOR:6379/0`);
}

const chave = `${prefixo}probe:${process.pid}`;
const { default: Redis } = await import('ioredis');
const redis = new Redis(url, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  connectTimeout: 5_000,
  retryStrategy: () => null, // um probe não fica tentando: ou responde, ou reporta
});

let saida = 0;
try {
  const t0 = Date.now();
  await redis.connect();
  console.log(`\n  conectou em ${Date.now() - t0} ms`);

  const info = await redis.info('server');
  const versao = /redis_version:(\S+)/.exec(info)?.[1] ?? '?';
  const modo = /redis_mode:(\S+)/.exec(info)?.[1] ?? '?';
  console.log(`  redis ${versao} (modo ${modo})`);

  const cache = new RedisCache(redis);
  const valor = { probe: true, quando: new Date().toISOString() };

  await cache.set(chave, valor, 30);
  const lido = await cache.get<typeof valor>(chave);
  if (lido?.quando !== valor.quando) {
    throw new Error('gravou e leu de volta outra coisa — o cache não está íntegro');
  }
  console.log('  set + get: ok');

  const achadas = await cache.keys(`${prefixo}probe:`);
  console.log(`  scan pelo prefixo: ${achadas.length} chave(s)`);

  await cache.del(chave);
  console.log(`  del: ok (chave de teste removida)`);

  console.log(`\n  ✅ O Redis serve. Ponha REDIS_URL no .env e 'npm run api' passa a usá-lo`);
  console.log(`     — GET /api/saude vai mostrar cache.adapter = RedisCache.`);
} catch (err) {
  saida = 1;
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n  ❌ ${msg}`);
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/.test(msg)) {
    console.error(`\n  Não chegou no servidor. Confira, nesta ordem:`);
    console.error(`    1. o host é o do servidor do Portainer, não 172.24.0.x nem localhost`);
    console.error(`    2. a porta 6379 está publicada para fora do host (o print mostrava 6379:6379)`);
    console.error(`    3. firewall entre a sua máquina e o servidor`);
  } else if (/NOAUTH|WRONGPASS/.test(msg)) {
    console.error(`\n  O Redis exige senha: use redis://:SENHA@host:6379/0 no .env.`);
  }
} finally {
  try {
    await redis.del(chave);
  } catch {
    // se a conexão já caiu, a chave expira sozinha em 30 s
  }
  redis.disconnect();
}
process.exit(saida);
