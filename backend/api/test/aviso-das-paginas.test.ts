// Quem o tempo real avisa NA HORA e quem recebe as mudanças juntas (ACHADOS #175).
//
// A `field-agenda` muda a cada ~35 s, e cada mudança derrubava junto as duas páginas
// mais caras do site; o reaquecimento nunca alcançava. Desde 05/10/2026 a VISÃO
// PRODUTIVA (`agendamento-field`) segue avisada na hora, e as demais páginas juntam
// as mudanças numa rodada a cada `demaisACadaMs`. Aqui a `capa` faz o papel da
// imediata: é a única página que dá para calcular com um snapshot escrito à mão, e
// a `hora-atualizado` alimenta também páginas que não são ela.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { escreve } from '../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto } from '../../packages/snapshot/src/manifesto.ts';
import { Servidor } from '../src/servidor.ts';
import type { ServidorOptions } from '../src/opcoes-servidor.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB = path.join(ROOT, 'frontend', 'dist');
const AGORA = new Date('2026-08-07T12:00:00.000Z');

async function dirComCapa(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aviso-paginas-'));
  const cab = await escreve(
    arquivoDaQuery(dir, 'hora-atualizado'),
    { query: 'hora-atualizado', tabelas: ['HORA ATUALIZADO'], geradoEm: '2026-08-07T11:00:00.000Z' },
    ['datahora', 'data', 'hora'],
    [
      {
        datahora: new Date('2026-08-07T10:34:00.000Z'),
        data: new Date('2026-08-07T00:00:00.000Z'),
        hora: new Date('1899-12-30T10:34:00.000Z'),
      },
    ],
  );
  await escreveManifesto(dir, [
    { query: 'hora-atualizado', tabelas: cab.tabelas, linhas: 1, colunas: 3, bytes: 200, geradoEm: cab.geradoEm },
  ]);
  return dir;
}

async function sobe(extras: Partial<ServidorOptions>): Promise<{
  servidor: Servidor;
  busca: (rota: string) => Promise<Response>;
  fecha: () => Promise<void>;
}> {
  const servidor = new Servidor({
    root: ROOT,
    snapshotDir: await dirComCapa(),
    webDir: WEB,
    agora: () => AGORA,
    identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }),
    overlayRealtime: () => new Map(),
    ...extras,
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    servidor,
    busca: (rota) => fetch(`http://127.0.0.1:${port}${rota}`),
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.closeAllConnections?.();
        http.close(() => ok());
      }),
  };
}

/** Lê os eventos de página do SSE, na ordem, com o instante de cada um. */
async function ouve(resp: Response): Promise<{
  eventos: { em: number; dashboards: string[] }[];
  para: () => Promise<void>;
}> {
  const eventos: { em: number; dashboards: string[] }[] = [];
  const leitor = resp.body!.getReader();
  let buf = '';
  const laco = (async () => {
    for (;;) {
      const { value, done } = await leitor.read().catch(() => ({ value: undefined, done: true }));
      if (done) return;
      buf += Buffer.from(value!).toString();
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const ev = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const dado = ev.match(/^data: (.*)$/m)?.[1];
        if (dado) eventos.push({ em: Date.now(), dashboards: (JSON.parse(dado) as { dashboards: string[] }).dashboards });
      }
    }
  })();
  return {
    eventos,
    para: async () => {
      await leitor.cancel().catch(() => undefined);
      await laco;
    },
  };
}

async function ate(cond: () => boolean, ms = 3000): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond() && Date.now() < fim) await new Promise((r) => setTimeout(r, 10));
  assert.ok(cond(), 'a condição não chegou a valer');
}

test('a imediata é avisada na hora; as demais, numa rodada só, depois do intervalo', async () => {
  const s = await sobe({ avisoDasPaginas: { imediatas: ['capa'], demaisACadaMs: 300 } });
  try {
    const sse = await ouve(await s.busca('/api/eventos'));
    const t0 = Date.now();
    s.servidor.aoTabelaMudar('HORA ATUALIZADO', 'hora-atualizado');
    // Uma segunda mudança dentro do intervalo entra na MESMA rodada.
    setTimeout(() => s.servidor.aoTabelaMudar('HORA ATUALIZADO', 'hora-atualizado'), 100);

    await ate(() => sse.eventos.length >= 3);
    await new Promise((r) => setTimeout(r, 150));
    await sse.para();

    const [primeiro, segundo, terceiro, ...resto] = sse.eventos;
    assert.deepEqual(primeiro!.dashboards, ['capa'], 'o primeiro aviso é só da imediata');
    assert.deepEqual(segundo!.dashboards, ['capa'], 'a segunda mudança também avisa a imediata na hora');
    assert.ok(primeiro!.em - t0 < 250, 'a imediata não pode esperar a rodada');
    assert.ok(!terceiro!.dashboards.includes('capa'), 'a imediata não entra na rodada das demais');
    assert.ok(terceiro!.dashboards.length > 0);
    assert.ok(terceiro!.em - t0 >= 280, `a rodada saiu cedo demais (${terceiro!.em - t0} ms)`);
    assert.equal(resto.length, 0, 'duas mudanças no intervalo têm de virar UMA rodada das demais');
  } finally {
    await s.fecha();
  }
});

