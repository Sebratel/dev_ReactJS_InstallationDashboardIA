import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ehArquivoDeSnapshot } from '../../../packages/snapshot/src/formato.ts';
import { executaCiclo } from '../src/daemon.ts';
import type { GrupoDeRefresh } from '../src/grupos.ts';
import {
  ARQUIVO_HISTORICO,
  TAMANHO_MAXIMO_BYTES,
  leHistorico,
  registra,
  resumeDePulos,
  resumePorGrupo,
  type EventoDeRefresh,
} from '../src/historico.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DAEMON = path.join(ROOT, 'tools', 'refresh', 'src', 'daemon.ts');

function dirTemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-historico-'));
}

// O arquivo mora DENTRO de `snapshot/`, ao lado das tabelas, e três varreduras do
// diretório reconhecem tabela pelo sufixo sem abrir o arquivo. `.jsonl` seria uma delas
// — e `ehArquivoDeSnapshot('refresh-historico.jsonl')` devolvia `true` de fato, o que é
// o motivo de este teste existir com nome e não com suposição.
test('historico: o nome do arquivo NÃO pode ser confundido com tabela de snapshot', () => {
  assert.equal(ehArquivoDeSnapshot(ARQUIVO_HISTORICO), false);
});

test('historico: sem arquivo, leHistorico devolve lista vazia em vez de lançar', () => {
  assert.deepEqual(leHistorico(dirTemp()), []);
});

test('historico: registra acrescenta uma linha por evento, na ordem', () => {
  const dir = dirTemp();
  registra(dir, { evento: 'arranque', quando: '2026-09-16T10:00:00.000Z', intervaloMinutos: 15, pid: 1 });
  registra(dir, { evento: 'grupo', quando: '2026-09-16T10:00:30.000Z', grupo: 'quente', ok: true, duracaoMs: 60000 });
  registra(dir, {
    evento: 'grupo',
    quando: '2026-09-16T10:01:00.000Z',
    grupo: 'medio',
    ok: false,
    duracaoMs: 900,
    erro: 'saiu com código 1',
  });

  const eventos = leHistorico(dir);
  assert.equal(eventos.length, 3);
  assert.equal(eventos[0]!.evento, 'arranque');
  assert.equal((eventos[2] as { grupo: string }).grupo, 'medio');
});

// É o defeito que este módulo existe para consertar: em `refresh-status.json` o
// sucesso das 03:15 apaga a falha das 03:00 e `falhasConsecutivas` volta a 0 — não
// sobra nada dizendo que houve queda. Aqui as duas linhas coexistem.
test('historico: um sucesso DEPOIS de uma falha não apaga a falha', () => {
  const dir = dirTemp();
  registra(dir, {
    evento: 'grupo',
    quando: '2026-09-16T03:00:00.000Z',
    grupo: 'quente',
    ok: false,
    duracaoMs: 800,
    erro: 'saiu com código 1',
  });
  registra(dir, { evento: 'grupo', quando: '2026-09-16T03:15:00.000Z', grupo: 'quente', ok: true, duracaoMs: 60000 });

  const resumo = resumePorGrupo(leHistorico(dir));
  assert.equal(resumo.length, 1);
  assert.equal(resumo[0]!.tentativas, 2);
  assert.equal(resumo[0]!.falhas, 1);
  assert.equal(resumo[0]!.ultimaFalha, '2026-09-16T03:00:00.000Z');
  assert.equal(resumo[0]!.ultimoErro, 'saiu com código 1');
  assert.equal(resumo[0]!.duracaoMediaMs, 30400);
});

test('historico: linha ilegível é pulada, não derruba a leitura', () => {
  const dir = dirTemp();
  registra(dir, { evento: 'grupo', quando: 'a', grupo: 'quente', ok: true, duracaoMs: 1 });
  fs.appendFileSync(path.join(dir, ARQUIVO_HISTORICO), '{isto não é json\n', 'utf8');
  registra(dir, { evento: 'grupo', quando: 'b', grupo: 'frio', ok: true, duracaoMs: 2 });

  const eventos = leHistorico(dir);
  assert.equal(eventos.length, 2);
  assert.deepEqual(
    eventos.map((e) => (e as { grupo: string }).grupo),
    ['quente', 'frio'],
  );
});

