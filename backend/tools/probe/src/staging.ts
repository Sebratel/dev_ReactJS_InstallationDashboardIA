// A validação de staging — a MESMA sonda contra o F0 e contra o F1–F5.
//
// **Por que caixa-preta.** As sondas das fases anteriores rodam em processo
// (`new Servidor(...)`) porque mediam decisões internas. Esta não pode: ela
// existe para responder se F1–F5 continuam valendo **dentro do container**, com
// Redis de verdade, snapshot bind-mountado e o refresh reescrevendo por baixo.
// Rodar em processo aqui seria medir o dev de novo e chamar de staging.
//
// E ela tem de rodar contra as DUAS versões. Por isso a seção `rajada` não
// depende de métrica nenhuma: o F0 não publica `realtime`, e uma sonda que só
// roda depois da mudança não produz linha de base. A seção `evento` é a
// exceção declarada — ela julga a F4, que só existe na versão nova.
//
// **O que ela NÃO mede, e o motivo.** A morte de worker não é injetável por
// HTTP — `worker_threads` não são processos, então não há o que matar de fora
// do container. Esse caso fica com `piscina-ciclo-de-vida.test.ts` e a fixture
// `worker-que-morre.ts`, e está dito aqui para não parecer coberto.
//
// **A regra que manda na seção `evento`.** Ausência de evento NÃO é aprovação.
// Se a fonte não mudar na janela, a sonda diz "evento não observado" e recusa
// dar veredito — e nada aqui força um evento artificial, porque um evento
// fabricado não exercita `fonte real → detector real → evento real → F4 real`,
// que é a única coisa que esta medida existe para provar.
//
// REGRA DE SAÍDA: nunca imprime valor de linha. Só id de página, contagem,
// status HTTP e tempo.
//
// Uso:
//   node backend/tools/probe/src/staging.ts --base=http://127.0.0.1:3100
//   node backend/tools/probe/src/staging.ts --so=prioridade      (logo apos subir a stack)
//   node backend/tools/probe/src/staging.ts --so=evento --espera=600

import { codificaFiltro, filtrosPadrao } from '../../../packages/widget-engine/src/index.ts';
import { idsIniciais } from '../../layout/src/corte-eager.ts';
import type { LayoutSpec } from '../../layout/src/schema.ts';

const arg = (nome: string, padrao: string): string => {
  const p = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return p ? p.slice(nome.length + 3) : padrao;
};

const BASE = arg('base', 'http://127.0.0.1:3100').replace(/\/$/, '');
const SECOES = arg('so', 'identidade,rajada,evento').split(',').map((s) => s.trim());
const ESPERA_MS = Number.parseInt(arg('espera', '300'), 10) * 1000;
const RAJADA = Number.parseInt(arg('rajada', '6'), 10);
/** Quanto esperar o reaquecimento assentar antes de conferir os contadores. */
const ASSENTA_MS = Number.parseInt(arg('assenta', '45'), 10) * 1000;

const seg = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** A URL que a tela realmente pede: corte eager + os filtros com que a página abre. */
async function urlDaTela(pagina: string, mesesAtras = 0): Promise<string> {
  let ids: string[] = [];
  try {
    const r = await fetch(`${BASE}/api/dashboards/${encodeURIComponent(pagina)}/layout`);
    if (r.ok) ids = idsIniciais((await r.json()) as LayoutSpec);
  } catch {
    /* sem layout, cai para a página inteira — pior chave, nunca chave nenhuma */
  }
  // `mesesAtras > 0` desloca o filtro padrão para trás e produz uma chave que
  // NINGUÉM aqueceu — é assim que se consegue uma página fria sob demanda, sem
  // reiniciar a stack e sem inventar rota de invalidação numa API somente-GET.
  const hoje = new Date();
  hoje.setMonth(hoje.getMonth() - mesesAtras);
  const filtros = filtrosPadrao(pagina, hoje);
  const q = [
    ...ids.map((id) => `visual=${encodeURIComponent(id)}`),
    ...filtros.map((f) => `filtro=${encodeURIComponent(codificaFiltro(f))}`),
  ];
  return q.length > 0
    ? `${BASE}/api/dashboards/${pagina}?${q.join('&')}`
    : `${BASE}/api/dashboards/${pagina}`;
}

interface Pedido {
  ms: number;
  status: number;
  cache: string;
  erro?: string;
}

