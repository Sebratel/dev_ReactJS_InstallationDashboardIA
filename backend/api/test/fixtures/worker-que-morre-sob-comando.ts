// Uma worker que responde normalmente — e MORRE quando a tarefa pede.
//
// `piscina-recriacao.test.ts` precisa das duas coisas na mesma worker: matar
// uma (o que dispara a reposição) e depois provar que a piscina reposta ainda
// CALCULA, e não só que a contagem voltou a N. O comando vem em `identidade`
// porque `MensagemCalculoWorker` já a transporta e nenhuma worker de fixture a
// usa para o que ela serve de verdade.
//
// `process.exit` dentro de uma worker thread encerra **a thread**, não o
// processo: o pai recebe `'exit'` com este código.

import { parentPort } from 'node:worker_threads';
import type { MensagemCalculoWorker } from '../../src/worker-calculador.ts';

parentPort?.on('message', (msg: MensagemCalculoWorker) => {
  // A pergunta de memória da saúde (`tipo: 'memoria'`) não é tarefa: ignorar.
  if ((msg as { tipo?: string }).tipo === 'memoria') return;
  if (msg.identidade === 'morre') process.exit(7);
  parentPort?.postMessage({
    idReq: msg.idReq,
    ok: true,
    pagina: { visuais: [] },
    dadoDe: null,
    omitidas: [],
    linhasPorTabela: [],
  });
});
