// O guarda dos períodos ao vivo: é ele que decide quantas vezes o SRD é consultado. A
// Agendamento Field é invalidada a cada ~35 s em horário de operação; sem este guarda,
// cada reaquecimento viraria uma busca de 17–25 s no banco.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { PeriodoAoVivo } from '../../packages/ao-vivo/src/periodo.ts';
import { PeriodosAoVivo, type OpcoesDosPeriodos } from '../src/periodos-ao-vivo.ts';

const SETEMBRO: PeriodoAoVivo = { desde: '2026-09-01', ate: '2026-10-01' };
const OUTUBRO: PeriodoAoVivo = { desde: '2026-10-01', ate: '2026-11-01' };
const AGOSTO: PeriodoAoVivo = { desde: '2026-08-01', ate: '2026-09-01' };

/** Deixa as promessas e timers de agora correrem (a renovação é em segundo plano). */
const assenta = () => new Promise((ok) => setTimeout(ok, 20));

function cenario(t: { after: (f: () => void) => void }, extra: Partial<OpcoesDosPeriodos> = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'periodos-teste-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  let agora = new Date('2026-10-24T15:00:00Z');
  const buscas: string[] = [];
  const linhas: string[] = [];
  let falha: Error | null = null;
  const p = new PeriodosAoVivo({
    busca: async (periodo) => {
      buscas.push(periodo.desde);
      if (falha) throw falha;
      return { consultas: [], statusProtocoloDia: [], protocolos: 3 };
    },
    grava: async (dir) => fs.writeFileSync(path.join(dir, 'arquivo'), 'x'),
    dirBase: path.join(base, 'ao-vivo'),
    agora: () => agora,
    gracaMs: 0,
    registra: (l) => linhas.push(l),
    ...extra,
  });
  return {
    p,
    buscas,
    linhas,
    base,
    avanca: (ms: number) => {
      agora = new Date(agora.getTime() + ms);
    },
    falhar: (e: Error | null) => {
      falha = e;
    },
  };
}

test('busca uma vez; o mês corrente vale 2 min e o fechado 1 h; vencido, serve o anterior e renova por baixo', async (t) => {
  const c = cenario(t);
  const set1 = await c.p.obtem(SETEMBRO);
  const out1 = await c.p.obtem(OUTUBRO);
  assert.deepEqual(c.buscas, ['2026-09-01', '2026-10-01']);
  assert.equal((await c.p.obtem(SETEMBRO)).identidade, set1.identidade, 'dentro da validade, a mesma geração');

  c.avanca(121_000);
  const outVencido = await c.p.obtem(OUTUBRO);
  assert.equal(outVencido.identidade, out1.identidade, 'vencido: quem pede recebe o anterior na hora');
  assert.equal((await c.p.obtem(SETEMBRO)).identidade, set1.identidade, 'mês fechado ainda vale');
  await assenta();
  assert.deepEqual(c.buscas, ['2026-09-01', '2026-10-01', '2026-10-01'], 'só o mês corrente foi buscado de novo');
  const out2 = await c.p.obtem(OUTUBRO);
  assert.notEqual(out2.identidade, out1.identidade, 'a geração nova entra no lugar');
  assert.ok(Date.parse(out2.geradoEm) > Date.parse(out1.geradoEm));
  assert.equal(fs.existsSync(out1.dir), false, 'a pasta da geração substituída sai');
  assert.equal(fs.existsSync(out2.dir), true);
});

test('pedidos juntos do mesmo período viram UMA busca', async (t) => {
  const c = cenario(t);
  const [a, b, d] = await Promise.all([c.p.obtem(SETEMBRO), c.p.obtem(SETEMBRO), c.p.obtem(SETEMBRO)]);
  assert.equal(c.buscas.length, 1);
  assert.equal(a.dir, b.dir);
  assert.equal(b.dir, d.dir);
});

