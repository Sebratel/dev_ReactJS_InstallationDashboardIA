// Plano de validação: dado o registry e o que está configurado no .env,
// decide quais queries são executáveis agora e por que as outras ficam de fora.
//
// Separado do CLI para ser testável sem banco e sem .env.

import type { ResolvedQuery } from '../../../packages/query-engine/src/types.ts';

/** Datasources que o harness sabe executar hoje. */
export const EXECUTABLE_DATASOURCES = ['dbVoalle', 'dbMaria'] as const;
export type ExecutableDatasource = (typeof EXECUTABLE_DATASOURCES)[number];

export type SkipReason =
  | 'sem-sql'
  | 'datasource-nao-suportado'
  | 'datasource-nao-configurado'
  | 'filtrado';

export interface PlanItem {
  query: ResolvedQuery;
  datasource: ExecutableDatasource;
}

export interface SkippedItem {
  query: ResolvedQuery;
  reason: SkipReason;
  detail: string;
}

export interface ValidationPlan {
  runnable: PlanItem[];
  skipped: SkippedItem[];
}

export interface PlanOptions {
  /** Quais datasources executáveis têm credencial no .env. */
  configured: readonly string[];
  /** Se informado, roda só estes ids (flag --only). */
  only?: readonly string[];
}

function isExecutable(ds: string | null): ds is ExecutableDatasource {
  return ds !== null && (EXECUTABLE_DATASOURCES as readonly string[]).includes(ds);
}

/**
 * `gsheets` e `web` não entram: dependem de credencial de service account e de
 * API externa, e serão validados quando os connectors deles existirem.
 * `inline` e `computed` não têm fonte para consultar — são dados do próprio .pbix.
 */
export function planValidation(queries: ResolvedQuery[], opts: PlanOptions): ValidationPlan {
  const runnable: PlanItem[] = [];
  const skipped: SkippedItem[] = [];
  const only = opts.only?.length ? new Set(opts.only) : null;

  for (const query of [...queries].sort((a, b) => a.id.localeCompare(b.id))) {
    if (only && !only.has(query.id)) {
      skipped.push({ query, reason: 'filtrado', detail: 'fora do --only' });
      continue;
    }
    if (!isExecutable(query.datasource)) {
      skipped.push({
        query,
        reason: 'datasource-nao-suportado',
        detail: `${query.datasource ?? 'sem datasource'} (${query.source_type})`,
      });
      continue;
    }
    if (!query.sql) {
      skipped.push({ query, reason: 'sem-sql', detail: `source_type=${query.source_type}` });
      continue;
    }
    if (!opts.configured.includes(query.datasource)) {
      skipped.push({
        query,
        reason: 'datasource-nao-configurado',
        detail: `${query.datasource} sem credencial no .env`,
      });
      continue;
    }
    runnable.push({ query, datasource: query.datasource });
  }

  return { runnable, skipped };
}

/** Agrupa os pulados por motivo, para o relatório final. */
export function groupSkipped(skipped: SkippedItem[]): Map<SkipReason, SkippedItem[]> {
  const out = new Map<SkipReason, SkippedItem[]>();
  for (const item of skipped) {
    if (!out.has(item.reason)) out.set(item.reason, []);
    out.get(item.reason)!.push(item);
  }
  return out;
}
