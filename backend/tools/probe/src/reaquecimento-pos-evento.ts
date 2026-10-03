// Depois de um evento do poller, a página está pronta quando alguém precisa dela?
//
// É a única pergunta que julga a F4. "O reaquecimento rodou" não serve: o que
// importa é o que a pessoa encontra quando o SSE a manda buscar de novo.
//
//   antes:  evento -> invalida -> SSE -> GET -> MISS -> 10–20 s de cálculo
//   agora:  evento -> invalida -> REWARM -> SSE -> GET -> HIT -> ms
//
// COMO ELA COMPARA. Roda a mesma sequência duas vezes, com um `Servidor` novo em
// cada uma (cache frio, contadores zerados):
//
//   1. `sem reaquecimento` — a cadeia de antes da F4
//   2. `com reaquecimento` — a de agora
//
// A rodada 1 não precisa de código desligado: basta não passar a opção
// `reaquece`, que é exatamente o que o `Servidor` faz por padrão.
//
// EM PROCESSO, e não com `spawn` como a sonda da F3. O gatilho aqui é
// `aoTabelaMudar`, que o `PollerRealtime` chama por dentro — de fora só dá para
// provocá-lo falando com o Voalle de verdade, o que tornaria a medida
// dependente de haver mudança no banco naquele minuto.
//
// A CARGA. Antes de medir, aquece as páginas afetadas: medir um evento contra
// cache frio mediria o arranque, não o reaquecimento. O que a sonda quer é o
// estado real de produção — tudo quente, e aí chega um evento.
//
// REGRA DE SAÍDA: nunca imprime valor de linha. Só id de página, contagem e tempo.
//
// Uso:
//   npm run probe:reaquecimento
//   npm run probe:reaquecimento -- --query=protocolos-telefonia

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { Aquecedor } from '../../../api/src/aquecedor.ts';
import { Servidor } from '../../../api/src/servidor.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { codificaFiltro, filtrosPadrao } from '../../../packages/widget-engine/src/index.ts';
import { idsIniciais } from '../../layout/src/corte-eager.ts';
import type { LayoutSpec } from '../../layout/src/schema.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..', '..', '..');
const SNAPSHOT = path.join(RAIZ, DIRETORIO_PADRAO);

function opcao(prefixo: string, padrao: string): string {
  const arg = process.argv.find((a) => a.startsWith(prefixo));
  return arg ? arg.slice(prefixo.length) : padrao;
}

/** As queries que o poller realmente vigia, com a tabela de cada uma. */
function vigiadas(): { query: string; tabela: string }[] {
  const texto = fs.readFileSync(path.join(RAIZ, 'backend', 'specs', '_catalog', 'realtime-poll.yaml'), 'utf8');
  const doc = YAML.parse(texto) as { queries?: Record<string, { tabela: string }> };
  return Object.entries(doc.queries ?? {}).map(([query, cfg]) => ({ query, tabela: cfg.tabela }));
}

interface Bancada {
  servidor: Servidor;
  porta: number;
  aquecedor: Aquecedor;
  fecha: () => Promise<void>;
}

/**
 * Sobe um `Servidor` com o mesmo arranjo de `index.ts`, com ou sem o
 * reaquecimento pós-evento.
 */
async function sobe(comReaquecimento: boolean): Promise<Bancada> {
  let eu: Bancada;
  const servidor = new Servidor({
    root: RAIZ,
    snapshotDir: SNAPSHOT,
    webDir: path.join(RAIZ, 'frontend', 'dist'),
    identifica: () => ({ usuario: 'sonda', papeis: ['autenticado'] }),
    ...(comReaquecimento
      ? {
          reaquece: async (paginas: readonly string[]): Promise<void> => {
            await eu.aquecedor.reaquece(paginas);
          },
        }
      : {}),
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  eu = {
    servidor,
    porta: port,
    aquecedor: new Aquecedor({
      base: `http://127.0.0.1:${port}`,
      carimbo: () => servidor.identidadeAtual(),
      buscar: (url, init) =>
        fetch(url, {
          ...init,
          headers: { ...init?.headers, 'x-aquecedor-interno': servidor.segredoInterno() },
        }),
      // Nada de laço de fundo: esta sonda controla cada passo à mão.
      anuncia: () => {},
    }),
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.close(() => ok());
        http.closeAllConnections();
      }),
  };
  return eu;
}

interface Medida {
  ms: number;
  cache: string;
  status: number;
}

/**
 * A URL que a ABERTURA REAL da página pede — corte eager do layout mais os
 * filtros padrão.
 *
 * **Isto não é detalhe; foi o defeito da primeira versão desta sonda.** Ela
 * pedia `/api/dashboards/:id` cru e media MISS logo depois de aquecer, o que
 * fazia a F4 parecer inútil. O `Aquecedor` enche, de propósito, a chave com
 * `?visual=` — a que o navegador realmente usa desde R4 —, e a chave sem
 * parâmetro nenhum não é pedida por ninguém. Ver o topo de `aquecedor.ts`.
 */
