// O MESMO snapshot, carregado dos dois jeitos, tem de dar os MESMOS números.
//
// `le-colunar-diferencial.test.ts` compara as duas LEITURAS célula a célula. Este
// vai um andar acima: compara o caminho inteiro — carga, conversão de tipo, coluna
// calculada, tabela calculada, filtro, medida — com `colunar: false` e
// `colunar: true`. É ele que autoriza ligar o interruptor.
//
// Os casos aqui são escolhidos pelo que a VISTA poderia quebrar em silêncio:
//
//   - conversão de tipo declarado, que no colunar vai para o DICIONÁRIO e não para
//     a linha (a vista recusa escrita em coluna física);
//   - coluna calculada, que é memoizada NA LINHA — o único lugar onde a vista
//     aceita propriedade nova;
//   - `CALCULATE` dentro de um iterador SOBRE A TABELA NOMEADA, que faz transição
//     de contexto sobre uma linha que é vista, e depende de `colunasDe` enxergar o
//     protótipo — `Object.keys` daria vazio e a transição não filtraria NADA;
//   - `ADDCOLUMNS`, que passa por `copiaLinha` (hoje sempre sobre tabela anônima,
//     porque ele recusa origem nomeada — então ali a vista ainda não chega);
//   - projeção de colunas, cuja mensagem de erro tem de ser a mesma nos dois.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { colunasDe } from '../../measure-engine/src/dataset.ts';
import type { DashboardSpec, VisualSpec } from '../../widget-engine/src/spec.ts';
import { carrega, type Carregado } from '../src/carrega.ts';
import { escreve } from '../src/formato.ts';
import { arquivoDaQuery } from '../src/manifesto.ts';

const AGORA = new Date('2026-09-13T00:00:00.000Z');

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

/**
 * `VALOR` é declarada `int64` e vai para o disco como TEXTO — é ela que exercita a
 * conversão de tipo, que é o passo que muda de lugar no caminho colunar.
 */
function modelo(): SemanticModel {
  const m = new SemanticModel();
  m.addTable({
    id: 'os',
    name: 'OS',
    queryRef: 'q-os',
    columns: [
      col('VALOR', { type: 'int64' }),
      col('CIDADE'),
      col('QUANDO', { type: 'dateTime' }),
      col('OBSERVACAO'),
      col('DOBRO', { calculated: true, dax: "'OS'[VALOR] * 2", type: 'int64' }),
    ],
  });
  m.addTable({
    id: 'cid',
    name: 'CIDADES',
    queryRef: null,
    tableDax: "DISTINCT('OS'[CIDADE])",
    columns: [col('CIDADE', { sourceColumn: 'CIDADE' })],
  });
  const medida = (name: string, dax: string): void =>
    m.addMeasure({ name, table: 'OS', format: null, displayFolder: null, dax });

  medida('Total', "SUM('OS'[VALOR])");
  medida('TotalDobro', "SUM('OS'[DOBRO])");
  medida('Ano', "YEAR(MAX('OS'[QUANDO]))");
  medida('Linhas', "COUNTROWS('OS')");
  medida('Cidades', "COUNTROWS('CIDADES')");
  medida('PorCidade', "AVERAGEX(VALUES('OS'[CIDADE]), CALCULATE(SUM('OS'[VALOR])))");
  // **A medida que detecta a vista quebrada.** O iterador é sobre a tabela NOMEADA,
  // então a linha em contexto é uma vista; `CALCULATE` faz transição de contexto, que
  // filtra `OS` por TODAS as colunas dessa linha. As 5 linhas são distintas, então
  // cada uma sobra sozinha e a média é 1. Se `colunasDe` devolvesse vazio (que é o que
  // `Object.keys` faria numa vista), a transição não filtraria nada e daria 5.
  medida('Transicao', "AVERAGEX('OS', CALCULATE(COUNTROWS('OS')))");
  // `ADDCOLUMNS` passa por `copiaLinha`, e exige origem ANÔNIMA (recusa nomeada por
  // linhagem) — daí o `SELECTCOLUMNS`, que é também quem itera as VISTAS aqui: ele
  // roda em contexto de linha sobre a tabela nomeada e monta linhas novas a partir
  // delas. As 5 linhas são distintas em (cidade, valor), e X = valor + 1.
  medida(
    'ComColuna',
    `AVERAGEX(ADDCOLUMNS(DISTINCT(SELECTCOLUMNS('OS', "C", 'OS'[CIDADE], "V", 'OS'[VALOR])), "X", [V] + 1), [X])`,
  );
  medida('Filtrada', "CALCULATE(SUM('OS'[VALOR]), 'OS'[CIDADE] = \"Bauru\")");
  return m;
}

function card(property: string, entidades = ['OS']): VisualSpec {
  return {
    id: `c-${property}`,
    type: 'card',
    position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: entidades,
    fields: [{ role: 'Values', kind: 'measure', entity: 'OS', property, name: property }],
    filters: [],
    filters_vazios: 0,
  };
}

