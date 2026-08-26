// A API, de ponta a ponta, sem credencial nenhuma.
//
// Usa as **specs reais** do repositório — elas são versionadas e não têm segredo —
// e um snapshot de mentira num diretório temporário. A página `capa` serve para o
// caminho feliz porque ela precisa de uma tabela só, `HORA ATUALIZADO`, que tem 1
// linha e 3 colunas: dá para escrevê-la à mão e ainda assim exercitar o caminho
// inteiro, do arquivo em disco ao JSON da resposta.
//
// **O que estes testes guardam é o contrato da resposta**, não o número. Número é
// paridade, e paridade continua dependendo de alguém abrir o Power BI.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { escreve } from '../../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto } from '../../../packages/snapshot/src/manifesto.ts';
import { Servidor } from '../src/servidor.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB = path.join(ROOT, 'apps', 'api', 'web');
const AGORA = new Date('2026-08-07T12:00:00.000Z');

/** Sobe o servidor numa porta livre e devolve um `fetch` já com a base. */
async function servidor(snapshotDir: string): Promise<{
  busca: (rota: string, init?: RequestInit) => Promise<Response>;
  fecha: () => Promise<void>;
}> {
  const http = new Servidor({ root: ROOT, snapshotDir, webDir: WEB, agora: () => AGORA }).criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    busca: (rota, init) => fetch(`http://127.0.0.1:${port}${rota}`, init),
    fecha: () => new Promise<void>((ok) => http.close(() => ok())),
  };
}

function dirVazio(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'api-'));
}

/** Um snapshot com só `hora-atualizado` — o que a página `capa` precisa. */
async function dirComCapa(): Promise<string> {
  const dir = dirVazio();
  const linha = {
    datahora: new Date('2026-08-07T10:34:00.000Z'),
    data: new Date('2026-08-07T00:00:00.000Z'),
    hora: new Date('1899-12-30T10:34:00.000Z'),
  };
  const cab = await escreve(
    arquivoDaQuery(dir, 'hora-atualizado'),
    { query: 'hora-atualizado', tabelas: ['HORA ATUALIZADO'], geradoEm: '2026-08-07T11:00:00.000Z' },
    ['datahora', 'data', 'hora'],
    [linha],
  );
  escreveManifesto(dir, [{
    query: 'hora-atualizado', tabelas: cab.tabelas, linhas: 1, colunas: 3,
    bytes: 200, geradoEm: cab.geradoEm,
  }]);
  return dir;
}

// ---------------------------------------------------------------------------
// Somente leitura
// ---------------------------------------------------------------------------

/**
 * A quarta camada da regra de somente-leitura, e a única que um cliente enxerga.
 * As outras três ficam no Query Engine, que esta API nem chama — ela lê snapshot.
 */
test('todo método que não é GET nem HEAD leva 405 antes de qualquer rota', async () => {
  const s = await servidor(dirVazio());
  try {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await s.busca('/api/dashboards', { method });
      assert.equal(r.status, 405, method);
      assert.equal(r.headers.get('allow'), 'GET, HEAD');
      assert.match((await r.json()).erro, /somente leitura/);
    }
  } finally {
    await s.fecha();
  }
});

// ---------------------------------------------------------------------------
// Sem snapshot
// ---------------------------------------------------------------------------

test('sem snapshot a API sobe e a saúde diz o comando que falta', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca('/api/saude');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.ok, false);
    assert.equal(j.snapshot.presente, false);
    assert.match(j.snapshot.dica, /npm run snapshot/);
    assert.equal(j.dashboards, 14);
  } finally {
    await s.fecha();
  }
});

/**
 * 409 e não 500: o pedido está correto, o **estado do servidor** é que não está. E
 * a mensagem vem inteira de `carrega`, com a tabela, a query e o comando.
 */
test('página sem snapshot dá 409 com o comando, não 500', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca('/api/dashboards/capa');
    assert.equal(r.status, 409);
    assert.match((await r.json()).erro, /Snapshot incompleto.*npm run snapshot -- --pagina=capa/s);
  } finally {
    await s.fecha();
  }
});

test('a lista marca quais páginas têm snapshot', async () => {
  const s = await servidor(await dirComCapa());
  try {
    const j = await (await s.busca('/api/dashboards')).json();
    assert.equal(j.dashboards.length, 14);
    const capa = j.dashboards.find((d: { id: string }) => d.id === 'capa');
    assert.equal(capa.pronta, true);
    assert.equal(capa.visuais, 30);
    // `diario-instalacao` precisa de 4 queries e só uma está em disco.
    assert.equal(j.dashboards.find((d: { id: string }) => d.id === 'diario-instalacao').pronta, false);
  } finally {
    await s.fecha();
  }
});

