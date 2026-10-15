// SemanticModel — carrega o catálogo de specs (tabelas, medidas,
// relacionamentos) num modelo consultável. É a base da Fase 2: o avaliador de
// DAX precisa resolver 'Tabela'[Coluna] e [Medida] antes de calcular qualquer
// coisa.
//
// Resolução de nomes é CASE-INSENSITIVE, e isso não é conveniência: o modelo
// real tem a mesma tabela escrita 'FIELD AGENDA' e 'Field Agenda', e a mesma
// coluna como [Protocolo] e [protocolo], dentro de medidas diferentes. DAX
// resolve as duas; um Map case-sensitive reportaria referência inexistente.

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { aplicaDivergencias, leDivergencias, type Aplicada } from './divergencias.ts';
import { leGraoReduzido, leSobDemanda, type GraoReduzido, type SobDemanda } from './projecao.ts';
import { leCortesPorPagina, type CorteDePagina } from './corte-por-pagina.ts';
import type { ModelColumn, ModelMeasure, ModelRelationship, ModelTable } from './types.ts';

interface TableSpecFile {
  spec: 'table';
  id: string;
  name: string;
  query_ref: string | null;
  table_dax?: string | null;
  columns: {
    name: string;
    type: string | null;
    format: string | null;
    source_column: string | null;
    calculated: boolean;
    dax: string | null;
  }[];
}

interface MeasuresSpecFile {
  spec: 'measures';
  id: string;
  table: string;
  /** `nativo` = arquivo escrito à mão (ver `relatorio-do-ano.measures.yaml`), fora do PBIP. */
  origem?: 'nativo';
  measures: {
    name: string;
    format: string | null;
    display_folder: string | null;
    dax: string;
  }[];
}

interface RelationshipsSpecFile {
  spec: 'relationships';
  auto_date_relationships_ignored?: number;
  relationships: {
    id: string;
    from_table: string;
    from_column: string;
    to_table: string;
    to_column: string;
    from_cardinality: string;
    to_cardinality: string;
    active: boolean;
    cross_filter: string;
    join_on_date_behavior: string | null;
  }[];
}

/**
 * Chave de comparação de identificador DAX — memoizada.
 *
 * **Por que um cache numa função de duas operações.** Medido em 13/09/2026 com
 * `--cpu-prof` sobre `instalacao-reincidente`, a página mais cara da plataforma:
 * esta função era **42,9% de todo o tempo de CPU** (9.464 ms de 22.064 ms). Não
 * porque seja lenta — porque `columnValue` a chama **três vezes por célula lida**
 * (uma direta, duas dentro de `hasPhysicalColumn`), e `trim()` e `toLowerCase()`
 * varrem e alocam uma string nova a cada chamada. Numa tabela de detalhe de 19
 * colunas sobre ~94 mil linhas isso são dezenas de milhões de strings temporárias.
 *
 * **Por que memoizar é correto aqui, e não um risco de vazamento.** Todo argumento
 * desta função é um IDENTIFICADOR — nome de tabela, de coluna, de medida ou de
 * variável DAX —, nunca um valor de linha. Foram conferidos os ~60 sítios de
 * chamada em 13/09/2026: o domínio é o do catálogo em `backend/specs/` mais os nomes que
 * aparecem no DAX, que é da ordem de centenas de strings e não cresce com o dado.
 *
 * **O teto existe mesmo assim.** Um cache sem teto é um vazamento que não dá
 * sintoma até a máquina parar, e a premissa acima é sobre quem chama HOJE. Passando
 * do teto a função continua **correta** — só deixa de cachear, e volta a ser a
 * versão de antes. O teto é folgado de propósito: 4.096 é dez vezes o que o modelo
 * inteiro usa, então atingi-lo já é sinal de que alguém está passando dado aqui.
 *
 * O acerto custa um `Map.get`; o V8 guarda o hash na própria string depois da
 * primeira vez, e as strings que chegam aqui são as mesmas instâncias vindas do
 * catálogo, então o acerto é mais barato que as duas varreduras que ele evita.
 */
const NOMES_NORMALIZADOS = new Map<string, string>();
const TETO_DE_NOMES = 4096;

export function normalizeName(name: string): string {
  const memo = NOMES_NORMALIZADOS.get(name);
  if (memo !== undefined) return memo;
  const out = name.trim().toLowerCase();
  if (NOMES_NORMALIZADOS.size < TETO_DE_NOMES) NOMES_NORMALIZADOS.set(name, out);
  return out;
}

