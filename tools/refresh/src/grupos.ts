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
  incremental: boolean;
}

interface ArquivoDeRefresh {
  formato?: number;
  grupos?: Record<
    string,
    { queries?: string[]; intervalo_minutos?: number; incremental?: boolean }
  >;
}

/**
 * A query que não materializa em nenhum modo hoje (ACHADOS #81: SQL e M calculam
 * as mesmas 3 colunas, e o full-fetch passou do teto de 600s). Agendar refresh
 * automático dela é agendar uma falha certa a cada tick — trava aqui, não só em
 * comentário, porque comentário não impede alguém de reintroduzi-la achando que
 * "só falta dar cadência".
 */
export const QUERY_BLOQUEADA = 'protocolos-produtividade';

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
): string[] {
  const problemas: string[] = [];
  const donoDe = new Map<string, string>();

  for (const g of grupos.values()) {
    for (const q of g.queries) {
      if (!idsConhecidos.has(q)) {
        problemas.push(`grupo '${g.id}': query '${q}' não existe no Query Registry.`);
        continue;
      }
      if (q === QUERY_BLOQUEADA) {
        problemas.push(
          `grupo '${g.id}': '${QUERY_BLOQUEADA}' não materializa em nenhum modo hoje ` +
            `(ACHADOS #81) — remova de refresh.yaml até o achado ser resolvido.`,
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
