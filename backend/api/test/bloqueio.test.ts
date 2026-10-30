// Quem não entra, e por quê (20/10/2026): suspensão manual, validade do acesso e a
// situação na Senior (desligado, afastado, fora da Senior), com os admins do .env imunes.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Identidade } from '../src/identidade.ts';
import {
  bloqueioDe,
  criaAcesso,
  ErroDeAcesso,
  type AcessoDasTelas,
  type Bloqueio,
  type LinhasDeAcesso,
  type LojaDeAcesso,
  type RegraDePessoa,
} from '../src/permissoes.ts';
import { consolidaColaboradores, criaSenior, type ColaboradorSenior, type FonteSenior } from '../src/senior.ts';
import { Servidor } from '../src/servidor.ts';
import { ACESSO_LIBERADO } from './fixtures/acesso.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const AGORA = Date.parse('2026-10-20T12:00:00Z');
const pessoa = (email: string): Identidade => ({ usuario: email, papeis: ['autenticado'] });
const trabalhando: ColaboradorSenior = { situacao: 'Trabalhando', nome: 'X', matricula: '1' };

// ── Senior ─────────────────────────────────────────────────────────────────

test('senior: um vínculo por e-mail — o ativo vence o desligado, e o e-mail é normalizado', () => {
  const m = consolidaColaboradores([
    { email: ' Ana@Sebratel.com.br  ', record_type: 'terminated', status: 'Demitido', admission_date: '2020-01-01' },
    { email: 'ana@sebratel.com.br', record_type: 'admitted', status: 'Férias', admission_date: '2024-01-01', name: 'Ana' },
    { email: 'bia@sebratel.com.br', record_type: 'terminated', status: 'Demitido', admission_date: '2021-01-01' },
    { email: '', record_type: 'admitted', status: 'Trabalhando' },
  ]);
  assert.equal(m.size, 2, 'linha sem e-mail não entra');
  assert.equal(m.get('ana@sebratel.com.br')?.situacao, 'Férias');
  assert.equal(m.get('bia@sebratel.com.br')?.situacao, 'Demitido');
});

function dataHubFalso(linhas: object[], pedidos: string[] = []) {
  return (async (url: string | URL) => {
    pedidos.push(String(url));
    const u = new URL(String(url));
    const offset = Number(u.searchParams.get('offset'));
    const limit = Number(u.searchParams.get('limit'));
    return new Response(JSON.stringify({ total: linhas.length, rows: linhas.slice(offset, offset + limit) }));
  }) as typeof fetch;
}

const linhas = (n: number, status = 'Trabalhando') =>
  Array.from({ length: n }, (_, i) => ({ email: `p${i}@sebratel.com.br`, record_type: 'admitted', status }));

test('senior: pagina até o total, guarda em disco e relê ao subir', async () => {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'senior-')), 's.json');
  const pedidos: string[] = [];
  const s = criaSenior({ baseUrl: 'http://dh', token: 't', arquivo, buscar: dataHubFalso(linhas(2500), pedidos), log: () => {} });
  assert.equal(s.situacaoDe('p1@sebratel.com.br'), undefined, 'antes da primeira leitura a regra não existe');
  await s.sincroniza();
  assert.equal(pedidos.length, 3, '2500 linhas em páginas de 1000');
  // A API de consumo por conjunto (30/10/2026), não mais a publicação `/p/instalacao-senior`.
  assert.equal(pedidos[0], 'http://dh/datasets/db-senior-collaborators-2/rows?limit=1000&offset=0');
  assert.equal(s.situacaoDe('p2499@sebratel.com.br')?.situacao, 'Trabalhando');
  assert.equal(s.situacaoDe('ninguem@sebratel.com.br'), null, 'fora da Senior');

  const deNovo = criaSenior({ baseUrl: 'http://dh', token: 't', arquivo, buscar: (async () => new Response('', { status: 500 })) as unknown as typeof fetch, log: () => {} });
  assert.equal(deNovo.situacaoDe('p7@sebratel.com.br')?.situacao, 'Trabalhando', 'a leitura em disco vale ao subir');
  await deNovo.sincroniza();
  assert.equal(deNovo.estado().carregada, true, 'falha não apaga a leitura boa');
  assert.match(deNovo.estado().falhou ?? '', /HTTP 500/);
});

