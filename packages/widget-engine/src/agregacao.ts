// Como o PBIP nomeia uma agregação, e qual função DAX a calcula.
//
// Módulo próprio, e não dentro de `card.ts`, por uma razão concreta: `filtro.ts`
// precisa do mesmo mapa para o filtro sobre valor agregado (`COUNT(x) > 0`), e
// `card.ts` já importa `filtro.ts`. Duas cópias divergiriam exatamente no dia em
// que a PERGUNTAS-NEGOCIO #6 for respondida — que é o dia em que a linha do `count`
// muda.

/**
 * Agregação do PBIP → função DAX.
 *
 * `count` (`Function: 2`) é o único item **em aberto**, e está isolado aqui de
 * propósito: a evidência de dentro do relatório aponta para contagem distinta (o card
 * que alguém batizou de `CLIENTES DISTINTOS` é `Function: 2`), e o tamanho da dúvida
 * foi medido — 8 das 10 cartas `count` estão sobre colunas 100% distintas, onde as
 * duas leituras dão o mesmo número, sobrando 2 de 64 cards. A confirmação de cinco
 * segundos está em docs/PERGUNTAS-NEGOCIO.md #6. Se a resposta for "não distinto",
 * muda-se **esta linha** — e ela vale para os cards, para as células de tabela e para
 * os 10 filtros sobre agregado de uma vez.
 */
export const FUNCAO_DA_AGREGACAO: Record<string, string> = {
  sum: 'SUM',
  avg: 'AVERAGE',
  count: 'DISTINCTCOUNT',
  min: 'MIN',
  max: 'MAX',
  count_non_null: 'COUNTA',
};
