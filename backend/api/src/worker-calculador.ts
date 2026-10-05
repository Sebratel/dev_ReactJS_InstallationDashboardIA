// Script executado pelas Worker Threads para cálculo de páginas DAX fora da thread principal.
//
// **O overlay do poller de quase-realtime chega aqui como DADO.** Até 08/09/2026
// ele não chegava de jeito nenhum: `carrega()` era chamado sem `overlay`, e como
// a piscina é o caminho de produção, todo o encadeamento de near-realtime
// (poller detecta → invalida cache → SSE avisa → navegador refaz o GET)
// terminava num recálculo de 10–20 s sobre o MESMO arquivo em disco, devolvendo
// o mesmo número. Nada falhava; o realtime simplesmente não entregava dado novo.
//
// A causa era de fronteira, não de lógica: `CarregaOptions.overlay` é um `Map` de
// FUNÇÕES, e o structured clone do `postMessage` não serializa função. O conserto
// é mandar `OverlayDeTabela` (linhas, corte, chave, marca — tudo clonável) e
// reconstruir o mesclador deste lado com a MESMA `mesclador()` que o processo
// principal usa. Ver `overlay-realtime.ts`.

import { parentPort, threadId, workerData } from 'node:worker_threads';
import { SemanticModel } from '../../packages/semantic-model/src/model.ts';
import { carrega, type Carregado } from '../../packages/snapshot/src/carrega.ts';
import { calculaPagina, type Janela, type MemoDeCompletos } from './calcula.ts';
import { chaveDoCompleto, diaDoCalculo } from './cache-resposta.ts';
import { CacheDeVisual } from './cache-visual.ts';
import { mescladoresDe, type OverlayDeTabela } from './overlay-realtime.ts';
import { valoresDistintos } from './valores-segmentacao.ts';
import type { DaxValue } from '../../packages/measure-engine/src/value.ts';
import { loadDashboards, type DashboardSpec } from '../../packages/widget-engine/src/spec.ts';

export interface MensagemCalculoWorker {
  tipo?: 'calcula';
  idReq: string;
  snapshotDir: string;
  specsDir: string;
  dashboardSpec: DashboardSpec;
  /**
   * O tipo vem de `calcula.ts` em vez de repetido aqui de propósito: ele era
   * `{ de, linhas }` escrito à mão, e uma cópia estrutural não erra quando o
   * original ganha campo — apenas o descarta em silêncio na travessia do
   * `postMessage`. Foi o que quase aconteceu com `termo` (a busca da tabela):
   * o campo teria viajado pelo `structuredClone` e sido ignorado pelo tipo, e a
   * busca simplesmente não filtraria nada, sem erro.
   */
  janela: Janela;
  clicados: { tabela: string; coluna: string }[];
  liberaSobDemanda?: string[];
  precisaFormaCompleta?: string[];
  agoraIso: string;
  /**
   * O overlay do poller, por nome de tabela normalizado. Ausente (ou vazio)
   * quando nenhuma tabela desta página tem delta — que é o caso comum logo
   * depois de um refresh, e o motivo de o campo ser opcional em vez de um `Map`
   * vazio obrigatório: o que não viaja não custa serialização.
   *
   * `Map` e não array de pares porque o structured clone transporta `Map`
   * nativamente, e é `Map` que `carrega()` quer do outro lado — converter duas
   * vezes só criaria um lugar a mais para a normalização do nome divergir.
   */
  overlays?: ReadonlyMap<string, OverlayDeTabela>;
  /**
   * `identidadeDaPagina()` do processo pai — o carimbo **das tabelas que ESTA
   * página lê**, mais o dia UTC. A MESMA identidade que `Servidor.carrega()`
   * usa para saber se o dataset dela ainda vale, e a mesma conta que
   * `carimboDaPagina` faz para a chave do cache de resposta.
   *
   * Ver `cacheDeCarga` abaixo: sem isto, um snapshot novo (`npm run snapshot`)
   * ou a virada do dia (`TODAY()`) deixariam esta worker servindo o `Carregado`
   * de ontem para sempre, porque nada mais aqui chega a cada mensagem para
   * avisar que o disco mudou.
   *
   * **Era `identidadeAtual()` — global — e trocar isso é a correção de
   * 21/09/2026.** Ver `identidadePorPagina` para os números.
   */
  identidade: string;
  /**
   * O ESCOPO de quem pediu (`escopoDoCache`, `escopo-cache.ts`) — não a
   * identidade da pessoa. Entra aqui pelo mesmo motivo que entra em
   * `chaveDoCompleto` na thread principal: é ele que separa o resultado inteiro
   * guardado em `completos` (abaixo) do resultado de quem alcança outras linhas.
   *
   * Hoje `escopoDoCache` devolve a MESMA constante para todo mundo, então o
   * campo não muda chave nenhuma — e é exatamente por isso que ele precisa
   * existir agora: no dia do Permission Engine, um memo sem escopo devolve o
   * recorte do gestor A para o gestor B, sem erro e sem sintoma.
   */
  escopo: string;
  /**
   * **Em vez da página, os valores de UMA segmentação** (`GET .../valores`).
   *
   * Era a última coisa que carregava dataset na thread que atende: a rota chamava
   * `Servidor.carrega()` ali mesmo, e cada mudança do tempo real derrubava esse
   * dataset. Medido em 05/10/2026 (ACHADOS #175): 57 cargas na thread principal em
   * ~23 min, uma a cada ~25 s, e 9 dos 14 picos do laço fora do refresh a ≤ 3 s de
   * uma delas. Aqui a lista sai do MESMO `cacheDeCarga` da página: o dataset que o
   * reaquecimento carregou para calcular a página serve também às segmentações.
   */
  valores?: { tabela: string; coluna: string; nivel: string | null };
}

