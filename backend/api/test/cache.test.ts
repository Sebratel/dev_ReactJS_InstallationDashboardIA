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
import { MemoryCache } from '../../packages/query-engine/src/cache-memory.ts';
import { QueryRegistry } from '../../packages/query-engine/src/registry.ts';
import type { Cache } from '../../packages/query-engine/src/types.ts';
import { escreve } from '../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto } from '../../packages/snapshot/src/manifesto.ts';
import { carimboDasCalculadas } from '../../packages/snapshot/src/tabelas-calculadas.ts';
import type { FiltroSpec } from '../../packages/widget-engine/src/spec.ts';
import {
  CacheDeResposta,
  carimboDoSnapshot,
  chaveDaResposta,
  chaveDoCompleto,
  diaDoCalculo,
  identidadeDoCalculo,
  normalizaFiltros,
  RETENCAO_PADRAO,
  retencaoDaPagina,
  VERSAO,
} from '../src/cache-resposta.ts';
import { Servidor } from '../src/servidor.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB = path.join(ROOT, 'frontend', 'dist');
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

test('chaveDaResposta: escopo, página, visuais, janela, carimbo e dia mudam a chave', () => {
  const base = {
    escopo: 'todos',
    pagina: 'capa',
    filtros: [],
    visuais: null,
    de: 0,
    linhas: 200,
    carimbo: 'c1',
    dia: '2026-08-07',
  };
  const k = chaveDaResposta(base);
  // O ESCOPO entra na chave antes de existir RLS. Depois dele, uma chave sem isto
  // serviria a página do gestor A para o gestor B. Escopo, e não identidade: ver
  // `escopo-cache.ts` e o ACHADOS #102 — guardar o e-mail aqui fatiava o cache por
  // pessoa e o aquecedor enchia uma partição que ninguém lia.
  assert.notEqual(k, chaveDaResposta({ ...base, escopo: 'outro' }));
  assert.notEqual(k, chaveDaResposta({ ...base, pagina: 'visao-geral' }));
  assert.notEqual(k, chaveDaResposta({ ...base, visuais: ['v1'] }));
  assert.notEqual(k, chaveDaResposta({ ...base, de: 200 }));
  assert.notEqual(k, chaveDaResposta({ ...base, linhas: 50 }));
  assert.notEqual(k, chaveDaResposta({ ...base, carimbo: 'c2' }));
  // O dia, com o **mesmo** carimbo: o dado em disco não mudou e a resposta mudou
  // assim mesmo, porque 25 das 121 expressões chamam `TODAY()`. É a única parte da
  // identidade que não vem do disco.
  assert.notEqual(k, chaveDaResposta({ ...base, dia: '2026-08-08' }));
  assert.equal(k, chaveDaResposta({ ...base }), 'o mesmo pedido dá a mesma chave');
});

// A BUSCA DE TABELA (`?busca=`, 16/09/2026). As duas chaves mudam em direções
// OPOSTAS, e é a assimetria que faz a busca custar milissegundos em vez de 2,9 s:
// a resposta muda com o termo, o resultado inteiro que ela recorta não.
test('chaveDaResposta: o termo de busca muda a chave — buscas diferentes não podem dividir resposta', () => {
  const base = {
    escopo: 'todos', pagina: 'protocolos-detalhados', filtros: [], visuais: null,
    de: 0, linhas: 200, carimbo: 'c1', dia: '2026-09-16',
  };
  const semBusca = chaveDaResposta(base);
  const com = chaveDaResposta({ ...base, termo: '1784218' });

  assert.notEqual(semBusca, com, 'buscar não pode cair na chave de quem não buscou');
  assert.notEqual(com, chaveDaResposta({ ...base, termo: '178421' }));
  assert.equal(com, chaveDaResposta({ ...base, termo: '1784218' }), 'o mesmo termo dá a mesma chave');

  // Vazio, só-espaços e ausente são o MESMO pedido. `servidor.ts` normaliza para
  // `undefined` antes de chegar aqui; esta asserção guarda o outro lado, para uma URL
  // montada à mão com `?busca=` não fatiar o cache que o aquecedor acabou de encher.
  assert.equal(semBusca, chaveDaResposta({ ...base, termo: undefined }));
  assert.equal(semBusca, chaveDaResposta({ ...base, termo: '' }));
});

