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

/**
 * **Por que 4, não 2.** O valor original vinha de "duas faixas = uma tela" — verdade
 * só quando cada faixa reivindica `--util` inteiro sozinha (`FRACAO_POOL`,
 * `altura-medida.ts`). Numa página densa como `agendamento-field` (10 faixas: 2
 * grafico + 5 tabela + 3 matriz), o POOL divide a fração de cada tipo pelo número de
 * faixas daquele tipo — `calculaAlturasDeFaixa` derruba cada uma para o PISO
 * (`PISO_TETO_FAIXA`: grafico 273px, tabela 280px, matriz 360px), porque dividir por
 * 5 ou 3 não cabe na fração. Com o piso, quatro faixas (2 grafico + 2 tabela) somam
 * ~1106px — dentro de uma tela comum (1080px) mais a margem de 200px do
 * `IntersectionObserver` (`VisualNaDobra.tsx`) — e a quinta (a primeira matriz, 360px)
 * já estoura esse orçamento. Medido ao vivo em 03/09/2026 (ACHADOS #94): com o corte em
 * 2, as faixas 3-6 de `agendamento-field` ficavam "perto o bastante" JÁ NA ABERTURA
 * (dentro do raio do observer) mas frias (o aquecedor só cobria 1-2) — o primeiro
 * visitante depois de um restart disparava 4+ tabelas/matrizes pesadas ao mesmo tempo,
 * cada uma rápida sozinha (3-10ms aquecida) mas competindo pela mesma thread do Node
 * quando fria, com o sintoma de "carregando…" preso por segundos.
 *
 * **Por que um número fixo, e não a conta de altura real.** `calculaAlturasDeFaixa`
 * precisa de `utilPx` medido no DOM — não dá para rodar no aquecedor (Node, sem
 * navegador) nem manter puro/testável sem uma sonda. Um número fixo maior cobre o caso
 * denso medido sem introduzir essa dependência; ficou registrado aqui como possível
 * refino futuro, não implementado por falta de necessidade medida além do que resolve
 * hoje.
 */
export const N_FAIXAS_EAGER = 4;

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
