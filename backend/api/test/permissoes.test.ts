// O portão de abas (`permissoes.ts`) — quem abre o quê, e o que acontece quando o
// `permissoes.yaml` está errado. Cada caso de "nega" aqui é um ponto em que o modelo
// do dashboard comercial libera (aba sem configuração, aba desconhecida), e que este
// projeto decidiu fechar.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { MemoryCache } from '../../packages/query-engine/src/cache-memory.ts';
import { escreve } from '../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto } from '../../packages/snapshot/src/manifesto.ts';
import { loadDashboards } from '../../packages/widget-engine/src/spec.ts';
import type { Identidade } from '../src/identidade.ts';
import { carregaAcesso, validaPermissoes } from '../src/permissoes.ts';
import { Servidor } from '../src/servidor.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB = path.join(ROOT, 'frontend', 'dist');
const TELAS = ['capa', 'visao-geral', 'premiacao-instalacao'];

const pessoa = (email: string): Identidade => ({ usuario: email, papeis: ['autenticado'] });

function yamlTemporario(conteudo: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'permissoes-'));
  const arquivo = path.join(dir, 'permissoes.yaml');
  fs.writeFileSync(arquivo, conteudo);
  return arquivo;
}

function acessoDe(conteudo: string, extra: { adminsDoAmbiente?: string[] } = {}) {
  const logs: string[] = [];
  const acesso = carregaAcesso({
    arquivo: yamlTemporario(conteudo),
    telasConhecidas: TELAS,
    log: (m) => logs.push(m),
    ...extra,
  });
  return { acesso, logs };
}

const BASE = `
admins: [chefe@sebratel.com.br]
telas:
  capa:
    modo: todos
  visao-geral:
    emails: [Fulano@Sebratel.com.br]
linhas: {}
`;

test('aba com lista: só quem está nela — e o e-mail não depende de maiúscula', () => {
  const { acesso } = acessoDe(BASE);
  assert.equal(acesso.podeVer(pessoa('fulano@sebratel.com.br'), 'visao-geral'), true);
  assert.equal(acesso.podeVer(pessoa('FULANO@sebratel.com.br'), 'visao-geral'), true);
  assert.equal(acesso.podeVer(pessoa('ciclano@sebratel.com.br'), 'visao-geral'), false);
});

test('aba em modo todos: toda conta logada', () => {
  const { acesso } = acessoDe(BASE);
  assert.equal(acesso.podeVer(pessoa('qualquer@sebratel.com.br'), 'capa'), true);
});

test('aba fora do arquivo: só admin — no comercial ela nasceria aberta', () => {
  const { acesso } = acessoDe(BASE);
  assert.equal(acesso.podeVer(pessoa('fulano@sebratel.com.br'), 'premiacao-instalacao'), false);
  assert.equal(acesso.podeVer(pessoa('chefe@sebratel.com.br'), 'premiacao-instalacao'), true);
});

test('aba que não existe: ninguém — no comercial, "rota nova → liberada"', () => {
  const { acesso } = acessoDe(BASE);
  assert.equal(acesso.podeVer(pessoa('chefe@sebratel.com.br'), 'aba-inventada'), false);
});

test('conta nova, fora de tudo: não abre nada além do que é `todos`', () => {
  const { acesso } = acessoDe(BASE);
  const nova = pessoa('recem.chegado@sebratel.com.br');
  assert.deepEqual(TELAS.filter((t) => acesso.podeVer(nova, t)), ['capa']);
  assert.equal(acesso.ehAdmin(nova), false);
});

test('identidade sem e-mail não é pessoa e não passa — só máquina declarada passa', () => {
  const { acesso } = acessoDe(BASE);
  assert.equal(acesso.podeVer({ usuario: 'teste', papeis: ['autenticado'] }, 'capa'), false);
  assert.equal(acesso.podeVer({ usuario: 'aquecedor-interno', papeis: ['interno'] }, 'premiacao-instalacao'), true);
  assert.equal(acesso.podeVer({ usuario: 'dev-local', papeis: ['sem-login'] }, 'premiacao-instalacao'), true);
});

for (const [caso, conteudo] of [
  ['chave com erro de digitação', `admins: []\ntela:\n  capa: {modo: todos}\n`],
  ['aba que não existe', `telas:\n  visao-gerla: {emails: [a@sebratel.com.br]}\n`],
  ['e-mail sem @', `telas:\n  capa: {emails: [fulano.sebratel.com.br]}\n`],
  ['modo desconhecido', `telas:\n  capa: {modo: alguns}\n`],
  ['todos com lista (contraditório)', `telas:\n  capa: {modo: todos, emails: [a@sebratel.com.br]}\n`],
  ['recorte por linha declarado (nada o aplicaria)', `linhas:\n  gestor: [{tabela: X, coluna: Y}]\n`],
  ['YAML ilegível', `telas: [capa: {\n`],
] as const) {
  test(`arquivo inválido (${caso}): nega tudo, menos ADMIN_EMAILS — e diz no log`, () => {
    const { acesso, logs } = acessoDe(conteudo, {
      adminsDoAmbiente: ['plantao@sebratel.com.br'],
    });
    assert.equal(acesso.podeVer(pessoa('qualquer@sebratel.com.br'), 'capa'), false);
    assert.equal(acesso.podeVer(pessoa('plantao@sebratel.com.br'), 'premiacao-instalacao'), true);
    assert.equal(acesso.estado().ok, false);
    assert.ok(logs.some((l) => l.includes('INVÁLIDO')), logs.join('\n'));
  });
}

