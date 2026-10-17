// Uma worker que ANOTA a ordem das mensagens que recebe e responde na hora, sem calcular.
//
// Existe para provar ORDEM na fronteira com a worker: que a invalidação da troca de
// snapshot (`Servidor.soltaGeracoesVelhas`) chega a ela ANTES do primeiro cálculo do
// aquecimento. Quem lê a anotação é o teste, pelo arquivo em `ANOTA_MENSAGENS_EM` — a
// worker herda uma cópia do `process.env` do pai quando nasce, e um arquivo é o único
// canal que não passa pela mesma porta cuja ordem está sendo medida.
//
// Uma linha JSON por mensagem: `{ tipo, pagina, identidade? }`. Só nomes de página e a
// identidade (carimbo@dia): nenhum valor de linha.

import fs from 'node:fs';
import { parentPort } from 'node:worker_threads';
import type { MensagemParaWorker } from '../../src/worker-calculador.ts';

const arquivo = process.env.ANOTA_MENSAGENS_EM;

parentPort?.on('message', (msg: MensagemParaWorker) => {
  // A pergunta de memória da saúde (`memoria-da-saude.ts`) não é tarefa: estas workers
  // de fixture a ignoram, e a saúde as publica com `medida: null` — o caso "não respondeu".
  if (msg.tipo === 'memoria') return;
  if (msg.tipo === 'invalida') {
    if (arquivo) fs.appendFileSync(arquivo, `${JSON.stringify({ tipo: 'invalida', pagina: msg.dashboardId })}\n`);
    return;
  }
  if (arquivo) {
    fs.appendFileSync(
      arquivo,
      `${JSON.stringify({ tipo: msg.valores ? 'valores' : 'calcula', pagina: msg.dashboardSpec.id, identidade: msg.identidade })}\n`,
    );
  }
  parentPort?.postMessage(
    msg.valores
      ? { idReq: msg.idReq, ok: true, valores: [], dadoDe: null }
      : { idReq: msg.idReq, ok: true, pagina: { visuais: [] }, dadoDe: null, omitidas: [], linhasPorTabela: [] },
  );
});
