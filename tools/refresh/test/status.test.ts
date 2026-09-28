import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { escreveStatus, leStatus, montaStatusDeRefresh, resumeDegradacao, type StatusDeRefresh } from '../src/status.ts';

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

// Só no Windows — ver o mesmo teste em packages/snapshot/test/manifesto.test.ts.
test('escreveStatus não corrompe uma leitura já aberta, e só publica depois dela', {
  skip: process.platform !== 'win32' && 'semântica de rename do Windows',
}, async () => {
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

test('montaStatusDeRefresh expõe queries[] com status, idades e falhas (Contrato A2 <-> A6)', async () => {
  const dir = tmp();
  const agora = new Date('2026-09-04T12:00:00.000Z');

  // Grupo quente falhou com ECONNRESET, grupo medio teve sucesso recente
  await escreveStatus(dir, {
    quente: {
      ultimaTentativa: '2026-09-04T11:50:00.000Z',
      ultimoSucesso: '2026-09-03T12:00:00.000Z',
      duracaoMs: 5000,
      ok: false,
      falhasConsecutivas: 2,
      erro: 'ECONNRESET',
    },
    medio: {
      ultimaTentativa: '2026-09-04T11:40:00.000Z',
      ultimoSucesso: '2026-09-04T11:40:00.000Z',
      duracaoMs: 12000,
      ok: true,
      falhasConsecutivas: 0,
    },
  });

  const specsDir = path.resolve('specs');
  const res = montaStatusDeRefresh(dir, specsDir, agora);
  assert.ok(Array.isArray(res.queries));
  assert.ok(res.queries.length > 0);

  // Queries do grupo quente (ex: contratos) devem herdar a falha do grupo
  const contratos = res.queries.find((q) => q.id === 'contratos');
  assert.ok(contratos);
  assert.equal(contratos.status, 'falhou');
  assert.equal(contratos.erro, 'ECONNRESET');

  // Queries do grupo medio (ex: troca-endereco) devem estar ok com última carga recente
  const trocaEndereco = res.queries.find((q) => q.id === 'troca-endereco');
  assert.ok(trocaEndereco);
  assert.equal(trocaEndereco.status, 'ok');
  assert.equal(trocaEndereco.idadeDias, 0);

  // protocolos-produtividade sem carga recente entra como vencida
  const prod = res.queries.find((q) => q.id === 'protocolos-produtividade');
  assert.ok(prod);
  assert.equal(prod.status, 'vencida');
});

// ------------------------------------------------ "parado" e "falhando" (ACHADOS #160)

const verde = (iso: string) => ({ ultimaTentativa: iso, ultimoSucesso: iso, duracaoMs: 1, ok: true, falhasConsecutivas: 0 });

test('UMA falha com o último sucesso dentro da régua não acende — é soluço, o ciclo seguinte tenta', async () => {
  const dir = tmp();
  const agora = new Date('2026-09-28T12:00:00.000Z');
  await escreveStatus(dir, {
    quente: { ultimaTentativa: '2026-09-28T11:58:00.000Z', ultimoSucesso: '2026-09-28T11:45:00.000Z', duracaoMs: 1, ok: false, falhasConsecutivas: 1, erro: 'ECONNRESET' },
  });
  const q = montaStatusDeRefresh(dir, path.resolve('specs'), agora).queries!.find((x) => x.id === 'contratos')!;
  assert.equal(q.status, 'ok', 'até 28/09 isto acendia "carga falhou" por uma falha só');
});

test('grupo PARADO além de 2× o intervalo vira vencida, com a hora do último sucesso — mesmo sem falha', async () => {
  // O caso do #129: nada falhou, nada rodou. Com a régua de 2 DIAS, isto saía ok.
  const dir = tmp();
  const agora = new Date('2026-09-28T12:00:00.000Z');
  await escreveStatus(dir, { quente: verde('2026-09-28T11:29:00.000Z'), medio: verde('2026-09-28T11:30:00.000Z') });
  const qs = montaStatusDeRefresh(dir, path.resolve('specs'), agora).queries!;
  const contratos = qs.find((x) => x.id === 'contratos')!; // quente, 15 min → régua 30 min
  assert.equal(contratos.status, 'vencida');
  assert.equal(contratos.paradaDesde, '2026-09-28T11:29:00.000Z');
  assert.equal(contratos.grupo, 'quente');
  const troca = qs.find((x) => x.id === 'troca-endereco')!; // medio, 20 min → régua 40 min
  assert.equal(troca.status, 'ok');
  assert.equal(troca.paradaDesde, undefined);
});

test('resumeDegradacao: um motivo por grupo, não um por query', () => {
  const r = resumeDegradacao([
    { id: 'a', idadeDias: 0, status: 'falhou', erro: 'X', grupo: 'medio' },
    { id: 'b', idadeDias: 0, status: 'falhou', erro: 'X', grupo: 'medio' },
    { id: 'c', idadeDias: 0, status: 'vencida', grupo: 'quente', paradaDesde: '2026-09-28T11:29:00.000Z' },
    { id: 'd', idadeDias: 0, status: 'ok', grupo: 'frio' },
  ]);
  assert.equal(r.degradado, true);
  assert.deepEqual(r.motivos, [
    'grupo medio (2 queries): falhando seguido — X',
    'grupo quente (1 queries): parado desde 2026-09-28T11:29:00.000Z',
  ]);
  assert.deepEqual(resumeDegradacao([{ id: 'd', idadeDias: 0, status: 'ok' }]), { degradado: false, motivos: [] });
});
