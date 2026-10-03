// Adaptador entre o Query Engine (Fase 1) e o runner de M (Fase 2b.8).
//
// O runner recebe `fonte` injetada porque avaliar M é síncrono e ler fonte é
// assíncrono. Este arquivo é a implementação de produção dessa injeção: passa o
// id da query para o Engine, que já sabe cache, single-flight, timeout e
// read-only, e devolve as linhas.
//
// **Por que uma interface local em vez de importar `QueryEngine`.** O
// transform-engine não depende do query-engine, e não deveria: a camada M é
// linguagem, não infraestrutura. O contrato usado aqui é uma única função
// (`execute(id) -> { rows }`), então declará-lo estruturalmente mantém as duas
// direções livres — o `QueryEngine` satisfaz `ExecutorDeQuery` sem saber que este
// arquivo existe, e o teste satisfaz com quatro linhas.

import { deLinhas, type FonteDeLinhas, type MQuerySpec } from './runner.ts';
import { MEvalError, MTable } from './value.ts';

/** Só o que o adaptador precisa do Query Engine. `QueryEngine` já satisfaz. */
export interface ExecutorDeQuery {
  execute(
    queryId: string,
    options?: { forceRefresh?: boolean; params?: Record<string, unknown> },
  ): Promise<{ rows: readonly Record<string, unknown>[] }>;
}

export interface FonteDoEngineOptions {
  /** Ignora o cache de leitura. Usado pela validação de paridade. */
  readonly forceRefresh?: boolean;
  /**
   * Parâmetros nomeados por id de query (`:desde` etc.) — a carga incremental usa
   * isto para injetar o corte de data depois de costurar o SQL (ver
   * `backend/packages/snapshot/src/incremental.ts`). **Por id, não um único objeto global**:
   * o M de uma query pode citar OUTRAS como dependência (`protocolos-produtividade`
   * cita `alocacao-patrimonio`), e essas chegam à mesma `fonte`. Um `params` único
   * vazaria para elas e `traduzParametros` erraria alto — corretamente — com
   * "parâmetro sem uso no SQL", porque a dependência não foi costurada.
   */
  readonly paramsPorQuery?: Readonly<Record<string, Record<string, unknown>>>;
  /**
   * Chamado depois de cada busca — gancho de log/progresso.
   *
   * `msExecute` e `msConversao` vêm separados de propósito. As duas respondem
   * perguntas diferentes quando uma query demora: `msExecute` é banco e rede (a
   * resposta é índice, `LIMIT`, ou cache), `msConversao` é CPU nossa percorrendo
   * linha por linha (a resposta é não percorrer). Numa tabela de 1,4 milhão de
   * linhas o segundo pode passar o primeiro, e um número só não distinguiria.
   */
  readonly onBusca?: (evento: {
    id: string;
    linhas?: number;
    erro?: string;
    msExecute?: number;
    msConversao?: number;
  }) => void;
}

/**
 * Constrói a `fonte` do runner a partir de um executor de query.
 *
 * Uma responsabilidade além de repassar linhas: **a navegação do Google Sheets**.
 * O connector de planilha devolve uma linha por aba com a tabela de dados dentro
 * da coluna `Data`, e essa tabela chega como `Row[]` — que é o formato do
 * connector, não um valor de M. Convertê-la aqui é o que faz o passo
 * `Fonte{[name="STAGING", ItemKind="Table"]}[Data]` encontrar uma tabela em vez
 * de uma lista de registros.
 */
export function fonteDoEngine(
  engine: ExecutorDeQuery,
  opts: FonteDoEngineOptions = {},
): FonteDeLinhas {
  return async (spec: MQuerySpec) => {
    try {
      const t0 = Date.now();
      const params = opts.paramsPorQuery?.[spec.id];
      const { rows } = await engine.execute(spec.id, {
        forceRefresh: opts.forceRefresh,
        ...(params ? { params } : {}),
      });
      const t1 = Date.now();
      const convertidas = rows.map(comValoresAninhados);
      opts.onBusca?.({
        id: spec.id,
        linhas: convertidas.length,
        msExecute: t1 - t0,
        msConversao: Date.now() - t1,
      });
      return convertidas;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.onBusca?.({ id: spec.id, erro: msg });
      // Erro de fonte fica distinguível de erro de expressão: quem chama o runner
      // precisa saber se o problema é credencial/rede ou o M em si.
      throw new FonteError(`Falha ao ler a fonte da query '${spec.id}': ${msg}`, { cause: err });
    }
  };
}

/** Falha na leitura da fonte — não é erro de avaliação de M. */
export class FonteError extends Error {}

/**
 * Converte a tabela aninhada da navegação de planilha.
 *
 * Toca **uma** coluna e devolve a mesma linha quando não há nada a fazer — isto roda
 * 1,4 milhão de vezes em `field-agenda`, onde nenhuma linha tem coluna aninhada.
 */
function comValoresAninhados(row: Record<string, unknown>): Record<string, unknown> {
  const bruto = row[COLUNA_DE_NAVEGACAO];
  const aninhada = comoTabela(bruto);
  if (!aninhada) return row;
  return { ...row, [COLUNA_DE_NAVEGACAO]: aninhada };
}

/**
 * A única coluna em que uma tabela pode vir aninhada.
 *
 * Restringir a esta coluna, em vez de converter todo array de objetos, é o que
 * mantém `jsonb` sendo **recusado**. Um `jsonb` que contenha `[{...}, {...}]` é
 * indistinguível de uma grade de planilha olhando só a forma — e adivinhar ali
 * produziria uma tabela plausível a partir de um dado que ninguém pediu para
 * tabular. Hoje nenhuma query do escopo traz `jsonb` (só as duas de `interval`),
 * então isto é guarda para o futuro, não correção de algo quebrado.
 *
 * O nome vem do M, não de nós: `Fonte{[name="STAGING", ItemKind="Table"]}[Data]`.
 */
const COLUNA_DE_NAVEGACAO = 'Data';

function comoTabela(v: unknown): MTable | null {
  if (v instanceof MTable) return v;
  if (!Array.isArray(v) || v.length === 0) return null;
  const todosObjetos = v.every(
    (x) =>
      typeof x === 'object' &&
      x !== null &&
      !Array.isArray(x) &&
      !(x instanceof Date) &&
      !(x instanceof Uint8Array),
  );
  if (!todosObjetos) return null;
  try {
    return deLinhas(v as Record<string, unknown>[]);
  } catch (err) {
    // `deLinhas` recusa grade não retangular. Aqui isso significa connector
    // devolvendo aba com linhas de larguras diferentes — erro de connector, e
    // dizer qual coluna trazia a tabela é o que permite achá-lo.
    throw new MEvalError(
      `A fonte devolveu uma tabela aninhada inválida: ${err instanceof Error ? err.message : err}`,
    );
  }
}
