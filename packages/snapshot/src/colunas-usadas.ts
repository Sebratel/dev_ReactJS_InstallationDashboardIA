// Quais colunas físicas uma página realmente toca — e quais dá para não carregar.
//
// **Por que existe.** `FIELD AGENDA` tem 1,46 milhão de linhas e 26 colunas, e
// `agendamento-field` usa **8** delas. `Relato` sozinho é 36,8% dos bytes do
// arquivo, e existe para alimentar um `CONTAINSSTRING` que virou coluna congelada
// no refresh (ACHADOS #47). Carregar os outros 37% é pagar memória e tempo por
// dado que ninguém lê. É o passo 1-2 de `docs/DECISAO-DESEMPENHO.md`.
//
// **Derivado, nunca escrito à mão.** Uma lista de "colunas que a página usa"
// mantida por humano apodrece no primeiro `npm run extract`: alguém acrescenta um
// campo num visual e a lista não sabe. Aqui o conjunto sai do mesmo fechamento que
// `plano.ts` faz para tabelas, andando por cinco arestas:
//
//   visual.fields   → coluna ligada diretamente (Rows, Columns, Values, Tooltips…)
//   filtro          → coluna filtrada, na página e no visual
//   DAX             → toda `'T'[C]` de medida, coluna calculada e tabela calculada
//   relacionamento  → as duas pontas, senão a propagação de filtro para de funcionar
//   coluna calculada→ o que ela lê da própria tabela
//
// **O erro possível tem um lado só.** Omitir coluna que a página usa é o erro que
// importa, e ele **não é silencioso**: `columnValue` erra alto quando a coluna
// existe no modelo e não veio nos dados, e o índice de igualdade recusa responder
// (ACHADOS #50). Então este módulo erra deliberadamente para o lado de **manter**:
// referência que não dá para resolver com certeza mantém a coluna.

import { extractRefs } from '../../semantic-model/src/refs.ts';
import { normalizeName as normaliza, type SemanticModel } from '../../semantic-model/src/model.ts';
import type { DashboardSpec, CampoSpec, FiltroSpec } from '../../widget-engine/src/spec.ts';
export { leSobDemanda, sobDemandaDe, type SobDemanda } from '../../semantic-model/src/projecao.ts';

/** Nome de tabela normalizado → colunas normalizadas que a página precisa. */
export type ColunasUsadas = Map<string, Set<string>>;

function marca(usadas: ColunasUsadas, tabela: string, coluna: string): void {
  const k = normaliza(tabela);
  let s = usadas.get(k);
  if (!s) {
    s = new Set();
    usadas.set(k, s);
  }
  s.add(normaliza(coluna));
}

/**
 * Toda tabela do modelo que tem uma coluna com este nome.
 *
 * Existe para o `[Coluna]` sem tabela — a referência `bare` do scanner, que pode
 * ser medida **ou** coluna da tabela em contexto de linha. Qual das duas só o
 * avaliador sabe, e ele só sabe em tempo de execução. Marcar em **todas** as
 * tabelas que têm esse nome é o lado seguro: mantém coluna a mais, nunca a menos.
 */
function marcaBare(usadas: ColunasUsadas, nome: string, model: SemanticModel): void {
  for (const t of model.tables.values()) {
    if (t.columns.some((c) => normaliza(c.name) === normaliza(nome))) marca(usadas, t.name, nome);
  }
}

function daDax(usadas: ColunasUsadas, dax: string | null, model: SemanticModel): void {
  if (!dax) return;
  for (const r of extractRefs(dax)) {
    if (r.kind === 'column') marca(usadas, r.table, r.column);
    else if (r.kind === 'bare') marcaBare(usadas, r.name, model);
  }
}

function doCampo(usadas: ColunasUsadas, c: CampoSpec, model: SemanticModel): void {
  if (!c.entity || !c.property) return;
  if (c.kind === 'measure') {
    // A medida traz as colunas dela pelo DAX; o par entity/property de uma medida
    // não é coluna nenhuma.
    daDax(usadas, model.measure(c.property)?.dax ?? null, model);
    return;
  }
  marca(usadas, c.entity, c.property);
}

