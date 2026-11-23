// O que o `KpiCard` precisa ler dos visuais calculados — sem React, e testável sozinho.
//
// O cartão combina até cinco visuais da MESMA página: o dele, o da tendência, o da meta,
// o do calendário e o do ano anterior. Para cada um a pergunta era a mesma, escrita
// quatro vezes à mão ("existe? não deu erro? é do tipo certo? então pega `dados`"), e
// era boa parte da complexidade cognitiva 35 que o SonarJS acusava no componente.

import type { VisualCalculado } from '../../../services/dashboardService.ts';
import { formata, percentualDeRazao, razaoComoPercentual } from '../../../utils/formato.ts';

/** Os tipos que a API devolve em `tipoDoValor`. */
export type TipoDoValor = 'number' | 'string' | 'boolean' | 'date' | null;

/** O conteúdo do visual de um indicador. */
export interface DadosDeKpi {
  nome?: string;
  valor?: unknown;
  tipoDoValor?: TipoDoValor;
  /** A medida tem `%` no formato do catálogo, e `casas` são as decimais dele. */
  percentual?: true;
  casas?: number;
  origem?: {
    kind: string;
    measure?: string;
    table?: string;
    column?: string;
    aggregation?: string;
  };
  filtros?: string[];
}

/**
 * Os `dados` de um visual auxiliar, quando ele existe, não falhou e é do tipo esperado.
 *
 * `undefined` em qualquer outro caso — inclusive o visual que ainda não chegou (fora do
 * corte eager). O cartão então desenha exatamente como desenharia sem ele.
 */
export function dadosDoVisual<T>(
  visual: VisualCalculado | undefined,
  conteudoEsperado: VisualCalculado['conteudo'],
): T | undefined {
  if (!visual || visual.erro || visual.conteudo !== conteudoEsperado) return undefined;
  return visual.dados as T | undefined;
}

/** O valor de um conteúdo de cartão, só quando ele é número de verdade. */
export function valorNumerico(
  dados: { valor?: unknown; tipoDoValor?: TipoDoValor | string | null } | undefined,
): number | undefined {
  if (dados?.tipoDoValor !== 'number') return undefined;
  return typeof dados.valor === 'number' ? dados.valor : undefined;
}

/**
 * O indicador é uma porcentagem?
 *
 * Quem decide é o `format` da medida, que a API manda em `percentual`/`casas` desde
 * 16/11/2026 (QA D-12). Até então a tela decidia pelo RÓTULO, e `MÉDIA GERAL` — que é
 * `REINCIDÊNCIA[Porcentagem]`, formato `0.00%` — saía como `0,064`: o nome dela não tem
 * `%` nenhum. O rótulo fica como reserva, para resposta de API mais velha que a tela
 * (`percentual` ausente).
 */
export function ehPercentual(dados: DadosDeKpi, nomeEmMaiusculas: string): boolean {
  const peloFormato = dados.percentual === true;
  return (peloFormato || nomeEmMaiusculas.includes('%')) && dados.tipoDoValor === 'number';
}

/**
 * A porcentagem escrita do jeito do cartão.
 *
 * A medida devolve RAZÃO (0,064) e o Power BI mostra "6,40%". Com o formato na mão não
 * há palpite de escala: `razaoComoPercentual` sempre multiplica por 100, e as casas são
 * as que o formato pede. Sem ele, vale a heurística antiga de `percentualDeRazao`.
 */
export function comoPercentual(valor: unknown, dados: DadosDeKpi): string {
  return dados.percentual === true
    ? razaoComoPercentual(valor, dados.casas)
    : percentualDeRazao(valor);
}

/** O que o cartão mostra em destaque: o valor formatado, e se ele veio vazio. */
export function textoDoValorPrincipal(
  dados: DadosDeKpi,
  percentual: boolean,
): { texto: string; vazio: boolean } {
  // `casas` sem `percentual` são as do número comum; com ele, quem escreve é
  // `comoPercentual`.
  const formatado = formata(dados.valor, dados.tipoDoValor ?? null, {
    casas: dados.percentual ? null : (dados.casas ?? null),
  });
  if (formatado.vazio) return { texto: '—', vazio: true };
  return {
    texto: percentual ? comoPercentual(dados.valor, dados) : formatado.texto,
    vazio: false,
  };
}

/** De onde veio o número — a medida, ou a coluna com a agregação dela. */
export function origemDoKpi(dados: DadosDeKpi): string | null {
  if (dados.origem?.measure) return dados.origem.measure;
  if (!dados.origem?.column) return null;
  return `${dados.origem.aggregation ?? ''} ${dados.origem.column}`.trim();
}
