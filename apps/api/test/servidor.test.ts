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
import type { TokenPayload } from 'google-auth-library';
import { escreve } from '../../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto } from '../../../packages/snapshot/src/manifesto.ts';
import { escreveStatus } from '../../../tools/refresh/src/status.ts';
import type { VerificadorDeToken } from '../src/auth-google.ts';
import { Servidor } from '../src/servidor.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB = path.join(ROOT, 'apps', 'api', 'web');
const AGORA = new Date('2026-08-07T12:00:00.000Z');

/**
 * Sobe o servidor numa porta livre e devolve um `fetch` já com a base.
 *
 * `identifica` fixo, autenticado, **de propósito**: estes testes são sobre
 * dado e cálculo, não sobre login — a sessão real (`Map` de `identidade.ts`)
 * tem teste próprio em `identidade.test.ts`, e o portão de 401 mais abaixo
 * neste arquivo usa `servidorComLogin`, não este helper. Sem este override,
 * todo teste aqui que bate em `/api/dashboards/*` passaria a levar 401,
 * porque o `fetch` de teste nunca manda cookie de sessão.
 */
async function servidor(snapshotDir: string): Promise<{
  busca: (rota: string, init?: RequestInit) => Promise<Response>;
  fecha: () => Promise<void>;
}> {
  const http = new Servidor({
    root: ROOT,
    snapshotDir,
    webDir: WEB,
    agora: () => AGORA,
    identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }),
  }).criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    busca: (rota, init) => fetch(`http://127.0.0.1:${port}${rota}`, init),
    fecha: () => new Promise<void>((ok) => http.close(() => ok())),
  };
}

/**
 * Sobe o servidor com o `identifica` REAL (sessão por cookie) — o oposto do
 * helper acima. Usa este para testar o portão de 401 e o fluxo de login em
 * si; `verificadorGoogle` injetado substitui a rede pelo Google real.
 */
