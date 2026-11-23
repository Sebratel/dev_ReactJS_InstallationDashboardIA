// As contas da tabela de detalhe (`components/visuais/Tabela.tsx`), sem DOM: ordenar as
// linhas carregadas, a escala da barra de dados de cada coluna e o selo de status.

import type { TipoDeValor } from '../services/dashboardService.ts';
import { ehMagnitude } from './magnitude.ts';

type Linha = readonly unknown[];

/**
 * Ordena as linhas JÁ CARREGADAS por uma coluna. Vazio vai para o fim nos dois
 * sentidos; número e data comparam como número e data, o resto como texto sem caixa.
 * Devolve um array novo (a ordem do servidor fica intacta).
 */
export function ordenaLinhas<L extends Linha>(
  linhas: readonly L[],
  coluna: number | null,
  desc: boolean,
): L[] {
  const resultado = [...linhas];
  if (coluna === null) return resultado;
  resultado.sort((linhaA, linhaB) => comparaCelulas(linhaA[coluna], linhaB[coluna], desc));
  return resultado;
}

/**
 * Compara duas células da mesma coluna.
 *
 * **Vazio vai sempre para o fim**, nas duas direções: quem ordena por uma coluna quer
 * ver os valores dela, não os buracos. Número e data comparam pelo próprio valor; o
 * resto, como texto sem distinguir maiúscula.
 */
function comparaCelulas(valorA: unknown, valorB: unknown, desc: boolean): number {
  if (valorA === null || valorA === undefined) return 1;
  if (valorB === null || valorB === undefined) return -1;

  if (typeof valorA === 'number' && typeof valorB === 'number') {
    return desc ? valorB - valorA : valorA - valorB;
  }
  if (valorA instanceof Date && valorB instanceof Date) {
    return desc ? valorB.getTime() - valorA.getTime() : valorA.getTime() - valorB.getTime();
  }

  const textoA = String(valorA).toLowerCase();
  const textoB = String(valorB).toLowerCase();
  if (textoA === textoB) return 0;
  const crescente = textoA < textoB ? -1 : 1;
  return desc ? -crescente : crescente;
}

/**
 * O maior valor de cada coluna de magnitude — a escala da barra de dados. Uma escala por
 * coluna é o certo aqui: colunas diferentes medem coisas diferentes.
 *
 * Coluna em que todo valor é igual não ganha barra. A tabela de PROTOCOLO x QTD tem 1 em
 * todas as linhas: a barra saía cheia em todas elas, ocupando metade da largura da coluna
 * para dizer que nada varia. Barra existe para mostrar diferença — sem diferença, é tinta.
 */
export function escalasDaTabela(
  colunas: readonly { nome?: string | null; tipo: TipoDeValor }[],
  linhas: readonly Linha[],
): Map<number, number> {
  const mapa = new Map<number, number>();
  colunas.forEach((coluna, indice) => {
    if (!ehMagnitude(coluna.nome ?? null, coluna.tipo)) return;
    let maior = 0;
    let menor = Number.POSITIVE_INFINITY;
    for (const linha of linhas) {
      const valor = linha[indice];
      if (typeof valor !== 'number') continue;
      const soma = Math.abs(valor);
      if (soma > maior) maior = soma;
      if (soma < menor) menor = soma;
    }
    if (maior > 0 && menor !== maior) mapa.set(indice, maior);
  });
  return mapa;
}

/** O tom do selo de um texto de status (`BadgeDeStatus`), ou `null` quando não é status. */
export function seloDeStatus(texto: string): 'sim' | 'nao' | 'alerta' | null {
  if (texto === 'SIM' || texto === 'OK' || texto === 'Concluído' || texto === 'Dentro do SLA')
    return 'sim';
  if (texto === 'NÃO' || texto === 'Não') return 'nao';
  if (texto === 'Cancelado' || texto === 'Estourado' || texto.includes('Fora do SLA'))
    return 'alerta';
  return null;
}