test('historico: o arquivo é aparado pelo COMEÇO quando passa do teto, e continua legível', () => {
  const dir = dirTemp();
  const alvo = path.join(dir, ARQUIVO_HISTORICO);
  const gordo = JSON.stringify({
    evento: 'grupo',
    quando: 'velho',
    grupo: 'quente',
    ok: true,
    duracaoMs: 1,
    enchimento: 'x'.repeat(400),
  });
  const linhas = Math.ceil(TAMANHO_MAXIMO_BYTES / (gordo.length + 1)) + 50;
  fs.writeFileSync(alvo, Array.from({ length: linhas }, () => gordo).join('\n') + '\n', 'utf8');
  assert.ok(fs.statSync(alvo).size > TAMANHO_MAXIMO_BYTES);

  registra(dir, { evento: 'grupo', quando: 'novo', grupo: 'frio', ok: true, duracaoMs: 2 });

  assert.ok(fs.statSync(alvo).size <= TAMANHO_MAXIMO_BYTES, 'devia ter aparado');
  const eventos = leHistorico(dir, 0);
  assert.ok(eventos.length > 0);
  // O que sobrevive é o FIM: o evento recém-registrado tem de estar na última linha.
  assert.equal(eventos[eventos.length - 1]!.quando, 'novo');
  // E nenhuma linha meio-cortada passou por JSON.parse.
  for (const e of eventos) assert.equal(e.evento, 'grupo');
});

test('historico: registra nunca lança, mesmo com destino impossível', () => {
  const dir = dirTemp();
  const arquivoNoLugarDoDiretorio = path.join(dir, 'nao-sou-pasta');
  fs.writeFileSync(arquivoNoLugarDoDiretorio, 'x', 'utf8');
  assert.doesNotThrow(() => {
    registra(arquivoNoLugarDoDiretorio, { evento: 'grupo', quando: 'a', grupo: 'quente', ok: true, duracaoMs: 1 });
  });
});

// A gravação é POR GRUPO, e não no fim do tick, pela mesma razão que `executaTick`
// persiste o status depois de cada grupo: um tick morto no meio não pode perder o que
// já terminou. O `roda` mockado lança no segundo grupo para provar isso.
test('daemon: o histórico do grupo que terminou sobrevive à falha do seguinte', async () => {
  const dir = dirTemp();
  const rodados: string[] = [];
  await assert.rejects(
    executaCiclo({
      raiz: ROOT,
      snapshotDir: dir,
      roda: (g: GrupoDeRefresh) => {
        rodados.push(g.id);
        if (rodados.length === 2) throw new Error('estouro simulado no segundo grupo');
        return { ok: true };
      },
    }),
  );

  const eventos = leHistorico(dir);
  assert.equal(eventos.length, 1, 'o primeiro grupo tem de ter deixado rastro');
  assert.equal((eventos[0] as { grupo: string }).grupo, rodados[0]);
  assert.equal((eventos[0] as { ok: boolean }).ok, true);
});

test('daemon: executaCiclo registra ok e erro de cada grupo vencido', async () => {
  const dir = dirTemp();
  await executaCiclo({
    raiz: ROOT,
    snapshotDir: dir,
    roda: (g: GrupoDeRefresh) => (g.id === 'medio' ? { ok: false, erro: 'saiu com código 1' } : { ok: true }),
  });

  const resumo = resumePorGrupo(leHistorico(dir));
  assert.ok(resumo.length >= 3, 'quente, medio e frio');
  const medio = resumo.find((r) => r.grupo === 'medio');
  assert.ok(medio);
  assert.equal(medio!.falhas, 1);
  assert.equal(medio!.ultimoErro, 'saiu com código 1');
  assert.equal(resumo.find((r) => r.grupo === 'quente')!.falhas, 0);
});