async function servidorComLogin(
  snapshotDir: string,
  opts: {
    googleClientId?: string;
    dominioCorporativo?: string;
    verificadorGoogle?: VerificadorDeToken;
    tokenInterno?: string;
  } = {},
): Promise<{
  servidor: Servidor;
  busca: (rota: string, init?: RequestInit) => Promise<Response>;
  fecha: () => Promise<void>;
}> {
  const servidor = new Servidor({
    root: ROOT,
    snapshotDir,
    webDir: WEB,
    agora: () => AGORA,
    googleClientId: opts.googleClientId ?? '123.apps.googleusercontent.com',
    dominioCorporativo: opts.dominioCorporativo ?? 'sebratel.com.br',
    ...(opts.verificadorGoogle ? { verificadorGoogle: opts.verificadorGoogle } : {}),
    ...(opts.tokenInterno !== undefined ? { tokenInterno: opts.tokenInterno } : {}),
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    servidor,
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
  await escreveManifesto(dir, [{
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
test('todo método que não é GET nem HEAD leva 405 em /api/*, mesmo POST', async () => {
  const s = await servidor(dirVazio());
  try {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await s.busca('/api/dashboards', { method });
      assert.equal(r.status, 405, method);
      // 'POST' está no Allow porque /auth/google e /auth/logout aceitam —
      // mas nenhuma rota de dado aceita, e é isso que este teste prova.
      assert.equal(r.headers.get('allow'), 'GET, HEAD, POST');
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

test('a saúde expõe RSS e heap — o sinal que denuncia vazamento antes do OOM', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca('/api/saude');
    const j = await r.json();
    assert.ok(Number.isFinite(j.memoria.rssMB));
    assert.ok(j.memoria.rssMB > 0);
    assert.ok(Number.isFinite(j.memoria.heapUsedMB));
    assert.ok(j.memoria.heapUsedMB > 0);
  } finally {
    await s.fecha();
  }
});

test('a saúde inclui refresh vazio quando o Refresh Manager nunca rodou nesta máquina', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca('/api/saude');
    const j = await r.json();
    assert.deepEqual(j.refresh, {});
  } finally {
    await s.fecha();
  }
});

test('a saúde reflete refresh-status.json quando o Refresh Manager já rodou', async () => {
  const dir = dirVazio();
  await escreveStatus(dir, {
    quente: { ultimaTentativa: '2026-09-02T12:00:00.000Z', ultimoSucesso: '2026-09-02T12:00:00.000Z', duracaoMs: 1234, ok: true, falhasConsecutivas: 0 },
  });
  const s = await servidor(dir);
  try {
    const r = await s.busca('/api/saude');
    const j = await r.json();
    assert.equal(j.refresh.quente.ok, true);
    assert.equal(j.refresh.quente.duracaoMs, 1234);
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

test('/layout devolve o layout.yaml da página, sem precisar de snapshot', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca('/api/dashboards/capa/layout');
    assert.equal(r.status, 200);
    const layout = await r.json();
    assert.equal(layout.pagina, 'capa');
    assert.equal(layout.kpis.length, 2);
    assert.deepEqual(layout.faixas, []);
  } finally {
    await s.fecha();
  }
});

test('/layout de página inexistente dá 404 e lista as que existem', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca('/api/dashboards/naoexiste/layout');
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

// ---------------------------------------------------------------------------
// Visual sob demanda
// ---------------------------------------------------------------------------

/**
 * **A rota que devolve o que a página deixou de trazer.**
 *
 * `specs/_catalog/projecao.yaml` tira `'FIELD AGENDA'[Relato]` da abertura de
 * `agendamento-field` — 350 MB de texto livre para um visual entre 39. Sem um caminho
 * para pedir aquele visual, a decisão não seria "sob demanda", seria "removido".
 *
 * Este teste não abre `agendamento-field` (precisaria de 1 GB de snapshot). Ele guarda
 * o contrato da rota: visual inexistente dá 404, e o corpo diz o que ficou de fora.
 */
test('?visual= com id que não existe na página dá 404, não 500', async () => {
  const dir = await dirComCapa();
  const s = await servidor(dir);
  try {
    const r = await s.busca('/api/dashboards/capa?visual=nao-existe');
    assert.equal(r.status, 404);
    assert.match((await r.json() as { erro: string }).erro, /Visual 'nao-existe' não existe/);
  } finally {
    await s.fecha();
  }
});

test('?visual= calcula só aquele visual', async () => {
  const dir = await dirComCapa();
  const s = await servidor(dir);
  try {
    const inteira = await (await s.busca('/api/dashboards/capa')).json() as { visuais: { id: string }[] };
    const alvo = inteira.visuais[0]!.id;

    const uma = await (await s.busca(`/api/dashboards/capa?visual=${alvo}`)).json() as {
      visuais: { id: string }[];
    };
    assert.equal(uma.visuais.length, 1);
    assert.equal(uma.visuais[0]!.id, alvo);
    assert.ok(inteira.visuais.length > 1, 'a página inteira tem mais de um visual');
  } finally {
    await s.fecha();
  }
});

test('?visual= repetido (Fase L5, R4) pede vários e mantém a ordem do relatório', async () => {
  const dir = await dirComCapa();
  const s = await servidor(dir);
  try {
    const inteira = await (await s.busca('/api/dashboards/capa')).json() as { visuais: { id: string }[] };
    assert.ok(inteira.visuais.length >= 2, 'precisa de pelo menos 2 visuais para testar ordem');
    const [primeiro, segundo] = inteira.visuais;

    // Pede na ordem INVERTIDA da spec — a resposta tem de vir na ordem do relatório,
    // não na ordem em que os `?visual=` chegaram na URL.
    const r = await s.busca(`/api/dashboards/capa?visual=${segundo!.id}&visual=${primeiro!.id}`);
    const corpo = await r.json() as { visuais: { id: string }[] };
    assert.equal(corpo.visuais.length, 2);
    assert.deepEqual(corpo.visuais.map((v) => v.id), [primeiro!.id, segundo!.id]);
  } finally {
    await s.fecha();
  }
});

test('?visual= repetido com um id inexistente dá 404, sem calcular nada', async () => {
  const dir = await dirComCapa();
  const s = await servidor(dir);
  try {
    const inteira = await (await s.busca('/api/dashboards/capa')).json() as { visuais: { id: string }[] };
    const valido = inteira.visuais[0]!.id;
    const r = await s.busca(`/api/dashboards/capa?visual=${valido}&visual=naoexiste`);
    assert.equal(r.status, 404);
    assert.match((await r.json()).erro, /'naoexiste' não existe/);
  } finally {
    await s.fecha();
  }
});

/**
 * O corpo diz o que a projeção deixou de carregar.
 *
 * Sem isto, uma página com número faltando é indistinguível de uma página com bug: a
 * tela não teria como saber se o visual está vazio porque não há dado ou porque a
 * coluna não veio. A regra 9 permite divergir e proíbe divergir em silêncio — aqui a
 * resposta HTTP é onde o "não em silêncio" acontece.
 */
test('a resposta declara as colunas que ficaram fora da carga', async () => {
  const dir = await dirComCapa();
  const s = await servidor(dir);
  try {
    const corpo = await (await s.busca('/api/dashboards/capa')).json() as { omitidas: string[] };
    assert.ok(Array.isArray(corpo.omitidas), 'a resposta precisa declarar as omitidas');
  } finally {
    await s.fecha();
  }
});

// ---------------------------------------------------------------------------
// Segmentação da tela: `?filtro=` e a lista de valores
// ---------------------------------------------------------------------------

/**
 * **Filtro que não decodifica derruba o pedido, e isso é a regra.**
 *
 * Aplicar os filtros que deram certo e calar os que não deram mostraria um número
 * filtrado pela metade com a tela dizendo que está filtrado — número errado plausível.
 * O 400 vem **antes** de carregar qualquer coisa: o pedido está errado, não o estado.
 */
test('?filtro= inválido dá 400 com a mensagem inteira, sem carregar nada', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca('/api/dashboards/capa?filtro=naoEhJson');
    assert.equal(r.status, 400);
    assert.match((await r.json()).erro, /não é JSON/);
  } finally {
    await s.fecha();
  }
});

test('?filtro= com valores vazio dá 400 e explica por que vazio não é "sem filtro"', async () => {
  const s = await servidor(dirVazio());
  try {
    const f = encodeURIComponent(JSON.stringify({ tabela: 'T', coluna: 'c', valores: [] }));
    const r = await s.busca(`/api/dashboards/capa?filtro=${f}`);
    assert.equal(r.status, 400);
    assert.match((await r.json()).erro, /não mande o parâmetro/);
  } finally {
    await s.fecha();
  }
});

/**
 * A resposta devolve o que a tela mandou. Sem isso não há como conferir, olhando o
 * payload, se o número está filtrado pelo que a tela acha que mandou — e a conferência
 * de paridade depende exatamente dessa checagem.
 */
test('a resposta ecoa os filtros da tela que foram aplicados', async () => {
  const s = await servidor(await dirComCapa());
  try {
    const f = encodeURIComponent(
      JSON.stringify({ tabela: 'HORA ATUALIZADO', coluna: 'data', valores: ['2026-08-07'] }),
    );
    const r = await s.busca(`/api/dashboards/capa?filtro=${f}`);
    assert.equal(r.status, 200);
    const corpo = await r.json();
    assert.deepEqual(corpo.filtrosDaTela, [
      { tabela: 'HORA ATUALIZADO', coluna: 'data', valores: ['2026-08-07'] },
    ]);
  } finally {
    await s.fecha();
  }
});

test('sem filtro nenhum, o eco vem vazio', async () => {
  const s = await servidor(await dirComCapa());
  try {
    const corpo = await (await s.busca('/api/dashboards/capa')).json();
    assert.deepEqual(corpo.filtrosDaTela, []);
  } finally {
    await s.fecha();
  }
});

/**
 * **A trava que impede a rota de virar um dump do modelo.**
 *
 * `snapshot/` tem endereço de cliente em `field-agenda` e CPF/RG em `QUADRO
 * FUNCIONAL`. Uma rota que listasse valor distinto de coluna qualquer os entregaria a
 * quem montasse a URL. Só coluna de segmentação **desta página** passa.
 */
test('valores de coluna que não é segmentação da página dá 404', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca('/api/dashboards/visao-geral/valores?tabela=CONTRATOS&coluna=CPF');
    assert.equal(r.status, 404);
    assert.match((await r.json()).erro, /não é a coluna de nenhuma segmentação/);
  } finally {
    await s.fecha();
  }
});

test('valores sem tabela ou sem coluna dá 400 com um exemplo de uso', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca('/api/dashboards/visao-geral/valores');
    assert.equal(r.status, 400);
    assert.match((await r.json()).erro, /valores\?tabela=/);
  } finally {
    await s.fecha();
  }
});

test('sub-rota desconhecida de uma página dá 404, não 500', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca('/api/dashboards/capa/inventada');
    assert.equal(r.status, 404);
    assert.match((await r.json()).erro, /sub-rotas: valores/);
  } finally {
    await s.fecha();
  }
});

