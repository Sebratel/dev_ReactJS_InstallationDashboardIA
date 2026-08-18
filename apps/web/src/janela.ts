// A janela de linhas de uma tabela ou matriz.
//
// **Por que existe.** A resposta manda uma fatia e diz o total: as duas tabelas de
// `protocolos-detalhados` somam 32.462 linhas e 23,8 MB. Até aqui a tela mostrava a
// primeira janela e parava — o total aparecia no rótulo, e não havia como chegar na
// linha 300. "200 de 32.462" com o resto inalcançável é pior que uma tabela pequena:
// diz que o dado existe e não entrega.
//
// Sem JSX, para caber em `npm test`. O pedido e o desenho ficam em `usaJanela.ts` e
// `Paginacao.tsx`; aqui só a aritmética, que é onde mora o erro de um a mais.

/** Quantas linhas por janela. É o `LINHAS_PADRAO` da API — mudar aqui não muda lá. */
export const LINHAS_POR_JANELA = 200;

export interface Janela {
  /** Índice da primeira linha desta janela, base zero. */
  de: number;
  /** Quantas linhas vieram — pode ser menor que o pedido, na última janela. */
  mostradas: number;
  /** Quantas linhas a consulta tem no total, antes do corte. */
  total: number;
}

export function podeVoltar(j: Janela): boolean {
  return j.de > 0;
}

/**
 * Há janela adiante?
 *
 * `de + mostradas < total`, e não `de + LINHAS_POR_JANELA < total`: numa última janela
 * curta as duas contas divergem, e a segunda ofereceria um "próxima" que devolve zero
 * linhas.
 */
export function podeAvancar(j: Janela): boolean {
  return j.de + j.mostradas < j.total;
}

export function proximoDe(j: Janela): number {
  return podeAvancar(j) ? j.de + j.mostradas : j.de;
}

export function anteriorDe(j: Janela): number {
  return Math.max(0, j.de - LINHAS_POR_JANELA);
}

/**
 * O rótulo da janela, em base 1 — que é como uma pessoa conta linha.
 *
 * Tabela que cabe inteira não ganha intervalo: "43 linhas" é mais claro que
 * "1–43 de 43".
 */
export function rotuloDaJanela(j: Janela, formataInteiro: (n: number) => string): string {
  if (j.total === 0) return 'nenhuma linha';
  if (j.mostradas >= j.total) return `${formataInteiro(j.total)} linhas`;
  const primeira = j.de + 1;
  const ultima = j.de + j.mostradas;
  return `${formataInteiro(primeira)}–${formataInteiro(ultima)} de ${formataInteiro(j.total)} linhas`;
}
