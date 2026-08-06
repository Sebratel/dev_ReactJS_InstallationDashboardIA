// Connectors reais (Postgres/Voalle e MariaDB), montados sobre SqlConnector.
//
// READ-ONLY POR CONSTRUÇÃO: além de exigir usuário só-leitura, cada sessão é
// forçada em modo somente-leitura e todo SQL passa por assertReadOnly().
// A plataforma nunca deve escrever no ERP.

import { SqlConnector, type SqlRunner } from './connectors.ts';
import type { MariaConfig, PostgresConfig } from './config.ts';
import type { Row } from './types.ts';

/** Comandos proibidos: a plataforma só lê. */
const FORBIDDEN = /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|merge|call|do|copy)\b/i;

/** Remove comentários e strings antes de checar palavras proibidas. */
function stripNoise(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

export function assertReadOnly(sql: string): void {
  const cleaned = stripNoise(sql);
  const match = cleaned.match(FORBIDDEN);
  if (match) {
    throw new Error(
      `SQL bloqueado: a plataforma é somente-leitura e o comando "${match[1].toUpperCase()}" não é permitido.`,
    );
  }
  if (cleaned.includes(';') && cleaned.trim().replace(/;\s*$/, '').includes(';')) {
    throw new Error('SQL bloqueado: múltiplos statements não são permitidos.');
  }
}

// --------------------------------------------------------------------------
// PostgreSQL (dbVoalle)
// --------------------------------------------------------------------------

export interface PgPoolLike {
  query(config: {
    text: string;
    values?: unknown[];
    rowMode?: 'array';
  }): Promise<{ rows: Row[] | unknown[][]; fields?: readonly { name: string }[] }>;
  end(): Promise<void>;
}

/**
 * Nomes de coluna no esquema do Power Query: a 1ª ocorrência de um nome fica
 * como está; a 2ª em diante ganha o número da ocorrência colado no nome
 * (`categoria3`, `categoria32`, `categoria33`...).
 *
 * Existe porque `ai.protocol, ssc4.title categoria3` com `categoria3` repetido
 * no SELECT chega ao driver `pg` como duas colunas, mas `result.rows` no modo
 * padrão (objeto) já as devolve coladas — a segunda sobrescreve a primeira, e
 * o dado da primeira nunca chega ao processo. Isso não é bug do `pg`; é o
 * mesmo motivo por que `Table.RenameColumns(..., {{"categoria32", "categoria4"}})`
 * existe na spec — é o M do próprio Power BI resolvendo a mesma colisão do
 * jeito que o `ODBC.Query` resolve. Sem reproduzir esse esquema aqui, o passo
 * M não encontra `categoria32` e a query quebra por um motivo que não é dela
 * (ACHADOS.md #19).
 */
export function nomesSemDuplicata(nomes: readonly string[]): string[] {
  const vistas = new Map<string, number>();
  return nomes.map((nome) => {
    const ocorrencia = (vistas.get(nome) ?? 0) + 1;
    vistas.set(nome, ocorrencia);
    return ocorrencia === 1 ? nome : `${nome}${ocorrencia}`;
  });
}

export async function createVoallePool(cfg: PostgresConfig): Promise<PgPoolLike> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl,
    max: cfg.poolMax,
    statement_timeout: cfg.statementTimeoutMs,
    application_name: 'analytics-platform',
    // segunda barreira: a sessão inteira é somente-leitura
    options: `-c default_transaction_read_only=on -c search_path=${cfg.schema},public`,
  });
  return pool as unknown as PgPoolLike;
}

export function postgresRunner(pool: PgPoolLike): SqlRunner {
  return async (sql) => {
    assertReadOnly(sql);
    // `rowMode: 'array'` é o que preserva coluna duplicada: no modo padrão (objeto)
    // o driver já colou as colunas de mesmo nome antes de `result.rows` existir, e
    // não há como desfazer isso depois. `result.fields` é a lista ordenada de
    // colunas do SELECT — inclusive as repetidas — como o Postgres devolveu.
    const result = await pool.query({ text: sql, rowMode: 'array' });
    const nomes = nomesSemDuplicata((result.fields ?? []).map((f) => f.name));
    return (result.rows as unknown[][]).map((valores) => {
      const linha: Row = {};
      nomes.forEach((nome, i) => {
        linha[nome] = valores[i];
      });
      return linha;
    });
  };
}

export function createVoalleConnector(pool: PgPoolLike, id = 'dbVoalle'): SqlConnector {
  return new SqlConnector(id, postgresRunner(pool));
}

// --------------------------------------------------------------------------
// MariaDB (dbMaria)
// --------------------------------------------------------------------------

export interface MysqlPoolLike {
  query(sql: string): Promise<[Row[], unknown]>;
  end(): Promise<void>;
}

export async function createMariaPool(cfg: MariaConfig): Promise<MysqlPoolLike> {
  const mysql = await import('mysql2/promise');
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? {} : undefined,
    connectionLimit: cfg.poolMax,
    waitForConnections: true,
    // mysql2 não tem statement_timeout global; aplicado por query abaixo
  });
  return pool as unknown as MysqlPoolLike;
}

export function mariaRunner(pool: MysqlPoolLike): SqlRunner {
  return async (sql) => {
    assertReadOnly(sql);
    const [rows] = await pool.query(sql);
    return rows;
  };
}

export function createMariaConnector(pool: MysqlPoolLike, id = 'dbMaria'): SqlConnector {
  return new SqlConnector(id, mariaRunner(pool));
}