function doFiltro(usadas: ColunasUsadas, f: FiltroSpec, model: SemanticModel): void {
  if (f.entity && f.property) marca(usadas, f.entity, f.property);
  for (const cond of f.conditions ?? []) {
    const p = (cond as { left_property?: string | null }).left_property;
    if (f.entity && p) marca(usadas, f.entity, p);
  }
  void model;
}

/**
 * As colunas que estas páginas alcançam, por tabela.
 *
 * Fecha por transitividade nas medidas: uma medida cita outra, e a segunda pode
 * tocar colunas que a primeira não nomeia.
 */
export function colunasUsadas(
  dashboards: readonly DashboardSpec[],
  model: SemanticModel,
): ColunasUsadas {
  const usadas: ColunasUsadas = new Map();

  for (const d of dashboards) {
    for (const f of d.filters ?? []) doFiltro(usadas, f, model);
    for (const v of d.visuals ?? []) {
      for (const c of v.fields ?? []) doCampo(usadas, c, model);
      for (const f of v.filters ?? []) doFiltro(usadas, f, model);
    }
  }

  // Todo DAX do modelo entra: medida, coluna calculada e tabela calculada. É mais
  // largo que o alcance da página — de propósito. Restringir exigiria refazer aqui
  // o fechamento de `plano.ts`, e o custo de manter uma coluna a mais é memória; o
  // de tirar uma a menos é a página não abrir.
  for (const m of model.measures) daDax(usadas, m.dax, model);
  for (const t of model.tables.values()) {
    daDax(usadas, t.tableDax, model);
    for (const c of t.columns) {
      if (!c.calculated || !c.dax) continue;
      daDax(usadas, c.dax, model);
      // `[X]` dentro de uma coluna calculada é coluna da própria tabela, e
      // `marcaBare` já cobre isso com folga. O que falta é o caso da referência
      // que o scanner devolve como `word` — variável, enum ou tabela sem aspas —,
      // e para essa não há o que marcar.
    }
  }

  // As duas pontas de todo relacionamento. Sem elas a propagação de filtro pararia
  // de achar a chave e o número sairia sem o filtro — errado, e plausível.
  for (const r of model.relationships) {
    marca(usadas, r.fromTable, r.fromColumn);
    marca(usadas, r.toTable, r.toColumn);
  }

  return usadas;
}

/**
 * As colunas **físicas** de `tabela` que dá para não carregar.
 *
 * Coluna calculada nunca entra: ela ou está materializada no arquivo (e é barata),
 * ou nasce no carregamento a partir de colunas que este módulo já manteve.
 *
 * `emDisco` são os nomes como o cabeçalho do snapshot os escreve.
 */
export function omissiveis(
  tabela: string,
  emDisco: readonly string[],
  usadas: ColunasUsadas,
  model: SemanticModel,
  /** Colunas usadas que saem assim mesmo, por decisão. Ver `leSobDemanda`. */
  sobDemanda: ReadonlySet<string> = new Set(),
): string[] {
  const t = model.table(tabela);
  if (!t) return [];
  const precisa = new Set(usadas.get(normaliza(tabela)) ?? []);
  // A decisão humana ganha da derivação: aqui a coluna é usada e sai mesmo assim.
  for (const c of sobDemanda) precisa.delete(c);

  // `sourceColumn` é o nome na fonte; o cabeçalho pode trazer qualquer um dos dois.
  const apelidos = new Map<string, string>();
  for (const c of t.columns) {
    apelidos.set(normaliza(c.name), normaliza(c.name));
    if (c.sourceColumn) apelidos.set(normaliza(c.sourceColumn), normaliza(c.name));
  }

  const fora: string[] = [];
  for (const nome of emDisco) {
    const k = normaliza(nome);
    const doModelo = apelidos.get(k) ?? k;
    // Não está no modelo: a camada M a produziu e ninguém a declarou. Manter — pode
    // ser insumo de coluna calculada que o scanner não amarrou a uma tabela.
    const col = t.columns.find((c) => normaliza(c.name) === doModelo);
    if (!col) continue;
    if (col.calculated) continue;
    if (precisa.has(doModelo) || precisa.has(k)) continue;
    fora.push(k);
  }
  return fora;
}
