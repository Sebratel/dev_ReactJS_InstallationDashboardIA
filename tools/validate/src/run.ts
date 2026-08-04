// Execução de uma query real contra a fonte, produzindo um Golden.
//
// A fonte entra como `SqlRunner` injetado (o mesmo tipo usado pelos connectors),
// então este módulo é testável com um runner falso — sem banco, sem .env.

import type { SqlRunner } from '../../../packages/query-engine/src/connectors.ts';
import type { ResolvedQuery } from '../../../packages/query-engine/src/types.ts';
import { buildGolden, type Golden, type Row, wrapCount, wrapSample } from './profile.ts';

export interface RunOptions {
  /** Quantas linhas puxar para perfilar as colunas. */
  sampleRows: number;
  includeValues?: boolean;
  /** Injetado para o golden ser determinístico em teste. */
  now: () => string;
}

export interface RunOutcome {
  queryId: string;
  ok: boolean;
  durationMs: number;
  golden?: Golden;
  error?: string;
  /** Preenchido quando o embrulho em subquery falhou e caímos para 'direct'. */
  fallbackFrom?: string;
}

/** Extrai o count de `select count(*) as _n ...` lidando com bigint-string do pg. */
function readCount(rows: Row[]): number | null {
  const first = rows[0];
  if (!first) return null;
  const raw = first._n ?? Object.values(first)[0];
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Executa uma query e devolve seu perfil.
 *
 * Estratégia preferida ('wrapped'): `count(*)` sobre a query como subquery dá o
 * total EXATO barato — é esse número que se compara com o Power BI — e uma
 * amostra com LIMIT alimenta o perfil de colunas sem arrastar a tabela inteira
 * pela rede.
 *
 * Se o embrulho falhar, cai para 'direct': executa o SQL cru. Aí o rowCount
 * também é exato — porque o resultado inteiro passou pelo processo — mas custa
 * mais rede e memória.
 *
 * O motivo da queda vai em `fallbackFrom` **verbatim**, sem interpretação: a
 * causa comum não é SQL incompatível com subquery, é `statement_timeout` (o
 * count(*) percorre o resultado inteiro e em query pesada isso estoura o
 * limite). Confundir os dois manda quem lê o relatório investigar o SQL errado.
 */
export async function runQuery(
  query: ResolvedQuery,
  run: SqlRunner,
  opts: RunOptions,
): Promise<RunOutcome> {
  const started = Date.now();
  const sql = query.sql;
  if (!sql) {
    return { queryId: query.id, ok: false, durationMs: 0, error: 'query sem SQL' };
  }

  let fallbackFrom: string | undefined;

  try {
    const countRows = await run(wrapCount(sql));
    const rowCount = readCount(countRows);
    const sampleRows = rowCount === 0 ? [] : await run(wrapSample(sql, opts.sampleRows));
    return {
      queryId: query.id,
      ok: true,
      durationMs: Date.now() - started,
      golden: buildGolden({
        queryId: query.id,
        datasource: query.datasource,
        strategy: 'wrapped',
        rowCount,
        truncated: false,
        rows: sampleRows,
        includeValues: opts.includeValues,
        capturedAt: opts.now(),
      }),
    };
  } catch (err) {
    fallbackFrom = (err as Error).message;
  }

  try {
    const rows = await run(sql);
    return {
      queryId: query.id,
      ok: true,
      durationMs: Date.now() - started,
      fallbackFrom,
      golden: buildGolden({
        queryId: query.id,
        datasource: query.datasource,
        strategy: 'direct',
        rowCount: rows.length,
        truncated: false,
        rows: rows.slice(0, opts.sampleRows),
        includeValues: opts.includeValues,
        capturedAt: opts.now(),
      }),
    };
  } catch (err) {
    return {
      queryId: query.id,
      ok: false,
      durationMs: Date.now() - started,
      fallbackFrom,
      error: (err as Error).message,
    };
  }
}
