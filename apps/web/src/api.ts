// O contrato da API de leitura, do lado do navegador.
//
// **O codec de filtro é importado, não reescrito.** `codificaFiltro` vem de
// `packages/widget-engine/src/filtro-url.ts` — o mesmo módulo que a API usa para
// decodificar. Duas implementações do mesmo formato divergem no primeiro caso
// esquisito (o valor com aspas, o número que virou texto), e a divergência aparece
// como número errado, não como erro de compilação. Uma só, nas duas pontas.
//
// **Nenhuma função aqui escreve.** Todo pedido é `GET`; a API devolve 405 para
// qualquer outro método. É a quarta camada da regra de somente-leitura, e a única
// que o navegador enxerga.

import { codificaFiltro } from '../../../packages/widget-engine/src/filtro-url.ts';
import type { TipoDeValor } from './formato.ts';
// Tipo só — `tools/layout` é consumido aqui só pelo formato do contrato, sem custo de
// bundle (é `import type`, o esbuild apaga por completo). Ver docs/PLANO-LAYOUT-V1.md §6.
import type { ColunaDeFaixa, Faixa, KpiEntry, LayoutSpec } from '../../../tools/layout/src/schema.ts';

export type { TipoDeValor, ColunaDeFaixa, Faixa, KpiEntry, LayoutSpec };

/** Um valor de célula já serializado — data vira ISO, BLANK vira `null`. */
export type Valor = string | number | boolean | null;

export interface DashboardDaLista {
  id: string;
  nome: string;
  visuais: number;
  /** Falso quando falta snapshot: a página não vai abrir, e a lista diz antes do clique. */
  pronta: boolean;
}

export interface Segmentacao {
  tabela: string;
  coluna: string;
  rotulo: string;
  /** Nível da hierarquia de datas, quando a segmentação é de `[Data].[Ano]`. */
  nivel?: string;
  /** Presente quando esta segmentação não sabe filtrar. A tela desabilita e explica. */
  naoFiltra?: string;
}

export interface OrigemDeCard {
  kind: 'measure' | 'aggregation';
  measure?: string;
  table?: string;
  column?: string;
  aggregation?: string;
}

export interface DadosDeCard {
  nome: string | null;
  valor: Valor;
  tipoDoValor: TipoDeValor;
  origem: OrigemDeCard;
  filtros: string[];
}

export interface DadosDeTabela {
  colunas: { nome: string | null; tipo: TipoDeValor; chave: boolean }[];
  linhas: Valor[][];
  linhasTotais: number;
  de: number;
  filtros: string[];
}

export interface DadosDeMatriz {
  chavesDeLinha: { nome: string | null; coluna: string }[];
  chavesDeColuna: { nome: string | null; coluna: string }[];
  medidas: (string | null)[];
  linhas: Valor[][];
  colunas: Valor[][];
  tiposDeLinha: TipoDeValor[];
  tiposDeColuna: TipoDeValor[];
  tiposDeMedida: TipoDeValor[];
  celulas: Valor[][][];
  linhasTotais: number;
  de: number;
  descartadas: { linhas: number; colunas: number };
  filtros: string[];
}

export interface DadosDeGrafico {
  tipo: string;
  chaves: unknown[];
  series: { nome: string | null; papel?: string }[];
  tiposDeSerie: TipoDeValor[];
  tiposDeChave: TipoDeValor[];
  pontos: { categoria: Valor[]; valores: Valor[] }[];
  filtros: string[];
}

export interface VisualCalculado {
  id: string;
  tipo: string;
  posicao: { x: number; y: number; width: number; height: number };
  conteudo: 'card' | 'tabela' | 'grafico' | 'matriz' | null;
  semCalculo?: string;
  sobDemanda?: string[];
  segmentacao?: Segmentacao;
  erro?: string;
  dados?: unknown;
  ms: number;
}

export interface PaginaCalculada {
  id: string;
  nome: string;
  tamanho: { width: number; height: number };
  dadoDe: string | null;
  visuais: VisualCalculado[];
  resumo: { calculados: number; falharam: number; semCalculo: number };
  ms: number;
  omitidas?: string[];
  filtrosDaTela?: { tabela: string; coluna: string; valores: Valor[] }[];
  tabelas: { nome: string; linhas: number }[];
}

export interface ValoresDeColuna {
  tabela: string;
  coluna: string;
  valores: { valor: Valor; tipo: TipoDeValor }[];
  total: number;
  /** A lista foi truncada. Dizer isso evita a conclusão de que o valor não existe. */
  cortado: boolean;
}

/** A escolha feita numa segmentação: a coluna, e os valores marcados. */
export interface FiltroDaTela {
  tabela: string;
  coluna: string;
  valores: Valor[];
  /** O nível, quando a segmentação é de hierarquia de datas. Vem da API intacto. */
  nivel?: string;
}