async function pede(url: string): Promise<Pedido> {
  const t0 = Date.now();
  try {
    const r = await fetch(url);
    const corpo = (await r.json().catch(() => ({}))) as { cache?: string; erro?: string };
    return {
      ms: Date.now() - t0,
      status: r.status,
      cache: corpo.cache ?? '?',
      ...(corpo.erro ? { erro: String(corpo.erro).slice(0, 80) } : {}),
    };
  } catch (err) {
    return {
      ms: Date.now() - t0,
      status: 0,
      cache: '?',
      erro: err instanceof Error ? err.message : String(err),
    };
  }
}

interface Saude {
  memoria?: { rssMB?: number; heapUsedMB?: number };
  carimbo?: { valor?: string; watch?: { status?: string }; divergencias?: number };
  cache?: { redis?: { status?: string; falhas?: number } };
  realtime?: {
    contadores?: Record<string, number>;
    duracoes?: Record<string, { n: number; maxMs: number; p95Ms: number }>;
    poller?: { voltas?: number; mudancas?: number; rebuscasSemMudanca?: number; erros?: number };
  };
  snapshot?: { queries?: number; linhas?: number; dadoDe?: string };
  aquecimento?: { ativo?: boolean; pronto?: boolean };
}

async function saude(): Promise<Saude> {
  const r = await fetch(`${BASE}/api/saude`);
  return (await r.json()) as Saude;
}

/** Um contador que ainda não foi incrementado não aparece na saúde — vale 0. */
const cont = (s: Saude, nome: string): number => s.realtime?.contadores?.[nome] ?? 0;
const dur = (s: Saude, nome: string): { n: number; maxMs: number; p95Ms: number } =>
  s.realtime?.duracoes?.[nome] ?? { n: 0, maxMs: 0, p95Ms: 0 };

// ---------------------------------------------------------------------------
// identidade — qual das duas versões está atendendo?
// ---------------------------------------------------------------------------

if (SECOES.includes('identidade')) {
  const s = await saude();
  const temCarimbo = s.carimbo !== undefined;
  console.log(`  base: ${BASE}`);
  console.log(
    `  versão: ${temCarimbo ? 'F5 (a saúde publica a procedência do carimbo)' : 'F0/anterior (sem bloco `carimbo`)'}`,
  );
  console.log(`  bloco realtime na saúde: ${s.realtime ? 'sim' : 'não'}`);
  if (s.snapshot) {
    console.log(
      `  snapshot: ${s.snapshot.queries} queries, ${s.snapshot.linhas?.toLocaleString('pt-BR')} linhas, mais antiga de ${s.snapshot.dadoDe}`,
    );
  }
  if (s.aquecimento) {
    console.log(`  aquecimento: ativo=${s.aquecimento.ativo} pronto=${s.aquecimento.pronto}`);
  }
  if (temCarimbo) {
    console.log(
      `  carimbo: ${s.carimbo?.valor} — watch ${s.carimbo?.watch?.status}, ${s.carimbo?.divergencias} divergência(s)`,
    );
  }
  const p = s.realtime?.poller;
  if (p) {
    console.log(
      `  poller: ${p.voltas} voltas, ${p.mudancas} mudança(s), ${p.rebuscasSemMudanca} rebusca(s) sem mudança, ${p.erros} erro(s)`,
    );
  }
}

// ---------------------------------------------------------------------------
// rajada — N pedidos IGUAIS numa chave fria (F2: single-flight)
// ---------------------------------------------------------------------------
//
// A pergunta: N pedidos idênticos viram N cálculos ou 1? Sem métrica, o sintoma
// visível é a PIOR espera — no F0 os pedidos se enfileiram e o último paga a
// soma; com single-flight todos terminam quase juntos, no tempo de um cálculo.

