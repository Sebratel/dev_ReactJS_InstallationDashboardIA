#!/usr/bin/env node
// `npm run tela -- --perf` — o orçamento de carregamento exigido por
// `docs/PLANO-LAYOUT-V1.md` §7: "primeiro pixel útil, número de requisições, bytes
// transferidos e ms por visual, a frio e a quente". Sem estes 4 números, "ficou mais
// rápido" não entra em nota de release (`DEPLOY.md` §1).
//
// **Por que não varre as 4 resoluções como `varre.ts`.** Tempo de rede e custo de
// cálculo no servidor não dependem do tamanho da viewport — variar resolução aqui só
// multiplicaria o tempo do arnês sem medir nada novo. Uma resolução de referência
// (1920×1080) e duas passadas por página (fria, quente) bastam.
//
// **Fria vs quente, sem reiniciar o servidor.** A primeira navegação a uma página
// nesta execução bate o cache de resposta do servidor pela primeira vez (frio); a
// segunda, imediata, reaproveita a mesma entrada (quente) — é o MESMO mecanismo que
// `cache-resposta.ts` já usa em produção, não um cache à parte para o teste.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RESOLUCAO_DE_REFERENCIA = { largura: 1920, altura: 1080 };

const PAGINAS = [
  'agendamento-field', 'capa', 'diario-instalacao', 'instalacao-reincidente',
  'l-inst', 'l-mapa', 'l-tec', 'manutencao-inicial', 'premiacao-instalacao',
  'protocolos-detalhados', 'relatorio-do-ano', 'relatorio-do-mes',
  'telefonia-ouvidoria', 'visao-geral',
];

export interface MedidaDePerf {
  pagina: string;
  passada: 'fria' | 'quente';
  primeiroPixelMs: number | null;
  tempoAteProntoMs: number;
  requisicoes: number;
  bytes: number;
  visuaisNaResposta: number;
  msPorVisual: number | null;
}

async function medeUmaPassada(
  browser: import('playwright').Browser,
  base: string,
  pagina: string,
  passada: 'fria' | 'quente',
): Promise<MedidaDePerf> {
  // Um `BrowserContext` novo a cada passada — não `page.close()` + `newPage()` no
  // mesmo contexto. Medido: reaproveitar o contexto faz a passada seguinte herdar o
  // *connection pool* HTTP/1.1 da anterior, e numa página com várias requisições
  // concorrentes (`agendamento-field`, Fase L5 R4: o lote mais os fora-da-dobra
  // pertinho) uma conexão do pool ficava "presa" e a passada seguinte esperava ~15-19s
  // pela primeira resposta — no servidor (via `curl` direto) o mesmo pedido sempre
  // respondeu em bem menos de 1s. Contexto isolado por passada não herda pool nenhum.
  const context = await browser.newContext({
    viewport: { width: RESOLUCAO_DE_REFERENCIA.largura, height: RESOLUCAO_DE_REFERENCIA.altura },
  });
  // `.selo` (o sinal de "pronto" que `waitForSelector` espera) só desenha em modo
  // conferência — mesma técnica de `varre.ts`. Tema não importa para perf.
  await context.addInitScript(() => localStorage.setItem('modo-conferencia', '1'));
  const page = await context.newPage();
  let requisicoes = 0;
  let bytes = 0;
  let visuaisNaResposta = 0;
  let pegouCorpoPrincipal = false;

  const aoResponder = async (res: import('playwright').Response) => {
    const url = res.url();
    if (!url.includes('/api/dashboards/') || url.includes('/layout')) return;
    requisicoes++;
    try {
      const corpo = await res.body();
      bytes += corpo.length;
      // O pedido PRINCIPAL da abertura é o primeiro `/api/dashboards/<id>?...` que
      // chega (excluindo `/valores`, que é lista de segmentação, não dado de
      // visual) — os que vierem depois são visuais fora da dobra completando por
      // interseção (Fase L5, R4).
      if (!pegouCorpoPrincipal && !url.includes('/valores')) {
        pegouCorpoPrincipal = true;
        const json: unknown = JSON.parse(corpo.toString('utf8'));
        const visuais = (json as { visuais?: unknown[] }).visuais;
        if (Array.isArray(visuais)) visuaisNaResposta = visuais.length;
      }
    } catch {
      // Resposta que não é JSON (ou já sem corpo) não entra na contagem de visuais —
      // os bytes já foram somados acima, que é o que importa para o orçamento.
    }
  };
  page.on('response', aoResponder);

  const t0 = Date.now();
  await page.goto(`${base}/?pagina=${pagina}`);
  await page.waitForSelector('.selo', { timeout: 30000 });
  const tempoAteProntoMs = Date.now() - t0;

  const primeiroPixelMs = await page.evaluate(() => {
    const entrada = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint');
    return entrada ? Math.round(entrada.startTime) : null;
  });

  // Deixa assentar o que já estava em voo (ex.: um card fora da dobra cujo
  // `IntersectionObserver` disparou por estar dentro da margem de pré-carga, mesmo
  // sem o usuário ter rolado) antes de fechar a contagem — sem isto, a requisição
  // conta ou não conforme o acaso de já ter respondido no instante do `.selo`.
  //
  // **O prazo é generoso de propósito.** `context.close()` logo depois DERRUBA
  // qualquer requisição ainda em voo — e `carrega()` (`servidor.ts:683-741`) tem um
  // cache single-flight por `dash.id` (uma só promessa de avaliador para todos os
  // pedidos concorrentes que não liberam coluna nova, o caso comum). Medido: abortar
  // o pedido que ainda está CONSTRUINDO esse avaliador pela primeira vez — não um
  // pedido já resolvido — e refazer o MESMO pedido logo em seguida podia prender a
  // repetição por 15+ segundos, mesmo com o servidor respondendo em bem menos de 1s
  // a pedidos isolados (confirmado com `fetch` cru, sem navegador nenhum). Um prazo
  // curto aqui fabricava exatamente essa corrida a cada passada — não é o que se
  // quer medir. 20s cobre a construção do avaliador mais lenta observada.
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  page.off('response', aoResponder);
  await context.close();

  return {
    pagina,
    passada,
    primeiroPixelMs,
    tempoAteProntoMs,
    requisicoes,
    bytes,
    visuaisNaResposta,
    msPorVisual: visuaisNaResposta > 0 ? Math.round(tempoAteProntoMs / visuaisNaResposta) : null,
  };
}

