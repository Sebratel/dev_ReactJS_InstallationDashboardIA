// O portão de abas e a gestão de acessos (`permissoes.ts`) — quem abre o quê, quem pode
// mudar, e o que acontece com o banco fora do ar. Cada caso de "nega" aqui é um ponto em
// que o modelo do dashboard comercial libera (aba sem configuração, aba desconhecida), e
// que este projeto decidiu fechar.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MemoryCache } from '../../packages/query-engine/src/cache-memory.ts';
import { escreve } from '../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto } from '../../packages/snapshot/src/manifesto.ts';
import { loadDashboards } from '../../packages/widget-engine/src/spec.ts';
import type { Identidade } from '../src/identidade.ts';
import { criaAcesso, type LinhasDeAcesso, type LojaDeAcesso, type Mudanca } from '../src/permissoes.ts';
import { Servidor } from '../src/servidor.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB = path.join(ROOT, 'frontend', 'dist');
const TELAS = ['capa', 'visao-geral', 'premiacao-instalacao'];

const pessoa = (email: string): Identidade => ({ usuario: email, papeis: ['autenticado'] });

/** A loja em memória: mesmas regras de gravação da do MariaDB, e um log que só cresce. */
function lojaEmMemoria(inicial: Partial<LinhasDeAcesso> = {}) {
  const linhas: LinhasDeAcesso = { papeis: [], telas: [], emails: [], pedidos: [], ...inicial };
  const status = new Map<string, 'pending' | 'approved' | 'dismissed'>();
  const log: { por: string; acao: string }[] = [];
  let quebrada = false;
  const loja: LojaDeAcesso = {
    async le() {
      if (quebrada) throw new Error('banco fora');
      const pedidos = [...status].filter(([, st]) => st === 'pending').map(([email]) => ({ email, tentativas: 1, ultimaVez: '2026-10-13T12:00:00.000Z' }));
      return structuredClone({ ...linhas, pedidos });
    },
    async registraPedido(email: string) {
      if (quebrada) throw new Error('banco fora');
      const st = status.get(email);
      status.set(email, st === 'dismissed' ? 'dismissed' : 'pending');
      log.push({ por: '(pedido)', acao: 'registra-pedido' });
    },
    async aplica(m: Mudanca, por: string) {
      if (quebrada) throw new Error('banco fora');
      if (m.acao === 'telas-da-pessoa') {
        linhas.emails = linhas.emails.filter((e) => e.email !== m.email);
        for (const tela of m.telas) linhas.emails.push({ tela, email: m.email });
        if (m.telas.length > 0 && status.get(m.email) === 'pending') status.set(m.email, 'approved');
      } else if (m.acao === 'dispensa-pedido') {
        status.set(m.email, 'dismissed');
      } else if (m.acao === 'papel') {
        linhas.papeis = linhas.papeis.filter((p) => p.email !== m.email);
        if (m.papel !== 'viewer') linhas.papeis.push({ email: m.email, papel: m.papel });
      } else if (m.acao === 'modo-da-tela') {
        linhas.telas = linhas.telas.filter((t) => t.tela !== m.tela);
        linhas.telas.push({ tela: m.tela, modo: m.modo });
      } else {
        linhas.papeis = linhas.papeis.filter((p) => p.email !== m.email);
        linhas.emails = linhas.emails.filter((e) => e.email !== m.email);
      }
      log.push({ por, acao: m.acao });
    },
  };
  return { loja, linhas, log, status, quebra: (v = true) => (quebrada = v) };
}

async function acessoCom(inicial: Partial<LinhasDeAcesso> = {}, extra: { admins?: string[]; devs?: string[] } = {}) {
  const banco = lojaEmMemoria(inicial);
  const logs: string[] = [];
  const acesso = criaAcesso({
    loja: banco.loja,
    telasConhecidas: TELAS,
    adminsDoAmbiente: extra.admins ?? ['chefe@sebratel.com.br'],
    devsDoAmbiente: extra.devs ?? [],
    dominio: 'sebratel.com.br',
    log: (m) => logs.push(m),
  });
  await acesso.recarrega();
  return { acesso, banco, logs };
}

const BASE: Partial<LinhasDeAcesso> = {
  telas: [{ tela: 'capa', modo: 'todos' }],
  emails: [{ tela: 'visao-geral', email: 'Fulano@Sebratel.com.br' }],
};

// ------------------------------------------------------------------- quem abre o quê