if (SECOES.includes('rajada')) {
  const pagina = arg('pagina', 'visao-geral');
  const url = await urlDaTela(pagina, 2);
  console.log(`\n  RAJADA — ${RAJADA} pedidos idênticos, chave fria (${pagina}, filtro deslocado 2 meses)`);

  const t0 = Date.now();
  const rs = await Promise.all(Array.from({ length: RAJADA }, () => pede(url)));
  const total = Date.now() - t0;

  const tempos = rs.map((r) => r.ms).sort((a, b) => a - b);
  const menor = tempos[0]!;
  const maior = tempos[tempos.length - 1]!;
  console.log(`     status: ${rs.map((r) => r.status).join(' ')}`);
  console.log(`     melhor ${seg(menor)}  |  pior ${seg(maior)}  |  relógio de parede ${seg(total)}`);
  console.log(`     cache: ${rs.map((r) => r.cache).join(' ')}`);
  const ruins = rs.filter((r) => r.status !== 200);
  if (ruins.length > 0) {
    console.log(`     ATENÇÃO: ${ruins.length} pedido(s) não devolveram 200 — ${ruins[0]!.erro ?? ''}`);
  }
  console.log(
    `     leitura: ${
      maior - menor < menor * 0.5
        ? 'terminaram JUNTOS — é a forma de 1 cálculo compartilhado'
        : 'espalhados — a forma de cálculos concorrentes disputando worker'
    } (espalhamento ${seg(maior - menor)})`,
  );

  // A segunda rodada na MESMA chave tem de ser quente. Se não for, o problema
  // não é a rajada — é o cache não estar pegando, e o número acima não diz nada.
  const conf = await pede(url);
  console.log(`     confere (mesma chave, depois): ${conf.cache} em ${seg(conf.ms)}`);
}

// ---------------------------------------------------------------------------
// prioridade — o clique durante o aquecimento (F3)
// ---------------------------------------------------------------------------
//
// Só vale logo depois de subir a stack, e mesmo assim mede pouco: o Aquecedor é
// SEQUENCIAL e ocupa 1 das 2 workers, então sobra sempre uma para o clique.
// Medido em 08/09/2026: 32,2 s no F0 contra 31,8 s com a fila por prioridade —
// e `fila_ms_interactive` em 0 nos dois, porque os 32 s eram o cálculo da
// página, não espera. A F3 protege contra piscina SATURADA; aquecimento não
// satura. Por isso esta seção imprime a fila junto do tempo: sem ela, o número
// sugere uma conclusão falsa.

