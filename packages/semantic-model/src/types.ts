// Tipos do modelo semântico — o equivalente ao modelo tabular do Power BI:
// tabelas, colunas (incluindo calculadas), medidas e relacionamentos.
//
// Tudo aqui vem de specs GERADAS por `npm run extract`. Nenhuma decisão humana
// mora neste modelo; ele descreve o que o Power BI de hoje faz.

export interface ModelColumn {
  name: string;
  /** dataType do TMDL. Frequentemente null: o Power BI infere da fonte. */
  type: string | null;
  format: string | null;
  sourceColumn: string | null;
  /** Coluna calculada = definida por DAX, não vem da query. */
  calculated: boolean;
  /** DAX da coluna calculada. null para coluna vinda da fonte. */
  dax: string | null;
}

export interface ModelMeasure {
  name: string;
  /** Tabela em que a medida está declarada. Em DAX a medida é global: a
   *  tabela é só organização visual, e `[Medida]` resolve sem qualificar. */
  table: string;
  format: string | null;
  displayFolder: string | null;
  dax: string;
}

export interface ModelTable {
  id: string;
  name: string;
  /** Query do registry que alimenta a tabela. null = calculada ou embutida. */
  queryRef: string | null;
  columns: ModelColumn[];
}

export type CrossFilter = 'oneDirection' | 'bothDirections';
export type Cardinality = 'one' | 'many';

export interface ModelRelationship {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  fromCardinality: Cardinality;
  toCardinality: Cardinality;
  /** false = só vale dentro de USERELATIONSHIP. Tratar como ativo muda números. */
  active: boolean;
  crossFilter: CrossFilter;
  joinOnDateBehavior: string | null;
}
