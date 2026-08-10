// A projeção de colunas: o que a página alcança entra, o resto não vira memória.
//
// **O teste que importa é o diferencial**, no fim do arquivo: o mesmo número com e
// sem projeção. Todo o resto deste arquivo existe para que esse diferencial não seja
// verde por acaso — se `omissiveis` nunca omitisse nada, ele passaria e não provaria
// coisa nenhuma.
//
// O segundo em importância é o erro alto. Omitir coluna que a página usa é o erro
// possível desta otimização, e ele **não pode** virar BLANK: a mensagem tem de dizer
// que a ausência foi deliberada e onde a decisão mora.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import type { DashboardSpec, VisualSpec } from '../../widget-engine/src/spec.ts';
import { carrega } from '../src/carrega.ts';
import { colunasUsadas, omissiveis } from '../src/colunas-usadas.ts';
import { escreve } from '../src/formato.ts';
import { arquivoDaQuery } from '../src/manifesto.ts';

const AGORA = new Date('2026-08-10T00:00:00.000Z');

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

/**
 * `OS` tem seis colunas físicas e uma calculada, e cada uma entra por uma aresta
 * diferente — é o que faz este modelo cobrir as cinco.
 *
 *   VALOR   → DAX de medida            CIDADE  → campo de visual
 *   QUANDO  → filtro de página         EQUIPE  → ponta de relacionamento
 *   PESO    → DAX da coluna calculada  SOBRA   → nada. É a que sai.
 */
function modelo(): SemanticModel {
  const m = new SemanticModel();
  m.addTable({
    id: 'os', name: 'OS', queryRef: 'q-os',
    columns: [
      col('VALOR', { type: 'int64' }),
      col('CIDADE'),
      col('QUANDO', { type: 'dateTime' }),
      col('EQUIPE'),
      col('PESO', { type: 'int64' }),
      col('SOBRA'),
      col('DOBRO', { calculated: true, dax: "'OS'[PESO] * 2" }),
    ],
  });
  m.addTable({
    id: 'eq', name: 'EQUIPES', queryRef: 'q-eq',
    columns: [col('NOME'), col('GERENTE')],
  });
  m.addMeasure({ name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])" });
  m.relationships.push({
    id: 'r1', fromTable: 'OS', fromColumn: 'EQUIPE', toTable: 'EQUIPES', toColumn: 'NOME',
    fromCardinality: 'many', toCardinality: 'one', active: true,
    crossFilter: 'oneDirection', joinOnDateBehavior: null,
  });
  return m;
}

function pagina(): DashboardSpec {
  const visual: VisualSpec = {
    id: 'v1', type: 'card',
    position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: ['OS'],
    fields: [
      { role: 'Values', kind: 'measure', entity: 'OS', property: 'Total', name: 'Total', active: null },
      { role: 'Rows', kind: 'column', entity: 'OS', property: 'CIDADE', name: 'CIDADE', active: true },
    ],
    filters: [], filters_vazios: 0,
  };
  return {
    spec: 'v1', id: 'pag', page_id: 'p', name: 'Página', type: 'page', visibility: null,
    size: { width: 1, height: 1 }, visual_count: 1,
    filters: [{ name: 'f', type: 'Advanced', entity: 'OS', property: 'QUANDO', conditions: [] }],
    filters_vazios: 0, visuals: [visual],
  };
}

const EM_DISCO = ['valor', 'cidade', 'quando', 'equipe', 'peso', 'sobra', 'DOBRO'];

// ---------------------------------------------------------------------------
// As cinco arestas
// ---------------------------------------------------------------------------

test('cada aresta mantém a sua coluna, e só sobra a que ninguém toca', () => {
  const m = modelo();
  const usadas = colunasUsadas([pagina()], m);
  assert.deepEqual(omissiveis('OS', EM_DISCO, usadas, m), ['sobra']);
});

test('a coluna calculada nunca é omitida — ela não custa carga', () => {
  const m = modelo();
  // Mesmo se ninguém a citasse: ela ou está no arquivo, ou nasce do que ficou.
  const usadas = colunasUsadas([], m);
  assert.ok(!omissiveis('OS', EM_DISCO, usadas, m).includes('dobro'));
});

test('a coluna que alimenta a calculada fica, mesmo sem visual nenhum', () => {
  const m = modelo();
  const fora = omissiveis('OS', EM_DISCO, colunasUsadas([], m), m);
  assert.ok(!fora.includes('peso'), "'PESO' alimenta [DOBRO] e não pode sair");
});

