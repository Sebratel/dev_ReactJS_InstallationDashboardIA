import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import { leGrupos, QUERIES_BLOQUEADAS, validaGrupos, type GrupoDeRefresh } from '../src/grupos.ts';

function tmpSpecsDir(yaml: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-yaml-'));
  fs.mkdirSync(path.join(dir, '_catalog'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_catalog', 'refresh.yaml'), yaml, 'utf8');
  return dir;
}

test('sem o arquivo, nenhum grupo — não é erro', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-vazio-'));
  assert.deepEqual(leGrupos(dir), new Map());
});

test('lê grupo com os defaults certos (incremental: false quando omitido)', () => {
  const dir = tmpSpecsDir(`
formato: 1
grupos:
  quente:
    queries: [a, b]
    intervalo_minutos: 15
`);
  const grupos = leGrupos(dir);
  assert.deepEqual(grupos.get('quente'), {
    id: 'quente', queries: ['a', 'b'], intervaloMinutos: 15, incremental: false,
  });
});

test('formato diferente de 1 derruba', () => {
  const dir = tmpSpecsDir('formato: 2\ngrupos: {}\n');
  assert.throws(() => leGrupos(dir), /formato 2, esperado 1/);
});

test('grupo sem queries derruba', () => {
  const dir = tmpSpecsDir('formato: 1\ngrupos:\n  x:\n    intervalo_minutos: 10\n');
  assert.throws(() => leGrupos(dir), /'x' não declara 'queries'/);
});

test('grupo sem intervalo_minutos, ou com zero/negativo, derruba', () => {
  const semIntervalo = tmpSpecsDir('formato: 1\ngrupos:\n  x:\n    queries: [a]\n');
  assert.throws(() => leGrupos(semIntervalo), /intervalo_minutos/);

  const zero = tmpSpecsDir('formato: 1\ngrupos:\n  x:\n    queries: [a]\n    intervalo_minutos: 0\n');
  assert.throws(() => leGrupos(zero), /intervalo_minutos/);
});

// ------------------------------------------------------------- validaGrupos

const IDS = new Set(['a', 'b', 'c', 'bloqueada-de-teste']);

function g(over: Partial<GrupoDeRefresh>): GrupoDeRefresh {
  return { id: 'g', queries: [], intervaloMinutos: 15, incremental: false, ...over };
}

test('validaGrupos: tudo certo devolve lista vazia', () => {
  const grupos = new Map([
    ['x', g({ id: 'x', queries: ['a', 'b'] })],
    ['y', g({ id: 'y', queries: ['c'] })],
  ]);
  assert.deepEqual(validaGrupos(grupos, IDS), []);
});

test('validaGrupos: query que não existe no registry é reportada', () => {
  const grupos = new Map([['x', g({ id: 'x', queries: ['fantasma'] })]]);
  const problemas = validaGrupos(grupos, IDS);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0]!, /fantasma.*não existe/);
});

test('validaGrupos: a mesma query em dois grupos é reportada', () => {
  const grupos = new Map([
    ['x', g({ id: 'x', queries: ['a'] })],
    ['y', g({ id: 'y', queries: ['a'] })],
  ]);
  const problemas = validaGrupos(grupos, IDS);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0]!, /'a' aparece em dois grupos: 'x' e 'y'/);
});

// A lista está VAZIA desde 13/09/2026 (ver o docstring de QUERIES_BLOQUEADAS): a única
// query que estava nela, `protocolos-produtividade`, passou a materializar em 162 s.
// Estes dois testes separam as duas afirmações — qual é a lista HOJE, e se o mecanismo
// ainda funciona. Sem o segundo, esvaziar a lista teria desligado o guarda em silêncio.
test('validaGrupos: nenhuma query está bloqueada hoje', () => {
  assert.deepEqual([...QUERIES_BLOQUEADAS], []);
  const grupos = new Map([['x', g({ id: 'x', queries: ['a'] })]]);
  assert.deepEqual(validaGrupos(grupos, IDS), []);
});

test('validaGrupos: o mecanismo de bloqueio continua de pé e reporta mesmo query sozinha', () => {
  const grupos = new Map([['x', g({ id: 'x', queries: ['bloqueada-de-teste'] })]]);
  const problemas = validaGrupos(grupos, IDS, new Set(['bloqueada-de-teste']));
  assert.equal(problemas.length, 1);
  assert.match(problemas[0]!, /não materializa em nenhum modo/);
});

test('validaGrupos: o refresh.yaml de verdade do catálogo passa em todas as validações', () => {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const registry = QueryRegistry.fromSpecsDir(path.join(raiz, 'specs'));
  const grupos = leGrupos(path.join(raiz, 'specs'));
  assert.ok(grupos.size > 0, 'specs/_catalog/refresh.yaml deveria ter ao menos um grupo');
  const problemas = validaGrupos(grupos, new Set(registry.queries.keys()));
  assert.deepEqual(problemas, []);
});

