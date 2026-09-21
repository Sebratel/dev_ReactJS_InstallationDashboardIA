// A API ENQUANTO um refresh acontece — a propriedade que justifica o desenho inteiro
// e que nenhum teste guardava.
//
// **Por que ela precisa de teste próprio.** Desde 19/09/2026 a cadência do refresh
// vive dentro do processo da API (`agendador.ts`), e não mais num daemon separado.
// Isso trocou um modo de falha por outro: antes, um refresh travado parava o refresh;
// agora, se ele bloquear o laço de eventos, para a TELA. A operação fica sem trabalhar.
//
// O que segura essa troca é a materialização rodar em subprocesso — e "roda em
// subprocesso" é o tipo de decisão que um conserto distraído desfaz (`spawnSync` tem
// a assinatura mais simples e parece equivalente). Estes testes falham se isso
// acontecer.
//
// `snapshotDir` temporário SEMPRE, pela mesma razão de `agendador.test.ts`.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Agendador } from '../src/agendador.ts';
import { Servidor } from '../src/servidor.ts';
import type { GrupoDeRefresh } from '../../../tools/refresh/src/grupos.ts';
import { rodaGrupoAssincrono } from '../../../tools/refresh/src/executa-grupo.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB = path.join(ROOT, 'apps', 'api', 'web');

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sob-refresh-'));
}

/** Uma promessa que o teste resolve quando quiser — para segurar um grupo em voo. */
function represa(): { promessa: Promise<void>; abre: () => void } {
  let abre!: () => void;
  const promessa = new Promise<void>((r) => {
    abre = r;
  });
  return { promessa, abre };
}

