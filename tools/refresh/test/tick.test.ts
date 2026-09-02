import assert from 'node:assert/strict';
import test from 'node:test';
import type { GrupoDeRefresh } from '../src/grupos.ts';
import type { StatusDeRefresh } from '../src/status.ts';
import { estaVencido, executaTick, proximoStatus } from '../src/tick.ts';

const AGORA = new Date('2026-09-02T12:00:00.000Z');

function grupo(over: Partial<GrupoDeRefresh> = {}): GrupoDeRefresh {
  return { id: 'g', queries: ['q1'], intervaloMinutos: 15, incremental: false, ...over };
}

// --------------------------------------------------------------- estaVencido

test('estaVencido: nunca rodou (sem status anterior) está sempre vencido', () => {
  assert.equal(estaVencido(undefined, 15, AGORA), true);
});

test('estaVencido: nunca teve sucesso está vencido mesmo com falhasConsecutivas', () => {
  assert.equal(
    estaVencido({ ultimaTentativa: AGORA.toISOString(), ultimoSucesso: null, duracaoMs: 1, ok: false, falhasConsecutivas: 3 }, 15, AGORA),
    true,
  );
});

test('estaVencido: sucesso dentro do intervalo não está vencido', () => {
  const dez = new Date(AGORA.getTime() - 10 * 60_000).toISOString();
  assert.equal(
    estaVencido({ ultimaTentativa: dez, ultimoSucesso: dez, duracaoMs: 1, ok: true, falhasConsecutivas: 0 }, 15, AGORA),
    false,
  );
});

test('estaVencido: sucesso exatamente no limite do intervalo está vencido (>=)', () => {
  const quinze = new Date(AGORA.getTime() - 15 * 60_000).toISOString();
  assert.equal(
    estaVencido({ ultimaTentativa: quinze, ultimoSucesso: quinze, duracaoMs: 1, ok: true, falhasConsecutivas: 0 }, 15, AGORA),
    true,
  );
});

// -------------------------------------------------------------- proximoStatus

test('proximoStatus: sucesso zera falhasConsecutivas e avança ultimoSucesso', () => {
  const anterior = { ultimaTentativa: 'x', ultimoSucesso: 'x', duracaoMs: 1, ok: false, falhasConsecutivas: 2 };
  const s = proximoStatus(anterior, AGORA, { ok: true }, 500);
  assert.equal(s.ok, true);
  assert.equal(s.falhasConsecutivas, 0);
  assert.equal(s.ultimoSucesso, AGORA.toISOString());
  assert.equal(s.duracaoMs, 500);
});

test('proximoStatus: falha soma falhasConsecutivas e NÃO mexe em ultimoSucesso — o dado bom fica', () => {
  const anterior = {
    ultimaTentativa: 'antes', ultimoSucesso: '2026-08-25T00:00:00.000Z', duracaoMs: 1, ok: true, falhasConsecutivas: 0,
  };
  const s = proximoStatus(anterior, AGORA, { ok: false, erro: 'banco fora do ar' }, 200);
  assert.equal(s.ok, false);
  assert.equal(s.falhasConsecutivas, 1);
  assert.equal(s.ultimoSucesso, '2026-08-25T00:00:00.000Z', 'não sobrescreve o último sucesso com uma falha');
  assert.equal(s.erro, 'banco fora do ar');
  assert.equal(s.ultimaTentativa, AGORA.toISOString());
});

test('proximoStatus: primeira execução (sem anterior) e falha — ultimoSucesso fica null', () => {
  const s = proximoStatus(undefined, AGORA, { ok: false, erro: 'x' }, 1);
  assert.equal(s.ultimoSucesso, null);
  assert.equal(s.falhasConsecutivas, 1);
});

// ---------------------------------------------------------------- executaTick

test('executaTick: só os grupos vencidos disparam', async () => {
  const recente = new Date(AGORA.getTime() - 1 * 60_000).toISOString();
  const grupos = new Map([
    ['fresco', grupo({ id: 'fresco', intervaloMinutos: 15 })],
    ['velho', grupo({ id: 'velho', intervaloMinutos: 15 })],
  ]);
  const statusInicial: StatusDeRefresh = {
    fresco: { ultimaTentativa: recente, ultimoSucesso: recente, duracaoMs: 1, ok: true, falhasConsecutivas: 0 },
    // 'velho' nunca rodou — sem entrada.
  };
  const chamados: string[] = [];
  const { resultados } = await executaTick(grupos, statusInicial, {
    agora: () => AGORA,
    roda: (g) => {
      chamados.push(g.id);
      return { ok: true };
    },
    persiste: () => {},
  });
  assert.deepEqual(chamados, ['velho']);
  assert.deepEqual(
    resultados.map((r) => [r.id, r.vencido]),
    [['fresco', false], ['velho', true]],
  );
});

test('executaTick: dois grupos vencidos no mesmo tick rodam em SÉRIE, nunca sobrepostos', async () => {
  const grupos = new Map([
    ['a', grupo({ id: 'a' })],
    ['b', grupo({ id: 'b' })],
  ]);
  const eventos: string[] = [];
  let emAndamento = false;
  await executaTick(grupos, {}, {
    agora: () => AGORA,
    roda: (g) => {
      assert.equal(emAndamento, false, `${g.id} começou com outro grupo ainda em andamento`);
      emAndamento = true;
      eventos.push(`inicio:${g.id}`);
      eventos.push(`fim:${g.id}`);
      emAndamento = false;
      return { ok: true };
    },
    persiste: () => {},
  });
  assert.deepEqual(eventos, ['inicio:a', 'fim:a', 'inicio:b', 'fim:b']);
});

test('executaTick: falha em um grupo não impede os seguintes do mesmo tick', async () => {
  const grupos = new Map([
    ['falha', grupo({ id: 'falha' })],
    ['depois', grupo({ id: 'depois' })],
  ]);
  const chamados: string[] = [];
  const { status, resultados } = await executaTick(grupos, {}, {
    agora: () => AGORA,
    roda: (g) => {
      chamados.push(g.id);
      if (g.id === 'falha') return { ok: false, erro: 'x' };
      return { ok: true };
    },
    persiste: () => {},
  });
  assert.deepEqual(chamados, ['falha', 'depois']);
  assert.equal(status.falha!.ok, false);
  assert.equal(status.depois!.ok, true);
  assert.equal(resultados.length, 2);
});

test('executaTick: persiste é chamado depois de CADA grupo vencido, não só no fim', async () => {
  const grupos = new Map([
    ['a', grupo({ id: 'a' })],
    ['b', grupo({ id: 'b' })],
  ]);
  const snapshots: string[][] = [];
  await executaTick(grupos, {}, {
    agora: () => AGORA,
    roda: () => ({ ok: true }),
    persiste: (status) => {
      snapshots.push(Object.keys(status).sort());
    },
  });
  assert.deepEqual(snapshots, [['a'], ['a', 'b']], 'o status já tem "a" quando persiste depois de "a", antes de "b" rodar');
});
