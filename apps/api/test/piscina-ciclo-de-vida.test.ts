// O ciclo de vida da worker: quem morre tem de REJEITAR o que estava fazendo.
//
// **O defeito que estes testes guardam foi medido, não imaginado.** Em
// 08/09/2026, com o handler de `exit` apenas tirando a worker das listas:
//
//     estado da promessa 2 s depois de matar a worker: PENDENTE
//
// Ninguém recebia erro, ninguém recebia resposta — o pedido simplesmente não
// terminava, e a conexão HTTP ficava aberta até o navegador desistir.
//
// **E o single-flight (F2) multiplicou o estrago.** Antes, uma worker morta
// pendurava UM pedido. Agora ela pendura o voo daquela chave, e todo pedido
// seguinte da mesma chave entra nesse voo: uma morte de worker passa a travar a
// PÁGINA inteira, para todo mundo, até o carimbo do snapshot mudar. Foi por isso
// que o conserto entrou junto com a F2, e é por isso que ele merece teste
// próprio em vez da sonda manual que o encontrou — sonda não fica vermelha
// quando alguém apaga o handler.
//
// Por que uma worker de fixture, e não o calculador de verdade: em produção a
// morte vem de estouro do heap de 768 MB no meio de um cálculo de 10–20 s sobre
// um snapshot real, que nenhum teste de unidade vai reproduzir. `scriptDaWorker`
// troca o calculador por duas linhas que morrem na primeira mensagem, e a
// afirmação passa a ser sobre a piscina.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PiscinaWorkers } from '../src/piscina-workers.ts';
import type { MensagemCalculoWorker } from '../src/worker-calculador.ts';
import type { DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MORRE = path.join(AQUI, 'fixtures', 'worker-que-morre.ts');
const RESPONDE = path.join(AQUI, 'fixtures', 'worker-que-responde.ts');

/** Uma mensagem válida em forma; nenhuma destas workers de fixture a lê. */
const TAREFA: Omit<MensagemCalculoWorker, 'idReq'> = {
  snapshotDir: path.join(AQUI, 'nao-existe'),
  specsDir: path.join(AQUI, 'nao-existe'),
  dashboardSpec: { id: 'fixture', name: 'fixture', visuals: [] } as unknown as DashboardSpec,
  janela: { de: 0, linhas: 10 },
  clicados: [],
  agoraIso: '2026-09-08T12:00:00.000Z',
};

/**
 * Falha com uma mensagem legível em vez de pendurar a suíte.
 *
 * É o ponto todo destes testes: sem prazo, remover o handler de `exit` não
 * deixaria nada VERMELHO — deixaria `node --test` parado, que é justamente o
 * sintoma que estamos consertando, e o pior tipo de teste que existe.
 */
function comPrazo<T>(p: Promise<T>, ms: number, oQue: string): Promise<T> {
  let t: NodeJS.Timeout;
  // O temporizador fica REFERENCIADO: o caso que ele existe para pegar é
  // "tarefa pendente e worker morta", ou seja, exatamente quando não há mais
  // nada segurando o event loop. Um prazo que se deixa desreferenciar pode não
  // chegar a disparar justamente aí. O `clearTimeout` devolve a saída limpa
  // quando o caso feliz vence a corrida.
  const prazo = new Promise<never>((_, erro) => {
    t = setTimeout(
      () => erro(new Error(`${oQue}: nada aconteceu em ${ms} ms — a promessa ficou PENDENTE`)),
      ms,
    );
  });
  return Promise.race([p, prazo]).finally(() => clearTimeout(t));
}

/** Espera uma condição virar verdadeira, sem `setTimeout` chutado. */
async function ate(cond: () => boolean, ms = 4000): Promise<void> {
  const limite = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > limite) throw new Error('a condição não se cumpriu no prazo');
    await new Promise((ok) => setImmediate(ok));
  }
}

