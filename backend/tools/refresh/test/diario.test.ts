import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { leGrupos } from '../src/grupos.ts';
import {
  argumentosDoDiario,
  iniciaSnapshotDiario,
  leHorarioUtc,
  msAteProximo,
  queriesDoDiario,
} from '../src/diario.ts';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

test('leHorarioUtc: HH:MM válido; vazio, desligado e lixo viram null', () => {
  assert.deepEqual(leHorarioUtc('06:00'), { hora: 6, minuto: 0 });
  assert.deepEqual(leHorarioUtc(' 6:30 '), { hora: 6, minuto: 30 });
  for (const t of [undefined, '', '0', 'off', '24:00', '06:60', '6h', '06:00:00']) {
    assert.equal(leHorarioUtc(t), null, String(t));
  }
});

test('msAteProximo: hoje se ainda não passou, amanhã se passou ou é agora', () => {
  const h = { hora: 6, minuto: 0 };
  assert.equal(msAteProximo(new Date('2026-10-17T05:59:00Z'), h), 60_000);
  assert.equal(msAteProximo(new Date('2026-10-17T06:00:00Z'), h), 24 * 3_600_000);
  assert.equal(msAteProximo(new Date('2026-10-17T07:00:00Z'), h), 23 * 3_600_000);
  // Virada de mês.
  assert.equal(msAteProximo(new Date('2026-10-31T23:00:00Z'), h), 7 * 3_600_000);
});

test('a carga da madrugada cobre toda query do refresh.yaml real, sem repetição', () => {
  const grupos = leGrupos(path.join(RAIZ, 'backend', 'specs'));
  const queries = queriesDoDiario(grupos.values());
  assert.ok(queries.length >= 25, `li ${queries.length}`);
  for (const g of grupos.values()) for (const q of g.queries) assert.ok(queries.includes(q), q);
  assert.equal(new Set(queries).size, queries.length);
  // As 25 que o crontab listava à mão até 17/10/2026 — menos a `field-agenda`, que saiu do
  // refresh em 26/10/2026 (passo 5 do ao vivo); no lugar dela entraram as duas agregadas do
  // relato.
  for (const q of ['protocolos-geral', 'protocolos-produtividade', 'contratos', 'troca-endereco', 'relatos-do-dia', 'valores-do-relato']) {
    assert.ok(queries.includes(q), q);
  }
  assert.ok(!queries.includes('field-agenda'), 'a agenda completa não é mais carregada');
});

test('argumentos: os mesmos do antigo crontab (heap do filho, --refazer, --memoria)', () => {
  assert.deepEqual(argumentosDoDiario(['a', 'b'], 1400), [
    '--expose-gc',
    '--max-old-space-size=1400',
    'backend/tools/snapshot/src/index.ts',
    '--query=a,b',
    '--refazer',
    '--memoria=1400',
  ]);
});

test('dispara no horário, não empilha sobre carga em voo, e encerra matando o filho', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-17T05:59:00Z') });
  const logs: string[] = [];
  const execucoes: string[][] = [];
  let terminaFilho: (c: number) => void = () => {};
  let mortos = 0;
  const diario = iniciaSnapshotDiario({
    raiz: RAIZ,
    horario: { hora: 6, minuto: 0 },
    queries: ['a', 'b'],
    memoriaMb: 1400,
    agora: () => new Date(Date.now()),
    log: (l) => logs.push(l),
    executa: (args) => {
      execucoes.push(args);
      return { fim: new Promise<number>((r) => (terminaFilho = r)), mata: () => mortos++ };
    },
  });
  assert.equal(diario.disparos, 0);
  t.mock.timers.tick(59_000);
  assert.equal(diario.disparos, 0, 'ainda não deu 06:00');
  t.mock.timers.tick(1_000);
  assert.equal(diario.disparos, 1);
  assert.equal(execucoes[0]![3], '--query=a,b');

  // 24 h depois a anterior ainda roda: pula em vez de abrir uma segunda.
  t.mock.timers.tick(24 * 3_600_000);
  assert.equal(diario.disparos, 1);
  assert.ok(logs.some((l) => l.includes('pulada')));

  terminaFilho(0);
  await new Promise((r) => setImmediate(r));
  assert.ok(logs.some((l) => l.includes('concluída')));

  t.mock.timers.tick(24 * 3_600_000);
  assert.equal(diario.disparos, 2, 'livre de novo, dispara no dia seguinte');
  diario.encerra();
  assert.equal(mortos, 1, 'encerrar pede ao filho em voo que saia (e solte a trava)');
  t.mock.timers.tick(48 * 3_600_000);
  assert.equal(diario.disparos, 2, 'encerrado não dispara mais');
});
