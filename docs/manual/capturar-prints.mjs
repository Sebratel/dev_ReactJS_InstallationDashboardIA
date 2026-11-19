// Captura os prints do manual de uso (`docs/manual/imagens/`). Abre um Chrome de verdade,
// espera a pessoa logar com a conta corporativa e então fotografa as telas.
//
//   node docs/manual/capturar-prints.mjs docs/manual/imagens
//
// A plataforma precisa estar no ar (`PRINTS_BASE`, padrão http://localhost:3100). O perfil
// do navegador fica fora do repositório (`PRINTS_PERFIL`, padrão na pasta temporária):
// depois do primeiro login, as execuções seguintes já entram logadas.
//
// Nenhum print pode sair com dado pessoal: a escolha da tabela confere o cabeçalho e
// recusa qualquer coluna de identificação.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.PRINTS_BASE ?? 'http://localhost:3100';
const SAIDA = process.argv[2] ?? '.';
const PERFIL = process.env.PRINTS_PERFIL ?? path.join(os.tmpdir(), 'prints-dashboard-instalacao');
const ESPERA_LOGIN_MS = 15 * 60 * 1000;
const PROIBIDAS = /cliente|telefone|endere|cpf|cnpj|contato|e-?mail|logradouro|bairro/i;

const log = (...t) => console.log(new Date().toTimeString().slice(0, 8), ...t);

async function esperaLogin(page) {
  const ate = Date.now() + ESPERA_LOGIN_MS;
  let avisado = 0;
  while (Date.now() < ate) {
    const logado = await page.evaluate(async () => {
      try {
        const r = await fetch('/auth/sessao', { credentials: 'include' });
        return (await r.json()).logado === true;
      } catch { return false; }
    }).catch(() => false);
    if (logado) return true;
    if (Date.now() - avisado > 20000) { avisado = Date.now(); log('aguardando o login na janela aberta…'); }
    await page.waitForTimeout(2000);
  }
  return false;
}

