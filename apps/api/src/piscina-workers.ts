// Gerenciador de Piscina de Worker Threads para computação paralela de DAX.

import { Worker } from 'node:worker_threads';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MensagemCalculoWorker, RespostaCalculoWorker } from './worker-calculador.ts';

export interface OpcoesPiscina {
  /** Quantas workers manter na piscina. Padrão: min(4, os.cpus().length). */
  tamanhoPool?: number;
  /** Forçar desativação (fallback síncrono para testes unitários). */
  desativado?: boolean;
}

interface TarefaPendente {
  msg: MensagemCalculoWorker;
  resolve: (res: RespostaCalculoWorker) => void;
  reject: (erro: Error) => void;
}

export class PiscinaWorkers {
  private readonly workers: Worker[] = [];
  private readonly livres: Worker[] = [];
  private readonly tarefas: TarefaPendente[] = [];
  private readonly pendentesPorWorker = new Map<Worker, TarefaPendente>();
  private readonly desativado: boolean;
  private contadorReq = 0;

  constructor(opts: OpcoesPiscina = {}) {
    this.desativado = opts.desativado ?? false;

    if (this.desativado) return;

    const numWorkers = opts.tamanhoPool ?? Math.max(1, Math.min(4, os.cpus().length));
    const workerScript = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      'worker-calculador.ts',
    );

    const ALLOWED_FLAGS = [
      '--import',
      '--loader',
      '--experimental-',
      '--no-warnings',
      '--preserve-symlinks',
      '--conditions',
    ];
    const execArgvValidos = process.execArgv.filter((arg) =>
      ALLOWED_FLAGS.some((prefix) => arg.startsWith(prefix)),
    );

    for (let i = 0; i < numWorkers; i++) {
      try {
        const w = new Worker(workerScript, {
          execArgv: execArgvValidos,
          resourceLimits: { maxOldGenerationSizeMb: 8192 },
        });



        w.on('message', (res: RespostaCalculoWorker) => {
          const tarefa = this.pendentesPorWorker.get(w);
          if (tarefa) {
            this.pendentesPorWorker.delete(w);
            this.livres.push(w);
            if (res.ok) {
              tarefa.resolve(res);
            } else {
              tarefa.reject(new Error(res.erro ?? 'Erro desconhecido na worker thread.'));
            }
            this.processaFila();
          }
        });

        w.on('error', (err) => {
          const tarefa = this.pendentesPorWorker.get(w);
          if (tarefa) {
            this.pendentesPorWorker.delete(w);
            tarefa.reject(err);
          }
          this.removeWorker(w);
        });

        w.on('exit', () => {
          this.removeWorker(w);
        });

        this.workers.push(w);
        this.livres.push(w);
      } catch (err) {
        console.error('[piscina-workers] Não foi possível criar worker thread:', err);
      }
    }
  }

  get ativa(): boolean {
    return !this.desativado && this.workers.length > 0;
  }

  executa(msg: Omit<MensagemCalculoWorker, 'idReq'>): Promise<RespostaCalculoWorker> {
    if (!this.ativa) {
      return Promise.reject(new Error('Piscina de workers desativada ou indisponível.'));
    }

    return new Promise<RespostaCalculoWorker>((resolve, reject) => {
      const idReq = `req-${++this.contadorReq}-${Date.now()}`;
      const tarefa: TarefaPendente = {
        msg: { ...msg, idReq },
        resolve,
        reject,
      };
      this.tarefas.push(tarefa);
      this.processaFila();
    });
  }

  private processaFila(): void {
    while (this.tarefas.length > 0 && this.livres.length > 0) {
      const tarefa = this.tarefas.shift()!;
      const worker = this.livres.shift()!;
      this.pendentesPorWorker.set(worker, tarefa);
      worker.postMessage(tarefa.msg);
    }
  }

  private removeWorker(w: Worker): void {
    const idx = this.workers.indexOf(w);
    if (idx !== -1) this.workers.splice(idx, 1);

    const idxLivre = this.livres.indexOf(w);
    if (idxLivre !== -1) this.livres.splice(idxLivre, 1);

    this.pendentesPorWorker.delete(w);
  }

  destroi(): void {
    for (const w of this.workers) {
      void w.terminate();
    }
    this.workers.length = 0;
    this.livres.length = 0;
    this.pendentesPorWorker.clear();
    this.tarefas.length = 0;
  }
}