/**
 * Manda uma worker esquecer dataset(s) já carregados — o poller de quase-realtime
 * detectou uma tabela mudando de verdade (`Servidor.aoTabelaMudar`) e a cópia que
 * esta worker guarda em `cacheDeCarga` ficou velha. Mensagem "solta": não carrega
 * `idReq` e não gera resposta — quem manda não espera confirmação, do mesmo jeito
 * que `Servidor.carregadas.delete(...)` também não espera nada de volta.
 */
export interface MensagemDeInvalidacao {
  tipo: 'invalida';
  /** Ausente inteiro (a String vazia nunca é um id de página) deixa acontecer
   *  fora daqui: hoje só existe o caso "esta página mudou", vindo sempre com id. */
  dashboardId: string;
}

export type MensagemParaWorker = MensagemCalculoWorker | MensagemDeInvalidacao;

export interface RespostaCalculoWorker {
  idReq: string;
  ok: boolean;
  pagina?: unknown;
  dadoDe?: string | null;
  omitidas?: string[];
  linhasPorTabela?: [string, number][];
  /** A lista pedida em `MensagemCalculoWorker.valores`; `pagina` fica ausente. */
  valores?: DaxValue[];
  /**
   * O pedido de `valores` estava errado (nível que a projeção não conhece): é 400,
   * não falha da worker. Vem com `ok: true` para não cair no cálculo em linha, que
   * recarregaria o dataset na thread principal só para errar igual.
   */
  erroDoPedido?: string;
  /** Presente quando ESTE pedido carregou o dataset do disco (o `cacheDeCarga` errou). */
  carga?: { ms: number; libera: string[]; formaCompleta: string[]; worker: number };
  erro?: string;
}

// Cache do SemanticModel por worker thread para não reler specs a cada cálculo
let modelCached: SemanticModel | null = null;
let lastSpecsDir: string | null = null;
// E as páginas inteiras, pelo mesmo motivo: ver `paginaInteiraDe`.
let paginasCached: Map<string, DashboardSpec> | null = null;
let paginasDoDir: string | null = null;

/**
 * A spec INTEIRA da página — todos os visuais, sem o recorte do pedido. É o que a
 * carga do dataset usa (ver o comentário no ponto de uso). `null` quando a página não
 * está nas specs (teste com spec feita à mão): aí a carga usa a que chegou.
 */
