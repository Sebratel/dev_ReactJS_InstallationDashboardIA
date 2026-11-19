// ONDE O NÚMERO DE UM GRÁFICO É ESCRITO — a regra, sem DOM, para ficar sob `npm test`.
//
// Saiu de `components/visuais/Grafico.tsx` em 19/11/2026 pelo mesmo motivo que
// `graficoEixo.ts` saiu de lá na fase 4 (`docs/PLANO-PADROES-FRONTEND.md`): um rótulo que
// não aparece não quebra nada — a tela desenha, os testes passam, e só quem olha percebe
// que o gráfico ficou mudo. Era exatamente o estado anterior desta regra.
//
// **O que estava errado.** A condição era uma só:
//
// ```ts
// !percentual && areas.length > 0 && (areas.length === 1 || empilha)
// ```
//
// e ela fechava TRÊS casos de uma vez, sem dizer que fechava:
//
// 1. gráfico só de LINHA (`areas.length === 0`) — PROTOCOLOS REALIZADOS, PROTOCOLOS
//    GERADOS, o prazo do RELATÓRIO DO ANO;
// 2. coluna AGRUPADA com 2+ séries (`!empilha && areas.length > 1`) — BACKLOG, o
//    instalado por mês do RELATÓRIO DO ANO;
// 3. 100% empilhado (`percentual`) — TAXAS DE PRODUTIVIDADE, da AGENDAMENTO FIELD.
//
// Nos três, o número só existia no `title` do SVG. Os gestores tiram print do gráfico e
// mandam no grupo: print não tem `title`, e acertar o mouse na marca certa foi o que o
// Erick reclamou ser difícil. Cada forma precisa de um LUGAR diferente para o número, não
// de uma permissão única.

/**
 * Acima de tantas categorias o número vira ruído e a leitura fica com o `title` (COM).
 *
 * **31, e não 24 (19/11/2026).** 24 cortava o eixo mais comum desta operação: o MÊS. O
 * PROTOCOLOS REALIZADOS tem 30 colunas — uma por dia — e saía sem um número sequer,
 * embora a banda dele comportasse o chip com folga. O teto de verdade é físico e já
 * existe marca a marca em `ColunasDoGrafico` (o chip cabe na banda? e, se não couber, o
 * número sem chip cabe?); este aqui é só a guarda de ruído, e ela não tinha por que
 * cortar um mês fechado.
 */
export const MAXIMO_COM_ROTULO = 31;

/**
 * - `categoria` — um chip acima da coluna: série única, ou o TOTAL de uma pilha.
 * - `fatia` — o número acima de CADA fatia: coluna agrupada, em que um total somado não é
 *   número de ninguém. Sem chip, porque em ~25px de fatia o chip não cabe e o texto cabe.
 * - `dentro` — o número DENTRO da fatia: pilha percentual, cujo total é sempre 100% e o
 *   que interessa é a parte. Não gasta margem acima do plot.
 * - `nenhum` — categorias demais, ou nenhuma série de área (aí quem rotula é a linha).
 */
export type ModoDeRotulo = 'nenhum' | 'categoria' | 'fatia' | 'dentro';

export interface FormaDoGrafico {
  /** Quantas séries são desenhadas como ÁREA (coluna), na janela visível. */
  nAreas: number;
  /** Quantas séries são desenhadas como LINHA. */
  nLinhas: number;
  empilha: boolean;
  percentual: boolean;
  /** Categorias VISÍVEIS (a janela do paginador), não o total da série. */
  nCategorias: number;
  /** As linhas foram para um painel próprio embaixo, com escala própria. */
  naFaceta: boolean;
}

/** Cabem números nesta janela? Acima do teto, nenhum modo liga. */
function cabem(f: FormaDoGrafico): boolean {
  return f.nCategorias > 0 && f.nCategorias <= MAXIMO_COM_ROTULO;
}

/** Onde escrever o número das COLUNAS. */
export function modoDeRotulo(f: FormaDoGrafico): ModoDeRotulo {
  if (!cabem(f) || f.nAreas === 0) return 'nenhum';
  if (f.percentual) return 'dentro';
  if (f.nAreas === 1 || f.empilha) return 'categoria';
  return 'fatia';
}

/**
 * Rotular TODO ponto da linha, em vez de só o maior de cada série.
 *
 * Só com UMA linha e sem coluna embaixo. Duas linhas rotuladas ponto a ponto se cruzam e o
 * número deixa de ter dono; com colunas embaixo, os dois conjuntos de número disputam o
 * mesmo espaço vertical. Na faceta a linha tem painel próprio e escala própria — o rótulo
 * de pico ali continua sendo a leitura certa.
 */
export function rotulaTodosOsPontos(f: FormaDoGrafico): boolean {
  return cabem(f) && !f.naFaceta && f.nAreas === 0 && f.nLinhas === 1;
}

/**
 * A margem de cima do plot precisa crescer para o número caber?
 *
 * Só para quem escreve ACIMA da marca. `dentro` escreve na fatia e não cobra nada — e
 * cobrar à toa tira altura do desenho numa tela em que a altura é o recurso escasso.
 */
export function precisaDeMargemParaRotulo(f: FormaDoGrafico): boolean {
  const modo = modoDeRotulo(f);
  return modo === 'categoria' || modo === 'fatia' || rotulaTodosOsPontos(f);
}
