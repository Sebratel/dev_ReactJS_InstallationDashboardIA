import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

const eventos = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') eventos.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) =>
  eventos.push(`[pageerror] ${e.message}\n   ${(e.stack ?? '').split('\n').slice(1, 5).join('\n   ')}`),
);
page.on('requestfailed', (r) => eventos.push(`[requestfailed] ${r.url()} — ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) eventos.push(`[HTTP ${r.status()}] ${r.url()}`);
});

await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);

console.log('clicando em DIÁRIO INSTALAÇÃO…');
const t0 = Date.now();
await page.getByText('DIÁRIO INSTALAÇÃO', { exact: true }).first().click();

// espera o que vier: conteudo ou erro
await page.waitForTimeout(20000);
console.log(`esperei ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('url:', page.url());

const txt = ((await page.textContent('body').catch(() => '')) ?? '').replace(/\s+/g, ' ');
console.log('--- texto visivel (900 chars) ---');
console.log(txt.slice(0, 900));

console.log('--- eventos ---');
console.log(eventos.length ? eventos.slice(0, 25).join('\n') : '(nenhum)');

await page.screenshot({ path: './scratch/diario.png', fullPage: false });
console.log('screenshot: scratch/diario.png');
await browser.close();
