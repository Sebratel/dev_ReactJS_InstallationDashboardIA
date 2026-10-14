// O contrato de `backend/specs/_catalog/seguranca.yaml` (docs/PLANO-SEGURANCA.md).
//
// Um bloco de testes por seção, e cada bloco começa com `secao('<nome>')`. O metateste
// lê ESTE arquivo e reprova seção do YAML sem `secao(...)` aqui: spec sem teste é
// decoração. Lê o texto em vez de contar em runtime para continuar valendo quando alguém
// roda só um teste com `--test-name-pattern`.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { TokenPayload } from 'google-auth-library';
import type { EventoDeSeguranca } from '../src/eventos-seguranca.ts';
import { criaAcesso, type LojaDeAcesso } from '../src/permissoes.ts';
import { Servidor } from '../src/servidor.ts';
import { caminhoDaSpecDeSeguranca, leSpecDeSeguranca } from '../src/spec-seguranca.ts';
import { chaveDeColuna, colunasFiltraveis } from '../src/filtros-da-pagina.ts';
import { segmentacaoDe } from '../src/calcula.ts';
import { dataDaPagina } from '../../packages/widget-engine/src/filtros-padrao.ts';
import { loadDashboards } from '../../packages/widget-engine/src/spec.ts';
import { usoDeColunas } from '../../tools/seguranca/src/uso-de-colunas.ts';
import { ACESSO_LIBERADO } from './fixtures/acesso.ts';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const spec = leSpecDeSeguranca(RAIZ);

/** Marca o bloco de testes de uma seção da spec — é o que o metateste procura. */
function secao(nome: keyof typeof spec): void {
  assert.ok(spec[nome], `seção '${nome}' não está em seguranca.yaml`);
}

test('metateste: toda seção de seguranca.yaml tem testes neste arquivo', () => {
  const yaml = parse(fs.readFileSync(caminhoDaSpecDeSeguranca(RAIZ), 'utf8')) as Record<string, unknown>;
  const fonte = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const semTeste = Object.keys(yaml).filter((s) => !fonte.includes(`secao('${s}')`));
  assert.deepEqual(semTeste, [], 'seção sem teste em spec-seguranca.test.ts');
});

// ------------------------------------------------------- S3 — rotas de máquina

/** As `location` ativas do nginx.conf: o modificador, o padrão e o corpo. */
function locationsDoNginx(): { mod: string; padrao: string; corpo: string }[] {
  const conf = fs.readFileSync(path.join(RAIZ, 'nginx.conf'), 'utf8');
  const ativo = conf.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
  return [...ativo.matchAll(/location\s+(=|~\*|~|\^~)?\s*(\S+)\s*\{([^}]*)\}/g)].map((m) => ({
    mod: m[1] ?? '',
    padrao: m[2]!,
    corpo: m[3]!,
  }));
}

/** Para onde o nginx manda `uri` — a mesma precedência dele: `=`, depois o prefixo mais
 *  longo com `^~`, depois a primeira regex, depois o prefixo mais longo. */
function nginxEscolhe(uri: string) {
  const locs = locationsDoNginx();
  const exata = locs.find((l) => l.mod === '=' && l.padrao === uri);
  if (exata) return exata;
  const prefixos = locs
    .filter((l) => (l.mod === '' || l.mod === '^~') && uri.startsWith(l.padrao))
    .sort((a, b) => b.padrao.length - a.padrao.length);
  if (prefixos[0]?.mod === '^~') return prefixos[0];
  const regex = locs.find((l) => (l.mod === '~' || l.mod === '~*') && new RegExp(l.padrao, l.mod === '~*' ? 'i' : '').test(uri));
  return regex ?? prefixos[0];
}