// ---------------------------------------------------------------------------
// TODA QUERY QUE ALIMENTA UMA TELA TEM CADÊNCIA — OU ESTÁ NA LISTA DE EXCEÇÕES,
// COM MOTIVO ESCRITO.
//
// **Este defeito já aconteceu duas vezes, e a segunda foi hoje.** Em 16/09 o #130
// achou `PROTOCOLOS GERAL` — 12 das 14 telas — sem refresh nem poll, por um
// bloqueio que tinha morrido em 09/09. Em 18/09, `capacidade-equipe` (2 telas) e
// `apuracao-premiacao` (1 tela) estavam com snapshot de 15/09 pelo mesmo motivo:
// ninguém decidiu deixá-las de fora, ninguém decidiu incluí-las.
//
// É o caso clássico de defeito por OMISSÃO: não há linha errada em lugar nenhum
// para alguém revisar. O arquivo que decide está certo sobre tudo o que diz — o
// problema é o que ele não diz.
//
// A lista de exceções é o coração do teste: ela obriga a decisão a ser ESCRITA.
// Uma query fora de todo grupo só passa daqui se alguém a tiver posto na lista,
// com o porquê ao lado. Acrescentar um nome aqui é barato e é exatamente o
// objetivo — o que não pode é ficar de fora em silêncio.
const SEM_CADENCIA_POR_DECISAO: Record<string, string> = {
  // 21min49s de materialização (ACHADOS #82). Cabe em carga noturna, não em tick.
  // A forma reduzida `field-agenda-slot` atende a maioria das aberturas e ESTÁ no
  // grupo `frio`.
  'field-agenda': 'custa 21min49s (ACHADOS #82); quem atende as telas é field-agenda-slot',
};

test('toda query que alimenta uma tela tem grupo de refresh, ou exceção escrita', () => {
  const specs = path.resolve(import.meta.dirname, '..', '..', '..', 'specs');
  const grupos = leGrupos(specs);
  const comGrupo = new Set([...grupos.values()].flatMap((g) => g.queries));

  // O nome da TABELA é o que as telas citam; o id da QUERY é o que o refresh.yaml
  // lista. O elo entre os dois é o campo `name:` da spec — por isso ele é lido aqui
  // em vez de deduzido do nome do arquivo.
  const dirQueries = path.join(specs, '_catalog', 'queries');
  const telas = fs
    .readdirSync(path.join(specs, 'dashboards'))
    .filter((f) => f.endsWith('.spec.yaml'))
    .map((f) => fs.readFileSync(path.join(specs, 'dashboards', f), 'utf8'))
    .join('\n');

  const orfas: string[] = [];
  for (const arquivo of fs.readdirSync(dirQueries)) {
    if (!arquivo.endsWith('.spec.yaml')) continue;
    const id = arquivo.replace('.spec.yaml', '');
    if (comGrupo.has(id) || id in SEM_CADENCIA_POR_DECISAO) continue;
    const spec = parseYaml(fs.readFileSync(path.join(dirQueries, arquivo), 'utf8')) as {
      name?: string;
    } | null;
    if (!spec?.name) continue;
    if (telas.includes(spec.name)) orfas.push(`${id} (tabela '${spec.name}')`);
  }

  assert.deepEqual(
    orfas,
    [],
    `estas queries alimentam alguma tela e não têm cadência nenhuma: ${orfas.join(', ')}. ` +
      'Ou ponha cada uma num grupo de specs/_catalog/refresh.yaml (medindo o GRUPO com ' +
      'ela dentro, não a query sozinha — ver o bloco ATENÇÃO do topo daquele arquivo), ' +
      'ou declare a exceção em SEM_CADENCIA_POR_DECISAO aqui, com o motivo. O que não ' +
      'pode é ficar de fora em silêncio: foi assim duas vezes (ACHADOS #130 e #135).',
  );
});

test('a lista de exceções não guarda nome de query que não existe mais', () => {
  // Uma exceção órfã é pior que nenhuma: ela dá a impressão de que alguém decidiu
  // algo sobre uma query que já não está aqui, e esconde o dia em que o nome voltar.
  const dir = path.resolve(import.meta.dirname, '..', '..', '..', 'specs', '_catalog', 'queries');
  for (const id of Object.keys(SEM_CADENCIA_POR_DECISAO)) {
    assert.ok(
      fs.existsSync(path.join(dir, `${id}.spec.yaml`)),
      `'${id}' está na lista de exceções mas não existe spec para ela`,
    );
  }
});
