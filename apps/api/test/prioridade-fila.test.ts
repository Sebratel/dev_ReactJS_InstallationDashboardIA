// A fila com prioridade: `interactive` > `prefetch` > `warmup`.
//
// **O problema que ela resolve.** Depois da F2, N pedidos iguais viraram 1
// cálculo — a duplicação horizontal acabou. Restava a competição vertical:
//
//     fila da piscina (FIFO, 2 workers, página fria custa 10–20 s)
//       1. warmup   página A
//       2. warmup   página B
//       3. warmup   página C
//       4. prefetch página D
//       5. CLIQUE DO USUÁRIO
//
// Com FIFO, o clique espera atrás de trabalho que ninguém pediu naquele
// instante. Numa piscina de duas workers e um cálculo de 10 s, isso é meio
// minuto de espera por trabalho de fundo.
//
// **Três classes, sem peso, sem envelhecimento, sem cota** — decisão com o Erick
// em 08/09/2026: prioridade pura primeiro, medir, e só então discutir fairness.
// Inanição de `warmup` é um risco real, e a resposta a ele é o `p95` de
// `fila_ms_warmup` em `GET /api/saude`, não um mecanismo escrito antes do número.
//
// A política é testada em dois níveis: a estrutura sozinha (sem thread nenhuma)
// e a piscina de verdade, com workers e mensagens.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { FilaDePrioridade, PiscinaWorkers, type MedidaDaTarefa } from '../src/piscina-workers.ts';
import { ORIGENS, origemDoPedido, prioridadeDe } from '../src/metricas.ts';
import { ESCOPO_TODOS } from '../src/escopo-cache.ts';
import type { MensagemCalculoWorker } from '../src/worker-calculador.ts';
import type { DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const LENTO = path.join(AQUI, 'fixtures', 'worker-lento.ts');

const INTERACTIVE = prioridadeDe('interactive');
const PREFETCH = prioridadeDe('prefetch');
const WARMUP = prioridadeDe('warmup');

/** Uma mensagem válida em forma; `janela.de` é a demora da worker de fixture. */
function tarefa(demoraMs: number): Omit<MensagemCalculoWorker, 'idReq'> {
  return {
    snapshotDir: path.join(AQUI, 'nao-existe'),
    specsDir: path.join(AQUI, 'nao-existe'),
    dashboardSpec: { id: 'fixture', name: 'fixture', visuals: [] } as unknown as DashboardSpec,
    janela: { de: demoraMs, linhas: 10 },
    clicados: [],
    agoraIso: '2026-09-08T12:00:00.000Z',
    identidade: 'fixture@2026-09-08',
    escopo: ESCOPO_TODOS,
  };
}

// ------------------------------------------------------- a estrutura sozinha

test('a classe mais urgente sai primeiro, mesmo tendo chegado por último', () => {
  const f = new FilaDePrioridade<{ prioridade: number; nome: string }>(3);
  f.entra({ prioridade: WARMUP, nome: 'warmup-A' });
  f.entra({ prioridade: WARMUP, nome: 'warmup-B' });
  f.entra({ prioridade: PREFETCH, nome: 'prefetch' });
  f.entra({ prioridade: INTERACTIVE, nome: 'CLIQUE' });

  assert.deepEqual(
    [f.sai()?.nome, f.sai()?.nome, f.sai()?.nome, f.sai()?.nome],
    ['CLIQUE', 'prefetch', 'warmup-A', 'warmup-B'],
  );
  assert.equal(f.sai(), undefined, 'fila vazia devolve undefined, não estoura');
});

test('dentro da MESMA classe a ordem é de chegada — e é a estrutura que garante isso', () => {
  // Uma fila por classe faz o desempate por chegada ser a própria estrutura, em
  // vez de uma comparação que alguém pode trocar por engano. Um array único
  // ordenado por inserção é fácil de escrever de um jeito que inverte empates,
  // e o sintoma seria "às vezes a página que pedi primeiro chega depois".
  const f = new FilaDePrioridade<{ prioridade: number; nome: string }>(3);
  for (const nome of ['a', 'b', 'c', 'd']) f.entra({ prioridade: WARMUP, nome });
  assert.deepEqual([f.sai()?.nome, f.sai()?.nome, f.sai()?.nome, f.sai()?.nome], ['a', 'b', 'c', 'd']);
});

test('prioridade fora da faixa cai na classe MENOS urgente, nunca na mais', () => {
  // O erro tem de doer no lado certo: um rótulo desconhecido virando
  // `interactive` deixaria trabalho de fundo furar a fila do usuário — que é
  // exatamente o que esta fase existe para impedir.
  const f = new FilaDePrioridade<{ prioridade: number; nome: string }>(3);
  f.entra({ prioridade: 99, nome: 'desconhecida' });
  f.entra({ prioridade: INTERACTIVE, nome: 'clique' });
  f.entra({ prioridade: -5, nome: 'negativa' });
  // A `desconhecida` chegou PRIMEIRO e sai por último: saturar para cima é o que
  // impede um rótulo estranho de furar a fila de quem está clicando.
  assert.equal(f.sai()?.nome, 'clique');
  assert.equal(f.sai()?.nome, 'negativa', 'abaixo de zero satura em interactive, atrás de quem já estava');
  assert.equal(f.sai()?.nome, 'desconhecida');
});

test('porClasse e tamanho descrevem a fila; drena esvazia da mais urgente para a menos', () => {
  const f = new FilaDePrioridade<{ prioridade: number; nome: string }>(3);
  f.entra({ prioridade: WARMUP, nome: 'w1' });
  f.entra({ prioridade: WARMUP, nome: 'w2' });
  f.entra({ prioridade: INTERACTIVE, nome: 'i1' });
  // `[0, 1, 5]` diz que ninguém está esperando; uma fila de 6 não diz nada.
  assert.deepEqual(f.porClasse(), [1, 0, 2]);
  assert.equal(f.tamanho, 3);
  assert.deepEqual(f.drena().map((x) => x.nome), ['i1', 'w1', 'w2']);
  assert.equal(f.tamanho, 0);
});

// ---------------------------------------------------------- a piscina de verdade

test('na piscina real, o CLIQUE que chega por último roda em segundo', async () => {
  // Uma worker só, quatro tarefas enfileiradas no mesmo tick: a primeira é
  // despachada na hora e as outras três disputam a vez. O clique chegou por
  // último e tem de rodar logo depois da que já estava na worker — não há como
  // furar o que já foi despachado, e é justamente por isso que a piscina é
  // pequena e o cálculo é longo neste projeto.
  const p = new PiscinaWorkers({ tamanhoPool: 1, scriptDaWorker: LENTO });
  try {
    const ordem: string[] = [];
    const roda = (nome: string, prioridade: number): Promise<void> =>
      p.executa(tarefa(40), prioridade).then(() => {
        ordem.push(nome);
      });

    await Promise.all([
      roda('warmup-A', WARMUP),
      roda('warmup-B', WARMUP),
      roda('prefetch', PREFETCH),
      roda('CLIQUE', INTERACTIVE),
    ]);

    assert.deepEqual(ordem, ['warmup-A', 'CLIQUE', 'prefetch', 'warmup-B']);
  } finally {
    p.destroi();
  }
});

test('controle: sem prioridade, a MESMA piscina é o FIFO de antes da F3', async () => {
  // O `executa(msg)` de um parâmetro só continua existindo e continua valendo 0.
  // É por isso que nenhum chamador antigo precisou mudar — e este teste é o que
  // garante que "não passar prioridade" não virou "prioridade indefinida".
  const p = new PiscinaWorkers({ tamanhoPool: 1, scriptDaWorker: LENTO });
  try {
    const ordem: string[] = [];
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((nome) =>
        p.executa(tarefa(20)).then(() => {
          ordem.push(nome);
        }),
      ),
    );
    assert.deepEqual(ordem, ['a', 'b', 'c', 'd']);
  } finally {
    p.destroi();
  }
});

