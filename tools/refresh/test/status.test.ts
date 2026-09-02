import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { escreveStatus, leStatus, type StatusDeRefresh } from '../src/status.ts';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-status-'));
}

test('sem o arquivo, status vazio — não é erro', () => {
  assert.deepEqual(leStatus(tmp()), {});
});

test('ida e volta simples', async () => {
  const dir = tmp();
  const status: StatusDeRefresh = {
    quente: { ultimaTentativa: 'a', ultimoSucesso: 'a', duracaoMs: 100, ok: true, falhasConsecutivas: 0 },
  };
  await escreveStatus(dir, status);
  assert.deepEqual(leStatus(dir), status);
});

test('não sobra refresh-status.json.parcial depois de publicar', async () => {
  const dir = tmp();
  await escreveStatus(dir, {});
  assert.equal(fs.existsSync(path.join(dir, 'refresh-status.json.parcial')), false);
});

test('JSON corrompido no disco devolve vazio em vez de derrubar quem lê', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'refresh-status.json'), '{ isto não é json', 'utf8');
  assert.deepEqual(leStatus(dir), {});
});

test('escreveStatus não corrompe uma leitura já aberta, e só publica depois dela', async () => {
  const dir = tmp();
  await escreveStatus(dir, { a: { ultimaTentativa: '1', ultimoSucesso: '1', duracaoMs: 1, ok: true, falhasConsecutivas: 0 } });
  const destino = path.join(dir, 'refresh-status.json');
  const original = fs.readFileSync(destino, 'utf8');

  const fd = fs.openSync(destino, 'r');
  const escritaPromise = escreveStatus(dir, {
    b: { ultimaTentativa: '2', ultimoSucesso: '2', duracaoMs: 2, ok: true, falhasConsecutivas: 0 },
  });

  const t0 = Date.now();
  while (!fs.existsSync(`${destino}.parcial`)) {
    if (Date.now() - t0 > 2000) throw new Error('.parcial nunca apareceu');
    await new Promise((r) => setImmediate(r));
  }

  const buf = Buffer.alloc(Buffer.byteLength(original));
  const lidos = fs.readSync(fd, buf, 0, buf.length, 0);
  assert.equal(buf.toString('utf8', 0, lidos), original);
  fs.closeSync(fd);

  await escritaPromise;
  assert.deepEqual(Object.keys(leStatus(dir)), ['b']);
});
