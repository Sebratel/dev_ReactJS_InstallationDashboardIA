// A trava de escrita do snapshot — ver o cabeçalho de `../src/trava.ts`.
//
// O último teste é o que prova a razão de ser: dois PROCESSOS fazendo o mesmo
// ler → somar → gravar que o manifesto faz. Sem a trava, atualizações se perdem.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ARQUIVO_DA_TRAVA, VAR_TRAVA_HERDADA, adquireTrava, motivoDeAbandono } from '../src/trava.ts';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'trava-'));
const silencio = { anuncia: () => {}, env: {} as NodeJS.ProcessEnv };

test('trava: adquire num diretório livre, guarda o dono, e solta apaga', async () => {
  const dir = tmp();
  const t = await adquireTrava(dir, { ...silencio, comando: 'teste' });
  const dono = JSON.parse(fs.readFileSync(path.join(dir, ARQUIVO_DA_TRAVA), 'utf8'));
  assert.equal(dono.pid, process.pid);
  assert.equal(dono.comando, 'teste');
  t.solta();
  assert.equal(fs.existsSync(path.join(dir, ARQUIVO_DA_TRAVA)), false);
});

test('trava: o segundo espera a vez, e entra quando o primeiro solta', async () => {
  const dir = tmp();
  const avisos: string[] = [];
  const t1 = await adquireTrava(dir, { ...silencio, comando: 'um' });
  const p2 = adquireTrava(dir, { ...silencio, comando: 'dois', pausaMs: 10, anuncia: (l) => avisos.push(l) });
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(avisos.some((l) => /em uso por PID/.test(l)), 'quem espera tem de dizer por quem');
  t1.solta();
  const t2 = await p2;
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ARQUIVO_DA_TRAVA), 'utf8')).comando, 'dois');
  t2.solta();
});

test('trava: sem batimento além do limite é abandonada e tomada', async () => {
  const dir = tmp();
  const arq = path.join(dir, ARQUIVO_DA_TRAVA);
  fs.writeFileSync(arq, JSON.stringify({ pid: 1, host: 'outro-conteiner', desde: 'x', comando: 'morto' }));
  const velho = new Date(Date.now() - 60 * 60_000);
  fs.utimesSync(arq, velho, velho);
  const avisos: string[] = [];
  const t = await adquireTrava(dir, { ...silencio, comando: 'novo', anuncia: (l) => avisos.push(l) });
  assert.ok(avisos.some((l) => /sem batimento/.test(l)));
  t.solta();
});

test('trava: PID morto no MESMO host é tomada na hora, sem esperar o batimento envelhecer', async () => {
  const dir = tmp();
  const morto = spawnSync(process.execPath, ['-e', '0']).pid!;
  fs.writeFileSync(
    path.join(dir, ARQUIVO_DA_TRAVA),
    JSON.stringify({ pid: morto, host: 'esta-maquina', desde: 'x', comando: 'caiu' }),
  );
  const t = await adquireTrava(dir, { ...silencio, comando: 'novo', host: 'esta-maquina', esperaMaxMs: 50 });
  t.solta();
});

test('trava: viva em outro host espera até o teto e desiste em voz alta, dizendo de quem', async () => {
  const dir = tmp();
  fs.writeFileSync(
    path.join(dir, ARQUIVO_DA_TRAVA),
    JSON.stringify({ pid: 42, host: 'refresh-conteiner', desde: '2026-09-28T03:00:00Z', comando: 'snapshot --refazer' }),
  );
  await assert.rejects(
    adquireTrava(dir, { ...silencio, comando: 'novo', esperaMaxMs: 60, pausaMs: 10 }),
    /PID 42 em refresh-conteiner.*snapshot --refazer/,
  );
});

test('trava: filho herda — não cria arquivo nem espera o pai', async () => {
  const dir = tmp();
  const t = await adquireTrava(dir, { anuncia: () => {}, env: { [VAR_TRAVA_HERDADA]: '123' }, comando: 'filho' });
  assert.equal(t.herdada, true);
  assert.equal(fs.existsSync(path.join(dir, ARQUIVO_DA_TRAVA)), false);
});

test('trava: solta não apaga a trava de quem a tomou depois', async () => {
  const dir = tmp();
  const t = await adquireTrava(dir, { ...silencio, comando: 'um' });
  const arq = path.join(dir, ARQUIVO_DA_TRAVA);
  fs.writeFileSync(arq, JSON.stringify({ pid: 99, host: 'outro', desde: 'y', comando: 'tomou' }));
  t.solta();
  assert.equal(fs.existsSync(arq), true, 'apagar aqui soltaria a trava de outro processo');
});

test('motivoDeAbandono: viva no mesmo host com batimento recente não é abandonada', () => {
  const dono = { pid: 7, host: 'h', desde: 'x', comando: 'c' };
  assert.equal(motivoDeAbandono(dono, 1_000, { host: 'h', velhaMs: 600_000, vivo: () => true }), null);
  assert.match(motivoDeAbandono(dono, 1_000, { host: 'h', velhaMs: 600_000, vivo: () => false })!, /não existe mais/);
  assert.equal(motivoDeAbandono(dono, 1_000, { host: 'outro', velhaMs: 600_000, vivo: () => false }), null,
    'de outro host o PID não diz nada — só o batimento');
});

test('trava: dois PROCESSOS no mesmo ler→somar→gravar não perdem atualização', async () => {
  const dir = tmp();
  const contador = path.join(dir, 'contador.txt');
  fs.writeFileSync(contador, '0');
  const modulo = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'trava.ts')).href;
  const N = 15;
  const script =
    `import fs from 'node:fs';\n` +
    `import { adquireTrava } from ${JSON.stringify(modulo)};\n` +
    `for (let i = 0; i < ${N}; i++) {\n` +
    `  const t = await adquireTrava(${JSON.stringify(dir)}, { comando: 'p', pausaMs: 2, anuncia: () => {} });\n` +
    `  const v = Number(fs.readFileSync(${JSON.stringify(contador)}, 'utf8'));\n` +
    `  await new Promise((r) => setTimeout(r, 3));\n` +
    `  fs.writeFileSync(${JSON.stringify(contador)}, String(v + 1));\n` +
    `  t.solta();\n` +
    `}\n`;
  const roda = (): Promise<number | null> =>
    new Promise((ok) => {
      const env = { ...process.env };
      delete env[VAR_TRAVA_HERDADA];
      spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'inherit', env }).once('exit', ok);
    });
  const codigos = await Promise.all([roda(), roda()]);
  assert.deepEqual(codigos, [0, 0]);
  assert.equal(Number(fs.readFileSync(contador, 'utf8')), 2 * N, 'uma atualização se perdeu: a trava não serializou');
});
