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
import { MEvalError, MTable, type MValue } from './value.ts';

/** Só o que o adaptador precisa do Query Engine. `QueryEngine` já satisfaz. */
export interface ExecutorDeQuery {
  execute(
    queryId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<{ rows: readonly Record<string, unknown>[] }>;
}

export interface FonteDoEngineOptions {
  /** Ignora o cache de leitura. Usado pela validação de paridade. */
  readonly forceRefresh?: boolean;
  /** Chamado antes e depois de cada busca — gancho de log/progresso. */
  readonly onBusca?: (evento: { id: string; linhas?: number; erro?: string }) => void;
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
      const { rows } = await engine.execute(spec.id, { forceRefresh: opts.forceRefresh });
      const convertidas = rows.map(comValoresAninhados);
      opts.onBusca?.({ id: spec.id, linhas: convertidas.length });
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
 * Converte célula que contém tabela aninhada.
 *
 * O único caso real é a coluna `Data` da navegação do Google Sheets. A regra é
 * estrutural e vale só nesta fronteira: um driver não produz registro nem lista
 * de registros de M, então array de objetos aqui **é** tabela. Array de escalares
 * continua lista (`Text.Split` e afins produzem isso).
 */
function comValoresAninhados(row: Record<string, unknown>): Record<string, unknown> {
  let mudou = false;
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const aninhada = comoTabela(v);
    if (aninhada) {
      saida[k] = aninhada;
      mudou = true;
    } else {
      saida[k] = v;
    }
  }
  return mudou ? saida : row;
}

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

/** Exportado para teste: o que o adaptador considera valor de M. */
export type ValorDaFonte = MValue | Record<string, unknown>[];