test('S3 nginx: rota de máquina dá 404 na porta pública — com barra final, barra dupla e maiúscula', () => {
  secao('rotas_de_maquina');
  for (const rota of spec.rotas_de_maquina.porta_publica_bloqueia) {
    const [, primeiro, resto] = rota.split('/');
    // O nginx normaliza `//` e o percent-encoding ANTES de escolher a location
    // (`merge_slashes on`, padrão); a api ignora a barra final. Todas têm de cair no 404.
    const variantes = [rota, `${rota}/`, `/${primeiro}//${resto}`, rota.toUpperCase()];
    for (const uri of variantes) {
      const loc = nginxEscolhe(uri.replace(/\/{2,}/g, '/'));
      assert.ok(loc, `nenhuma location para ${uri}`);
      assert.match(loc.corpo, /return 404;/, `${uri} cai em 'location ${loc.mod} ${loc.padrao}', que repassa à api`);
    }
  }
  // E o bloqueio não pega login de gente: estas continuam chegando à api.
  for (const uri of ['/auth/firebase', '/auth/google', '/auth/logout']) {
    assert.match(nginxEscolhe(uri)!.corpo, /proxy_pass/, `${uri} deixou de chegar à api`);
  }
});

test('S3 nginx: toda location que repassa apaga os cabeçalhos internos', () => {
  secao('rotas_de_maquina');
  const repassam = locationsDoNginx().filter((l) => /proxy_pass/.test(l.corpo));
  assert.ok(repassam.length >= 4, `li ${repassam.length} location com proxy_pass`);
  for (const cab of spec.rotas_de_maquina.cabecalhos_apagados_no_proxy) {
    for (const l of repassam) {
      assert.ok(
        l.corpo.includes(`proxy_set_header ${cab} "";`),
        `'location ${l.padrao}' repassa ${cab} do cliente para a api`,
      );
    }
  }
});

