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

/**
 * Quantas linhas a TELA mostra por vez — e por que não são as 200 da busca.
 *
 * São duas janelas empilhadas de propósito, com trabalhos diferentes:
 *
 *   LINHAS_POR_JANELA (200)  o que o servidor MANDA por requisição
 *   LINHAS_VISIVEIS   (20)   o que a tela DESENHA por vez
 *
 * Até 26/08/2026 só existia a primeira: a tela desenhava as 200 de uma vez. Na
 * ANÁLISE DETALHADA do AGENDAMENTO FIELD isso são seis tabelas lado a lado com 200
 * linhas cada — a seção descia centenas de linhas e a página virava um rolo, que foi
 * exatamente a reclamação ("está usando muito da página").
 *
 * A janela de 20 é do CLIENTE: virar página dentro das 200 já carregadas é instantâneo
 * e não custa requisição. Só a cada 10 páginas se busca a próxima fatia no servidor.
 * Ou seja, a tela ficou 10x mais curta E fez menos pedidos, não mais.
 */
export const LINHAS_VISIVEIS = 20;

/**
 * Onde começa a janela de servidor que contém a linha global `linha`.
 *
 * Alinhar em múltiplos de `LINHAS_POR_JANELA` é o que mantém o cache de
 * `usaJanela` útil: ele guarda por `de`, então pedir 200, 400, 600 reaproveita,
 * enquanto pedir 20, 40, 60 criaria uma entrada nova a cada clique.
 */
export function janelaDeServidorPara(linha: number): number {
  if (linha <= 0) return 0;
  return Math.floor(linha / LINHAS_POR_JANELA) * LINHAS_POR_JANELA;
}

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

/**
 * O `de` da janela anterior.
 *
 * `passo` existe porque agora há duas janelas (ver `LINHAS_VISIVEIS`): a tabela anda
 * de 20 em 20 e a matriz continua andando de 200 em 200. Voltar por `j.mostradas`
 * seria tentador e errado — numa última janela curta (3 linhas) ele voltaria 3.
 */
export function anteriorDe(j: Janela, passo: number = LINHAS_POR_JANELA): number {
  return Math.max(0, j.de - passo);
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
