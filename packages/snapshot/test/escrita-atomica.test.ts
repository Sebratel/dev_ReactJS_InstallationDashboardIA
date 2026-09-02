import assert from 'node:assert/strict';
import test from 'node:test';
import { renomeiaComRetentativa } from '../src/escrita-atomica.ts';

function erro(codigo: string): NodeJS.ErrnoException {
  const e = new Error(codigo) as NodeJS.ErrnoException;
  e.code = codigo;
  return e;
}

test('renomeiaComRetentativa: sucesso de primeira não espera nada', async () => {
  let chamadas = 0;
  await renomeiaComRetentativa('a', 'b', {
    renomeia: () => {
      chamadas++;
    },
    esperasMs: [10_000], // se esperasse, o teste estouraria o timeout — não estoura
  });
  assert.equal(chamadas, 1);
});

test('renomeiaComRetentativa: EPERM duas vezes e sucesso na terceira — a forma real medida', async () => {
  let chamadas = 0;
  await renomeiaComRetentativa('a', 'b', {
    renomeia: () => {
      chamadas++;
      if (chamadas < 3) throw erro('EPERM');
    },
    esperasMs: [1, 1, 1],
  });
  assert.equal(chamadas, 3);
});

test('renomeiaComRetentativa: EBUSY também é motivo de nova tentativa', async () => {
  let chamadas = 0;
  await renomeiaComRetentativa('a', 'b', {
    renomeia: () => {
      chamadas++;
      if (chamadas < 2) throw erro('EBUSY');
    },
    esperasMs: [1, 1],
  });
  assert.equal(chamadas, 2);
});

test('renomeiaComRetentativa: esgota as tentativas e sobe o erro original', async () => {
  let chamadas = 0;
  await assert.rejects(
    renomeiaComRetentativa('a', 'b', {
      renomeia: () => {
        chamadas++;
        throw erro('EPERM');
      },
      esperasMs: [1, 1],
    }),
    (e: NodeJS.ErrnoException) => e.code === 'EPERM',
  );
  // 2 esperas configuradas → 3 chamadas (a original + 2 novas tentativas).
  assert.equal(chamadas, 3);
});

test('renomeiaComRetentativa: erro que não é de handle aberto sobe na hora, sem esperar', async () => {
  let chamadas = 0;
  await assert.rejects(
    renomeiaComRetentativa('a', 'b', {
      renomeia: () => {
        chamadas++;
        throw erro('ENOENT');
      },
      esperasMs: [10_000], // se tentasse de novo, estouraria o timeout — não tenta
    }),
    (e: NodeJS.ErrnoException) => e.code === 'ENOENT',
  );
  assert.equal(chamadas, 1);
});