test('no máximo 2 buscas ao mesmo tempo, mesmo de períodos diferentes', async (t) => {
  let correndo = 0;
  let maximo = 0;
  const portas: (() => void)[] = [];
  const c = cenario(t, {
    busca: async () => {
      correndo++;
      maximo = Math.max(maximo, correndo);
      await new Promise<void>((ok) => portas.push(ok));
      correndo--;
      return { consultas: [], statusProtocoloDia: [], protocolos: 0 };
    },
  });
  const todas = Promise.all([c.p.obtem(SETEMBRO), c.p.obtem(OUTUBRO), c.p.obtem(AGOSTO)]);
  await assenta();
  assert.equal(correndo, 2, 'a terceira espera na fila');
  assert.equal(c.p.estado().naFila, 1);
  while (portas.length) {
    portas.shift()!();
    await assenta();
  }
  await todas;
  assert.equal(maximo, 2);
  assert.equal(c.p.estado().buscando, 0);
});

test('a primeira busca que falha erra para quem pediu; a renovação que falha mantém o anterior servindo', async (t) => {
  const c = cenario(t);
  c.falhar(new Error('conexão recusada\nlinha que não vai para o log'));
  await assert.rejects(c.p.obtem(OUTUBRO), /conexão recusada/);
  assert.match(c.linhas[0]!, /^\[ao-vivo\] busca de 2026-10-01\.\.2026-11-01 no SRD falhou: conexão recusada$/);

  c.falhar(null);
  const g = await c.p.obtem(OUTUBRO);
  c.avanca(121_000);
  c.falhar(new Error('tempo esgotado'));
  assert.equal((await c.p.obtem(OUTUBRO)).identidade, g.identidade);
  await assenta();
  assert.equal((await c.p.obtem(OUTUBRO)).identidade, g.identidade, 'a renovação falhou: a geração vencida segue');
  assert.equal(fs.existsSync(g.dir), true, 'e a pasta dela continua lá');
  assert.equal(c.linhas.length, 2);
});

test('sem esperar a primeira: o pedido cai na hora, a busca segue, e o seguinte já recebe', async (t) => {
  let solta: () => void = () => undefined;
  const c = cenario(t, {
    esperaAPrimeira: false,
    busca: async () => {
      await new Promise<void>((ok) => {
        solta = ok;
      });
      return { consultas: [], statusProtocoloDia: [], protocolos: 1 };
    },
  });
  await assert.rejects(c.p.obtem(OUTUBRO), /a primeira busca de 2026-10-01\.\.2026-11-01 no SRD ainda corre/);
  await assert.rejects(c.p.obtem(OUTUBRO), /ainda corre/, 'outro pedido no meio da busca também não espera');
  assert.equal(c.p.estado().buscando, 1, 'e não abre uma segunda busca');
  const pronto = c.p.pronto(OUTUBRO);
  solta();
  const g = await pronto;
  assert.equal((await c.p.obtem(OUTUBRO)).identidade, g.identidade, 'pronta, o pedido recebe na hora');
});

test('o período menos usado sai quando passa do máximo; o que sobrou de outro processo é apagado', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'periodos-resto-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const dirBase = path.join(base, 'ao-vivo');
  fs.mkdirSync(path.join(dirBase, 'de-outro-processo'), { recursive: true });

  const c = cenario(t, { dirBase, maxPeriodos: 2 });
  assert.deepEqual(fs.readdirSync(dirBase), [], 'a pasta nasce vazia');
  const ago = await c.p.obtem(AGOSTO);
  await c.p.obtem(SETEMBRO);
  await c.p.obtem(AGOSTO);
  await c.p.obtem(OUTUBRO);
  await assenta();
  assert.deepEqual(
    c.p.estado().periodos.map((e) => e.periodo),
    ['2026-08-01..2026-09-01', '2026-10-01..2026-11-01'],
    'setembro era o menos usado',
  );
  assert.equal(fs.existsSync(ago.dir), true);
  assert.equal(fs.readdirSync(dirBase).length, 2, 'a pasta de setembro saiu');
});
