// A metade do vigia que roda FORA do laço principal — ver `vigia-travamento.ts`.
//
// Tudo aqui é síncrono de propósito: com o principal travado, o stderr assíncrono dele
// nunca escoaria, e a linha que explica a morte se perderia. `fs.writeSync(2, ...)` vai
// direto ao descritor.

import fs from 'node:fs';
import path from 'node:path';
import { workerData } from 'node:worker_threads';
import { registra } from '../../../tools/refresh/src/historico.ts';
import { TIQUE_MS, decideVigia } from './vigia-travamento.ts';

const { batimento, limiteMs, snapshotDir } = workerData as {
  batimento: BigInt64Array;
  limiteMs: number;
  snapshotDir: string;
};

let ultimoTique = Date.now();

setInterval(() => {
  const agora = Date.now();
  const ultimoBatimento = Number(Atomics.load(batimento, 0));
  const decisao = decideVigia({ agora, ultimoTique, ultimoBatimento, limiteMs });
  ultimoTique = agora;
  if (decisao !== 'travou') return;

  const paradoHaMs = agora - ultimoBatimento;
  const quando = new Date(agora).toISOString();
  const linha =
    `\n[vigia] o laço principal da API está parado há ${Math.round(paradoHaMs / 1000)} s ` +
    `(limite ${limiteMs / 1000} s). Matando o processo para o contêiner religar.\n`;
  try {
    fs.writeSync(2, linha);
  } catch {
    // stderr fechado não pode impedir a saída.
  }
  try {
    registra(snapshotDir, { evento: 'api-travou', quando, paradoHaMs, limiteMs });
    const dir = path.join(snapshotDir, 'diagnostico');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `api-travou.${quando.replace(/[:.]/g, '-')}.json`),
      JSON.stringify({ quando, paradoHaMs, limiteMs, pid: process.pid }, null, 2),
    );
  } catch {
    // Diagnóstico é conveniência; a saída não.
  }
  // `process.exit` numa worker encerra só a worker. Matar o processo é o único jeito de
  // tirar um laço principal preso — e fora do PID 1 (`init: true`) o sinal é entregue.
  process.kill(process.pid, 'SIGKILL');
}, TIQUE_MS);