async function urlDaTela(porta: number, pagina: string): Promise<string> {
  const base = `http://127.0.0.1:${porta}/api/dashboards/${encodeURIComponent(pagina)}`;
  let url = base;
  try {
    const r = await fetch(`${base}/layout`);
    if (r.ok) {
      const ids = idsIniciais((await r.json()) as LayoutSpec);
      if (ids.length > 0) url = `${base}?${ids.map((id) => `visual=${encodeURIComponent(id)}`).join('&')}`;
    }
  } catch {
    /* sem layout, cai na URL crua — a mesma degradação do Aquecedor */
  }
  const filtros = filtrosPadrao(pagina);
  if (url !== base && filtros.length > 0) {
    url += `&${filtros.map((f) => `filtro=${encodeURIComponent(codificaFiltro(f))}`).join('&')}`;
  }
  return url;
}

async function pede(url: string): Promise<Medida> {
  const t = Date.now();
  const r = await fetch(url);
  const corpo = (await r.json()) as { cache?: string };
  return { ms: Date.now() - t, cache: corpo.cache ?? '-', status: r.status };
}

/**
 * Abre o SSE e espera o evento que cita ESTA página.
 *
 * Por página, e não "o próximo evento qualquer": depois que o aviso passou a
 * sair por página, ler o primeiro evento mediria a página que esquentou
 * primeiro — que não é a que o usuário desta medida está olhando.
 */
async function esperaEvento(
  porta: number,
  pagina: string,
): Promise<{ pronto: Promise<number>; fecha: () => void }> {
  const resp = await fetch(`http://127.0.0.1:${porta}/api/eventos`);
  const leitor = resp.body!.getReader();
  await leitor.read(); // `: conectado`
  const pronto = (async (): Promise<number> => {
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) return Date.now();
      const texto = Buffer.from(value!).toString();
      if (!texto.startsWith('data: ')) continue;
      const { dashboards } = JSON.parse(texto.slice('data: '.length).trim()) as { dashboards: string[] };
      if (dashboards.includes(pagina)) return Date.now();
    }
  })();
  return { pronto, fecha: () => void leitor.cancel() };
}

/**
 * Quais páginas cada query vigiada derruba. É o custo de um evento — e a
 * resposta a "reaqueça só as prioritárias": se uma query sozinha invalidar o
 * site inteiro, o recorte não está no reaquecimento, está na invalidação.
 */
async function custoPorEvento(): Promise<Map<string, string[]>> {
  const por = new Map<string, string[]>();
  let afetadas: string[] = [];
  // Um `Servidor` só, sem `listen`: a lista sai pelo caminho do reaquecimento,
  // com um `reaquece` que anota e não calcula nada.
  const espiao = new Servidor({
    root: RAIZ,
    snapshotDir: SNAPSHOT,
    webDir: path.join(RAIZ, 'frontend', 'dist'),
    identifica: () => ({ usuario: 'sonda', papeis: ['autenticado'] }),
    reaquece: async (paginas) => {
      afetadas = [...paginas];
    },
  });
  try {
    for (const { query, tabela } of vigiadas()) {
      afetadas = [];
      espiao.aoTabelaMudar(tabela, query);
      // Dá a volta do event loop para o `reaquece` correr e a guarda de "um de
      // cada vez" se soltar antes da próxima query.
      await new Promise((ok) => setTimeout(ok, 5));
      por.set(query, afetadas);
    }
  } finally {
    espiao.destroi();
  }
  return por;
}

