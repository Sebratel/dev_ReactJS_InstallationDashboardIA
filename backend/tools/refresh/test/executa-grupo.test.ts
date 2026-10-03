// O argv que materializa um grupo, e o executor assíncrono que a API usa.
//
// O argv é testado sem criar processo nenhum de propósito: ele carrega três decisões
// que já custaram caro quando divergiram — o heap do filho, o `--refazer` (sem ele o
// materializador respeita o arquivo em disco e o tick não faz nada) e o
// `--incremental` condicional ao grupo.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  argvDoGrupo,
  MEMORIA_PADRAO_MB,
  rodaGrupoAssincrono,
} from '../src/executa-grupo.ts';
import type { GrupoDeRefresh } from '../src/grupos.ts';

const RAIZ = '/repo';
const cheio: GrupoDeRefresh = {
  id: 'quente',
  queries: ['contratos', 'feriados'],
  intervaloMinutos: 15,
  incremental: false,
};

/** Um `spawn` de mentira: devolve um emissor que o teste faz terminar como quiser. */
function spawnFalso(): {
  cria: (...args: unknown[]) => EventEmitter;
  filho: EventEmitter;
  recebido: { comando?: unknown; argv?: unknown; opcoes?: unknown };
} {
  const filho = new EventEmitter();
  const recebido: { comando?: unknown; argv?: unknown; opcoes?: unknown } = {};
  const cria = (comando: unknown, argv: unknown, opcoes: unknown): EventEmitter => {
    recebido.comando = comando;
    recebido.argv = argv;
    recebido.opcoes = opcoes;
    return filho;
  };
  return { cria, filho, recebido };
}

test('argvDoGrupo: o heap vai duas vezes — para o Node e para o materializador', () => {
  const argv = argvDoGrupo(RAIZ, cheio);
  assert.equal(argv[0], `--max-old-space-size=${MEMORIA_PADRAO_MB}`);
  assert.ok(argv.includes(`--memoria=${MEMORIA_PADRAO_MB}`));
  // Não é redundância: o primeiro dimensiona o V8 do processo filho, o segundo é lido
  // por `backend/tools/snapshot/src/index.ts` para os subprocessos que ELE dispara.
});

test('argvDoGrupo: as queries vão em uma lista só, e `--refazer` é obrigatório', () => {
  const argv = argvDoGrupo(RAIZ, cheio);
  assert.ok(argv.includes('--query=contratos,feriados'));
  // Um grupo é UM processo: `protocolos-geral` e `backlog-agendado-futuro` fazem
  // `NestedJoin` com a mesma `GESTORES EQUIPES`, buscada uma vez só. Foi isso que fez
  // a soma dos custos isolados superestimar o grupo por um fator de 2 em 16/09/2026.
  assert.ok(argv.includes('--refazer'), 'sem --refazer o tick não materializa nada');
});

test('argvDoGrupo: `--incremental` só aparece quando o grupo pede', () => {
  assert.ok(!argvDoGrupo(RAIZ, cheio).includes('--incremental'));
  assert.ok(argvDoGrupo(RAIZ, { ...cheio, incremental: true }).includes('--incremental'));
});

test('argvDoGrupo: lista liga só as citadas (ACHADOS #165)', () => {
  const argv = argvDoGrupo(RAIZ, { ...cheio, incremental: ['field-agenda'] });
  assert.ok(argv.includes('--incremental=field-agenda'));
  assert.ok(!argv.includes('--incremental'));
  assert.ok(!argvDoGrupo(RAIZ, { ...cheio, incremental: [] }).some((a) => a.startsWith('--incremental')));
});

test('argvDoGrupo: memória explícita vence o padrão nos dois lugares', () => {
  const argv = argvDoGrupo(RAIZ, cheio, 12288);
  assert.equal(argv[0], '--max-old-space-size=12288');
  assert.ok(argv.includes('--memoria=12288'));
});

test('rodaGrupoAssincrono: código 0 é sucesso', async () => {
  const { cria, filho } = spawnFalso();
  const p = rodaGrupoAssincrono(RAIZ, cheio, { cria: cria as never });
  filho.emit('exit', 0, null);
  assert.deepEqual(await p, { ok: true });
});

test('rodaGrupoAssincrono: código diferente de 0 é falha COM resumo, e não exceção', async () => {
  const { cria, filho } = spawnFalso();
  const p = rodaGrupoAssincrono(RAIZ, cheio, { cria: cria as never });
  filho.emit('exit', 1, null);
  // Falha de materialização é um resultado, não uma exceção: quem chama é um
  // agendador que precisa seguir para o grupo seguinte.
  assert.deepEqual(await p, { ok: false, erro: 'saiu com código 1' });
});

test('rodaGrupoAssincrono: morte por sinal também vira resultado', async () => {
  const { cria, filho } = spawnFalso();
  const p = rodaGrupoAssincrono(RAIZ, cheio, { cria: cria as never });
  filho.emit('exit', null, 'SIGKILL');
  assert.deepEqual(await p, { ok: false, erro: 'saiu com código SIGKILL' });
});

