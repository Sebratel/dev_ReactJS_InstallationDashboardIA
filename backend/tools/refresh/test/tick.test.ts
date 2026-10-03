import assert from 'node:assert/strict';
import test from 'node:test';
import type { GrupoDeRefresh } from '../src/grupos.ts';
import type { StatusDeGrupo, StatusDeRefresh } from '../src/status.ts';
import { TETO_ESPERA_APOS_FALHAS_MS, estaVencido, executaTick, proximaTentativa, proximoStatus } from '../src/tick.ts';

const AGORA = new Date('2026-09-02T12:00:00.000Z');

function grupo(over: Partial<GrupoDeRefresh> = {}): GrupoDeRefresh {
  return { id: 'g', queries: ['q1'], intervaloMinutos: 15, incremental: false, ...over };
}

// --------------------------------------------------------------- estaVencido

test('estaVencido: nunca rodou (sem status anterior) está sempre vencido', () => {
  assert.equal(estaVencido(undefined, 15, AGORA), true);
});

/** Status de um grupo que falhou `falhas` vezes seguidas, a última há `haMin` minutos. */
function falhando(falhas: number, haMin: number): StatusDeGrupo {
  const t = new Date(AGORA.getTime() - haMin * 60_000).toISOString();
  return { ultimaTentativa: t, ultimoSucesso: null, duracaoMs: 1, ok: false, falhasConsecutivas: falhas };
}

test('estaVencido: UMA falha tenta de novo no próximo tick — um soluço não espera', () => {
  assert.equal(estaVencido(falhando(1, 0), 15, AGORA), true);
});

test('estaVencido: da segunda falha seguida em diante, espera intervalo × 2^(falhas-1) desde a última tentativa', () => {
  // Até 25/09 este teste dizia o contrário ("vencido mesmo com 3 falhas"): a falha era o
  // próprio retry, a cada tick, para sempre. No Docker isso refez ~9 min de carga a cada
  // 15 min por uma credencial ausente (ACHADOS #153).
  assert.equal(estaVencido(falhando(2, 29), 15, AGORA), false, '2 falhas: 30 min');
  assert.equal(estaVencido(falhando(2, 30), 15, AGORA), true);
  assert.equal(estaVencido(falhando(3, 59), 15, AGORA), false, '3 falhas: 60 min');
  assert.equal(estaVencido(falhando(3, 60), 15, AGORA), true);
});

test('proximaTentativa: teto de 4 h, e nada de espera sem falha seguida', () => {
  const quatroHoras = TETO_ESPERA_APOS_FALHAS_MS;
  const ate = proximaTentativa(falhando(20, 0), 30)!;
  assert.equal(ate.getTime() - AGORA.getTime(), quatroHoras, '2^19 × 30 min não pode virar semanas');
  assert.equal(proximaTentativa(falhando(1, 0), 15), null);
  assert.equal(proximaTentativa(undefined, 15), null);
  const verde = { ultimaTentativa: AGORA.toISOString(), ultimoSucesso: AGORA.toISOString(), duracaoMs: 1, ok: true, falhasConsecutivas: 0 };
  assert.equal(proximaTentativa(verde, 15), null, 'o sucesso zera a conta (proximoStatus)');
});

test('executaTick: grupo em espera por falhas NÃO roda, e diz até quando', async () => {
  const chamados: string[] = [];
  const { resultados } = await executaTick(new Map([['g', grupo()]]), { g: falhando(3, 10) }, {
    agora: () => AGORA,
    roda: (g) => {
      chamados.push(g.id);
      return { ok: true };
    },
    persiste: async () => {},
  });
  assert.deepEqual(chamados, []);
  assert.equal(resultados[0]!.vencido, false);
  assert.equal(resultados[0]!.falhasConsecutivas, 3);
  assert.equal(resultados[0]!.adiadoAte, new Date(AGORA.getTime() + 50 * 60_000).toISOString(), '60 min desde a tentativa de 10 min atrás');
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
