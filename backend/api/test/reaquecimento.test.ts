// F4 — depois de um evento do poller, a página fica pronta antes de alguém pedir.
//
// A CADEIA DE ANTES:
//
//   poller acha mudança -> invalida -> SSE -> GET -> MISS -> 10–20 s de cálculo
//   ...e o PRÓXIMO visitante paga tudo de novo, porque ninguém reaqueceu
//
// A DE AGORA:
//
//   poller acha mudança -> invalida -> SSE -> reaquecimento por baixo
//                                       |            |
//                              o usuário avisado     cache quente para
//                              paga a SUA página     quem chegar depois
//
// **A ordem contrária foi tentada, medida e descartada.** A ideia original da
// fase era `invalida -> reaquece -> SSE`, para que o evento significasse "há
// dado novo PRONTO". Contra o snapshot de verdade
// (`npm run probe:reaquecimento`), um evento de `protocolos-telefonia` derruba
// 3 páginas e o número saiu invertido:
//
//     sem reaquecimento   SSE 0,0 s + resposta 2,0 s (miss) = 2,0 s
//     segurando o SSE     SSE 9,7 s + resposta 0,0 s (hit)  = 9,7 s
//
// O acerto de cache é real e não paga a espera — quem está com a página aberta
// acabava esperando as OUTRAS páginas do lote. Avisar por página também foi
// tentado, e não resolve: alguém é sempre o último do lote.
//
// Por isso os dois testes que mais importam aqui são de coisas OPOSTAS:
//
//   1. `o aviso NÃO espera o reaquecimento` — a regressão que a sonda pegou.
//   2. `quem chega depois do evento encontra a página pronta` — o ganho da fase.
//
// REGRA DE SAÍDA: nenhuma asserção aqui imprime valor de linha.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { escreve } from '../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto } from '../../packages/snapshot/src/manifesto.ts';
import { Servidor } from '../src/servidor.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(AQUI, '..', '..', '..');
const WEB = path.join(ROOT, 'frontend', 'dist');
const AGORA = new Date('2026-08-07T12:00:00.000Z');

/** A tabela que a página `capa` carrega — o par (tabela, query) do poller. */
const TABELA = 'HORA ATUALIZADO';
const QUERY = 'hora-atualizado';

async function dirComCapa(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reaquece-'));
  const linha = {
    datahora: new Date('2026-08-07T10:34:00.000Z'),
    data: new Date('2026-08-07T00:00:00.000Z'),
    hora: new Date('1899-12-30T10:34:00.000Z'),
  };
  const cab = await escreve(
    arquivoDaQuery(dir, QUERY),
    { query: QUERY, tabelas: [TABELA], geradoEm: '2026-08-07T11:00:00.000Z' },
    ['datahora', 'data', 'hora'],
    [linha],
  );
  await escreveManifesto(dir, [
    { query: QUERY, tabelas: cab.tabelas, linhas: 1, colunas: 3, bytes: 200, geradoEm: cab.geradoEm },
  ]);
  return dir;
}

interface Bancada {
  servidor: Servidor;
  busca: (rota: string) => Promise<Response>;
  /** O GET que o `Aquecedor` de verdade faria: cabeçalho interno, classe `warmup`. */
  comoAquecedor: (rota: string) => Promise<Response>;
  metricas: () => Promise<Record<string, number>>;
  fecha: () => Promise<void>;
}

/**
 * Sobe o servidor com o `reaquece` que o teste quiser.
 *
 * `undefined` não passa a opção — é o caminho de antes da F4, e é assim que
 * todo teste antigo continua vendo o mundo.
 */
async function sobe(
  reaquece?: (paginas: readonly string[], b: () => Bancada) => Promise<void>,
): Promise<Bancada> {
  // O `reaquece` precisa da própria bancada (ele bate na API por HTTP, como o
  // Aquecedor de verdade), e a bancada só existe depois do `listen` — o mesmo
  // nó que `index.ts` desata com um `let`.
  let eu: Bancada;
  const servidor = new Servidor({
    root: ROOT,
    snapshotDir: await dirComCapa(),
    webDir: WEB,
    agora: () => AGORA,
    identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }),
    ...(reaquece ? { reaquece: (paginas: readonly string[]) => reaquece(paginas, () => eu) } : {}),
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  const busca = (rota: string): Promise<Response> => fetch(`http://127.0.0.1:${port}${rota}`);
  eu = {
    servidor,
    busca,
    comoAquecedor: (rota) =>
      fetch(`http://127.0.0.1:${port}${rota}`, {
        headers: { 'x-aquecedor-interno': servidor.segredoInterno() },
      }),
    metricas: async () => (await (await busca('/api/saude')).json()).realtime.contadores,
    // `closeAllConnections`: o SSE fica aberto de propósito, e `http.close()`
    // sozinho esperaria por ele para sempre.
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.close(() => ok());
        http.closeAllConnections();
      }),
  };
  return eu;
}