test('aba com lista: só quem está nela — e o e-mail não depende de maiúscula', async () => {
  const { acesso } = await acessoCom(BASE);
  assert.equal(acesso.podeVer(pessoa('fulano@sebratel.com.br'), 'visao-geral'), true);
  assert.equal(acesso.podeVer(pessoa('FULANO@sebratel.com.br'), 'visao-geral'), true);
  assert.equal(acesso.podeVer(pessoa('ciclano@sebratel.com.br'), 'visao-geral'), false);
});

test('aba em modo todos: toda conta logada', async () => {
  const { acesso } = await acessoCom(BASE);
  assert.equal(acesso.podeVer(pessoa('qualquer@sebratel.com.br'), 'capa'), true);
});

test('aba sem regra no banco: só admin — no comercial ela nasceria aberta', async () => {
  const { acesso } = await acessoCom(BASE);
  assert.equal(acesso.podeVer(pessoa('fulano@sebratel.com.br'), 'premiacao-instalacao'), false);
  assert.equal(acesso.podeVer(pessoa('chefe@sebratel.com.br'), 'premiacao-instalacao'), true);
});

test('aba que não existe: ninguém — no comercial, "rota nova → liberada"', async () => {
  const { acesso } = await acessoCom(BASE);
  assert.equal(acesso.podeVer(pessoa('chefe@sebratel.com.br'), 'aba-inventada'), false);
});

test('dev não abre tudo: ele gerencia, mas vê só o que tem liberado', async () => {
  const { acesso } = await acessoCom({ ...BASE, papeis: [{ email: 'dev@sebratel.com.br', papel: 'dev' }] });
  const dev = pessoa('dev@sebratel.com.br');
  assert.equal(acesso.podeGerir(dev), true);
  assert.equal(acesso.podeVer(dev, 'premiacao-instalacao'), false);
});

test('identidade sem e-mail não é pessoa e não passa — só máquina declarada passa, e não gerencia', async () => {
  const { acesso } = await acessoCom(BASE);
  assert.equal(acesso.podeVer({ usuario: 'teste', papeis: ['autenticado'] }, 'capa'), false);
  const aquecedor = { usuario: 'aquecedor-interno', papeis: ['interno'] };
  assert.equal(acesso.podeVer(aquecedor, 'premiacao-instalacao'), true);
  assert.equal(acesso.podeGerir(aquecedor), false);
  assert.equal(acesso.podeVer({ usuario: 'dev-local', papeis: ['sem-login'] }, 'premiacao-instalacao'), true);
});

test('linha estranha no banco é descartada, nunca promovida', async () => {
  const { acesso } = await acessoCom({
    papeis: [{ email: 'x@sebratel.com.br', papel: 'superadmin' }],
    telas: [{ tela: 'aba-velha', modo: 'todos' }],
    emails: [{ tela: 'capa', email: 'sem-arroba' }],
  });
  assert.equal(acesso.papelDe(pessoa('x@sebratel.com.br')), 'viewer');
  assert.equal(acesso.podeVer(pessoa('x@sebratel.com.br'), 'capa'), false);
});

// ------------------------------------------------------------------- banco fora do ar

test('sem banco configurado: só o .env entra, e a gestão responde 503', async () => {
  const acesso = criaAcesso({
    loja: null, telasConhecidas: TELAS, adminsDoAmbiente: ['chefe@sebratel.com.br'], dominio: 'sebratel.com.br', log: () => {},
  });
  await acesso.recarrega();
  assert.equal(acesso.podeVer(pessoa('qualquer@sebratel.com.br'), 'capa'), false);
  assert.equal(acesso.podeVer(pessoa('chefe@sebratel.com.br'), 'capa'), true);
  assert.equal(acesso.estado().ok, false);
  await assert.rejects(
    acesso.muda(pessoa('chefe@sebratel.com.br'), { acao: 'modo-da-tela', tela: 'capa', modo: 'todos' }),
    { status: 503 },
  );
});

test('banco cai depois de lido: vale a última leitura boa — e a saúde diz que não está em dia', async () => {
  const { acesso, banco, logs } = await acessoCom(BASE);
  banco.quebra();
  await acesso.recarrega();
  assert.equal(acesso.podeVer(pessoa('fulano@sebratel.com.br'), 'visao-geral'), true);
  assert.equal(acesso.estado().ok, false);
  assert.ok(logs.some((l) => l.includes('mantendo a última leitura boa')));
});

