#!/usr/bin/env node
// A régua de estilo: prova que uma refatoração de CSS não mudou a tela (fase 6 de
// `docs/PLANO-PADROES-FRONTEND.md`, ACHADOS #183).
//
//   npm run tela:regua -- grava   <baseURL> <api.har>            (API no ar)
//   npm run tela:regua -- mede    <baseURL> <api.har> <pasta>    (só o HAR)
//   npm run tela:regua -- compara <pastaA> <pastaB> [--valores]
//
// O HTML muda de propósito (as classes); o que não pode mudar é o ESTILO COMPUTADO de
// cada elemento, identificado pela posição na árvore. `mede` registra, em 14 páginas ×
// claro/escuro × 1366/1920/1024/390 (as duas últimas exercitam os `@media` que as
// resoluções de referência não alcançam): todas as propriedades computadas,
// `::before`/`::after`, o `:hover` forçado (CDP) em todo elemento com cursor de mão a 1366,
// os diálogos de filtro (período, período com a grade de dias, lista), os estados
// forçados a 1366 (página abrindo, visual carregando e visual que falhou — a tela
// carregada não os mostra) e a tela de login (todo `/api` respondendo 401).
//
// Receita: build A e build B, os dois servidos na MESMA origem (o HAR casa host e porta —
// `vite preview --outDir <build> --port 4173`); `grava` uma vez contra A com a API no ar;
// `mede` A duas vezes (o ruído) e B uma; `compara`. Confira o nome do pacote servido antes
// de medir: parar o `vite preview` em segundo plano pode deixar o processo antigo na porta.
//
// DADO DE CLIENTE: o HAR guarda as respostas da API. Fica FORA do repositório (o padrão é
// a pasta temporária do sistema) e é apagado depois. As medições guardam só estilo, tag e
// classe; a saída nunca imprime valor de dado.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { applyDotEnv } from '../../../packages/query-engine/src/config.ts';
import { loadDashboards } from '../../../packages/widget-engine/src/spec.ts';
import { logaComoFerramenta } from './login-interno.ts';
import {
  comparaMedicao,
  novaComparacao,
  recortaAbertura,
  type Linha,
  type Medicao,
} from './regua-avalia.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const API = /\/api\/(?!eventos)/;
const TAMANHOS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];
/** Gravando, a API de verdade limita 300 interativos/min por IP (ACHADOS #182): um 429
 *  gravado no HAR envenena a régua. ~35 pedidos por página → 8 s entre páginas. */
const PAUSA_GRAVANDO_MS = 8000;

const [modo, ...args] = process.argv.slice(2);

if (modo === 'compara') {
  const [A, B] = args.filter((a) => !a.startsWith('--')) as [string, string];
  const valores = args.includes('--valores');
  const le = (d: string, f: string) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
  const eA = le(A, 'estilos.json');
  const eB = le(B, 'estilos.json');
  const c = novaComparacao();
  const arquivos = fs.readdirSync(A).filter((f) => f.endsWith('.json') && f !== 'estilos.json');
  for (const f of arquivos.sort()) {
    if (!fs.existsSync(path.join(B, f))) c.estrutura.push(`${f}: só em ${A}`);
    else comparaMedicao(c, f.replace('.json', ''), le(A, f), le(B, f), eA, eB, valores);
  }
  console.log(
    `${arquivos.length} medições; ${c.elementos} elementos, ${c.iguais} idênticos, ` +
      `${c.elementos - c.iguais} diferentes`,
  );
  for (const e of c.estrutura.slice(0, 30)) console.log(`ESTRUTURA ${e}`);
  const grupos = [...c.diferencas].sort((x, y) => y[1].n - x[1].n);
  for (const [chave, d] of grupos.slice(0, 40)) {
    console.log(`${d.n}× ${chave}\n    ${[...d.props].slice(0, 12).join(' | ')}`);
    console.log(`    em ${d.onde.size} medições, ex.: ${[...d.onde].slice(0, 3).join(', ')}`);
  }
  process.exit(c.elementos === c.iguais && !c.estrutura.length ? 0 : 1);
}

