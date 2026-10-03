// Query Registry — única fonte de consultas da plataforma.
// Carrega as specs GERADAS (backend/specs/_catalog/queries) e aplica as políticas de
// cache MANTIDAS POR HUMANOS (backend/specs/_catalog/cache-policies.yaml).
//
// Separação importante: specs geradas são sobrescritas por `npm run extract`,
// então nenhuma decisão humana pode viver dentro delas.

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CachePolicy, DatasourceSpec, QuerySpec, ResolvedQuery } from './types.ts';

export interface CachePoliciesFile {
  default?: Partial<CachePolicy>;
  queries?: Record<string, Partial<CachePolicy>>;
}

export const DEFAULT_POLICY: CachePolicy = { ttl: 300, realtime: true };

function readYaml<T>(file: string): T {
  return parseYaml(fs.readFileSync(file, 'utf8')) as T;
}

export class QueryRegistry {
  readonly queries = new Map<string, ResolvedQuery>();
  readonly datasources = new Map<string, DatasourceSpec>();
  /** tabela-fonte (lowercase) -> ids de queries que dependem dela */
  readonly dependents = new Map<string, Set<string>>();

  static fromSpecsDir(specsDir: string): QueryRegistry {
    const registry = new QueryRegistry();

    const dsFile = path.join(specsDir, '_catalog', 'datasources.yaml');
    if (fs.existsSync(dsFile)) {
      const doc = readYaml<{ datasources: DatasourceSpec[] }>(dsFile);
      for (const ds of doc.datasources ?? []) registry.datasources.set(ds.id, ds);
    }

    let policies: CachePoliciesFile = {};
    const polFile = path.join(specsDir, '_catalog', 'cache-policies.yaml');
    if (fs.existsSync(polFile)) policies = readYaml<CachePoliciesFile>(polFile) ?? {};
    const defaults: CachePolicy = { ...DEFAULT_POLICY, ...(policies.default ?? {}) };

    const qDir = path.join(specsDir, '_catalog', 'queries');
    if (fs.existsSync(qDir)) {
      for (const f of fs.readdirSync(qDir).filter((x) => x.endsWith('.spec.yaml'))) {
        const spec = readYaml<QuerySpec>(path.join(qDir, f));
        registry.add(spec, { ...defaults, ...(policies.queries?.[spec.id] ?? {}) });
      }
    }
    return registry;
  }

  add(spec: QuerySpec, policy: CachePolicy = DEFAULT_POLICY): void {
    if (this.queries.has(spec.id)) {
      throw new Error(`Query duplicada no registry: ${spec.id}`);
    }
    const resolved: ResolvedQuery = { ...spec, cache: policy };
    this.queries.set(spec.id, resolved);
    for (const table of spec.source_tables ?? []) {
      const key = table.toLowerCase();
      if (!this.dependents.has(key)) this.dependents.set(key, new Set());
      this.dependents.get(key)!.add(spec.id);
    }
  }

  get(id: string): ResolvedQuery {
    const q = this.queries.get(id);
    if (!q) throw new Error(`Query não registrada: ${id}`);
    return q;
  }

  has(id: string): boolean {
    return this.queries.has(id);
  }

  list(): ResolvedQuery[] {
    return [...this.queries.values()];
  }

  /** Queries afetadas por uma mudança na tabela-fonte (usado pelo realtime). */
  queriesForTable(table: string): string[] {
    return [...(this.dependents.get(table.toLowerCase()) ?? [])].sort();
  }

  /** Valida integridade do registry. Retorna lista de problemas (vazia = ok). */
  validate(): string[] {
    const problems: string[] = [];
    for (const q of this.queries.values()) {
      // 'inline' (dados embutidos no PBIX) e 'computed' (timestamp de refresh)
      // não têm SQL nem URL por natureza.
      const needsSource = !['inline', 'computed'].includes(q.source_type);
      if (needsSource && !q.sql && !q.url) {
        problems.push(`${q.id}: sem SQL nem URL (source_type=${q.source_type})`);
      }
      if (q.datasource && !this.datasources.has(q.datasource)) {
        problems.push(`${q.id}: datasource desconhecido "${q.datasource}"`);
      }
      if (needsSource && q.sql && q.source_tables.length === 0) {
        problems.push(`${q.id}: SQL sem source_tables (invalidação realtime não funcionará)`);
      }
      if (q.cache.ttl < 0) problems.push(`${q.id}: ttl negativo`);
    }
    return problems;
  }
}
