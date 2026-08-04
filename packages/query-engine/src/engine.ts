// Query Engine — executa queries do Registry com cache e invalidação.
//
// Fluxo: cacheKey -> cache hit? -> devolve
//                 -> miss: single-flight -> connector -> grava cache -> devolve
//
// Single-flight: N pedidos simultâneos da mesma query disparam UMA execução.
// Sem isso, um dashboard com 20 widgets sobre a mesma query dá 20 hits no banco
// toda vez que o cache expira (thundering herd).

import { createHash } from 'node:crypto';
import type { QueryRegistry } from './registry.ts';
import type { Cache, Clock, Connector, QueryResult, ResolvedQuery, Row } from './types.ts';
import { systemClock } from './types.ts';

export const CACHE_PREFIX = 'q:';

/** Chave estável: prefixo + id + hash dos parâmetros. */
export function cacheKeyFor(queryId: string, params?: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) return `${CACHE_PREFIX}${queryId}`;
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))),
  );
  const hash = createHash('sha1').update(canonical).digest('hex').slice(0, 12);
  return `${CACHE_PREFIX}${queryId}:${hash}`;
}

export interface QueryEngineOptions {
  registry: QueryRegistry;
  /** Map datasource-id -> Connector. */
  connectors: Map<string, Connector>;
  cache: Cache;
  clock?: Clock;
  /** Chamado a cada execução — ponto de gancho do Observability Engine. */
  onEvent?: (event: EngineEvent) => void;
}

export type EngineEvent =
  | { type: 'cache_hit'; queryId: string; key: string }
  | { type: 'cache_miss'; queryId: string; key: string }
  | { type: 'executed'; queryId: string; key: string; durationMs: number; rowCount: number }
  | { type: 'error'; queryId: string; key: string; message: string }
  | { type: 'invalidated'; table: string; queryIds: string[]; keysRemoved: number };

export interface ExecuteOptions {
  params?: Record<string, unknown>;
  /** Ignora o cache de leitura e reexecuta (a gravação continua). */
  forceRefresh?: boolean;
}

export class QueryEngine {
  #registry: QueryRegistry;
  #connectors: Map<string, Connector>;
  #cache: Cache;
  #clock: Clock;
  #onEvent: (e: EngineEvent) => void;
  /** execuções em voo, por cacheKey (single-flight) */
  #inFlight = new Map<string, Promise<{ rows: Row[]; durationMs: number }>>();

  constructor(opts: QueryEngineOptions) {
    this.#registry = opts.registry;
    this.#connectors = opts.connectors;
    this.#cache = opts.cache;
    this.#clock = opts.clock ?? systemClock;
    this.#onEvent = opts.onEvent ?? (() => {});
  }

  async execute(queryId: string, options: ExecuteOptions = {}): Promise<QueryResult> {
    const query = this.#registry.get(queryId);
    const key = cacheKeyFor(queryId, options.params);

    if (!options.forceRefresh && query.cache.ttl > 0) {
      const cached = await this.#cache.get<Row[]>(key);
      if (cached !== undefined) {
        this.#onEvent({ type: 'cache_hit', queryId, key });
        return this.#result(query, cached, key, true, 0);
      }
    }
    this.#onEvent({ type: 'cache_miss', queryId, key });

    const { rows, durationMs } = await this.#runSingleFlight(query, key, options.params);
    return this.#result(query, rows, key, false, durationMs);
  }

  async #runSingleFlight(
    query: ResolvedQuery,
    key: string,
    params?: Record<string, unknown>,
  ): Promise<{ rows: Row[]; durationMs: number }> {
    const existing = this.#inFlight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      const started = this.#clock.now();
      try {
        const connector = this.#connectorFor(query);
        const rows = await connector.execute(query, params);
        const durationMs = this.#clock.now() - started;
        if (query.cache.ttl > 0) await this.#cache.set(key, rows, query.cache.ttl);
        this.#onEvent({
          type: 'executed',
          queryId: query.id,
          key,
          durationMs,
          rowCount: rows.length,
        });
        return { rows, durationMs };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.#onEvent({ type: 'error', queryId: query.id, key, message });
        throw err;
      } finally {
        this.#inFlight.delete(key);
      }
    })();

    this.#inFlight.set(key, promise);
    return promise;
  }

  #connectorFor(query: ResolvedQuery): Connector {
    if (!query.datasource) {
      throw new Error(`Query ${query.id} não declara datasource`);
    }
    const connector = this.#connectors.get(query.datasource);
    if (!connector) {
      throw new Error(
        `Sem connector para datasource "${query.datasource}" (query ${query.id})`,
      );
    }
    return connector;
  }

  #result(
    query: ResolvedQuery,
    rows: Row[],
    cacheKey: string,
    cached: boolean,
    durationMs: number,
  ): QueryResult {
    return {
      rows,
      meta: {
        queryId: query.id,
        datasource: query.datasource,
        cached,
        durationMs,
        rowCount: rows.length,
        cacheKey,
      },
    };
  }

  /**
   * Invalida o cache das queries que dependem de uma tabela-fonte.
   * Chamado pelo Realtime Engine ao receber um evento CDC do Debezium.
   * Retorna os ids de query afetados.
   */
  async invalidateByTable(table: string): Promise<string[]> {
    const queryIds = this.#registry
      .queriesForTable(table)
      .filter((id) => this.#registry.get(id).cache.realtime);

    let keysRemoved = 0;
    for (const id of queryIds) {
      // remove a chave base e todas as variantes por parâmetro
      const keys = await this.#cache.keys(`${CACHE_PREFIX}${id}`);
      const exact = keys.filter((k) => k === `${CACHE_PREFIX}${id}` || k.startsWith(`${CACHE_PREFIX}${id}:`));
      keysRemoved += await this.#cache.delMany(exact);
    }
    this.#onEvent({ type: 'invalidated', table, queryIds, keysRemoved });
    return queryIds;
  }

  /** Invalida uma query específica (todas as variantes de parâmetro). */
  async invalidateQuery(queryId: string): Promise<number> {
    const keys = await this.#cache.keys(`${CACHE_PREFIX}${queryId}`);
    const exact = keys.filter(
      (k) => k === `${CACHE_PREFIX}${queryId}` || k.startsWith(`${CACHE_PREFIX}${queryId}:`),
    );
    return this.#cache.delMany(exact);
  }
}
