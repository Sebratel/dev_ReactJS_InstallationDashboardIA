#!/usr/bin/env node
// `npm run tela` — o arnês de medição em navegador da Fase L2 (`docs/PLANO-LAYOUT-V1.md`
// §4). Não muda nenhum componente: só abre a tela de verdade (via `npm start`) em cada
// combinação de página × resolução × tema e reprova conforme os 5 critérios do plano.
//
// **Como identifica cada cartão.** Não precisou de nenhum atributo novo no DOM — o "modo
// conferência" (`apps/web/src/modo.tsx`) já liga um `<span class="id-visual">` dentro de
// cada `.cartao`/`.cartao-kpi` para bater a tela contra `specs/paridade/`. Ligar os dois
// `localStorage` (tema e conferência) ANTES do primeiro script da página é o que exige
// `context.addInitScript`, não `page.evaluate` depois do load — os dois stores só leem o
// `localStorage` no `useState` inicial.
//
// **Como sabe que a página terminou de calcular.** O mesmo modo conferência renderiza
// `.selo` só quando `pagina` já foi setado (`App.tsx`), então é o sinal de "pronto" mais
// barato que existe — sem `waitForTimeout`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { applyDotEnv } from '../../../packages/query-engine/src/config.ts';
import { loadDashboards } from '../../../packages/widget-engine/src/spec.ts';
import { logaComoFerramenta } from './login-interno.ts';
import { RESOLUCOES, type Resolucao } from './resolucoes.ts';
import { PARES, avaliaContraste, type ParResolvido, type ProblemaDeContraste } from './contraste.ts';
import { agrupaPorLinha, linhasComAlturaDivergente, type CaixaMedida } from './geometria.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);

const TEMAS = ['claro', 'escuro'] as const;
type Tema = (typeof TEMAS)[number];

interface ProblemaDaPagina {
  tipo: 'cartao-alto' | 'rolagem-horizontal' | 'v-auto' | 'linha-divergente';
  detalhe: string;
}

interface ResultadoDaPagina {
  pagina: string;
  tema: Tema;
  resolucao: Resolucao;
  scrollHeight: number;
  innerHeight: number;
  problemas: ProblemaDaPagina[];
}

interface Args {
  paginas: string[] | null;
  resolucao: Resolucao | null;
  tema: Tema | null;
  porta: number;
}

