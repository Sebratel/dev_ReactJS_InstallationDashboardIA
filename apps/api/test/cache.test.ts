// O cache da resposta calculada.
//
// **O que estes testes guardam é que o cache nunca troca o número.** Um cache que
// erra a chave devolve o recorte de outro pedido — plausível, sem nada na tela
// dizendo que está errado, e por isso o pior resultado possível aqui. A prova de que
// ele *funciona* é o `paginasCarregadas` da saúde continuar vazio: num acerto o
// pedido não abre o snapshot nem roda o avaliador.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MemoryCache } from '../../../packages/query-engine/src/cache-memory.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import type { Cache } from '../../../packages/query-engine/src/types.ts';
import { escreve } from '../../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto } from '../../../packages/snapshot/src/manifesto.ts';
import { carimboDasCalculadas } from '../../../packages/snapshot/src/tabelas-calculadas.ts';
import type { FiltroSpec } from '../../../packages/widget-engine/src/spec.ts';
import {
  CacheDeResposta,
  carimboDoSnapshot,
  chaveDaResposta,
  normalizaFiltros,
  ttlDaPagina,
} from '../src/cache-resposta.ts';
import { Servidor } from '../src/servidor.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB = path.join(ROOT, 'apps', 'api', 'web');
const AGORA = new Date('2026-08-07T12:00:00.000Z');

function filtro(tabela: string, coluna: string, valores: (string | number | null)[], nivel?: string): FiltroSpec {
  return {
    name: null,
    type: 'tela',
    entity: tabela,
    property: coluna,
    ...(nivel ? { nivel } : {}),
    conditions: [{ op: 'in', values: valores }],
  };
}

// ---------------------------------------------------------------------------
// A chave
// ---------------------------------------------------------------------------

test('normalizaFiltros: a ordem dos filtros e a dos valores não mudam a chave', () => {
  const a = [filtro('T', 'a', ['x', 'y']), filtro('T', 'b', [1, 2])];
  const b = [filtro('T', 'b', [2, 1]), filtro('T', 'a', ['y', 'x'])];
  assert.equal(normalizaFiltros(a), normalizaFiltros(b));
});

test('normalizaFiltros: número e texto de mesma grafia são valores diferentes', () => {
  // Sem o tipo na chave, `IN ('2026')` e `IN (2026)` colidiriam — e eles filtram
  // colunas diferentes de jeitos diferentes.
  assert.notEqual(normalizaFiltros([filtro('T', 'a', ['2026'])]), normalizaFiltros([filtro('T', 'a', [2026])]));
});

test('normalizaFiltros: o nível faz parte da identidade do filtro', () => {
  // Filtrar pelo **ano** de uma data e pela data crua produz números diferentes
  // sobre a mesma coluna. Ver `FiltroSpec.nivel`.
  assert.notEqual(
    normalizaFiltros([filtro('T', 'data', ['2026'])]),
    normalizaFiltros([filtro('T', 'data', ['2026'], 'Ano')]),
  );
});

test('chaveDaResposta: usuário, página, visual, janela e carimbo mudam a chave', () => {
  const base = {
    usuario: 'local',
    pagina: 'capa',
    filtros: [],
    visual: null,
    de: 0,
    linhas: 200,
    carimbo: 'c1',
  };
  const k = chaveDaResposta(base);
  // O usuário entra na chave **antes** de existir RLS. Depois dele, uma chave sem
  // isto serviria a página do gestor A para o gestor B.
  assert.notEqual(k, chaveDaResposta({ ...base, usuario: 'outro' }));
  assert.notEqual(k, chaveDaResposta({ ...base, pagina: 'visao-geral' }));
  assert.notEqual(k, chaveDaResposta({ ...base, visual: 'v1' }));
  assert.notEqual(k, chaveDaResposta({ ...base, de: 200 }));
  assert.notEqual(k, chaveDaResposta({ ...base, linhas: 50 }));
  assert.notEqual(k, chaveDaResposta({ ...base, carimbo: 'c2' }));
  assert.equal(k, chaveDaResposta({ ...base }), 'o mesmo pedido dá a mesma chave');
});