async function abrePagina(page, id) {
  await page.goto(`${BASE}/?pagina=${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-visual]', { timeout: 90000 });
  // Espera o cálculo: nenhum bloco em carregamento e nenhum esqueleto piscando.
  await page.waitForFunction(() => {
    const ocupados = document.querySelectorAll('[aria-busy="true"], .brilho').length;
    return ocupados === 0;
  }, null, { timeout: 120000 }).catch(() => log(`  (${id}: ainda havia bloco carregando; sigo)`));
  await page.waitForTimeout(2500);
  // `data-visual` é booleano ("true"), não identificador: o alvo é a POSIÇÃO na página.
  const visuais = await page.$$eval('[data-visual]', (ns) => ns.map((n, i) => ({
    i,
    titulo: (n.querySelector('h2, h3, [class*="titulo"]')?.textContent || '').trim().slice(0, 60),
    svg: n.querySelectorAll('svg').length,
    tabela: n.querySelectorAll('table').length,
    cabecalho: [...n.querySelectorAll('th')].map((t) => t.textContent.trim()).join(' | ').slice(0, 160),
    altura: Math.round(n.getBoundingClientRect().height),
    largura: Math.round(n.getBoundingClientRect().width),
  })));
  return visuais;
}

async function fotografa(alvo, arquivo) {
  const destino = path.join(SAIDA, arquivo);
  await alvo.screenshot({ path: destino });
  const kb = Math.round(fs.statSync(destino).size / 1024);
  log(`  gravado ${arquivo} (${kb} KB)`);
}

/**
 * Esconde o que não deveria aparecer num print. Sem isto, um visual que fica ATRÁS do
 * alvo entra na foto: o print da barra de filtros saiu com telefone, bairro e rua de
 * cliente na tabela do fundo (19/11/2026). `tudo` apaga todos os visuais; o padrão
 * apaga só os que têm coluna de identificação no cabeçalho.
 *
 * `PRINTS_COM_DADOS=1` desliga a proteção — decisão do Erick em 19/11/2026, para o
 * manual interno mostrar a tela como ela é. Lembre que a imagem vai para o git e para
 * dentro do .pptx distribuído.
 */
const COM_DADOS = process.env.PRINTS_COM_DADOS === '1';

async function escondeSensivel(page, { tudo = false } = {}) {
  if (COM_DADOS) return 0;
  return page.evaluate(({ tudo, padrao }) => {
    const re = new RegExp(padrao, 'i');
    let n = 0;
    for (const card of document.querySelectorAll('[data-visual]')) {
      const cabecalho = [...card.querySelectorAll('th')].map((t) => t.textContent).join(' ');
      if (tudo || (cabecalho && re.test(cabecalho))) { card.style.visibility = 'hidden'; n++; }
    }
    return n;
  }, { tudo, padrao: PROIBIDAS.source });
}

const mostraTudo = (page) => page.evaluate(() => {
  for (const card of document.querySelectorAll('[data-visual]')) card.style.visibility = '';
});

const contexto = await chromium.launchPersistentContext(PERFIL, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
  locale: 'pt-BR',
  args: ['--disable-blink-features=AutomationControlled', '--window-size=1640,1000'],
});
const page = contexto.pages()[0] ?? (await contexto.newPage());

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  log('janela aberta — faça o login com a conta @sebratel.com.br');
  if (!await esperaLogin(page)) { log('ERRO: login não aconteceu no prazo'); process.exit(2); }
  log('sessão ativa; começando as capturas');

  // 1. Tela completa — RELATÓRIO DO MÊS: cartões e gráficos, sem lista de cliente.
  let visuais = await abrePagina(page, 'relatorio-do-mes');
  log(`relatorio-do-mes: ${visuais.length} visuais`);
  const ocultos = await escondeSensivel(page);
  if (ocultos) log(`  ${ocultos} visual(is) com coluna de identificação escondido(s)`);
  await fotografa(page, 'tela-completa.png');
  await mostraTudo(page);

  // 2. Barra de filtros com a árvore de período aberta. O RELATÓRIO DO MÊS só tem o
  // seletor de tipo; a VISÃO GERAL é que traz os filtros de data.
  await abrePagina(page, 'visao-geral');
  const deData = page.locator('button[aria-haspopup="dialog"]')
    .filter({ hasText: /\bdata\b|per[ií]odo/i }).first();
  const gatilho = (await deData.count()) ? deData : page.locator('button[aria-haspopup="dialog"]').first();
  if (await gatilho.count()) {
    log(`  filtro aberto: ${(await gatilho.textContent() || '').trim().slice(0, 40)}`);
    await gatilho.click();
    await page.waitForTimeout(1200);
    const barra = await page.locator('.filtros').first().boundingBox();
    const dialogo = await page.getByRole('dialog').first().boundingBox().catch(() => null);
    if (barra) {
      const y = Math.max(0, barra.y - 8);
      const baixo = Math.max(barra.y + barra.height, dialogo ? dialogo.y + dialogo.height : 0) + 12;
      const destino = path.join(SAIDA, 'filtros.png');
      await page.screenshot({
        path: destino,
        clip: { x: 0, y, width: 1600, height: Math.min(900 - y, baixo - y) },
      });
      log(`  gravado filtros.png (${Math.round(fs.statSync(destino).size / 1024)} KB), barra + diálogo`);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  } else log('  (não achei o gatilho do filtro)');

  // 3. Gráfico. O slide fala do paginador, então um gráfico que pagina vale mais; sem
  // nenhum, fica o maior. Título com pessoa (instalador, técnico, cliente) não entra.
  const PESSOA = /instalador|t[ée]cnico|cliente|respons[aá]vel|supervisor/i;
  let grafico = null;
  for (const id of ['visao-geral', 'relatorio-do-ano']) {
    visuais = await abrePagina(page, id);
    log(`${id}: ${visuais.length} visuais`);
    const cards = visuais.filter((v) => v.svg > 0 && v.tabela === 0 && v.altura > 180
      && v.largura > 380 && !PESSOA.test(v.titulo));
    for (const v of cards) {
      const pagina = await page.locator('[data-visual]').nth(v.i)
        .locator('button', { hasText: /pr[óo]xima|anterior/i }).count();
      log(`  gráfico "${v.titulo || `#${v.i}`}" ${pagina ? '(com paginador)' : ''}`);
      if (pagina) { grafico = { ...v, pagina: id }; break; }
      if (!grafico) grafico = { ...v, pagina: id };
    }
    if (grafico?.pagina === id && await page.locator('[data-visual]').nth(grafico.i)
      .locator('button', { hasText: /pr[óo]xima|anterior/i }).count()) break;
  }
  if (grafico) {
    if (!page.url().includes(`pagina=${grafico.pagina}`)) visuais = await abrePagina(page, grafico.pagina);
    log(`  gráfico escolhido: ${grafico.titulo || `#${grafico.i}`} (${grafico.pagina})`);
    await fotografa(page.locator('[data-visual]').nth(grafico.i), 'grafico.png');
  } else log('  (nenhum gráfico adequado)');

  // 4. Tabela — só com cabeçalho sem coluna de identificação. A do ano (cidade × ano) é
  // agregada e já está aberta; as outras páginas entram só se ela não servir.
  const candidatas = [];
  const avalia = (vs, pagina) => {
    for (const v of vs) {
      if (!v.tabela || !v.cabecalho) continue;
      const seguro = !PROIBIDAS.test(v.cabecalho);
      log(`  tabela "${v.titulo || `#${v.i}`}" [${seguro ? 'ok' : 'tem coluna de identificação'}] ${v.cabecalho.slice(0, 80)}`);
      if (seguro && v.altura > 150) candidatas.push({ ...v, pagina });
    }
  };
  for (const id of ['relatorio-do-ano', 'visao-geral', 'agendamento-field', 'manutencao-inicial']) {
    const vs = page.url().includes(`pagina=${id}`) ? visuais : await abrePagina(page, id);
    log(`${id}: ${vs.length} visuais`);
    avalia(vs, id);
    if (candidatas.length) break;
  }
  if (candidatas.length) {
    const escolhida = candidatas.sort((a, b) => b.altura - a.altura)[0];
    if (!page.url().includes(`pagina=${escolhida.pagina}`)) await abrePagina(page, escolhida.pagina);
    log(`  tabela escolhida: ${escolhida.titulo || `#${escolhida.i}`} (${escolhida.pagina})`);
    await fotografa(page.locator('[data-visual]').nth(escolhida.i), 'tabela.png');
  } else log('  (nenhuma tabela sem coluna de identificação; tabela.png não foi gerado)');

  log('fim');
} finally {
  await contexto.close();
}
