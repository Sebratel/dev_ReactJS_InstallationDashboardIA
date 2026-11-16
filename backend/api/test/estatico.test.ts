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

/**
 * QA D-03. `/.env` e `/.git/config` tinham de responder 404 — e o `.env` não
 * respondia: `path.extname('.env')` é string vazia (para o Node o ponto inicial é o
 * nome, não a extensão), então ele caía na casca da SPA e voltava 200.
 *
 * Não havia vazamento: o arquivo não existe no build e o corpo era o HTML do React.
 * O problema é o STATUS — um varredor lê 200 como "achei" e continua cavando.
 */
test('caminho que começa com ponto responde 404, nunca a casca da SPA', async () => {
  const webDir = buildDeTeste();
  for (const rota of ['/.env', '/.git/config', '/.htpasswd', '/.well-known/x']) {
    const resposta = await busca(webDir, rota);
    assert.equal(resposta.status, 404, `${rota} devia ser 404`);
    assert.doesNotMatch(await resposta.text(), /id="raiz"/, `${rota} devolveu a tela`);
  }
});

test('rota normal da tela continua recebendo o index', async () => {
  // A guarda do D-03 olha o último segmento: `/premiacao-instalacao` não começa com
  // ponto e continua sendo rota da SPA.
  const resposta = await busca(buildDeTeste(), '/premiacao-instalacao');
  assert.equal(resposta.status, 200);
  assert.match(await resposta.text(), /id="raiz"/);
});
