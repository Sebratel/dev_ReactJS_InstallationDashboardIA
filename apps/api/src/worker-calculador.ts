// Script executado pelas Worker Threads para cálculo de páginas DAX fora da thread principal.

import { parentPort } from 'node:worker_threads';
import path from 'node:path';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { carrega } from '../../../packages/snapshot/src/carrega.ts';
import { calculaPagina } from './calcula.ts';
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
