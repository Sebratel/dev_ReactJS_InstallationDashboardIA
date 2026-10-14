import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { serveEstatico } from '../src/estatico.ts';

async function busca(webDir: string, rota: string): Promise<Response> {
  const servidor = http.createServer((_req, res) => serveEstatico(res, webDir, rota));
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const endereco = servidor.address() as { port: number };
  try {
    return await fetch(`http://127.0.0.1:${endereco.port}/`);
  } finally {
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
}

function buildDeTeste(): string {
  const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'estatico-'));
  fs.writeFileSync(path.join(webDir, 'index.html'), '<title>Analytics</title><div id="raiz"></div>');
  fs.mkdirSync(path.join(webDir, 'assets'));
  fs.writeFileSync(path.join(webDir, 'assets', 'app.js'), 'globalThis.__app = true;');
  return webDir;
}

test('rota direta de dashboard serve o index da SPA', async () => {
  const resposta = await busca(buildDeTeste(), '/visao-geral');
  assert.equal(resposta.status, 200);
  assert.match(await resposta.text(), /id="raiz"/);
});

test('asset existente é servido e asset ausente continua 404', async () => {
  const webDir = buildDeTeste();
  const existente = await busca(webDir, '/assets/app.js');
  assert.equal(existente.status, 200);
  assert.match(await existente.text(), /__app/);

  const ausente = await busca(webDir, '/assets/ausente.js');
  assert.equal(ausente.status, 404);
});

test('rota reservada aninhada não recebe o index da SPA', async () => {
  const resposta = await busca(buildDeTeste(), '/auth/google');
  assert.equal(resposta.status, 404);
});

test('prefixo parecido não permite sair do diretório estático', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'estatico-raiz-'));
  const webDir = path.join(raiz, 'dist');
  const irmao = path.join(raiz, 'dist-segredos');
  fs.mkdirSync(webDir);
  fs.mkdirSync(irmao);
  fs.writeFileSync(path.join(webDir, 'index.html'), '<div id="raiz"></div>');
  fs.writeFileSync(path.join(irmao, 'segredo.txt'), 'NAO-DEVE-SAIR');

  const resposta = await busca(webDir, '/../dist-segredos/segredo.txt');
  assert.equal(resposta.status, 403);
  assert.doesNotMatch(await resposta.text(), /NAO-DEVE-SAIR/);
});
