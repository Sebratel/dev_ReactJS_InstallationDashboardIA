// O contrato da API de leitura, do lado do navegador.
//
// **O codec de filtro é importado, não reescrito.** `codificaFiltro` vem de
// `backend/packages/widget-engine/src/filtro-url.ts` — o mesmo módulo que a API usa para
// decodificar. Duas implementações do mesmo formato divergem no primeiro caso
// esquisito (o valor com aspas, o número que virou texto), e a divergência aparece
// como número errado, não como erro de compilação. Uma só, nas duas pontas.
//
// **Nenhuma função aqui escreve.** Todo pedido é `GET`; a API devolve 405 para
// qualquer outro método. É a quarta camada da regra de somente-leitura, e a única
// que o navegador enxerga.

import { codificaFiltro } from '../../../backend/packages/widget-engine/src/filtro-url.ts';
import type { TipoDeValor } from '../utils/formato.ts';
import type { RespostaSaude } from '../utils/avisoSaude.ts';
// Tipo só — `backend/tools/layout` é consumido aqui só pelo formato do contrato, sem custo de
// bundle (é `import type`, o esbuild apaga por completo). Ver docs/PLANO-LAYOUT-V1.md §6.
import type { ColunaDeFaixa, Faixa, KpiEntry, LayoutSpec } from '../../../backend/tools/layout/src/schema.ts';

export type { TipoDeValor, ColunaDeFaixa, Faixa, KpiEntry, LayoutSpec, RespostaSaude };

/** Um valor de célula já serializado — data vira ISO, BLANK vira `null`. */
export type Valor = string | number | boolean | null;

export interface DashboardDaLista {
  id: string;
  nome: string;
  visuais: number;
  /** Falso quando falta snapshot: a página não vai abrir, e a lista diz antes do clique. */
  pronta: boolean;
  /**
   * Página de DICA do relatório original (`type: Tooltip`), não página navegável.
   * São três — `l-inst`, `l-mapa`, `l-tec` — e a navegação as descarta.
   * Opcional porque uma API anterior a 18/09/2026 não manda o campo.
   */
  tooltip?: boolean;
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
  colunas: {
    nome: string | null;
    tipo: TipoDeValor;
    chave: boolean;
    /** A entidade e a propriedade de origem da coluna — o alvo de um clique na linha. */
    tabela: string | null;
    coluna: string | null;
  }[];
  linhas: Valor[][];
  /** Quantas linhas a consulta tem — **já com a busca aplicada**, quando há uma. */
  linhasTotais: number;
  /**
   * Quantas linhas havia antes da busca. Só vem quando `?busca=` foi mandado.
   *
   * Existe para a tela poder dizer "3 de 95.157" em vez de só "3 linhas": sem o
   * denominador, uma busca que não casa com quase nada parece uma tabela que
   * encolheu, e não há como distinguir "achei pouco" de "o filtro da página cortou".
   */
  totalSemBusca?: number;
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
  /** O título do relatório (`VISÃO PRODUTIVA`); sem ele, `rotulos.ts` deriva um. */
  titulo?: string;
  conteudo: 'card' | 'tabela' | 'grafico' | 'matriz' | null;
  semCalculo?: string;
  sobDemanda?: string[];
  segmentacao?: Segmentacao;
  erro?: string;
  /** Ressalva de leitura vinda da API — hoje, só o horizonte de previsão. */
  nota?: string;
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
  nivel?: string | null;
}

/**
 * O que se pode pedir de uma página além dos filtros.
 *
 * **Um tipo só, usado por `urlDaPagina` E por `pegaPagina`.** Eram dois objetos
 * literais escritos à mão, e campo novo num deles não erra no outro — só é descartado
 * em silêncio a caminho da URL. Foi exatamente o que aconteceu ao acrescentar `busca`:
 * a tela mandaria o termo, `pegaPagina` o recusaria por tipo, e se não recusasse, a
 * busca simplesmente não filtraria nada.
 */
