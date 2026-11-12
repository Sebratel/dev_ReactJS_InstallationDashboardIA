// A aba "Metas" (`/api/admin/metas`, 12/11/2026 — QA D-20): o portão, o CSRF, a validação
// e a falha fechada. Cada caso aqui reprova se alguém afrouxar um deles.
//
// O que se prova, em uma frase cada:
//   - sem a aba `metas`, é 403 do SERVIDOR (não basta a tela esconder o campo);
//   - com a aba, lê e grava;
//   - POST sem `Origin` é 403 (CSRF), como na gestão de acessos;
//   - valor que não é inteiro, fora de faixa, ou meta desconhecida, não chega ao banco;
//   - sem loja configurada é 503 — nunca um "salvo" que não salvou.
//
// `Servidor` de verdade, `http.listen(0)`, `fetch` de verdade — como `seguranca.test.ts`.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ErroDeAcesso, type AcessoDasTelas } from '../src/permissoes.ts';
import {
  ErroDeMeta,
  validaMeta,
  type LojaDeMetas,
  type MetaDeNegocio,
} from '../src/loja-metas-maria.ts';
import { Servidor } from '../src/servidor.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB = path.join(ROOT, 'frontend', 'dist');

/** Um acesso que libera SÓ as abas da lista — é o que distingue o 403 do 200 aqui. */
function acessoCom(telas: readonly string[]): AcessoDasTelas {
  return {
    podeVer: (_quem, tela) => telas.includes(tela),
    papelDe: () => 'viewer',
    podeGerir: () => false,
    matriz: () => ({ telas: [], pessoas: [], pedidos: [], perfis: [] }),
    muda: () => Promise.reject(new ErroDeAcesso(403, 'teste')),
    estado: () => ({ ok: true, origem: '(teste)' }),
    registraPedido: () => undefined,
    bloqueio: () => null,
    historico: () => Promise.resolve([]),
  };
}

/** Uma loja em memória com o MESMO contrato da de MariaDB — validação inclusive. */
function lojaFalsa(inicial: number | null = 2583): LojaDeMetas & { gravacoes: number } {
  let valor = inicial;
  let por: string | null = inicial === null ? null : 'semente';
  const estado = {
    gravacoes: 0,
    le: (): Promise<MetaDeNegocio[]> =>
      Promise.resolve([
        {
          id: 'meta_mes',
          nome: 'Meta do mês',
          descricao: 'teste',
          valor,
          em: valor === null ? null : '2026-11-12T12:00:00.000Z',
          por,
        },
      ]),
    grava: (id: unknown, v: unknown, porQuem: string): Promise<MetaDeNegocio[]> => {
      const alvo = validaMeta(id, v);
      estado.gravacoes += 1;
      valor = alvo.valor;
      por = porQuem;
      return estado.le();
    },
  };
  return estado;
}

async function sobe(o: { telas: readonly string[]; metas?: LojaDeMetas }): Promise<{
  base: string;
  busca: (rota: string, init?: RequestInit) => Promise<Response>;
  fecha: () => Promise<void>;
}> {
  const servidor = new Servidor({
    acesso: acessoCom(o.telas),
    root: ROOT,
    snapshotDir: fs.mkdtempSync(path.join(os.tmpdir(), 'api-metas-')),
    webDir: WEB,
    agora: () => new Date('2026-11-12T12:00:00.000Z'),
    ...(o.metas ? { metas: o.metas } : {}),
  });
  const servidorHttp: http.Server = servidor.criaHttp();
  await new Promise<void>((ok) => servidorHttp.listen(0, '127.0.0.1', ok));
  const { port } = servidorHttp.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    busca: (rota, init) => fetch(`${base}${rota}`, init),
    fecha: () =>
      // `destroi()` também: sem ele o processo do teste fica vivo depois do último
      // caso, segurando os temporizadores do servidor.
      new Promise<void>((ok) => {
        servidor.destroi();
        servidorHttp.close(() => ok());
      }),
  };
}