test('a worker que MORRE com tarefa em curso REJEITA a tarefa', async () => {
  const p = new PiscinaWorkers({ tamanhoPool: 1, scriptDaWorker: MORRE });
  try {
    const erro = await comPrazo(
      p.executa(TAREFA).then(
        () => new Error('resolveu — a worker morreu sem responder, isto não podia ter dado certo'),
        (e: Error) => e,
      ),
      5000,
      'a tarefa da worker morta',
    );
    // A mensagem carrega o código de saída porque é o que distingue, no log de
    // produção, uma worker morta pelo OOM de uma que terminou sozinha.
    assert.match(erro.message, /terminou com código 7/);
  } finally {
    p.destroi();
  }
});

test('com a piscina inteira morta, a FILA também é rejeitada em vez de ficar pendurada', async () => {
  // A fila só anda em `processaFila`, chamada quando uma worker termina. Sem
  // worker nenhuma viva, ninguém mais a chama — cada tarefa enfileirada seria
  // uma promessa que nunca resolve. E sob single-flight cada uma dessas é um
  // voo, com N pedidos HTTP dependurados nele.
  const p = new PiscinaWorkers({ tamanhoPool: 1, scriptDaWorker: MORRE });
  try {
    const tres = Array.from({ length: 3 }, () =>
      p.executa(TAREFA).then(
        () => null,
        (e: Error) => e,
      ),
    );
    // A primeira foi para a worker; as outras duas ficaram na fila.
    assert.equal(p.estado.fila, 2);
    assert.equal(p.estado.ocupados, 1);

    const erros = await comPrazo(Promise.all(tres), 5000, 'a fila da piscina morta');
    for (const e of erros) assert.ok(e instanceof Error, 'toda tarefa presa tinha de ter sido rejeitada');
    assert.equal(p.estado.fila, 0, 'a fila não pode ficar com tarefa nenhuma pendurada');
  } finally {
    p.destroi();
  }
});

test('perdidas todas as workers, a piscina se declara INATIVA e o pedido seguinte falha na hora', async () => {
  // O que faz a degradação funcionar: `Servidor.pagina()` só entra no ramo da
  // worker se `piscina.ativa`. Com a piscina se declarando morta, os pedidos
  // seguintes vão direto para o cálculo em linha — mais devagar, e respondendo.
  const p = new PiscinaWorkers({ tamanhoPool: 1, scriptDaWorker: MORRE });
  try {
    // Disparada e não esperada, de propósito: com o conserto REMOVIDO esta
    // promessa nunca termina, e um `await` aqui penduraria o arquivo de teste
    // inteiro em vez de deixar este caso vermelho. O destino da tarefa é o que
    // o primeiro teste afirma; o que se afirma aqui é o estado da piscina.
    void p.executa(TAREFA).catch(() => undefined);
    await ate(() => !p.ativa);
    assert.equal(p.ativa, false);
    await assert.rejects(() => p.executa(TAREFA), /desativada ou indisponível/);
  } finally {
    p.destroi();
  }
});

test('controle: com a worker respondendo, a piscina resolve e a fila anda', async () => {
  // Sem este, os três testes acima passariam numa piscina que rejeita TUDO — e
  // "tudo falha" não é a garantia que se quer.
  const p = new PiscinaWorkers({ tamanhoPool: 1, scriptDaWorker: RESPONDE });
  try {
    const duas = await comPrazo(
      Promise.all([p.executa(TAREFA), p.executa(TAREFA)]),
      5000,
      'as duas tarefas na worker que responde',
    );
    for (const r of duas) assert.equal(r.ok, true);
    // Duas tarefas, uma worker: a segunda passou pela fila. Se `processaFila`
    // parasse de ser chamada no `'message'`, ela nunca teria sido despachada.
    assert.equal(p.estado.fila, 0);
    assert.equal(p.estado.ocupados, 0);
    assert.equal(p.ativa, true);
  } finally {
    p.destroi();
  }
});
