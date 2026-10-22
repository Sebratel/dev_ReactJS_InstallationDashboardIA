// `/api/saude` para pessoa logada que não é operador: a mesma saúde, sem erro cru.
//
// O defeito (22/10/2026): o corpo completo ia para qualquer sessão válida — um viewer sem
// aba nenhuma, ou alguém barrado com cookie ainda vivo — e levava
// `realtime.poller.ultimoErro`, a mensagem crua do driver do Voalle (host, porta, usuário).
// O vazamento de 13/10 tinha sido fechado só para o anônimo.
//
// A tela de todo mundo lê esta rota (aviso de dado atrasado, "próxima carga"), então o
// viewer continua recebendo o corpo: só os textos de erro saem.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Papel } from '../src/permissoes.ts';
import { Servidor, semErroCru } from '../src/servidor.ts';
import { ACESSO_LIBERADO } from './fixtures/acesso.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB = fs.mkdtempSync(path.join(os.tmpdir(), 'web-saude-'));
fs.writeFileSync(path.join(WEB, 'index.html'), '<title>Analytics Platform</title>');

/** O texto que nunca pode chegar a um viewer: o formato real do erro de 13/10. */
const ERRO_DO_DRIVER = 'connect ECONNREFUSED 10.9.8.7:5432 (usuario analytics_ro)';

async function sobe(opts: { papel: Papel; enderecoRemoto?: string }): Promise<{
  saude: () => Promise<Record<string, any>>;
  fecha: () => Promise<void>;
}> {
  const inst = new Servidor({
    acesso: { ...ACESSO_LIBERADO, papelDe: () => opts.papel },
    root: ROOT,
    snapshotDir: fs.mkdtempSync(path.join(os.tmpdir(), 'api-saude-')),
    webDir: WEB,
    agora: () => new Date('2026-10-22T12:00:00.000Z'),
    // Com login configurado, como em produção. Sem nenhum provedor a API está no modo
    // local de desenvolvimento, em que todo mundo é operador.
    firebaseProjectId: 'projeto-de-teste',
    identifica: () => ({ usuario: 'pessoa@sebratel.com.br', papeis: ['autenticado'] }),
    estadoDoPoller: (() => ({
      ativo: true,
      erros: 3,
      ultimoErro: ERRO_DO_DRIVER,
      porQuery: [{ id: 'field-agenda', erros: 3 }],
    })) as never,
  });
  const http: Server = inst.criaHttp();
  if (opts.enderecoRemoto !== undefined) {
    // O teste só alcança a API por 127.0.0.1, que é a própria máquina (operador). Trocar o
    // `remoteAddress` do socket antes do pedido ser lido é o que exercita a rota real
    // como se o pedido viesse do navegador de alguém — o mesmo truque de
    // `memoria-na-saude.test.ts`.
    const endereco = opts.enderecoRemoto;
    http.prependListener('connection', (sock) => {
      Object.defineProperty(sock, 'remoteAddress', { value: endereco });
    });
  }
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    saude: async () => {
      const r = await fetch(`http://127.0.0.1:${port}/api/saude`);
      assert.equal(r.status, 200);
      return (await r.json()) as Record<string, any>;
    },
    fecha: () =>
      new Promise<void>((ok) => {
        inst.destroi();
        http.closeAllConnections?.();
        http.close(() => ok());
      }),
  };
}

test('semErroCru: tira erro, ultimoErro e motivo em qualquer profundidade, e nada mais', () => {
  const entrada = {
    ok: true,
    realtime: { poller: { erros: 2, ultimoErro: 'x', porQuery: [{ id: 'a', erros: 1, erro: 'y' }] } },
    carimbo: { watch: { status: 'parado', motivo: 'ENOENT /repo/snapshot' } },
    redis: { conectado: false, ultimoErro: 'getaddrinfo redis' },
    refresh: { queries: [{ id: 'q', status: 'falhou', idadeDias: 1 }] },
  };
  assert.deepEqual(semErroCru(entrada), {
    ok: true,
    realtime: { poller: { erros: 2, porQuery: [{ id: 'a', erros: 1 }] } },
    carimbo: { watch: { status: 'parado' } },
    redis: { conectado: false },
    refresh: { queries: [{ id: 'q', status: 'falhou', idadeDias: 1 }] },
  });
});

test('viewer logado, vindo de outra máquina: recebe a saúde da tela, sem o erro do driver', async () => {
  const s = await sobe({ papel: 'viewer', enderecoRemoto: '10.1.1.50' });
  try {
    const corpo = await s.saude();
    // Continua sendo a saúde completa — é dela que sai o aviso de dado atrasado da tela.
    assert.ok(corpo.realtime?.poller, 'o viewer ainda recebe o estado do poller');
    assert.equal(corpo.realtime.poller.erros, 3, 'a contagem continua: ela não descreve a infraestrutura');
    assert.deepEqual(corpo.realtime.poller.porQuery, [{ id: 'field-agenda', erros: 3 }]);
    assert.equal(corpo.realtime.poller.ultimoErro, undefined, 'o erro cru do driver não sai');
    assert.doesNotMatch(JSON.stringify(corpo), /ECONNREFUSED|10\.9\.8\.7|analytics_ro/);
  } finally {
    await s.fecha();
  }
});

for (const papel of ['admin', 'dev'] as const) {
  test(`${papel} logado, vindo de outra máquina: continua lendo o erro cru (é quem investiga)`, async () => {
    const s = await sobe({ papel, enderecoRemoto: '10.1.1.50' });
    try {
      const corpo = await s.saude();
      assert.equal(corpo.realtime.poller.ultimoErro, ERRO_DO_DRIVER);
    } finally {
      await s.fecha();
    }
  });
}

test('a própria máquina (healthcheck, operador no contêiner) continua lendo o erro cru', async () => {
  const s = await sobe({ papel: 'viewer' });
  try {
    const corpo = await s.saude();
    assert.equal(corpo.realtime.poller.ultimoErro, ERRO_DO_DRIVER);
  } finally {
    await s.fecha();
  }
});