/** Abre o SSE e devolve um leitor já posicionado depois do `: conectado`. */
async function abreSse(b: Bancada): Promise<{
  esperaPor: (pagina: string) => Promise<number>;
  fecha: () => Promise<void>;
}> {
  const resp = await b.busca('/api/eventos');
  const leitor = resp.body!.getReader();
  const primeira = await leitor.read();
  assert.match(Buffer.from(primeira.value!).toString(), /^: conectado/);
  // Um `read()` não é um evento: dois eventos podem chegar no mesmo pedaço (no Linux,
  // chegavam), e um evento pode vir partido. O que separa eventos no SSE é a linha em
  // branco — então acumula e corta nela.
  let pendente = '';
  const proximo = async (): Promise<string[]> => {
    for (;;) {
      const fim = pendente.indexOf('\n\n');
      if (fim < 0) {
        const { value } = await leitor.read();
        pendente += Buffer.from(value!).toString();
        continue;
      }
      const evento = pendente.slice(0, fim);
      pendente = pendente.slice(fim + 2);
      // O batimento (`: `) não é evento — pular é o que impede este helper de
      // devolver "nada mudou" como se fosse mudança.
      if (!evento.startsWith('data: ')) continue;
      return (JSON.parse(evento.slice('data: '.length).trim()) as { dashboards: string[] }).dashboards;
    }
  };
  return {
    esperaPor: async (pagina) => {
      for (;;) {
        if ((await proximo()).includes(pagina)) return Date.now();
      }
    },
    fecha: () => leitor.cancel(),
  };
}

/** Um reaquecimento de verdade: os mesmos GETs que o `Aquecedor` faria. */
const reaquecendoDeVerdade = async (paginas: readonly string[], bancada: () => Bancada): Promise<void> => {
  for (const p of paginas) await bancada().comoAquecedor(`/api/dashboards/${p}`);
};

// ---------------------------------------------------------------------------
// O CONTROLE: sem reaquecimento, nada mudou
// ---------------------------------------------------------------------------

test('sem `reaquece`, a cadeia continua a de antes: invalida, avisa, e o GET é MISS', async () => {
  // Este teste é o que impede a F4 de "passar" por ter quebrado o caminho
  // padrão. Ele tem de ficar VERDE mesmo com toda a F4 arrancada.
  const b = await sobe();
  try {
    const sse = await abreSse(b);
    await b.busca('/api/dashboards/capa');
    assert.equal((await (await b.busca('/api/dashboards/capa')).json()).cache, 'hit');

    b.servidor.aoTabelaMudar(TABELA, QUERY);
    await sse.esperaPor('capa');

    assert.equal(
      (await (await b.busca('/api/dashboards/capa')).json()).cache,
      'miss',
      'sem reaquecimento, quem chega depois do evento paga o cálculo',
    );
    assert.equal((await b.metricas()).rewarm_pedidos, undefined, 'nem devia ter tentado reaquecer');
    await sse.fecha();
  } finally {
    await b.fecha();
  }
});

// ---------------------------------------------------------------------------
// O GANHO DA FASE
// ---------------------------------------------------------------------------

test('quem chega DEPOIS do evento encontra a página pronta — e isso é contado', async () => {
  // O que a F4 entrega. Não é para quem está com a tela aberta (esse é avisado
  // na hora e paga a própria página, com prioridade de clique); é para o
  // visitante seguinte, que antes pagava 10–20 s por um recálculo que ninguém
  // tinha feito.
  const b = await sobe(reaquecendoDeVerdade);
  try {
    b.servidor.aoTabelaMudar(TABELA, QUERY);
    // Espera o reaquecimento terminar pela própria saúde, sem cronometrar nada. 30 s e
    // não 10: desde a reserva de worker (ACHADOS #163) o fundo usa uma worker só, e na
    // suíte inteira — arquivos em paralelo — os 10 s estouraram duas vezes seguidas.
    // O que se afirma é que o reaquecimento ACONTECE e é contado, não quanto demora.
    const limite = Date.now() + 30_000;
    while (!(await b.metricas()).rewarm_sucesso) {
      if (Date.now() > limite) throw new Error('o reaquecimento não terminou');
    }

    const r = await (await b.busca('/api/dashboards/capa')).json();
    assert.equal(r.cache, 'hit', 'o reaquecimento não encheu a chave que a tela pede');

    const m = await b.metricas();
    assert.equal(m.primeiro_get_pos_evento_hit, 1);
    assert.equal(m.primeiro_get_pos_evento_miss, undefined);
    assert.equal(m.rewarm_falha, undefined);
    assert.ok((m.rewarm_paginas ?? 0) > 1, 'o evento derruba mais de uma página');
  } finally {
    await b.fecha();
  }
});

