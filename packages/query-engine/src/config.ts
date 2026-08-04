// Carrega a configuração do .env. Sem dependência de dotenv: parser próprio.
// Nada aqui loga valores sensíveis — apenas se estão presentes ou ausentes.

import fs from 'node:fs';
import path from 'node:path';

export function loadDotEnv(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // remove aspas envolventes, se houver
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Aplica o .env no process.env sem sobrescrever variáveis já definidas. */
export function applyDotEnv(rootDir: string): void {
  const parsed = loadDotEnv(path.join(rootDir, '.env'));
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const env = (key: string, fallback = ''): string => process.env[key]?.trim() || fallback;
const envInt = (key: string, fallback: number): number => {
  const raw = env(key);
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
};
const envBool = (key: string, fallback = false): boolean => {
  const raw = env(key).toLowerCase();
  if (raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
};

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema: string;
  ssl: false | { rejectUnauthorized: boolean };
  poolMax: number;
  statementTimeoutMs: number;
}

export interface MariaConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  poolMax: number;
  statementTimeoutMs: number;
}

export interface PlatformConfig {
  voalle: PostgresConfig;
  maria: MariaConfig;
  redis: { url: string; keyPrefix: string };
  kafka: {
    brokers: string[];
    clientId: string;
    groupId: string;
    topicPrefix: string;
    ssl: boolean;
    sasl: { mechanism: string; username: string; password: string } | null;
  };
  gsheets: { credentialsPath: string; quadroFuncionalId: string };
}

export function loadConfig(): PlatformConfig {
  return {
    voalle: {
      host: env('VOALLE_HOST'),
      port: envInt('VOALLE_PORT', 5432),
      database: env('VOALLE_DATABASE'),
      user: env('VOALLE_USER'),
      password: env('VOALLE_PASSWORD'),
      schema: env('VOALLE_SCHEMA', 'erp'),
      ssl: envBool('VOALLE_SSL')
        ? { rejectUnauthorized: envBool('VOALLE_SSL_REJECT_UNAUTHORIZED', true) }
        : false,
      poolMax: envInt('VOALLE_POOL_MAX', 10),
      statementTimeoutMs: envInt('VOALLE_STATEMENT_TIMEOUT_MS', 30_000),
    },
    maria: {
      host: env('MARIA_HOST'),
      port: envInt('MARIA_PORT', 3306),
      database: env('MARIA_DATABASE', 'DB_Applicattion'),
      user: env('MARIA_USER'),
      password: env('MARIA_PASSWORD'),
      ssl: envBool('MARIA_SSL'),
      poolMax: envInt('MARIA_POOL_MAX', 5),
      statementTimeoutMs: envInt('MARIA_STATEMENT_TIMEOUT_MS', 30_000),
    },
    redis: {
      url: env('REDIS_URL', 'redis://localhost:6379/0'),
      keyPrefix: env('REDIS_KEY_PREFIX', 'analytics:dev:'),
    },
    kafka: {
      brokers: env('KAFKA_BROKERS').split(',').map((b) => b.trim()).filter(Boolean),
      clientId: env('KAFKA_CLIENT_ID', 'analytics-platform'),
      groupId: env('KAFKA_GROUP_ID', 'analytics-realtime'),
      topicPrefix: env('KAFKA_TOPIC_PREFIX', 'voalle'),
      ssl: envBool('KAFKA_SSL'),
      sasl: env('KAFKA_SASL_MECHANISM')
        ? {
            mechanism: env('KAFKA_SASL_MECHANISM'),
            username: env('KAFKA_SASL_USERNAME'),
            password: env('KAFKA_SASL_PASSWORD'),
          }
        : null,
    },
    gsheets: {
      credentialsPath: env('GOOGLE_APPLICATION_CREDENTIALS'),
      quadroFuncionalId: env('GSHEETS_QUADRO_FUNCIONAL_ID'),
    },
  };
}

/** Quais variáveis obrigatórias estão faltando para uma dada fonte. */
export function missingFor(target: 'voalle' | 'maria' | 'redis' | 'kafka'): string[] {
  const required: Record<string, string[]> = {
    voalle: ['VOALLE_HOST', 'VOALLE_DATABASE', 'VOALLE_USER', 'VOALLE_PASSWORD'],
    maria: ['MARIA_HOST', 'MARIA_DATABASE', 'MARIA_USER', 'MARIA_PASSWORD'],
    redis: ['REDIS_URL'],
    kafka: ['KAFKA_BROKERS'],
  };
  return required[target].filter((k) => !env(k));
}