/** A rota de valores é `GET`, como todo o resto. */
test('a rota de valores também recusa método que não é GET', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca('/api/dashboards/visao-geral/valores', { method: 'POST' });
    assert.equal(r.status, 405);
  } finally {
    await s.fecha();
  }
});

/**
 * A rota de valores só aceita o nível **daquela** segmentação. Pedir `nivel=Dia` numa
 * segmentação de Ano listaria 365 valores que o controle nunca ofereceria — e a
 * checagem de permissão é o mesmo lugar que impede o dump de coluna qualquer.
 */
test('valores com nível diferente do da segmentação dá 404', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca(
      '/api/dashboards/visao-geral/valores?tabela=CALENDARIO CRIADO&coluna=DATA CRIADO&nivel=Dia',
    );
    assert.equal(r.status, 404);
  } finally {
    await s.fecha();
  }
});

/**
 * A hierarquia de DRILL é o único `naoFiltra` que a rota atende — e só sem `nivel`.
 *
 * `CALENDARIO INSTALADO[DATA INSTALADO]` na visao-geral tem 3 níveis ativos, então o
 * motor a marca `naoFiltra` (a escolha ali é um caminho, não um conjunto de valores
 * de um nível) e lhe dá `niveis`. A árvore Ano > Mês > Dia da tela precisa das datas
 * CRUAS para saber quais meses cada ano tem — pedir nível por nível traria três
 * listas soltas, e cruzá-las ofereceria mês que aquele ano não tem.
 *
 * Enquanto a trava era `naoFiltra === undefined`, essa chamada dava 404 e a árvore
 * abria com "0 anos" — a única tela onde a coluna de data aparece como controle não
 * tinha controle nenhum. A trava que importa segue inteira e é testada logo abaixo:
 * a coluna tem de ser segmentação DESTA página.
 */