test('daemon: --so-plano NÃO escreve histórico (dry-run não deixa rastro)', async () => {
  const dir = dirTemp();
  await executaCiclo({ raiz: ROOT, snapshotDir: dir, soPlano: true });
  assert.equal(fs.existsSync(path.join(dir, ARQUIVO_HISTORICO)), false);
});

test('daemon.ts --historico: lê e sai sem subir agendador nenhum', () => {
  const r = spawnSync(process.execPath, [DAEMON, '--historico'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0);
  const saida = (r.stdout ?? '') + (r.stderr ?? '');
  assert.ok(!saida.includes('Agendador automático iniciado'), 'não pode ter subido o daemon');
});

test('daemon.ts: argumento desconhecido continua recusado, e a ajuda cita --historico', () => {
  const r = spawnSync(process.execPath, [DAEMON, '--nao-existe'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match((r.stdout ?? '') + (r.stderr ?? ''), /--historico/);
});

test('historico: resumePorGrupo ignora eventos que não são de grupo', () => {
  const eventos: EventoDeRefresh[] = [
    { evento: 'arranque', quando: 'a', intervaloMinutos: 15, pid: 1 },
    { evento: 'erro-de-ciclo', quando: 'b', erro: 'refresh.yaml com problemas' },
  ];
  assert.deepEqual(resumePorGrupo(eventos), []);
});

// A CADÊNCIA PERDIDA NÃO É UMA FALHA, e é por isso que ela precisa de evento
// próprio. Um ciclo que estoura o intervalo faz o disparo seguinte ser pulado:
// `falhas` continua zero, `refresh-status.json` continua verde, e a única pista
// era um `console.log` num terminal que ninguém lê — o buraco do #129, de novo.
test('historico: resumeDePulos conta a cadência perdida, que não aparece como falha', () => {
  const eventos: EventoDeRefresh[] = [
    { evento: 'grupo', quando: 'a', grupo: 'medio', ok: true, duracaoMs: 430_000 },
    { evento: 'ciclo-pulado', quando: '2026-09-17T18:00:00.000Z', cicloEmCursoHaMs: 940_000 },
    { evento: 'grupo', quando: 'c', grupo: 'medio', ok: true, duracaoMs: 361_000 },
    { evento: 'ciclo-pulado', quando: '2026-09-17T18:15:00.000Z', cicloEmCursoHaMs: 1_200_000 },
  ];
  const r = resumeDePulos(eventos);
  assert.equal(r.pulos, 2);
  assert.equal(r.ultimo, '2026-09-17T18:15:00.000Z');
  assert.equal(r.maiorAtropeloMs, 1_200_000);

  // E o ponto todo: nenhum desses dois pulos aparece na contagem de falhas.
  const porGrupo = resumePorGrupo(eventos);
  assert.equal(porGrupo.length, 1);
  assert.equal(porGrupo[0]!.falhas, 0, 'pular não é falhar — é essa a armadilha');
});

test('historico: sem pulo nenhum, o resumo é zerado e não inventa último', () => {
  const r = resumeDePulos([
    { evento: 'grupo', quando: 'a', grupo: 'quente', ok: false, duracaoMs: 1, erro: 'x' },
  ]);
  assert.deepEqual(r, { pulos: 0, maiorAtropeloMs: 0 });
});

test('historico: ciclo-pulado sobrevive à ida e volta pelo arquivo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-pulo-'));
  registra(dir, { evento: 'ciclo-pulado', quando: '2026-09-17T19:00:00.000Z', cicloEmCursoHaMs: 907_000 });
  const lidos = leHistorico(dir);
  assert.equal(lidos.length, 1);
  assert.deepEqual(lidos[0], {
    evento: 'ciclo-pulado',
    quando: '2026-09-17T19:00:00.000Z',
    cicloEmCursoHaMs: 907_000,
  });
  assert.equal(resumeDePulos(lidos).pulos, 1);
});
