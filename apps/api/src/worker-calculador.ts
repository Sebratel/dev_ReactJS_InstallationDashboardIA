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

import { parentPort } from 'node:worker_threads';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { carrega, type Carregado } from '../../../packages/snapshot/src/carrega.ts';
import { calculaPagina } from './calcula.ts';
import { mescladoresDe, type OverlayDeTabela } from './overlay-realtime.ts';
import type { DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';

export interface MensagemCalculoWorker {
  tipo?: 'calcula';
  idReq: string;
  snapshotDir: string;
  specsDir: string;
  dashboardSpec: DashboardSpec;
  janela: { de: number; linhas: number };
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
   * `identidadeAtual()` do processo pai (carimbo do snapshot + dia UTC) — a MESMA
   * identidade que `Servidor.carrega()` usa para saber se `this.carregadas` ainda
   * vale. Ver `cacheDeCarga` abaixo: sem isto, um snapshot novo (`npm run
   * snapshot`) ou a virada do dia (`TODAY()`) deixariam esta worker servindo o
   * `Carregado` de ontem para sempre, porque nada mais aqui chega a cada mensagem
   * para avisar que o disco mudou.
   */
  identidade: string;
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
  erro?: string;
}

// Cache do SemanticModel por worker thread para não reler specs a cada cálculo
let modelCached: SemanticModel | null = null;
let lastSpecsDir: string | null = null;

/**
 * A chave de `cacheDeCarga`: mesma página, mesmo conjunto de visuais PEDIDOS
 * (não só o mesmo `dash.id`) e mesma liberação de colunas/tabelas sob demanda.
 *
 * **Por que o conjunto de visuais entra, e `Servidor.carregadas` (thread
 * principal) não precisa disso.** Lá, `carrega()` sempre recebe o `dash` INTEIRO
 * (todos os visuais da página, filtro nenhum aplicado) — só `libera`/
 * `formaCompleta` variam com o pedido. Aqui, `dashboardSpec.visuals` já vem
 * RECORTADO para os `?visual=` do pedido (ver `servidor.ts`, `alvo.visuals`), e
 * `colunasUsadas()` (dentro de `carrega()`) decide o que omitir olhando esse
 * recorte. Cachear só por `dash.id` faria um pedido de UM visual sob rolagem
 * reaproveitar — ou ser reaproveitado por — o dataset da abertura eager, que
 * pode ter omitido uma coluna que só o visual de rolagem usa. Incluir os ids
 * pedidos custa uma chave a mais por formato de pedido (poucos por página,
 * nunca um por combinação de filtro — filtro não entra aqui de propósito, ver
 * o comentário de `cacheDeCarga`), nunca uma a mais por clique.
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
 * INVALIDAÇÃO — `identidade` muda (snapshot novo ou virada de dia: derruba
 * tudo) ou uma mensagem `invalida` chega (o poller viu ESTA página mudar:
 * derruba só a dela). Entre uma invalidação e a próxima o overlay realmente NÃO
 * mudou — é a própria definição do evento que dispara a invalidação —, então
 * servir do cache é o mesmo dado que uma carga nova traria, só sem o disco.
 *
 * **O teto (`TETO_CACHE_POR_WORKER`).** Uma worker atende TODAS as páginas do
 * menu, não só uma — sem teto, uma sessão que passeia pelas 14 acumularia 14
 * datasets vivos ao mesmo tempo, e o orçamento de heap por worker
 * (`API_WORKER_HEAP_MB`, ver `piscina-workers.ts`) foi bisseccionado supondo
 * dataset TRANSIENTE, não guardado. Poda por ordem de inserção (mesma ideia de
 * `TETO_PAGINAS_VISTAS` em `apps/web/src/cache-pagina.ts`): a entrada mais
 * antiga sai, a mais recentemente usada nunca é a próxima a cair.
 */
const cacheDeCarga = new Map<string, Promise<Carregado>>();
/** A `identidade` mais recente já vista — uma mudança aqui invalida TUDO, do
 *  mesmo jeito que `Servidor.carrega()` faz com `carimboDasCarregadas`. */
let identidadeCache: string | null = null;

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
      const prefixo = `${msg.dashboardId} `;
      for (const chave of [...cacheDeCarga.keys()]) {
        if (chave.startsWith(prefixo)) cacheDeCarga.delete(chave);
      }
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
    } = msg;

    try {
      if (!modelCached || lastSpecsDir !== specsDir) {
        modelCached = SemanticModel.fromSpecsDir(specsDir);
        lastSpecsDir = specsDir;
      }

      if (identidadeCache !== identidade) {
        cacheDeCarga.clear();
        identidadeCache = identidade;
      }

      const libera = liberaSobDemanda ?? [];
      const formaCompleta = precisaFormaCompleta ?? [];
      const chave = chaveDeCarga(
        dashboardSpec.id,
        (dashboardSpec.visuals ?? []).map((v) => v.id),
        libera,
        formaCompleta,
      );

      let promessa = cacheDeCarga.get(chave);
      if (!promessa) {
        const agora = new Date(agoraIso);
        promessa = carrega({
          dir: snapshotDir,
          model: modelCached,
          dashboards: [dashboardSpec],
          now: agora,
          liberaSobDemanda,
          precisaFormaCompleta,
          ...(overlays && overlays.size > 0 ? { overlay: mescladoresDe(overlays) } : {}),
        });
        guardaNoCache(chave, promessa);
      }

      const carregado = await promessa;

      const pagina = calculaPagina(
        dashboardSpec,
        carregado.ev,
        janela,
        undefined,
        undefined,
        clicados,
      );

      const resp: RespostaCalculoWorker = {
        idReq,
        ok: true,
        pagina,
        dadoDe: carregado.dadoDe,
        omitidas: carregado.omitidas,
        linhasPorTabela: [...carregado.linhasPorTabela.entries()],
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
