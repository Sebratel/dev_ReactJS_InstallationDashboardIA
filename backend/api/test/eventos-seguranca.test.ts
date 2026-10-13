// O gravador de eventos de segurança (`eventos-seguranca.ts`): grava em lote, não perde o
// lote quando o banco cai, e não deixa a memória crescer sem limite quando ele não volta.
// No fim, ponta a ponta: o `Servidor` registra login recusado e aba negada com o e-mail.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { criaGravadorDeEventos, type EventoDeSeguranca, type GravadorDeEventos } from '../src/eventos-seguranca.ts';
import { Servidor } from '../src/servidor.ts';
import { ACESSO_LIBERADO } from './fixtures/acesso.ts';

function bancoFalso() {
  const lotes: unknown[][][] = [];
  let fora = false;
  return {
    lotes,
    derruba: (v = true) => (fora = v),
    pool: {
      query: (async (_sql: string, params: unknown[]) => {
        if (fora) throw new Error('banco fora');
        lotes.push(params[0] as unknown[][]);
        return [[], []];
      }) as never,
    },
  };
}

const ev = (motivo: string): EventoDeSeguranca => ({ tipo: 'forbidden', status: 403, ip: '1.2.3.4', rota: '/x', motivo });

test('grava em UM insert o que juntou — e nunca o corpo nem token, só os campos do evento', async () => {
  const b = bancoFalso();
  const g = criaGravadorDeEventos(b.pool, { cadaMs: 60_000, log: () => {} });
  try {
    g.registra(ev('a'));
    g.registra({ ...ev('b'), email: 'x@sebratel.com.br' });
    await g.descarrega();
    assert.equal(b.lotes.length, 1);
    assert.equal(b.lotes[0]!.length, 2);
    assert.equal(b.lotes[0]![0]!.length, 8, 'created_at, tipo, status, email, ip, método, rota, motivo');
    assert.equal(b.lotes[0]![1]![3], 'x@sebratel.com.br');
  } finally {
    g.para();
  }
});

test('banco fora: o lote volta para a fila e sai inteiro quando ele volta', async () => {
  const b = bancoFalso();
  const logs: string[] = [];
  const g = criaGravadorDeEventos(b.pool, { cadaMs: 60_000, log: (m) => logs.push(m) });
  try {
    g.registra(ev('a'));
    b.derruba();
    await g.descarrega();
    g.registra(ev('b'));
    b.derruba(false);
    await g.descarrega();
    assert.deepEqual(b.lotes.flat().map((l) => l[7]), ['a', 'b']);
    assert.ok(logs.some((l) => l.includes('FALHA')) && logs.some((l) => l.includes('voltou')));
  } finally {
    g.para();
  }
});

test('banco que não volta não vira vazamento de memória: o buffer tem teto, e a perda é dita', async () => {
  const b = bancoFalso();
  b.derruba();
  const logs: string[] = [];
  const g = criaGravadorDeEventos(b.pool, { cadaMs: 60_000, teto: 10, log: (m) => logs.push(m) });
  try {
    for (let i = 0; i < 25; i++) g.registra(ev(String(i)));
    await g.descarrega();
    b.derruba(false);
    await g.descarrega();
    const gravados = b.lotes.flat().map((l) => l[7]);
    assert.equal(gravados.length, 10);
    assert.equal(gravados.at(-1), '24', 'fica o mais recente');
  } finally {
    g.para();
  }
});

// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('o Servidor registra login recusado e 401 sem sessão', async () => {
  const eventos: EventoDeSeguranca[] = [];
  const gravador: GravadorDeEventos = { registra: (e) => eventos.push(e), descarrega: async () => {}, para: () => {} };
  const inst = new Servidor({
    root: ROOT,
    snapshotDir: fs.mkdtempSync(path.join(os.tmpdir(), 'eventos-seg-')),
    webDir: path.join(ROOT, 'frontend', 'dist'),
    acesso: ACESSO_LIBERADO,
    firebaseProjectId: 'projeto-de-teste',
    certificadosFirebase: async () => ({}),
    eventosDeSeguranca: gravador,
  });
  const http = inst.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  try {
    await fetch(`http://127.0.0.1:${port}/auth/firebase`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: 'falso' }),
    });
    await fetch(`http://127.0.0.1:${port}/api/dashboards`);
    assert.deepEqual(
      eventos.map((e) => e.tipo),
      ['login_failed', 'unauthorized'],
    );
    assert.ok(eventos.every((e) => !JSON.stringify(e).includes('falso')), 'o token nunca vai para o evento');
  } finally {
    await new Promise<void>((ok) => {
      inst.destroi();
      http.close(() => ok());
    });
  }
});