test('banco fora já no boot: só o .env entra até ele voltar', async () => {
  const banco = lojaEmMemoria(BASE);
  banco.quebra();
  const acesso = criaAcesso({
    loja: banco.loja, telasConhecidas: TELAS, adminsDoAmbiente: ['chefe@sebratel.com.br'], dominio: 'sebratel.com.br', log: () => {},
  });
  await acesso.recarrega();
  assert.equal(acesso.podeVer(pessoa('fulano@sebratel.com.br'), 'visao-geral'), false);
  assert.equal(acesso.podeVer(pessoa('chefe@sebratel.com.br'), 'visao-geral'), true);
  banco.quebra(false);
  await acesso.recarrega();
  assert.equal(acesso.podeVer(pessoa('fulano@sebratel.com.br'), 'visao-geral'), true);
});

test('releitura que saiu antes de remover e voltou depois não traz a pessoa de volta', async () => {
  const { acesso, banco } = await acessoCom({ emails: [{ tela: 'visao-geral', email: 'fulano@sebratel.com.br' }] });
  const le = banco.loja.le;
  let solta!: () => void;
  const segura = new Promise<void>((r) => (solta = r));
  // A releitura periódica lê a foto de ANTES e só devolve depois da gravação.
  banco.loja.le = async () => {
    const foto = await le();
    banco.loja.le = le;
    await segura;
    return foto;
  };
  const periodica = acesso.recarrega();
  await acesso.muda(pessoa('chefe@sebratel.com.br'), { acao: 'remove-pessoa', email: 'fulano@sebratel.com.br' });
  solta();
  await periodica;
  assert.equal(acesso.podeVer(pessoa('fulano@sebratel.com.br'), 'visao-geral'), false);
  assert.ok(!acesso.matriz().pessoas.some((p) => p.email === 'fulano@sebratel.com.br'));
});

// ------------------------------------------------------------------- quem muda o quê

test('dev dá e tira aba — e vale na hora, com log de quem fez', async () => {
  const { acesso, banco } = await acessoCom(BASE, { devs: ['dev@sebratel.com.br'] });
  const dev = pessoa('dev@sebratel.com.br');
  await acesso.muda(dev, { acao: 'telas-da-pessoa', email: ' Novo@Sebratel.com.br ', telas: ['visao-geral'] });
  assert.equal(acesso.podeVer(pessoa('novo@sebratel.com.br'), 'visao-geral'), true);
  await acesso.muda(dev, { acao: 'telas-da-pessoa', email: 'novo@sebratel.com.br', telas: [] });
  assert.equal(acesso.podeVer(pessoa('novo@sebratel.com.br'), 'visao-geral'), false);
  assert.deepEqual(banco.log.map((l) => l.por), ['dev@sebratel.com.br', 'dev@sebratel.com.br']);
});

test('viewer não gerencia nada', async () => {
  const { acesso } = await acessoCom(BASE);
  await assert.rejects(
    acesso.muda(pessoa('fulano@sebratel.com.br'), { acao: 'telas-da-pessoa', email: 'fulano@sebratel.com.br', telas: TELAS }),
    { status: 403 },
  );
});

test('dev não muda papel nem remove quem tem papel — senão se promoveria', async () => {
  const { acesso } = await acessoCom({ papeis: [{ email: 'outro.dev@sebratel.com.br', papel: 'dev' }] }, { devs: ['dev@sebratel.com.br'] });
  const dev = pessoa('dev@sebratel.com.br');
  await assert.rejects(acesso.muda(dev, { acao: 'papel', email: 'dev@sebratel.com.br', papel: 'admin' }), { status: 403 });
  await assert.rejects(acesso.muda(dev, { acao: 'remove-pessoa', email: 'outro.dev@sebratel.com.br' }), { status: 403 });
});

test('admin muda papel — mas não o de quem está no .env', async () => {
  const { acesso } = await acessoCom({}, { devs: ['fixo@sebratel.com.br'] });
  const chefe = pessoa('chefe@sebratel.com.br');
  await acesso.muda(chefe, { acao: 'papel', email: 'novo@sebratel.com.br', papel: 'admin' });
  assert.equal(acesso.papelDe(pessoa('novo@sebratel.com.br')), 'admin');
  assert.equal(acesso.podeVer(pessoa('novo@sebratel.com.br'), 'premiacao-instalacao'), true);
  await assert.rejects(acesso.muda(chefe, { acao: 'papel', email: 'fixo@sebratel.com.br', papel: 'viewer' }), { status: 400 });
});

