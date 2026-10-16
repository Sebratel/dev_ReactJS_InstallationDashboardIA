// Uma worker que demora antes de responder, para que exista FILA.
//
// Sem demora não há o que ordenar: `executa()` despacha na hora e a fila nunca
// chega a ter dois elementos ao mesmo tempo. Com ela, o teste consegue afirmar
// sobre a POLÍTICA (quem passa na frente) e sobre a MEDIDA (quanto se esperou),
// que é o que a F3 entrega.
//
// A demora vem em `janela.de` para o teste poder variar o custo por tarefa sem
// um segundo arquivo de fixture — `MensagemCalculoWorker` já a transporta, e
// nenhuma destas workers de fixture usa a janela para o que ela serve de
// verdade.

import { parentPort } from 'node:worker_threads';
import type { MensagemCalculoWorker } from '../../src/worker-calculador.ts';

parentPort?.on('message', (msg: MensagemCalculoWorker) => {
  // A pergunta de memória da saúde (`memoria-da-saude.ts`) não é tarefa: estas workers
  // de fixture a ignoram, e a saúde as publica com `medida: null` — o caso "não respondeu".
  if ((msg as { tipo?: string }).tipo === 'memoria') return;
  setTimeout(() => {
    parentPort?.postMessage({
      idReq: msg.idReq,
      ok: true,
      pagina: { visuais: [] },
      dadoDe: null,
      omitidas: [],
      linhasPorTabela: [],
    });
  }, msg.janela.de);
});
