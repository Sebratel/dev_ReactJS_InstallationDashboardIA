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
  descreveMortesDaApi,
  resumeDeCoalescidos,
  resumeDePulos,
  resumeDeSuspensoes,
  resumePorGrupo,
  type EventoDeRefresh,
} from '../src/historico.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DAEMON = path.join(ROOT, 'backend', 'tools', 'refresh', 'src', 'daemon.ts');

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

// ---------------------------------------------------------------------------
// A MORTE DA API NÃO APARECIA EM LUGAR NENHUM (18/09/2026, ACHADOS #137).
//
// `subir` imprimia `A API saiu (código 1).` e morria junto. Essa linha vive no
// terminal de quem digitou `npm start` — exatamente o que não existe mais quando
// alguém pergunta por que a stack caiu. Aconteceu de verdade neste dia: a API
// saiu com código 1 e não houve como recuperar o motivo nem a hora.
//
// O daemon já deixava `arranque` (#129). A API não deixava nada, e é a morte dela
// que derruba a stack inteira.
test('historico: api-morreu sobrevive à ida e volta pelo arquivo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-api-'));
  registra(dir, {
    evento: 'api-morreu',
    quando: '2026-09-18T12:32:21.000Z',
    codigo: 1,
    viveuMs: 1_451_000,
  });
  const lidos = leHistorico(dir);
  assert.deepEqual(lidos, [
    { evento: 'api-morreu', quando: '2026-09-18T12:32:21.000Z', codigo: 1, viveuMs: 1_451_000 },
  ]);
});

test('historico: a morte da API não conta como falha de grupo nenhum', () => {
  // Ela não é grupo, e confundir as duas contagens inventaria uma falha de
  // refresh que nunca houve.
  const eventos: EventoDeRefresh[] = [
    { evento: 'grupo', quando: 'a', grupo: 'quente', ok: true, duracaoMs: 72_000 },
    { evento: 'api-morreu', quando: 'b', codigo: 1, viveuMs: 1_000 },
  ];
  const r = resumePorGrupo(eventos);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.falhas, 0);
  assert.equal(resumeDePulos(eventos).pulos, 0);
});

test('descreveMortesDaApi: silencia quando nao houve morte nenhuma', () => {
  assert.deepEqual(
    descreveMortesDaApi([{ evento: 'arranque', quando: 'a', intervaloMinutos: 15, pid: 1 }]),
    [],
  );
});

// O que decide o diagnostico e QUANTO TEMPO ela viveu: segundos apontam
// configuracao (subiu e caiu), horas apontam causa externa. Por isso a conversao
// e o unico pedaco desta formatacao com chance de sair errada, e e o que se testa.
test('descreveMortesDaApi: vida curta em segundos, vida longa em horas', () => {
  const linhas = descreveMortesDaApi([
    { evento: 'api-morreu', quando: '2026-09-18T12:00:08.000Z', codigo: 1, viveuMs: 8_000 },
    { evento: 'api-morreu', quando: '2026-09-18T20:00:00.000Z', codigo: 1, viveuMs: 28_800_000 },
  ]);
  assert.match(linhas[0]!, /MORTES DA API: 2/);
  assert.match(linhas[1]!, /depois de 8 s no ar/);
  assert.match(linhas[2]!, /depois de 8\.0 h no ar/);
  assert.ok(linhas.some((l) => l.includes('porta 3100')), 'tem de dizer a causa mais comum');
});

test('descreveMortesDaApi: mostra as ultimas, nao todas, e diz o total', () => {
  const muitas = Array.from({ length: 9 }, (_, i) => ({
    evento: 'api-morreu' as const,
    quando: `2026-09-18T12:00:0${i}.000Z`,
    codigo: 1,
    viveuMs: 1_000 * (i + 1),
  }));
  const linhas = descreveMortesDaApi(muitas, 3);
  assert.match(linhas[0]!, /MORTES DA API: 9/, 'o total e das nove');
  assert.match(linhas[1]!, /depois de 7 s no ar/, 'mas so as tres ultimas aparecem');
  assert.match(linhas[3]!, /depois de 9 s no ar/);
});

test('descreveMortesDaApi: codigo nulo nao vira "null" na tela', () => {
  const linhas = descreveMortesDaApi([
    { evento: 'api-morreu', quando: 'x', codigo: null, viveuMs: 5_000 },
  ]);
  assert.match(linhas[1]!, /código \?/, 'código nulo tem de sair como "?", não como "null"');
  assert.ok(!linhas[1]!.includes('null'), 'a palavra "null" não pertence a um relatório humano');
});