test('arquivo ausente: nega tudo, menos ADMIN_EMAILS', () => {
  const acesso = carregaAcesso({
    arquivo: path.join(os.tmpdir(), 'nao-existe-permissoes.yaml'),
    telasConhecidas: TELAS,
    adminsDoAmbiente: ['plantao@sebratel.com.br'],
    log: () => {},
  });
  assert.equal(acesso.podeVer(pessoa('qualquer@sebratel.com.br'), 'capa'), false);
  assert.equal(acesso.podeVer(pessoa('plantao@sebratel.com.br'), 'capa'), true);
});

test('o .env não é rebaixado pelo arquivo', () => {
  const { acesso } = acessoDe(`admins: []\n`, { adminsDoAmbiente: [' Plantao@Sebratel.com.br '] });
  assert.equal(acesso.ehAdmin(pessoa('plantao@sebratel.com.br')), true);
});

test('mudar o arquivo vale sem reiniciar — e tirar alguém tira de verdade', () => {
  let t = 0;
  const arquivo = yamlTemporario(BASE);
  const acesso = carregaAcesso({ arquivo, telasConhecidas: TELAS, releituraMs: 1000, agora: () => t, log: () => {} });
  const fulano = pessoa('fulano@sebratel.com.br');
  assert.equal(acesso.podeVer(fulano, 'visao-geral'), true);

  fs.writeFileSync(arquivo, BASE.replace('emails: [Fulano@Sebratel.com.br]', 'emails: []  # saiu da equipe'));
  t += 1001;
  assert.equal(acesso.podeVer(fulano, 'visao-geral'), false);
});

test('o permissoes.yaml do repositório é válido contra as abas que existem', () => {
  // Um arquivo commitado quebrado tranca todo mundo fora (só ADMIN_EMAILS entra).
  // Este teste é o que impede isso de chegar ao staging.
  const ids = loadDashboards(path.join(ROOT, 'backend', 'specs')).map((d) => d.id);
  const doc: unknown = YAML.parse(
    fs.readFileSync(path.join(ROOT, 'backend', 'specs', '_catalog', 'permissoes.yaml'), 'utf8'),
  );
  assert.doesNotThrow(() => validaPermissoes(doc, ids));
});

// ---------------------------------------------------------------------------
// Ponta a ponta: o portão está ANTES do cache
// ---------------------------------------------------------------------------

async function dirComCapa(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'permissoes-snap-'));
  const geradoEm = '2026-10-13T11:00:00.000Z';
  const cab = await escreve(
    arquivoDaQuery(dir, 'hora-atualizado'),
    { query: 'hora-atualizado', tabelas: ['HORA ATUALIZADO'], geradoEm },
    ['datahora', 'data', 'hora'],
    [{
      datahora: new Date('2026-10-13T10:34:00.000Z'),
      data: new Date('2026-10-13T00:00:00.000Z'),
      hora: new Date('1899-12-30T10:34:00.000Z'),
    }],
  );
  await escreveManifesto(dir, [
    { query: 'hora-atualizado', tabelas: cab.tabelas, linhas: 1, colunas: 3, bytes: 200, geradoEm: cab.geradoEm },
  ]);
  return dir;
}

test('com o cache já quente, quem não tem a aba leva 403 — em todas as rotas dela', async () => {
  const ids = loadDashboards(path.join(ROOT, 'backend', 'specs')).map((d) => d.id);
  const acesso = carregaAcesso({
    arquivo: yamlTemporario(`
admins: [chefe@sebratel.com.br]
telas:
  capa:
    emails: [liberado@sebratel.com.br]
`),
    telasConhecidas: ids,
    log: () => {},
  });
  let quemPede = pessoa('chefe@sebratel.com.br');
  const inst = new Servidor({
    root: ROOT,
    snapshotDir: await dirComCapa(),
    webDir: WEB,
    agora: () => new Date('2026-10-13T12:00:00.000Z'),
    cache: new MemoryCache(),
    identifica: () => quemPede,
    acesso,
  });
  const http = inst.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  const busca = (rota: string) => fetch(`http://127.0.0.1:${port}${rota}`);
  try {
    // O admin aquece.
    assert.equal((await busca('/api/dashboards/capa')).status, 200);
    assert.equal((await (await busca('/api/dashboards/capa')).json()).cache, 'hit');

    // Sem a aba: 403 na página, nos valores e no layout — mesmo com a resposta pronta.
    quemPede = pessoa('sem.acesso@sebratel.com.br');
    for (const rota of [
      '/api/dashboards/capa',
      '/api/dashboards/capa/valores?tabela=X&coluna=Y',
      '/api/dashboards/capa/layout',
    ]) {
      const r = await busca(rota);
      assert.equal(r.status, 403, rota);
      assert.doesNotMatch(await r.text(), /visuais/, `${rota} vazou conteúdo da página`);
    }
    const lista = await (await busca('/api/dashboards')).json();
    assert.deepEqual(lista.dashboards, []);
    assert.deepEqual(lista.eu, { usuario: 'sem.acesso@sebratel.com.br', admin: false });

    // Com a aba: a MESMA entrada que o admin aqueceu — o cache continua compartilhado.
    quemPede = pessoa('liberado@sebratel.com.br');
    assert.equal((await (await busca('/api/dashboards/capa')).json()).cache, 'hit');
    assert.deepEqual(
      (await (await busca('/api/dashboards')).json()).dashboards.map((d: { id: string }) => d.id),
      ['capa'],
    );

    // Página inexistente segue 404, não 403.
    assert.equal((await busca('/api/dashboards/nao-existe')).status, 404);
  } finally {
    await new Promise<void>((ok) => {
      inst.destroi();
      http.close(() => ok());
    });
  }
});