function parseArgs(argv: readonly string[]): Args {
  let largura: number | null = null;
  let altura: number | null = null;
  let tema: Tema | null = null;
  let porta = 3100;
  let paginas: string[] | null = null;

  for (const a of argv) {
    if (a.startsWith('--pagina=')) {
      paginas = a.slice('--pagina='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith('--largura=')) {
      largura = Number.parseInt(a.slice('--largura='.length), 10);
    } else if (a.startsWith('--altura=')) {
      altura = Number.parseInt(a.slice('--altura='.length), 10);
    } else if (a.startsWith('--tema=')) {
      const v = a.slice('--tema='.length);
      if (v !== 'claro' && v !== 'escuro') {
        console.error(`--tema= espera 'claro' ou 'escuro', veio '${v}'.`);
        process.exit(2);
      }
      tema = v;
    } else if (a.startsWith('--porta=')) {
      porta = Number.parseInt(a.slice('--porta='.length), 10);
    } else {
      console.error(`argumento desconhecido: ${a}`);
      console.error("use: --pagina=id,id | --largura=N --altura=N | --tema=claro|escuro | --porta=N");
      process.exit(2);
    }
  }

  if ((largura === null) !== (altura === null)) {
    console.error('--largura= e --altura= têm de vir juntos, ou nenhum dos dois.');
    process.exit(2);
  }
  if (!Number.isFinite(porta)) {
    console.error('--porta= espera um número.');
    process.exit(2);
  }

  return {
    paginas,
    resolucao: largura !== null && altura !== null ? { largura, altura } : null,
    tema,
    porta,
  };
}

async function respondeSaude(base: string): Promise<boolean> {
  try {
    const r = await fetch(`${base}/api/saude`);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Cria um elemento fora da tela com `color`/`background-color` apontando para as duas
 * variáveis, e lê o computado. `getComputedStyle` numa CUSTOM PROPERTY devolve a string
 * bruta (`"var(--pbi-gold)"`, sem resolver); numa propriedade padrão como `color`, o
 * navegador resolve a cadeia de `var()` inteira — é por isso que o probe existe, em vez
 * de ler `--pbi-primary-texto` direto.
 */
async function medeContraste(page: import('playwright').Page): Promise<ProblemaDeContraste[]> {
  const resolvidos = (await page.evaluate((pares) => {
    return pares.map((p) => {
      const el = document.createElement('div');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      el.style.color = `var(--${p.fg})`;
      el.style.backgroundColor = `var(--${p.bg})`;
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const resolvido = { ...p, corFg: cs.color, corBg: cs.backgroundColor };
      el.remove();
      return resolvido;
    });
  }, PARES)) as ParResolvido[];
  return avaliaContraste(resolvidos);
}

interface MedidaGeometria {
  problemas: ProblemaDaPagina[];
  scrollHeight: number;
  innerHeight: number;
}

async function medeGeometria(page: import('playwright').Page): Promise<MedidaGeometria> {
  const bruto = await page.evaluate(() => {
    const innerHeight = window.innerHeight;
    const scrollHeight = document.documentElement.scrollHeight;
    const rolaHorizontal = document.documentElement.scrollWidth > document.documentElement.clientWidth;
    const vAuto = document.querySelectorAll('.v-auto').length;

    const cartaoAlto: string[] = [];
    document.querySelectorAll('.cartao, .cartao-kpi').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height > innerHeight) {
        const idEl = el.querySelector('.id-visual');
        cartaoAlto.push(
          `${idEl?.textContent ?? '(sem id — provavelmente KPI sem origem)'} mede ${Math.round(r.height)}px, viewport tem ${innerHeight}px`,
        );
      }
    });

    // Só dentro dos contêineres flex-wrap: são os únicos lugares (VisualGridSection.tsx)
    // onde o flexbox decide o wrap sozinho — fora deles, cada visual já é uma linha.
    const containers = Array.from(document.querySelectorAll('div.flex.flex-wrap'));
    const linhas = containers.map((container) =>
      Array.from(container.querySelectorAll(':scope > div > .cartao')).map((el) => {
        const r = el.getBoundingClientRect();
        const idEl = el.querySelector('.id-visual');
        return { id: idEl?.textContent ?? '(sem id)', top: r.top, height: r.height };
      }),
    );

    return { innerHeight, scrollHeight, rolaHorizontal, vAuto, cartaoAlto, linhas };
  });

  const problemas: ProblemaDaPagina[] = [];
  for (const msg of bruto.cartaoAlto) problemas.push({ tipo: 'cartao-alto', detalhe: msg });
  if (bruto.rolaHorizontal) {
    problemas.push({ tipo: 'rolagem-horizontal', detalhe: 'scrollWidth > clientWidth na raiz do documento' });
  }
  if (bruto.vAuto > 0) {
    problemas.push({ tipo: 'v-auto', detalhe: `${bruto.vAuto} cartão(ões) sem altura declarada (.v-auto)` });
  }
  for (const caixas of bruto.linhas) {
    const grupos = agrupaPorLinha(caixas as CaixaMedida[]);
    for (const div of linhasComAlturaDivergente(grupos)) {
      problemas.push({
        tipo: 'linha-divergente',
        detalhe: `${div.ids.join(' vs ')}: ${div.alturas.map((a) => `${Math.round(a)}px`).join(' vs ')}`,
      });
    }
  }

  return { problemas, scrollHeight: bruto.scrollHeight, innerHeight: bruto.innerHeight };
}

