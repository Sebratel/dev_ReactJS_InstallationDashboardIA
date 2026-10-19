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
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { TokenPayload } from 'google-auth-library';
import { escreve } from '../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto } from '../../packages/snapshot/src/manifesto.ts';
import { escreveStatus } from '../../tools/refresh/src/status.ts';
import type { VerificadorDeToken } from '../src/auth-google.ts';
import { Servidor, chaveDeValores } from '../src/servidor.ts';
import { ACESSO_LIBERADO } from './fixtures/acesso.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// Um build mínimo da tela: o teste não depende de `npm run web:build` ter rodado.
const WEB = fs.mkdtempSync(path.join(os.tmpdir(), 'web-'));
fs.writeFileSync(path.join(WEB, 'index.html'), '<title>Analytics Platform</title><div id="raiz"></div>');
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
  const inst = new Servidor({
    acesso: ACESSO_LIBERADO,
    root: ROOT,
    snapshotDir,
    webDir: WEB,
    agora: () => AGORA,
    identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }),
  });
  const http = inst.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    busca: (rota, init) => fetch(`http://127.0.0.1:${port}${rota}`, init),
    fecha: () =>
      new Promise<void>((ok) => {
        inst.destroi();
        http.close(() => ok());
      }),
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
    firebaseProjectId?: string;
    certificadosFirebase?: () => Promise<Record<string, string>>;
    tokenInterno?: string;
  } = {},
): Promise<{
  servidor: Servidor;
  busca: (rota: string, init?: RequestInit) => Promise<Response>;
  fecha: () => Promise<void>;
}> {
  const servidor = new Servidor({
    acesso: ACESSO_LIBERADO,
    root: ROOT,
    snapshotDir,
    webDir: WEB,
    agora: () => AGORA,
    googleClientId: opts.googleClientId ?? '123.apps.googleusercontent.com',
    dominioCorporativo: opts.dominioCorporativo ?? 'sebratel.com.br',
    ...(opts.verificadorGoogle ? { verificadorGoogle: opts.verificadorGoogle } : {}),
    ...(opts.firebaseProjectId !== undefined ? { firebaseProjectId: opts.firebaseProjectId } : {}),
    ...(opts.certificadosFirebase ? { certificadosFirebase: opts.certificadosFirebase } : {}),
    ...(opts.tokenInterno !== undefined ? { tokenInterno: opts.tokenInterno } : {}),
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    servidor,
    busca: (rota, init) => fetch(`http://127.0.0.1:${port}${rota}`, init),
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.close(() => ok());
      }),
  };
}

/**
 * Sobe o servidor com um `overlayRealtime` injetável e devolve o `Servidor`
 * também — é o que os testes de `aoTabelaMudar` precisam para chamar o método
 * direto, sem esperar o `PollerRealtime` de verdade (que fala com o Voalle).
 */
async function servidorComOverlay(
  snapshotDir: string,
  overlayRealtime: () => ReadonlyMap<string, (doDisco: readonly Record<string, unknown>[]) => Record<string, unknown>[]>,
  // Opções extras deste servidor. Existe por causa do `batimentoSseMs`: o
  // padrão é 25 s, e nenhum teste pode esperar isso.
  extras: Record<string, unknown> = {},
): Promise<{
  servidor: Servidor;
  busca: (rota: string, init?: RequestInit) => Promise<Response>;
  fecha: () => Promise<void>;
}> {
  const servidor = new Servidor({
    acesso: ACESSO_LIBERADO,
    root: ROOT,
    snapshotDir,
    webDir: WEB,
    agora: () => AGORA,
    identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }),
    overlayRealtime: overlayRealtime as never,
    ...extras,
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    servidor,
    busca: (rota, init) => fetch(`http://127.0.0.1:${port}${rota}`, init),
    // `closeAllConnections`: uma conexão SSE de `/api/eventos` fica aberta de
    // propósito — `http.close()` sozinho esperaria por ela para sempre, porque
    // ele só para de ACEITAR conexão nova, nunca derruba a que já existe.
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.close(() => ok());
        http.closeAllConnections();
      }),
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
    assert.ok(Array.isArray(j.refresh.queries));
  } finally {
    await s.fecha();
  }
});