// ---------------------------------------------------------------------------
// O caminho feliz
// ---------------------------------------------------------------------------

test('capa calcula os 2 cards e devolve a idade do dado', async () => {
  const s = await servidor(await dirComCapa());
  try {
    const r = await s.busca('/api/dashboards/capa');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.id, 'capa');
    assert.equal(j.dadoDe, '2026-08-07T11:00:00.000Z');
    assert.equal(j.resumo.calculados, 2);
    assert.equal(j.resumo.falharam, 0);
    // 30 visuais, 2 com número: o resto é imagem, texto, forma e navegador.
    assert.equal(j.resumo.calculados + j.resumo.semCalculo, 30);
    assert.deepEqual(j.tabelas, [{ nome: 'HORA ATUALIZADO', linhas: 1 }]);
  } finally {
    await s.fecha();
  }
});

/**
 * **JSON não tem data.** Sem o tipo por valor, a tela não sabe se
 * `"2026-08-07T00:00:00.000Z"` é uma data ou um protocolo que por acaso se parece
 * com uma — é a mesma razão do formato do snapshot.
 */
test('o tipo do valor viaja com o valor', async () => {
  const s = await servidor(await dirComCapa());
  try {
    const j = await (await s.busca('/api/dashboards/capa')).json();
    const cards = j.visuais.filter((v: { conteudo: string }) => v.conteudo === 'card');
    for (const c of cards) {
      assert.equal(c.dados.tipoDoValor, 'date', c.dados.nome);
      assert.equal(typeof c.dados.valor, 'string');
    }
    assert.deepEqual(
      cards.map((c: { dados: { nome: string } }) => c.dados.nome).sort(),
      ['Data mais recente', 'Hora mais recente'],
    );
  } finally {
    await s.fecha();
  }
});

test('visual sem número diz por que não calcula, em vez de sumir', async () => {
  const s = await servidor(await dirComCapa());
  try {
    const j = await (await s.busca('/api/dashboards/capa')).json();
    const imagem = j.visuais.find((v: { tipo: string }) => v.tipo === 'image');
    assert.equal(imagem.conteudo, null);
    assert.equal(imagem.semCalculo, 'imagem');
    const desconhecido = j.visuais.find((v: { tipo: string }) => v.tipo === 'unknown');
    assert.match(desconhecido.semCalculo, /tipo 'unknown' não calcula/);
    // Todo visual da spec aparece na resposta — a tela desenha o layout inteiro.
    assert.equal(j.visuais.length, 30);
  } finally {
    await s.fecha();
  }
});

// ---------------------------------------------------------------------------
// Rotas e estáticos
// ---------------------------------------------------------------------------

test('página inexistente dá 404 e lista as que existem', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca('/api/dashboards/naoexiste');
    assert.equal(r.status, 404);
    assert.match((await r.json()).erro, /não existe. As 14: .*capa/);
  } finally {
    await s.fecha();
  }
});

test('rota de api desconhecida dá 404 e aponta a saúde', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca('/api/qualquer');
    assert.equal(r.status, 404);
    assert.match((await r.json()).erro, /GET \/api\/saude/);
  } finally {
    await s.fecha();
  }
});

test('a tela é servida na raiz', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca('/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /text\/html/);
    const html = await r.text();
    assert.match(html, /Analytics Platform/);
    // A raiz entrega a aplicação React: ou o `index.html` do build (que carrega o
    // módulo de `/assets/`), ou a tela antiga, que traz os tokens no próprio HTML.
    // As duas são telas válidas; o que não pode é a raiz não servir tela nenhuma.
    assert.match(html, /<div id="raiz">|--amber: #F59E0B/);
  } finally {
    await s.fecha();
  }
});

/**
 * **A tela antiga continua alcançável, e isso não é nostalgia.**
 *
 * Ela é a única referência com que comparar a React durante a conferência: se um card
 * divergir, a primeira pergunta é se ele já divergia antes da migração. Apagá-la junto
 * com a migração tiraria a resposta.
 */
test('/legado serve a tela de uma página só, com os tokens do design system v2', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca('/legado');
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /--amber: #F59E0B/);
    assert.match(html, /--bg: #F4F4F5/);
    // A v1 era aspiracional e está substituída: se estes valores voltarem, algum
    // documento velho virou código.
    assert.doesNotMatch(html, /#F5F1E8|DM Sans/);
  } finally {
    await s.fecha();
  }
});

test('caminho com .. não sai do diretório de estáticos', async () => {
  const s = await servidor(dirVazio());
  try {
    // `fetch` normaliza `..` na URL, então o teste bate direto no servidor.
    const r = await s.busca('/%2e%2e/%2e%2e/package.json');
    assert.ok(r.status === 403 || r.status === 404, `status ${r.status}`);
  } finally {
    await s.fecha();
  }
});
