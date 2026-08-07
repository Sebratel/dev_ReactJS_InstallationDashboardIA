// O que uma página precisa ter em disco para calcular.
//
// **Por que não materializar tudo sempre.** As 23 queries da camada M puxam a base
// inteira: `field-agenda` sozinha tem 1,4 milhão de linhas e o processo precisa de
// 8 GB de heap (ACHADOS.md #20). Medido em 07/08/2026, porém, a maior parte das
// páginas não a usa:
//
// | query | em quantas das 14 páginas |
// |---|---|
// | `protocolos-geral` | 13 — é a espinha do relatório |
// | `hora-atualizado` | 13 |
// | `field-agenda` (1,4 M) | **3** |
// | `apuracao-premiacao`, `reincidencia`, ... | 1 cada |
//
// Então o snapshot é por **fechamento**, não por catálogo: pede-se uma página e
// materializa-se o que ela alcança.
//
// **O fechamento não é a lista de `entities_used`.** Uma medida referencia tabelas
// que o visual não nomeia — `[Média Geral]` mora em `PROTOCOLOS PRODUTIVIDADE` e
// pode dividir por algo de `CALENDARIO INSTALADO`. Uma coluna calculada faz o
// mesmo. E uma tabela calculada **nasce** de DAX que varre outra tabela. Parar na
// lista do visual daria um snapshot que carrega e um cálculo que erra alto no meio
// — ou pior, um `BLANK` onde deveria haver número.
//
// Por isso o fechamento anda por quatro arestas, até não crescer mais:
//
//   visual → tabela · medida
//   medida → DAX → tabela · medida
//   tabela → DAX das colunas calculadas → tabela
//   tabela calculada → DAX das linhas → tabela

import { extractRefs } from '../../semantic-model/src/refs.ts';
import { normalizeName as normaliza, type SemanticModel } from '../../semantic-model/src/model.ts';
import type { DashboardSpec } from '../../widget-engine/src/spec.ts';

export interface TabelaDoPlano {
  /** Nome como o modelo o escreve. */
  nome: string;
  /** Id da query da camada M, ou `null` se a tabela nasce de DAX. */
  query: string | null;
  /** Quem a puxou para o plano — a trilha, para conferir sem reler o código. */
  porque: string;
}

export interface PlanoDeSnapshot {
  dashboards: string[];
  tabelas: TabelaDoPlano[];
  /** Ids de query a materializar, em ordem estável. */
  queries: string[];
  /** Tabelas cujas linhas nascem de DAX no carregamento, não em disco. */
  calculadas: string[];
  /** Medidas que a página usa, direta ou indiretamente. */
  medidas: string[];
}

/** Tabelas e medidas que um dashboard nomeia nos visuais e nos filtros. */
function semente(dash: DashboardSpec): { tabelas: Set<string>; medidas: Set<string> } {
  const tabelas = new Set<string>();
  const medidas = new Set<string>();
  const anota = (entity: string | null | undefined): void => {
    if (entity) tabelas.add(entity);
  };

  for (const f of dash.filters ?? []) anota(f.entity);
  for (const v of dash.visuals ?? []) {
    for (const e of v.entities_used ?? []) anota(e);
    for (const f of v.filters ?? []) anota(f.entity);
    // Campo aninhado: `Arithmetic` guarda dois operandos, e `ScopedEval` guarda
    // uma expressão dentro. A tabela do `%` do relatório está lá dentro.
    const campos = [...(v.fields ?? [])];
    for (const c of campos) {
      anota(c.entity);
      if (c.kind === 'measure' && c.property) medidas.add(c.property);
      for (const filho of [c.left, c.right, c.expression]) {
        if (filho) campos.push(filho);
      }
    }
  }
  return { tabelas, medidas };
}

/** Tabelas e medidas que uma expressão DAX referencia. */
function refsDoDax(dax: string, model: SemanticModel): { tabelas: string[]; medidas: string[] } {
  const tabelas: string[] = [];
  const medidas: string[] = [];
  for (const ref of extractRefs(dax)) {
    if (ref.kind === 'column' || ref.kind === 'table') tabelas.push(ref.table);
    else if (ref.kind === 'bare') {
      // `[Nome]` sem tabela é medida **ou** coluna da tabela do contexto. Só a
      // primeira leitura acrescenta algo ao plano; a segunda já está coberta pela
      // tabela dona do DAX.
      if (model.measure(ref.name)) medidas.push(ref.name);
    } else if (ref.kind === 'word' && model.table(ref.name)) {
      // Tabela sem aspas — `calendar` é escrita assim no modelo.
      tabelas.push(ref.name);
    }
  }
  return { tabelas, medidas };
}