if (modo !== 'grava' && modo !== 'mede') {
  console.error('uso: regua.ts grava <base> <har> | mede <base> <har> <pasta> | compara <A> <B>');
  process.exit(2);
}
const [BASE, HAR, SAIDA] = args as [string, string, string | undefined];
if (!BASE || !HAR || (modo === 'mede' && !SAIDA)) {
  console.error('faltam argumentos — veja o cabeçalho de regua.ts');
  process.exit(2);
}
/** `REGUA_PAGINAS=capa,l-tec` restringe as páginas (ex.: medir o ruído de uma só). */
const PAGINAS = loadDashboards(path.join(ROOT, 'backend', 'specs'))
  .map((d) => d.id)
  .filter((id) => !process.env.REGUA_PAGINAS || process.env.REGUA_PAGINAS.split(',').includes(id));

const estilos = new Map<string, string>();
const guarda = (s: string) => {
  if (!s) return '';
  const h = crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
  estilos.set(h, s);
  return h;
};

/** Roda NA PÁGINA: [caminho, tag.classes, estilo, ::before, ::after] da subárvore. */
function despeja(raizSel: string): Linha[] {
  const css = (cs: CSSStyleDeclaration) => {
    const out: string[] = [];
    for (let i = 0; i < cs.length; i++) {
      const n = cs[i]!;
      if (!n.startsWith('--')) out.push(n + ':' + cs.getPropertyValue(n));
    }
    return out.join(';');
  };
  const linhas: Linha[] = [];
  const anda = (el: Element, cam: string) => {
    const pseudo = (p: string) => {
      const c = getComputedStyle(el, p);
      return c.content === 'none' || c.content === 'normal' ? '' : css(c);
    };
    const rotulo = el.tagName.toLowerCase() + '.' + [...el.classList].join('.');
    linhas.push([cam, rotulo, css(getComputedStyle(el)), pseudo('::before'), pseudo('::after')]);
    [...el.children].forEach((f, i) => anda(f, cam + '/' + f.tagName.toLowerCase() + i));
  };
  const raiz = document.querySelector(raizSel);
  if (raiz) anda(raiz, raizSel);
  return linhas;
}

const comHash = (ls: Linha[]): Linha[] =>
  ls.map(([c, t, e, b, a]) => [c, t, guarda(e), guarda(b), guarda(a)]);

/** O `:hover` forçado em todo elemento com cursor de mão: [caminho, estilo] da subárvore. */
async function hovers(ctx: BrowserContext, page: Page): Promise<[string, string][]> {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const caminhos: string[] = await page.evaluate(() => {
    const out: string[] = [];
    const anda = (el: Element, cam: string) => {
      if (getComputedStyle(el).cursor === 'pointer') {
        el.setAttribute('data-regua-hover', String(out.length));
        out.push(cam);
      }
      [...el.children].forEach((f, i) => anda(f, cam + '/' + f.tagName.toLowerCase() + i));
    };
    anda(document.body, 'body');
    return out;
  });
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
    nodeId: root.nodeId,
    selector: '[data-regua-hover]',
  });
  const out: [string, string][] = [];
  for (const nodeId of nodeIds) {
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
    const { attributes } = await cdp.send('DOM.getAttributes', { nodeId });
    const i = Number(attributes[attributes.indexOf('data-regua-hover') + 1]);
    const sub = await page.evaluate(
      ([sel, cam]) => {
        const css = (cs: CSSStyleDeclaration) => {
          const o: string[] = [];
          for (let k = 0; k < cs.length; k++) {
            const p = cs[k]!;
            if (!p.startsWith('--')) o.push(p + ':' + cs.getPropertyValue(p));
          }
          return o.join(';');
        };
        const fora: [string, string][] = [];
        const anda = (e: Element, c: string) => {
          fora.push([c, css(getComputedStyle(e))]);
          [...e.children].forEach((f, j) => anda(f, c + '/' + f.tagName.toLowerCase() + j));
        };
        anda(document.querySelector(sel!)!, cam!);
        return fora;
      },
      [`[data-regua-hover="${i}"]`, caminhos[i]!],
    );
    for (const [c, e] of sub) out.push([c, guarda(e)]);
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
  }
  await page.evaluate(() =>
    document.querySelectorAll('[data-regua-hover]').forEach((e) => e.removeAttribute('data-regua-hover')),
  );
  return out;
}

