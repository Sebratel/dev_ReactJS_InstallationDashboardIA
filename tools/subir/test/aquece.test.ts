// O aquecimento tem de reprovar. Este arquivo é sobre as três formas de reprovar.
//
// O antecessor era `tools/aquece.sh`, e o teste dele era rodá-lo. Um script que só se
// verifica subindo a API inteira não se verifica: ninguém roda o caminho triste de
// propósito, então o caminho triste é o que nunca foi exercitado. Aqui o `fetch` é
// injetado e os três casos ruins — visual com erro, cache que não pegou, pedido que
// falhou — são exercitados em milissegundos.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aquece,
  aquecePagina,
  linhaDaMedida,
  listaPaginas,
  veredito,
  type Medida,
} from '../src/aquece.ts';

/** Um `fetch` de mentira: mapa de URL para corpo, e conta quantas vezes cada uma veio. */
function fetchFalso(
  rotas: Record<string, unknown | ((n: number) => unknown)>,
  status: Record<string, number> = {},
): { buscar: typeof fetch; chamadas: Map<string, number> } {
  const chamadas = new Map<string, number>();
  const buscar = (async (url: string | URL | Request) => {
    const u = String(url);
    const n = (chamadas.get(u) ?? 0) + 1;
    chamadas.set(u, n);
    const bruto = rotas[u];
    if (bruto === undefined) throw new TypeError(`fetch failed: ${u}`);
    const corpo = typeof bruto === 'function' ? (bruto as (n: number) => unknown)(n) : bruto;
    const texto = JSON.stringify(corpo);
    return {
      ok: (status[u] ?? 200) < 400,
      status: status[u] ?? 200,
      json: async () => JSON.parse(texto) as unknown,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response;
  }) as unknown as typeof fetch;
  return { buscar, chamadas };
}

const BASE = 'http://localhost:3100';
const pag = (id: string): string => `${BASE}/api/dashboards/${id}`;

/** Um relógio que anda um passo fixo a cada leitura — tempos afirmáveis. */
function relogio(passos: number[]): () => number {
  let i = 0;
  return () => passos[Math.min(i++, passos.length - 1)]!;
}

// ---------------------------------------------------------------------------
// A medida
// ---------------------------------------------------------------------------

/**
 * **O teste central: a medida "a quente" é a da SEGUNDA chamada.** A primeira enche o
 * cache; medir só ela reportaria sempre o tempo ruim, e ler o `cache` dela reportaria
 * `miss` sempre — escondendo justamente a falha que este programa deveria pegar.
 */
test('mede duas chamadas e reporta a segunda como "a quente"', async () => {
  const { buscar, chamadas } = fetchFalso({
    [pag('visao-geral')]: (n: number) => ({
      visuais: [{}, {}, {}],
      cache: n === 1 ? 'miss' : 'hit',
    }),
  });
  const m = await aquecePagina('visao-geral', {
    base: BASE, buscar, agora: relogio([0, 2000, 2050]),
  });
  assert.equal(chamadas.get(pag('visao-geral')), 2, 'exatamente duas chamadas');
  assert.equal(m.frio, 2000);
  assert.equal(m.quente, 50);
  assert.equal(m.visuais, 3);
  assert.equal(m.erros, 0);
  assert.equal(m.cache, 'hit', 'o cache lido é o da segunda — a primeira é sempre miss');
});

test('visual com erro é contado, não ignorado', async () => {
  const { buscar } = fetchFalso({
    [pag('p')]: { visuais: [{}, { erro: 'Coluna não existe' }, { erro: 'x' }], cache: 'hit' },
  });
  const m = await aquecePagina('p', { base: BASE, buscar, agora: relogio([0, 1, 2]) });
  assert.equal(m.visuais, 3);
  assert.equal(m.erros, 2);
});

test('pedido que falha vira medida com falha, não exceção', async () => {
  const { buscar } = fetchFalso({});
  const m = await aquecePagina('some', { base: BASE, buscar, agora: relogio([0, 10]) });
  assert.match(m.falha!, /fetch failed/);
  assert.equal(m.visuais, 0);
});

test('HTTP 500 na segunda chamada também é falha', async () => {
  const { buscar } = fetchFalso({ [pag('p')]: { visuais: [] } }, { [pag('p')]: 500 });
  const m = await aquecePagina('p', { base: BASE, buscar, agora: relogio([0, 1, 2]) });
  assert.equal(m.falha, 'HTTP 500');
});

// ---------------------------------------------------------------------------
// O corte eager (Fase L5, R4) — aquecer a chave que o navegador REALMENTE pede
// ---------------------------------------------------------------------------

const layoutUrl = (id: string): string => `${pag(id)}/layout`;
const layoutFalso = (
  faixas: { colunas: { visual: string }[] }[],
  kpis: { visual: string }[] = [],
) => ({ pagina: 'x', base: 'x', kpis, faixas, ocultos: [], improvements: [] });

test('com layout disponível, aquece com `?visual=` — a MESMA chave que o navegador pede', async () => {
  const idPagina = 'agendamento-field';
  // 5 faixas: só as 4 primeiras (g1, t1, t2, g2) entram no corte eager — igual a `idsIniciais`.
  const layout = layoutFalso(
    [
      { colunas: [{ visual: 'g1' }] },
      { colunas: [{ visual: 't1' }] },
      { colunas: [{ visual: 't2' }] },
      { colunas: [{ visual: 'g2' }] },
      { colunas: [{ visual: 'm1' }] },
    ],
    [{ visual: 'k1' }],
  );
  const urlEsperada = `${pag(idPagina)}?visual=k1&visual=g1&visual=t1&visual=t2&visual=g2`;
  const { buscar, chamadas } = fetchFalso({
    [layoutUrl(idPagina)]: layout,
    [urlEsperada]: (n: number) => ({ visuais: [{}, {}, {}, {}, {}], cache: n === 1 ? 'miss' : 'hit' }),
  });

  const m = await aquecePagina(idPagina, { base: BASE, buscar, agora: relogio([0, 100, 105]) });

  assert.equal(chamadas.get(urlEsperada), 2, 'a URL com o corte eager foi chamada duas vezes');
  assert.equal(chamadas.get(pag(idPagina)), undefined, 'a URL SEM corte — a chave errada — não foi tocada');
  assert.equal(m.cache, 'hit');
});

test('sem layout disponível (rede falhou), cai de volta para a URL antiga — não trava a subida', async () => {
  const { buscar, chamadas } = fetchFalso({
    [pag('p')]: (n: number) => ({ visuais: [{}], cache: n === 1 ? 'miss' : 'hit' }),
  });
  const m = await aquecePagina('p', { base: BASE, buscar, agora: relogio([0, 1, 2]) });
  assert.equal(chamadas.get(pag('p')), 2, 'o fallback ainda aquece a página, só que na chave antiga');
  assert.equal(m.cache, 'hit');
});

test('layout com formato inesperado (sem kpis/faixas) também cai de volta, sem lançar', async () => {
  const { buscar, chamadas } = fetchFalso({
    [layoutUrl('p')]: { visuais: [], cache: 'hit' }, // corpo de PÁGINA, não de layout
    [pag('p')]: (n: number) => ({ visuais: [{}], cache: n === 1 ? 'miss' : 'hit' }),
  });
  const m = await aquecePagina('p', { base: BASE, buscar, agora: relogio([0, 1, 2]) });
  assert.equal(chamadas.get(pag('p')), 2);
  assert.equal(m.cache, 'hit');
});

// ---------------------------------------------------------------------------
// A lista e a ordem
// ---------------------------------------------------------------------------

test('lista as páginas que a API declara', async () => {
  const { buscar } = fetchFalso({
    [`${BASE}/api/dashboards`]: { dashboards: [{ id: 'a' }, { id: 'b' }] },
  });
  assert.deepEqual(await listaPaginas(BASE, buscar), ['a', 'b']);
});

/**
 * As três páginas de DICA do relatório original não entram no ciclo de subida.
 *
 * São `type: Tooltip`: 550x400, um visual, exibidas ao pairar sobre outro visual.
 * Ocupavam três das catorze linhas da tabela do `npm start` e ~2,4 s de cada subida.
 *
 * Este teste existe em DOIS lugares de propósito — o irmão é
 * `apps/api/test/aquecedor.test.ts`. São dois aquecedores diferentes, e em 18/09/2026
 * consertar só o de dentro da API deixou as três voltando pela porta do `npm start`.
 */
test('a lista do arranque pula as páginas de dica, e só elas', async () => {
  const { buscar } = fetchFalso({
    [`${BASE}/api/dashboards`]: {
      dashboards: [
        { id: 'capa', tooltip: false },
        { id: 'l-inst', tooltip: true },
        // Sem o campo: API velha, e aí o certo é aquecer.
        { id: 'visao-geral' },
        { id: 'l-tec', tooltip: true },
      ],
    },
  });
  assert.deepEqual(await listaPaginas(BASE, buscar), ['capa', 'visao-geral']);
});

/**
 * O contrapeso: uma lista SÓ de dicas continua sendo "não listou página nenhuma".
 * Aquecer zero páginas em silêncio é exatamente o que o teste abaixo proíbe.
 */
test('lista só com páginas de dica erra alto, não aquece zero em silêncio', async () => {
  const { buscar } = fetchFalso({
    [`${BASE}/api/dashboards`]: { dashboards: [{ id: 'l-inst', tooltip: true }] },
  });
  await assert.rejects(() => listaPaginas(BASE, buscar), /não listou página nenhuma/);
});

test('API que não lista página nenhuma erra alto — não "aquece zero páginas com sucesso"', async () => {
  const { buscar } = fetchFalso({ [`${BASE}/api/dashboards`]: { dashboards: [] } });
  await assert.rejects(() => listaPaginas(BASE, buscar), /não listou página nenhuma/);
});

/**
 * Uma de cada vez. A API é um processo só, e carregar duas páginas ao mesmo tempo
 * dobra o pico de memória numa máquina de 16 GB — a armadilha que custou uma manhã
 * em 10/08.
 */
test('aquece uma página de cada vez, na ordem, e avisa a cada uma', async () => {
  let vivos = 0;
  let piorSimultaneo = 0;
  const buscar = (async (url: string | URL) => {
    vivos++;
    piorSimultaneo = Math.max(piorSimultaneo, vivos);
    await new Promise((r) => setTimeout(r, 1));
    vivos--;
    void url;
    return {
      ok: true, status: 200,
      json: async () => ({ visuais: [{}], cache: 'hit' }),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response;
  }) as unknown as typeof fetch;

  const vistas: string[] = [];
  const medidas = await aquece({
    base: BASE, buscar, paginas: ['a', 'b', 'c'], aoMedir: (m) => vistas.push(m.pagina),
  });
  assert.deepEqual(medidas.map((m) => m.pagina), ['a', 'b', 'c']);
  assert.deepEqual(vistas, ['a', 'b', 'c'], 'a linha sai na hora, não só no fim');
  assert.equal(piorSimultaneo, 1, 'nunca dois pedidos ao mesmo tempo');
});

// ---------------------------------------------------------------------------
// O veredito — é ele que decide se dá para apresentar
// ---------------------------------------------------------------------------

function medida(extra: Partial<Medida> = {}): Medida {
  return { pagina: 'p', frio: 1000, quente: 50, visuais: 5, erros: 0, cache: 'hit', ...extra };
}

test('tudo quente e sem erro aprova', () => {
  const v = veredito([medida(), medida({ pagina: 'q', frio: 3000 })]);
  assert.equal(v.ok, true);
  assert.match(v.mensagem, /Todas as páginas quentes e sem erro/);
  assert.equal(v.pior?.pagina, 'q', 'a mais lenta a frio é a que dita a subida');
});

test('visual com erro reprova, e a mensagem manda olhar', () => {
  const v = veredito([medida({ erros: 2 })]);
  assert.equal(v.ok, false);
  assert.match(v.mensagem, /2 visual\(is\) com erro/);
  assert.match(v.mensagem, /NÃO apresente sem olhar/);
});

/**
 * Cache que não pegou reprova. A segunda abertura é o que a regra 9 orça em 300 ms, e
 * um `miss` ali quer dizer que o carimbo do snapshot está mudando sozinho — que é um
 * problema, não uma lentidão.
 */
test('cache que não pegou reprova', () => {
  const v = veredito([medida({ cache: 'miss' })]);
  assert.equal(v.ok, false);
  assert.match(v.mensagem, /1 página\(s\) sem acerto de cache/);
});

test('página que não respondeu reprova, e não conta como sem-cache', () => {
  const v = veredito([medida({ falha: 'fetch failed', cache: '?' })]);
  assert.equal(v.ok, false);
  assert.equal(v.falhas, 1);
  assert.equal(v.friasSemCache, 0, 'quem não respondeu não é caso de cache');
});

// ---------------------------------------------------------------------------
// O teto por página
// ---------------------------------------------------------------------------

/**
 * **Uma página cara não pode virar uma subida travada.** Sem o teto, uma página de 40
 * min deixa `npm start` com um cursor parado e sem uma palavra sobre o que acontece —
 * e quem está apresentando não tem como saber se espera ou se reinicia.
 */
test('página que passa do teto vira falha nomeada, não espera infinita', async () => {
  const buscar = (async (_url: string | URL, init?: RequestInit) => {
    await new Promise((_, rejeita) => {
      init?.signal?.addEventListener('abort', () => {
        const e = new Error('The operation was aborted due to timeout');
        e.name = 'TimeoutError';
        rejeita(e);
      });
    });
    throw new Error('inalcançável');
  }) as unknown as typeof fetch;

  const m = await aquecePagina('lenta', { base: BASE, buscar, limiteMs: 30 });
  assert.match(m.falha!, /passou de 30s|passou de 0s/);
  assert.match(m.falha!, /investigue esta página/);
});

test('limiteMs 0 desliga o teto — nenhum sinal de abort é passado', async () => {
  let recebeuSinal = true;
  const buscar = (async (_url: string | URL, init?: RequestInit) => {
    recebeuSinal = init?.signal !== undefined;
    return {
      ok: true, status: 200,
      json: async () => ({ visuais: [], cache: 'hit' }),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response;
  }) as unknown as typeof fetch;

  await aquecePagina('p', { base: BASE, buscar, limiteMs: 0, agora: relogio([0, 1, 2]) });
  assert.equal(recebeuSinal, false);
});

test('a linha marca o motivo, e o motivo mais grave vence', () => {
  assert.match(linhaDaMedida(medida({ falha: 'HTTP 500', erros: 1, cache: 'miss' })), /HTTP 500/);
  assert.match(linhaDaMedida(medida({ erros: 1, cache: 'miss' })), /ERRO em visual/);
  assert.match(linhaDaMedida(medida({ cache: 'miss' })), /cache=miss/);
  assert.ok(!linhaDaMedida(medida()).includes('<--'), 'página boa não leva marca');
});
