// FASE L5, R5 — o teto do cache stale-while-revalidate de `pagina` em `App.tsx`.
// `.ts` puro (sem JSX), pelo mesmo motivo de `cargaProgressiva.ts`: é lógica
// testável sem DOM, e `App.tsx` não tem teste próprio (componente de topo).

import type { PaginaCalculada } from '../services/dashboardService.ts';

/**
 * Sem teto, `paginasVistas` cresce por página+filtros+clicados — não só por página,
 * como `layoutsVistos` — e uma sessão de filtragem cruzada longa (ver `App.tsx`,
 * `aoFiltrarAlvos`) acumularia uma chave por combinação, sem nunca podar.
 */
export const TETO_PAGINAS_VISTAS = 30;

/**
 * Grava `p` sob `chave`, podando a entrada mais antiga por ORDEM DE INSERÇÃO quando
 * o teto estoura. Regravar uma chave já existente a reinsere no fim — a revalidação
 * de uma combinação usada há pouco não pode ser a próxima a cair.
 */
export function guardaPaginaVista(
  mapa: Map<string, PaginaCalculada>,
  chave: string,
  p: PaginaCalculada,
): void {
  mapa.delete(chave);
  mapa.set(chave, p);
  if (mapa.size > TETO_PAGINAS_VISTAS) {
    const maisVelha = mapa.keys().next().value;
    if (maisVelha !== undefined) mapa.delete(maisVelha);
  }
}

/**
 * Apaga toda entrada de UM dashboard — todas as combinações de filtro/clicado
 * dele, não só uma. Usado pelo listener de `/api/eventos` (ACHADOS #89/#90):
 * quando o servidor avisa que `dashboardId` mudou, nenhuma combinação velha
 * dele pode continuar servindo o flash otimista de `App.tsx` (a leitura
 * síncrona de `paginasVistas` antes do `fetch` revalidar).
 *
 * A chave é `urlDaPagina()` — `/api/dashboards/<id>` mais `?...`. Prefixo puro
 * confundiria `capa` com `capa-2`; o corte por `?`/fim-de-string evita isso.
 */
export function apagaPaginaDoCache(mapa: Map<string, PaginaCalculada>, dashboardId: string): number {
  const prefixo = `/api/dashboards/${encodeURIComponent(dashboardId)}`;
  let removidas = 0;
  for (const chave of [...mapa.keys()]) {
    if (chave !== prefixo && !chave.startsWith(`${prefixo}?`)) continue;
    mapa.delete(chave);
    removidas++;
  }
  return removidas;
}
