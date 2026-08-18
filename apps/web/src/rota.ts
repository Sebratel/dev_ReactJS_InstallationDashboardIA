// O estado da tela mora na URL do navegador.
//
// **Por que na URL e não num `useState`.** Uma tela de conferência existe para ser
// olhada ao lado do Power BI e depois **mostrada para outra pessoa**. Com o estado só
// na memória, "o número filtrado por Equipe Field Service" não tem endereço: quem
// recebe o link vê a página sem filtro e conclui que o número não bate. Com o estado
// na URL, recarregar não perde a escolha e o link carrega o que a pessoa viu.
//
// O parâmetro `filtro` é **o mesmo** que a API recebe, no mesmo formato — a URL da
// tela e a URL do pedido diferem só no caminho. Isso é o que permite depurar copiando
// um pedaço de uma para a outra.

import { codificaFiltro, decodificaFiltro } from '../../../packages/widget-engine/src/filtro-url.ts';
import type { FiltroDaTela } from './api.ts';

export interface Rota {
  pagina: string | null;
  filtros: FiltroDaTela[];
  /** Filtros que não decodificaram, com o motivo. A tela avisa em vez de calar. */
  invalidos: string[];
}

export function leRota(search: string): Rota {
  const p = new URLSearchParams(search);
  const filtros: FiltroDaTela[] = [];
  const invalidos: string[] = [];

  for (const bruto of p.getAll('filtro')) {
    try {
      // A mesma validação da API, no mesmo módulo. Uma URL editada à mão que a API
      // recusaria é recusada aqui também, antes de virar pedido.
      const spec = decodificaFiltro(bruto);
      const cond = spec.conditions[0];
      if (!cond || cond.op !== 'in') {
        invalidos.push(`filtro '${bruto}': condição '${cond?.op ?? 'nenhuma'}' não é uma seleção.`);
        continue;
      }
      filtros.push({
        tabela: spec.entity!,
        coluna: spec.property!,
        valores: cond.values,
        ...(spec.nivel ? { nivel: spec.nivel } : {}),
      });
    } catch (err) {
      invalidos.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { pagina: p.get('pagina'), filtros, invalidos };
}

/** A query string que representa este estado. Sempre com `?`, ou vazia. */
export function escreveRota(pagina: string, filtros: readonly FiltroDaTela[]): string {
  const p = new URLSearchParams();
  p.set('pagina', pagina);
  for (const f of filtros) {
    // Seleção vazia sai da URL: ela **é** a ausência de filtro. Mantê-la deixaria um
    // parâmetro que a API recusa com 400 preso no link que a pessoa compartilha.
    if (f.valores.length === 0) continue;
    p.append('filtro', codificaFiltro(f));
  }
  return `?${p.toString()}`;
}

/**
 * A identidade de um filtro: tabela, coluna **e nível**.
 *
 * O nível entra na chave porque uma página pode segmentar a mesma coluna em dois
 * níveis — `[DATA INSTALADO].[Ano]` e `[DATA INSTALADO].[Mês]` são dois controles
 * sobre a mesma coluna. Sem ele na chave, marcar um ano apagaria a escolha do mês.
 */
function mesmaChave(f: FiltroDaTela, tabela: string, coluna: string, nivel?: string): boolean {
  return f.tabela === tabela && f.coluna === coluna && (f.nivel ?? null) === (nivel ?? null);
}

/**
 * Troca a seleção de uma coluna, devolvendo a lista nova.
 *
 * Seleção vazia **remove** o filtro em vez de guardar um vazio — é a mesma regra da
 * URL, aplicada onde o estado nasce, para que não exista um estado intermediário que
 * a URL não saiba representar.
 */
export function aplicaSelecao(
  filtros: readonly FiltroDaTela[],
  tabela: string,
  coluna: string,
  valores: FiltroDaTela['valores'],
  nivel?: string,
): FiltroDaTela[] {
  const outros = filtros.filter((f) => !mesmaChave(f, tabela, coluna, nivel));
  return valores.length === 0
    ? outros
    : [...outros, { tabela, coluna, valores, ...(nivel ? { nivel } : {}) }];
}

/** A seleção atual de uma coluna — vazia quando não há filtro nela. */
export function selecaoDe(
  filtros: readonly FiltroDaTela[],
  tabela: string,
  coluna: string,
  nivel?: string,
): FiltroDaTela['valores'] {
  return filtros.find((f) => mesmaChave(f, tabela, coluna, nivel))?.valores ?? [];
}