async function sobe(tokenInterno: string) {
  const servidor = new Servidor({
    acesso: ACESSO_LIBERADO,
    root: RAIZ,
    snapshotDir: fs.mkdtempSync(path.join(os.tmpdir(), 'api-spec-seg-')),
    webDir: path.join(RAIZ, 'frontend', 'dist'),
    agora: () => new Date('2026-10-14T12:00:00.000Z'),
    tokenInterno,
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    posta: (rota: string, corpo: unknown, cabecalhos: Record<string, string> = {}) =>
      fetch(`http://127.0.0.1:${port}${rota}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...cabecalhos },
        body: JSON.stringify(corpo),
      }),
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.close(() => ok());
      }),
  };
}

test('S3 api: rota de máquina pelo proxy (com X-Real-IP) é 404 — mesmo com o token CERTO', async () => {
  secao('rotas_de_maquina');
  const s = await sobe('segredo-de-teste');
  try {
    for (const rota of spec.rotas_de_maquina.porta_publica_bloqueia) {
      for (const variante of [rota, `${rota}/`]) {
        const r = await s.posta(variante, { token: 'segredo-de-teste' }, { 'X-Real-IP': '10.0.0.7' });
        assert.equal(r.status, 404, variante);
        assert.equal(r.headers.get('set-cookie'), null, `${variante} criou sessão pelo proxy`);
      }
    }
  } finally {
    await s.fecha();
  }
});

test('S3 api: direto na porta local (sem X-Real-IP) a ferramenta continua logando', async () => {
  secao('rotas_de_maquina');
  const s = await sobe('segredo-de-teste');
  try {
    const r = await s.posta('/auth/interno', { token: 'segredo-de-teste' });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie') ?? '', /^sessao=/);
  } finally {
    await s.fecha();
  }
});

test('S3 bundle: segredo de dev só entra no `vite dev` — config.ts, vite.config.ts e o canário do CI', () => {
  secao('rotas_de_maquina');
  const le = (...p: string[]) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
  const config = le('frontend', 'src', 'config.ts');
  const vite = le('frontend', 'vite.config.ts');
  const ci = parse(le('.github', 'workflows', 'ci.yml')) as {
    jobs: Record<string, { steps: { env?: Record<string, string>; run?: string }[] }>;
  };
  const passos = Object.values(ci.jobs).flatMap((j) => j.steps);

  for (const { ambiente, na_tela } of spec.rotas_de_maquina.bundle_so_em_dev) {
    // 1. A tela só lê atrás de `import.meta.env.DEV` — no build o ramo some.
    const leituras = config.split(/\r?\n/).filter((l) => l.includes(`import.meta.env.${na_tela}`));
    assert.ok(leituras.length > 0, `${na_tela} não é lida em config.ts — tire-a da spec ou leia-a lá`);
    for (const linha of leituras) {
      assert.match(linha, /import\.meta\.env\.DEV\s*\?/, `${na_tela} lida sem a guarda de DEV: ${linha.trim()}`);
    }
    // 2. O Vite só injeta o valor no servidor de desenvolvimento.
    const define = vite.split(/\r?\n/).find((l) => l.includes(`'import.meta.env.${na_tela}'`));
    assert.ok(define, `vite.config.ts não define import.meta.env.${na_tela}`);
    assert.match(define, /command === 'serve' \?/, `vite.config.ts injeta ${na_tela} também no build`);
    // 3. O CI builda com um canário na variável de ambiente, SEM provedor (o pior caso),
    //    e procura o canário no bundle.
    const passo = passos.find((p) => p.env?.[ambiente] !== undefined && /web:build/.test(p.run ?? ''));
    assert.ok(passo, `o CI não builda a tela com canário em ${ambiente}`);
    assert.ok(passo.run!.includes(`grep -rl "${passo.env![ambiente]}" frontend/dist`), `o CI não procura o canário de ${ambiente}`);
    for (const provedor of ['VITE_FIREBASE_PROJECT_ID', 'VITE_GOOGLE_CLIENT_ID']) {
      assert.equal(passo.env![provedor], undefined, `com ${provedor} no passo, o canário não testa o pior caso`);
    }
  }
});

// ------------------------------------------------------------------ S2 — sessão

const HORA = 3_600_000;
const MIN = 60_000;
const T0 = Date.parse('2026-10-14T08:00:00.000Z');

/** Servidor com login de pessoa DE VERDADE (`/auth/google`, verificador injetado: o
 *  idToken é o próprio e-mail) — a política de sessão é o sujeito, não pode ser trocada. */
async function sobeComLogin(opts: { sessaoTtlHoras?: number; confiaNoProxy?: boolean } = {}) {
  const relogio = { ms: T0 };
  const eventos: EventoDeSeguranca[] = [];
  const loja: LojaDeAcesso = {
    le: async () => ({ papeis: [], telas: [], emails: [], pedidos: [] }),
    aplica: async () => {},
    registraPedido: async () => {},
  };
  const acesso = criaAcesso({
    loja,
    telasConhecidas: [],
    adminsDoAmbiente: ['chefe@sebratel.com.br'],
    devsDoAmbiente: ['dev@sebratel.com.br'],
    dominio: 'sebratel.com.br',
    log: () => {},
  });
  await acesso.recarrega();
  const servidor = new Servidor({
    acesso,
    root: RAIZ,
    snapshotDir: fs.mkdtempSync(path.join(os.tmpdir(), 'api-spec-sessao-')),
    webDir: path.join(RAIZ, 'frontend', 'dist'),
    agora: () => new Date(relogio.ms),
    googleClientId: 'cliente-de-teste',
    verificadorGoogle: {
      verifyIdToken: async ({ idToken }) => ({ getPayload: () => ({ email: idToken, hd: 'sebratel.com.br' }) as TokenPayload }),
    },
    eventosDeSeguranca: { registra: (e) => eventos.push(e), descarrega: async () => {}, para: () => {} },
    ...(opts.sessaoTtlHoras !== undefined ? { sessaoTtlHoras: opts.sessaoTtlHoras } : {}),
    ...(opts.confiaNoProxy !== undefined ? { confiaNoProxy: opts.confiaNoProxy } : {}),
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    relogio,
    eventos,
    /** Loga `email` e devolve o cabeçalho Cookie e o Set-Cookie cru. */
    loga: async (email: string, cabecalhos: Record<string, string> = {}) => {
      const r = await fetch(`${base}/auth/google`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...cabecalhos },
        body: JSON.stringify({ idToken: email }),
      });
      assert.equal(r.status, 200, `login de ${email}`);
      const setCookie = r.headers.get('set-cookie') ?? '';
      return { cookie: setCookie.split(';')[0]!, setCookie };
    },
    /** Status de um GET autenticado — 200 com sessão viva, 401 sem. */
    status: async (cookie: string, rota = '/api/dashboards', cabecalhos: Record<string, string> = {}) =>
      (await fetch(`${base}${rota}`, { headers: { cookie, ...cabecalhos } })).status,
    posta: (cookie: string, rota: string, corpo: unknown, origem: string | null = base) =>
      fetch(`${base}${rota}`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', ...(origem ? { origin: origem } : {}) },
        body: JSON.stringify(corpo),
      }),
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.close(() => ok());
      }),
  };
}

test('S2 ttl: o cookie vale o ttl da spec, e SESSAO_TTL_HORAS só encurta', async () => {
  secao('sessao');
  const maxAge = (setCookie: string) => Number(/Max-Age=(\d+)/.exec(setCookie)?.[1]);
  for (const [pedido, esperado] of [
    [undefined, spec.sessao.ttl_horas],
    [spec.sessao.ttl_horas * 3, spec.sessao.ttl_horas],
    [1, 1],
    [Number.NaN, spec.sessao.ttl_horas],
  ] as const) {
    const s = await sobeComLogin(pedido === undefined ? {} : { sessaoTtlHoras: pedido });
    try {
      assert.equal(maxAge((await s.loga('fulano@sebratel.com.br')).setCookie), esperado * 3600, `pedido ${pedido}`);
    } finally {
      await s.fecha();
    }
  }
});

test('S2 ttl: usada sem parar, a sessão morre no vencimento absoluto', async () => {
  secao('sessao');
  const s = await sobeComLogin();
  try {
    const { cookie } = await s.loga('fulano@sebratel.com.br');
    const passo = Math.min(spec.sessao.ociosidade_minutos - 1, 60) * MIN;
    while (s.relogio.ms + passo < T0 + spec.sessao.ttl_horas * HORA) {
      s.relogio.ms += passo;
      assert.equal(await s.status(cookie), 200, `viva em +${(s.relogio.ms - T0) / MIN} min`);
    }
    s.relogio.ms = T0 + spec.sessao.ttl_horas * HORA + MIN;
    assert.equal(await s.status(cookie), 401);
  } finally {
    await s.fecha();
  }
});

test('S2 ociosidade: sem uso pelo tempo da spec a sessão morre; usada antes, renova', async () => {
  secao('sessao');
  const s = await sobeComLogin();
  try {
    const { cookie } = await s.loga('fulano@sebratel.com.br');
    s.relogio.ms += (spec.sessao.ociosidade_minutos - 1) * MIN;
    assert.equal(await s.status(cookie), 200, 'um minuto antes do limite ainda vale');
    s.relogio.ms += (spec.sessao.ociosidade_minutos - 1) * MIN;
    assert.equal(await s.status(cookie), 200, 'o uso anterior renovou a janela');
    s.relogio.ms += (spec.sessao.ociosidade_minutos + 1) * MIN;
    assert.equal(await s.status(cookie), 401, 'parada além do limite, morre');
    s.relogio.ms += MIN;
    assert.equal(await s.status(cookie), 401, 'e não volta');
  } finally {
    await s.fecha();
  }
});

test('S2 troca de IP: o mesmo cookie de outro IP segue valendo e grava sessao_ip_mudou uma vez', async () => {
  secao('sessao');
  const s = await sobeComLogin({ confiaNoProxy: true });
  try {
    const { cookie } = await s.loga('fulano@sebratel.com.br', { 'X-Real-IP': '10.0.0.1' });
    assert.equal(await s.status(cookie, '/api/dashboards', { 'X-Real-IP': '10.0.0.1' }), 200);
    assert.equal(s.eventos.filter((e) => e.tipo === 'sessao_ip_mudou').length, 0);
    assert.equal(await s.status(cookie, '/api/dashboards', { 'X-Real-IP': '10.0.0.2' }), 200, 'registra, não derruba');
    assert.equal(await s.status(cookie, '/api/dashboards', { 'X-Real-IP': '10.0.0.2' }), 200);
    const mudou = s.eventos.filter((e) => e.tipo === 'sessao_ip_mudou');
    assert.equal(mudou.length, 1, 'um evento por troca, não por pedido');
    assert.equal(mudou[0]!.email, 'fulano@sebratel.com.br');
    assert.equal(mudou[0]!.ip, '10.0.0.2');
    assert.match(mudou[0]!.motivo ?? '', /10\.0\.0\.1/);
  } finally {
    await s.fecha();
  }
});

test('S2 remover pessoa na tela "Acessos" derruba as sessões dela na hora', async () => {
  secao('sessao');
  const s = await sobeComLogin();
  try {
    const chefe = await s.loga('chefe@sebratel.com.br');
    const fulano = await s.loga('fulano@sebratel.com.br');
    assert.equal(await s.status(fulano.cookie), 200);
    const r = await s.posta(chefe.cookie, '/api/admin/acessos/remove', { email: 'Fulano@Sebratel.com.br' });
    assert.equal(r.status, 200);
    assert.equal(await s.status(fulano.cookie), 401, 'a pessoa removida continuava logada');
    assert.equal(await s.status(chefe.cookie), 200, 'derrubou a sessão de quem removeu');
    assert.ok(s.eventos.some((e) => e.tipo === 'sessao_derrubada' && e.email === 'fulano@sebratel.com.br'));
  } finally {
    await s.fecha();
  }
});

test('S2 /api/admin/sessoes: só admin vê e derruba; a lista nunca traz o token; POST sem Origin é 403', async () => {
  secao('sessao');
  const s = await sobeComLogin();
  try {
    const chefe = await s.loga('chefe@sebratel.com.br');
    const dev = await s.loga('dev@sebratel.com.br');
    const fulano = await s.loga('fulano@sebratel.com.br');

    for (const quem of [fulano, dev]) {
      assert.equal(await s.status(quem.cookie, '/api/admin/sessoes'), 403);
      assert.equal((await s.posta(quem.cookie, '/api/admin/sessoes/derruba', { email: 'chefe@sebratel.com.br' })).status, 403);
    }
    assert.equal(await s.status(chefe.cookie), 200, 'dev e viewer não derrubaram o admin');

    const r = await fetch(`${s.base}/api/admin/sessoes`, { headers: { cookie: chefe.cookie } });
    assert.equal(r.status, 200);
    const texto = await r.text();
    const tokenDoFulano = fulano.cookie.split('=')[1]!;
    assert.ok(!texto.includes(tokenDoFulano), 'a lista de sessões expôs o token');
    const { sessoes } = JSON.parse(texto) as { sessoes: { usuario: string; ip: string | null }[] };
    assert.deepEqual(sessoes.map((x) => x.usuario).sort(), ['chefe@sebratel.com.br', 'dev@sebratel.com.br', 'fulano@sebratel.com.br']);

    assert.equal((await s.posta(chefe.cookie, '/api/admin/sessoes/derruba', { email: 'fulano@sebratel.com.br' }, null)).status, 403);
    assert.equal(await s.status(fulano.cookie), 200, 'o POST recusado por CSRF não pode ter derrubado');

    const derruba = await s.posta(chefe.cookie, '/api/admin/sessoes/derruba', { email: 'FULANO@sebratel.com.br' });
    assert.equal(derruba.status, 200);
    assert.equal((await derruba.json()).derrubadas, 1);
    assert.equal(await s.status(fulano.cookie), 401);
    assert.equal((await s.posta(chefe.cookie, '/api/admin/sessoes/derruba', {})).status, 400);
  } finally {
    await s.fecha();
  }
});

// ---------------------------------------------------------------- S5 — filtros

const FILTRO_FORA = { tabela: 'CONTRATOS', coluna: 'CPF/CNPJ', valores: ['000'] };
const filtroNaUrl = (f: object) => `filtro=${encodeURIComponent(JSON.stringify(f))}`;

test('S5 derivação: toda segmentação e toda data padrão de cada aba é filtrável; coluna alheia não', () => {
  secao('filtros');
  const paginas = loadDashboards(path.join(RAIZ, 'backend', 'specs'));
  assert.ok(paginas.length >= 10, `li ${paginas.length} páginas`);
  let segmentacoes = 0;
  for (const p of paginas) {
    const filtraveis = colunasFiltraveis(p);
    for (const v of p.visuals ?? []) {
      const s = segmentacaoDe(v);
      if (!s) continue;
      segmentacoes++;
      assert.ok(filtraveis.has(chaveDeColuna(s.tabela, s.coluna)), `${p.id}: segmentação ${s.tabela}[${s.coluna}] recusada`);
    }
    const data = dataDaPagina(p.id);
    if (data) assert.ok(filtraveis.has(chaveDeColuna(data.tabela, data.coluna)), `${p.id}: a data padrão seria recusada`);
    assert.ok(!filtraveis.has(chaveDeColuna(FILTRO_FORA.tabela, FILTRO_FORA.coluna)), `${p.id} aceitaria CPF/CNPJ`);
  }
  assert.ok(segmentacoes > 10, `só ${segmentacoes} segmentações no modelo inteiro`);
});

async function sobeParaFiltro(modoDosFiltros?: 'observar' | 'bloquear') {
  const eventos: EventoDeSeguranca[] = [];
  const servidor = new Servidor({
    acesso: ACESSO_LIBERADO,
    root: RAIZ,
    snapshotDir: fs.mkdtempSync(path.join(os.tmpdir(), 'api-spec-filtro-')),
    webDir: path.join(RAIZ, 'frontend', 'dist'),
    agora: () => new Date('2026-10-14T12:00:00.000Z'),
    eventosDeSeguranca: { registra: (e) => eventos.push(e), descarrega: async () => {}, para: () => {} },
    ...(modoDosFiltros ? { modoDosFiltros } : {}),
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    eventos,
    status: async (q: string) => (await fetch(`http://127.0.0.1:${port}/api/dashboards/visao-geral?${q}`)).status,
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.close(() => ok());
      }),
  };
}