test('chaveDoCompleto: o termo NÃO participa — é o que impede uma tecla de recalcular a tabela', () => {
  // `janelaDe` filtra o resultado já pronto. Se o termo entrasse aqui, cada tecla de
  // `1784218` seria um recálculo das 33.462 linhas (2,9 s medidos) e mais uma cópia
  // delas nos 512 MB do CacheDeVisual.
  const base = {
    escopo: 'todos', pagina: 'protocolos-detalhados', filtros: [],
    visual: 'v1', carimbo: 'c1', dia: '2026-09-16',
  };
  const k = chaveDoCompleto(base);
  assert.equal(k, chaveDoCompleto({ ...base, ...{ termo: '1784218' } } as typeof base));
  // E o que muda o resultado continua mudando a chave — a trava contra alguém
  // "simplificar" a de cima tirando campos a mais junto.
  assert.notEqual(k, chaveDoCompleto({ ...base, visual: 'v2' }));
  assert.notEqual(k, chaveDoCompleto({ ...base, carimbo: 'c2' }));
});

test('chaveDaResposta: a ORDEM da lista de visuais não muda a chave', () => {
  // A rolagem dispara `?visual=` na ordem em que a pessoa rola, não na ordem do
  // layout — dois pedidos com os MESMOS ids em ordem diferente são o MESMO pedido.
  const base = {
    escopo: 'todos', pagina: 'capa', filtros: [], visuais: ['v1', 'v2', 'v3'],
    de: 0, linhas: 200, carimbo: 'c1', dia: '2026-08-07',
  };
  assert.equal(chaveDaResposta(base), chaveDaResposta({ ...base, visuais: ['v3', 'v1', 'v2'] }));
});

/**
 * O dia da chave tem de ser o dia que o **cálculo** enxerga.
 *
 * `TODAY()` é `getUTCFullYear/getUTCMonth/getUTCDate` sobre o `now` injetado. Se
 * este dia fosse o local, a chave viraria à meia-noite de Brasília e o `TODAY()`
 * três horas depois — e nessa janela a página serviria o dia novo com o número do
 * dia velho. As duas datas abaixo são o mesmo instante visto dos dois fusos.
 */
test('diaDoCalculo: é o dia UTC, que é o que TODAY() enxerga', () => {
  // 21:00 em Brasília (UTC-3) do dia 7 já é dia 8 em UTC — e `TODAY()` diz 8.
  assert.equal(diaDoCalculo(new Date('2026-08-08T00:30:00.000Z')), '2026-08-08');
  assert.equal(diaDoCalculo(new Date('2026-08-07T23:59:59.999Z')), '2026-08-07');
  assert.equal(diaDoCalculo(new Date('2026-08-08T00:00:00.000Z')), '2026-08-08');
  // A hora não entra: o cache não pode virar de hora em hora, só na virada do dia.
  assert.equal(
    diaDoCalculo(new Date('2026-08-07T03:00:00.000Z')),
    diaDoCalculo(new Date('2026-08-07T21:00:00.000Z')),
  );
});

/**
 * As duas camadas de cache — respostas prontas e avaliadores carregados — têm de
 * medir a **mesma** identidade.
 *
 * Este teste existe porque a divergência entre elas não daria erro nenhum: daria um
 * número. Se a chave da resposta soubesse do dia e o mapa de avaliadores não, a
 * virada da meia-noite daria miss (certo), o recálculo pegaria o avaliador de ontem
 * (errado) e o `TODAY()` de ontem seria gravado sob a chave de hoje — o cache
 * carimbando o erro em vez de expô-lo. Uma função só é o que impede isso.
 */
