// O executor da fonte ao vivo: as linhas de UMA query, recortadas, pelo MESMO caminho
// que o refresh usa para gravar o snapshot (`materializa` em
// backend/tools/snapshot/src/index.ts):
//
//   1. `QueryEngine` com o catálogo — aqui, uma CÓPIA dele com o SQL costurado
//      (`ao-vivo.yaml`) só nesta query. O refresh muta o catálogo porque cada processo
//      dele materializa uma query e morre; numa API com pedidos simultâneos, mutar o
//      catálogo compartilhado vazaria o recorte de um pedido para o outro;
//   2. os parâmetros do recorte por `paramsPorQuery`, escopados à query — uma
//      dependência de M (`alocacao-patrimonio` para `protocolos-geral`) roda inteira;
//   3. o Power Query por `runQueries`;
//   4. `toDatasetRows`;
//   5. as colunas calculadas das tabelas da query, com as mesmas regras do refresh:
//      grão reduzido primeiro, depois o resto; e a query PADRÃO de um grão reduzido
//      (`field-agenda-slot`) só com as colunas de grão, como no refresh (ACHADOS #87).
//
// Nada aqui grava arquivo, abre conexão ou guarda estado entre chamadas: os
// conectores chegam prontos em `ContextoAoVivo`.

import { MemoryCache } from '../../query-engine/src/cache-memory.ts';
import { buscadorWeb } from '../../query-engine/src/connectors-web.ts';
import { QueryEngine } from '../../query-engine/src/engine.ts';
import { QueryRegistry } from '../../query-engine/src/registry.ts';
import type { Connector } from '../../query-engine/src/types.ts';
import { normalizeName, type SemanticModel } from '../../semantic-model/src/model.ts';
import { materializaColunas, materializaColunasPorGrao } from '../../snapshot/src/colunas-calculadas.ts';
import type { Escalar } from '../../snapshot/src/formato.ts';
import { GRAO_REDUZIDO_DE } from '../../snapshot/src/grao-reduzido.ts';
import { fonteDoEngine } from '../../transform-engine/src/fonte.ts';
import { queryDependencies, runQueries, type RunnerOptions } from '../../transform-engine/src/runner.ts';
import { toDatasetRows } from '../../transform-engine/src/value.ts';
import { costuraAoVivo, type ConsultaAoVivo } from './catalogo.ts';

export interface ContextoAoVivo {
  /** O catálogo do projeto. NUNCA é alterado: o pedido trabalha numa cópia. */
  readonly registry: QueryRegistry;
  readonly model: SemanticModel;
  readonly catalogo: ReadonlyMap<string, ConsultaAoVivo>;
  /** `dbVoalle`, `dbMaria`… já montados por quem chama. */
  readonly connectors: Map<string, Connector>;
  readonly culture: string | null;
  readonly reconcilia?: RunnerOptions['reconcilia'];
}

export interface PedidoAoVivo {
  readonly query: string;
  /**
   * Os parâmetros declarados em `ao-vivo.yaml`. Ausente = a consulta ORIGINAL do
   * catálogo, sem costura — é o lado de referência da sonda.
   */
  readonly params?: Readonly<Record<string, unknown>>;
  /** O mesmo instante para o M e para as colunas calculadas (`Status SLA` usa NOW()). */
  readonly agora: Date;
}

export interface BuscaFeita {
  readonly id: string;
  readonly linhas: number;
  readonly msBanco: number;
  readonly msConversao: number;
}

export interface ResultadoAoVivo {
  readonly query: string;
  readonly colunas: string[];
  readonly linhas: Record<string, Escalar>[];
  /** As queries que foram costuradas neste pedido (a pedida e dependências de M). */
  readonly recortadas: string[];
  /** Uma por sub-busca: a própria query e cada dependência de M. */
  readonly buscas: BuscaFeita[];
  readonly ms: { readonly total: number; readonly m: number; readonly calculadas: number };
}

/** Uma cópia do catálogo com o SQL de algumas queries trocado. A original fica intacta. */
export function catalogoComSql(base: QueryRegistry, trocas: ReadonlyMap<string, string>): QueryRegistry {
  const copia = new QueryRegistry();
  for (const [k, v] of base.datasources) copia.datasources.set(k, v);
  for (const [k, v] of base.dependents) copia.dependents.set(k, new Set(v));
  for (const [k, v] of base.queries) {
    const sql = trocas.get(k);
    copia.queries.set(k, sql === undefined ? v : { ...v, sql });
  }
  return copia;
}

/** A query e o fechamento das dependências de M dela, na ordem em que aparecem. */
export function fechamentoDeM(registry: QueryRegistry, query: string): string[] {
  const comM = registry.list().filter((q) => q.m_expression);
  const porNome = new Map(comM.map((q) => [q.name, q]));
  const nomes = new Set(porNome.keys());
  const vistas: string[] = [];
  const anda = (id: string): void => {
    if (vistas.includes(id)) return;
    vistas.push(id);
    const q = registry.get(id);
    if (!q.m_expression) return;
    for (const dep of queryDependencies(q.m_expression, nomes).dependencias) {
      const d = porNome.get(dep);
      if (d) anda(d.id);
    }
  };
  anda(query);
  return vistas;
}

