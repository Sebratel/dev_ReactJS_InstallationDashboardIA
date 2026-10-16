// Uma worker que responde dizendo QUEM ela é (`threadId`) — e morre quando a tarefa pede.
//
// `piscina-afinidade.test.ts` afirma sobre PARA ONDE cada tarefa foi: a mesma página
// sempre na mesma worker, o clique desviando da dona ocupada, a página passando para a
// que sobrou quando a dona morre. Nenhuma das outras fixtures diz quem atendeu, e
// `estado.ocupados` só conta, não identifica.
//
// Junta as duas alavancas das outras fixtures, pelos mesmos campos: a demora vem em
// `janela.de` (como `worker-lento.ts`, para existir dona OCUPADA) e a ordem de morrer em
// `identidade` (como `worker-que-morre-sob-comando.ts`). `process.exit` dentro de uma
// worker thread encerra a thread, não o processo.

import { parentPort, threadId } from 'node:worker_threads';
import type { MensagemCalculoWorker } from '../../src/worker-calculador.ts';

parentPort?.on('message', (msg: MensagemCalculoWorker) => {
  // A pergunta de memória da saúde (`memoria-da-saude.ts`) não é tarefa: ignorar, como as
  // outras fixtures — a saúde a publica com `medida: null`.
  if ((msg as { tipo?: string }).tipo === 'memoria') return;
  if (msg.identidade === 'morre') process.exit(9);
  setTimeout(() => {
    parentPort?.postMessage({
      idReq: msg.idReq,
      ok: true,
      pagina: { threadId },
      dadoDe: null,
      omitidas: [],
      linhasPorTabela: [],
    });
  }, msg.janela.de);
});