function readYaml<T>(file: string): T {
  return parseYaml(fs.readFileSync(file, 'utf8')) as T;
}

export class SemanticModel {
  readonly tables = new Map<string, ModelTable>();
  readonly relationships: ModelRelationship[] = [];
  /**
   * As divergências deliberadas em relação ao Power BI que foram aplicadas.
   *
   * Vazio em modelo montado à mão (teste). Existe para ser **relatado**: a regra 9
   * permite divergir e proíbe divergir em silêncio, e é esta lista que o harness de
   * paridade usa para separar "número diferente porque decidimos" de "número
   * diferente porque erramos".
   */
  divergencias: Aplicada[] = [];
  /**
   * Colunas que a página usa e que ficam **fora da carga por decisão**.
   *
   * Vazio em modelo montado à mão. Mora no modelo, e não numa opção de `carrega`,
   * porque a alternativa era cada chamador lembrar de ler o arquivo — e o chamador que
   * esquecesse traria 350 MB de volta à memória sem ninguém notar.
   */
  sobDemanda: SobDemanda[] = [];
  /**
   * Tabelas cujo GRÃO (linha, não coluna) é reduzido por padrão.
   *
   * Vazio em modelo montado à mão. Ver `GraoReduzido` — o exemplo vivo é
   * `FIELD AGENDA` (ACHADOS #82/#85/#86): a query padrão não tem os `JOIN`s que
   * multiplicam relato/skill, e só escala para a completa quando o pedido precisa.
   */
  graoReduzido: GraoReduzido[] = [];
  /**
   * Linhas recortadas POR PÁGINA (`corte-por-pagina.ts`). Vazio em modelo montado à
   * mão. Mora aqui pelo mesmo motivo de `sobDemanda`: quem monta a página não escolhe.
   */
  cortes: CorteDePagina[] = [];
  /** Quantos relacionamentos de hierarquia automática de datas foram ignorados. */
  autoDateRelationshipsIgnored = 0;

  /** nome normalizado -> tabela */
  private readonly tableIndex = new Map<string, ModelTable>();
  /** "tabela\u0000coluna" normalizado -> coluna */
  private readonly columnIndex = new Map<string, ModelColumn>();
  /** nome normalizado -> medida */
  private readonly measureIndex = new Map<string, ModelMeasure>();

  static fromSpecsDir(specsDir: string): SemanticModel {
    const model = new SemanticModel();
    const catalog = path.join(specsDir, '_catalog');

    const tDir = path.join(catalog, 'tables');
    if (fs.existsSync(tDir)) {
      for (const f of fs.readdirSync(tDir).filter((x) => x.endsWith('.spec.yaml'))) {
        const spec = readYaml<TableSpecFile>(path.join(tDir, f));
        model.addTable({
          id: spec.id,
          name: spec.name,
          queryRef: spec.query_ref ?? null,
          tableDax: spec.table_dax ?? null,
          columns: (spec.columns ?? []).map((c) => ({
            name: c.name,
            type: c.type ?? null,
            format: c.format ?? null,
            sourceColumn: c.source_column ?? null,
            calculated: c.calculated === true,
            dax: c.dax ?? null,
          })),
        });
      }
    }

    const mDir = path.join(catalog, 'measures');
    if (fs.existsSync(mDir)) {
      for (const f of fs.readdirSync(mDir).filter((x) => x.endsWith('.measures.yaml'))) {
        const spec = readYaml<MeasuresSpecFile>(path.join(mDir, f));
        for (const m of spec.measures ?? []) {
          model.addMeasure({
            name: m.name,
            table: spec.table,
            format: m.format ?? null,
            displayFolder: m.display_folder ?? null,
            dax: m.dax,
            ...(spec.origem === 'nativo' ? { origem: 'nativo' as const } : {}),
          });
        }
      }
    }

    const rFile = path.join(catalog, 'relationships.yaml');
    if (fs.existsSync(rFile)) {
      const spec = readYaml<RelationshipsSpecFile>(rFile);
      model.autoDateRelationshipsIgnored = spec.auto_date_relationships_ignored ?? 0;
      for (const r of spec.relationships ?? []) {
        model.relationships.push({
          id: r.id,
          fromTable: r.from_table,
          fromColumn: r.from_column,
          toTable: r.to_table,
          toColumn: r.to_column,
          fromCardinality: r.from_cardinality === 'many' ? 'many' : 'one',
          toCardinality: r.to_cardinality === 'many' ? 'many' : 'one',
          active: r.active !== false,
          crossFilter: r.cross_filter === 'bothDirections' ? 'bothDirections' : 'oneDirection',
          joinOnDateBehavior: r.join_on_date_behavior ?? null,
        });
      }
    }

    // Por último, de propósito: as divergências trocam DAX de objeto que só existe
    // depois que tabelas e medidas entraram. Ver `divergencias.ts` — cada uma carrega
    // o `sha256` do original, então uma extração que mude a fórmula do Power BI erra
    // alto aqui em vez de ser silenciosamente sobrescrita.
    model.divergencias = aplicaDivergencias(model, leDivergencias(specsDir));
    model.sobDemanda = leSobDemanda(specsDir);
    model.graoReduzido = leGraoReduzido(specsDir);
    model.cortes = leCortesPorPagina(specsDir);
    // Um corte sobre tabela ou coluna que não existe recortaria nada em silêncio — e a
    // página mostraria o número do outro relatório como se fosse o dela.
    for (const c of model.cortes) {
      if (!model.table(c.tabela)) throw new Error(`corte-por-pagina.yaml: a tabela '${c.tabela}' não está no modelo.`);
      if (!model.column(c.tabela, c.coluna)) {
        throw new Error(`corte-por-pagina.yaml: a coluna '${c.tabela}'[${c.coluna}] não está no modelo.`);
      }
      for (const r of c.recalcula) {
        const t = model.table(r);
        if (!t?.tableDax) throw new Error(`corte-por-pagina.yaml: '${r}' não é tabela calculada do modelo.`);
      }
    }

    return model;
  }