// A API do Data Hub sempre responde `{ error }` em JSON; corpo que não é JSON é o proxy do
// nome público. As duas chegavam como "HTTP 403", e a primeira suspeita virava o token.
test('senior: a falha diz quem recusou — a API do Data Hub ou um proxy no caminho', async () => {
  const comResposta = (corpo: string) =>
    criaSenior({ baseUrl: 'http://dh', token: 't', buscar: (async () => new Response(corpo, { status: 403 })) as unknown as typeof fetch, log: () => {} });
  const daApi = comResposta(JSON.stringify({ error: 'Este token não tem acesso a este conjunto de dados.' }));
  await daApi.sincroniza();
  assert.match(daApi.estado().falhou ?? '', /HTTP 403: Este token não tem acesso a este conjunto/);
  const doProxy = comResposta('<html><body>403 Forbidden</body></html>');
  await doProxy.sincroniza();
  assert.match(doProxy.estado().falhou ?? '', /não é JSON .* proxy no caminho/);
});

test('senior: leitura com menos da metade das pessoas é descartada', async () => {
  let atual = linhas(100);
  const s = criaSenior({ baseUrl: 'http://dh', token: 't', buscar: ((u: string) => dataHubFalso(atual)(u)) as typeof fetch, log: () => {} });
  await s.sincroniza();
  atual = linhas(30);
  await s.sincroniza();
  assert.equal(s.estado().pessoas, 100);
  assert.match(s.estado().falhou ?? '', /menos da metade/);
});

// ── regra ──────────────────────────────────────────────────────────────────

const regra = (r: Partial<RegraDePessoa>): RegraDePessoa => ({
  email: 'a@sebratel.com.br', suspensa: false, motivo: null, suspensaAte: null, expiraEm: null, excecaoSenior: false, ...r,
});

test('bloqueioDe: suspensão, depois validade, depois Senior — e a exceção só pula a Senior', () => {
  assert.equal(bloqueioDe(regra({ suspensa: true, motivo: 'auditoria' }), trabalhando, AGORA)?.origem, 'manual');
  assert.equal(bloqueioDe(regra({ suspensa: true, suspensaAte: '2026-10-01T00:00:00Z' }), trabalhando, AGORA), null, 'suspensão vencida não vale');
  assert.equal(bloqueioDe(regra({ expiraEm: '2026-10-19T00:00:00Z' }), trabalhando, AGORA)?.origem, 'validade');
  assert.equal(bloqueioDe(regra({ expiraEm: '2026-12-01T00:00:00Z' }), trabalhando, AGORA), null);
  assert.match(bloqueioDe(undefined, { ...trabalhando, situacao: 'Férias' }, AGORA)?.motivo ?? '', /Férias/);
  assert.match(bloqueioDe(undefined, { ...trabalhando, situacao: 'Demitido' }, AGORA)?.motivo ?? '', /desligado/);
  assert.match(bloqueioDe(undefined, null, AGORA)?.motivo ?? '', /não encontrado/);
  assert.equal(bloqueioDe(regra({ excecaoSenior: true }), null, AGORA), null, 'exceção do admin');
  assert.equal(bloqueioDe(undefined, undefined, AGORA), null, 'Senior não carregada: regra fora');
});

function lojaComRegras(regras: RegraDePessoa[] = []): LojaDeAcesso & { regras: RegraDePessoa[] } {
  const linhas: LinhasDeAcesso = { papeis: [{ email: 'gestor@sebratel.com.br', papel: 'admin' }], telas: [], emails: [], regras };
  return {
    regras,
    async le() {
      return structuredClone(linhas);
    },
    async aplica(m) {
      if (m.acao !== 'suspende' && m.acao !== 'reativa' && m.acao !== 'validade' && m.acao !== 'excecao-senior') return;
      let r = linhas.regras!.find((x) => x.email === m.email);
      if (!r) linhas.regras!.push((r = regra({ email: m.email })));
      if (m.acao === 'suspende') Object.assign(r, { suspensa: true, motivo: m.motivo, suspensaAte: m.ate });
      if (m.acao === 'reativa') Object.assign(r, { suspensa: false, motivo: null, suspensaAte: null });
      if (m.acao === 'validade') r.expiraEm = m.expiraEm;
      if (m.acao === 'excecao-senior') r.excecaoSenior = m.ligada;
    },
    async registraPedido() {},
  };
}

const seniorFixa = (m: Record<string, string>): FonteSenior => ({
  situacaoDe: (e) => (m[e] ? { situacao: m[e]!, nome: '', matricula: '' } : null),
  estado: () => ({ carregada: true, lidaEm: null, pessoas: Object.keys(m).length, falhou: null }),
});

