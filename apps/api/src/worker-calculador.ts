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
import path from 'node:path';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { carrega } from '../../../packages/snapshot/src/carrega.ts';
import { calculaPagina } from './calcula.ts';
import { mescladoresDe, type OverlayDeTabela } from './overlay-realtime.ts';
import type { DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';

export interface MensagemCalculoWorker {
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
}

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

if (parentPort) {
  parentPort.on('message', async (msg: MensagemCalculoWorker) => {
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
    } = msg;

    try {
      if (!modelCached || lastSpecsDir !== specsDir) {
        modelCached = SemanticModel.fromSpecsDir(specsDir);
        lastSpecsDir = specsDir;
      }

      const agora = new Date(agoraIso);
      const carregado = await carrega({
        dir: snapshotDir,
        model: modelCached,
        dashboards: [dashboardSpec],
        now: agora,
        liberaSobDemanda,
        precisaFormaCompleta,
        // Reconstruído a cada mensagem, e não guardado entre elas: o delta do
        // poller muda a cada volta (12 s), e um mesclador em cache aqui
        // congelaria a versão do delta que estava valendo na primeira mensagem
        // que esta worker atendeu — dado velho servido com cara de fresco, que é
        // o modo de falha que este caminho inteiro existe para evitar.
        ...(overlays && overlays.size > 0 ? { overlay: mescladoresDe(overlays) } : {}),
      });

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
