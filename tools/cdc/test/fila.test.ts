import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FilaDeRematerializacao } from '../src/fila.ts';

/**
 * Um agendador de mentira: não deixa o tempo passar sozinho. `dispara()` é o
 * teste dizendo "agora o debounce venceu" — determinístico, sem `setTimeout` real
 * e sem teste piscando por causa de escalonamento do SO.
 */
function agendadorFalso(): {
  agendador: (fn: () => void, ms: number) => { cancelar: () => void };
  pendentes: () => number;
  disparaTodos: () => void;
} {
  const pendentes: Array<{ fn: () => void; cancelada: boolean }> = [];
  return {
    agendador: (fn, _ms) => {
      const item = { fn, cancelada: false };
      pendentes.push(item);
      return { cancelar: () => { item.cancelada = true; } };
    },
    pendentes: () => pendentes.filter((p) => !p.cancelada).length,
    disparaTodos: () => {
      // Copia antes de rodar: `fn()` pode agendar um novo item na mesma lista.
      const agora = [...pendentes];
      pendentes.length = 0;
      for (const p of agora) if (!p.cancelada) p.fn();
    },
  };
}

/** Uma promessa controlada de fora — para testar "rodando" de verdade. */
function rodadorControlado(): {
  roda: (queries: readonly string[]) => Promise<{ ok: boolean }>;
  chamadas: string[][];
  resolveUltima: (ok?: boolean) => void;
} {
  const chamadas: string[][] = [];
  let resolveAtual: ((r: { ok: boolean }) => void) | null = null;
  return {
    chamadas,
    roda: (queries) => {
      chamadas.push([...queries]);
      return new Promise((resolve) => {
        resolveAtual = resolve;
      });
    },
    resolveUltima: (ok = true) => {
      resolveAtual?.({ ok });
      resolveAtual = null;
    },
  };
}

test('uma sujeira só roda depois do debounce vencer, nunca antes', () => {
  const { agendador, disparaTodos } = agendadorFalso();
  const chamadas: string[][] = [];
  const fila = new FilaDeRematerializacao({
    debounceMs: 1000,
    agendador,
    roda: async (ids) => {
      chamadas.push([...ids]);
      return { ok: true };
    },
  });

  fila.marcaSuja('field-agenda');
  assert.deepEqual(chamadas, [], 'não roda antes do debounce');
  assert.deepEqual(fila.pendentes, ['field-agenda']);

  disparaTodos();
  assert.deepEqual(chamadas, [['field-agenda']]);
});

test('duas sujeiras dentro do debounce coalescem numa rodada só', () => {
  const { agendador, disparaTodos, pendentes } = agendadorFalso();
  const chamadas: string[][] = [];
  const fila = new FilaDeRematerializacao({
    debounceMs: 1000,
    agendador,
    roda: async (ids) => {
      chamadas.push([...ids]);
      return { ok: true };
    },
  });

  fila.marcaSuja('field-agenda');
  fila.marcaSuja('contracts');
  fila.marcaSuja('field-agenda'); // repetida: não dobra a rodada

  // Cada `marcaSuja` reagenda (cancela o timer anterior) — só um timer vivo.
  assert.equal(pendentes(), 1, 'a rajada inteira usa um timer só, não um por evento');

  disparaTodos();
  assert.deepEqual(chamadas, [['contracts', 'field-agenda']], 'ordenado, sem duplicata');
});

test('sujeira que chega com uma rodada em andamento não abre uma segunda — vira a próxima', async () => {
  const { agendador, disparaTodos } = agendadorFalso();
  const { roda, chamadas, resolveUltima } = rodadorControlado();
  const concluidas: string[][] = [];
  const fila = new FilaDeRematerializacao({
    debounceMs: 1000,
    agendador,
    roda,
    aoConcluir: (ids) => concluidas.push([...ids]),
  });

  fila.marcaSuja('field-agenda');
  disparaTodos();
  assert.equal(chamadas.length, 1, 'a primeira rodada começou');
  assert.equal(fila.rodando, true);

  // Chega sujeira nova enquanto a primeira ainda está rodando.
  fila.marcaSuja('contracts');
  disparaTodos(); // mesmo que o debounce vença, não pode abrir uma segunda rodada
  assert.equal(chamadas.length, 1, 'nenhuma segunda rodada concorrente');

  resolveUltima(true);
  await Promise.resolve();
  await Promise.resolve(); // deixa o `finally` da fila rodar e reagendar

  assert.equal(chamadas.length, 2, 'a sujeira que chegou durante a rodada virou a próxima');
  assert.deepEqual(chamadas[1], ['contracts']);
  assert.deepEqual(concluidas, [['field-agenda']]);
});

test('rodada que falha não trava a fila: a próxima sujeira ainda dispara', async () => {
  const { agendador, disparaTodos } = agendadorFalso();
  const { roda, chamadas, resolveUltima } = rodadorControlado();
  const fila = new FilaDeRematerializacao({ debounceMs: 1000, agendador, roda });

  fila.marcaSuja('field-agenda');
  disparaTodos();
  resolveUltima(false); // a rodada "falhou" (ok:false), mas não lança
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(fila.rodando, false, 'a falha libera a trava de concorrência');

  fila.marcaSuja('contracts');
  disparaTodos();
  assert.equal(chamadas.length, 2);
  assert.deepEqual(chamadas[1], ['contracts']);
});

test('roda() que rejeita (exceção) também libera a trava — erro não é travamento', async () => {
  const { agendador, disparaTodos } = agendadorFalso();
  const fila = new FilaDeRematerializacao({
    debounceMs: 1000,
    agendador,
    roda: async () => {
      throw new Error('spawn explodiu');
    },
  });

  fila.marcaSuja('field-agenda');
  // `#tentaRodar` não tem catch em volta do `await this.#roda(ids)` dentro do
  // `try`, mas o `finally` roda mesmo assim — é essa garantia que este teste prova.
  disparaTodos();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(fila.rodando, false);
});