test('identidadeDoCalculo: o dado e o dia, e os dois mudam a identidade', () => {
  const base = identidadeDoCalculo('c1', '2026-08-07');
  assert.notEqual(base, identidadeDoCalculo('c1', '2026-08-08'), 'o dia sozinho basta');
  assert.notEqual(base, identidadeDoCalculo('c2', '2026-08-07'), 'o carimbo sozinho basta');
  assert.equal(base, identidadeDoCalculo('c1', '2026-08-07'), 'e é estável');
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

test('carimboDasCalculadas: só os calc.* (cru ou comprimido), em ordem estável', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carimbo-'));
  fs.writeFileSync(path.join(dir, 'calc.b.jsonl'), 'b');
  fs.writeFileSync(path.join(dir, 'calc.a.jsonl'), 'a');
  // Comprimida entra igual: se o carimbo a ignorasse, uma calculada regravada em
  // .jsonl.gz deixaria o cache de resposta servindo o número de antes dela.
  fs.writeFileSync(path.join(dir, 'calc.c.jsonl.gz'), 'c');
  fs.writeFileSync(path.join(dir, 'calc.d.jsonl.parcial'), 'd'); // escrita em curso
  fs.writeFileSync(path.join(dir, 'protocolos-geral.jsonl'), 'x'); // query, não calculada
  fs.writeFileSync(path.join(dir, 'manifesto.json'), '{}');
  const c = carimboDasCalculadas(dir);
  assert.match(c, /^calc\.a\.jsonl@.*\|calc\.b\.jsonl@/, 'ordem alfabética, e só os calc.');
  assert.ok(c.includes('calc.c.jsonl.gz@'), 'a calculada comprimida tem de entrar no carimbo');
  assert.ok(!c.includes('.parcial'), 'temporário de escrita não entra');
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

/**
 * **Este teste mudou de lado de propósito, e a versão antiga dele está citada
 * abaixo.** Ele afirmava que a página valia o menor TTL das suas queries: 86400
 * para `feriados`, 60 para `protocolos-geral`. Era uma decisão tomada para o cache
 * do Query Engine, onde o TTL segura idas ao ERP — e que tinha vazado para o cache
 * da resposta, onde não há ERP nenhum: a resposta é calculada sobre o `snapshot/`
 * em disco, que só muda quando `npm run snapshot` roda.
 *
 * O preço medido daquele 60 estava em `visao-geral`: 36 s de recálculo uma vez por
 * minuto, com o disco intacto e ninguém tendo reiniciado nada.
 */
test('retencaoDaPagina: o relógio não expira mais a resposta — a chave expira', () => {
  const r = QueryRegistry.fromSpecsDir(path.join(ROOT, 'backend', 'specs'));
  // Antes: 86400, 60 e 60.
  assert.equal(retencaoDaPagina(['feriados'], r), RETENCAO_PADRAO);
  assert.equal(retencaoDaPagina(['protocolos-geral'], r), RETENCAO_PADRAO);
  assert.equal(retencaoDaPagina(['feriados', 'protocolos-geral'], r), RETENCAO_PADRAO);
  // O que substituiu o frescor é `carimbo` + `dia` na chave. Uma retenção menor que
  // um dia traria o recálculo de volta pela porta dos fundos, sem ninguém decidir.
  assert.ok(RETENCAO_PADRAO >= 24 * 60 * 60, 'retenção abaixo de um dia é TTL disfarçado');
});

/**
 * As duas saídas por `0` sobrevivem à mudança porque nunca foram sobre tempo.
 */
test('retencaoDaPagina: query desconhecida e ttl 0 continuam desligando o cache', () => {
  const r = QueryRegistry.fromSpecsDir(path.join(ROOT, 'backend', 'specs'));
  // Plano indeterminado: não dá para saber de que dado a resposta depende, então
  // ela não pode ser guardada sob um carimbo que talvez não a descreva.
  assert.equal(retencaoDaPagina(['(indeterminado)'], r), 0);
  assert.equal(retencaoDaPagina(['feriados', '(indeterminado)'], r), 0);

  // `ttl: 0` é alguém escrevendo "esta não se guarda" em `cache-policies.yaml`.
  // É decisão humana registrada, e a retenção não pode passar por cima dela.
  const comZero = new QueryRegistry();
  comZero.add(
    {
      id: 'nunca-cacheia',
      name: 'nunca-cacheia',
      origin: 'expression',
      source_type: 'unknown',
      datasource: null,
      sql: null,
      url: null,
      source_tables: [],
    },
    { ttl: 0, realtime: false },
  );
  assert.equal(retencaoDaPagina(['nunca-cacheia'], comZero), 0);
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

test('CacheDeResposta.apagaPagina: só as respostas da página caem, o resto do site fica quente', async () => {
  const memoria = new MemoryCache();
  const c = new CacheDeResposta({ cache: memoria });
  // o escopo vem ANTES da página na chave — por isso dois escopos diferentes na
  // mesma página são o caso que prova que o filtro não pode ser um prefixo puro.
  //
  // A chave usa `VERSAO` (não um `'v1'` chumbado): foi exatamente um prefixo
  // literal separado da constante, dentro de `apagaPagina`, que ficou apontando
  // para a versão errada quando `VERSAO` subiu — apagando zero chaves em vez das
  // duas de baixo. Ver o comentário de `apagaPagina` em `cache-resposta.ts`.
  await c.guarda(`resp:${VERSAO}:todos:agendamento-field:sha1:*:0:500:c1:d1`, { x: 1 }, 60);
  await c.guarda(`resp:${VERSAO}:outro:agendamento-field:sha2:*:0:500:c1:d1`, { x: 2 }, 60);
  await c.guarda(`resp:${VERSAO}:todos:visao-geral:sha1:*:0:500:c1:d1`, { x: 3 }, 60);

  const n = await c.apagaPagina('agendamento-field');

  assert.equal(n, 2);
  assert.equal(await c.le(`resp:${VERSAO}:todos:agendamento-field:sha1:*:0:500:c1:d1`), undefined);
  assert.equal(await c.le(`resp:${VERSAO}:outro:agendamento-field:sha2:*:0:500:c1:d1`), undefined);
  assert.deepEqual(
    await c.le(`resp:${VERSAO}:todos:visao-geral:sha1:*:0:500:c1:d1`),
    { x: 3 },
    'visao-geral não foi tocada — não podia sair do cache',
  );
});

test('CacheDeResposta.apagaPagina: página sem nenhuma entrada não é erro', async () => {
  const c = new CacheDeResposta({ cache: new MemoryCache() });
  assert.equal(await c.apagaPagina('pagina-que-nunca-foi-pedida'), 0);
});

test('CacheDeResposta.apagaPagina: Redis fora do ar degrada para 0, nunca lança', async () => {
  const falhas: string[] = [];
  const quebrado: Cache = {
    async get() { return undefined; },
    async set() {},
    async del() {},
    async delMany() { return 0; },
    async keys() { throw new Error('ECONNREFUSED 127.0.0.1:6379'); },
  };
  const c = new CacheDeResposta({ cache: quebrado, aoFalhar: (op) => falhas.push(op) });
  assert.equal(await c.apagaPagina('agendamento-field'), 0);
  assert.deepEqual(falhas, ['get']);
});

// ---------------------------------------------------------------------------
// A chave do resultado inteiro
// ---------------------------------------------------------------------------

/**
 * **A ausência de `de` e `linhas` É a otimização.** Uma chave por janela faz cada
 * clique em "próxima" recalcular a tabela inteira — 2,9 s medidos em 17/08/2026.
 * Se alguém acrescentar a janela aqui achando que "a chave tem de carregar tudo que
 * muda a resposta", o cache volta a errar por excesso de zelo: a janela não muda o
 * resultado, ela recorta o resultado.
 */
test('chaveDoCompleto: a janela NÃO entra na chave', () => {
  const base = {
    escopo: 'todos',
    pagina: 'protocolos-detalhados',
    filtros: [],
    visual: 'v1',
    carimbo: 'c1',
    dia: '2026-08-07',
  };
  const k = chaveDoCompleto(base);
  assert.ok(!k.includes('200'), `a chave não pode carregar janela: ${k}`);
  assert.equal(k, chaveDoCompleto({ ...base }), 'a mesma entrada dá a mesma chave');
});

test('chaveDoCompleto: tudo que muda o RESULTADO entra', () => {
  const base = {
    escopo: 'todos',
    pagina: 'protocolos-detalhados',
    filtros: [],
    visual: 'v1',
    carimbo: 'c1',
    dia: '2026-08-07',
  };
  const k = chaveDoCompleto(base);
  assert.notEqual(k, chaveDoCompleto({ ...base, escopo: 'outro' }));
  assert.notEqual(k, chaveDoCompleto({ ...base, pagina: 'visao-geral' }));
  // Sem o visual, as duas tabelas da mesma página disputariam a mesma entrada — e a
  // segunda serviria as linhas da primeira.
  assert.notEqual(k, chaveDoCompleto({ ...base, visual: 'v2' }));
  assert.notEqual(k, chaveDoCompleto({ ...base, filtros: [filtro('T', 'a', ['x'])] }));
  assert.notEqual(k, chaveDoCompleto({ ...base, carimbo: 'c2' }));
  assert.notEqual(k, chaveDoCompleto({ ...base, dia: '2026-08-08' }));
});

test('chaveDoCompleto não colide com chaveDaResposta', () => {
  // Os dois vivem em caches diferentes hoje, mas prefixos distintos são o que
  // permite que um dia dividam um espaço de chaves sem uma servir pela outra.
  const k = chaveDoCompleto({
    escopo: 'todos', pagina: 'capa', filtros: [], visual: 'v1', carimbo: 'c1', dia: '2026-08-07',
  });
  const r = chaveDaResposta({
    escopo: 'todos', pagina: 'capa', filtros: [], visuais: ['v1'], de: 0, linhas: 200, carimbo: 'c1', dia: '2026-08-07',
  });
  assert.notEqual(k, r);
  assert.ok(k.startsWith('full:'));
  assert.ok(r.startsWith('resp:'));
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
  await escreveManifesto(dir, [
    { query: 'hora-atualizado', tabelas: cab.tabelas, linhas: 1, colunas: 3, bytes: 200, geradoEm: cab.geradoEm },
  ]);
}

async function sobe(
  snapshotDir: string,
  cache?: Cache,
  aoFalharCache?: (op: 'get' | 'set', erro: unknown) => void,
  usuario?: string,
  /** O relógio. Injetável para atravessar a meia-noite sem esperar por ela. */
  agora: () => Date = () => AGORA,
): Promise<{ busca: (rota: string) => Promise<Response>; fecha: () => Promise<void> }> {
  const inst = new Servidor({
    root: ROOT,
    snapshotDir,
    webDir: WEB,
    agora,
    ...(cache ? { cache } : {}),
    ...(aoFalharCache ? { aoFalharCache } : {}),
    // Sempre autenticado, com ou sem `usuario` explícito — sem cookie de
    // sessão de verdade, o `fetch` de teste levaria 401 em qualquer
    // `/api/dashboards/*` se caísse no padrão real (identidade.test.ts cobre
    // o portão de sessão em si).
    identifica: () => ({ usuario: usuario ?? 'teste', papeis: [usuario ?? 'teste'] }),
  });
  const http = inst.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    busca: (rota) => fetch(`http://127.0.0.1:${port}${rota}`),
    fecha: () =>
      new Promise<void>((ok) => {
        inst.destroi();
        http.close(() => ok());
      }),
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

/** Pede até a resposta deixar de ser a `anterior` — o recálculo de fundo terminou (#164). */
async function esperaFresco(s: { busca: (u: string) => Promise<Response> }, url: string): Promise<{ cache: string }> {
  const ate = Date.now() + 10_000;
  for (;;) {
    const j = (await (await s.busca(url)).json()) as { cache: string };
    if (j.cache !== 'anterior' || Date.now() > ate) return j;
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('snapshot refeito: sai NA HORA a versão anterior, e o número novo logo depois — nunca preso no velho', async () => {
  const dir = await dirComCapa('2026-08-07T11:00:00.000Z');
  const memoria = new MemoryCache();
  const s = await sobe(dir, memoria);
  try {
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'miss');
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'hit');

    // `npm run snapshot` rodou de novo. Até 28/09/2026 o pedido seguinte era `miss`:
    // recalculava na frente de quem pediu, e numa página pesada isso eram minutos de
    // "carregando…" (ACHADOS #164). Agora a anterior sai na hora, dita como tal.
    await escreveCapa(dir, '2026-08-07T18:00:00.000Z');
    assert.equal(
      (await (await s.busca('/api/dashboards/capa')).json()).cache,
      'anterior',
      'depois do refresh a tela recebe a versão pronta, sem esperar cálculo',
    );
    assert.equal(
      (await esperaFresco(s, '/api/dashboards/capa')).cache,
      'hit',
      'refresh que não chega é um painel que não muda depois do refresh',
    );
  } finally {
    await s.fecha();
  }
});

/**
 * A meia-noite invalida; a hora, não.
 *
 * As duas metades importam. Sem a primeira, a resposta de ontem serviria hoje —
 * 25 das 121 expressões chamam `TODAY()`. Sem a segunda, o cache viraria a cada
 * relógio novo e a página voltaria a custar os segundos que ela custa a frio, que é
 * o desperdício que o TTL de 60 s cobrava sem que ninguém tivesse decidido isso.
 */
test('a virada do dia invalida, mesmo com o snapshot intacto', async () => {
  const dir = await dirComCapa();
  let relogio = new Date('2026-08-07T20:00:00.000Z');
  const s = await sobe(dir, new MemoryCache(), undefined, undefined, () => relogio);
  try {
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'miss');
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'hit');

    // Mesmo dia UTC, quase na virada: ainda é acerto.
    relogio = new Date('2026-08-07T23:59:59.000Z');
    assert.equal(
      (await (await s.busca('/api/dashboards/capa')).json()).cache,
      'hit',
      'a hora não pode invalidar — só o dia',
    );

    // Passou. O disco não mudou uma linha; `TODAY()` mudou. A de ontem sai na hora,
    // marcada `anterior`, e a de hoje é calculada em fundo (ACHADOS #164).
    relogio = new Date('2026-08-08T00:00:01.000Z');
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'anterior');
    assert.equal(
      (await esperaFresco(s, '/api/dashboards/capa')).cache,
      'hit',
      'depois da virada, a de ontem só pode ficar enquanto a de hoje calcula',
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
 * **Este teste foi invertido em 06/09/2026 (ACHADOS #102), e a inversão é a
 * correção — vale explicar por quê.**
 *
 * Ele exigia que dois usuários NÃO compartilhassem resposta, como prova antecipada
 * de que o cache não viraria vazamento quando o recorte por linha chegasse. A
 * intenção estava certa; o instrumento, não. Enquanto todo mundo vê as mesmas
 * linhas, particionar por pessoa não protege ninguém — e cobra: o aquecedor
 * (`aquecedor-interno`) passou a encher uma partição que nenhuma pessoa lê, e cada
 * pessoa pagou o recálculo inteiro na primeira abertura de cada página (6.134 ms
 * medidos em `visao-geral`, no compose, com a saúde dizendo `aquecimento: pronto`).
 *
 * A proteção não sumiu: ela subiu para onde é verificável. A chave carrega o
 * **escopo** (`escopo-cache.ts`), e `escopo-cache.test.ts` lê
 * `backend/specs/_catalog/permissoes.yaml` e reprova se alguém ligar recorte por página ou
 * por linha sem antes fazer o escopo derivar dele. Isso pega o caso que a versão
 * antiga deixaria passar: ligar RLS mantendo a chave como estava.
 */
test('dois usuários no mesmo escopo COMPARTILHAM a resposta — é o que faz o aquecimento servir', async () => {
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
      'hit',
      'o segundo usuário tem de aproveitar o que o primeiro (ou o aquecedor) calculou',
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

/**
 * A saúde tem de dizer se o reaquecimento automático está ligado e se já terminou.
 *
 * É por estes dois campos que `npm start` decide **esperar** em vez de disparar um
 * segundo aquecimento por cima do da API. Adivinhar erraria nas duas direções: dez
 * minutos parado esperando um aquecedor desligado, ou dois aquecimentos calculando
 * as mesmas páginas ao mesmo tempo num processo só.
 */
test('a saúde diz o estado do reaquecimento, e o padrão é desligado', async () => {
  const sem = await sobe(dirVazio(), new MemoryCache());
  try {
    const j = await (await sem.busca('/api/saude')).json();
    assert.deepEqual(
      j.aquecimento,
      { ativo: false, pronto: false },
      'sem aquecedor a saúde diz que não há — e não omite o campo',
    );
  } finally {
    await sem.fecha();
  }

  const inst1 = new Servidor({
    root: ROOT,
    snapshotDir: dirVazio(),
    webDir: WEB,
    agora: () => AGORA,
    aquecimento: () => ({ ativo: true, pronto: true }),
  });
  const http = inst1.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  try {
    const { port } = http.address() as { port: number };
    const j = await (await fetch(`http://127.0.0.1:${port}/api/saude`)).json();
    assert.deepEqual(j.aquecimento, { ativo: true, pronto: true });
  } finally {
    inst1.destroi();
    await new Promise<void>((ok) => http.close(() => ok()));
  }
});

/**
 * O orçamento do cache de resultado inteiro tem de aparecer de fora.
 *
 * É o primeiro número a olhar quando alguém disser que "a próxima página demora":
 * `itens: 0` com o servidor no ar há horas quer dizer que o cache está desligado ou
 * que nada coube nele — duas causas com conserto diferente, e nenhuma das duas
 * visível sem este campo.
 */
test('a saúde diz quanto do orçamento de visual está em uso', async () => {
  const s = await sobe(dirVazio(), new MemoryCache());
  try {
    const j = await (await s.busca('/api/saude')).json();
    assert.equal(typeof j.cache.visuais.itens, 'number');
    assert.equal(typeof j.cache.visuais.mb, 'number');
    assert.ok(j.cache.visuais.tetoMB > 0, 'o teto padrão tem de estar ligado');
  } finally {
    await s.fecha();
  }
});

test('teto zero desliga o cache de visual, e a saúde mostra isso', async () => {
  const inst2 = new Servidor({
    root: ROOT,
    snapshotDir: dirVazio(),
    webDir: WEB,
    agora: () => AGORA,
    tetoDeVisuaisMB: 0,
  });
  const http = inst2.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  try {
    const { port } = http.address() as { port: number };
    const j = await (await fetch(`http://127.0.0.1:${port}/api/saude`)).json();
    assert.equal(j.cache.visuais.tetoMB, 0);
  } finally {
    inst2.destroi();
    await new Promise<void>((ok) => http.close(() => ok()));
  }
});