/**
 * O plano de uma ou mais páginas.
 *
 * Erra alto quando uma tabela do fechamento não tem nem `query_ref` nem
 * `table_dax`: ela não pode ser materializada de jeito nenhum, e deixá-la de fora
 * daria um `Tabela não está no dataset` lá na frente, longe da causa.
 */
export function planeja(
  dashboards: readonly DashboardSpec[],
  model: SemanticModel,
): PlanoDeSnapshot {
  const porque = new Map<string, string>();
  const tabelas = new Set<string>();
  const medidas = new Set<string>();
  /** Fila de trabalho: o que ainda não foi expandido. */
  const pendentes: { tipo: 'tabela' | 'medida'; nome: string }[] = [];

  const poeTabela = (nome: string, trilha: string): void => {
    const k = normaliza(nome);
    if (tabelas.has(k)) return;
    tabelas.add(k);
    porque.set(k, trilha);
    pendentes.push({ tipo: 'tabela', nome });
  };
  const poeMedida = (nome: string, trilha: string): void => {
    const k = normaliza(nome);
    if (medidas.has(k)) return;
    medidas.add(k);
    porque.set(`medida:${k}`, trilha);
    pendentes.push({ tipo: 'medida', nome });
  };

  for (const dash of dashboards) {
    const s = semente(dash);
    for (const t of s.tabelas) poeTabela(t, `visual de ${dash.id}`);
    for (const m of s.medidas) poeMedida(m, `visual de ${dash.id}`);
  }

  while (pendentes.length > 0) {
    const item = pendentes.pop()!;

    if (item.tipo === 'medida') {
      const m = model.measure(item.nome);
      if (!m) continue; // Medida que o visual cita e o modelo não tem: é o achado 6.
      poeTabela(m.table, `medida [${m.name}] mora nela`);
      const r = refsDoDax(m.dax, model);
      for (const t of r.tabelas) poeTabela(t, `DAX de [${m.name}]`);
      for (const x of r.medidas) poeMedida(x, `DAX de [${m.name}]`);
      continue;
    }

    const t = model.table(item.nome);
    if (!t) continue; // Entidade do visual que o modelo não conhece — sai no relatório.

    // Linhas que nascem de DAX: o que esse DAX varre precisa estar carregado
    // **antes** dela.
    if (t.tableDax) {
      const r = refsDoDax(t.tableDax, model);
      for (const x of r.tabelas) poeTabela(x, `linhas de '${t.name}' vêm dela`);
      for (const x of r.medidas) poeMedida(x, `linhas de '${t.name}' vêm dela`);
    }
    for (const c of t.columns) {
      if (!c.calculated || !c.dax) continue;
      const r = refsDoDax(c.dax, model);
      for (const x of r.tabelas) poeTabela(x, `DAX de '${t.name}'[${c.name}]`);
      for (const x of r.medidas) poeMedida(x, `DAX de '${t.name}'[${c.name}]`);
    }
  }

  const doPlano: TabelaDoPlano[] = [...tabelas].sort().map((k) => {
    const t = model.table(k)!;
    if (!t.queryRef && !t.tableDax) {
      throw new Error(
        `Tabela '${t.name}' entrou no plano (${porque.get(k)}) e não tem nem query_ref ` +
          `nem table_dax — não há como materializá-la. Confira specs/_catalog/tables/.`,
      );
    }
    return { nome: t.name, query: t.queryRef ?? null, porque: porque.get(k)! };
  });

  return {
    dashboards: dashboards.map((d) => d.id),
    tabelas: doPlano,
    queries: [...new Set(doPlano.map((t) => t.query).filter((q): q is string => q !== null))].sort(),
    calculadas: doPlano.filter((t) => t.query === null).map((t) => t.nome),
    medidas: [...medidas].sort(),
  };
}
