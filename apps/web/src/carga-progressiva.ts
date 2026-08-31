// O corte "acima da dobra" — Fase L5, R4 do contrato de carregamento
// (`docs/PLANO-LAYOUT-V1.md` §7). Puro, sem DOM: só interpreta `LayoutSpec`.
//
// **Por que fazer só a parte de cliente (adiar a renderização) não bastava.** A
// pesquisa que veio antes desta fase confirmou: sem mudar a chamada INICIAL de
// `pegaPagina`, o servidor continua calculando todos os visuais da página na mesma
// resposta síncrona (`calcula.ts`), e o tempo de ABRIR não melhora — só a
// renderização adia, o que é cosmético. `idsIniciais` é o que a abertura passa para
// `?visual=` (repetido) em vez de pedir a página inteira; o resto entra por
// `IntersectionObserver` (`VisualNaDobra.tsx`) conforme a pessoa rola.
//
// **Por que 2 faixas, e não 1 ou 3.** É o mesmo número que `estilo.css` já usa para
// dizer que "duas faixas cabem numa tela" (grafico 0,455 + tabela 0,545 = 1) — o
// corte eager pede o que a PRIMEIRA tela do relatório provavelmente mostra. Páginas
// com 2 faixas ou menos (a maioria das 14) pedem tudo eager, idêntico a hoje; só
// páginas de 3+ faixas (`agendamento-field`, `premiacao-instalacao`,
// `relatorio-do-mes`) mudam de comportamento, que é onde o ganho existe.

import type { LayoutSpec } from './api.ts';

export const N_FAIXAS_EAGER = 2;

/**
 * Os ids que a abertura pede eager: todo KPI (sempre visível, sempre barato) mais as
 * colunas das `N_FAIXAS_EAGER` primeiras faixas.
 *
 * **É a única fonte da verdade sobre o corte** — `VisualGridSection.tsx` não precisa
 * de um `ehFaixaEager(indice)` à parte: um visual que não veio na resposta inicial
 * (`porId.get(id)` vazio) já É, por construção, um visual fora deste array. As duas
 * pontas nunca podem discordar porque só existe uma conta.
 */
export function idsIniciais(layout: LayoutSpec): string[] {
  const kpis = layout.kpis.map((k) => k.visual);
  const faixas = layout.faixas
    .slice(0, N_FAIXAS_EAGER)
    .flatMap((f) => f.colunas.map((c) => c.visual));
  return [...kpis, ...faixas];
}