async function rodada(
  nome: string,
  comReaquecimento: boolean,
  alvo: { query: string; tabela: string },
  paginas: string[],
): Promise<void> {
  console.log(`
${'='.repeat(72)}
  RODADA: ${nome}
${'='.repeat(72)}`);
  const b = await sobe(comReaquecimento);
  try {
    // DUAS páginas, e é isso que separa as duas pessoas medidas abaixo.
    //
    // `olhando` é a do usuário com a tela aberta — a ÚLTIMA do lote a ser
    // reaquecida, o pior caso. `outra` é a que NINGUÉM pediu depois do evento:
    // sem ela, a pessoa B acertaria o cache que a própria pessoa A encheu ao
    // pagar o cálculo, e a sonda daria HIT nas duas rodadas — medindo o
    // usuário A, não o reaquecimento. Foi o segundo defeito desta sonda.
    const olhando = paginas[paginas.length - 1]!;
    const outra = paginas.find((x) => x !== olhando) ?? olhando;
    const url = await urlDaTela(b.porta, olhando);
    const urlOutra = await urlDaTela(b.porta, outra);

    // 1) O estado de produção: tudo quente antes de o evento chegar.
    const t0 = Date.now();
    await b.aquecedor.reaquece(paginas);
    console.log(`  aquecimento inicial de ${paginas.length} página(s): ${((Date.now() - t0) / 1000).toFixed(1)} s`);

    const antes = await pede(url);
    console.log(`  confere: ${olhando} está ${antes.cache} em ${antes.ms} ms`);
    if (antes.cache !== 'hit') {
      console.log('  !! a sonda pede uma chave que o aquecedor não enche — a medida abaixo não vale');
    }

    // 2) O evento — o que o poller chamaria ao achar mudança no Voalle.
    const sse = await esperaEvento(b.porta, olhando);
    const tEvento = Date.now();
    b.servidor.aoTabelaMudar(alvo.tabela, alvo.query);

    // 3) PESSOA A — está com a tela aberta. É avisada e pede na hora.
    const tAviso = await sse.pronto;
    const daTelaAberta = await pede(url);
    sse.fecha();
    console.log(`
  [A] quem está com a tela ABERTA`);
    console.log(`      evento -> SSE ........ ${((tAviso - tEvento) / 1000).toFixed(1)} s`);
    console.log(`      SSE -> resposta ...... ${(daTelaAberta.ms / 1000).toFixed(1)} s  (${daTelaAberta.cache})`);
    console.log(`      evento -> tela ....... ${((tAviso - tEvento + daTelaAberta.ms) / 1000).toFixed(1)} s`);

    // 4) PESSOA B — chega DEPOIS, sem ter visto evento nenhum. É a maioria dos
    //    acessos, e é para ela que o reaquecimento existe. Esperar o
    //    reaquecimento acabar não é trapaça: é a situação real de quem abre a
    //    página um minuto depois de o poller ter achado a mudança.
    if (comReaquecimento) await esperaReaquecimento(b.porta);
    const dePoisDepois = await pede(urlOutra);
    console.log(`
  [B] quem CHEGA DEPOIS e abre '${outra}' (que ninguém pediu)`);
    console.log(`      resposta ............. ${(dePoisDepois.ms / 1000).toFixed(1)} s  (${dePoisDepois.cache})`);

    const saude = (await (await fetch(`http://127.0.0.1:${b.porta}/api/saude`)).json()).realtime as {
      contadores: Record<string, number>;
      duracoes: Record<string, { n: number; p50Ms: number; p95Ms: number; maxMs: number }>;
    };
    const c = saude.contadores;
    console.log(
      `
  primeiro GET pós-evento: ` +
        `${c.primeiro_get_pos_evento_hit ?? 0} hit / ${c.primeiro_get_pos_evento_miss ?? 0} miss`,
    );
    if (c.rewarm_pedidos) {
      console.log(
        `  reaquecimento: ${c.rewarm_sucesso ?? 0} ok, ${c.rewarm_falha ?? 0} falha, ` +
          `${c.rewarm_paginas ?? 0} página(s)`,
      );
      const d = saude.duracoes.rewarm_ms;
      if (d) console.log(`  rewarm_ms: p50 ${d.p50Ms}  max ${Math.round(d.maxMs)}`);
    } else {
      console.log('  reaquecimento: desligado');
    }
  } finally {
    await b.fecha();
  }
}

/** Espera o reaquecimento terminar pela própria saúde — sem cronômetro chutado. */
async function esperaReaquecimento(porta: number): Promise<void> {
  const limite = Date.now() + 180_000;
  for (;;) {
    const s = (await (await fetch(`http://127.0.0.1:${porta}/api/saude`)).json()).realtime as {
      contadores: Record<string, number>;
    };
    if ((s.contadores.rewarm_sucesso ?? 0) + (s.contadores.rewarm_falha ?? 0) > 0) return;
    if (Date.now() > limite) throw new Error('o reaquecimento não terminou em 180 s');
  }
}

// ---------------------------------------------------------------------------

console.log('  Custo de um evento: quantas páginas cada query vigiada derruba');
const custo = await custoPorEvento();
for (const [query, paginas] of custo) {
  console.log(`  ${query.padEnd(26)} ${String(paginas.length).padStart(2)} página(s)`);
}

const escolhida = opcao('--query=', '');
const alvo = vigiadas().find((v) => (escolhida ? v.query === escolhida : (custo.get(v.query)?.length ?? 0) > 0));
if (!alvo) {
  console.error('\n  Nenhuma query vigiada derruba página nenhuma — nada a medir.');
  process.exit(0);
}
const paginas = custo.get(alvo.query) ?? [];
console.log(`\n  Medindo com '${alvo.query}' (${paginas.length} página(s)): ${paginas.join(', ')}`);

await rodada('sem reaquecimento — a cadeia de antes da F4', false, alvo, paginas);
await rodada('com reaquecimento — a de agora', true, alvo, paginas);
process.exit(0);
