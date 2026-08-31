// FASE L5, R5 — o teto do cache stale-while-revalidate de `pagina` em `App.tsx`.
// `.ts` puro (sem JSX), pelo mesmo motivo de `carga-progressiva.ts`: é lógica
// testável sem DOM, e `App.tsx` não tem teste próprio (componente de topo).

import type { PaginaCalculada } from './api.ts';

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