  addTable(table: ModelTable): void {
    const key = normalizeName(table.name);
    if (this.tableIndex.has(key)) {
      throw new Error(`Tabela duplicada no modelo: ${table.name}`);
    }
    this.tables.set(table.id, table);
    this.tableIndex.set(key, table);
    for (const col of table.columns) {
      this.columnIndex.set(`${key}\u0000${normalizeName(col.name)}`, col);
    }
  }

  addMeasure(measure: ModelMeasure): void {
    const key = normalizeName(measure.name);
    if (this.measureIndex.has(key)) {
      // Em DAX o nome de medida é único no modelo inteiro, não por tabela.
      // Duplicata aqui significaria que o extrator leu algo errado.
      throw new Error(`Medida duplicada no modelo: ${measure.name}`);
    }
    this.measureIndex.set(key, measure);
  }

  table(name: string): ModelTable | null {
    return this.tableIndex.get(normalizeName(name)) ?? null;
  }

  column(table: string, column: string): ModelColumn | null {
    return this.columnIndex.get(`${normalizeName(table)}\u0000${normalizeName(column)}`) ?? null;
  }

  measure(name: string): ModelMeasure | null {
    return this.measureIndex.get(normalizeName(name)) ?? null;
  }

  get measures(): ModelMeasure[] {
    return [...this.measureIndex.values()];
  }

  /**
   * Só as medidas que vieram do Power BI — sem as nativas. É o que os testes de
   * inventário contam: eles descrevem o relatório original, e uma medida escrita à
   * mão não pode mudar "o PBIP tem 78 medidas".
   */
  get measuresDoPbip(): ModelMeasure[] {
    return this.measures.filter((m) => m.origem !== 'nativo');
  }

  /** Colunas calculadas são DAX igual a medida — e precisam ser avaliadas. */
  get calculatedColumns(): { table: ModelTable; column: ModelColumn }[] {
    const out: { table: ModelTable; column: ModelColumn }[] = [];
    for (const table of this.tables.values()) {
      for (const column of table.columns) {
        if (column.calculated && column.dax) out.push({ table, column });
      }
    }
    return out;
  }

  /**
   * Tabelas cujas **linhas** vêm de DAX, não de query. São 7, e três delas
   * (`CALENDARIO INSTALADO`, `calendar`, `Status Protocolo Dia`) estão no
   * caminho de propagação de filtro — sem avaliá-las, contra dado real elas
   * nascem vazias e a propagação zera medida em silêncio.
   */
  get calculatedTables(): ModelTable[] {
    return [...this.tables.values()].filter((t) => t.tableDax);
  }

  /**
   * Relacionamentos ativos que tocam uma tabela, com a direção em que o filtro
   * propaga. No Power BI o filtro anda do lado "one" para o lado "many"; com
   * `bothDirections` anda nos dois sentidos.
   */
  activeRelationshipsFor(table: string): ModelRelationship[] {
    const key = normalizeName(table);
    return this.relationships.filter(
      (r) =>
        r.active && (normalizeName(r.fromTable) === key || normalizeName(r.toTable) === key),
    );
  }
}