const DENTRO = () => {
  const d = dataDaPagina('visao-geral')!;
  return { tabela: d.tabela, coluna: d.coluna, valores: ['2026'] };
};

test('S5 observar (o modo da spec): filtro de fora passa e grava um evento por pessoa, aba e coluna', async () => {
  secao('filtros');
  assert.equal(spec.filtros.modo, 'observar', 'ao passar para bloquear, troque este teste pelo de baixo');
  const s = await sobeParaFiltro();
  try {
    assert.notEqual(await s.status(filtroNaUrl(DENTRO())), 400);
    assert.equal(s.eventos.filter((e) => e.tipo === 'filtro_fora_da_pagina').length, 0, 'filtro da própria aba não é evento');

    assert.notEqual(await s.status(filtroNaUrl(FILTRO_FORA)), 400, 'observar não bloqueia');
    assert.notEqual(await s.status(`${filtroNaUrl(DENTRO())}&${filtroNaUrl(FILTRO_FORA)}`), 400);
    const fora = s.eventos.filter((e) => e.tipo === 'filtro_fora_da_pagina');
    assert.equal(fora.length, 1, 'o mesmo trio repetido grava uma vez só');
    assert.equal(fora[0]!.motivo, 'CONTRATOS[CPF/CNPJ]');
    assert.equal(fora[0]!.rota, '/api/dashboards/visao-geral');
    assert.ok(!JSON.stringify(fora[0]).includes('000'), 'o VALOR do filtro não vai para o evento');
  } finally {
    await s.fecha();
  }
});