test('carimboDoSnapshot: rematerializar muda o carimbo; sem snapshot tem carimbo próprio', () => {
  const entrada = { query: 'q', tabelas: ['T'], linhas: 10, colunas: 2, bytes: 100, geradoEm: '2026-08-07T11:00:00.000Z' };
  const c1 = carimboDoSnapshot({ formato: 1, tabelas: [entrada] });
  const c2 = carimboDoSnapshot({ formato: 1, tabelas: [{ ...entrada, geradoEm: '2026-08-07T12:00:00.000Z' }] });
  const c3 = carimboDoSnapshot({ formato: 1, tabelas: [{ ...entrada, linhas: 11 }] });
  assert.notEqual(c1, c2, 'geradoEm entra no carimbo');
  assert.notEqual(c1, c3, 'a contagem de linhas também');
  assert.equal(carimboDoSnapshot(null), 'sem-snapshot');
});

/**
 * **A fresta que o manifesto deixava aberta.** `manifesto.json` só lista query, e
 * `npm run snapshot:calculadas` reescreve 3,7 MB de `Status Protocolo Dia` sem tocar
 * nele. Sem a segunda parcela do carimbo, o cache servia a resposta anterior ao
 * refresh até o TTL vencer — e "rodei o refresh e o painel não mudou" é o erro que
 * ninguém percebe.
 */
test('carimboDoSnapshot: regenerar tabela calculada muda o carimbo', () => {
  const m = { formato: 1 as const, tabelas: [] };
  const antes = carimboDoSnapshot(m, 'calc.x.jsonl@1000#500');
  const depois = carimboDoSnapshot(m, 'calc.x.jsonl@2000#500');
  assert.notEqual(antes, depois, 'mtime do calc entra no carimbo');
  assert.notEqual(antes, carimboDoSnapshot(m, 'calc.x.jsonl@1000#501'), 'tamanho também');
  assert.equal(antes, carimboDoSnapshot(m, 'calc.x.jsonl@1000#500'));
  assert.equal(carimboDoSnapshot(null), 'sem-snapshot');
});

test('carimboDasCalculadas: só os calc.*.jsonl, em ordem estável', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carimbo-'));
  fs.writeFileSync(path.join(dir, 'calc.b.jsonl'), 'b');
  fs.writeFileSync(path.join(dir, 'calc.a.jsonl'), 'a');
  fs.writeFileSync(path.join(dir, 'protocolos-geral.jsonl'), 'x'); // query, não calculada
  fs.writeFileSync(path.join(dir, 'manifesto.json'), '{}');
  const c = carimboDasCalculadas(dir);
  assert.match(c, /^calc\.a\.jsonl@.*\|calc\.b\.jsonl@/, 'ordem alfabética, e só os calc.');
  assert.ok(!c.includes('protocolos-geral'), 'query não entra aqui — ela já está no manifesto');
  assert.equal(carimboDasCalculadas(path.join(dir, 'nao-existe')), '');
});

test('carimboDoSnapshot: a ordem das entradas do manifesto não importa', () => {
  const a = { query: 'a', tabelas: ['A'], linhas: 1, colunas: 1, bytes: 1, geradoEm: '2026-08-07T11:00:00.000Z' };
  const b = { query: 'b', tabelas: ['B'], linhas: 2, colunas: 1, bytes: 1, geradoEm: '2026-08-07T11:00:00.000Z' };
  assert.equal(
    carimboDoSnapshot({ formato: 1, tabelas: [a, b] }),
    carimboDoSnapshot({ formato: 1, tabelas: [b, a] }),
  );
});

// ---------------------------------------------------------------------------
// O TTL
// ---------------------------------------------------------------------------

test('ttlDaPagina: vale o menor TTL das queries da página', () => {
  const r = QueryRegistry.fromSpecsDir(path.join(ROOT, 'specs'));
  // Números de `specs/_catalog/cache-policies.yaml`: operacional quente 60,
  // referência quase estática 86400.
  assert.equal(ttlDaPagina(['feriados'], r), 86400);
  assert.equal(ttlDaPagina(['protocolos-geral'], r), 60);
  assert.equal(
    ttlDaPagina(['feriados', 'protocolos-geral'], r),
    60,
    'servir o operacional com o TTL do feriado mostraria ontem por 24 h',
  );
});

test('ttlDaPagina: query desconhecida (ou plano indeterminado) desliga o cache', () => {
  const r = QueryRegistry.fromSpecsDir(path.join(ROOT, 'specs'));
  assert.equal(ttlDaPagina(['(indeterminado)'], r), 0);
  assert.equal(ttlDaPagina(['feriados', '(indeterminado)'], r), 0);
});