export interface OpcoesDePagina {
  /** `visual` (um) é o pedido sob demanda de sempre. */
  visual?: string;
  /**
   * `visuais` (vários — Fase L5, R4) é a abertura pedindo só o que está acima da
   * dobra. Os dois viram o MESMO `?visual=` repetido na URL; a API não distingue de
   * onde veio.
   */
  visuais?: readonly string[];
  de?: number;
  linhas?: number;
  /** O campo "Filtrar…" da tabela. Ver `?busca=` em `backend/api/src/servidor.ts`. */
  busca?: string;
  /** Força recálculo no servidor ignorando o cache de resposta (Fase 4, ?recalcula=1). */
  recalcula?: boolean;
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
  opcoes: OpcoesDePagina = {},
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
  if (opcoes.visual) p.append('visual', opcoes.visual);
  for (const v of opcoes.visuais ?? []) p.append('visual', v);
  if (opcoes.linhas) p.set('linhas', String(opcoes.linhas));
  // `de=0` é o padrão da API e não precisa viajar; mandá-lo sujaria toda URL de
  // primeira janela. Só a partir da segunda o parâmetro diz alguma coisa.
  if (opcoes.de) p.set('de', String(opcoes.de));
  // Busca vazia também não viaja, e pela mesma razão mais uma: esta URL É a chave do
  // cache da tela (`paginasVistas`) e entra na chave do servidor. `?busca=` vazio
  // daria uma segunda chave para o mesmo pedido, e a abertura sem busca deixaria de
  // reaproveitar o que o aquecedor já calculou.
  if (opcoes.busca) p.set('busca', opcoes.busca);
  if (opcoes.recalcula) p.set('recalcula', '1');
  const q = p.toString();
  return `/api/dashboards/${encodeURIComponent(id)}${q ? `?${q}` : ''}`;
}

/**
 * O teto de valores que a tela pede.
 *
 * **Ela não pedia nenhum, e o padrão da API é 500.** Para a árvore de período
 * isso era fatal: ela monta Ano > Mês > Dia a partir das datas CRUAS (pedir
 * nível por nível ofereceria mês que aquele ano não tem), e 500 de 713 datas
 * faziam a árvore terminar em junho/2026 enquanto a página abre filtrada em
 * agosto. Medido em 08/09/2026.
 *
 * 5000 é o máximo que a rota aceita (`VALORES_MAXIMO`). Não resolve coluna de
 * cardinalidade alta — `CLIENTE` tem 72.521 valores distintos e `N°PROTOCOLO`
 * 93.601 —, e essas precisam de busca no seletor, não de teto maior.
 */
export const TETO_DE_VALORES = 5000;

export function urlDeValores(
  id: string,
  tabela: string,
  coluna: string,
  nivel?: string,
): string {
  const p = new URLSearchParams({ tabela, coluna });
  if (nivel) p.set('nivel', nivel);
  p.set('teto', String(TETO_DE_VALORES));
  return `/api/dashboards/${encodeURIComponent(id)}/valores?${p.toString()}`;
}

/**
 * Um pedido cancelado não é uma falha — é o pedido seguinte fazendo o trabalho certo.
 * Compartilhada entre `App.tsx` e `useVisualSobDemanda.ts` para as duas checagens
 * nunca divergirem (a mesma razão de `codificaFiltro` ser importado, não reescrito).
 */
export const ehAbortError = (err: unknown): boolean =>
  err instanceof DOMException && err.name === 'AbortError';

/**
 * Teto de um `GET`. Sem ele, uma API viva mas travada deixava a tela em "carregando"
 * para sempre — e é justo o caso que o `restart` do Docker não cobre.
 */
export const TETO_PEDIDO_MS = 90_000;

/**
 * Esperas entre tentativas quando a API está fora do ar POR INSTANTES: rede caída, ou
 * 502/503/504 do proxy enquanto ela reinicia. Somam ~10 s — o reinício medido em
 * 25/09/2026 levou ~8 s (ACHADOS #153). Sem isto, um clique durante o reinício virava
 * erro na tela e a pessoa tinha de clicar de novo.
 */
export const ESPERAS_DE_NOVA_TENTATIVA_MS: readonly number[] = [1_000, 3_000, 6_000];

/** O que o proxy responde quando a API não está lá — o único HTTP que vale repetir. Um
 *  500 é a API dizendo o que deu errado, e repetir só repetiria a mensagem. */
const FORA_DO_AR = new Set([502, 503, 504]);

/** Injetável no teste; em produção, o `fetch` e o relógio de verdade. */
export interface DependenciasDePedido {
  fetch?: typeof fetch;
  dorme?: (ms: number, signal?: AbortSignal) => Promise<void>;
  tetoMs?: number;
  esperasMs?: readonly number[];
}