test('valores de hierarquia de drill passam quando não se pede nível', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca(
      '/api/dashboards/visao-geral/valores?tabela=CALENDARIO INSTALADO&coluna=DATA INSTALADO',
    );
    assert.notEqual(r.status, 404, 'a hierarquia de drill voltou a ser recusada pela trava');
  } finally {
    await s.fecha();
  }
});

/** Mas pedir um NÍVEL dela continua barrado: o controle é a árvore, não um nível. */
test('valores de hierarquia de drill COM nível continuam 404', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca(
      '/api/dashboards/visao-geral/valores?tabela=CALENDARIO INSTALADO&coluna=DATA INSTALADO&nivel=Dia',
    );
    assert.equal(r.status, 404);
  } finally {
    await s.fecha();
  }
});

/** E coluna que não é segmentação da página segue barrada — a trava que importa. */
test('a abertura para hierarquia não alcança coluna que não é segmentação', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca('/api/dashboards/visao-geral/valores?tabela=CONTRATOS&coluna=CPF');
    assert.equal(r.status, 404);
  } finally {
    await s.fecha();
  }
});

/** Segmentação de hierarquia que REDUZ a um nível sem o nível não passa: chaves diferentes. */
test('valores de coluna de hierarquia sem nível dá 404', async () => {
  const s = await servidor(dirVazio());
  try {
    const r = await s.busca(
      '/api/dashboards/visao-geral/valores?tabela=CALENDARIO CRIADO&coluna=DATA CRIADO',
    );
    assert.equal(r.status, 404);
  } finally {
    await s.fecha();
  }
});

/**
 * O nível vai no eco. Sem ele, olhando a resposta não dá para distinguir um filtro
 * pelo **ano** de uma data de um filtro pela data crua — e os dois produzem números
 * diferentes sobre a mesma coluna. É a mesma razão de o eco existir.
 */
test('o eco do filtro carrega o nível quando ele existe', async () => {
  const s = await servidor(await dirComCapa());
  try {
    const f = encodeURIComponent(
      JSON.stringify({ tabela: 'HORA ATUALIZADO', coluna: 'data', nivel: 'Ano', valores: [2026] }),
    );
    const corpo = await (await s.busca(`/api/dashboards/capa?filtro=${f}`)).json();
    assert.deepEqual(corpo.filtrosDaTela, [
      { tabela: 'HORA ATUALIZADO', coluna: 'data', nivel: 'Ano', valores: [2026] },
    ]);
  } finally {
    await s.fecha();
  }
});