test('acesso: o .env nunca é barrado; bloqueado não vê aba; matriz diz o motivo', async () => {
  const acesso = criaAcesso({
    loja: lojaComRegras(),
    telasConhecidas: ['capa'],
    adminsDoAmbiente: ['chefe@sebratel.com.br'],
    dominio: 'sebratel.com.br',
    senior: seniorFixa({ 'ferias@sebratel.com.br': 'Férias', 'ok@sebratel.com.br': 'Trabalhando' }),
    modoSenior: 'bloquear',
    agora: () => AGORA,
    log: () => {},
  });
  await acesso.recarrega();
  assert.equal(acesso.bloqueio(pessoa('chefe@sebratel.com.br')), null, 'admin do .env fora da Senior entra');
  assert.equal(acesso.bloqueio(pessoa('ok@sebratel.com.br')), null);
  assert.match(acesso.bloqueio(pessoa('ferias@sebratel.com.br'))?.motivo ?? '', /Férias/);
  assert.equal(acesso.podeVer(pessoa('gestor@sebratel.com.br'), 'capa'), false, 'admin do banco fora da Senior não vê nada');
  assert.equal(acesso.bloqueio({ usuario: 'aquecedor-interno', papeis: ['interno'] }), null, 'máquina nunca');
  const gestor = acesso.matriz().pessoas.find((p) => p.email === 'gestor@sebratel.com.br');
  assert.equal(gestor?.bloqueio?.origem, 'senior');
  assert.equal(gestor?.senior, null);
});

test('acesso: suspender, exceção da Senior e validade — e quem não pode mexer', async () => {
  const acesso = criaAcesso({
    loja: lojaComRegras(),
    telasConhecidas: ['capa'],
    adminsDoAmbiente: ['chefe@sebratel.com.br'],
    devsDoAmbiente: ['dev@sebratel.com.br'],
    dominio: 'sebratel.com.br',
    senior: seniorFixa({ 'ana@sebratel.com.br': 'Trabalhando' }),
    modoSenior: 'bloquear',
    agora: () => AGORA,
    log: () => {},
  });
  await acesso.recarrega();
  const chefe = pessoa('chefe@sebratel.com.br');

  await acesso.muda(chefe, { acao: 'suspende', email: 'ana@sebratel.com.br', motivo: 'auditoria', ate: null });
  assert.match(acesso.bloqueio(pessoa('ana@sebratel.com.br'))?.motivo ?? '', /suspenso: auditoria/);
  await acesso.muda(chefe, { acao: 'reativa', email: 'ana@sebratel.com.br' });
  assert.equal(acesso.bloqueio(pessoa('ana@sebratel.com.br')), null);

  await acesso.muda(chefe, { acao: 'excecao-senior', email: 'consultor@sebratel.com.br', ligada: true });
  assert.equal(acesso.bloqueio(pessoa('consultor@sebratel.com.br')), null, 'exceção libera quem está fora da Senior');
  await acesso.muda(chefe, { acao: 'validade', email: 'consultor@sebratel.com.br', expiraEm: '2026-10-19T00:00:00Z' });
  assert.equal(acesso.bloqueio(pessoa('consultor@sebratel.com.br'))?.origem, 'validade');

  const recusa = (quem: Identidade, m: Parameters<AcessoDasTelas['muda']>[1]) =>
    assert.rejects(acesso.muda(quem, m), (e: unknown) => e instanceof ErroDeAcesso);
  await recusa(chefe, { acao: 'suspende', email: 'dev@sebratel.com.br', motivo: '', ate: null });
  await recusa(chefe, { acao: 'suspende', email: 'chefe@sebratel.com.br', motivo: '', ate: null });
  await recusa(pessoa('dev@sebratel.com.br'), { acao: 'suspende', email: 'gestor@sebratel.com.br', motivo: '', ate: null });
  await recusa(chefe, { acao: 'validade', email: 'ana@sebratel.com.br', expiraEm: 'ontem' });
});

