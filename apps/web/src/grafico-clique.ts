// O clique num eixo categórico: que colunas ele filtra, e o que já está selecionado.
//
// Extraído de `Grafico.tsx` (Fase L6, §8): `RankingBarra.tsx` precisa da MESMA regra de
// clique sobre o MESMO formato de chave (`d.chaves`, papel `Category`) — duplicar
// divergiria no primeiro ajuste feito só de um lado, mesmo raciocínio de `magnitude.ts`
// para a barra de dados compartilhada entre `Tabela.tsx` e `Matriz.tsx`.

import type { FiltroDaTela, Valor } from './api.ts';
import { selecaoDe, type AlvoDeFiltro } from './rota.ts';

export interface ChaveDoGrafico {
  papel?: string;
  tabela?: string;
  coluna?: string;
  nivel?: string | null;
  nome?: string;
}

/** As chaves de EIXO (papel `Category`, ou sem papel — o padrão é eixo). */
export function chavesDeEixoDe(chaves: readonly ChaveDoGrafico[]): ChaveDoGrafico[] {
  return chaves.filter((c) => (c.papel ?? 'Category') === 'Category');
}

/**
 * O alvo de um clique nesta categoria: um par (tabela, coluna, nível?, valor) por
 * chave de eixo. Valor nulo sai da lista — `(vazio)` não é valor de banco, e filtrar
 * por ele devolveria tela vazia (ver `AlvoDeFiltro` em `rota.ts`).
 */
export function alvosDaCategoria(
  chavesDeEixo: readonly ChaveDoGrafico[],
  valores: readonly Valor[],
): AlvoDeFiltro[] {
  return chavesDeEixo
    .map((c, k) => ({
      tabela: c.tabela ?? '',
      coluna: c.coluna ?? '',
      ...(c.nivel ? { nivel: c.nivel } : {}),
      valor: valores[k] ?? null,
    }))
    .filter((a) => a.tabela !== '' && a.coluna !== '' && a.valor !== null);
}

/** A seleção atual de cada nível do eixo — `null` no nível sem filtro nenhum. */
export function selecaoDoEixoDe(
  chavesDeEixo: readonly ChaveDoGrafico[],
  filtros: readonly FiltroDaTela[] | undefined,
): (readonly Valor[])[] | (readonly Valor[] | null)[] {
  return chavesDeEixo.map((c) => {
    if (!filtros || !c.tabela || !c.coluna) return null;
    const sel = selecaoDe(filtros, c.tabela, c.coluna, c.nivel ?? undefined);
    return sel.length > 0 ? sel : null;
  });
}

/** Esta categoria bate com a seleção corrente em TODOS os níveis que têm filtro? */
export function estaSelecionadaCategoria(
  selecaoDoEixo: readonly (readonly Valor[] | null)[],
  valores: readonly Valor[],
): boolean {
  return selecaoDoEixo.every((sel, k) => sel === null || sel.some((v) => Object.is(v, valores[k] ?? null)));
}