// ---------------------------------------------------------------------------
// Login (SSO Google) — o portão de sessão em cima de um pedido de verdade.
// Os casos de identidade.ts/auth-google.ts em isolamento moram nos testes
// deles próprios; aqui é ponta a ponta: cookie entra, cookie sai, 401 no meio.
// ---------------------------------------------------------------------------

function clienteQueDevolve(payload: Partial<TokenPayload> | undefined): VerificadorDeToken {
  return {
    async verifyIdToken() {
      return { getPayload: () => payload as TokenPayload | undefined };
    },
  };
}

/** O cookie de sessão de uma resposta de login, pronto para reenviar. */
function cookieDe(resposta: Response): string {
  const bruto = resposta.headers.get('set-cookie');
  assert.ok(bruto, 'resposta de login sem Set-Cookie');
  return bruto.split(';')[0]!;
}

test('sem cookie de sessão, /api/* leva 401 antes de qualquer rota', async () => {
  const s = await servidorComLogin(dirVazio());
  try {
    const r = await s.busca('/api/dashboards');
    assert.equal(r.status, 401);
    assert.match((await r.json()).erro, /Faça login/);
  } finally {
    await s.fecha();
  }
});

test('/api/saude responde sem sessão — é o que o healthcheck do container bate', async () => {
  const s = await servidorComLogin(dirVazio());
  try {
    const r = await s.busca('/api/saude');
    assert.equal(r.status, 200);
  } finally {
    await s.fecha();
  }
});

test('a tela (estático) é servida sem sessão — é ela que mostra o login', async () => {
  const s = await servidorComLogin(dirVazio());
  try {
    const r = await s.busca('/');
    assert.notEqual(r.status, 401);
  } finally {
    await s.fecha();
  }
});

test('login de verdade: idToken válido cria sessão, e o cookie libera /api/*', async () => {
  const s = await servidorComLogin(dirVazio(), {
    verificadorGoogle: clienteQueDevolve({ email: 'fulano@sebratel.com.br', hd: 'sebratel.com.br' }),
  });
  try {
    const antes = await s.busca('/api/dashboards');
    assert.equal(antes.status, 401);

    const login = await s.busca('/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: 'qualquer-coisa-aqui' }),
    });
    assert.equal(login.status, 200);
    assert.deepEqual(await login.json(), { usuario: 'fulano@sebratel.com.br' });
    const cookie = cookieDe(login);
    assert.match(cookie, /^sessao=/);

    const depois = await s.busca('/api/dashboards', { headers: { cookie } });
    assert.equal(depois.status, 200);
  } finally {
    await s.fecha();
  }
});

test('login com domínio fora de sebratel.com.br: 401, sem cookie nenhum', async () => {
  const s = await servidorComLogin(dirVazio(), {
    verificadorGoogle: clienteQueDevolve({ email: 'fulano@gmail.com', hd: 'gmail.com' }),
  });
  try {
    const login = await s.busca('/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: 'qualquer-coisa-aqui' }),
    });
    assert.equal(login.status, 401);
    assert.equal(login.headers.get('set-cookie'), null);
  } finally {
    await s.fecha();
  }
});

test('login sem idToken no corpo: 400', async () => {
  const s = await servidorComLogin(dirVazio());
  try {
    const r = await s.busca('/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 400);
  } finally {
    await s.fecha();
  }
});

test('login com corpo que não é JSON: 400, não 500', async () => {
  const s = await servidorComLogin(dirVazio());
  try {
    const r = await s.busca('/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'isto não é json',
    });
    assert.equal(r.status, 400);
  } finally {
    await s.fecha();
  }
});

test('GOOGLE_CLIENT_ID ausente: login recusa mesmo token válido — falha fechada', async () => {
  const s = await servidorComLogin(dirVazio(), {
    googleClientId: '',
    verificadorGoogle: clienteQueDevolve({ email: 'fulano@sebratel.com.br', hd: 'sebratel.com.br' }),
  });
  try {
    const r = await s.busca('/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: 'qualquer-coisa-aqui' }),
    });
    assert.equal(r.status, 401);
    assert.match((await r.json()).erro, /não configurado/);
  } finally {
    await s.fecha();
  }
});

