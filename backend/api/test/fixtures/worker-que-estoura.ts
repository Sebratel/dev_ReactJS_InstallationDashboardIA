// Uma worker que ESTOURA o heap ao receber a primeira mensagem.
//
// É a morte de produção de verdade: `resourceLimits.maxOldGenerationSizeMb`
// atingido no meio de um cálculo, o Node emitindo `'error'` com
// `ERR_WORKER_OUT_OF_MEMORY` e só depois `'exit'`. As outras fixtures morrem
// por `process.exit`, que só produz `'exit'` — esta é a que prova que a piscina
// registra o motivo certo e conta UMA morte, não duas.

import { parentPort } from 'node:worker_threads';

parentPort?.on('message', (msg: { tipo?: string }) => {
  // A pergunta de memória da saúde não é tarefa: estourar com ela mataria a worker à toa.
  if (msg?.tipo === 'memoria') return;
  const guarda: number[][] = [];
  for (;;) guarda.push(Array.from({ length: 100_000 }, (_, i) => i));
});
