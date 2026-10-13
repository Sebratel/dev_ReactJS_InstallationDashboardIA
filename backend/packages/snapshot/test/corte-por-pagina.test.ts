// Corte de linhas por página — `corte-por-pagina.yaml` (decisão de 13/10/2026).
//
// O que estes testes guardam: a página com corte vê só o recorte (nos dois
// armazenamentos), a calculada listada nasce do recorte e não do arquivo congelado, a
// coluna do corte entra mesmo sem visual que a cite, e a carga de várias páginas juntas
// — materialização, congelamento — NÃO corta, para não gravar em disco o dado de uma.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import { inicioDoCorte, leCortesPorPagina, type CorteDePagina } from '../../semantic-model/src/corte-por-pagina.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { calculaCard } from '../../widget-engine/src/card.ts';
import { loadDashboards, type DashboardSpec, type VisualSpec } from '../../widget-engine/src/spec.ts';
import { carrega } from '../src/carrega.ts';
import { escreve } from '../src/formato.ts';
import { arquivoDaQuery } from '../src/manifesto.ts';
import { arquivoDaCalculada, shaDaCalculada } from '../src/tabelas-calculadas.ts';

const AGORA = new Date('2026-10-13T12:00:00.000Z');

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

const CORTE: CorteDePagina = {
  paginas: ['gerencial'], tabela: 'OS', coluna: 'CRIADO', desde: 'inicio-do-ano', recalcula: ['DIAS'],
};

/** `OS` vem do disco; `DIAS` é um calendário que nasce do MIN de `OS[CRIADO]`. */
function modelo(cortes: CorteDePagina[] = [CORTE]): SemanticModel {
  const m = new SemanticModel();
  m.addTable({
    id: 'os', name: 'OS', queryRef: 'q-os',
    columns: [col('VALOR', { type: 'int64' }), col('CRIADO', { type: 'dateTime' })],
  });
  m.addTable({
    id: 'dias', name: 'DIAS', queryRef: null,
    tableDax: "CALENDAR(MIN('OS'[CRIADO]), DATE(2026, 12, 31))",
    columns: [col('Date', { sourceColumn: '[Date]' })],
  });
  m.addMeasure({ name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])" });
  m.addMeasure({ name: 'Dias', table: 'DIAS', format: null, displayFolder: null, dax: "COUNTROWS('DIAS')" });
  m.cortes = cortes;
  return m;
}

function card(property: string, entidade = 'OS'): VisualSpec {
  return {
    id: `c-${property}`, type: 'card',
    position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: [entidade],
    fields: [{ role: 'Values', kind: 'measure', entity: entidade, property, name: property }],
    filters: [], filters_vazios: 0,
  };
}

function pagina(id: string, visuals: VisualSpec[]): DashboardSpec {
  return {
    spec: 'v1', id, page_id: id, name: id, type: 'page', visibility: null,
    size: { width: 1, height: 1 }, visual_count: visuals.length,
    filters: [], filters_vazios: 0, visuals,
  };
}

/** 2025 e 2026 — o corte de "início do ano" de 13/10/2026 deixa só as duas de 2026. */
async function comSnapshot(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corte-'));
  await escreve(
    arquivoDaQuery(dir, 'q-os'),
    { query: 'q-os', tabelas: ['OS'], geradoEm: '2026-10-13T09:00:00.000Z' },
    ['valor', 'criado'],
    [
      { valor: 1, criado: new Date('2025-06-10T00:00:00.000Z') },
      { valor: 10, criado: new Date('2025-12-31T00:00:00.000Z') },
      { valor: 100, criado: new Date('2026-01-01T00:00:00.000Z') },
      { valor: 1000, criado: new Date('2026-10-12T00:00:00.000Z') },
      { valor: 10000, criado: null },
    ] as never,
  );
  return dir;
}

for (const colunar of [false, true]) {
  const modo = colunar ? 'colunar' : 'objeto';

  test(`corte (${modo}): a página com corte vê só o ano corrente; a outra vê tudo`, async () => {
    const dir = await comSnapshot();
    const ger = pagina('gerencial', [card('Total')]);
    const cortada = await carrega({ dir, model: modelo(), dashboards: [ger], now: AGORA, colunar });
    assert.equal(calculaCard(ger, ger.visuals[0]!, cortada.ev).valor, 1100);
    assert.equal(cortada.linhasPorTabela.get('OS'), 2);
    assert.equal(cortada.recortadas.length, 1);
    assert.match(cortada.recortadas[0]!, /OS: 5 → 2 linha\(s\), 'CRIADO' desde 2026-01-01/);

    const inst = pagina('instalacao', [card('Total')]);
    const inteira = await carrega({ dir, model: modelo(), dashboards: [inst], now: AGORA, colunar });
    assert.equal(calculaCard(inst, inst.visuals[0]!, inteira.ev).valor, 11111);
    assert.deepEqual(inteira.recortadas, []);
  });
}