test("rodaGrupoAssincrono: o 'error' do filho é OUVIDO — sem isso ele derruba o processo", async () => {
  const { cria, filho } = spawnFalso();
  const p = rodaGrupoAssincrono(RAIZ, cheio, { cria: cria as never });
  // Um `'error'` sem ouvinte num `EventEmitter` vira exceção não tratada e mata o
  // processo. Dentro da API isso seria a tela caindo porque o `spawn` falhou —
  // exatamente o defeito que o `ioredis` causou em 08/09/2026.
  filho.emit('error', new Error('spawn ENOENT'));
  assert.deepEqual(await p, { ok: false, erro: 'spawn ENOENT' });
});

test('rodaGrupoAssincrono: resolve UMA vez só, mesmo com error e exit seguidos', async () => {
  const { cria, filho } = spawnFalso();
  const p = rodaGrupoAssincrono(RAIZ, cheio, { cria: cria as never });
  filho.emit('error', new Error('primeiro'));
  filho.emit('exit', 0, null);
  // Quem chegou primeiro manda: um `spawn` que falha costuma emitir os dois, e a
  // segunda resolução seria silenciosamente ignorada pela promessa — mas o estado do
  // agendador não pode depender disso.
  assert.deepEqual(await p, { ok: false, erro: 'primeiro' });
});

test('rodaGrupoAssincrono: roda na raiz, herda stdout e CANALIZA stderr', () => {
  const { cria, recebido } = spawnFalso();
  void rodaGrupoAssincrono(RAIZ, cheio, { cria: cria as never });
  assert.equal(recebido.comando, process.execPath);
  // `stdout: 'inherit'` é o que faz o log do materializador aparecer no log de quem o
  // disparou. Dentro da API, é o que põe a carga em `snapshot/npm-start.log`.
  //
  // `stderr: 'pipe'` foi o preço de um diagnóstico caro: com os dois herdados, tudo
  // que sobrou da falha de 19/09/2026 foi `saiu com código 1`, e a causa só apareceu
  // cruzando o histórico com o log de energia do Windows. O texto continua sendo
  // reescrito no nosso stderr, então nada some da tela.
  assert.deepEqual(recebido.opcoes, { cwd: RAIZ, stdio: ['ignore', 'inherit', 'pipe'] });
});

test('rodaGrupoAssincrono: a cauda do stderr entra no resumo da falha', async () => {
  const { cria, filho } = spawnFalso();
  const erros = new EventEmitter();
  (filho as unknown as { stderr: EventEmitter }).stderr = erros;
  const p = rodaGrupoAssincrono(RAIZ, cheio, { cria: cria as never });
  erros.emit('data', 'linha descartada\nConnection terminated unexpectedly\n');
  filho.emit('exit', 1, null);
  const r = await p;
  assert.equal(r.ok, false);
  assert.match(
    r.erro ?? '',
    /saiu com código 1 — .*Connection terminated unexpectedly/,
    'sem a cauda, "saiu com código 1" não diz nada a quem for investigar',
  );
});

test('rodaGrupoAssincrono: stderr vazio não deixa o resumo com sobra de pontuação', async () => {
  const { cria, filho } = spawnFalso();
  const p = rodaGrupoAssincrono(RAIZ, cheio, { cria: cria as never });
  filho.emit('exit', 1, null);
  assert.deepEqual(await p, { ok: false, erro: 'saiu com código 1' });
});

test('rodaGrupoAssincrono: o sinal mata o filho e devolve resultado, não exceção', async () => {
  const { cria, filho } = spawnFalso();
  let sinalRecebido: string | undefined;
  (filho as unknown as { kill: (s: string) => void }).kill = (s) => {
    sinalRecebido = s;
  };
  const ac = new AbortController();
  const p = rodaGrupoAssincrono(RAIZ, cheio, { cria: cria as never, sinal: ac.signal });
  ac.abort('máquina suspensa');
  const r = await p;
  // SIGKILL e não SIGTERM: quem aborta já concluiu que este filho não termina sozinho
  // — as conexões dele com o banco morreram enquanto a máquina dormia.
  assert.equal(sinalRecebido, 'SIGKILL');
  assert.deepEqual(r, { ok: false, erro: 'interrompida: máquina suspensa' });
});

test('rodaGrupoAssincrono: sinal já abortado antes do spawn não trava a promessa', async () => {
  const { cria, filho } = spawnFalso();
  (filho as unknown as { kill: () => void }).kill = () => {};
  const ac = new AbortController();
  ac.abort('tarde demais');
  const r = await rodaGrupoAssincrono(RAIZ, cheio, { cria: cria as never, sinal: ac.signal });
  assert.deepEqual(r, { ok: false, erro: 'interrompida: tarde demais' });
});