function dormeAbortavel(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((ok, falha) => {
    if (signal?.aborted) return falha(signal.reason);
    const aoAbortar = (): void => {
      clearTimeout(t);
      falha(signal!.reason);
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', aoAbortar);
      ok();
    }, ms);
    signal?.addEventListener('abort', aoAbortar, { once: true });
  });
}

/**
 * `GET` que erra alto — e que aguenta a API sumir por alguns segundos.
 *
 * A API põe a explicação inteira em `erro`, e as mensagens dela dizem o que fazer
 * (o comando do snapshot que falta, o formato do filtro que não decodificou). Trocar
 * isso por "HTTP 409" jogaria fora justamente a parte útil.
 *
 * **Cancelar não é errar.** Se quem chamou abortou, o `AbortError` sai intacto (é o que
 * `ehAbortError` reconhece e a tela ignora). O teto de tempo, ao contrário, vira erro
 * comum: sumir em silêncio seria pior que o "carregando" eterno que ele substitui.
 */
export async function pega<T>(url: string, signal?: AbortSignal, deps: DependenciasDePedido = {}): Promise<T> {
  const buscar = deps.fetch ?? fetch;
  const dorme = deps.dorme ?? dormeAbortavel;
  const esperas = deps.esperasMs ?? ESPERAS_DE_NOVA_TENTATIVA_MS;
  const tetoMs = deps.tetoMs ?? TETO_PEDIDO_MS;

  let resp: Response;
  for (let tentativa = 0; ; tentativa++) {
    const espera = esperas[tentativa];
    const teto = AbortSignal.timeout(tetoMs);
    const sinal = signal ? AbortSignal.any([signal, teto]) : teto;
    try {
      resp = await buscar(url, { signal: sinal });
    } catch (err) {
      if (signal?.aborted) throw err;
      if (teto.aborted) {
        throw new Error(`A API não respondeu em ${Math.round(tetoMs / 1000)} s (${url}).`, { cause: err });
      }
      if (espera !== undefined) {
        await dorme(espera, signal);
        continue;
      }
      throw new Error(`Sem conexão com a API (${url}) — ela pode estar reiniciando. Tente de novo em instantes.`, {
        cause: err,
      });
    }
    if (FORA_DO_AR.has(resp.status) && espera !== undefined) {
      await dorme(espera, signal);
      continue;
    }
    break;
  }
  const corpo: unknown = await resp.json().catch(() => null);
  if (!resp.ok) {
    const erro =
      corpo && typeof corpo === 'object' && 'erro' in corpo
        ? String((corpo as { erro: unknown }).erro)
        : `HTTP ${resp.status} em ${url}`;
    // `status` vai junto do erro — é como `App.tsx` distingue "sem sessão"
    // (401, mostra a tela de login) de qualquer outra falha (mostra o erro).
    throw Object.assign(new Error(erro), { status: resp.status });
  }
  return corpo as T;
}

/** `true` quando `err` veio de um pedido que a API recusou por falta de sessão
 *  válida — o único caso em que a tela certa é o login, não uma mensagem de
 *  erro. */
export const ehErroDeSessao = (err: unknown): boolean =>
  err instanceof Error && (err as { status?: number }).status === 401;

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
  opcoes?: OpcoesDePagina,
  signal?: AbortSignal,
  clicados?: readonly { tabela: string; coluna: string }[],
): Promise<PaginaCalculada> => pega(urlDaPagina(id, filtros, opcoes, clicados), signal);

/** A forma declarada da página (`backend/specs/layout/<id>.layout.yaml`) — não depende de
 *  filtro nem de clique, só de qual página está aberta. Ver Fase L4. */
export const pegaLayout = (id: string, signal?: AbortSignal): Promise<LayoutSpec> =>
  pega(`/api/dashboards/${encodeURIComponent(id)}/layout`, signal);

export const pegaValores = (
  id: string,
  tabela: string,
  coluna: string,
  nivel?: string,
): Promise<ValoresDeColuna> => pega(urlDeValores(id, tabela, coluna, nivel));

export const pegaSaude = (signal?: AbortSignal): Promise<RespostaSaude> => pega('/api/saude', signal);