test('logout apaga a sessão: depois dele, /api/* volta a 401', async () => {
  const s = await servidorComLogin(dirVazio(), {
    verificadorGoogle: clienteQueDevolve({ email: 'fulano@sebratel.com.br', hd: 'sebratel.com.br' }),
  });
  try {
    const login = await s.busca('/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: 'qualquer-coisa-aqui' }),
    });
    const cookie = cookieDe(login);
    assert.equal((await s.busca('/api/dashboards', { headers: { cookie } })).status, 200);

    const logout = await s.busca('/auth/logout', { method: 'POST', headers: { cookie } });
    assert.equal(logout.status, 200);

    const depois = await s.busca('/api/dashboards', { headers: { cookie } });
    assert.equal(depois.status, 401);
  } finally {
    await s.fecha();
  }
});

test('GET em /auth/google: não é rota de dado, cai no estático e dá 404 — não 401', async () => {
  // /auth/google só existe para POST (guarda de rota, não guarda de sessão).
  // Um GET nele não é "sem sessão" (401) nem "verbo errado" (405, que é só
  // para as rotas de dado sob /api/*) — é, sem mais nada registrado ali,
  // um caminho estático que não existe.
  const s = await servidorComLogin(dirVazio());
  try {
    const r = await s.busca('/auth/google');
    assert.equal(r.status, 404);
  } finally {
    await s.fecha();
  }
});

// ---------------------------------------------------------------------------
// /auth/interno — login de ferramenta (tools/tela), sem conta do Google
// ---------------------------------------------------------------------------

test('token interno certo: cria sessão igual ao login do Google', async () => {
  const s = await servidorComLogin(dirVazio(), { tokenInterno: 'segredo-de-teste' });
  try {
    const login = await s.busca('/auth/interno', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'segredo-de-teste' }),
    });
    assert.equal(login.status, 200);
    const cookie = cookieDe(login);
    assert.match(cookie, /^sessao=/);
    assert.equal((await s.busca('/api/dashboards', { headers: { cookie } })).status, 200);
  } finally {
    await s.fecha();
  }
});

test('token interno errado: 401, sem cookie', async () => {
  const s = await servidorComLogin(dirVazio(), { tokenInterno: 'segredo-de-teste' });
  try {
    const login = await s.busca('/auth/interno', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'chute' }),
    });
    assert.equal(login.status, 401);
    assert.equal(login.headers.get('set-cookie'), null);
  } finally {
    await s.fecha();
  }
});

test('TOKEN_INTERNO não configurado: recusa até um corpo vazio "combinando" com vazio', async () => {
  const s = await servidorComLogin(dirVazio(), { tokenInterno: '' });
  try {
    const login = await s.busca('/auth/interno', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: '' }),
    });
    assert.equal(login.status, 401);
  } finally {
    await s.fecha();
  }
});

// ---------------------------------------------------------------------------
// O cabeçalho do Aquecedor — o próprio servidor não pode levar 401 de si mesmo
// ---------------------------------------------------------------------------

test('cabeçalho x-aquecedor-interno certo libera /api/* sem cookie nenhum', async () => {
  const s = await servidorComLogin(dirVazio());
  try {
    const segredo = s.servidor.segredoInterno();
    const r = await s.busca('/api/dashboards', { headers: { 'x-aquecedor-interno': segredo } });
    assert.equal(r.status, 200);
  } finally {
    await s.fecha();
  }
});

test('cabeçalho x-aquecedor-interno errado continua levando 401', async () => {
  const s = await servidorComLogin(dirVazio());
  try {
    const r = await s.busca('/api/dashboards', { headers: { 'x-aquecedor-interno': 'chute-qualquer' } });
    assert.equal(r.status, 401);
  } finally {
    await s.fecha();
  }
});

test('o segredo do Aquecedor muda a cada instância — dois servidores, dois segredos', async () => {
  const s1 = await servidorComLogin(dirVazio());
  const s2 = await servidorComLogin(dirVazio());
  try {
    assert.notEqual(s1.servidor.segredoInterno(), s2.servidor.segredoInterno());
  } finally {
    await s1.fecha();
    await s2.fecha();
  }
});