test('a rota /api/saude expõe refresh.queries[] com status e idade (Contrato A2 <-> A6)', async () => {
  const dir = dirVazio();
  await escreveStatus(dir, {
    quente: { ultimaTentativa: '2026-09-04T12:00:00.000Z', ultimoSucesso: '2026-09-04T12:00:00.000Z', duracaoMs: 1000, ok: true, falhasConsecutivas: 0 },
    frio: { ultimaTentativa: '2026-09-04T11:00:00.000Z', ultimoSucesso: null, duracaoMs: 2000, ok: false, falhasConsecutivas: 2, erro: 'ECONNRESET' },
  });
  const s = await servidor(dir);
  try {
    const r = await s.busca('/api/saude');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok(Array.isArray(j.refresh?.queries));
    assert.ok(j.refresh.queries.length > 0);

    // Grupo frio com falha marca a query do grupo como falhou. O motivo técnico fica
    // nos logs e no refresh-status.json, nunca no navegador.
    // Exemplos do `frio` desde a reorganização de 02/10/2026 (`refresh.yaml`): as 8 do
    // poller. `field-agenda-slot` e `protocolos-produtividade` eram os exemplos e saíram dele.
    const aux = j.refresh.queries.find((q: any) => q.id === 'protocolos-auxiliares');
    assert.ok(aux);
    assert.equal(aux.status, 'falhou');
    assert.equal(aux.erro, undefined);

    const reinc = j.refresh.queries.find((q: any) => q.id === 'reincidencia');
    assert.ok(reinc);
    assert.equal(reinc.status, 'falhou');
    assert.equal(reinc.erro, undefined);

    // **`field-agenda` entrou no grupo `frio` em 22/09/2026** (ACHADOS #145: os
    // 21min49s que a mantinham fora morreram no #86, e o arquivo custa 4min21s).
    // Ela era o exemplo de "query sem grupo" aqui e deixou de servir, pela mesma
    // razão que `protocolos-produtividade` deixou em 13/09: com o frio falhando,
    // ela reporta `falhou`, não `vencida`.
    //
    // **E o caso "sem grupo → vencida" não ficou sem guarda**: ele é de
    // `montaStatusDeRefresh`, não da rota, e está em
    // `backend/tools/refresh/test/status.test.ts`. Testá-lo aqui amarrava o contrato da
    // rota ao arranjo de grupos do dia — que é exatamente o que acabou de mudar.
    const fieldAgenda = j.refresh.queries.find((q: any) => q.id === 'field-agenda');
    assert.ok(fieldAgenda);
    assert.equal(fieldAgenda.status, 'falhou');
    assert.equal(fieldAgenda.erro, undefined);

    // O resumo do topo (ACHADOS #160): 2 falhas seguidas no frio acendem, e continua 200.
    assert.equal(j.degradacao.degradado, true);
    assert.deepEqual(j.degradacao, { degradado: true });
    assert.doesNotMatch(JSON.stringify(j), /ECONNRESET/, 'detalhe técnico fica nos logs, não na resposta HTTP');
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

/**
 * As três páginas de DICA do relatório original vinham na navegação como se fossem
 * tela. São `type: Tooltip`: 550x400, um visual, exibidas ao pairar sobre outro
 * visual — e nenhuma delas tem gabarito em `backend/specs/paridade/`, que tem exatamente 11
 * arquivos, um por página real.
 *
 * **O teste trava `type` como discriminador, não `visibility`.** Medido em
 * 18/09/2026: 10 das 11 páginas reais também são `HiddenInViewMode` — só a `capa`
 * é `AlwaysVisible`, porque o relatório original navega por botão a partir dela.
 * Filtrar por `visibility` teria escondido a aplicação inteira menos a capa, e é
 * exatamente o conserto plausível que alguém tentaria de novo sem esta asserção.
 */
test('a lista marca as três páginas de dica, e nenhuma página real', async () => {
  const s = await servidor(await dirComCapa());
  try {
    const j = await (await s.busca('/api/dashboards')).json();
    const dicas = j.dashboards
      .filter((d: { tooltip: boolean }) => d.tooltip)
      .map((d: { id: string }) => d.id)
      .sort();
    assert.deepEqual(dicas, ['l-inst', 'l-mapa', 'l-tec']);
    assert.equal(j.dashboards.length - dicas.length, 11, 'sobram as 11 páginas navegáveis');
    // A capa é `AlwaysVisible`; as outras 10 reais são `HiddenInViewMode` e
    // continuam navegáveis. É esta linha que impede o conserto por `visibility`.
    assert.equal(j.dashboards.find((d: { id: string }) => d.id === 'visao-geral').tooltip, false);
    assert.equal(j.dashboards.find((d: { id: string }) => d.id === 'capa').tooltip, false);
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

test('/layout traz as segmentações da página — a barra de filtros não espera o cálculo', async () => {
  const s = await servidor(dirVazio());
  try {
    const capa = await (await s.busca('/api/dashboards/capa/layout')).json();
    assert.deepEqual(capa.segmentacoes, []);
    const mes = await (await s.busca('/api/dashboards/relatorio-do-mes/layout')).json();
    assert.equal(mes.segmentacoes.length, 1);
    assert.equal(mes.segmentacoes[0].segmentacao.tabela, 'PROTOCOLOS');
    assert.equal(mes.segmentacoes[0].segmentacao.coluna, 'TIPO DE PROTOCOLO');
    assert.equal(typeof mes.segmentacoes[0].id, 'string');
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
    // A raiz entrega o `index.html` do build da aplicação React.
    assert.match(html, /<div id="raiz">/);
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
 * `backend/specs/_catalog/projecao.yaml` tira `'FIELD AGENDA'[Relato]` da abertura de
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
    verificadorGoogle: clienteQueDevolve({
      email: 'fulano@sebratel.com.br',
      hd: 'sebratel.com.br',
      name: 'Fulano da Silva',
      picture: 'https://lh3.googleusercontent.com/a/foto-do-fulano',
    }),
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
    assert.deepEqual((await depois.json()).eu, {
      usuario: 'fulano@sebratel.com.br',
      nome: 'Fulano da Silva',
      foto: 'https://lh3.googleusercontent.com/a/foto-do-fulano',
      papel: 'viewer',
      podeGerir: false,
    });
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

// ---------------------------------------------------------------- Firebase
//
// O mesmo fluxo de `/auth/google`, pela rota que a tela usa desde 16/09/2026.
// O que estes testes provam que os de cima não provam: as duas rotas emitem a
// MESMA sessão, e desligar uma não afrouxa a outra.
//
// A checagem fina do token vive em `auth-firebase.test.ts` — aqui é a costura.

const PROJETO_FIREBASE = 'installation-dashboard-307fd';
const PAR_FIREBASE = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID_FIREBASE = 'kid-de-teste';
const certificadosFirebase = async () => ({
  [KID_FIREBASE]: PAR_FIREBASE.publicKey.export({ type: 'spki', format: 'pem' }) as string,
});

/** Um ID token do Firebase assinado de verdade, para o e-mail pedido. */
function tokenFirebase(email: string): string {
  const agoraS = Math.floor(Date.now() / 1000);
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
  const assinavel =
    `${b64({ alg: 'RS256', kid: KID_FIREBASE, typ: 'JWT' })}.` +
    `${b64({
      iss: `https://securetoken.google.com/${PROJETO_FIREBASE}`,
      aud: PROJETO_FIREBASE,
      sub: 'uid-de-teste',
      iat: agoraS - 60,
      exp: agoraS + 3600,
      email,
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    })}`;
  const assinatura = crypto
    .sign('RSA-SHA256', Buffer.from(assinavel, 'utf8'), PAR_FIREBASE.privateKey)
    .toString('base64url');
  return `${assinavel}.${assinatura}`;
}

const postaFirebase = (
  s: { busca: (rota: string, init?: RequestInit) => Promise<Response> },
  idToken: unknown,
) =>
  s.busca('/auth/firebase', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });

test('login pelo Firebase: token válido cria sessão, e o cookie libera /api/*', async () => {
  const s = await servidorComLogin(dirVazio(), {
    googleClientId: '',
    firebaseProjectId: PROJETO_FIREBASE,
    certificadosFirebase,
  });
  try {
    assert.equal((await s.busca('/api/dashboards')).status, 401);

    const login = await postaFirebase(s, tokenFirebase('fulano@sebratel.com.br'));
    assert.equal(login.status, 200);
    assert.deepEqual(await login.json(), { usuario: 'fulano@sebratel.com.br' });

    const cookie = cookieDe(login);
    assert.match(cookie, /^sessao=/);
    assert.equal((await s.busca('/api/dashboards', { headers: { cookie } })).status, 200);
  } finally {
    await s.fecha();
  }
});

test('Firebase com GOOGLE_CLIENT_ID vazia NÃO libera /api/* sem sessão', async () => {
  // O defeito de 04/09/2026, por outra porta. O bypass `dev-local` olhava só o
  // `googleClientId`; com a tela migrada para o Firebase essa variável fica
  // vazia em produção, e a guarda antiga serviria dado de cliente a quem
  // alcançasse a URL. O teste acima já cobre o 401 inicial — este existe para
  // dizer POR QUE ele importa, e falha se alguém simplificar a condição.
  const s = await servidorComLogin(dirVazio(), {
    googleClientId: '',
    firebaseProjectId: PROJETO_FIREBASE,
    certificadosFirebase,
  });
  try {
    const r = await s.busca('/api/dashboards');
    assert.equal(r.status, 401, 'servindo /api/* sem sessão com o Firebase ligado');
  } finally {
    await s.fecha();
  }
});

test('login pelo Firebase com domínio de fora: 401, sem cookie nenhum', async () => {
  const s = await servidorComLogin(dirVazio(), {
    googleClientId: '',
    firebaseProjectId: PROJETO_FIREBASE,
    certificadosFirebase,
  });
  try {
    const r = await postaFirebase(s, tokenFirebase('fulano@gmail.com'));
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('set-cookie'), null);
  } finally {
    await s.fecha();
  }
});

test('FIREBASE_PROJECT_ID ausente: /auth/firebase recusa token válido — falha fechada', async () => {
  const s = await servidorComLogin(dirVazio(), { firebaseProjectId: '', certificadosFirebase });
  try {
    const r = await postaFirebase(s, tokenFirebase('fulano@sebratel.com.br'));
    assert.equal(r.status, 401);
    assert.match((await r.json()).erro, /não configurado/);
    assert.equal(r.headers.get('set-cookie'), null);
  } finally {
    await s.fecha();
  }
});

test('/auth/firebase sem idToken: 400; com corpo que não é JSON: 400, não 500', async () => {
  const s = await servidorComLogin(dirVazio(), {
    firebaseProjectId: PROJETO_FIREBASE,
    certificadosFirebase,
  });
  try {
    assert.equal((await postaFirebase(s, undefined)).status, 400);
    assert.equal((await postaFirebase(s, '')).status, 400);
    const cru = await s.busca('/auth/firebase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'isto não é json',
    });
    assert.equal(cru.status, 400);
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
// /auth/interno — login de ferramenta (backend/tools/tela), sem conta do Google
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

// ---------------------------------------------------------------------------
// aoTabelaMudar — o gatilho do poller de quase-realtime (ACHADOS #89/#90)
// ---------------------------------------------------------------------------
//
// **O teste que mais importa aqui** é o segundo: uma página que não usa a
// tabela que mudou tem de continuar servindo do cache. Não é o benefício da
// dúvida — é o ponto inteiro de não usar o carimbo global (ver o comentário de
// `aoTabelaMudar` em servidor.ts e ACHADOS #89): se esse teste falhasse, cada
// mudança no Voalle derrubaria o cache do site inteiro, não só de quem usa a
// tabela.

test('aoTabelaMudar: invalida o cache de quem usa a query, e o próximo pedido recalcula', async () => {
  const s = await servidorComOverlay(await dirComCapa(), () => new Map());
  try {
    const r1 = await s.busca('/api/dashboards/capa');
    assert.equal((await r1.json()).cache, 'miss', 'primeiro pedido: nada em cache ainda');

    const r2 = await s.busca('/api/dashboards/capa');
    assert.equal((await r2.json()).cache, 'hit', 'segundo pedido idêntico: acerto de cache');

    // `capa` usa a query `hora-atualizado` (é a única tabela que ela carrega).
    s.servidor.aoTabelaMudar('HORA ATUALIZADO', 'hora-atualizado');

    // A versão atual caiu; o que sai na hora é a "última pronta" (ACHADOS #164/#175),
    // com a nova sendo calculada por baixo — nunca o `hit` de antes do evento.
    const r3 = await s.busca('/api/dashboards/capa');
    assert.equal((await r3.json()).cache, 'anterior', 'depois de mudar, o cache tem de ter sido apagado');
  } finally {
    await s.fecha();
  }
});

test('aoTabelaMudar: query que a página NÃO usa não mexe no cache dela', async () => {
  const s = await servidorComOverlay(await dirComCapa(), () => new Map());
  try {
    await s.busca('/api/dashboards/capa');
    const r2 = await s.busca('/api/dashboards/capa');
    assert.equal((await r2.json()).cache, 'hit');

    // `capa` não depende de `protocolos-auxiliares` — isto não pode apagar nada dela.
    s.servidor.aoTabelaMudar('PROTOCOLOS AUXILIARES', 'protocolos-auxiliares');

    const r3 = await s.busca('/api/dashboards/capa');
    assert.equal(
      (await r3.json()).cache,
      'hit',
      'página sem relação com a tabela mudada não podia perder o cache',
    );
  } finally {
    await s.fecha();
  }
});

test('GET /api/eventos: content-type de SSE, e aoTabelaMudar manda o dashboard afetado', async () => {
  const s = await servidorComOverlay(await dirComCapa(), () => new Map());
  try {
    const resp = await s.busca('/api/eventos');
    assert.equal(resp.status, 200);
    assert.match(resp.headers.get('content-type') ?? '', /text\/event-stream/);

    const leitor = resp.body!.getReader();
    // A linha de comentário SSE (`: conectado`) que confirma a conexão aberta.
    const primeira = await leitor.read();
    assert.match(Buffer.from(primeira.value!).toString(), /^: conectado/);

    s.servidor.aoTabelaMudar('HORA ATUALIZADO', 'hora-atualizado');

    const evento = await leitor.read();
    const texto = Buffer.from(evento.value!).toString();
    assert.match(texto, /^data: /);
    // hora-atualizado alimenta várias páginas reais, não só capa — o evento
    // lista todas as afetadas; o que este teste prova é que capa está entre
    // elas, não que ela é a única.
    const corpo = JSON.parse(texto.slice('data: '.length).trim()) as { dashboards: string[] };
    assert.ok(corpo.dashboards.includes('capa'), `capa devia estar na lista: ${corpo.dashboards.join(', ')}`);

    await leitor.cancel();
  } finally {
    await s.fecha();
  }
});

test('GET /api/eventos: manda batimento sozinho, sem nenhuma mudança de tabela', async () => {
  // O DEFEITO QUE ISTO GUARDA. Até 04/09/2026 a rota mandava `: conectado` e
  // ficava MUDA até o poller achar mudança de verdade — o que numa madrugada
  // leva horas. Conexão silenciosa é indistinguível de conexão morta para
  // qualquer proxy no caminho, e o `EventSource` reconecta sozinho: o realtime
  // só "às vezes não chega", sem erro em log nenhum.
  //
  // Note que NADA muda aqui — nenhum `aoTabelaMudar`. Se o batimento não
  // existir, este teste espera para sempre e o `node --test` o mata por tempo.
  const s = await servidorComOverlay(await dirComCapa(), () => new Map(), { batimentoSseMs: 20 });
  try {
    const resp = await s.busca('/api/eventos');
    const leitor = resp.body!.getReader();

    const primeira = await leitor.read();
    assert.match(Buffer.from(primeira.value!).toString(), /^: conectado/);

    // Dois, não um: um só provaria que algo chegou; dois provam que REPETE.
    for (const enesimo of ['primeiro', 'segundo']) {
      const b = await leitor.read();
      assert.match(
        Buffer.from(b.value!).toString(),
        /^: batimento/,
        `${enesimo} batimento não chegou`,
      );
    }

    // Comentário SSE (`:`), não `event:`/`data:` — o navegador tem de DESCARTAR
    // sem disparar handler. Um batimento que virasse evento faria a tela
    // rebuscar todas as páginas a cada 25 s.
    assert.ok(s.servidor.batimentoLigado, 'com assinante aberto, o temporizador tem de estar ligado');

    await leitor.cancel();
  } finally {
    await s.fecha();
  }
});

test('GET /api/eventos: o batimento PARA quando o último assinante sai', async () => {
  // Um `setInterval` vazado não muda resposta nenhuma — só acorda o processo a
  // cada 25 s para escrever em ninguém, para sempre. Nada além deste teste o
  // pegaria.
  const s = await servidorComOverlay(await dirComCapa(), () => new Map(), { batimentoSseMs: 20 });
  try {
    assert.equal(s.servidor.batimentoLigado, false, 'sem assinante, nada a bater');

    const resp = await s.busca('/api/eventos');
    const leitor = resp.body!.getReader();
    await leitor.read();
    assert.equal(s.servidor.batimentoLigado, true);

    await leitor.cancel();
    // `close` do `req` é assíncrono; espera o servidor perceber a saída.
    for (let i = 0; i < 100 && s.servidor.batimentoLigado; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(s.servidor.batimentoLigado, false, 'batimento continuou ligado sem assinante');
  } finally {
    await s.fecha();
  }
});

// --------------------------------------------------------------------------
// A CHAVE DO CACHE DE VALORES DE SEGMENTAÇÃO (21/09/2026)
//
// `/valores` lê o cache ANTES de chamar `carrega()`, e `carrega()` é o único
// lugar que percebe a identidade da página avançar. Um acerto nunca passa por
// verificação de frescor — então o frescor tem de estar na CHAVE, ou a lista da
// segmentação serve o recorte de antes do refresh para sempre.
//
// Isto ficava mascarado enquanto o descarte de `carrega()` era global (qualquer
// outra página varria este mapa junto). Escopar o descarte por página tirou a
// vassoura; estes testes são o que garante que o mascaramento não era a única
// coisa segurando a corretude.

test('a chave dos valores separa DOIS frescores da mesma coluna', () => {
  const antes = chaveDeValores('visao-geral', 'hashA@2026-09-21', 'PROTOCOLOS GERAL', 'CIDADE', null);
  const depois = chaveDeValores('visao-geral', 'hashB@2026-09-21', 'PROTOCOLOS GERAL', 'CIDADE', null);
  assert.notEqual(
    antes,
    depois,
    'refresh da tabela não tornou a lista velha inalcançável — cidade nova entra no dado ' +
      'e o seletor continua mostrando a lista de antes',
  );
});

test('a chave dos valores separa a virada do DIA, não só o carimbo', () => {
  const ontem = chaveDeValores('visao-geral', 'mesmoHash@2026-09-20', 'PROTOCOLOS GERAL', 'CIDADE', null);
  const hoje = chaveDeValores('visao-geral', 'mesmoHash@2026-09-21', 'PROTOCOLOS GERAL', 'CIDADE', null);
  assert.notEqual(ontem, hoje, 'o dia faz parte do frescor pelas mesmas chamadas a TODAY() do resto');
});

test('a chave dos valores começa pelo id da página — é o que `esqueceAPagina` varre', () => {
  // O prefixo `${id}<NUL>` de `esqueceAPagina` (`servidor.ts`) tem de alcançar a
  // entrada de QUALQUER frescor desta página; se o id deixar de ser o primeiro
  // segmento, a poda para de podar e o mapa cresce sem limite.
  const chave = chaveDeValores('visao-geral', 'hash@2026-09-21', 'PROTOCOLOS GERAL', 'CIDADE', null);
  assert.ok(
    chave.startsWith(`visao-geral${String.fromCharCode(0)}`),
    'o id saiu do começo da chave, e `esqueceAPagina` deixou de alcançar estas entradas',
  );
});

test('a chave dos valores continua separando tabela, coluna e nível', () => {
  const base = chaveDeValores('p', 'f', 'T', 'c', null);
  assert.notEqual(base, chaveDeValores('p', 'f', 'OUTRA', 'c', null));
  assert.notEqual(base, chaveDeValores('p', 'f', 'T', 'outra', null));
  assert.notEqual(base, chaveDeValores('p', 'f', 'T', 'c', 'Dia'));
  // E normaliza o nome do mesmo jeito que a trava de permissão da rota, senão
  // `PROTOCOLOS GERAL` e `Protocolos Geral` virariam duas entradas do mesmo dado.
  assert.equal(chaveDeValores('p', 'f', 'T', 'c', null), chaveDeValores('p', 'f', 't', 'C', null));
});
