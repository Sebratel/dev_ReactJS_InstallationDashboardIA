// Contratos do Query Engine. Espelham as specs geradas em specs/_catalog/.

/** Uma consulta do Query Registry, como extraída do Power BI. */
export interface QuerySpec {
  id: string;
  name: string;
  /** 'expression' ou 'table:NOME' — de onde veio no PBIP. */
  origin: string;
  source_type: 'odbc' | 'googlesheets' | 'sql.database' | 'unknown' | string;
  datasource: string | null;
  sql: string | null;
  url: string | null;
  /** Tabelas-fonte do SQL. Alimenta o Query Invalidator do realtime. */
  source_tables: string[];
  /** Expressão M original (referência; não é executada). */
  m_expression?: string;
}

/** Política de cache/realtime por query. Mantida por humanos, fora dos specs gerados. */
export interface CachePolicy {
  /** Segundos de vida no cache. 0 = não cachear. */
  ttl: number;
  /** Se true, a query é invalidada por eventos CDC das suas source_tables. */
  realtime: boolean;
}

export interface ResolvedQuery extends QuerySpec {
  cache: CachePolicy;
}

export interface DatasourceSpec {
  id: string;
  type: string;
  connection: string | null;
}

/** Linha de resultado genérica. */
export type Row = Record<string, unknown>;

export interface QueryResult {
  rows: Row[];
  meta: {
    queryId: string;
    datasource: string | null;
    /** true se veio do cache. */
    cached: boolean;
    /** ms gastos na execução (0 quando cached). */
    durationMs: number;
    rowCount: number;
    /** chave usada no cache. */
    cacheKey: string;
  };
}

/** Porta de saída: executa uma query contra uma fonte concreta. */
export interface Connector {
  readonly id: string;
  execute(query: ResolvedQuery, params?: Record<string, unknown>): Promise<Row[]>;
}

/** Porta de saída: cache (Redis em produção, memória em teste). */
export interface Cache {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Remove várias chaves; retorna quantas existiam. */
  delMany(keys: string[]): Promise<number>;
  /** Lista chaves por prefixo (usado pela invalidação). */
  keys(prefix: string): Promise<string[]>;
}

/** Relógio injetável — permite testar expiração sem esperar. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