function paginaInteiraDe(specsDir: string, id: string): DashboardSpec | null {
  if (paginasCached === null || paginasDoDir !== specsDir) {
    paginasCached = new Map(loadDashboards(specsDir).map((d) => [d.id, d]));
    paginasDoDir = specsDir;
  }
  return paginasCached.get(id) ?? null;
}

/**
 * A chave de `cacheDeCarga`: mesma página, mesmo conjunto de visuais e mesma
 * liberação de colunas/tabelas sob demanda.
 *
 * **Desde 05/10/2026 os visuais são os da PÁGINA INTEIRA**, não os pedidos: a
 * carga usa a página toda (como `Servidor.carregadas` na thread principal sempre
 * fez), então o conjunto é constante por página e todo recorte dela — abertura,
 * visual sob rolagem, valores de segmentação — cai na mesma entrada. Os ids
 * continuam na chave porque um teste com spec feita à mão (fora de `specs/`) cai
 * na spec que chegou, e dois recortes dela não podem dividir um dataset projetado
 * para só um deles. Filtro não entra aqui de propósito, ver `cacheDeCarga`.
 */
export function chaveDeCarga(
  dashId: string,
  visuaisIds: readonly string[],
  libera: readonly string[],
  formaCompleta: readonly string[],
): string {
  return [
    dashId,
    [...visuaisIds].sort().join(','),
    [...libera].sort().join(','),
    [...formaCompleta].sort().join(','),
  ].join(' ');
}

/** Nº de datasets que uma worker guarda ao mesmo tempo antes de podar o mais
 *  antigo — ver o comentário de `cacheDeCarga` para a conta de memória. */
export const TETO_CACHE_POR_WORKER = 6;

/**
 * O dataset já carregado — tabelas do disco, tipadas, calculadas materializadas
 * e overlay de tempo real mesclado —, por combinação de página+visuais+liberação.
 * A MESMA função que `Servidor.carregadas` cumpre na thread principal, replicada
 * aqui porque cada worker thread tem a sua PRÓPRIA memória: sem isto, toda
 * mensagem — mesmo só trocando o filtro de um clique — relia o snapshot do disco
 * inteiro. Medido em 09/09/2026 (VISÃO GERAL, clique num técnico do ranking):
 * `calculo_ms_interactive` (dentro da worker) ficava em 1,9–2,5 s, dos quais
 * `calculaPagina` sozinho gasta ~93 ms — o resto é `carrega()` relendo e
 * retipando tabela por tabela à toa, porque o FILTRO da tela muda a cada clique,
 * mas o CONJUNTO DE COLUNAS que a página carrega não muda nunca.
 *
 * **Por que o filtro da tela (`dashboardSpec.filters`) NÃO entra na chave.**
 * `carrega()` não filtra linha nenhuma — quem filtra é `calculaPagina`, depois,
 * sobre o `Evaluator` já pronto (é por isso que `Servidor.carrega()`, na thread
 * principal, já é chamado com o `dash` SEM os filtros da tela, e o mesmo
 * `Carregado` serve qualquer filtro). Chavear por filtro faria esta cache
 * crescer um dataset POR VALOR CLICADO — exatamente o inverso do que ela existe
 * para evitar — sem nenhum ganho de corretude: dois filtros diferentes sobre o
 * MESMO conjunto de colunas leem o MESMO dataset.
 *
 * **Por que cachear com o overlay de tempo real JÁ mesclado dentro, apesar do
 * alerta que existia aqui contra isso.** O alerta (ver `MensagemDeInvalidacao`)
 * era contra um mesclador parado por TEMPO indefinido; esta entrada morre por
 * INVALIDAÇÃO — a `identidade` DESTA página muda (uma tabela que ela lê foi
 * rematerializada, ou o dia virou) ou uma mensagem `invalida` chega (o poller
 * viu ESTA página mudar). Os dois caminhos derrubam a mesma coisa, pela mesma
 * função (`esqueceAPagina`). Entre uma invalidação e a próxima o overlay
 * realmente NÃO mudou — é a própria definição do evento que dispara a
 * invalidação —, então servir do cache é o mesmo dado que uma carga nova
 * traria, só sem o disco.
 *
 * **O teto (`TETO_CACHE_POR_WORKER`).** Uma worker atende TODAS as páginas do
 * menu, não só uma — sem teto, uma sessão que passeia pelas 14 acumularia 14
 * datasets vivos ao mesmo tempo, e o orçamento de heap por worker
 * (`API_WORKER_HEAP_MB`, ver `piscina-workers.ts`) foi bisseccionado supondo
 * dataset TRANSIENTE, não guardado. Poda por ordem de inserção (mesma ideia de
 * `TETO_PAGINAS_VISTAS` em `frontend/src/utils/cachePagina.ts`): a entrada mais
 * antiga sai, a mais recentemente usada nunca é a próxima a cair.
 */