/**
 * O POST que PASSA no CSRF. `origin` tem de ser a base COM a porta: o servidor compara
 * com o `Host` do pedido, e `http://127.0.0.1` sem porta é outra origem — foi assim que
 * este arquivo deu três 403 na primeira execução.
 */
const postaMeta = (base: string, valor: unknown, id: unknown = 'meta_mes'): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: base },
  body: JSON.stringify({ id, valor }),
});

test('sem a aba metas, o GET é 403 do servidor', async () => {
  const s = await sobe({ telas: ['visao-geral'], metas: lojaFalsa() });
  try {
    const r = await s.busca('/api/admin/metas');
    assert.equal(r.status, 403);
  } finally {
    await s.fecha();
  }
});

test('sem a aba metas, o POST também é 403 — e nada é gravado', async () => {
  const loja = lojaFalsa();
  const s = await sobe({ telas: [], metas: loja });
  try {
    const r = await s.busca('/api/admin/metas', postaMeta(s.base, 999));
    assert.equal(r.status, 403);
    assert.equal(loja.gravacoes, 0, 'o 403 tem de barrar ANTES da loja');
  } finally {
    await s.fecha();
  }
});

test('com a aba liberada, lê a meta', async () => {
  const s = await sobe({ telas: ['metas'], metas: lojaFalsa(2583) });
  try {
    const r = await s.busca('/api/admin/metas');
    assert.equal(r.status, 200);
    const corpo = (await r.json()) as { metas: MetaDeNegocio[] };
    assert.equal(corpo.metas[0].id, 'meta_mes');
    assert.equal(corpo.metas[0].valor, 2583);
  } finally {
    await s.fecha();
  }
});

test('com a aba liberada, grava e devolve o valor novo', async () => {
  const loja = lojaFalsa(2583);
  const s = await sobe({ telas: ['metas'], metas: loja });
  try {
    const r = await s.busca('/api/admin/metas', postaMeta(s.base, 2700));
    assert.equal(r.status, 200);
    const corpo = (await r.json()) as { metas: MetaDeNegocio[] };
    assert.equal(corpo.metas[0].valor, 2700);
    assert.equal(loja.gravacoes, 1);
  } finally {
    await s.fecha();
  }
});

test('POST sem Origin é 403 — a proteção de CSRF da gestão vale aqui também', async () => {
  const loja = lojaFalsa();
  const s = await sobe({ telas: ['metas'], metas: loja });
  try {
    const r = await s.busca('/api/admin/metas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'meta_mes', valor: 1 }),
    });
    assert.equal(r.status, 403);
    assert.equal(loja.gravacoes, 0);
  } finally {
    await s.fecha();
  }
});

test('valor quebrado e meta desconhecida não chegam ao banco', async () => {
  const loja = lojaFalsa(2583);
  const s = await sobe({ telas: ['metas'], metas: loja });
  try {
    for (const valor of [2583.5, -1, 'dois mil', null, 1_000_001]) {
      const r = await s.busca('/api/admin/metas', postaMeta(s.base, valor));
      assert.equal(r.status, 400, `valor ${String(valor)} devia ser 400`);
    }
    const r = await s.busca('/api/admin/metas', postaMeta(s.base, 10, 'meta_inventada'));
    assert.equal(r.status, 400);
    assert.equal(loja.gravacoes, 0, 'nenhuma gravação podia ter acontecido');
  } finally {
    await s.fecha();
  }
});

test('sem loja de metas configurada é 503 — nunca um salvo falso', async () => {
  const s = await sobe({ telas: ['metas'] });
  try {
    assert.equal((await s.busca('/api/admin/metas')).status, 503);
    assert.equal((await s.busca('/api/admin/metas', postaMeta(s.base, 10))).status, 503);
  } finally {
    await s.fecha();
  }
});

test('validaMeta recusa fora da faixa e aceita o inteiro', () => {
  assert.equal(validaMeta('meta_mes', 2583).valor, 2583);
  assert.equal(validaMeta('meta_mes', '2583').valor, 2583, 'texto numérico do corpo JSON vale');
  assert.throws(() => validaMeta('meta_mes', 2583.5), ErroDeMeta);
  assert.throws(() => validaMeta('outra', 1), ErroDeMeta);
});
