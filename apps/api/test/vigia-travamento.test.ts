// O vigia de travamento — ver o cabeçalho de `../src/vigia-travamento.ts`.
//
// Os dois últimos testes sobem um Node DE VERDADE: só um laço principal realmente preso
// prova que a worker segue viva, grava o motivo e consegue matar o processo. E o par
// saudável prova o outro lado — que o vigia não mata quem está só trabalhando.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { leHistorico } from '../../../tools/refresh/src/historico.ts';
import { decideVigia, limiteDoAmbiente } from '../src/vigia-travamento.ts';

const MODULO = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'vigia-travamento.ts'),
).href;

test('decideVigia: batimento recente é ok; parado além do limite é travou', () => {
  const base = { agora: 100_000, ultimoTique: 99_000, limiteMs: 10_000 };
  assert.equal(decideVigia({ ...base, ultimoBatimento: 95_000 }), 'ok');
  assert.equal(decideVigia({ ...base, ultimoBatimento: 89_000 }), 'travou');
});

test('decideVigia: se o PRÓPRIO vigia atrasou, a máquina dormiu — não é travamento', () => {
  // 19/09/2026: 2h14min de suspensão. Ao acordar, o batimento tem duas horas; o tique do
  // vigia também. Matar a API ali seria derrubar quem só estava dormindo.
  const acordou = { agora: 8_000_000, ultimoTique: 0, ultimoBatimento: 0, limiteMs: 120_000 };
  assert.equal(decideVigia(acordou), 'suspensao');
});

test('limiteDoAmbiente: só liga com número positivo', () => {
  assert.equal(limiteDoAmbiente({ VIGIA_TRAVAMENTO_S: '120' }), 120_000);
  assert.equal(limiteDoAmbiente({}), null);
  assert.equal(limiteDoAmbiente({ VIGIA_TRAVAMENTO_S: '0' }), null);
  assert.equal(limiteDoAmbiente({ VIGIA_TRAVAMENTO_S: 'sim' }), null);
});

function sobeFilho(dir: string, corpo: string): ReturnType<typeof spawnSync> {
  const script =
    `import { iniciaVigiaDeTravamento } from ${JSON.stringify(MODULO)};\n` +
    `iniciaVigiaDeTravamento({ limiteMs: 1500, snapshotDir: ${JSON.stringify(dir)} });\n` +
    corpo;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30_000 });
}

test('vigia: laço principal preso DE VERDADE — o processo morre e deixa o motivo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigia-'));
  const inicio = Date.now();
  // Trava por até 20 s. Se o vigia não matar, o filho sai sozinho com código 7.
  const r = sobeFilho(dir, `const ate = Date.now() + 20_000; while (Date.now() < ate) {} process.exit(7);`);
  const levouMs = Date.now() - inicio;

  assert.notEqual(r.status, 7, 'o laço ficou preso 20 s e ninguém matou');
  assert.ok(r.status !== 0 || r.signal !== null, 'tinha de morrer, não sair limpo');
  assert.ok(levouMs < 15_000, `demorou ${levouMs} ms para matar com limite de 1,5 s`);
  assert.match(String(r.stderr), /\[vigia\] o laço principal da API está parado/);

  const travou = leHistorico(dir).find((e) => e.evento === 'api-travou');
  assert.ok(travou, 'o histórico não registrou api-travou');
  const diag = fs.readdirSync(path.join(dir, 'diagnostico'));
  assert.ok(diag.some((f) => f.startsWith('api-travou.')), 'faltou o arquivo em diagnostico/');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('vigia: laço saudável por mais que o limite NÃO é morto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigia-'));
  // 4 s de vida, com o laço livre (só timers), contra limite de 1,5 s.
  const r = sobeFilho(dir, `setTimeout(() => process.exit(0), 4000);`);
  assert.equal(r.status, 0, `o vigia matou um processo saudável: ${r.stderr}`);
  assert.equal(leHistorico(dir).some((e) => e.evento === 'api-travou'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