// 22/09/2026: quatro mortes com 0xC0000409 e nenhum motivo registrado. O evento
// passou a levar o motivo e os arquivos de diagnostico (backend/tools/subir/src/diagnostico.ts)
// -- e o relatorio de operador e o lugar onde isso tem de aparecer, senao o campo
// existe no log e ninguem o le.
test('descreveMortesDaApi: mostra o motivo e onde estao os arquivos de diagnostico', () => {
  const linhas = descreveMortesDaApi([
    {
      evento: 'api-morreu',
      quando: '2026-09-23T10:00:00.000Z',
      codigo: 3221226505,
      viveuMs: 7_200_000,
      motivo: 'Assertion failed: handle->flags & UV_HANDLE_CLOSING',
      stderr: 'api-stderr.2026-09-23T10-00-00-000Z.log',
    },
  ]);
  assert.match(linhas[1]!, /código 3221226505/);
  assert.match(linhas[2]!, /motivo: Assertion failed/);
  assert.match(linhas[3]!, /snapshot\/diagnostico\/: api-stderr\.2026-09-23T10-00-00-000Z\.log/);
});

test('descreveMortesDaApi: linha antiga, sem os campos novos, sai igual a antes', () => {
  const linhas = descreveMortesDaApi([
    { evento: 'api-morreu', quando: 'x', codigo: 1, viveuMs: 5_000 },
    { evento: 'api-morreu', quando: 'y', codigo: 1, viveuMs: 6_000 },
  ]);
  assert.match(linhas[1]!, /depois de 5 s no ar/);
  assert.match(linhas[2]!, /depois de 6 s no ar/, 'nenhuma linha de motivo pode aparecer entre as duas');
});


// ─────────────────────────────────────────────────────────────────────────────
// `disparo-coalescido` — o sucessor de `ciclo-pulado`, para quando quem agenda é a
// API (`backend/api/src/agendador.ts`). A diferença entre os dois é o tamanho do que se
// perde: `ciclo-pulado` custava o TICK inteiro (um grupo lento fazia todos os outros
// perderem a vez); este custa só a segunda cópia do próprio grupo, que materializaria
// exatamente o que já está sendo materializado.

test('resumeDeCoalescidos: sem eventos, lista vazia', () => {
  assert.deepEqual(resumeDeCoalescidos([]), []);
  assert.deepEqual(
    resumeDeCoalescidos([{ evento: 'grupo', quando: 'x', grupo: 'quente', ok: true, duracaoMs: 1 }]),
    [],
  );
});

test('resumeDeCoalescidos: conta por grupo e guarda o PIOR caso, não o último', () => {
  const eventos: EventoDeRefresh[] = [
    { evento: 'disparo-coalescido', quando: '2026-09-19T10:00:00Z', grupo: 'medio', emCursoHaMs: 900_000 },
    { evento: 'disparo-coalescido', quando: '2026-09-19T10:20:00Z', grupo: 'medio', emCursoHaMs: 120_000 },
    { evento: 'disparo-coalescido', quando: '2026-09-19T10:30:00Z', grupo: 'frio', emCursoHaMs: 60_000 },
  ];
  const r = resumeDeCoalescidos(eventos);

  // Ordenado pelo que dói mais: quem descarta com mais frequência vem primeiro.
  assert.equal(r[0]!.grupo, 'medio');
  assert.equal(r[0]!.descartados, 2);
  // O pior caso é o que dimensiona a cadência — uma média esconderia os 900 s.
  assert.equal(r[0]!.maiorEmCursoMs, 900_000);
  assert.equal(r[0]!.ultimo, '2026-09-19T10:20:00Z');
  assert.equal(r[1]!.grupo, 'frio');
  assert.equal(r[1]!.descartados, 1);
});