test('papel que só existe no protótipo de Object é recusado com 400, e nada é gravado (auditoria SEC-002)', async () => {
  // `'constructor' in RANK` é true: com `in`, o corpo `{"papel":"constructor"}` passava na
  // validação e ia para o INSERT — o ENUM do MariaDB recusava e a tela via um 503 "banco
  // fora", ou, sem modo estrito, gravava papel vazio. O `parseJsonSeguro` não pega: ele tira
  // CHAVES `constructor`, não VALORES.
  const { acesso, banco } = await acessoCom();
  const chefe = pessoa('chefe@sebratel.com.br');
  for (const papel of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    await assert.rejects(
      acesso.muda(chefe, { acao: 'papel', email: 'novo@sebratel.com.br', papel: papel as 'viewer' }),
      { status: 400 },
      papel,
    );
  }
  assert.deepEqual(banco.log, []);
});

test('e-mail fora do domínio e aba desconhecida são recusados', async () => {
  const { acesso } = await acessoCom();
  const chefe = pessoa('chefe@sebratel.com.br');
  await assert.rejects(acesso.muda(chefe, { acao: 'telas-da-pessoa', email: 'alguem@gmail.com', telas: ['capa'] }), { status: 400 });
  await assert.rejects(acesso.muda(chefe, { acao: 'telas-da-pessoa', email: 'a@sebratel.com.br', telas: ['aba-x'] }), { status: 400 });
  await assert.rejects(acesso.muda(chefe, { acao: 'modo-da-tela', tela: 'aba-x', modo: 'todos' }), { status: 400 });
});

test('banco falha na gravação: 503 e nada muda', async () => {
  const { acesso, banco } = await acessoCom(BASE);
  banco.quebra();
  await assert.rejects(
    acesso.muda(pessoa('chefe@sebratel.com.br'), { acao: 'telas-da-pessoa', email: 'novo@sebratel.com.br', telas: ['capa'] }),
    { status: 503 },
  );
  assert.equal(acesso.podeVer(pessoa('novo@sebratel.com.br'), 'premiacao-instalacao'), false);
});

// ------------------------------------------------------------------- pedidos de acesso

const espera = () => new Promise((ok) => setTimeout(ok, 10));

test('quem entra sem aba vira pedido — uma vez a cada 10 min, e máquina nunca', async () => {
  const { acesso, banco } = await acessoCom();
  const novo = pessoa('novo@sebratel.com.br');
  acesso.registraPedido(novo);
  acesso.registraPedido(novo);
  acesso.registraPedido({ usuario: 'aquecedor-interno', papeis: ['interno'] });
  acesso.registraPedido(pessoa('alguem@gmail.com'));
  await espera();
  assert.equal(banco.log.filter((l) => l.acao === 'registra-pedido').length, 1);
  assert.deepEqual(acesso.matriz().pedidos.map((p) => p.email), ['novo@sebratel.com.br']);
});

test('dar aba a quem pediu resolve o pedido; dispensar tira da lista e não volta', async () => {
  const { acesso, banco } = await acessoCom({}, { devs: ['dev@sebratel.com.br'] });
  const dev = pessoa('dev@sebratel.com.br');
  acesso.registraPedido(pessoa('a@sebratel.com.br'));
  acesso.registraPedido(pessoa('b@sebratel.com.br'));
  await espera();
  await acesso.muda(dev, { acao: 'telas-da-pessoa', email: 'a@sebratel.com.br', telas: ['capa'] });
  await acesso.muda(dev, { acao: 'dispensa-pedido', email: 'b@sebratel.com.br' });
  assert.deepEqual(acesso.matriz().pedidos, []);
  assert.equal(banco.status.get('a@sebratel.com.br'), 'approved');
  assert.equal(banco.status.get('b@sebratel.com.br'), 'dismissed');
});

test('viewer não dispensa pedido', async () => {
  const { acesso } = await acessoCom();
  await assert.rejects(acesso.muda(pessoa('x@sebratel.com.br'), { acao: 'dispensa-pedido', email: 'y@sebratel.com.br' }), { status: 403 });
});

// ------------------------------------------------------------------- ponta a ponta

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