const cacheDeCarga = new Map<string, Promise<Carregado>>();

/**
 * A última `identidade` vista **POR PÁGINA** — e a razão de não ser uma só.
 *
 * **O defeito que isto conserta, medido em 21/09/2026.** Este era um
 * `let identidadeCache: string | null`, global, e uma mudança nele fazia
 * `cacheDeCarga.clear()`: TODAS as páginas, de TODAS as threads, a cada
 * rematerialização de QUALQUER tabela. Amostrado na API no ar, sem ninguém na
 * tela: **4 mudanças de carimbo em 6 minutos — uma a cada 1,5 min**. A cada
 * uma, toda worker esvaziava tudo.
 *
 * O preço disso não é o recálculo, é a **releitura do disco**. Medido na mesma
 * API, forçando `?recalcula=1` com as tabelas já em memória contra o mesmo
 * pedido depois de um descarte:
 *
 * ```
 * visao-geral              servida do cache     2 ms
 *                          recalculada em RAM 219 ms   <- o cálculo
 *                          + relendo o disco 2250 ms   <- o que o descarte cobrava
 * ```
 *
 * ~90% do custo era releitura que a invalidação não precisava causar: a chave
 * do cache de RESPOSTA já era escopada por página desde 09/09
 * (`carimboDaPagina`, `servidor.ts`), e o dado carregado não tinha acompanhado.
 * Agora as duas camadas medem a identidade do mesmo jeito.
 *
 * **Por que um `Map` aqui não cresce sem fim**, que é o que o `clear()` global
 * também fazia de graça: `cacheDeCarga` continua limitado por
 * `TETO_CACHE_POR_WORKER`, e este mapa guarda uma string por página do menu (14
 * hoje) — não por combinação de pedido.
 *
 * **O dia continua derrubando tudo**, e é de propósito: `identidade` é
 * `carimbo@dia` (`identidadeDoCalculo`), então a virada da meia-noite muda a
 * identidade de todas as páginas de uma vez, e cada uma cai na sua próxima
 * mensagem. É o que as 32 chamadas a `TODAY()` exigem.
 */
const identidadePorPagina = new Map<string, string>();

/**
 * Esquece o que esta worker guarda de UMA página — o dataset e os resultados
 * inteiros dos visuais dela.
 *
 * Um lugar só porque os dois caminhos que invalidam têm de invalidar
 * exatamente a mesma coisa: a mensagem `invalida` (o poller viu a tabela
 * mudar) e a identidade desta página ter avançado (o refresh rematerializou
 * uma tabela que ela lê). Dois trechos separados divergiriam no primeiro dia
 * em que um deles ganhasse mais uma estrutura para limpar.
 */
function esqueceAPagina(dashboardId: string): void {
  const prefixo = `${dashboardId} `;
  for (const chave of [...cacheDeCarga.keys()]) {
    if (chave.startsWith(prefixo)) cacheDeCarga.delete(chave);
  }
  // O resultado inteiro desta página também: ele foi calculado sobre o dataset
  // que acabou de ser descartado. `limpaPagina` e não `limpa` pelo mesmo motivo
  // de `Servidor.aoTabelaMudar` (`servidor.ts`) — só quem depende da tabela que
  // mudou precisa recalcular; o resto continua quente.
  completos.limpaPagina(dashboardId);
}

