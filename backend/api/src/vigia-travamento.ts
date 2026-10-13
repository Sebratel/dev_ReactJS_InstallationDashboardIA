// Vigia de travamento: API viva mas parada sai, para o `restart` do Docker religar.
//
// **Por que existe (27/09/2026, ACHADOS #157).** `restart: unless-stopped` religa o
// contêiner que SAI. Um processo vivo com o laço de eventos preso não sai: o healthcheck
// marca `unhealthy` e, em Docker standalone, ninguém faz nada com isso (quem reinicia por
// healthcheck é o Swarm). A tela fica em "carregando" até alguém entrar no servidor.
//
// **Como.** O laço principal carimba um batimento por segundo numa memória compartilhada.
// Uma worker thread — que tem laço próprio, e por isso segue viva quando o principal
// trava — confere. Batimento parado há mais que o limite: grava o motivo e mata o
// processo inteiro.
//
// **A armadilha é a máquina dormir** (19/09/2026: 2h14min de suspensão no Windows). O
// vigia congela junto, e ao acordar veria um batimento de duas horas atrás. Por isso ele
// mede o PRÓPRIO atraso: se o tique dele também atrasou, foi o processo inteiro que
// parou — suspensão, não travamento — e a conta recomeça.
//
// **Só liga com `VIGIA_TRAVAMENTO_S`**, que o compose define. No `npm start` fica
// desligado: lá ninguém religaria a API, e matar à toa seria pior que a trava.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

/** Tique do batimento e da conferência. */
export const TIQUE_MS = 1_000;
/** Atraso do próprio vigia acima do qual o processo inteiro parou (suspensão). */
export const FOLGA_SUSPENSAO_MS = 5_000;

export type DecisaoDoVigia = 'ok' | 'suspensao' | 'travou';

/**
 * A regra, sem relógio nem thread. `ultimoTique` é quando o VIGIA conferiu da última vez;
 * `ultimoBatimento`, quando o laço PRINCIPAL carimbou.
 */
export function decideVigia(e: {
  agora: number;
  ultimoTique: number;
  ultimoBatimento: number;
  limiteMs: number;
  folgaSuspensaoMs?: number;
  /**
   * Quando o vigia viu a última suspensão terminar. O laço principal acorda com fila (poller,
   * sentinela, reaquecimento) e pode levar mais que um tique para bater: conta-se o limite a
   * partir do despertar, não do batimento de antes de dormir (10/10/2026, ACHADOS #204).
   */
  retomadaEm?: number;
}): DecisaoDoVigia {
  if (e.agora - e.ultimoTique > (e.folgaSuspensaoMs ?? FOLGA_SUSPENSAO_MS)) return 'suspensao';
  const desde = Math.max(e.ultimoBatimento, e.retomadaEm ?? Number.NEGATIVE_INFINITY);
  return e.agora - desde > e.limiteMs ? 'travou' : 'ok';
}

/** Lê `VIGIA_TRAVAMENTO_S`: `null` = desligado (ausente, 0 ou inválido). */
export function limiteDoAmbiente(env: NodeJS.ProcessEnv = process.env): number | null {
  const s = Number.parseInt(env.VIGIA_TRAVAMENTO_S ?? '', 10);
  return Number.isFinite(s) && s > 0 ? s * 1000 : null;
}

export interface Vigia {
  para(): void;
}

/** Liga o batimento e a worker. `snapshotDir` é onde o motivo fica, se ele matar. */
export function iniciaVigiaDeTravamento(opts: { limiteMs: number; snapshotDir: string }): Vigia {
  const batimento = new BigInt64Array(new SharedArrayBuffer(8));
  const carimba = (): void => void Atomics.store(batimento, 0, BigInt(Date.now()));
  carimba();
  const relogio = setInterval(carimba, TIQUE_MS);
  relogio.unref();

  const worker = new Worker(path.join(path.dirname(fileURLToPath(import.meta.url)), 'vigia-travamento-worker.ts'), {
    workerData: { batimento, limiteMs: opts.limiteMs, snapshotDir: opts.snapshotDir },
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 32 },
  });
  worker.unref();
  worker.on('error', (err: Error) => console.error(`[vigia] a worker do vigia caiu, sem vigia daqui em diante: ${err.message}`));

  return {
    para: () => {
      clearInterval(relogio);
      void worker.terminate();
    },
  };
}
