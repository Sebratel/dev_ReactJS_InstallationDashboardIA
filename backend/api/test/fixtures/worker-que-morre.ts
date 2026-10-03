// Uma worker que MORRE ao receber a primeira mensagem, sem responder nada.
//
// É o cenário que `piscina-ciclo-de-vida.test.ts` precisa reproduzir e que o
// calculador de verdade não reproduz: em produção uma worker morre por estouro
// de heap (`maxOldGenerationSizeMb`, 768 MB) no meio de um cálculo de 10–20 s
// sobre um snapshot real. Aqui a morte é imediata e determinística, e o que fica
// sob teste é a piscina — não o cálculo.
//
// `process.exit` dentro de uma worker thread encerra **a thread**, não o
// processo: o pai recebe `'exit'` com este código.

import { parentPort } from 'node:worker_threads';

parentPort?.on('message', () => {
  process.exit(7);
});
