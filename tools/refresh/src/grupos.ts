// Lê e valida `specs/_catalog/refresh.yaml` — mesmo padrão de
// `packages/snapshot/src/incremental.ts` (`lePoliticas`): arquivo mantido por
// humano, formato versionado, e a leitura confere o que a prosa do YAML promete
// em vez de confiar nela.

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const ARQUIVO = path.join('_catalog', 'refresh.yaml');

export interface GrupoDeRefresh {
  id: string;
  queries: string[];
  intervaloMinutos: number;
  /**
   * `true` liga a incremental em toda query do grupo que tem política; uma lista liga
   * só nas citadas. A lista existe porque o `frio` tem duas com política e só uma
   * delas foi ligada (`field-agenda`, ACHADOS #165).
   */
  incremental: boolean | string[];
}

interface ArquivoDeRefresh {
  formato?: number;
  grupos?: Record<
    string,
    { queries?: string[]; intervalo_minutos?: number; incremental?: boolean | string[] }
  >;
}

/** O `--incremental` que o grupo passa ao snapshot — vazio quando desligado. */
export function argIncremental(grupo: GrupoDeRefresh): string[] {
  if (grupo.incremental === true) return ['--incremental'];
  if (Array.isArray(grupo.incremental) && grupo.incremental.length) {
    return [`--incremental=${grupo.incremental.join(',')}`];
  }
  return [];
}

/**
 * Queries que **não materializam em modo nenhum**. Agendar refresh automático de uma
 * delas é agendar uma falha certa a cada tick — trava aqui, e não só em comentário,
 * porque comentário não impede alguém de reintroduzi-la achando que "só falta dar
 * cadência".
 *
 * ---------------------------------------------------------------------------
 * **VAZIO DESDE 13/09/2026.** `protocolos-produtividade` esteve aqui por ACHADOS #81
 * — "SQL e M calculam as mesmas 3 colunas, e o full-fetch passou do teto de 600 s".
 * As DUAS causas foram removidas e medidas:
 *
 *   - o M caiu para o join de GESTOR (a colisão de colunas sumiu);
 *   - o SQL saiu de "não termina em 600 s" para **142,7 s**. O custo dominante não
 *     era o fanout de `financial_receivable_titles`: era o `regexp_replace` escrito
 *     dentro do `ON` do CTE `mesclado`, que sem estatística fazia o planejador
 *     estimar `rows=2` (o real passa de 70 mil) e escolher Nested Loop — dois regexps
 *     por PAR de linhas. `AS MATERIALIZED` nas CTEs `unificado`/`auxiliar` resolveu;
 *     calcular a chave numa subconsulta SEM a cerca não mudou o plano em nada.
 *
 * Materialização ponta a ponta medida em 13/09/2026: **162 s, 76.398 linhas**, dentro
 * do teto de 600 s de `tools/snapshot/src/index.ts`.
 *
 * O mecanismo fica de pé: a próxima query que PROVAR não materializar entra aqui.
 * ---------------------------------------------------------------------------
 */
export const QUERIES_BLOQUEADAS: ReadonlySet<string> = new Set<string>();

export function leGrupos(specsDir: string): Map<string, GrupoDeRefresh> {
  const p = path.join(specsDir, ARQUIVO);
  const fora = new Map<string, GrupoDeRefresh>();
  if (!fs.existsSync(p)) return fora;

  const doc = (parseYaml(fs.readFileSync(p, 'utf8')) ?? {}) as ArquivoDeRefresh;
  if (doc.formato !== undefined && doc.formato !== 1) {
    throw new Error(`${p}: formato ${doc.formato}, esperado 1.`);
  }
  for (const [id, bruto] of Object.entries(doc.grupos ?? {})) {
    if (!bruto.queries?.length) throw new Error(`${p}: grupo '${id}' não declara 'queries'.`);
    if (!bruto.intervalo_minutos || bruto.intervalo_minutos <= 0) {
      throw new Error(`${p}: grupo '${id}' precisa de 'intervalo_minutos' positivo.`);
    }
    if (Array.isArray(bruto.incremental)) {
      const foraDoGrupo = bruto.incremental.filter((q) => !bruto.queries!.includes(q));
      if (foraDoGrupo.length) {
        throw new Error(
          `${p}: grupo '${id}' liga a incremental em ${foraDoGrupo.join(', ')}, que não está nas queries dele.`,
        );
      }
    } else if (bruto.incremental !== undefined && typeof bruto.incremental !== 'boolean') {
      throw new Error(`${p}: grupo '${id}': 'incremental' é true/false ou uma lista de queries do grupo.`);
    }
    fora.set(id, {
      id,
      queries: bruto.queries,
      intervaloMinutos: bruto.intervalo_minutos,
      incremental: bruto.incremental ?? false,
    });
  }
  return fora;
}

/**
 * Confere o que `leGrupos` não confere sozinha: que os ids existem de verdade, que
 * nenhuma query está em dois grupos (dispararia fetch duplicado do mesmo id no
 * mesmo tick) e que a query bloqueada não foi reintroduzida. Devolve a lista de
 * problemas; vazia é "pode rodar".
 */
export function validaGrupos(
  grupos: ReadonlyMap<string, GrupoDeRefresh>,
  idsConhecidos: ReadonlySet<string>,
  /** Injetável só para o teste provar que o mecanismo continua de pé com a lista vazia. */
  bloqueadas: ReadonlySet<string> = QUERIES_BLOQUEADAS,
): string[] {
  const problemas: string[] = [];
  const donoDe = new Map<string, string>();

  for (const g of grupos.values()) {
    for (const q of g.queries) {
      if (!idsConhecidos.has(q)) {
        problemas.push(`grupo '${g.id}': query '${q}' não existe no Query Registry.`);
        continue;
      }
      if (bloqueadas.has(q)) {
        problemas.push(
          `grupo '${g.id}': '${q}' não materializa em nenhum modo hoje — ` +
            `remova de refresh.yaml até isso ser resolvido.`,
        );
      }
      const donoAnterior = donoDe.get(q);
      if (donoAnterior !== undefined && donoAnterior !== g.id) {
        problemas.push(`query '${q}' aparece em dois grupos: '${donoAnterior}' e '${g.id}'.`);
      } else {
        donoDe.set(q, g.id);
      }
    }
  }
  return problemas;
}