// ---------------------------------------------------------------------------
// A degradação
// ---------------------------------------------------------------------------

/** Um Redis que só sabe cair. */
const CACHE_QUEBRADO: Cache = {
  async get() {
    throw new Error('ECONNREFUSED 127.0.0.1:6379');
  },
  async set() {
    throw new Error('ECONNREFUSED 127.0.0.1:6379');
  },
  async del() {},
  async delMany() {
    return 0;
  },
  async keys() {
    return [];
  },
};

test('CacheDeResposta: cache que lança vira miss, e a falha aparece', async () => {
  const falhas: string[] = [];
  const c = new CacheDeResposta({ cache: CACHE_QUEBRADO, aoFalhar: (op) => falhas.push(op) });
  assert.equal(await c.le('k'), undefined, 'get que falhou é miss, não exceção');
  await c.guarda('k', { a: 1 }, 60);
  assert.deepEqual(falhas, ['get', 'set'], 'nenhuma das duas some calada');
});

test('CacheDeResposta: ttl 0 não grava', async () => {
  const memoria = new MemoryCache();
  const c = new CacheDeResposta({ cache: memoria });
  await c.guarda('k', { a: 1 }, 0);
  assert.equal(memoria.size, 0);
});

// ---------------------------------------------------------------------------
// Ponta a ponta
// ---------------------------------------------------------------------------

function dirVazio(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apicache-'));
}

/** Um snapshot com só `hora-atualizado` — o que a página `capa` precisa. */
async function dirComCapa(geradoEm = '2026-08-07T11:00:00.000Z'): Promise<string> {
  const dir = dirVazio();
  await escreveCapa(dir, geradoEm);
  return dir;
}

async function escreveCapa(dir: string, geradoEm: string): Promise<void> {
  const linha = {
    datahora: new Date('2026-08-07T10:34:00.000Z'),
    data: new Date('2026-08-07T00:00:00.000Z'),
    hora: new Date('1899-12-30T10:34:00.000Z'),
  };
  const cab = await escreve(
    arquivoDaQuery(dir, 'hora-atualizado'),
    { query: 'hora-atualizado', tabelas: ['HORA ATUALIZADO'], geradoEm },
    ['datahora', 'data', 'hora'],
    [linha],
  );
  escreveManifesto(dir, [
    { query: 'hora-atualizado', tabelas: cab.tabelas, linhas: 1, colunas: 3, bytes: 200, geradoEm: cab.geradoEm },
  ]);
}

async function sobe(
  snapshotDir: string,
  cache?: Cache,
  aoFalharCache?: (op: 'get' | 'set', erro: unknown) => void,
  usuario?: string,
): Promise<{ busca: (rota: string) => Promise<Response>; fecha: () => Promise<void> }> {
  const http = new Servidor({
    root: ROOT,
    snapshotDir,
    webDir: WEB,
    agora: () => AGORA,
    ...(cache ? { cache } : {}),
    ...(aoFalharCache ? { aoFalharCache } : {}),
    ...(usuario ? { identifica: () => ({ usuario, papeis: [usuario] }) } : {}),
  }).criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    busca: (rota) => fetch(`http://127.0.0.1:${port}${rota}`),
    fecha: () => new Promise<void>((ok) => http.close(() => ok())),
  };
}

test('o segundo pedido idêntico é acerto — e num processo novo não carrega a página', async () => {
  const dir = await dirComCapa();
  const memoria = new MemoryCache();

  const s1 = await sobe(dir, memoria);
  let primeiro: Record<string, unknown>;
  try {
    const r = await s1.busca('/api/dashboards/capa');
    assert.equal(r.status, 200);
    primeiro = await r.json();
    assert.equal(primeiro.cache, 'miss');
  } finally {
    await s1.fecha();
  }

  // Servidor **novo**, cache compartilhado: é a situação depois de um restart.
  const s2 = await sobe(dir, memoria);
  try {
    const r = await s2.busca('/api/dashboards/capa');
    assert.equal(r.status, 200);
    const segundo = await r.json();
    assert.equal(segundo.cache, 'hit');

    const { cache: _a, ...corpo1 } = primeiro;
    const { cache: _b, ...corpo2 } = segundo;
    assert.deepEqual(corpo2, corpo1, 'o acerto devolve exatamente a mesma resposta');

    const saude = await (await s2.busca('/api/saude')).json();
    assert.deepEqual(
      saude.paginasCarregadas,
      [],
      'no acerto o pedido não abre o snapshot nem roda o avaliador',
    );
  } finally {
    await s2.fecha();
  }
});