/**
 * O resultado **inteiro** de um visual paginável, guardado entre um pedido e
 * outro — a MESMA peça que `Servidor.completos` é na thread principal, pela
 * mesma razão pela qual `cacheDeCarga` acima existe: worker thread tem memória
 * própria, e o que a thread principal guarda não alcança daqui.
 *
 * **Por que ela faltava, e o que isso custava.** `calculaPagina` recebe um
 * `memo` opcional (`MemoDeCompletos`, `calcula.ts`); a thread principal monta o
 * dela em `servidor.ts`, mas aquele ramo só roda quando a piscina está inativa
 * ou a worker falhou. No caminho de produção — piscina ativa — a chamada daqui
 * passava `undefined`, e o `CacheDeVisual` de 512 MB do processo ficava com
 * ZERO itens enquanto os cliques pagavam o preço que ele existe para não pagar.
 * Medido em 21/09/2026, `visao-geral`, banco de prova com snapshot congelado:
 * paginar e buscar custavam 1.436–2.091 ms cada, `cacheVisuais.itens = 0` ao
 * fim de dez pedidos.
 *
 * **O orçamento é repartido, não replicado.** O teto vem da piscina por
 * `workerData` já dividido pelo nº de workers (ver `configuracaoDaPiscina`):
 * o total gasto pela API continua sendo `CACHE_VISUAL_MB`, onde quer que o
 * cálculo aconteça. Sem `workerData` — quem subir esta worker à mão — o teto é
 * zero, que é o desligado honesto: `CacheDeVisual` com teto 0 não guarda nada e
 * o comportamento volta a ser exatamente o de antes desta linha.
 *
 * **E ele mora DENTRO do heap da worker** (`maxOldGenerationSizeMb`,
 * `piscina-workers.ts`), porque um `Completo` é objeto de JS comum — ao
 * contrário das colunas do snapshot, que são `TypedArray` e vivem fora dele.
 * É por isso que o teto é uma fração do heap por worker, e não o total.
 */
const completos = new CacheDeVisual({
  tetoBytes: Math.max(0, Number((workerData as { tetoDeVisuaisMB?: number } | null)?.tetoDeVisuaisMB ?? 0)) * 1024 * 1024,
  aoRecusar: (chave, bytes, teto) => {
    // Mesmo canal e mesmo argumento do `aoRecusar` da thread principal: recusa
    // é orçamento, não falha — mas calá-la faria a lentidão daquele visual
    // parecer inexplicável.
    console.error(
      `[cache-visual/worker] ${chave} não coube: ${(bytes / 1048576).toFixed(1)} MB ` +
        `contra um teto de ${(teto / 1048576).toFixed(0)} MB. ` +
        `A janela deste visual vai recalcular a cada clique.`,
    );
  },
});

function guardaNoCache(chave: string, promessa: Promise<Carregado>): void {
  cacheDeCarga.delete(chave);
  cacheDeCarga.set(chave, promessa);
  if (cacheDeCarga.size > TETO_CACHE_POR_WORKER) {
    const maisAntiga = cacheDeCarga.keys().next().value;
    if (maisAntiga !== undefined) cacheDeCarga.delete(maisAntiga);
  }
  // Falhou? Não fica preso — a próxima mensagem tenta carregar de novo, em vez
  // de repetir o mesmo erro (ou um erro de rede/disco já sanado) para sempre.
  promessa.catch(() => cacheDeCarga.delete(chave));
}

