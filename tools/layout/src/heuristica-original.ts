// A heurística de layout de ANTES da Fase L4 — só `extrai.ts` importa daqui hoje.
//
// Até a Fase L4 este arquivo morava em `apps/web/src/atomic/organisms/heuristica-grade.ts`
// e era a fonte da forma da tela em tempo de render. A Fase L4 trocou isso: quem decide
// a forma agora é `specs/layout/*.layout.yaml`, e `VisualGridSection.tsx` só lê o
// arquivo — nenhuma leitura de `v.dados` sobra no bundle de produção para decidir
// layout. Esta heurística continua existindo só para `npm run layout:extrai` poder
// REGENERAR um `.layout.yaml` a partir da forma derivada, quando alguém quiser voltar a
// ela (ver o cabeçalho do `.layout.yaml` gerado). Ver docs/PLANO-LAYOUT-V1.md §6.

import type { VisualCalculado } from '../../../apps/web/src/services/dashboardService.ts';

/** Muitas categorias pedem largura; poucas cabem lado a lado. O limiar é o ponto em que
 *  um gráfico deixa de ser "um punhado de barras" e vira uma série que precisa de espaço. */
export const LIMIAR_LARGO = 24;
export const contaPontos = (v: VisualCalculado): number =>
  ((v.dados as { pontos?: unknown[] } | undefined)?.pontos?.length) ?? 0;

/** Uma tabela de "rótulo + Qtd" tem 2–3 colunas; a de detalhe tem 12+. O piso do lado a
 *  lado é aqui: até 3 colunas cabem numa coluna estreita da grade sem cortar nada. */
export const LIMIAR_ESTREITA = 3;
export const contaColunas = (v: VisualCalculado): number =>
  ((v.dados as { colunas?: unknown[] } | undefined)?.colunas?.length) ?? Infinity;
export const ehTabelaProntaEstreita = (v: VisualCalculado): boolean =>
  v.conteudo === 'tabela' && !v.sobDemanda && !v.erro && contaColunas(v) <= LIMIAR_ESTREITA;

/** Ordem de leitura do relatório: de cima para baixo, da esquerda para a direita. */
export const porPosicao = (a: VisualCalculado, b: VisualCalculado): number => {
  const ay = a.posicao?.y ?? 0, by = b.posicao?.y ?? 0;
  if (Math.abs(ay - by) > 8) return ay - by;
  return (a.posicao?.x ?? 0) - (b.posicao?.x ?? 0);
};