test('medeCom separa ESPERA de EXECUÇÃO, e a espera do clique é menor que a do warmup', async () => {
  // A conta que a F3 precisa separar. `worker_ms` mede a soma e não distingue
  // "o cálculo é caro" de "o clique ficou atrás de três aquecimentos" — dois
  // problemas com consertos diferentes. Só a piscina sabe quando a tarefa saiu
  // da fila.
  const p = new PiscinaWorkers({ tamanhoPool: 1, scriptDaWorker: LENTO });
  try {
    const medidas: MedidaDaTarefa[] = [];
    p.medeCom((m) => medidas.push(m));

    await Promise.all([
      p.executa(tarefa(60), WARMUP),
      p.executa(tarefa(60), WARMUP),
      p.executa(tarefa(60), WARMUP),
      p.executa(tarefa(60), INTERACTIVE),
    ]);

    assert.equal(medidas.length, 4, 'toda tarefa que termina tem de ser medida');

    const doClique = medidas.find((m) => m.prioridade === INTERACTIVE)!;
    const dosWarmups = medidas.filter((m) => m.prioridade === WARMUP);
    const piorWarmup = Math.max(...dosWarmups.map((m) => m.esperaMs));

    assert.ok(
      doClique.esperaMs < piorWarmup,
      `o clique esperou ${doClique.esperaMs} ms e o pior warmup ${piorWarmup} ms — ` +
        `a prioridade não está ordenando a fila`,
    );
    // A execução NÃO muda com prioridade: reordenar a fila não deixa o cálculo
    // mais rápido, e prometer isso seria o começo de uma expectativa errada.
    for (const m of medidas) {
      assert.ok(m.execucaoMs >= 50, `execução medida em ${m.execucaoMs} ms, esperava ~60`);
    }
  } finally {
    p.destroi();
  }
});