test('S5 bloquear: filtro de fora é 400; o da própria aba segue', async () => {
  secao('filtros');
  const s = await sobeParaFiltro('bloquear');
  try {
    assert.equal(await s.status(filtroNaUrl(FILTRO_FORA)), 400);
    assert.equal(await s.status(`${filtroNaUrl(DENTRO())}&${filtroNaUrl(FILTRO_FORA)}`), 400);
    assert.notEqual(await s.status(filtroNaUrl(DENTRO())), 400);
  } finally {
    await s.fecha();
  }
});

// ------------------------------------------------------- S6 — dados sensíveis

type SpecDeTabela = { name: string; query_ref?: string | null; columns?: { name: string }[] };

const tabelasDoModelo = (): SpecDeTabela[] => {
  const dir = path.join(RAIZ, 'backend', 'specs', '_catalog', 'tables');
  return fs.readdirSync(dir).map((f) => parse(fs.readFileSync(path.join(dir, f), 'utf8')) as SpecDeTabela);
};
const queryDe = (id: string) =>
  parse(fs.readFileSync(path.join(RAIZ, 'backend', 'specs', '_catalog', 'queries', `${id}.spec.yaml`), 'utf8')) as {
    sql?: string | null;
    m_expression?: string | null;
  };
const mesma = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