const escreve = (nome: string, m: Medicao) =>
  fs.writeFileSync(path.join(SAIDA!, `${nome}.json`), JSON.stringify(m));

let cookie: Awaited<ReturnType<typeof logaComoFerramenta>> | null = null;
if (modo === 'grava') {
  applyDotEnv(ROOT);
  cookie = await logaComoFerramenta(process.env.REGUA_API ?? 'http://localhost:3100');
  fs.mkdirSync(path.dirname(HAR), { recursive: true });
} else fs.mkdirSync(SAIDA!, { recursive: true });

const browser = await chromium.launch();
const erros: string[] = [];
let medicoes = 0;
/** Respostas que envenenam a gravação: 429 (limite) e 401 (sessão caiu — a API reiniciou
 *  no meio da gravação em 06/10 e tudo depois virou 401, em silêncio). */
const ruins = { 429: 0, 401: 0 };
/** Medindo: pedidos que o HAR não tinha (abortados — o visual cai no estado de erro). */
let foraDoHar = 0;
try {
  // UM contexto só: o HAR é escrito quando o contexto fecha, e um contexto por largura
  // sobrescrevia o arquivo — sobrava só a última largura. A largura muda por página.
  {
    const ctx = await browser.newContext({ viewport: TAMANHOS[0], reducedMotion: 'reduce' });
    if (cookie) await ctx.addCookies([{ ...cookie, url: BASE }]);
    await ctx.route('**/api/eventos**', (r) => r.abort());
    await ctx.routeFromHAR(
      HAR,
      modo === 'grava'
        ? { url: API, update: true, updateContent: 'embed', updateMode: 'minimal' }
        : { url: API, notFound: 'abort' },
    );
    await ctx.addInitScript(() => {
      // Sem cursor fino: desliga hover-prefetch e vizinhança, que pedem fora de ordem.
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q: string) =>
        (q.includes('pointer: fine') ? { ...mm(q), matches: false } : mm(q)) as MediaQueryList;
      // Sem o relógio de 60 s: marcaria "ao vivo" numa medição e não na outra.
      const si = window.setInterval.bind(window);
      (window as unknown as { setInterval: unknown }).setInterval = (
        f: TimerHandler,
        ms?: number,
        ...a: unknown[]
      ) => (ms === 60000 ? 0 : si(f, ms, ...a));
    });
    // O tema não muda os pedidos: gravando, basta o claro.
    for (const tamanho of TAMANHOS) for (const tema of modo === 'grava' ? ['light'] : ['light', 'dark']) {
      for (const id of PAGINAS) {
        const nome = `${tamanho.width}-${tema}-${id}`;
        const page = await ctx.newPage();
        await page.setViewportSize(tamanho);
        await page.clock.setFixedTime(new Date('2026-10-06T15:00:00Z'));
        await page.addInitScript((t: string) => {
          localStorage.setItem('sebratel-tema-escuro', t);
          localStorage.setItem('modo-conferencia', '1');
        }, tema);
        page.on('pageerror', (e) => erros.push(`${nome}: ${String(e).slice(0, 160)}`));
        page.on('response', (r) => {
          const st = r.status();
          if ((st === 429 || st === 401) && API.test(r.url())) ruins[st]++;
        });
        page.on('requestfailed', (r) => {
          if (modo === 'mede' && API.test(r.url())) foraDoHar++;
        });
        const emVoo = new Set<unknown>();
        page.on('request', (r) => {
          if (API.test(r.url())) emVoo.add(r);
        });
        page.on('requestfinished', (r) => emVoo.delete(r));
        page.on('requestfailed', (r) => emVoo.delete(r));
        const quieto = async () => {
          let calmo = 0;
          for (let t = 0; t < 600 && calmo < 15; t++) {
            await page.waitForTimeout(100);
            calmo = emVoo.size === 0 ? calmo + 1 : 0;
          }
        };
        await page.goto(`${BASE}/?pagina=${id}`, { waitUntil: 'domcontentloaded' });
        await page
          .waitForSelector('.area', { timeout: 60000 })
          .catch(() => erros.push(`${nome}: sem .area`));
        await quieto();
        // Rola até o fim (os visuais abaixo da dobra chegam) e volta.
        for (let i = 0; i < 30; i++) {
          const fim = await page.evaluate(() => {
            window.scrollBy(0, 600);
            return window.scrollY + window.innerHeight >= document.body.scrollHeight - 2;
          });
          await page.waitForTimeout(150);
          await quieto();
          if (fim) break;
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await quieto();
        await page.waitForTimeout(400);

        if (modo === 'mede') {
          const linhas = comHash(await page.evaluate(despeja, 'body'));
          const hover = tamanho.width === 1366 ? await hovers(ctx, page) : [];
          escreve(nome, { linhas, hover });
          medicoes++;
        }
        if (id === 'agendamento-field') {
          try {
            // Os diálogos de filtro, com o `:hover` forçado a 1366: o de período como
            // abre, o mesmo com um mês aberto (a grade de dias) e o de lista (busca,
            // opções, rodapé). Os ganchos são de acessibilidade, que os dois builds têm.
            const dialogo = async (sufixo: string) => {
              await page.waitForTimeout(400);
              if (modo !== 'mede') return;
              const linhas = comHash(await page.evaluate(despeja, 'body'));
              const hover = tamanho.width === 1366 ? await hovers(ctx, page) : [];
              escreve(`${nome}-${sufixo}`, { linhas, hover });
              medicoes++;
            };
            const gatilhos = page.locator('button[aria-haspopup="dialog"]');
            await gatilhos.first().click();
            await page.getByRole('dialog').waitFor({ timeout: 10000 });
            await dialogo('dialogo');
            await page.evaluate(() => {
              const mes = [...document.querySelectorAll('[role="dialog"] label')].find((l) =>
                /^(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)$/.test(l.textContent!.trim()),
              );
              (mes?.previousElementSibling as HTMLElement | null)?.click();
            });
            await dialogo('dialogo-dias');
            await page.getByRole('dialog').getByTitle('Fechar').click();
            await gatilhos.nth(1).click();
            await page.locator('[role="dialog"] input[type="checkbox"]').first().waitFor({ timeout: 10000 });
            await dialogo('dialogo-lista');
          } catch (e) {
            erros.push(`${nome} diálogo: ${String(e).split('\n')[0]}`);
          }
        }
        await page.close();
        if (modo === 'grava') await new Promise((r) => setTimeout(r, PAUSA_GRAVANDO_MS));
      }
    }
    await ctx.close();
  }

  // Os estados que a tela carregada não mostra, forçados a 1366 sobre o HAR (a rota da
  // página vence a do contexto): `abrindo` segura o pedido da página (esqueleto da
  // página inteira); `carregando` responde a abertura RECORTADA (`recortaAbertura`: a de
  // hoje pede todos os visuais de uma vez, e sem o recorte nenhum se busca sozinho) e
  // segura o resto (visual fora da dobra e sob demanda, antes e depois de rolar);
  // `falhou` responde 500 ao resto ("não carregou", com o erro e o botão).
  if (modo === 'mede') {
    // As respostas de abertura e de layout gravadas, para recortar (`recortaAbertura`).
    const gravado = new Map<string, string>();
    for (const e of JSON.parse(fs.readFileSync(HAR, 'utf8')).log.entries as {
      request: { url: string };
      response: { content: { text?: string; encoding?: string } };
    }[]) {
      const { text, encoding } = e.response.content;
      if (!/\/api\/dashboards\//.test(e.request.url) || text === undefined) continue;
      gravado.set(e.request.url, encoding === 'base64' ? Buffer.from(text, 'base64').toString('utf8') : text);
    }
    const ctx = await browser.newContext({ viewport: TAMANHOS[0], reducedMotion: 'reduce' });
    await ctx.route('**/api/eventos**', (r) => r.abort());
    await ctx.routeFromHAR(HAR, { url: API, notFound: 'abort' });
    for (const tema of ['light', 'dark'])
      for (const estado of ['abrindo', 'carregando', 'falhou'] as const)
        for (const id of PAGINAS) {
          const nome = `1366-${tema}-${id}-${estado}`;
          const page = await ctx.newPage();
          await page.clock.setFixedTime(new Date('2026-10-06T15:00:00Z'));
          await page.addInitScript((t: string) => {
            localStorage.setItem('sebratel-tema-escuro', t);
            localStorage.setItem('modo-conferencia', '1');
          }, tema);
          page.on('pageerror', (e) => erros.push(`${nome}: ${String(e).slice(0, 160)}`));
          const daPagina = new RegExp(`/api/dashboards/${id}(\\?|$)`);
          let abertura = estado !== 'abrindo';
          await page.route(daPagina, (r) => {
            if (abertura) {
              abertura = false;
              const pagina = gravado.get(r.request().url());
              const layout = gravado.get(`${BASE}/api/dashboards/${id}/layout`);
              if (!pagina || !layout) {
                erros.push(`${nome}: abertura ou layout fora do HAR`);
                return r.fallback();
              }
              return r.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(recortaAbertura(JSON.parse(pagina), JSON.parse(layout))),
              });
            }
            if (estado === 'falhou')
              return r.fulfill({
                status: 500,
                contentType: 'application/json',
                body: '{"erro":"falha forçada pela régua"}',
              });
            // Segura: o pedido fica em voo até a página fechar.
          });
          await page.goto(`${BASE}/?pagina=${id}`, { waitUntil: 'domcontentloaded' });
          await page
            .waitForSelector('.area', { timeout: 60000 })
            .catch(() => erros.push(`${nome}: sem .area`));
          await page.waitForTimeout(2500);
          const mede = async (sufixo: string) => {
            escreve(nome + sufixo, { linhas: comHash(await page.evaluate(despeja, 'body')), hover: [] });
            medicoes++;
          };
          if (estado === 'carregando') await mede('-dobra');
          if (estado !== 'abrindo') {
            for (let i = 0; i < 30; i++) {
              const fim = await page.evaluate(() => {
                window.scrollBy(0, 600);
                return window.scrollY + window.innerHeight >= document.body.scrollHeight - 2;
              });
              await page.waitForTimeout(300);
              if (fim) break;
            }
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForTimeout(1500);
          }
          await mede('');
          await page.close();
        }
    await ctx.close();
  }

  // A tela de login: todo `/api` responde 401, sem API nem HAR.
  if (modo === 'mede') {
    for (const tema of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: TAMANHOS[0], reducedMotion: 'reduce' });
      await ctx.route('**/api/**', (r) =>
        r.fulfill({ status: 401, contentType: 'application/json', body: '{"erro":"sessão"}' }),
      );
      const page = await ctx.newPage();
      await page.addInitScript((t: string) => localStorage.setItem('sebratel-tema-escuro', t), tema);
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await page
        .getByText('Entre com sua conta corporativa')
        .waitFor({ timeout: 30000 })
        .catch(() => erros.push(`login ${tema}: não apareceu`));
      await page.waitForTimeout(800);
      escreve(`1366-${tema}-login`, { linhas: comHash(await page.evaluate(despeja, 'body')), hover: [] });
      medicoes++;
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
if (modo === 'mede') {
  fs.writeFileSync(path.join(SAIDA!, 'estilos.json'), JSON.stringify(Object.fromEntries(estilos)));
}
console.log(
  `${modo}: ${medicoes} medições, ${estilos.size} estilos distintos, ` +
    `${ruins[429]} respostas 429, ${ruins[401]} respostas 401` +
    (modo === 'mede' ? `, ${foraDoHar} pedidos fora do HAR` : '') +
    `, ${erros.length} erro(s)${erros.length ? ':\n' + erros.join('\n') : ''}`,
);
process.exit(erros.length || ruins[429] || ruins[401] ? 1 : 0);
