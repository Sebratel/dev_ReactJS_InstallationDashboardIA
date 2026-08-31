// O corte "acima da dobra" (Fase L5, R4, docs/PLANO-LAYOUT-V1.md §7) — fonte única.
//
// Mora em `tools/layout`, não em `apps/web`, porque não é só o navegador que precisa
// dele: o aquecimento também precisa (`apps/api/src/aquecedor.ts`,
// `tools/subir/src/aquece.ts`). Pedir `/api/dashboards/:id` sem `?visual=` enche uma
// chave de cache (`ChaveDeResposta`, visuais=null → '*') que o navegador NUNCA pede
// depois de R4 — ele sempre lista um subconjunto explícito. Aquecer a chave errada não
// é lentidão, é aquecimento que não aquece nada; foi assim que um clique em rajada (R6)
// bateu 17s numa página que o próprio `npm start` tinha acabado de reportar "quente".
// `apps/web/src/carga-progressiva.ts` reexporta daqui — é a MESMA função dos dois
// lados, não uma cópia, para as duas pontas nunca poderem discordar.

import type { LayoutSpec } from './schema.ts';

export const N_FAIXAS_EAGER = 2;

/**
 * Os ids que a abertura pede eager: todo KPI (sempre visível, sempre barato) mais as
 * colunas das `N_FAIXAS_EAGER` primeiras faixas.
 */
export function idsIniciais(layout: LayoutSpec): string[] {
  const kpis = layout.kpis.map((k) => k.visual);
  const faixas = layout.faixas
    .slice(0, N_FAIXAS_EAGER)
    .flatMap((f) => f.colunas.map((c) => c.visual));
  return [...kpis, ...faixas];
}