test('a imediata perde o cache na hora, mesmo com as demais esperando a rodada', async () => {
  const s = await sobe({ avisoDasPaginas: { imediatas: ['capa'], demaisACadaMs: 60_000 } });
  try {
    await (await s.busca('/api/dashboards/capa')).arrayBuffer();
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'hit');
    s.servidor.aoTabelaMudar('HORA ATUALIZADO', 'hora-atualizado');
    // Caiu: sai a "última pronta", e não o `hit` de antes do evento.
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'anterior');
  } finally {
    await s.fecha();
  }
});

test('página que não é imediata mantém o cache até a rodada', async () => {
  // Agora a `capa` é das DEMAIS: o evento não a derruba antes do intervalo.
  const s = await sobe({ avisoDasPaginas: { imediatas: ['agendamento-field'], demaisACadaMs: 300 } });
  try {
    await (await s.busca('/api/dashboards/capa')).arrayBuffer();
    s.servidor.aoTabelaMudar('HORA ATUALIZADO', 'hora-atualizado');
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'hit', 'caiu antes da rodada');
    await new Promise((r) => setTimeout(r, 400));
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'anterior', 'a rodada não a derrubou');
  } finally {
    await s.fecha();
  }
});

test('sem a opção, ou com intervalo 0, tudo segue avisado na hora (o comportamento de antes)', async () => {
  for (const extras of [{}, { avisoDasPaginas: { imediatas: [], demaisACadaMs: 0 } }]) {
    const s = await sobe(extras);
    try {
      const sse = await ouve(await s.busca('/api/eventos'));
      s.servidor.aoTabelaMudar('HORA ATUALIZADO', 'hora-atualizado');
      await ate(() => sse.eventos.length >= 1);
      await sse.para();
      assert.ok(sse.eventos[0]!.dashboards.includes('capa'));
      assert.ok(sse.eventos[0]!.dashboards.length > 1, 'todas as afetadas no mesmo aviso, como antes');
    } finally {
      await s.fecha();
    }
  }
});

test('quem recebeu a última pronta é avisado de novo quando a versão nova fica pronta', async () => {
  // Sem o segundo aviso, a tela ficaria com o número de antes do evento até o
  // PRÓXIMO evento: o tempo real atrasado um ciclo inteiro (ACHADOS #175).
  const s = await sobe({});
  try {
    await (await s.busca('/api/dashboards/capa')).arrayBuffer();
    const sse = await ouve(await s.busca('/api/eventos'));
    s.servidor.aoTabelaMudar('HORA ATUALIZADO', 'hora-atualizado');
    await ate(() => sse.eventos.length >= 1);
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'anterior');
    await ate(() => sse.eventos.length >= 2, 10_000);
    assert.deepEqual(sse.eventos[1]!.dashboards, ['capa'], 'o segundo aviso é só da página servida velha');
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'hit', 'depois do aviso, a nova está pronta');
    await sse.para();
  } finally {
    await s.fecha();
  }
});

test('?recalcula=1 de um usuário comum é ignorado; o de ferramenta interna vale', async () => {
  // Um clique de uma pessoa não pode refazer a conta e regravar a resposta que todo
  // mundo lê (Erick, 05/10/2026). O pedido dela segue servido do que já está pronto.
  const pessoa = await sobe({});
  try {
    await (await pessoa.busca('/api/dashboards/capa')).arrayBuffer();
    const r = await (await pessoa.busca('/api/dashboards/capa?recalcula=1')).json();
    assert.equal(r.cache, 'hit', 'o recalcula de um usuário comum forçou cálculo');
  } finally {
    await pessoa.fecha();
  }
  const ferramenta = await sobe({ identifica: () => ({ usuario: 'ferramenta-interna', papeis: ['autenticado'] }) });
  try {
    await (await ferramenta.busca('/api/dashboards/capa')).arrayBuffer();
    const r = await (await ferramenta.busca('/api/dashboards/capa?recalcula=1')).json();
    assert.notEqual(r.cache, 'hit', 'a ferramenta interna perdeu o recalcula');
  } finally {
    await ferramenta.fecha();
  }
});

test('alocação ao vivo avisa SÓ quem carrega Status Protocolo Dia — não as páginas da PG', async () => {
  // PLANO-MESTRE §A.1. Ela não está no fechamento de queries de página nenhuma: sem o
  // roteamento por calculada, este aviso não saía, e a tela nunca via o tempo real.
  const s = await sobe({});
  try {
    const sse = await ouve(await s.busca('/api/eventos'));
    s.servidor.aoTabelaMudar('ALOCAÇÃO PATRIMONIO', 'alocacao-patrimonio');
    s.servidor.aoTabelaMudar('PROTOCOLOS GERAL', 'protocolos-geral');
    await ate(() => sse.eventos.length >= 2);
    await sse.para();
    const [viva, geral] = sse.eventos;
    assert.deepEqual(viva!.dashboards, ['agendamento-field']);
    assert.ok(geral!.dashboards.length > 5, `a PG alcança ${geral!.dashboards.length} página(s) — o contraste do teste`);
  } finally {
    await s.fecha();
  }
});