/**
 * A URL de uma página, com filtros e visual opcionais.
 *
 * Separada do `fetch` para ser testável: é aqui que mora a regra de que **filtro sem
 * valor marcado não vira parâmetro**. Mandá-lo vazio faria a API responder 400 —
 * correto do lado dela, e uma tela quebrada do lado de cá em toda desmarcação.
 */
export function urlDaPagina(
  id: string,
  filtros: readonly FiltroDaTela[] = [],
  opcoes: { visual?: string; linhas?: number; de?: number } = {},
  clicados: readonly { tabela: string; coluna: string }[] = [],
): string {
  const p = new URLSearchParams();
  for (const f of filtros) {
    if (f.valores.length === 0) continue;
    p.append(
      'filtro',
      codificaFiltro({ tabela: f.tabela, coluna: f.coluna, valores: f.valores, nivel: f.nivel }),
    );
  }
  // Quais colunas nasceram de clique. É o que permite ao servidor auto-excluir o
  // filtro do visual que desenha aquela coluna, sem fazer o mesmo com o seletor —
  // ver `CampoClicado` em `rota.ts`.
  for (const c of clicados) {
    p.append('clicado', JSON.stringify({ tabela: c.tabela, coluna: c.coluna }));
  }
  if (opcoes.visual) p.set('visual', opcoes.visual);
  if (opcoes.linhas) p.set('linhas', String(opcoes.linhas));
  // `de=0` é o padrão da API e não precisa viajar; mandá-lo sujaria toda URL de
  // primeira janela. Só a partir da segunda o parâmetro diz alguma coisa.
  if (opcoes.de) p.set('de', String(opcoes.de));
  const q = p.toString();
  return `/api/dashboards/${encodeURIComponent(id)}${q ? `?${q}` : ''}`;
}

export function urlDeValores(
  id: string,
  tabela: string,
  coluna: string,
  nivel?: string,
): string {
  const p = new URLSearchParams({ tabela, coluna });
  if (nivel) p.set('nivel', nivel);
  return `/api/dashboards/${encodeURIComponent(id)}/valores?${p.toString()}`;
}

/**
 * `GET` que erra alto.
 *
 * A API põe a explicação inteira em `erro`, e as mensagens dela dizem o que fazer
 * (o comando do snapshot que falta, o formato do filtro que não decodificou). Trocar
 * isso por "HTTP 409" jogaria fora justamente a parte útil.
 */
export async function pega<T>(url: string, signal?: AbortSignal): Promise<T> {
  const resp = await fetch(url, signal ? { signal } : undefined);
  const corpo: unknown = await resp.json().catch(() => null);
  if (!resp.ok) {
    const erro =
      corpo && typeof corpo === 'object' && 'erro' in corpo
        ? String((corpo as { erro: unknown }).erro)
        : `HTTP ${resp.status} em ${url}`;
    throw new Error(erro);
  }
  return corpo as T;
}

export const listaDashboards = (): Promise<{ dashboards: DashboardDaLista[] }> =>
  pega('/api/dashboards');

/**
 * O `signal` existe para o pedido ANTERIOR morrer quando chega um novo.
 *
 * Filtragem cruzada é clique em rajada: a pessoa clica em quatro categorias seguidas
 * e, sem cancelamento, as quatro requisições vão até o fim. A penúltima resposta pode
 * chegar DEPOIS da última — e aí a tela pinta o recorte anterior enquanto a barra de
 * filtros mostra o novo. É o pior tipo de erro de dashboard: número plausível, causa
 * invisível, e some ao recarregar.
 *
 * A flag `cancelado` do chamador impedia o `setState` tardio, mas não impedia o
 * trabalho: a API seguia calculando a página inteira para uma resposta que ninguém
 * ia usar.
 */
export const pegaPagina = (
  id: string,
  filtros: readonly FiltroDaTela[],
  opcoes?: { visual?: string; de?: number; linhas?: number },
  signal?: AbortSignal,
  clicados?: readonly { tabela: string; coluna: string }[],
): Promise<PaginaCalculada> => pega(urlDaPagina(id, filtros, opcoes, clicados), signal);

/** A forma declarada da página (`specs/layout/<id>.layout.yaml`) — não depende de
 *  filtro nem de clique, só de qual página está aberta. Ver Fase L4. */
export const pegaLayout = (id: string, signal?: AbortSignal): Promise<LayoutSpec> =>
  pega(`/api/dashboards/${encodeURIComponent(id)}/layout`, signal);

export const pegaValores = (
  id: string,
  tabela: string,
  coluna: string,
  nivel?: string,
): Promise<ValoresDeColuna> => pega(urlDeValores(id, tabela, coluna, nivel));
