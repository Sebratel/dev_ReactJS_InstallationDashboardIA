// A busca ao vivo num processo filho (`geracao-em-processo.ts`). O filho de verdade fala
// com o SRD; aqui o processo é falso, e o que se prova é o contrato com ele: o argv (heap
// e pedido), a leitura do resultado, e que toda saída ruim vira erro com motivo — nunca
// uma promessa pendurada nem a API derrubada.

import assert from 'node:assert/strict';
import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { PedidoDeGeracao } from '../src/geracao-do-conjunto.ts';
import { argvDoFilho, geraEmProcesso, heapDoFilhoMB, HEAP_DO_CONJUNTO_MB } from '../src/geracao-em-processo.ts';

const PEDIDO: PedidoDeGeracao = {
  conjunto: 'janela',
  paginas: ['visao-geral'],
  periodo: { desde: '2025-01-01', ate: '2027-01-01' },
  dir: 'C:/tmp/ao-vivo/janela/2025-01-01_x',
  snapshotDir: 'C:/repo/snapshot',
  agoraIso: '2026-10-24T20:00:00.000Z',
};

/** Um processo falso: emite o que o roteiro mandar, e anota o argv e os sinais. */
function falso(roteiro: (f: FilhoFalso) => void) {
  const chamadas: { argv: readonly string[] }[] = [];
  const mortes: string[] = [];
  const cria = ((_bin: string, argv: readonly string[]) => {
    chamadas.push({ argv });
    const f = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: (s?: string) => {
        mortes.push(s ?? 'SIGTERM');
        setImmediate(() => f.emit('exit', null, s ?? 'SIGTERM'));
        return true;
      },
    });
    setImmediate(() => roteiro(f));
    return f;
  }) as unknown as typeof spawn;
  return { cria, chamadas, mortes };
}
type FilhoFalso = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };

test('o argv leva o teto de heap do conjunto, o filho e o pedido em JSON', () => {
  const argv = argvDoFilho(PEDIDO, heapDoFilhoMB(PEDIDO.conjunto));
  assert.equal(argv[0], `--max-old-space-size=${HEAP_DO_CONJUNTO_MB}`);
  assert.match(argv[1]!, /filho-ao-vivo\.ts$/);
  assert.deepEqual(JSON.parse(argv[2]!), PEDIDO);
  // O mês da agenda tinha 384 MB até trazer a agenda completa (25/10/2026): ele cabe em 800
  // e não em 640, como os outros dois.
  for (const c of ['agenda', 'ano', 'janela'] as const) assert.equal(heapDoFilhoMB(c), HEAP_DO_CONJUNTO_MB);
});

test('saída 0: a última linha da saída padrão é o resultado, com o pico de memória', async () => {
  const p = falso((f) => {
    f.stdout.emit('data', 'uma linha de progresso\n');
    f.stdout.emit('data', '{"protocolos":100878,"picoMB":902}\n');
    f.emit('exit', 0, null);
  });
  assert.deepEqual(await geraEmProcesso('C:/repo', PEDIDO, { heapMB: 1024, cria: p.cria }), { protocolos: 100878, picoMB: 902 });
  assert.equal(p.chamadas[0]!.argv[0], '--max-old-space-size=1024');
});

test('estouro de heap no filho vira erro com o motivo, sem as linhas de endereço da pilha nativa', async () => {
  const p = falso((f) => {
    f.stderr.emit(
      'data',
      'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n' +
        '----- Native stack trace -----\n' +
        ' 1: 00007FF6875DAC46 node::Algo+138630\n' +
        ' 2: 00007FF6875E2B16 v8::Outro+171094\n',
    );
    f.emit('exit', 134, null);
  });
  await assert.rejects(
    geraEmProcesso('C:/repo', PEDIDO, { cria: p.cria }),
    (e: Error) => /saiu com 134/.test(e.message) && /heap out of memory/.test(e.message) && !/00007FF/.test(e.message),
  );
});

test('exceção no filho: a mensagem chega, e não o fim da pilha', async () => {
  const p = falso((f) => {
    f.stderr.emit(
      'data',
      'file:///C:/repo/backend/api/src/geracao-do-conjunto.ts:62\n' +
        '      const dados = await buscaDoPeriodo(ctx, p.periodo, agora);\n' +
        '                    ^\n\n' +
        'Error: canceling statement due to statement timeout\n' +
        '    at Pool.query (file:///C:/repo/node_modules/pg/lib/pool.js:1:1)\n' +
        '    at async file:///C:/repo/backend/api/src/geracao-do-conjunto.ts:62:21\n' +
        '}\n\nNode.js v22.23.2\n',
    );
    f.emit('exit', 1, null);
  });
  await assert.rejects(geraEmProcesso('C:/repo', PEDIDO, { cria: p.cria }), (e: Error) =>
    /statement timeout/.test(e.message) && !/at async/.test(e.message) && !/Node\.js v/.test(e.message),
  );
});

test('saída 0 sem resultado, prazo estourado e processo que não sobe: todos viram erro', async () => {
  const mudo = falso((f) => f.emit('exit', 0, null));
  await assert.rejects(geraEmProcesso('C:/repo', PEDIDO, { cria: mudo.cria }), /sem dizer o que trouxe/);

  // O prazo é um timer `unref`; o processo de verdade segura o laço de eventos, este falso
  // não — sem um timer próprio, o runner encerraria o arquivo antes do prazo (ACHADOS #243).
  const segura = setTimeout(() => undefined, 5_000);
  const parado = falso(() => undefined);
  await assert.rejects(geraEmProcesso('C:/repo', PEDIDO, { cria: parado.cria, tempoMaximoMs: 20 }), /passou de 0 s/);
  clearTimeout(segura);
  assert.deepEqual(parado.mortes, ['SIGKILL']);

  const semBinario = falso((f) => f.emit('error', new Error('spawn ENOENT')));
  await assert.rejects(geraEmProcesso('C:/repo', PEDIDO, { cria: semBinario.cria }), /ENOENT/);
});
