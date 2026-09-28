// Desligamento limpo — ver o cabeçalho de `../src/desligamento.ts`.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fechaHttp, instalaDesligamento } from '../src/desligamento.ts';

function processoFalso(): EventEmitter & Pick<NodeJS.Process, 'once'> {
  return new EventEmitter() as EventEmitter & Pick<NodeJS.Process, 'once'>;
}

test('desligamento: roda os passos em ordem, um que lança não para os outros, e sai 0', async () => {
  const feitos: string[] = [];
  const saidas: number[] = [];
  const desliga = instalaDesligamento({
    processo: processoFalso(),
    anuncia: () => {},
    sai: (c) => void saidas.push(c),
    passos: [
      { nome: 'a', fn: () => void feitos.push('a') },
      { nome: 'quebra', fn: () => {
        throw new Error('x');
      } },
      { nome: 'b', fn: async () => void feitos.push('b') },
    ],
  });
  await desliga('SIGTERM');
  assert.deepEqual(feitos, ['a', 'b']);
  assert.deepEqual(saidas, [0]);
});

test('desligamento: passo que emperra estoura o teto e sai 1', async () => {
  const saidas: number[] = [];
  const desliga = instalaDesligamento({
    processo: processoFalso(),
    anuncia: () => {},
    tetoMs: 30,
    sai: (c) => void saidas.push(c),
    passos: [{ nome: 'emperra', fn: () => new Promise<void>(() => {}) }],
  });
  void desliga('SIGTERM');
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(saidas, [1]);
});

test('desligamento: segundo sinal sai na hora', async () => {
  const saidas: number[] = [];
  const proc = processoFalso();
  instalaDesligamento({
    processo: proc,
    anuncia: () => {},
    sai: (c) => void saidas.push(c),
    passos: [{ nome: 'demora', fn: () => new Promise<void>(() => {}) }],
  });
  proc.emit('SIGTERM');
  proc.emit('SIGINT');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(saidas, [1], 'Ctrl+C duas vezes é alguém com pressa');
});

test('fechaHttp: corta a conexão que nunca termina sozinha (SSE) depois da folga', async () => {
  const srv = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(': conectado\n\n'); // e nunca termina, como /api/eventos
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const { port } = srv.address() as { port: number };
  const req = http.get(`http://127.0.0.1:${port}/`);
  await new Promise<void>((ok) => req.once('response', () => ok()));
  req.on('error', () => {}); // o corte chega aqui como ECONNRESET — é o esperado

  const inicio = Date.now();
  await fechaHttp(srv, 100);
  const levou = Date.now() - inicio;
  assert.ok(levou >= 90 && levou < 2_000, `fechou em ${levou} ms`);
});

// SIGTERM de verdade só existe fora do Windows: lá `kill()` é TerminateProcess e nenhum
// tratador roda. O CI (Linux) é quem prova este.
test('desligamento: SIGTERM real num processo de verdade sai 0 e diz por quê', {
  skip: process.platform === 'win32' && 'sem SIGTERM entregável no Windows',
}, async () => {
  const modulo = pathToFileURL(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'desligamento.ts'),
  ).href;
  const script =
    `import { instalaDesligamento } from ${JSON.stringify(modulo)};\n` +
    `instalaDesligamento({ passos: [{ nome: 'x', fn: () => {} }] });\n` +
    `console.log('pronto'); setInterval(() => {}, 1000);`;
  const filho = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  filho.stderr.on('data', (d) => (err += d));
  await new Promise<void>((ok) => filho.stdout.once('data', () => ok()));
  filho.kill('SIGTERM');
  const codigo = await new Promise<number | null>((ok) => filho.once('exit', (c) => ok(c)));
  assert.equal(codigo, 0);
  assert.match(err, /\[desligamento\] SIGTERM recebido/);
  assert.match(err, /\[desligamento\] encerrado em/);
});