function pagina(visuals: VisualSpec[]): DashboardSpec {
  return {
    spec: 'v1', id: 'pag', page_id: 'p', name: 'Página', type: 'page', visibility: null,
    size: { width: 1, height: 1 }, visual_count: visuals.length,
    filters: [], filters_vazios: 0, visuals,
  };
}

/** `valor` vai como TEXTO de propósito: é o gatilho de `aplicaTiposDeclarados`. */
const LINHAS = [
  { valor: '10', cidade: 'Bauru', quando: new Date('2026-03-15T00:00:00.000Z'), observacao: 'a' },
  { valor: '30', cidade: 'Bauru', quando: new Date('2026-03-16T00:00:00.000Z'), observacao: null },
  { valor: '60', cidade: 'Jaú', quando: new Date('2026-04-01T00:00:00.000Z'), observacao: 'c' },
  { valor: null, cidade: 'Jaú', quando: null, observacao: 'd' },
  { valor: '60', cidade: 'Bauru', quando: new Date('2026-04-01T00:00:00.000Z'), observacao: 'a' },
];

async function comSnapshot(linhas: Record<string, unknown>[] = LINHAS): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colunar-dif-'));
  await escreve(
    arquivoDaQuery(dir, 'q-os'),
    { query: 'q-os', tabelas: ['OS'], geradoEm: '2026-09-13T09:00:00.000Z' },
    ['valor', 'cidade', 'quando', 'observacao'],
    linhas as never,
  );
  return dir;
}

/** Carrega a mesma página dos dois jeitos. */
async function osDois(
  dash: DashboardSpec,
  extra: Partial<Parameters<typeof carrega>[0]> = {},
  dir?: string,
): Promise<{ objeto: Carregado; colunar: Carregado }> {
  const d = dir ?? (await comSnapshot());
  const base = { dir: d, model: modelo(), dashboards: [dash], now: AGORA, ...extra };
  return {
    objeto: await carrega({ ...base, model: modelo(), colunar: false }),
    colunar: await carrega({ ...base, model: modelo(), colunar: true }),
  };
}

/** O erro que `f` levanta. Erra alto se ela NAO levantar — silêncio aqui seria BLANK. */
function pega(f: () => unknown): Error {
  try {
    f();
  } catch (e) {
    return e as Error;
  }
  throw new Error('esperava erro alto, e nada foi levantado');
}

const MEDIDAS = [
  'Total', 'TotalDobro', 'Ano', 'Linhas', 'Cidades',
  'PorCidade', 'Transicao', 'ComColuna', 'Filtrada',
];

test('as medidas dão o mesmo valor nos dois caminhos', async () => {
  const dash = pagina(MEDIDAS.map((m) => card(m, ['OS', 'CIDADES'])));
  const { objeto, colunar } = await osDois(dash, { projetar: false });

  for (const m of MEDIDAS) {
    assert.deepEqual(colunar.ev.measure(m), objeto.ev.measure(m), `medida [${m}]`);
  }

  // E os valores são os esperados, não só iguais entre si — dois caminhos errados
  // do mesmo jeito passariam na comparação acima.
  assert.equal(objeto.ev.measure('Total'), 160);
  assert.equal(objeto.ev.measure('TotalDobro'), 320);
  assert.equal(objeto.ev.measure('Linhas'), 5);
  assert.equal(objeto.ev.measure('Cidades'), 2);
  assert.equal(objeto.ev.measure('PorCidade'), 80); // Bauru 100, Jaú 60
  assert.equal(objeto.ev.measure('ComColuna'), 33); // (11+31+61+1+61) / 5
  // 1, e não 5: a transição de contexto filtrou pela linha. Ver a medida.
  assert.equal(objeto.ev.measure('Transicao'), 1);
  assert.equal(colunar.ev.measure('Transicao'), 1, 'a vista tem de transicionar igual');
  assert.equal(objeto.ev.measure('Filtrada'), 100);
});

test('a conversão de tipo declarado dá o mesmo resultado, e é registrada igual', async () => {
  const dash = pagina([card('Total')]);
  const { objeto, colunar } = await osDois(dash, { projetar: false });

  // O texto "10" virou o número 10 nos dois — no objeto linha a linha, no colunar
  // no dicionário. Se o colunar tivesse pulado a conversão, `SUM` somaria texto.
  assert.deepEqual(colunar.ev.columnValues('OS', 'VALOR'), objeto.ev.columnValues('OS', 'VALOR'));
  assert.deepEqual(objeto.ev.columnValues('OS', 'VALOR'), [10, 30, 60, null, 60]);
  assert.deepEqual(colunar.convertidas, objeto.convertidas);
  assert.ok(objeto.convertidas.some((c) => c.includes("'OS'[VALOR]")), objeto.convertidas.join('|'));
});

test('data lida pela vista continua data — YEAR() erra alto sobre texto', async () => {
  const dash = pagina([card('Ano')]);
  const { objeto, colunar } = await osDois(dash, { projetar: false });
  assert.equal(colunar.ev.measure('Ano'), 2026);
  assert.equal(objeto.ev.measure('Ano'), 2026);
});

