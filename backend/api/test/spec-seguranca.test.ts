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
import { Servidor } from '../src/servidor.ts';
import { caminhoDaSpecDeSeguranca, leSpecDeSeguranca } from '../src/spec-seguranca.ts';
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