test('janela diferente é chave diferente: recalcula em vez de servir a página errada', async () => {
  const s = await sobe(await dirComCapa(), new MemoryCache());
  try {
    assert.equal((await (await s.busca('/api/dashboards/capa?linhas=10')).json()).cache, 'miss');
    assert.equal((await (await s.busca('/api/dashboards/capa?linhas=10')).json()).cache, 'hit');
    assert.equal(
      (await (await s.busca('/api/dashboards/capa?linhas=20')).json()).cache,
      'miss',
      'outra janela não pode reaproveitar a resposta da primeira',
    );
  } finally {
    await s.fecha();
  }
});

test('snapshot refeito invalida: a tela não continua servindo o número velho', async () => {
  const dir = await dirComCapa('2026-08-07T11:00:00.000Z');
  const memoria = new MemoryCache();
  const s = await sobe(dir, memoria);
  try {
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'miss');
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'hit');

    // `npm run snapshot` rodou de novo.
    await escreveCapa(dir, '2026-08-07T18:00:00.000Z');
    assert.equal(
      (await (await s.busca('/api/dashboards/capa')).json()).cache,
      'miss',
      'refresh que não invalida é um painel que não muda depois do refresh',
    );
  } finally {
    await s.fecha();
  }
});

test('Redis fora do ar não derruba o pedido — só tira o acerto', async () => {
  const falhas: string[] = [];
  const s = await sobe(await dirComCapa(), CACHE_QUEBRADO, (op) => falhas.push(op));
  try {
    for (const _ of [1, 2]) {
      const r = await s.busca('/api/dashboards/capa');
      assert.equal(r.status, 200);
      assert.equal((await r.json()).cache, 'miss', 'sempre miss, nunca erro');
    }
    assert.ok(falhas.length >= 2, 'as falhas do cache aparecem em vez de sumir');
  } finally {
    await s.fecha();
  }
});

test('página sem snapshot continua 409 e o 409 não entra no cache', async () => {
  const dir = dirVazio();
  const memoria = new MemoryCache();
  const s = await sobe(dir, memoria);
  try {
    assert.equal((await s.busca('/api/dashboards/capa')).status, 409);
    assert.equal(memoria.size, 0, 'guardar o 409 travaria a página por um TTL inteiro');

    // Agora o snapshot existe: o pedido seguinte tem de calcular, não repetir o erro.
    await escreveCapa(dir, '2026-08-07T11:00:00.000Z');
    const r = await s.busca('/api/dashboards/capa');
    assert.equal(r.status, 200);
    assert.equal((await r.json()).cache, 'miss');
  } finally {
    await s.fecha();
  }
});

/**
 * A prova de que o cache não vai virar vazamento quando a Fase 4 chegar.
 *
 * Hoje os dois usuários veem a mesma coisa, então o acerto cruzado seria
 * *correto* — e é exatamente por isso que este teste precisa existir agora: ele
 * falha no dia em que alguém tirar o usuário da chave, e não no dia, muito depois,
 * em que um gestor vir a página do outro.
 */
test('usuários diferentes não compartilham resposta, mesmo com o mesmo cache', async () => {
  const dir = await dirComCapa();
  const memoria = new MemoryCache();

  const a = await sobe(dir, memoria, undefined, 'gestor-a');
  try {
    assert.equal((await (await a.busca('/api/dashboards/capa')).json()).cache, 'miss');
    assert.equal((await (await a.busca('/api/dashboards/capa')).json()).cache, 'hit');
  } finally {
    await a.fecha();
  }

  const b = await sobe(dir, memoria, undefined, 'gestor-b');
  try {
    assert.equal(
      (await (await b.busca('/api/dashboards/capa')).json()).cache,
      'miss',
      'a resposta de um usuário não pode ser servida para outro',
    );
  } finally {
    await b.fecha();
  }
});

test('a saúde diz qual adapter de cache está ligado', async () => {
  const s = await sobe(dirVazio(), new MemoryCache());
  try {
    const j = await (await s.busca('/api/saude')).json();
    assert.equal(j.cache.adapter, 'MemoryCache');
  } finally {
    await s.fecha();
  }
});