/**
 * Quais queries do pedido levam recorte, e com quais parâmetros.
 *
 * A pedida sempre que vierem parâmetros; cada dependência de M quando tem entrada em
 * `ao-vivo.yaml` e o pedido traz TODOS os parâmetros dela. Cada uma recebe só os
 * parâmetros que declara — `traduzParametros` recusa parâmetro sem uso no SQL, e é
 * essa recusa que impede uma costura que ignora o recorte.
 */
export function recortesDoPedido(
  ctx: Pick<ContextoAoVivo, 'registry' | 'catalogo'>,
  pedido: Pick<PedidoAoVivo, 'query' | 'params'>,
): Map<string, Record<string, unknown>> {
  const recortes = new Map<string, Record<string, unknown>>();
  if (!pedido.params) return recortes;
  const pedida = ctx.catalogo.get(pedido.query);
  if (!pedida) {
    throw new Error(`'${pedido.query}' não tem recorte em ao-vivo.yaml — pedir parâmetros a ela não recortaria nada.`);
  }
  for (const id of fechamentoDeM(ctx.registry, pedido.query)) {
    const c = ctx.catalogo.get(id);
    if (!c || !c.parametros.every((p) => p in pedido.params!)) continue;
    recortes.set(id, Object.fromEntries(c.parametros.map((p) => [p, pedido.params![p]])));
  }
  return recortes;
}

/**
 * As tabelas do modelo cujas colunas calculadas esta query alimenta, e quais.
 *
 * Espelha `tabelasDaQuery` + `TABELA_SEM_QUERY_REF` do refresh: a query que é
 * `queryRef` de uma tabela calcula todas as colunas dela; a query PADRÃO de um grão
 * reduzido não é `queryRef` de ninguém, alimenta a tabela do grão e calcula só as
 * colunas de grão (o arquivo dela não tem `Relato`, e pedir `ClassificacaoRelato` ali
 * deve errar, como no refresh).
 */
export function calculadasDaQuery(
  model: SemanticModel,
  query: string,
): { tabela: string; somente?: string[] }[] {
  const proprias = [...model.tables.values()].filter((t) => t.queryRef === query).map((t) => ({ tabela: t.name }));
  if (proprias.length) return proprias;
  for (const g of model.graoReduzido) {
    if (g.queryPadrao !== query) continue;
    const grao = GRAO_REDUZIDO_DE.get(g.queryCompleta);
    if (grao) return [{ tabela: g.tabela, somente: grao.colunas }];
  }
  return [];
}

export async function buscaAoVivo(ctx: ContextoAoVivo, pedido: PedidoAoVivo): Promise<ResultadoAoVivo> {
  const inicio = Date.now();
  const original = ctx.registry.get(pedido.query);

  const recortes = recortesDoPedido(ctx, pedido);
  const trocas = new Map<string, string>();
  for (const id of recortes.keys()) {
    trocas.set(id, costuraAoVivo(ctx.registry.get(id).sql ?? '', ctx.catalogo.get(id)!));
  }
  const registry = trocas.size ? catalogoComSql(ctx.registry, trocas) : ctx.registry;

  const buscas: BuscaFeita[] = [];
  const engine = new QueryEngine({ registry, connectors: ctx.connectors, cache: new MemoryCache() });
  const fonte = fonteDoEngine(engine, {
    ...(recortes.size ? { paramsPorQuery: Object.fromEntries(recortes) } : {}),
    onBusca: (e) => {
      if (e.erro) return;
      buscas.push({ id: e.id, linhas: e.linhas ?? 0, msBanco: e.msExecute ?? 0, msConversao: e.msConversao ?? 0 });
    },
  });
  const web = original.endpoints?.length ? buscadorWeb({ permitidos: original.endpoints }) : undefined;

  const tM = Date.now();
  const feitas = await runQueries({
    specs: registry.list().filter((q) => q.m_expression),
    apenas: [pedido.query],
    culture: ctx.culture,
    fonte,
    ...(web ? { web } : {}),
    agora: pedido.agora,
    guardaPassos: false,
    ...(ctx.reconcilia ? { reconcilia: ctx.reconcilia } : {}),
  });
  const tabela = feitas.get(pedido.query)!.tabela;
  feitas.clear();
  const { columns, rows } = toDatasetRows(tabela, pedido.query);
  const msM = Date.now() - tM;

  const tCalc = Date.now();
  const linhas = rows as Record<string, Escalar>[];
  for (const alvo of calculadasDaQuery(ctx.model, pedido.query)) {
    const t = ctx.model.table(alvo.tabela);
    if (!t) continue;
    if (alvo.somente) {
      const m = materializaColunas(t, ctx.model, linhas, pedido.agora, new Set(alvo.somente.map(normalizeName)));
      for (const c of m.colunas) if (!columns.includes(c)) columns.push(c);
      continue;
    }
    const grao = GRAO_REDUZIDO_DE.get(pedido.query);
    if (grao) {
      const mg = materializaColunasPorGrao(t, ctx.model, linhas, pedido.agora, grao.chave, new Set(grao.colunas.map(normalizeName)));
      for (const c of mg.colunas) if (!columns.includes(c)) columns.push(c);
    }
    const m = materializaColunas(t, ctx.model, linhas, pedido.agora);
    for (const c of m.colunas) if (!columns.includes(c)) columns.push(c);
  }

  return {
    query: pedido.query,
    colunas: columns,
    linhas,
    recortadas: [...recortes.keys()],
    buscas,
    ms: { total: Date.now() - inicio, m: msM, calculadas: Date.now() - tCalc },
  };
}