test('coluna calculada é memoizada NA LINHA, e a vista aceita isso', async () => {
  const dash = pagina([card('TotalDobro')]);
  const { objeto, colunar } = await osDois(dash, { projetar: false });
  assert.deepEqual(colunar.ev.columnValues('OS', 'DOBRO'), objeto.ev.columnValues('OS', 'DOBRO'));
  assert.deepEqual(objeto.ev.columnValues('OS', 'DOBRO'), [20, 60, 120, 0, 120]);

  // Depois de materializada, ela EXISTE na linha — é o que o achado #50 exige para
  // o índice de igualdade poder indexar a coluna.
  const linha = colunar.ev.dataset.rows('OS')[0]!;
  assert.ok('dobro' in linha);
  assert.ok(colunasDe(linha).includes('dobro'));
});

test('a tabela calculada nasce igual sobre a vista', async () => {
  const dash = pagina([card('Cidades', ['OS', 'CIDADES'])]);
  const { objeto, colunar } = await osDois(dash, { projetar: false });
  assert.deepEqual(colunar.ev.columnValues('CIDADES', 'CIDADE'), objeto.ev.columnValues('CIDADES', 'CIDADE'));
  assert.deepEqual(objeto.ev.columnValues('CIDADES', 'CIDADE'), ['Bauru', 'Jaú']);
  assert.deepEqual(
    colunar.linhasPorTabela.get('CIDADES'),
    objeto.linhasPorTabela.get('CIDADES'),
  );
});

test('célula a célula, o dataset carregado é o mesmo', async () => {
  const dash = pagina(MEDIDAS.map((m) => card(m, ['OS', 'CIDADES'])));
  const { objeto, colunar } = await osDois(dash, { projetar: false });

  const a = objeto.ev.dataset.rows('OS');
  const b = colunar.ev.dataset.rows('OS');
  assert.equal(b.length, a.length);
  for (let i = 0; i < a.length; i++) {
    const cs = colunasDe(a[i]!);
    assert.deepEqual([...colunasDe(b[i]!)].sort(), [...cs].sort(), `linha ${i}: mesmas colunas`);
    for (const c of cs) {
      const x = a[i]![c];
      const y = b[i]![c];
      if (x instanceof Date || y instanceof Date) {
        assert.ok(x instanceof Date && y instanceof Date, `linha ${i}, '${c}': um é Date`);
        assert.equal(x.getTime(), y.getTime(), `linha ${i}, '${c}'`);
      } else {
        assert.equal(y, x, `linha ${i}, '${c}'`);
        assert.equal(typeof y, typeof x, `linha ${i}, '${c}': tipo`);
      }
    }
  }
});

test('com projeção LIGADA, os dois omitem as mesmas colunas e erram a mesma mensagem', async () => {
  // `OBSERVACAO` não é usada por nenhuma medida da página: a projeção a deixa fora.
  const dash = pagina([card('Total')]);
  const { objeto, colunar } = await osDois(dash);

  assert.deepEqual(colunar.omitidas, objeto.omitidas);
  assert.ok(objeto.omitidas.includes("'OS'[observacao]"), objeto.omitidas.join('|'));

  const linhaO = objeto.ev.dataset.rows('OS')[0]!;
  const linhaC = colunar.ev.dataset.rows('OS')[0]!;
  assert.ok(!('observacao' in linhaO));
  assert.ok(!('observacao' in linhaC), 'a vista não pode inventar a coluna omitida');

  // A mesma mensagem, palavra por palavra: é ela que manda a próxima pessoa para a
  // linha certa. Um BLANK calado aqui seria o pior desfecho possível.
  const erroO = pega(() => objeto.ev.columnValues('OS', 'OBSERVACAO'));
  const erroC = pega(() => colunar.ev.columnValues('OS', 'OBSERVACAO'));
  assert.equal(erroC.message, erroO.message);
  assert.match(erroO.message, /omitida da carga/);
});

test('tabela vazia carrega nos dois caminhos', async () => {
  const dir = await comSnapshot([]);
  const dash = pagina([card('Linhas')]);
  const { objeto, colunar } = await osDois(dash, { projetar: false }, dir);
  assert.equal(colunar.linhasPorTabela.get('OS'), 0);
  assert.equal(objeto.linhasPorTabela.get('OS'), 0);
  assert.deepEqual(colunar.ev.measure('Linhas'), objeto.ev.measure('Linhas'));
});

test('o colunar é o MESMO dataset, não um atalho: `dadoDe` e as contagens batem', async () => {
  const dash = pagina(MEDIDAS.map((m) => card(m, ['OS', 'CIDADES'])));
  const { objeto, colunar } = await osDois(dash, { projetar: false });
  assert.equal(colunar.dadoDe, objeto.dadoDe);
  assert.deepEqual([...colunar.linhasPorTabela], [...objeto.linhasPorTabela]);
});