if (parentPort) {
  parentPort.on('message', async (msg: MensagemParaWorker) => {
    if (msg.tipo === 'invalida') {
      esqueceAPagina(msg.dashboardId);
      // **E a identidade guardada dela junto.** Sem esta linha o mapa ficaria
      // afirmando que esta página está na identidade X com o dataset dela já
      // descartado — verdade inútil hoje (a entrada sumiu, a próxima mensagem
      // recarrega de qualquer jeito), e uma afirmação errada no dia em que
      // alguém usar `identidadePorPagina` para decidir outra coisa.
      identidadePorPagina.delete(msg.dashboardId);
      return; // sem resposta: ver o comentário de `MensagemDeInvalidacao`.
    }

    const {
      idReq,
      snapshotDir,
      specsDir,
      dashboardSpec,
      janela,
      clicados,
      liberaSobDemanda,
      precisaFormaCompleta,
      agoraIso,
      overlays,
      identidade,
      escopo,
      valores,
    } = msg;

    try {
      if (!modelCached || lastSpecsDir !== specsDir) {
        modelCached = SemanticModel.fromSpecsDir(specsDir);
        lastSpecsDir = specsDir;
      }

      // **A identidade que chega é a DESTA página** (`identidadeDaPagina`,
      // `servidor.ts`), não a do snapshot inteiro — então um refresh de tabela
      // que esta página não lê não a alcança mais. Ver `identidadePorPagina`
      // para o número que mediu o que a versão global custava.
      //
      // Os resultados inteiros caem junto, dentro de `esqueceAPagina`: a chave
      // deles já carrega a identidade, então nunca seriam SERVIDOS errados —
      // mas ficariam ocupando o orçamento até o LRU chegar neles, e o
      // orçamento é justamente o que decide o que fica.
      if (identidadePorPagina.get(dashboardSpec.id) !== identidade) {
        esqueceAPagina(dashboardSpec.id);
        identidadePorPagina.set(dashboardSpec.id, identidade);
      }

      const libera = liberaSobDemanda ?? [];
      const formaCompleta = precisaFormaCompleta ?? [];
      // **O dataset é o da PÁGINA INTEIRA, e o recorte só entra no cálculo** —
      // igual a `Servidor.carrega()` na thread principal. Até 05/10/2026 a carga
      // usava o recorte (`?visual=`) e a chave levava os ids pedidos: um
      // reaquecimento da `agendamento-field` (abertura, cada segmentação, cada
      // período, cada visual abaixo da dobra) eram até ~20 cargas do disco por
      // worker, e medido em produção ele levou 20–47 s para UMA página com a CPU
      // em ~400% (ACHADOS #175). A página inteira cobre as colunas de qualquer
      // recorte dela, então nenhum pedido acha coluna omitida; o custo é a carga
      // trazer as colunas da página toda, que é exatamente o que a thread
      // principal sempre fez.
      const paginaInteira = paginaInteiraDe(specsDir, dashboardSpec.id) ?? dashboardSpec;
      const chave = chaveDeCarga(
        dashboardSpec.id,
        (paginaInteira.visuals ?? []).map((v) => v.id),
        libera,
        formaCompleta,
      );

      let promessa = cacheDeCarga.get(chave);
      // Este pedido pagou a carga do disco? Sai na resposta — é o número que diz se
      // o `cacheDeCarga` está acertando (ACHADOS #175: 304 tarefas de fundo em ~6 min,
      // ~0,9 s cada, quando a lista em si custa milissegundos).
      let carga: RespostaCalculoWorker['carga'];
      if (!promessa) {
        const agora = new Date(agoraIso);
        const t0 = Date.now();
        promessa = carrega({
          dir: snapshotDir,
          model: modelCached,
          dashboards: [paginaInteira],
          now: agora,
          liberaSobDemanda,
          precisaFormaCompleta,
          // **Armazenamento colunar.** Medido em 13/09/2026 nesta API, com `--sem-aquecer`,
          // depois de servir as 14 páginas uma vez: **RSS 5.360 MB → 3.097 MB**. Por página,
          // em processo isolado, `agendamento-field` sai de 567 para 246 MB e
          // `relatorio-do-mes` de 594 para 314. **O tempo empata** — as 14 páginas custam
          // 46,1 s em objeto e 46,4 s em colunar.
          //
          // Ferramenta em lote continua em objeto, de propósito: ela roda com
          // `--max-old-space-size`, não tem orçamento de RAM, e é ela que materializa e
          // GRAVA — escrever coluna física numa vista erra alto, e deve errar.
          //
          // A troca é provada, não estimada: `npm run bench:colunar-paridade` carrega e
          // calcula as 14 páginas nos dois caminhos e compara os 306 visuais. Zero
          // divergências. Voltar atrás é trocar este `true` por `false`.
          colunar: true,
          ...(overlays && overlays.size > 0 ? { overlay: mescladoresDe(overlays) } : {}),
        });
        guardaNoCache(chave, promessa);
        // Medida só no sucesso: uma carga que falhou já vira a resposta de erro abaixo.
        await promessa.then(() => {
          carga = { ms: Date.now() - t0, libera: [...libera].sort(), formaCompleta: [...formaCompleta].sort(), worker: threadId };
        }, () => undefined);
      }

      const carregado = await promessa;

      if (valores) {
        let resp: RespostaCalculoWorker;
        try {
          const lista = valoresDistintos(carregado.ev, valores.tabela, valores.coluna, valores.nivel);
          resp = { idReq, ok: true, valores: lista, dadoDe: carregado.dadoDe, ...(carga ? { carga } : {}) };
        } catch (err) {
          resp = { idReq, ok: true, erroDoPedido: err instanceof Error ? err.message : String(err) };
        }
        parentPort?.postMessage(resp);
        return;
      }

      // A chave do resultado inteiro, montada com a MESMA função da thread
      // principal (`chaveDoCompleto`) de propósito: duas montagens de chave
      // para o mesmo cache são dois lugares por onde a invalidação pode
      // divergir, e `CacheDeVisual.limpaPagina` depende da FORMA dessa chave
      // (a página é um segmento entre dois-pontos) para achar o que apagar.
      //
      // `filtros` sai de `dashboardSpec.filters` — que é
      // `[...dash.filters, ...daTela]`, montado em `servidor.ts` como `alvo`.
      // É um SUPERCONJUNTO do que a thread principal usa (só `daTela`), e não
      // um conjunto diferente: `dash.filters` é constante por página, e a
      // página já é outro segmento da chave. Discrimina o mesmo, nunca menos.
      //
      // `carimbo` recebe a `identidade` inteira (carimbo do snapshot @ dia, ver
      // `identidadeDoCalculo`) porque é ela que esta worker tem em mãos, e é
      // ela que dispara a limpeza acima. O `dia` continua entrando por fora,
      // vindo do MESMO `agoraIso` com que o dataset foi carregado.
      // Uma função e não a chave montada duas vezes: `le` e `guarda` TÊM de
      // produzir exatamente a mesma chave, e duas cópias do mesmo literal são
      // duas coisas para alguém editar pela metade — o sintoma seria um cache
      // que guarda e nunca acerta, indistinguível de um cache desligado.
      const dia = diaDoCalculo(new Date(agoraIso));
      const chaveDo = (visual: string): string =>
        chaveDoCompleto({
          escopo,
          pagina: dashboardSpec.id,
          filtros: dashboardSpec.filters ?? [],
          clicados,
          visual,
          carimbo: identidade,
          dia,
        });

      const memo: MemoDeCompletos = {
        le: (visual) => completos.le(chaveDo(visual)),
        guarda: (visual, completo) => completos.guarda(chaveDo(visual), completo),
      };

      const pagina = calculaPagina(
        dashboardSpec,
        carregado.ev,
        janela,
        undefined,
        memo,
        clicados,
      );

      const resp: RespostaCalculoWorker = {
        idReq,
        ok: true,
        pagina,
        dadoDe: carregado.dadoDe,
        omitidas: carregado.omitidas,
        linhasPorTabela: [...carregado.linhasPorTabela.entries()],
        ...(carga ? { carga } : {}),
      };

      parentPort?.postMessage(resp);
    } catch (err) {
      const resp: RespostaCalculoWorker = {
        idReq,
        ok: false,
        erro: err instanceof Error ? err.message : String(err),
      };
      parentPort?.postMessage(resp);
    }
  });
}