test('corte: a calculada listada nasce do recorte, não do arquivo congelado', async () => {
  const dir = await comSnapshot();
  const m = modelo();
  // Um congelado de mentira, com 3 dias: em produção a CALENDARIO INSTALADO congelada
  // nasceu da tabela inteira (desde 2025). Se a página o lesse, o card daria 3.
  const t = m.table('DIAS')!;
  await escreve(
    arquivoDaCalculada(dir, 'DIAS'),
    { query: 'calc.dias', tabelas: ['DIAS'], geradoEm: '2026-10-13T09:00:01.000Z', tabelaSha: shaDaCalculada(t) },
    t.columns.map((c) => c.name),
    [1, 2, 3].map((d) => ({ Date: new Date(Date.UTC(2025, 5, d)) })) as never,
  );
  const ger = pagina('gerencial', [card('Total'), card('Dias', 'DIAS')]);
  const c = await carrega({ dir, model: m, dashboards: [ger], now: AGORA });
  assert.equal(calculaCard(ger, ger.visuals[1]!, c.ev).valor, 365, '01/01 a 31/12/2026, do recorte');
  assert.ok(c.recalculadas.some((r) => /DIAS: recalculada sobre o corte/.test(r)));

  // A página sem corte lê o congelado, como antes.
  const inst = pagina('instalacao', [card('Total'), card('Dias', 'DIAS')]);
  const i = await carrega({ dir, model: m, dashboards: [inst], now: AGORA });
  assert.equal(calculaCard(inst, inst.visuals[1]!, i.ev).valor, 3);
});

test('corte: carga de várias páginas juntas não corta (materialização, congelamento)', async () => {
  const dir = await comSnapshot();
  const ger = pagina('gerencial', [card('Total')]);
  const inst = pagina('instalacao', [card('Total')]);
  const c = await carrega({ dir, model: modelo(), dashboards: [ger, inst], now: AGORA });
  assert.equal(c.linhasPorTabela.get('OS'), 5);
  assert.deepEqual(c.recortadas, []);
});

test('corte: a coluna do corte entra mesmo sem visual que a cite', async () => {
  // O card só soma VALOR; a projeção deixaria CRIADO de fora, e sem ela não há corte.
  const dir = await comSnapshot();
  const ger = pagina('gerencial', [card('Total')]);
  const c = await carrega({ dir, model: modelo(), dashboards: [ger], now: AGORA });
  assert.ok(!c.omitidas.includes(`'OS'[criado]`) && !c.omitidas.includes(`'OS'[CRIADO]`));
  assert.equal(c.linhasPorTabela.get('OS'), 2);
});

test('inicioDoCorte: o ano é o de Brasília, não o do UTC', () => {
  // 31/12/2026 23:30 em Brasília já é 01/01/2027 em UTC — o corte ainda é 2026.
  assert.equal(inicioDoCorte(CORTE, new Date('2027-01-01T02:30:00.000Z')).toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(inicioDoCorte(CORTE, new Date('2027-01-01T03:30:00.000Z')).toISOString(), '2027-01-01T00:00:00.000Z');
});

test('corte-por-pagina.yaml do repositório: as 5 páginas do Gerencial, PROTOCOLOS GERAL desde o início do ano', () => {
  const specs = path.resolve('backend/specs');
  const cortes = leCortesPorPagina(specs);
  assert.equal(cortes.length, 1);
  assert.deepEqual([...cortes[0]!.paginas].sort(), [
    'diario-instalacao', 'instalacao-reincidente', 'manutencao-inicial', 'premiacao-instalacao', 'protocolos-detalhados',
  ]);
  assert.equal(cortes[0]!.tabela, 'PROTOCOLOS GERAL');
  assert.equal(cortes[0]!.coluna, 'DATA CRIADO');
  // E o modelo de verdade aceita: tabela, coluna e calculada existem.
  assert.equal(SemanticModel.fromSpecsDir(specs).cortes.length, 1);
  // Pelo `id`, não pelo nome do arquivo: o arquivo leva o prefixo da ordem das abas (`06-premiacao-instalacao`).
  const ids = loadDashboards(specs).map((d) => d.id);
  for (const p of cortes[0]!.paginas) assert.ok(ids.includes(p), p);
});
