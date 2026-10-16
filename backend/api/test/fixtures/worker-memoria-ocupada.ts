// Uma worker que responde a pergunta de memória — e que, numa tarefa, SEGURA a thread.
//
// É o caso que `memoria-na-saude.test.ts` precisa e que nenhuma das outras fixtures
// reproduz: em produção a worker fica presa num cálculo SÍNCRONO de 10–20 s e só lê a
// pergunta da saúde quando termina. Aqui a tarefa é um laço ocupado de `janela.de` ms —
// não um `setTimeout`, que deixaria a thread livre para responder e esconderia o caso.

import { parentPort, threadId } from 'node:worker_threads';
import { medeIsolate, type MedidaDaWorker, type MensagemDeMemoria } from '../../src/memoria-da-saude.ts';
import type { MensagemCalculoWorker } from '../../src/worker-calculador.ts';

parentPort?.on('message', (msg: MensagemCalculoWorker | MensagemDeMemoria) => {
  if (msg.tipo === 'memoria') {
    const medida: MedidaDaWorker = { threadId, ...medeIsolate(), datasets: 0, visuais: { itens: 0, mb: 0 } };
    msg.porta.postMessage(medida);
    msg.porta.close();
    return;
  }
  const ate = Date.now() + msg.janela.de;
  while (Date.now() < ate) {
    // ocupado de propósito: ver o cabeçalho.
  }
  parentPort?.postMessage({
    idReq: msg.idReq,
    ok: true,
    pagina: { visuais: [] },
    dadoDe: null,
    omitidas: [],
    linhasPorTabela: [],
  });
});