test('resumeDeCoalescidos: lê o que `registra` escreveu de verdade', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coalescido-'));
  registra(dir, {
    evento: 'disparo-coalescido',
    quando: '2026-09-19T11:00:00Z',
    grupo: 'quente',
    emCursoHaMs: 94_100,
  });
  const r = resumeDeCoalescidos(leHistorico(dir, 50));
  assert.equal(r.length, 1);
  assert.equal(r[0]!.grupo, 'quente');
  assert.equal(r[0]!.maiorEmCursoMs, 94_100);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('agendador-arranque: o histórico distingue QUEM estava no comando', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arranque-'));
  // O daemon dedicado registra UM intervalo — ele varre todos os grupos e decide ali.
  registra(dir, { evento: 'arranque', quando: '2026-09-19T09:00:00Z', intervaloMinutos: 15, pid: 1 });
  // A API tem relógio POR GRUPO, então o que importa registrar é a lista inteira.
  registra(dir, {
    evento: 'agendador-arranque',
    quando: '2026-09-19T09:05:00Z',
    pid: 2,
    grupos: [
      { id: 'quente', intervaloMinutos: 15 },
      { id: 'frio', intervaloMinutos: 30 },
    ],
  });

  const eventos = leHistorico(dir, 50);
  const doProcesso = eventos.find((e) => e.evento === 'agendador-arranque');
  assert.ok(doProcesso, 'lendo o histórico depois do fato, é esta linha que diz quem agendava');
  assert.equal((doProcesso as { grupos: unknown[] }).grupos.length, 2);
  // Os dois convivem no arquivo: em produção o daemon continua sendo serviço próprio,
  // e no host quem agenda é a API. Confundir um com o outro é ler a cadência errada.
  assert.ok(eventos.some((e) => e.evento === 'arranque'));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// SUSPENSÃO DA MÁQUINA — 19/09/2026
// ---------------------------------------------------------------------------

test('resumeDeSuspensoes: sem suspensão nenhuma devolve null, e não um resumo zerado', () => {
  // `null` e não `{vezes: 0}`: quem imprime o relatório decide se a seção existe, e
  // uma seção "A MÁQUINA DORMIU: 0x" é ruído que ensina a pular o bloco.
  assert.equal(resumeDeSuspensoes([]), null);
  assert.equal(
    resumeDeSuspensoes([
      { evento: 'grupo', quando: 'a', grupo: 'quente', ok: true, duracaoMs: 1 },
    ] as EventoDeRefresh[]),
    null,
  );
});

test('resumeDeSuspensoes: soma o tempo parado e conta as cargas perdidas', () => {
  const eventos = [
    { evento: 'maquina-suspensa', quando: 'a', paradaMs: 8_040_000, grupoEmVoo: 'medio' },
    { evento: 'carga-interrompida', quando: 'b', grupo: 'medio', duracaoMs: 8_272_913, motivo: 'máquina suspensa' },
    { evento: 'maquina-suspensa', quando: 'c', paradaMs: 600_000, grupoEmVoo: null },
  ] as EventoDeRefresh[];
  const r = resumeDeSuspensoes(eventos);
  assert.ok(r);
  assert.equal(r.vezes, 2);
  assert.equal(r.totalParadoMs, 8_640_000);
  // O MAIOR, não o último: é o congelamento longo que explica um grupo vencido, e o
  // último pode perfeitamente ter sido o curto.
  assert.equal(r.maiorParadaMs, 8_040_000);
  assert.equal(r.ultimo, 'c');
  assert.equal(r.cargasPerdidas, 1);
});

test('resumeDeCoalescidos: separa quem estava RODANDO de quem só esperava na fila', () => {
  // Os dois casos têm conselhos opostos. Em 19/09/2026 o relatório imprimiu
  // `quente 1x, já rodava há 0s` e mandou afrouxar a cadência do `quente` — mas o
  // `quente` não estava rodando: estava atrás do `medio`, que a suspensão da máquina
  // tinha congelado havia 2h15min. Afrouxar o `quente` não teria mudado nada.
  const eventos = [
    { evento: 'disparo-coalescido', quando: 'a', grupo: 'medio', emCursoHaMs: 8_105_361 },
    { evento: 'disparo-coalescido', quando: 'b', grupo: 'quente', emCursoHaMs: 0 },
    { evento: 'disparo-coalescido', quando: 'c', grupo: 'quente', emCursoHaMs: 0 },
  ] as EventoDeRefresh[];
  const [quente, medio] = resumeDeCoalescidos(eventos);
  assert.equal(quente?.grupo, 'quente');
  assert.equal(quente?.descartados, 2);
  assert.equal(quente?.esperandoNaFila, 2);
  assert.equal(quente?.maiorEmCursoMs, 0, 'nunca rodou quando foi descartado');
  assert.equal(medio?.grupo, 'medio');
  assert.equal(medio?.esperandoNaFila, 0, 'esse sim estava materializando');
});

test('registra: os eventos de suspensão sobrevivem à ida e volta do disco', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-sono-'));
  registra(dir, {
    evento: 'maquina-suspensa',
    quando: '2026-09-19T18:51:48.519Z',
    paradaMs: 8_040_000,
    grupoEmVoo: 'medio',
  });
  registra(dir, {
    evento: 'carga-interrompida',
    quando: '2026-09-19T18:54:36.070Z',
    grupo: 'medio',
    duracaoMs: 8_272_913,
    motivo: 'máquina suspensa',
  });
  const lidos = leHistorico(dir);
  assert.equal(lidos.length, 2);
  assert.equal(lidos[0]?.evento, 'maquina-suspensa');
  assert.equal(lidos[1]?.evento, 'carga-interrompida');
  const r = resumeDeSuspensoes(lidos);
  assert.equal(r?.cargasPerdidas, 1);
});