function montaRelatorio(
  resultados: readonly ResultadoDaPagina[],
  contrastePorTema: ReadonlyMap<Tema, ProblemaDeContraste[]>,
): string {
  const l: string[] = [];
  l.push('# Medidas de tela');
  l.push('');
  l.push('> GERADO POR `npm run tela` — não editar à mão. Ver `docs/PLANO-LAYOUT-V1.md` §4.');
  l.push('');
  l.push(`Gerado em ${new Date().toISOString()}.`);
  l.push('');
  l.push('## Contraste (por tema — os tokens de cor não variam por resolução)');
  l.push('');
  for (const tema of contrastePorTema.keys()) {
    const problemas = contrastePorTema.get(tema)!;
    l.push(
      `- **${tema}**: ${
        problemas.length === 0
          ? 'nenhum par abaixo de 4,5:1'
          : problemas.map((p) => `${p.rotulo} (${p.razao.toFixed(2)}:1)`).join('; ')
      }`,
    );
  }
  l.push('');
  l.push('## Por página × resolução × tema');
  l.push('');
  l.push('| página | tema | resolução | scrollHeight / innerHeight | telas | problemas |');
  l.push('|---|---|---|---|---|---|');
  for (const r of resultados) {
    const telas = (r.scrollHeight / r.innerHeight).toFixed(1);
    l.push(
      `| ${r.pagina} | ${r.tema} | ${r.resolucao.largura}×${r.resolucao.altura} | ${r.scrollHeight}/${r.innerHeight} | ${telas} | ${r.problemas.length === 0 ? '—' : r.problemas.length} |`,
    );
  }
  l.push('');

  const comProblema = resultados.filter((r) => r.problemas.length > 0);
  if (comProblema.length > 0) {
    l.push('## Detalhe dos problemas');
    l.push('');
    for (const r of comProblema) {
      l.push(`### ${r.pagina} — ${r.tema} — ${r.resolucao.largura}×${r.resolucao.altura}`);
      for (const p of r.problemas) l.push(`- **${p.tipo}**: ${p.detalhe}`);
      l.push('');
    }
  }

  return l.join('\n') + '\n';
}

async function main(): Promise<void> {
  // `--perf` desvia inteiro para o orçamento de carregamento (Fase L5, §7) — é um
  // arnês diferente (mede rede/tempo, não geometria/contraste), mas mora no mesmo
  // comando por conveniência: quem já sabe `npm run tela` não precisa aprender um
  // segundo nome.
  if (process.argv.includes('--perf')) {
    const { main: perf } = await import('./perf.ts');
    return perf();
  }

  const args = parseArgs(process.argv.slice(2));
  const BASE = `http://localhost:${args.porta}`;

  if (!(await respondeSaude(BASE))) {
    console.error(`API não responde em ${BASE}. Suba com 'npm start' antes.`);
    process.exit(2);
  }

  const cookieDeSessao = await logaComoFerramenta(BASE);

  const todas = loadDashboards(path.join(ROOT, 'specs'));
  const alvo = args.paginas ? todas.filter((d) => args.paginas!.includes(d.id)) : todas;
  if (alvo.length === 0) {
    console.error('nenhuma página casou com --pagina=');
    process.exit(2);
  }

  const resolucoes = args.resolucao ? [args.resolucao] : RESOLUCOES;
  const temas = args.tema ? [args.tema] : TEMAS;

  const browser = await chromium.launch();
  const resultados: ResultadoDaPagina[] = [];
  const contrastePorTema = new Map<Tema, ProblemaDeContraste[]>();

  try {
    for (const tema of temas) {
      for (const resolucao of resolucoes) {
        const context = await browser.newContext({
          viewport: { width: resolucao.largura, height: resolucao.altura },
        });
        await context.addCookies([{ ...cookieDeSessao, url: BASE }]);
        await context.addInitScript((temaAtual: Tema) => {
          localStorage.setItem('sebratel-tema-escuro', temaAtual === 'escuro' ? 'dark' : 'light');
          localStorage.setItem('modo-conferencia', '1');
        }, tema);
        const page = await context.newPage();

        for (const dash of alvo) {
          process.stderr.write(`  ${tema} ${resolucao.largura}x${resolucao.altura} ${dash.id}… `);
          await page.goto(`${BASE}/?pagina=${dash.id}`);
          await page.waitForSelector('.selo', { timeout: 15000 });
          await page.waitForLoadState('networkidle');

          const { problemas, scrollHeight, innerHeight } = await medeGeometria(page);
          contrastePorTema.set(tema, await medeContraste(page));

          resultados.push({ pagina: dash.id, tema, resolucao, scrollHeight, innerHeight, problemas });
          process.stderr.write(problemas.length === 0 ? 'ok\n' : `${problemas.length} problema(s)\n`);
        }

        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const relatorio = montaRelatorio(resultados, contrastePorTema);
  fs.writeFileSync(path.join(ROOT, 'docs', 'MEDIDAS-TELA.md'), relatorio);

  const totalGeometria = resultados.reduce((n, r) => n + r.problemas.length, 0);
  const totalContraste = [...contrastePorTema.values()].reduce((n, ps) => n + ps.length, 0);
  const total = totalGeometria + totalContraste;

  console.log(`\n${resultados.length} combinações. ${total} problema(s) — ver docs/MEDIDAS-TELA.md.`);
  if (total > 0) process.exit(1);
}

void main();
