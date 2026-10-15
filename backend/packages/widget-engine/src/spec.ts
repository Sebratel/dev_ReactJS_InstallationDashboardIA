// A spec de dashboard, como o extrator a escreve.
//
// Estes tipos descrevem `backend/specs/dashboards/*.spec.yaml` — arquivo GERADO. Nenhuma
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
  /**
   * Nível da hierarquia de datas que este filtro recorta (`Ano`, `Mês`, `Dia`…).
   *
   * **O extrator nunca escreve isto, e a afirmação é medida:** dos **108** filtros do
   * relatório — de página e de visual —, **0** carregam nível. Filtro por nível só
   * nasce da segmentação da tela (`filtro-url.ts`), onde o usuário escolhe "2026" num
   * `slicer` de `[DATA CRIADO].[Ano]`.
   *
   * Com ele presente, o predicado compara a **projeção** da coluna, não a coluna:
   * `YEAR(data) IN [2026]` em vez de `data IN [2026]`. Sem ele a segmentação de ano
   * não erra em silêncio — `confereEspecie` recusa comparar número com data e
   * **erra alto** —, ela simplesmente não tem como funcionar. Ver `leitorDeValor`
   * em `filtro.ts`.
   */
  nivel?: string | null;
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
  /** O título que o visual tem no relatório (`VISÃO PRODUTIVA`). Ausente quando o
   *  Power BI não dá nome — a tela então deriva um dos campos (`rotulos.ts`). */
  title?: string;
  position: { x: number; y: number; width: number; height: number };
  entities_used: string[];
  fields: CampoSpec[];
  filters: FiltroSpec[];
  filters_vazios: number;
  /**
   * `nativo` = visual que NÃO existe no Power BI: nasceu em
   * `backend/specs/visuais-novos/<pagina>.yaml`, escrito à mão. Ausente = veio do PBIP.
   * Paridade não se aplica a ele (não há número no Power BI para comparar).
   */
  origem?: 'nativo';
  /** Só nos nativos: por que o visual existe — a pergunta de negócio que ele responde. */
  porque?: string;
  /**
   * Só em `tableEx` nativo: a ordem inicial das linhas, pelo `name` de um campo. Sem ela
   * a tabela sai na ordem de chegada do snapshot (ver `ordenaPorDataPadrao`).
   */
  ordem?: { campo: string; desc: boolean };
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

/**
 * As páginas como o Power BI as tem — sem os visuais nativos. É o que os testes de
 * inventário contam ("o relatório tem 306 visuais"): eles descrevem o original.
 */
export function soDoPbip(paginas: DashboardSpec[]): DashboardSpec[] {
  return paginas.map((p) => ({ ...p, visuals: p.visuals.filter((v) => v.origem !== 'nativo') }));
}

/** O arquivo de visuais nativos de uma página — escrito à mão, nunca pelo extrator. */
interface VisuaisNovosFile {
  pagina: string;
  visuals: VisualSpec[];
}

/**
 * Lê `backend/specs/dashboards/*.spec.yaml` e soma a cada página os visuais nativos de
 * `backend/specs/visuais-novos/<pagina>.yaml`. Ordem alfabética, para saída determinística.
 *
 * **Por que um arquivo à parte, e não editar a spec gerada.** A spec do dashboard é o
 * registro do original (docs/PLANO-LAYOUT-V1.md §1): reextrair por cima apagaria a
 * edição. Os nativos são visuais que o Power BI não tem — perguntas que o relatório
 * original não respondia (decisão do Erick, 15/10/2026, para `relatorio-do-ano`). Eles
 * entram na mesma lista para que API, aquecedor, snapshot e testes vejam a mesma
 * página; `origem: 'nativo'` é o que os separa onde a diferença importa (paridade).
 *
 * Arquivo de visual nativo para página que não existe, id repetido ou visual sem
 * `porque` erra alto: um visual novo sem motivo escrito é o que este plano proíbe.
 */
export function loadDashboards(specsDir: string): DashboardSpec[] {
  const dir = path.join(specsDir, 'dashboards');
  const paginas = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.spec.yaml'))
    .sort()
    .map((f) => parseYaml(fs.readFileSync(path.join(dir, f), 'utf8')) as DashboardSpec);

  const dirNovos = path.join(specsDir, 'visuais-novos');
  if (!fs.existsSync(dirNovos)) return paginas;
  for (const f of fs.readdirSync(dirNovos).filter((x) => x.endsWith('.yaml')).sort()) {
    const arq = parseYaml(fs.readFileSync(path.join(dirNovos, f), 'utf8')) as VisuaisNovosFile;
    const pagina = paginas.find((p) => p.id === arq.pagina);
    if (!pagina) {
      throw new Error(`visuais-novos/${f}: página '${arq.pagina}' não existe em specs/dashboards.`);
    }
    const ids = new Set(pagina.visuals.map((v) => v.id));
    for (const v of arq.visuals ?? []) {
      if (ids.has(v.id)) throw new Error(`visuais-novos/${f}: id '${v.id}' repetido na página.`);
      if (!v.porque) throw new Error(`visuais-novos/${f}: visual '${v.id}' sem 'porque'.`);
      ids.add(v.id);
      // O YAML à mão não traz o que só faz sentido no PBIP (posição na tela fixa).
      pagina.visuals.push({
        ...v,
        position: v.position ?? { x: 0, y: 0, width: 0, height: 0 },
        entities_used: v.entities_used ?? [],
        filters: v.filters ?? [],
        filters_vazios: v.filters_vazios ?? 0,
        origem: 'nativo',
      });
    }
  }
  return paginas;
}
