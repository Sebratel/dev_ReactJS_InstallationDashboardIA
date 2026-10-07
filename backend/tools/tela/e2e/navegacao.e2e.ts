// E2E da tela — fase 5 de `docs/PLANO-PADROES-FRONTEND.md`. `npm run e2e`.
//
// Roda contra uma stack NO AR (padrão: a tela em http://localhost, a API em
// http://localhost:3100; `E2E_BASE` e `E2E_API` trocam) e com o `TOKEN_INTERNO` do
// `.env` para entrar. Fica FORA do `npm test` de propósito: depende de servidor e de
// dado vivo. Sem a tela no ar, os testes são pulados com o motivo, em vez de falhar.
//
// O que cobre é o que só se vê com o navegador de verdade: a URL como estado da tela
// (fase 3) — empilhar e substituir no histórico, voltar e avançar, recarregar, o
// marcador `limpo` —, a árvore de período mandando duas mudanças num clique, a busca da
// tabela virando pedido, e o console sem erro.
//
// ORÇAMENTO: a API limita `/api/*` por IP em janela FIXA de um minuto (300 interativos e
// 600 de `origem=prefetch`, `servidor.ts`), e atrás do proxy da stack todo navegador
// local é o mesmo IP. Uma execução abre a tela 8 vezes e gasta ~275 interativos em ~30 s
// (o último teste imprime o gasto): RODE UMA VEZ POR MINUTO, sem outra aba aberta na
// tela — senão o 429 aparece como falha da navegação (ACHADOS #182).
//
// REGRA DE SAÍDA: nunca imprime valor de linha, só contagens, URLs de filtro e status.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { applyDotEnv } from '../../../packages/query-engine/src/config.ts';
import { logaComoFerramenta } from '../src/login-interno.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
applyDotEnv(REPO);
const BASE = process.env.E2E_BASE ?? 'http://localhost';
const API = process.env.E2E_API ?? 'http://localhost:3100';
const PAGINA = 'agendamento-field';

const noAr = await fetch(BASE, { signal: AbortSignal.timeout(5000) })
  .then((r) => r.ok)
  .catch(() => false);
const pula = noAr ? false : `a tela não respondeu em ${BASE} — suba a stack (ou aponte E2E_BASE)`;

let browser: Browser;
let page: Page;
const erros: string[] = [];
const negados: string[] = [];
const gastos = { interativos: 0, prefetch: 0 };

before(async () => {
  if (!noAr) return;
  const cookie = await logaComoFerramenta(API);
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await ctx.addCookies([{ ...cookie, url: BASE }]);
  // Modo conferência: a faixa dele diz quantos filtros a tela aplicou.
  await ctx.addInitScript(() => localStorage.setItem('modo-conferencia', '1'));
  page = await ctx.newPage();
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/')) return;
    if (u.searchParams.get('origem') === 'prefetch') gastos.prefetch++;
    else gastos.interativos++;
  });
  page.on('console', (m) => {
    if (m.type() === 'error') erros.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => erros.push(String(e).slice(0, 200)));
  // O console só diz "429"; aqui fica QUAL pedido foi negado (rota e origem, sem valores).
  page.on('response', (r) => {
    if (r.status() < 400) return;
    const u = new URL(r.url());
    negados.push(`${r.status()} ${u.pathname} origem=${u.searchParams.get('origem') ?? '-'}`);
  });
});
after(async () => {
  await browser?.close();
});

const busca = () => decodeURIComponent(new URL(page.url()).search.replaceAll('+', ' '));
const historico = () => page.evaluate(() => history.length);
/** Quantos filtros a tela aplicou — a faixa do modo conferência. */
const filtrosNaTela = async () => {
  const selos = await page.locator('[data-selo="neutro"]').allTextContents();
  return Number(selos.find((t) => /segmenta/.test(t))?.match(/[0-9]+/)?.[0] ?? 0);
};
const abre = async (url: string) => {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-selo]', { timeout: 90_000 });
  await page.waitForTimeout(1200);
};

test('abre no filtro padrão, com a URL limpa', { skip: pula }, async () => {
  await abre(`${BASE}/?pagina=${PAGINA}`);
  assert.equal(busca(), `?pagina=${PAGINA}`);
  assert.ok((await filtrosNaTela()) > 0, 'a página abre com o período padrão aplicado');
});