function montaMarkdown(medidas: readonly MedidaDePerf[]): string {
  const linhas = [
    `# Orçamento de carregamento — \`npm run tela -- --perf\``,
    '',
    `> GERADO POR \`npm run tela -- --perf\` — não editar à mão. Ver \`docs/PLANO-LAYOUT-V1.md\` §7.`,
    '',
    `Gerado em ${new Date().toISOString()}. Resolução de referência: ${RESOLUCAO_DE_REFERENCIA.largura}×${RESOLUCAO_DE_REFERENCIA.altura}.`,
    '',
    '| página | passada | primeiro pixel (ms) | pronto (ms) | requisições | bytes | visuais na resposta | ms/visual |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const m of medidas) {
    linhas.push(
      `| ${m.pagina} | ${m.passada} | ${m.primeiroPixelMs ?? '—'} | ${m.tempoAteProntoMs} | ` +
        `${m.requisicoes} | ${m.bytes} | ${m.visuaisNaResposta} | ${m.msPorVisual ?? '—'} |`,
    );
  }
  return linhas.join('\n') + '\n';
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const portaArg = args.find((a) => a.startsWith('--porta='));
  const porta = portaArg ? Number.parseInt(portaArg.slice('--porta='.length), 10) : 3100;
  const base = `http://localhost:${porta}`;

  const paginaArg = args.find((a) => a.startsWith('--pagina='));
  const alvo = paginaArg ? paginaArg.slice('--pagina='.length).split(',') : PAGINAS;

  const resp = await fetch(`${base}/api/saude`).catch(() => null);
  if (!resp?.ok) {
    console.error(`API não responde em ${base}. Suba com 'npm start' antes.`);
    process.exit(2);
  }

  const browser = await chromium.launch();
  const medidas: MedidaDePerf[] = [];
  try {
    for (const pagina of alvo) {
      process.stderr.write(`  ${pagina}… `);
      const fria = await medeUmaPassada(browser, base, pagina, 'fria');
      const quente = await medeUmaPassada(browser, base, pagina, 'quente');
      medidas.push(fria, quente);
      process.stderr.write(
        `fria ${fria.tempoAteProntoMs}ms/${fria.requisicoes}req — quente ${quente.tempoAteProntoMs}ms/${quente.requisicoes}req\n`,
      );
    }
  } finally {
    await browser.close();
  }

  const destino = path.join(ROOT, 'docs', 'PERF-CARGA.md');
  fs.writeFileSync(destino, montaMarkdown(medidas));
  console.log(`\nGravado em ${destino}.`);
}

// Roda sozinho só quando chamado direto (`npm run tela -- --perf` importa este
// módulo de dentro de `varre.ts` e chama `main()` explicitamente — sem esta guarda,
// o `import()` dinâmico de lá já dispararia esta linha, e a medida rodaria em
// dobro).
const ehPontoDeEntrada =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ehPontoDeEntrada) void main();
