// escreveManifesto atômico (DEPLOY.md §4.2, ACHADOS #79) — mesma classe de teste que
// formato.test.ts: um handle de leitura já aberto no `manifesto.json` não pode
// impedir a escrita de publicar, nem ver conteúdo truncado enquanto ela acontece.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { escreveManifesto, leManifesto, type EntradaDeManifesto } from '../src/manifesto.ts';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'manifesto-'));
}

function entrada(query: string): EntradaDeManifesto {
  return { query, tabelas: [query], linhas: 10, colunas: 3, bytes: 100, geradoEm: '2026-08-07T12:00:00.000Z' };
}

async function esperaParcial(destino: string, maxMs = 2000): Promise<void> {
  const t0 = Date.now();
  while (!fs.existsSync(`${destino}.parcial`)) {
    if (Date.now() - t0 > maxMs) {
      throw new Error(`${destino}.parcial nunca apareceu — escreveManifesto atual não escreve num temporário.`);
    }
    await new Promise((r) => setImmediate(r));
  }
}

test('escreveManifesto: ida e volta simples', async () => {
  const dir = tmp();
  await escreveManifesto(dir, [entrada('q1'), entrada('q2')]);
  const m = leManifesto(dir);
  assert.ok(m);
  assert.equal(m!.tabelas.length, 2);
  assert.equal(m!.tabelas[0]!.query, 'q1');
});

test('escreveManifesto: não sobra manifesto.json.parcial depois de publicar', async () => {
  const dir = tmp();
  await escreveManifesto(dir, [entrada('q1')]);
  assert.equal(fs.existsSync(path.join(dir, 'manifesto.json.parcial')), false);
});

test('escreveManifesto: não corrompe uma leitura já aberta, e só publica depois dela', async () => {
  const dir = tmp();
  await escreveManifesto(dir, [entrada('velho')]);
  const destino = path.join(dir, 'manifesto.json');
  const original = fs.readFileSync(destino, 'utf8');

  const fd = fs.openSync(destino, 'r');
  const escritaPromise = escreveManifesto(dir, [entrada('novo')]);
  await esperaParcial(destino);

  const buf = Buffer.alloc(Buffer.byteLength(original));
  const lidos = fs.readSync(fd, buf, 0, buf.length, 0);
  assert.equal(buf.toString('utf8', 0, lidos), original);
  fs.closeSync(fd);

  await escritaPromise;
  const depois = leManifesto(dir);
  assert.equal(depois!.tabelas[0]!.query, 'novo');
});

test('escreveManifesto: uma reescrita rápida em cima de outra nunca deixa leManifesto ver JSON quebrado', async () => {
  // Não substitui um filho de verdade (processo separado) — dentro de um só processo
  // Node, um `fs.writeFileSync` síncrono nunca é observado pela metade por este mesmo
  // processo. O que este teste cobre é a costura que SOBREVIVE entre processos: a
  // sequência escreve-temp → renomeia, repetida em laço, nunca deixa `manifesto.json`
  // ausente nem com conteúdo que não seja JSON válido para quem lê entre uma
  // publicação e outra.
  const dir = tmp();
  const N = 30;
  let ultimaLeituraOk = true;
  const leituras = (async () => {
    for (let i = 0; i < N * 5 && ultimaLeituraOk; i++) {
      const m = leManifesto(dir);
      if (m !== null && !Array.isArray(m.tabelas)) ultimaLeituraOk = false;
      await new Promise((r) => setImmediate(r));
    }
  })();
  for (let i = 0; i < N; i++) {
    await escreveManifesto(dir, [entrada(`q${i}`)]);
  }
  await leituras;
  assert.ok(ultimaLeituraOk, 'leManifesto viu um manifesto sem tabelas — JSON parcial ou corrompido');
  assert.equal(leManifesto(dir)!.tabelas[0]!.query, `q${N - 1}`);
});
