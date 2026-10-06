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
export function ordenaLinhas<L extends Linha>(linhas: readonly L[], coluna: number | null, desc: boolean): L[] {
  const resultado = [...linhas];
  if (coluna === null) return resultado;
  resultado.sort((a, b) => {
    const vA = a[coluna];
    const vB = b[coluna];
    if (vA === null || vA === undefined) return 1;
    if (vB === null || vB === undefined) return -1;
    if (typeof vA === 'number' && typeof vB === 'number') return desc ? vB - vA : vA - vB;
    if (vA instanceof Date && vB instanceof Date) {
      return desc ? vB.getTime() - vA.getTime() : vA.getTime() - vB.getTime();
    }
    const sA = String(vA).toLowerCase();
    const sB = String(vB).toLowerCase();
    if (sA < sB) return desc ? 1 : -1;
    if (sA > sB) return desc ? -1 : 1;
    return 0;
  });
  return resultado;
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
  colunas.forEach((c, i) => {
    if (!ehMagnitude(c.nome ?? null, c.tipo)) return;
    let maior = 0;
    let menor = Number.POSITIVE_INFINITY;
    for (const linha of linhas) {
      const v = linha[i];
      if (typeof v !== 'number') continue;
      const a = Math.abs(v);
      if (a > maior) maior = a;
      if (a < menor) menor = a;
    }
    if (maior > 0 && menor !== maior) mapa.set(i, maior);
  });
  return mapa;
}

/** O selo de um texto de status (`badge-sim`, `badge-nao`, `badge-alerta`), ou `null`. */
export function seloDeStatus(texto: string): 'badge-sim' | 'badge-nao' | 'badge-alerta' | null {
  if (texto === 'SIM' || texto === 'OK' || texto === 'Concluído' || texto === 'Dentro do SLA') return 'badge-sim';
  if (texto === 'NÃO' || texto === 'Não') return 'badge-nao';
  if (texto === 'Cancelado' || texto === 'Estourado' || texto.includes('Fora do SLA')) return 'badge-alerta';
  return null;
}