// -------------------------------------------------------------- classificação

test('um pedido pode REBAIXAR a si mesmo, e a promoção não existe para ser defendida', () => {
  // `?origem=` é auto-declarado, e por isso só desce. O pior que um cliente
  // consegue fazer com ele é atrasar a si mesmo; `interactive` já é o padrão de
  // quem não declara nada, então não há o que ganhar mentindo.
  assert.equal(origemDoPedido(false, null), 'interactive');
  assert.equal(origemDoPedido(false, 'prefetch'), 'prefetch');
  assert.equal(origemDoPedido(false, 'warmup'), 'warmup');
  assert.equal(origemDoPedido(false, 'interactive'), 'interactive');
  assert.equal(origemDoPedido(false, 'qualquer-coisa'), 'interactive', 'o desconhecido é o padrão');
  // O Aquecedor é reconhecido pelo cabeçalho que já o autentica, não por um
  // segundo canal — e ele vence qualquer `?origem=` da URL.
  assert.equal(origemDoPedido(true, null), 'warmup');
  assert.equal(origemDoPedido(true, 'interactive'), 'warmup', 'o aquecedor não se promove');
});

test('a ordem das classes é a que a fila usa, e ORIGENS é a única tabela', () => {
  // Dois lugares declarando a mesma ordem divergem no primeiro conserto: a
  // piscina devolve o número, o servidor traduz com `ORIGENS[n]`, e é este
  // teste que amarra os dois.
  assert.deepEqual([...ORIGENS], ['interactive', 'prefetch', 'warmup']);
  assert.ok(prioridadeDe('interactive') < prioridadeDe('prefetch'));
  assert.ok(prioridadeDe('prefetch') < prioridadeDe('warmup'));
  for (const o of ORIGENS) assert.equal(ORIGENS[prioridadeDe(o)], o);
});