test('chip: entra na URL e SUBSTITUI no histórico; limpar volta à URL limpa', { skip: pula }, async () => {
  await abre(`${BASE}/?pagina=${PAGINA}`);
  const antes = await historico();
  const chips = page.getByRole('group', { name: /tipo de protocolo/i });
  await chips.getByRole('button').first().click();
  await page.waitForTimeout(1500);
  assert.match(busca(), /TIPO DE PROTOCOLO/);
  assert.equal(await historico(), antes);
  await chips.getByRole('button', { name: 'limpar' }).click();
  await page.waitForTimeout(1500);
  assert.equal(busca(), `?pagina=${PAGINA}`);
});

test('clique cruzado: EMPILHA; voltar desfaz, avançar refaz, recarregar mantém', { skip: pula }, async () => {
  await abre(`${BASE}/?pagina=${PAGINA}`);
  const padrao = await filtrosNaTela();
  const antes = await historico();
  const url = busca();
  await page.locator('.clicavel').first().click();
  await page.waitForTimeout(2000);
  assert.match(busca(), /clicado=/);
  assert.equal(await historico(), antes + 1);
  await page.goBack();
  await page.waitForTimeout(2000);
  assert.equal(busca(), url);
  assert.equal(await filtrosNaTela(), padrao, 'a tela acompanha o voltar');
  await page.goForward();
  await page.waitForTimeout(2000);
  const comClique = busca();
  assert.match(comClique, /clicado=/);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-selo]', { timeout: 90_000 });
  await page.waitForTimeout(1200);
  assert.equal(busca(), comClique);
  assert.equal(await filtrosNaTela(), padrao + 1);
});

test('limpo=1 abre sem filtro nenhum e continua dizendo limpo', { skip: pula }, async () => {
  await abre(`${BASE}/?pagina=${PAGINA}&limpo=1`);
  assert.equal(await filtrosNaTela(), 0);
  assert.match(busca(), /limpo=1/);
});

test('trocar de aba SUBSTITUI; sem página na URL, abre uma', { skip: pula }, async () => {
  await abre(`${BASE}/?pagina=${PAGINA}`);
  const antes = await historico();
  await page
    .getByRole('navigation', { name: 'Telas do relatório' })
    .getByRole('button', { name: /vis[aã]o geral/i })
    .first()
    .click();
  await page.waitForSelector('[data-selo]', { timeout: 90_000 });
  assert.match(busca(), /pagina=visao-geral/);
  assert.equal(await historico(), antes);
  await abre(`${BASE}/`);
  assert.match(busca(), /pagina=/);
});

test('árvore de período: um dia de mês não marcado manda DIA e MÊS, e os dois ficam', { skip: pula }, async () => {
  await abre(`${BASE}/?pagina=${PAGINA}`);
  await page.locator('button[aria-haspopup="dialog"]').first().click();
  await page.waitForSelector('[role="dialog"] [data-nivel="mes"]', { timeout: 30_000 });
  // As setas medem 16×8 px e o Playwright as acha "invisíveis": o clique vai pelo DOM.
  // Os ganchos são `data-nivel` e `aria-expanded`, não classe de estilo.
  await page.evaluate(() => {
    const meses = [...document.querySelectorAll('[role="dialog"] [data-nivel="mes"]')];
    const caixa = (m: Element) => m.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const naoMarcado = meses.find((m) => !caixa(m).checked);
    (naoMarcado!.querySelector('button[aria-expanded]') as HTMLElement).click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() =>
    (document.querySelector('[role="dialog"] [data-nivel="dias"] input') as HTMLElement).click(),
  );
  await page.waitForTimeout(800);
  assert.match(busca(), /"nivel":"Dia"/);
  assert.match(busca(), /"nivel":"Mês"/);
  await page.getByRole('dialog').getByRole('button', { name: 'Aplicar' }).click();
});

test('a busca da tabela vira pedido, e limpar volta à janela sem busca', { skip: pula }, async () => {
  await abre(`${BASE}/?pagina=${PAGINA}`);
  const termos: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/dashboards/') && u.searchParams.has('linhas')) {
      termos.push(u.searchParams.get('busca') ?? '');
    }
  });
  const campo = page.locator('.tabela-busca-input').first();
  await campo.scrollIntoViewIfNeeded();
  await campo.fill('instala');
  await page.waitForTimeout(3000);
  assert.ok(termos.includes('instala'), 'o termo vira pedido depois da espera');
  await campo.fill('');
  await page.waitForTimeout(3000);
  assert.equal(termos.at(-1), '');
});

test('o console terminou sem erro', { skip: pula }, (t) => {
  t.diagnostic(`pedidos a /api nesta execução: ${JSON.stringify(gastos)}`);
  const contagem = new Map<string, number>();
  for (const n of negados) contagem.set(n, (contagem.get(n) ?? 0) + 1);
  assert.deepEqual(erros, [], `pedidos negados: ${JSON.stringify([...contagem])}`);
});