async function esperaAte(cond: () => boolean, oQue: string): Promise<void> {
  const ate = Date.now() + 5_000;
  while (!cond()) {
    if (Date.now() > ate) throw new Error(`não aconteceu em 5s: ${oQue}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Sobe a API de verdade, com o agendador de verdade ligado nela. */
async function apiComAgendador(
  dir: string,
  roda: (g: GrupoDeRefresh, sinal?: AbortSignal) => Promise<{ ok: boolean; erro?: string }>,
): Promise<{
  busca: (rota: string) => Promise<Response>;
  ag: Agendador;
  fecha: () => Promise<void>;
}> {
  let ag!: Agendador;
  const inst = new Servidor({
    root: ROOT,
    snapshotDir: dir,
    webDir: WEB,
    identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }),
    estadoDoAgendador: () => ag.estado(),
  });
  ag = new Agendador({
    raiz: ROOT,
    snapshotDir: dir,
    anuncia: () => {},
    // Carência curta: o relógio aqui é o real, e 60 s de carência travariam o teste.
    carenciaMs: 10,
    roda,
  });
  const http = inst.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    busca: (rota) => fetch(`http://127.0.0.1:${port}${rota}`),
    ag,
    fecha: () =>
      new Promise<void>((ok) => {
        ag.para();
        inst.destroi();
        http.close(() => ok());
      }),
  };
}

test('a API responde NORMALMENTE enquanto um grupo está materializando', async () => {
  const dir = tmp();
  const preso = represa();
  const api = await apiComAgendador(dir, async () => {
    await preso.promessa;
    return { ok: true };
  });

  api.ag.inicia();
  await esperaAte(() => api.ag.estado().emExecucao !== null, 'um grupo entrar em voo');

  // Vinte pedidos com a carga presa em voo. Se o laço de eventos estivesse bloqueado
  // — que é o que `spawnSync` faria —, nenhum deles voltaria até a carga terminar.
  const latencias: number[] = [];
  for (let i = 0; i < 20; i += 1) {
    const t0 = Date.now();
    const r = await api.busca('/api/saude');
    latencias.push(Date.now() - t0);
    assert.equal(r.status, 200, `pedido ${i} não foi servido durante a carga`);
  }
  const pior = Math.max(...latencias);
  assert.ok(pior < 1_000, `o pior pedido levou ${pior}ms durante a carga — o laço travou`);

  // E a saúde CONTA o que está acontecendo, em vez de fingir que está tudo parado.
  const saude = (await (await api.busca('/api/saude')).json()) as {
    agendador: { emExecucao: string | null; emCursoHaMs: number | null };
  };
  assert.ok(saude.agendador.emExecucao !== null, 'quem está de plantão precisa ver a carga em voo');
  assert.ok((saude.agendador.emCursoHaMs ?? 0) >= 0);

  preso.abre();
  await api.fecha();
});

test('um grupo que FALHA não tira a API do ar nem para a cadência', async () => {
  const dir = tmp();
  let chamadas = 0;
  const api = await apiComAgendador(dir, async () => {
    chamadas += 1;
    // Falha de materialização é um RESULTADO, não uma exceção — mas o agendador não
    // pode depender disso: quem injeta `roda` é código, e código erra.
    if (chamadas === 1) throw new Error('o filho não nasceu');
    return { ok: false, erro: 'saiu com código 1 — Connection terminated unexpectedly' };
  });

  api.ag.inicia();
  await esperaAte(() => api.ag.estado().execucoes >= 3, 'os três grupos tentarem');

  const r = await api.busca('/api/saude');
  assert.equal(r.status, 200, 'três falhas seguidas não podem derrubar a tela');
  const saude = (await r.json()) as { agendador: { ativo: boolean; falhas: number } };
  assert.equal(saude.agendador.ativo, true, 'a cadência continua de pé depois de falhar');
  assert.equal(saude.agendador.falhas, 3);

  await api.fecha();
});

test('o EXECUTOR REAL não bloqueia o laço de eventos — subprocesso, não spawnSync', async () => {
  // **Este é o único teste do arquivo que usa `rodaGrupoAssincrono` de verdade, e é
  // deliberado.** Os outros injetam `roda`, então provam a integração mas NÃO
  // pegariam alguém trocando `spawn` por `spawnSync` — uma promessa já resolvida
  // passaria por todos eles. Aqui nasce um processo filho de verdade.
  //
  // A query não existe de propósito: o materializador recusa no Query Registry e sai
  // em ~0,4 s, sem tocar banco, sem tocar o manifesto e sem imprimir dado de cliente.
  // O que interessa é que, durante esse tempo, o laço deste processo continue girando.
  let tiques = 0;
  const t = setInterval(() => {
    tiques += 1;
  }, 10);

  const r = await rodaGrupoAssincrono(ROOT, {
    id: 'prova',
    queries: ['esta-query-nao-existe'],
    intervaloMinutos: 999,
    incremental: false,
  });
  clearInterval(t);

  assert.equal(r.ok, false);
  // De quebra, prova ao vivo a captura do stderr: sem ela sobraria só o código.
  assert.match(String(r.erro), /Query Registry/, 'a causa da falha tem de vir junto do código');
  assert.ok(tiques > 5, `o laço girou só ${tiques}x enquanto o filho vivia — spawnSync?`);
});

test('a saúde continua respondendo com o agendador DESLIGADO por catálogo quebrado', async () => {
  // O agendador recusa fechado quando o catálogo não lê (`#recusa`), e isso NÃO pode
  // virar uma API sem saúde: "não há cadência, e o motivo é este" é justamente a frase
  // que faltava em 16/09/2026.
  const dir = tmp();
  const api = await apiComAgendador(dir, async () => ({ ok: true }));

  const vazio = tmp(); // sem `_catalog/refresh.yaml` nenhum
  const desligado = new Agendador({ raiz: ROOT, specsDir: vazio, snapshotDir: dir, anuncia: () => {} });
  desligado.inicia();
  assert.equal(desligado.estado().ativo, false);
  assert.match(String(desligado.estado().motivo), /nenhum grupo/);

  const r = await api.busca('/api/saude');
  assert.equal(r.status, 200);
  await api.fecha();
});
