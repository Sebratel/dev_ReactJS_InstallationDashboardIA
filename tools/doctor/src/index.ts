#!/usr/bin/env node
// `npm run doctor` — valida a configuração e a conectividade com as fontes.
//
// Nunca imprime senhas, URLs completas com credencial ou dados de negócio.
// A saída é segura para colar em chat/ticket.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv, loadConfig, missingFor } from '../../../packages/query-engine/src/config.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);

const OK = '  OK  ';
const FAIL = ' FALHA';
const SKIP = ' PULA ';

let failures = 0;

function line(status: string, label: string, detail = '') {
  console.log(`[${status}] ${label}${detail ? ` — ${detail}` : ''}`);
}

/** Esconde host real, mantendo só o suficiente para diagnosticar. */
function maskHost(host: string): string {
  if (!host) return '(vazio)';
  if (host === 'localhost' || host === '127.0.0.1') return host;
  const parts = host.split('.');
  if (parts.length <= 2) return `${host.slice(0, 2)}***`;
  return `${parts[0].slice(0, 2)}***.${parts.slice(-1)[0]}`;
}

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout após ${ms}ms conectando em ${what}`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// ---------------------------------------------------------------- specs
async function checkSpecs() {
  console.log('\n── Specs / Query Registry ─────────────────────────────');
  try {
    const registry = QueryRegistry.fromSpecsDir(path.join(ROOT, 'specs'));
    line(OK, 'specs carregadas', `${registry.queries.size} queries, ${registry.datasources.size} datasources`);
    const problems = registry.validate();
    if (problems.length) {
      for (const p of problems) line(FAIL, 'validação', p);
      failures += problems.length;
    } else {
      line(OK, 'validação do registry', 'sem problemas');
    }
  } catch (err) {
    failures++;
    line(FAIL, 'specs', (err as Error).message);
  }
}

// ---------------------------------------------------------------- postgres
async function checkVoalle() {
  console.log('\n── dbVoalle (PostgreSQL / ERP Voalle) ─────────────────');
  const missing = missingFor('voalle');
  if (missing.length) {
    line(SKIP, 'configuração', `faltam: ${missing.join(', ')}`);
    return;
  }
  const cfg = loadConfig().voalle;
  line(OK, 'configuração', `${maskHost(cfg.host)}:${cfg.port}/${cfg.database} schema=${cfg.schema} ssl=${cfg.ssl ? 'on' : 'off'}`);

  let pool: { query: (c: { text: string }) => Promise<{ rows: Record<string, unknown>[] }>; end: () => Promise<void> } | null = null;
  try {
    const { createVoallePool } = await import('../../../packages/query-engine/src/connectors-sql.ts');
    pool = await createVoallePool(cfg) as typeof pool;
    const r = await withTimeout(pool!.query({ text: 'select version() as v, current_user as u' }), 15_000, 'dbVoalle');
    const version = String(r.rows[0]?.v ?? '').split(',')[0];
    line(OK, 'conexão', version);
    line(OK, 'usuário', String(r.rows[0]?.u ?? '?'));

    // confirma que a sessão está mesmo somente-leitura
    const ro = await pool!.query({ text: 'show default_transaction_read_only' });
    const isReadOnly = String(Object.values(ro.rows[0] ?? {})[0]) === 'on';
    if (isReadOnly) line(OK, 'sessão somente-leitura', 'default_transaction_read_only=on');
    else {
      failures++;
      line(FAIL, 'sessão somente-leitura', 'esperado on — a plataforma não pode escrever no ERP');
    }

    // tabelas-chave usadas pelas queries extraídas
    const tables = ['assignments', 'assignment_incidents', 'contracts', 'people', 'reports'];
    const q = await pool!.query({
      text: `select table_name from information_schema.tables
             where table_name in (${tables.map((t) => `'${t}'`).join(',')})`,
    });
    const found = new Set(q.rows.map((r) => String(r.table_name)));
    const missingTables = tables.filter((t) => !found.has(t));
    if (missingTables.length === 0) line(OK, 'tabelas-chave', `${tables.length}/${tables.length} encontradas`);
    else {
      failures++;
      line(FAIL, 'tabelas-chave', `não encontradas: ${missingTables.join(', ')}`);
    }
  } catch (err) {
    failures++;
    line(FAIL, 'conexão', (err as Error).message);
  } finally {
    await pool?.end().catch(() => {});
  }
}

// ---------------------------------------------------------------- maria
async function checkMaria() {
  console.log('\n── dbMaria (MariaDB) ──────────────────────────────────');
  const missing = missingFor('maria');
  if (missing.length) {
    line(SKIP, 'configuração', `faltam: ${missing.join(', ')}`);
    return;
  }
  const cfg = loadConfig().maria;
  line(OK, 'configuração', `${maskHost(cfg.host)}:${cfg.port}/${cfg.database}`);

  let pool: { query: (sql: string) => Promise<[Record<string, unknown>[], unknown]>; end: () => Promise<void> } | null = null;
  try {
    const { createMariaPool } = await import('../../../packages/query-engine/src/connectors-sql.ts');
    pool = await createMariaPool(cfg) as typeof pool;
    const [rows] = await withTimeout(pool!.query('select version() as v'), 15_000, 'dbMaria');
    line(OK, 'conexão', String(rows[0]?.v ?? '?'));

    // as 3 tabelas que as queries do registry realmente consultam
    const tables = ['Backlog_Installation', 'Backlog_Schedules', 'Installation_Teams'];
    const [t] = await pool!.query(
      `select table_name from information_schema.tables
       where table_schema = database()
         and table_name in (${tables.map((x) => `'${x}'`).join(',')})`,
    );
    const found = new Set(t.map((r) => String(r.table_name ?? r.TABLE_NAME)));
    const missingTables = tables.filter((x) => !found.has(x));
    if (missingTables.length === 0) line(OK, 'tabelas-chave', `${tables.length}/${tables.length} encontradas`);
    else {
      failures++;
      line(FAIL, 'tabelas-chave', `não encontradas: ${missingTables.join(', ')}`);
    }
  } catch (err) {
    failures++;
    line(FAIL, 'conexão', (err as Error).message);
  } finally {
    await pool?.end().catch(() => {});
  }
}

// ---------------------------------------------------------------- redis
async function checkRedis() {
  console.log('\n── Redis (cache) ──────────────────────────────────────');
  if (missingFor('redis').length) {
    line(SKIP, 'configuração', 'REDIS_URL não definido no .env');
    return;
  }
  const cfg = loadConfig().redis;
  const safeUrl = cfg.url.replace(/\/\/[^@]*@/, '//***@');
  line(OK, 'configuração', `${safeUrl} prefix=${cfg.keyPrefix}`);
  let redis: { ping: () => Promise<string>; info: (s: string) => Promise<string>; quit: () => Promise<unknown> } | null = null;
  try {
    const { default: Redis } = await import('ioredis');
    redis = new Redis(cfg.url, {
      lazyConnect: true,
      connectTimeout: 8000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    }) as unknown as typeof redis;
    // ioredis emite 'error' de forma assíncrona; sem handler vira ruído no console
    (redis as unknown as { on(e: string, f: () => void): void }).on('error', () => {});
    await withTimeout((redis as unknown as { connect(): Promise<void> }).connect(), 10_000, 'Redis');
    const pong = await redis!.ping();
    line(OK, 'PING', pong);
    const info = await redis!.info('server');
    const version = /redis_version:([^\r\n]+)/.exec(info)?.[1] ?? '?';
    line(OK, 'versão', version);
  } catch (err) {
    failures++;
    line(FAIL, 'conexão', (err as Error).message);
  } finally {
    await redis?.quit().catch(() => {});
  }
}

// ---------------------------------------------------------------- kafka
async function checkKafka() {
  console.log('\n── Kafka / Debezium (realtime — Fase 4) ───────────────');
  const missing = missingFor('kafka');
  if (missing.length) {
    line(SKIP, 'configuração', `faltam: ${missing.join(', ')}`);
    return;
  }
  const cfg = loadConfig().kafka;
  line(OK, 'configuração', `${cfg.brokers.length} broker(s), topicPrefix=${cfg.topicPrefix}`);
  line(SKIP, 'conexão', 'cliente Kafka entra na Fase 4');
}

// ---------------------------------------------------------------- main
async function main() {
  console.log('Analytics Platform — doctor');
  console.log('(nenhuma credencial é exibida nesta saída)');
  await checkSpecs();
  await checkVoalle();
  await checkMaria();
  await checkRedis();
  await checkKafka();

  console.log('\n───────────────────────────────────────────────────────');
  if (failures === 0) {
    console.log('Tudo certo. Nenhuma falha.');
  } else {
    console.log(`${failures} falha(s). Veja as linhas [FALHA] acima.`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('doctor falhou:', err);
  process.exit(1);
});
