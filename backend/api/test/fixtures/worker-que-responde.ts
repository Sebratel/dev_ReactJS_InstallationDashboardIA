// Uma worker que responde `ok: true` na hora, sem calcular nada.
//
// É o **controle** dos testes de ciclo de vida: sem ela, um teste que só afirma
// "a tarefa rejeitou" passaria igual numa piscina quebrada de outro jeito, em
// que TUDO rejeita. Com ela, o mesmo arranjo prova que o caminho feliz continua
// resolvendo e que a fila continua andando.

import { parentPort } from 'node:worker_threads';
import type { MensagemCalculoWorker } from '../../src/worker-calculador.ts';

parentPort?.on('message', (msg: MensagemCalculoWorker) => {
  // A pergunta de memória da saúde (`memoria-da-saude.ts`) não é tarefa: estas workers
  // de fixture a ignoram, e a saúde as publica com `medida: null` — o caso "não respondeu".
  if ((msg as { tipo?: string }).tipo === 'memoria') return;
  parentPort?.postMessage({
    idReq: msg.idReq,
    ok: true,
    pagina: { visuais: [] },
    dadoDe: null,
    omitidas: [],
    linhasPorTabela: [],
  });
});