if (SECOES.includes('prioridade')) {
  const s = await saude();
  console.log('\n  PRIORIDADE — o clique enquanto o Aquecedor trabalha');
  if (s.aquecimento?.pronto === true) {
    console.log('     (inconclusivo: o aquecimento já terminou — rode logo após `up -d`)');
  } else {
    const pagina = arg('pagina', 'visao-geral');
    const r = await pede(await urlDaTela(pagina));
    const depois = await saude();
    const fila = dur(depois, 'fila_ms_interactive');
    console.log(`     ${pagina}: HTTP ${r.status}, cache=${r.cache}, ${seg(r.ms)} com o aquecimento em curso`);
    console.log(`     fila_ms_interactive: n=${fila.n} max=${fila.maxMs} ms`);
    console.log(
      `     leitura: ${
        fila.maxMs > 1000
          ? 'o clique ESPEROU fila — é aqui que a prioridade aparece'
          : 'o clique não esperou fila; os segundos acima são cálculo, não espera (a F3 não é o que está sendo medido)'
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// evento — a cadeia da F4 sob um evento REAL do poller
// ---------------------------------------------------------------------------
//
// A promessa da F4, inteira:
//
//   evento real -> invalidação -> SSE -> GET interactive -> warmup concorrente
//               -> cache quente para quem chega DEPOIS
//
// Medir só "acertou o cache?" deixaria de fora os sete jeitos de isso dar certo
// pelo motivo errado. Por isso esta seção tira um retrato dos contadores ANTES,
// deixa o reaquecimento assentar, tira outro DEPOIS, e julga cada critério
// separadamente. O veredito é `REPROVA` se qualquer um falhar, e
// `SEM VEREDITO` se nenhum evento aparecer — nunca `APROVA` por ausência.

if (SECOES.includes('evento')) {
  console.log(`\n  EVENTO — assinando ${BASE}/api/eventos e esperando o poller (até ${seg(ESPERA_MS)})`);
  console.log('  (nada aqui dispara evento: a fonte é o Voalle, o detector é o poller)');

  const antes = await saude();
  const freio = new AbortController();
  const timer = setTimeout(() => freio.abort(), ESPERA_MS);
  timer.unref?.();

  /** Cada evento observado, com o que ele afetou e o que cada persona sentiu. */
  const eventos: {
    afetados: string[];
    aberta: { pagina: string; cache: string; ms: number };
    depois: { pagina: string; cache: string; ms: number } | null;
  }[] = [];

  try {
    const r = await fetch(`${BASE}/api/eventos`, { signal: freio.signal });
    if (!r.ok || !r.body) throw new Error(`SSE devolveu ${r.status}`);
    const leitor = r.body.getReader();
    const dec = new TextDecoder();
    let buffer = '';

    laco: for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      for (let corte = buffer.indexOf('\n\n'); corte >= 0; corte = buffer.indexOf('\n\n')) {
        const bruto = buffer.slice(0, corte);
        buffer = buffer.slice(corte + 2);
        if (!bruto.startsWith('data: ')) continue; // ': conectado' e ': batimento'
        const { dashboards } = JSON.parse(bruto.slice(6)) as { dashboards: string[] };
        const alvo = dashboards[0];
        if (!alvo) continue;

        // Persona A — a tela ABERTA. Recebeu o SSE e refez o pedido, com a
        // MESMA URL que a tela usa (pedir a chave crua mediria uma chave que
        // ninguém aquece: foi o erro da sonda da F4).
        const a = await pede(await urlDaTela(alvo));
        console.log(`     evento -> ${dashboards.length} página(s) afetada(s); [A] tela aberta em ${alvo}: ${a.cache} em ${seg(a.ms)}`);

        // Persona B — quem CHEGA DEPOIS, noutra página afetada. É ela que o
        // reaquecimento existe para servir; se B abrir a mesma página de A,
        // acerta o cache que A pagou e a medida não diz nada sobre a F4.
        const outra = dashboards.find((p) => p !== alvo);
        let b: typeof eventos[number]['depois'] = null;
        if (outra) {
          const rb = await pede(await urlDaTela(outra));
          b = { pagina: outra, cache: rb.cache, ms: rb.ms };
          console.log(`                [B] chega depois em ${outra}: ${rb.cache} em ${seg(rb.ms)}`);
        } else {
          console.log('                [B] este evento afetou 1 página só — sem página distinta para medir');
        }

        eventos.push({
          afetados: dashboards,
          aberta: { pagina: alvo, cache: a.cache, ms: a.ms },
          depois: b,
        });
        if (eventos.length >= 3) break laco;
      }
    }
  } catch (err) {
    if (!freio.signal.aborted) {
      console.log(`     falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    clearTimeout(timer);
    freio.abort();
  }

  if (eventos.length === 0) {
    const s = await saude();
    const p = s.realtime?.poller;
    console.log('\n     evento NÃO observado na janela.');
    if (p) {
      console.log(
        `     o poller girou ${(p.voltas ?? 0) - (antes.realtime?.poller?.voltas ?? 0)} volta(s) nesta janela, ` +
          `com ${p.erros} erro(s) — ${p.mudancas === antes.realtime?.poller?.mudancas ? 'a fonte ficou quieta' : 'houve mudança, e o SSE não entregou (INVESTIGAR)'}`,
      );
    }
    console.log('     SEM VEREDITO — ausência de evento não é aprovação. Repita em horário comercial.');
    process.exit(0);
  }

  // Deixa o reaquecimento assentar antes de ler os contadores: ele corre em
  // segundo plano de propósito (F4), então medir na hora mediria o meio dele.
  console.log(`\n     esperando ${seg(ASSENTA_MS)} para o reaquecimento assentar…`);
  await new Promise((ok) => setTimeout(ok, ASSENTA_MS));
  const depois = await saude();

  const d = (nome: string): number => cont(depois, nome) - cont(antes, nome);
  const afetadasNoTotal = eventos.reduce((n, e) => n + e.afetados.length, 0);
  const reprovas: string[] = [];
  const linha = (ok: boolean, texto: string): void => {
    console.log(`     ${ok ? 'ok  ' : 'NÃO '} ${texto}`);
    if (!ok) reprovas.push(texto);
  };

  console.log('\n     A CADEIA');
  const hits = d('primeiro_get_pos_evento_hit');
  const misses = d('primeiro_get_pos_evento_miss');
  linha(hits + misses > 0, `alguém chegou depois do evento e foi contado (${hits} hit, ${misses} miss)`);
  linha(d('rewarm_sucesso') > 0, `o reaquecimento rodou (${d('rewarm_sucesso')} sucesso, ${d('rewarm_falha')} falha)`);
  linha(d('rewarm_falha') === 0, `nenhum reaquecimento falhou`);
  console.log(`          rewarm_ms p95: ${dur(depois, 'rewarm_ms').p95Ms} ms; adiados: ${d('rewarm_adiado')}`);

  console.log('\n     OS SETE QUE REPROVAM');
  // 1. cálculo duplicado.
  //
  // **É uma guarda, não uma prova.** "1 voo por chave" é garantido por
  // construção em `VooUnico` (F2, com teste), e NÃO é diretamente observável
  // nesta janela: `singleflight_*` só é contado depois que o voo resolve — um
  // voo que erra retorna antes e não incrementa nenhum dos dois. Por isso
  // `iniciados + coalescidos <= misses` sempre, e a diferença são voos que
  // falharam (medido neste build: misses 7, iniciados 5, coalescidos 1). Exigir
  // a identidade exata reprovaria sozinha.
  //
  // E exigir `coalescidos > 0` também seria falso: se o reaquecimento rodar
  // DEPOIS do GET de [A], ele acha o cache que [A] encheu e não abre voo nenhum
  // — que é o desenho funcionando, não duplicação evitada.
  const iniciados = d('singleflight_iniciados');
  const coalescidos = d('singleflight_coalescidos');
  linha(
    iniciados <= d('cache_misses'),
    `sem assinatura de cálculo duplicado (voos iniciados ${iniciados} <= misses ${d('cache_misses')}; coalescidos ${coalescidos})`,
  );
  // 2. reaquecimento de página não afetada
  linha(
    d('rewarm_paginas') <= afetadasNoTotal,
    `reaqueceu só o afetado (${d('rewarm_paginas')} página(s) reaquecida(s) para ${afetadasNoTotal} afetada(s) anunciada(s))`,
  );
  // 3. falso evento — cada evento do SSE tem de ter uma mudança do poller atrás
  const mudou = (depois.realtime?.poller?.mudancas ?? 0) - (antes.realtime?.poller?.mudancas ?? 0);
  linha(mudou >= eventos.length, `sem falso evento (${mudou} mudança(s) no poller para ${eventos.length} evento(s))`);
  // 4. starvation do interactive
  const fila = dur(depois, 'fila_ms_interactive');
  linha(fila.p95Ms < 5000, `interactive não passou fome (fila p95 ${fila.p95Ms} ms, max ${fila.maxMs} ms)`);
  // 5. memória
  const rssAntes = antes.memoria?.rssMB ?? 0;
  const rssDepois = depois.memoria?.rssMB ?? 0;
  linha(rssDepois < rssAntes * 2 + 512, `memória sem crescimento anormal (RSS ${rssAntes} -> ${rssDepois} MB)`);
  // 6. Redis
  const falhasRedis = (depois.cache?.redis?.falhas ?? 0) - (antes.cache?.redis?.falhas ?? 0);
  linha(
    falhasRedis === 0 && depois.cache?.redis?.status === 'ok',
    `Redis sem falha (${falhasRedis} nova(s), status ${depois.cache?.redis?.status})`,
  );
  // 7. carimbo — o critério é divergência NOVA, e o absoluto vai junto.
  //
  // Reprovar pelo absoluto puniria o evento por uma divergência de horas antes,
  // que não tem relação com ele. Mas o absoluto precisa aparecer: `0 novas` com
  // `3 no total` é uma API que já esteve servindo carimbo velho hoje, e quem lê
  // o veredito tem de ver isso sem ir procurar em `/api/saude`.
  const divAbs = depois.carimbo?.divergencias ?? 0;
  const divergiu = divAbs - (antes.carimbo?.divergencias ?? 0);
  linha(
    divergiu === 0,
    `carimbo consistente (${divergiu} divergência(s) nova(s), ${divAbs} no total desde a subida; watch ${depois.carimbo?.watch?.status})`,
  );
  if (divergiu === 0 && divAbs > 0) {
    console.log('          atenção: houve divergência ANTES desta janela — ver §4-F antes de promover');
  }

  console.log('\n     AS DUAS PESSOAS');
  for (const e of eventos) {
    console.log(
      `       [A] ${e.aberta.pagina}: ${e.aberta.cache} em ${seg(e.aberta.ms)}` +
        (e.depois ? `   [B] ${e.depois.pagina}: ${e.depois.cache} em ${seg(e.depois.ms)}` : '   [B] —'),
    );
  }
  const bs = eventos.map((e) => e.depois).filter((x): x is NonNullable<typeof x> => x !== null);
  if (bs.length > 0) {
    const bHits = bs.filter((b) => b.cache === 'hit').length;
    linha(bHits === bs.length, `quem chega depois encontra a página PRONTA (${bHits}/${bs.length} hit)`);
  } else {
    console.log('     (nenhum evento afetou 2+ páginas — a persona B não pôde ser medida)');
  }

  console.log(
    `\n     VEREDITO: ${reprovas.length === 0 ? 'APROVA — a cadeia da F4 vale sob evento real' : `REPROVA em ${reprovas.length} critério(s)`}`,
  );
  for (const r of reprovas) console.log(`       - ${r}`);
}

process.exit(0);