async function sobe(inicial: Partial<LinhasDeAcesso>) {
  const ids = loadDashboards(path.join(ROOT, 'backend', 'specs')).map((d) => d.id);
  const acesso = criaAcesso({
    loja: lojaEmMemoria(inicial).loja,
    telasConhecidas: ids,
    adminsDoAmbiente: ['chefe@sebratel.com.br'],
    devsDoAmbiente: ['dev@sebratel.com.br'],
    dominio: 'sebratel.com.br',
    log: () => {},
  });
  await acesso.recarrega();
  const estado = { quem: pessoa('chefe@sebratel.com.br') };
  const inst = new Servidor({
    root: ROOT,
    snapshotDir: await dirComCapa(),
    webDir: WEB,
    agora: () => new Date('2026-10-13T12:00:00.000Z'),
    cache: new MemoryCache(),
    identifica: () => estado.quem,
    acesso,
  });
  const http = inst.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  return {
    estado,
    base,
    busca: (rota: string, init?: RequestInit) => fetch(`${base}${rota}`, init),
    fecha: () =>
      new Promise<void>((ok) => {
        inst.destroi();
        http.close(() => ok());
      }),
  };
}

test('com o cache já quente, quem não tem a aba leva 403 — em todas as rotas dela', async () => {
  const s = await sobe({ emails: [{ tela: 'capa', email: 'liberado@sebratel.com.br' }] });
  try {
    assert.equal((await s.busca('/api/dashboards/capa')).status, 200);
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'hit');

    s.estado.quem = pessoa('sem.acesso@sebratel.com.br');
    for (const rota of ['/api/dashboards/capa', '/api/dashboards/capa/valores?tabela=X&coluna=Y', '/api/dashboards/capa/layout']) {
      const r = await s.busca(rota);
      assert.equal(r.status, 403, rota);
      assert.doesNotMatch(await r.text(), /visuais/, `${rota} vazou conteúdo da página`);
    }
    const lista = await (await s.busca('/api/dashboards')).json();
    assert.deepEqual(lista.dashboards, []);
    assert.deepEqual(lista.eu, { usuario: 'sem.acesso@sebratel.com.br', papel: 'viewer', podeGerir: false });

    s.estado.quem = pessoa('liberado@sebratel.com.br');
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'hit');
    assert.equal((await s.busca('/api/dashboards/nao-existe')).status, 404);
  } finally {
    await s.fecha();
  }
});

test('/api/admin/acessos: viewer leva 403 até no GET (a matriz lista e-mails)', async () => {
  const s = await sobe({});
  try {
    s.estado.quem = pessoa('fulano@sebratel.com.br');
    assert.equal((await s.busca('/api/admin/acessos')).status, 403);
    const r = await s.busca('/api/admin/acessos/pessoa', {
      method: 'POST',
      headers: { origin: s.base, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'fulano@sebratel.com.br', telas: ['capa'] }),
    });
    assert.equal(r.status, 403);
  } finally {
    await s.fecha();
  }
});

test('/api/admin/acessos: dev dá a aba pela tela — e o POST sem Origin é recusado (CSRF)', async () => {
  const s = await sobe({});
  try {
    s.estado.quem = pessoa('dev@sebratel.com.br');
    const matriz = await (await s.busca('/api/admin/acessos')).json();
    assert.ok(matriz.telas.some((t: { id: string; nome: string }) => t.id === 'capa' && t.nome));
    assert.ok(!matriz.telas.some((t: { id: string }) => t.id === 'l-inst'), 'página de dica não entra na matriz');

    const corpo = JSON.stringify({ email: 'novo@sebratel.com.br', telas: ['capa'] });
    const semOrigem = await s.busca('/api/admin/acessos/pessoa', { method: 'POST', body: corpo });
    assert.equal(semOrigem.status, 403);
    const outraOrigem = await s.busca('/api/admin/acessos/pessoa', { method: 'POST', body: corpo, headers: { origin: 'http://malicioso.example' } });
    assert.equal(outraOrigem.status, 403);

    const ok = await s.busca('/api/admin/acessos/pessoa', { method: 'POST', body: corpo, headers: { origin: s.base } });
    assert.equal(ok.status, 200);
    const nova = await ok.json();
    assert.deepEqual(nova.pessoas.find((p: { email: string }) => p.email === 'novo@sebratel.com.br').telas, ['capa']);

    s.estado.quem = pessoa('novo@sebratel.com.br');
    assert.equal((await s.busca('/api/dashboards/capa')).status, 200);
  } finally {
    await s.fecha();
  }
});

test('POST em qualquer outra rota de /api continua 405 — a exceção é só a gestão de acessos', async () => {
  const s = await sobe({});
  try {
    const r = await s.busca('/api/dashboards/capa', { method: 'POST', headers: { origin: s.base } });
    assert.equal(r.status, 405);
  } finally {
    await s.fecha();
  }
});