test('acesso: em modo observar a Senior só aparece na matriz; suspensão vale sempre', async () => {
  const acesso = criaAcesso({
    loja: lojaComRegras(),
    telasConhecidas: ['capa'],
    adminsDoAmbiente: ['chefe@sebratel.com.br'],
    dominio: 'sebratel.com.br',
    senior: seniorFixa({}),
    agora: () => AGORA,
    log: () => {},
  });
  await acesso.recarrega();
  assert.equal(acesso.bloqueio(pessoa('gestor@sebratel.com.br')), null, 'observar não barra');
  const gestor = acesso.matriz().pessoas.find((p) => p.email === 'gestor@sebratel.com.br');
  assert.equal(gestor?.bloqueio?.origem, 'senior', 'mas mostra quem barraria');
  assert.equal(gestor?.barrada, false);
  assert.equal(acesso.matriz().senior?.modo, 'observar');
  await acesso.muda(pessoa('chefe@sebratel.com.br'), { acao: 'suspende', email: 'gestor@sebratel.com.br', motivo: 'x', ate: null });
  assert.equal(acesso.bloqueio(pessoa('gestor@sebratel.com.br'))?.origem, 'manual');
});

// ── servidor ───────────────────────────────────────────────────────────────

test('servidor: login de quem está barrado é 403 com o motivo; barrado depois de logar cai', async () => {
  let barrado: Bloqueio | null = null;
  const acesso: AcessoDasTelas = { ...ACESSO_LIBERADO, bloqueio: (q) => (q.usuario === 'ana@sebratel.com.br' ? barrado : null) };
  const servidor = new Servidor({
    acesso,
    root: ROOT,
    snapshotDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bloqueio-')),
    webDir: path.join(ROOT, 'frontend', 'dist'),
    agora: () => new Date(AGORA),
    googleClientId: '123.apps.googleusercontent.com',
    dominioCorporativo: 'sebratel.com.br',
    verificadorGoogle: {
      async verifyIdToken() {
        return { getPayload: () => ({ email: 'ana@sebratel.com.br', hd: 'sebratel.com.br' }) as never };
      },
    },
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const loga = () =>
    fetch(`${base}/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ idToken: 'x' }),
    });
  try {
    const r = await loga();
    assert.equal(r.status, 200);
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0]!;
    assert.equal((await fetch(`${base}/api/dashboards`, { headers: { cookie } })).status, 200);

    barrado = { origem: 'senior', motivo: 'Acesso bloqueado enquanto a Senior indicar: Férias.' };
    const caiu = await fetch(`${base}/api/dashboards`, { headers: { cookie } });
    assert.equal(caiu.status, 401);
    assert.match((await caiu.json()).erro, /Férias/);
    barrado = null;
    assert.equal((await fetch(`${base}/api/dashboards`, { headers: { cookie } })).status, 401, 'a sessão foi derrubada, não só recusada');

    barrado = { origem: 'manual', motivo: 'Acesso suspenso: auditoria' };
    const recusado = await loga();
    assert.equal(recusado.status, 403);
    assert.equal(recusado.headers.get('set-cookie'), null, 'nenhuma sessão nasce');
    assert.match((await recusado.json()).erro, /auditoria/);
  } finally {
    servidor.destroi();
    http.closeAllConnections?.();
    await new Promise<void>((ok) => http.close(() => ok()));
  }
});

test('GET /auth/sessao: sempre 200, só o booleano — e barrado conta como sem sessão', async () => {
  let barrado: Bloqueio | null = null;
  const acesso: AcessoDasTelas = { ...ACESSO_LIBERADO, bloqueio: () => barrado };
  const servidor = new Servidor({
    acesso,
    root: ROOT,
    snapshotDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sessao-')),
    webDir: path.join(ROOT, 'frontend', 'dist'),
    agora: () => new Date(AGORA),
    googleClientId: '123.apps.googleusercontent.com',
    dominioCorporativo: 'sebratel.com.br',
    verificadorGoogle: {
      async verifyIdToken() {
        return { getPayload: () => ({ email: 'ana@sebratel.com.br', hd: 'sebratel.com.br' }) as never };
      },
    },
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  try {
    const sem = await fetch(`${base}/auth/sessao`);
    assert.equal(sem.status, 200);
    assert.deepEqual(await sem.json(), { logado: false });

    const login = await fetch(`${base}/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ idToken: 'x' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
    assert.deepEqual(await (await fetch(`${base}/auth/sessao`, { headers: { cookie } })).json(), { logado: true });

    barrado = { origem: 'manual', motivo: 'x' };
    assert.deepEqual(await (await fetch(`${base}/auth/sessao`, { headers: { cookie } })).json(), { logado: false });
  } finally {
    servidor.destroi();
    http.closeAllConnections?.();
    await new Promise<void>((ok) => http.close(() => ok()));
  }
});
