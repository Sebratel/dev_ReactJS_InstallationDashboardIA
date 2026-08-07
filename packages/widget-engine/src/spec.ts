// A spec de dashboard, como o extrator a escreve.
//
// Estes tipos descrevem `specs/dashboards/*.spec.yaml` — arquivo GERADO. Nenhuma
// decisão humana mora aqui: se um campo novo aparecer, ele aparece porque alguém
// mexeu no Power BI, e o lugar de tratá-lo é o extrator.
//
// Tudo é opcional/`unknown` nas pontas de propósito. A spec vem de YAML, e um tipo
// que *afirma* que `aggregation` existe faria o TypeScript calar exatamente o caso
// em que ela não veio — que é o caso que precisa falhar alto.

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

/** Literal de filtro. Data chega como texto ISO (ver `parseLiteral` do extrator). */
export type ValorLiteral = string | number | boolean | null;

/** `DateSpan{Expression, TimeUnit}`: uma data truncada numa unidade de tempo. */
export interface SpanSpec {
  /** `agora` = `Now()`. `literal` = data fixa — a distinção existe porque ela era presumida. */
  anchor_kind: 'agora' | 'literal' | 'desconhecido';
  anchor: string | null;
  time_unit: string | null;
  time_unit_code: number | null;
  raw?: unknown;
}

/** Borda de `Between`: âncora, deslocamentos encadeados e o truncamento por fora. */
export interface BordaSpec {
  anchor_kind: 'agora' | 'literal' | 'desconhecido';
  anchor?: string | null;
  truncate?: string | null;
  truncate_code?: number | null;
  /** Do mais externo para o mais interno, como no JSON do PBIP. */
  offsets: { amount: number | null; time_unit: string | null; time_unit_code: number | null }[];
  raw?: unknown;
}

export type CondicaoSpec =
  | { op: 'in'; values: ValorLiteral[] }
  | { op: 'not_in'; values: ValorLiteral[] }
  | {
      op: 'comparison';
      kind: string;
      left_property: string | null;
      left_aggregation: string | null;
      right: ValorLiteral | SpanSpec | { raw: unknown };
      negado?: boolean;
    }
  | { op: 'between_relativo'; property: string | null; lower: BordaSpec; upper: BordaSpec }
  | { op: 'desconhecido'; raw: unknown };

export interface FiltroSpec {
  name: string | null;
  type: string | null;
  entity: string | null;
  property: string | null;
  conditions: CondicaoSpec[];
}

export interface CampoSpec {
  role: string;
  kind: string;
  entity: string | null;
  property: string | null;
  name: string | null;
  /**
   * A projeção está **em jogo** no visual?
   *
   * Um eixo com a hierarquia de datas lista Ano, Mês e Dia; só as ativas entram no
   * agrupamento. `null` é distinto de `true`: significa que o PBIP não declarou
   * estado nenhum (poço de um campo só), e não que o estado seja "ativo". Ver
   * ACHADOS.md #32.
   */
  active?: boolean | null;
  /** Só em `kind: aggregation`. Nome apurado do `Function` do PBIP. */
  aggregation?: string | null;
  aggregation_code?: number | null;
  hierarchy?: string | null;
  level?: string | null;
  operator?: string;
  left?: CampoSpec;
  right?: CampoSpec;
  expression?: CampoSpec;
  scope?: unknown[];
  raw?: unknown;
}

export interface VisualSpec {
  id: string;
  type: string;
  position: { x: number; y: number; width: number; height: number };
  entities_used: string[];
  fields: CampoSpec[];
  filters: FiltroSpec[];
  filters_vazios: number;
}

export interface DashboardSpec {
  spec: string;
  id: string;
  page_id: string;
  name: string;
  type: string;
  visibility: string | null;
  size: { width: number; height: number };
  visual_count: number;
  filters: FiltroSpec[];
  filters_vazios: number;
  visuals: VisualSpec[];
}

/** Lê `specs/dashboards/*.spec.yaml`. Ordem alfabética, para saída determinística. */
export function loadDashboards(specsDir: string): DashboardSpec[] {
  const dir = path.join(specsDir, 'dashboards');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.spec.yaml'))
    .sort()
    .map((f) => parseYaml(fs.readFileSync(path.join(dir, f), 'utf8')) as DashboardSpec);
}