// ---------------------------------------------------------------------------
// A REGRESSÃO QUE A SONDA PEGOU
// ---------------------------------------------------------------------------

test('o aviso NÃO espera o reaquecimento — nem o do lote, nem o da própria página', async () => {
  // O DEFEITO QUE ISTO GUARDA, e ele já existiu: a primeira versão da F4
  // segurava o SSE até o reaquecimento terminar. Medido contra o snapshot de
  // verdade, isso levou `evento -> tela` de 2,0 s para 9,7 s — a fase tinha
  // conseguido piorar a experiência que veio consertar.
  //
  // Aqui o reaquecimento fica PRESO e nunca termina. O aviso tem de sair assim
  // mesmo, na mesma volta do event loop em que o poller chamou.
  let solta: () => void = () => {};
  const preso = new Promise<void>((ok) => {
    solta = ok;
  });
  const b = await sobe(async () => {
    await preso;
  });
  try {
    const sse = await abreSse(b);
    const antes = Date.now();
    b.servidor.aoTabelaMudar(TABELA, QUERY);
    const avisado = await sse.esperaPor('capa');

    assert.ok(
      avisado - antes < 1000,
      `o aviso levou ${avisado - antes} ms — está preso atrás do reaquecimento`,
    );
    assert.equal((await b.metricas()).rewarm_sucesso, undefined, 'o reaquecimento ainda nem terminou');
    await sse.fecha();
  } finally {
    solta();
    await b.fecha();
  }
});

test('reaquecimento que FALHA não muda nada do que o usuário vê', async () => {
  // Sem o reaquecimento, o pior caso é o comportamento de antes da F4 — e ele é
  // aceitável. O que NÃO pode é a falha aparecer como silêncio: o aviso já saiu
  // antes de o reaquecimento sequer começar, e a falha vira contador e linha.
  const b = await sobe(async () => {
    throw new Error('o reaquecimento explodiu');
  });
  try {
    const sse = await abreSse(b);
    b.servidor.aoTabelaMudar(TABELA, QUERY);
    await sse.esperaPor('capa');

    const limite = Date.now() + 5000;
    while (!(await b.metricas()).rewarm_falha) {
      if (Date.now() > limite) throw new Error('a falha não foi contada');
    }
    assert.equal((await b.metricas()).rewarm_sucesso, undefined);
    assert.equal(
      (await (await b.busca('/api/dashboards/capa')).json()).cache,
      'miss',
      'sem reaquecimento, o pior caso é o de antes da F4',
    );
    await sse.fecha();
  } finally {
    await b.fecha();
  }
});

// ---------------------------------------------------------------------------
// O RECORTE E A GUARDA
// ---------------------------------------------------------------------------

test('o reaquecimento recebe SÓ as páginas que perderam cache', async () => {
  // Não virar "mudou alguma coisa -> recalcula tudo". As outras páginas
  // continuam com cache válido, e reaquecê-las seria recalcular o que não
  // precisava.
  const pedidas: string[][] = [];
  const b = await sobe(async (paginas) => {
    pedidas.push([...paginas]);
  });
  try {
    b.servidor.aoTabelaMudar(TABELA, QUERY);
    await new Promise((ok) => setImmediate(ok));

    assert.equal(pedidas.length, 1);
    assert.ok(pedidas[0]!.includes('capa'), `capa devia estar: ${pedidas[0]!.join(', ')}`);
    assert.ok(pedidas[0]!.length < 20, 'não pode ser o site inteiro');

    // Uma query que ninguém usa não pode disparar reaquecimento nenhum.
    b.servidor.aoTabelaMudar('TABELA QUE NINGUEM USA', 'query-inexistente');
    await new Promise((ok) => setImmediate(ok));
    assert.equal(pedidas.length, 1, 'query sem página dependente não reaquece nada');
  } finally {
    await b.fecha();
  }
});