test('S6 inventário fechado: toda coluna com nome de dado pessoal está classificada', () => {
  secao('dados_sensiveis');
  const { padrao_de_nome, colunas } = spec.dados_sensiveis;
  const soltas = tabelasDoModelo().flatMap((t) =>
    (t.columns ?? [])
      .filter((c) => padrao_de_nome.test(c.name))
      .filter((c) => !colunas.some((s) => mesma(s.tabela, t.name) && mesma(s.coluna, c.name)))
      .map((c) => `${t.name}[${c.name}]`),
  );
  assert.deepEqual(soltas, [], 'coluna pessoal fora de seguranca.yaml § dados_sensiveis.colunas');
});

test('S6 coluna pessoal que fica no modelo tem uso — ou uma exceção que ainda se justifica', () => {
  secao('dados_sensiveis');
  const uso = usoDeColunas(RAIZ);
  const tabelas = tabelasDoModelo();
  const semUso: string[] = [];
  const excecaoVencida: string[] = [];
  for (const s of spec.dados_sensiveis.colunas) {
    const t = tabelas.find((x) => mesma(x.name, s.tabela));
    if (!t?.columns?.some((c) => mesma(c.name, s.coluna))) continue;
    const usada = uso(s.tabela, s.coluna).length > 0;
    if (!usada && !s.excecao) semUso.push(`${s.tabela}[${s.coluna}]`);
    if (usada && s.excecao) excecaoVencida.push(`${s.tabela}[${s.coluna}]`);
  }
  assert.deepEqual(semUso, [], 'dado pessoal carregado sem uso — tire da query (ou registre a exceção)');
  assert.deepEqual(excecaoVencida, [], 'a coluna passou a ter uso: a exceção não se justifica mais, tire-a');
});

