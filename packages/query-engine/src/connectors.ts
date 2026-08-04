// Connectors — portas de saída para as fontes reais.
//
// Os drivers concretos (pg / mysql2 / Google Sheets) entram quando houver
// credenciais. Até lá o contrato está fechado e testado com o FakeConnector,
// então trocar o driver não muda o Engine.

import type { Connector, ResolvedQuery, Row } from './types.ts';

/** Connector de teste: respostas programadas + contagem de chamadas. */
export class FakeConnector implements Connector {
  readonly id: string;
  /** queryId -> linhas (ou função que gera as linhas) */
  #responses = new Map<string, Row[] | ((q: ResolvedQuery, p?: Record<string, unknown>) => Row[])>();
  #failures = new Map<string, Error>();
  /** quantas vezes cada query foi executada de fato */
  readonly calls: string[] = [];
  /** atraso artificial (ms) para testar concorrência */
  delayMs = 0;

  constructor(id: string) {
    this.id = id;
  }

  on(queryId: string, rows: Row[] | ((q: ResolvedQuery, p?: Record<string, unknown>) => Row[])): this {
    this.#responses.set(queryId, rows);
    return this;
  }

  failOn(queryId: string, error: Error): this {
    this.#failures.set(queryId, error);
    return this;
  }

  callCount(queryId?: string): number {
    return queryId ? this.calls.filter((c) => c === queryId).length : this.calls.length;
  }

  async execute(query: ResolvedQuery, params?: Record<string, unknown>): Promise<Row[]> {
    this.calls.push(query.id);
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    const failure = this.#failures.get(query.id);
    if (failure) throw failure;
    const response = this.#responses.get(query.id);
    if (typeof response === 'function') return response(query, params);
    return response ?? [];
  }
}

/**
 * Connector SQL genérico. Recebe uma função de execução (injetada com o driver
 * real: pg.Pool.query, mysql2 execute, etc.), mantendo o Engine agnóstico.
 */
export type SqlRunner = (sql: string, params?: Record<string, unknown>) => Promise<Row[]>;

export class SqlConnector implements Connector {
  readonly id: string;
  #run: SqlRunner;

  constructor(id: string, run: SqlRunner) {
    this.id = id;
    this.#run = run;
  }

  async execute(query: ResolvedQuery, params?: Record<string, unknown>): Promise<Row[]> {
    if (!query.sql) throw new Error(`Query ${query.id} não tem SQL para o connector ${this.id}`);
    return this.#run(query.sql, params);
  }
}
