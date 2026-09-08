// A validação de staging — a MESMA sonda contra o F0 e contra o F1–F5.
//
// **Por que caixa-preta.** As sondas das fases anteriores rodam em processo
// (`new Servidor(...)`) porque mediam decisões internas. Esta não pode: ela
// existe para responder se F1–F5 continuam valendo **dentro do container**, com
// Redis de verdade, snapshot bind-mountado e o refresh reescrevendo por baixo.
// Rodar em processo aqui seria medir o dev de novo e chamar de staging.
//
// E ela tem de rodar contra as DUAS versões. Por isso nada aqui depende de
// `/api/metricas` nem de `saude.carimbo`: o F0 não tem nenhum dos dois, e uma
// sonda que só roda depois da mudança não produz linha de base.
//
// **O que ela NÃO mede, e o motivo.** A morte de worker não é injetável por
// HTTP — `worker_threads` não são processos, então não há o que matar de fora
// do container. Esse caso fica com `piscina-ciclo-de-vida.test.ts` e a fixture
// `worker-que-morre.ts`, e está dito aqui para não parecer coberto.
//
// REGRA DE SAÍDA: nunca imprime valor de linha. Só id de página, contagem,
// status HTTP e tempo.
//
// Uso:
//   node tools/probe/src/staging.ts --base=http://127.0.0.1:3100
//   node tools/probe/src/staging.ts --so=prioridade      (logo apos subir a stack)
//   node tools/probe/src/staging.ts --so=evento --espera=600

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

async function saude(): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}/api/saude`);
  return (await r.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// identidade — qual das duas versões está atendendo?
// ---------------------------------------------------------------------------

if (SECOES.includes('identidade')) {
  const s = await saude();
  const temCarimbo = 'carimbo' in s;
  console.log(`  base: ${BASE}`);
  console.log(
    `  versão: ${temCarimbo ? 'F5 (a saúde publica a procedência do carimbo)' : 'F0/anterior (sem bloco `carimbo`)'}`,
  );
  console.log(`  bloco realtime na saúde: ${'realtime' in s ? 'sim' : 'não'}`);
  const snap = s['snapshot'] as { queries?: number; linhas?: number; dadoDe?: string } | undefined;
  if (snap) {
    console.log(
      `  snapshot: ${snap.queries} queries, ${snap.linhas?.toLocaleString('pt-BR')} linhas, mais antiga de ${snap.dadoDe}`,
    );
  }
  const aq = s['aquecimento'] as { ativo?: boolean; pronto?: boolean } | undefined;
  if (aq) console.log(`  aquecimento: ativo=${aq.ativo} pronto=${aq.pronto}`);
  if (temCarimbo) {
    const c = s['carimbo'] as {
      valor?: string;
      watch?: { status?: string };
      divergencias?: number;
    };
    console.log(`  carimbo: ${c.valor} — watch ${c.watch?.status}, ${c.divergencias} divergência(s)`);
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
// Só vale logo depois de subir a stack: a carga de `warmup` real é o próprio
// Aquecedor no arranque (44 s medidos no container). Fora dessa janela não há
// concorrência para medir, e a sonda diz isso em vez de inventar um número.

if (SECOES.includes('prioridade')) {
  const s = await saude();
  const aq = s['aquecimento'] as { ativo?: boolean; pronto?: boolean } | undefined;
  console.log('\n  PRIORIDADE — o clique enquanto o Aquecedor trabalha');
  if (aq?.pronto === true) {
    console.log('     (inconclusivo: o aquecimento já terminou — rode logo após `up -d`)');
  } else {
    const pagina = arg('pagina', 'visao-geral');
    const r = await pede(await urlDaTela(pagina));
    console.log(`     ${pagina}: HTTP ${r.status}, cache=${r.cache}, ${seg(r.ms)} com o aquecimento em curso`);
    console.log(
      '     leitura: no F0 este pedido espera o lote de aquecimento; com a fila por prioridade ele passa na frente',
    );
  }
}

// ---------------------------------------------------------------------------
// evento — o primeiro GET depois de um evento real do poller (F4)
// ---------------------------------------------------------------------------
//
// Este é o teste que o Erick chamou de mais importante da F4, e aqui ele roda
// contra o poller de VERDADE: nada é disparado pela sonda. Ela assina o SSE,
// espera o Voalle mudar sozinho e cronometra quem chega depois do aviso.

if (SECOES.includes('evento')) {
  console.log(`\n  EVENTO — assinando ${BASE}/api/eventos e esperando o poller (até ${seg(ESPERA_MS)})`);
  const freio = new AbortController();
  const timer = setTimeout(() => freio.abort(), ESPERA_MS);
  timer.unref?.();

  const medidas: { pagina: string; ms: number; cache: string }[] = [];
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
        // O navegador reage ao evento pedindo a página de novo. É exatamente
        // isso, e com a MESMA URL que a tela usa — pedir a chave crua mediria
        // uma chave que ninguém aquece (o erro que a sonda da F4 cometeu).
        const p = await pede(await urlDaTela(alvo));
        medidas.push({ pagina: alvo, ms: p.ms, cache: p.cache });
        console.log(`     evento -> ${alvo} (${dashboards.length} página(s)): ${p.cache} em ${seg(p.ms)}`);
        if (medidas.length >= 3) break laco;
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

  if (medidas.length === 0) {
    console.log('     nenhum evento na janela — o poller não viu mudança, ou o SSE não entregou.');
    console.log('     (confira no log do container: `[poller] ... mudou — invalidando ...`)');
  } else {
    const hits = medidas.filter((m) => m.cache === 'hit').length;
    const pior = Math.max(...medidas.map((m) => m.ms));
    console.log(`     ${hits}/${medidas.length} acertaram o cache; pior espera ${seg(pior)}`);
    console.log(
      `     leitura: ${
        hits === medidas.length
          ? 'o evento chegou com a página JÁ pronta — é o que a F4 promete'
          : 'quem chegou depois do evento pagou o recálculo — a forma do F0'
      }`,
    );
  }
}

process.exit(0);