test('S6 coluna removida saiu da tabela, do sql: e do SQL de origem do M', () => {
  secao('dados_sensiveis');
  const tabelas = tabelasDoModelo();
  for (const s of spec.dados_sensiveis.colunas.filter((c) => c.removida_em)) {
    const t = tabelas.find((x) => mesma(x.name, s.tabela));
    assert.ok(t, `${s.tabela}: tabela não existe no modelo`);
    assert.ok(!t.columns?.some((c) => mesma(c.name, s.coluna)), `${s.tabela}[${s.coluna}] voltou para a spec da tabela`);
    const q = queryDe(t.query_ref!);
    assert.ok(!(q.sql ?? '').includes(`"${s.coluna}"`), `${s.tabela}[${s.coluna}] continua no sql: de ${t.query_ref}`);
    assert.ok(!(q.m_expression ?? '').includes(`""${s.coluna}""`), `${s.tabela}[${s.coluna}] continua no SQL do M de ${t.query_ref}`);
  }
});

test('S6 toda coluna classificada existe no modelo ou está marcada como removida', () => {
  secao('dados_sensiveis');
  const tabelas = tabelasDoModelo();
  const fantasmas = spec.dados_sensiveis.colunas
    .filter((s) => !s.removida_em)
    .filter((s) => !tabelas.some((t) => mesma(t.name, s.tabela) && t.columns?.some((c) => mesma(c.name, s.coluna))))
    .map((s) => `${s.tabela}[${s.coluna}]`);
  assert.deepEqual(fantasmas, [], 'classificada mas inexistente — erro de digitação, ou faltou `removida_em`');
});