test('as duas pontas do relacionamento ficam — senão a propagação para de achar a chave', () => {
  const m = modelo();
  const usadas = colunasUsadas([], m);
  assert.ok(!omissiveis('OS', EM_DISCO, usadas, m).includes('equipe'));
  assert.ok(!omissiveis('EQUIPES', ['nome', 'gerente'], usadas, m).includes('nome'));
  // `GERENTE` não é ponta de nada e ninguém a cita: essa sai.
  assert.deepEqual(omissiveis('EQUIPES', ['nome', 'gerente'], usadas, m), ['gerente']);
});

test('coluna do arquivo que o modelo não declara nunca é omitida', () => {
  const m = modelo();
  const fora = omissiveis('OS', [...EM_DISCO, 'coluna_so_do_m'], colunasUsadas([pagina()], m), m);
  assert.ok(!fora.includes('coluna_so_do_m'), 'o que o modelo não conhece fica, por precaução');
});

// ---------------------------------------------------------------------------
// O diferencial, e o erro alto
// ---------------------------------------------------------------------------

async function comSnapshot(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapproj-'));
  await escreve(
    arquivoDaQuery(dir, 'q-os'),
    { query: 'q-os', tabelas: ['OS'], geradoEm: '2026-08-10T09:00:00.000Z' },
    ['valor', 'cidade', 'quando', 'equipe', 'peso', 'sobra'],
    [
      { valor: 10, cidade: 'Bauru', quando: new Date('2026-03-15'), equipe: 'A', peso: 1, sobra: 'x'.repeat(50) },
      { valor: 30, cidade: 'Bauru', quando: new Date('2026-03-16'), equipe: 'A', peso: 2, sobra: 'y'.repeat(50) },
      { valor: 60, cidade: 'Jaú', quando: new Date('2026-04-01'), equipe: 'B', peso: 3, sobra: 'z'.repeat(50) },
    ] as never,
  );
  await escreve(
    arquivoDaQuery(dir, 'q-eq'),
    { query: 'q-eq', tabelas: ['EQUIPES'], geradoEm: '2026-08-10T09:00:00.000Z' },
    ['nome', 'gerente'],
    [{ nome: 'A', gerente: 'Ana' }, { nome: 'B', gerente: 'Bruno' }] as never,
  );
  return dir;
}

/**
 * **O diferencial.** Projetar é atalho, nunca regra: o mesmo cálculo com e sem
 * projeção tem de dar o mesmo número. É o análogo do teste com/sem índice do #44, e
 * é o único que pegaria uma coluna descartada por engano.
 */
test('diferencial: o mesmo número com e sem projeção', async () => {
  const dir = await comSnapshot();
  const base = { dir, model: modelo(), dashboards: [pagina()], now: AGORA };

  const com = await carrega({ ...base, model: modelo() });
  const sem = await carrega({ ...base, model: modelo(), projetar: false });

  // Só `OS` entra: o plano fecha por visual e medida, e a página não alcança
  // `EQUIPES` — relacionamento não é aresta de carregamento, só de propagação.
  assert.deepEqual(com.omitidas, ["'OS'[sobra]"]);
  assert.deepEqual(sem.omitidas, []);

  // O segundo é o que importa: `[DOBRO]` é calculada e nasce de `PESO`, que nenhum
  // visual cita. Se a projeção tivesse descartado `PESO`, este daria outro número.
  for (const dax of ["SUM('OS'[VALOR])", "SUM('OS'[DOBRO])", "COUNTROWS(VALUES('OS'[CIDADE]))"]) {
    assert.equal(com.ev.evaluateExpression(dax), sem.ev.evaluateExpression(dax), dax);
  }
});

test('pedir uma coluna omitida ERRA ALTO, e a mensagem diz que foi de propósito', async () => {
  const dir = await comSnapshot();
  const { ev } = await carrega({ dir, model: modelo(), dashboards: [pagina()], now: AGORA });
  assert.throws(
    () => ev.evaluateExpression("COUNTROWS(VALUES('OS'[SOBRA]))"),
    /omitida da carga.*DECISAO-DESEMPENHO.*colunas-usadas/s,
  );
});

/**
 * O erro mais discreto que esta mudança podia introduzir, e por isso tem teste
 * próprio: `aplicaTiposDeclarados` percorre as colunas **do modelo** e escreve o
 * valor convertido na linha. Sem excluir as omitidas, ela ressuscitaria cada uma
 * valendo BLANK — e aí não haveria erro nenhum, só um número menor.
 */
test('a conversão de tipo não ressuscita a coluna omitida como BLANK', async () => {
  const dir = await comSnapshot();
  const m = modelo();
  // `SOBRA` passa a declarar número, que é o que aciona a conversão.
  m.table('OS')!.columns.find((c) => c.name === 'SOBRA')!.type = 'int64';
  const { ev } = await carrega({ dir, model: m, dashboards: [pagina()], now: AGORA });
  assert.throws(() => ev.evaluateExpression("SUM('OS'[SOBRA])"), /omitida da carga/);
});