test('dois eventos seguidos: um reaquecimento de cada vez, e o segundo não se perde', async () => {
  // Sem a guarda, dois eventos em sequência dobrariam o pico de memória numa
  // máquina que já roda no limite. Com ela o segundo espera — mas espera de
  // verdade, e não é descartado: o dado dele ficou invalidado e frio, e cair
  // fora deixaria o próximo visitante pagando o cálculo.
  const rodadas: string[][] = [];
  let emCurso = 0;
  let picoSimultaneo = 0;
  let solta: () => void = () => {};
  const primeira = new Promise<void>((ok) => {
    solta = ok;
  });
  const b = await sobe(async (paginas) => {
    emCurso += 1;
    picoSimultaneo = Math.max(picoSimultaneo, emCurso);
    rodadas.push([...paginas]);
    if (rodadas.length === 1) await primeira;
    emCurso -= 1;
  });
  try {
    const sse = await abreSse(b);
    b.servidor.aoTabelaMudar(TABELA, QUERY);
    await new Promise((ok) => setImmediate(ok));

    // O segundo evento chega com o primeiro reaquecimento ainda no ar.
    b.servidor.aoTabelaMudar(TABELA, QUERY);
    await sse.esperaPor('capa');
    assert.equal((await b.metricas()).rewarm_adiado, 1);
    assert.equal(rodadas.length, 1, 'o segundo não podia começar por cima do primeiro');

    solta();
    await new Promise((ok) => setTimeout(ok, 10));
    assert.equal(rodadas.length, 2, 'o segundo tinha de rodar depois, não sumir');
    assert.equal(picoSimultaneo, 1, 'nunca dois reaquecimentos ao mesmo tempo');
    await sse.fecha();
  } finally {
    solta();
    await b.fecha();
  }
});

// ---------------------------------------------------------------------------
// A MÉTRICA QUE JULGA A FASE
// ---------------------------------------------------------------------------

test('primeiro_get_pos_evento: MISS quando o usuário chega antes do reaquecimento', async () => {
  // O caso que a F4 não resolve, e que precisa aparecer: o usuário avisado pelo
  // SSE que pede a página na hora. Nenhum reaquecimento ganha essa corrida — e
  // não precisa ganhar: esse pedido é `interactive`, passa na frente do
  // aquecimento (F3) e paga o custo da própria página.
  //
  // O valor de medir é saber com que frequência isso acontece: se for sempre,
  // o reaquecimento está gastando worker à toa.
  let solta: () => void = () => {};
  const preso = new Promise<void>((ok) => {
    solta = ok;
  });
  const b = await sobe(async () => {
    await preso;
  });
  try {
    b.servidor.aoTabelaMudar(TABELA, QUERY);
    assert.equal((await (await b.busca('/api/dashboards/capa')).json()).cache, 'miss');

    const m = await b.metricas();
    assert.equal(m.primeiro_get_pos_evento_miss, 1);
    assert.equal(m.primeiro_get_pos_evento_hit, undefined);
  } finally {
    solta();
    await b.fecha();
  }
});

test('o GET do AQUECEDOR não conta como o primeiro GET de gente', async () => {
  // O pedido do reaquecimento é, por construção, o MISS que a F4 existe para
  // pagar no lugar da pessoa. Deixá-lo consumir a marca faria a métrica medir o
  // próprio remédio e responder "miss" para sempre.
  const b = await sobe(async () => {
    /* não aquece nada: aqui só interessa quem consome a marca */
  });
  try {
    b.servidor.aoTabelaMudar(TABELA, QUERY);
    await new Promise((ok) => setImmediate(ok));

    await b.comoAquecedor('/api/dashboards/capa');
    const m = await b.metricas();
    assert.equal(m.primeiro_get_pos_evento_hit, undefined);
    assert.equal(
      m.primeiro_get_pos_evento_miss,
      undefined,
      'o pedido do aquecedor não é "o usuário precisou da página"',
    );

    // A marca continua de pé para quem realmente chegar depois — e agora acerta,
    // porque o aquecedor encheu o cache.
    assert.equal((await (await b.busca('/api/dashboards/capa')).json()).cache, 'hit');
    assert.equal((await b.metricas()).primeiro_get_pos_evento_hit, 1);
  } finally {
    await b.fecha();
  }
});

test('só o PRIMEIRO GET depois do evento é contado', async () => {
  // Contar os seguintes encheria a métrica de acertos de cache normais, que não
  // têm nada a ver com o evento.
  const b = await sobe(reaquecendoDeVerdade);
  try {
    b.servidor.aoTabelaMudar(TABELA, QUERY);
    const limite = Date.now() + 10_000;
    while (!(await b.metricas()).rewarm_sucesso) {
      if (Date.now() > limite) throw new Error('o reaquecimento não terminou');
    }

    await b.busca('/api/dashboards/capa');
    await b.busca('/api/dashboards/capa');
    await b.busca('/api/dashboards/capa');
    assert.equal((await b.metricas()).primeiro_get_pos_evento_hit, 1);
  } finally {
    await b.fecha();
  }
});
