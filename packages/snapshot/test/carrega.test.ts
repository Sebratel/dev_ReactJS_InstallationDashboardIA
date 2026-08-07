// Do snapshot em disco até um número calculado.
//
// **Este arquivo é o caminho inteiro sem credencial.** Escreve um snapshot à mão,
// carrega, materializa a tabela calculada e calcula um visual. É o mesmo percurso
// que a API faz — só a origem dos arquivos muda, e é justo o pedaço que precisa de
// banco.
//
// O que ele prova que os outros não: que a data sobrevive à ida ao disco **e**
// continua data para o DAX. `YEAR()` sobre texto erra alto, então um `YEAR()` que
// devolve número é prova de que o formato não perdeu o tipo no caminho.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { calculaCard } from '../../widget-engine/src/card.ts';
import type { DashboardSpec, VisualSpec } from '../../widget-engine/src/spec.ts';
import { carrega } from '../src/carrega.ts';
import { escreve } from '../src/formato.ts';
import { arquivoDaQuery, escreveManifesto, leManifesto, maisAntigo } from '../src/manifesto.ts';

const AGORA = new Date('2026-08-07T00:00:00.000Z');

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

/** `OS` vem de arquivo; `CIDADES` nasce de DAX sobre ela. */
function modelo(): SemanticModel {
  const m = new SemanticModel();
  m.addTable({
    id: 'os', name: 'OS', queryRef: 'q-os',
    columns: [col('VALOR', { type: 'int64' }), col('CIDADE'), col('QUANDO', { type: 'dateTime' })],
  });
  m.addTable({
    id: 'cid', name: 'CIDADES', queryRef: null,
    tableDax: "DISTINCT('OS'[CIDADE])",
    columns: [col('CIDADE', { sourceColumn: 'CIDADE' })],
  });
  m.addMeasure({ name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])" });
  m.addMeasure({ name: 'Ano', table: 'OS', format: null, displayFolder: null, dax: "YEAR(MAX('OS'[QUANDO]))" });
  return m;
}

function card(property: string): VisualSpec {
  return {
    id: `c-${property}`, type: 'card',
    position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: ['OS'],
    fields: [{ role: 'Values', kind: 'measure', entity: 'OS', property, name: property }],
    filters: [], filters_vazios: 0,
  };
}

function pagina(visuals: VisualSpec[]): DashboardSpec {
  return {
    spec: 'v1', id: 'pag', page_id: 'p', name: 'Página', type: 'page', visibility: null,
    size: { width: 1, height: 1 }, visual_count: visuals.length,
    filters: [], filters_vazios: 0, visuals,
  };
}

/** Escreve um snapshot de `OS` num diretório novo. */
async function comSnapshot(
  linhas: Record<string, unknown>[] = [
    { valor: 10, cidade: 'Bauru', quando: new Date('2026-03-15T00:00:00.000Z') },
    { valor: 30, cidade: 'Bauru', quando: new Date('2026-03-16T00:00:00.000Z') },
    { valor: 60, cidade: 'Jaú', quando: new Date('2026-04-01T00:00:00.000Z') },
  ],
  geradoEm = '2026-08-07T09:00:00.000Z',
): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapcar-'));
  await escreve(
    arquivoDaQuery(dir, 'q-os'),
    { query: 'q-os', tabelas: ['OS'], geradoEm },
    ['valor', 'cidade', 'quando'],
    linhas as never,
  );
  return dir;
}

// ---------------------------------------------------------------------------
// O caminho inteiro
// ---------------------------------------------------------------------------

test('carrega do disco e o card calcula', async () => {
  const dir = await comSnapshot();
  const dash = pagina([card('Total')]);
  const { ev, linhasPorTabela, dadoDe } = await carrega({
    dir, model: modelo(), dashboards: [dash], now: AGORA,
  });
  assert.equal(calculaCard(dash, dash.visuals[0]!, ev).valor, 100);
  assert.equal(linhasPorTabela.get('OS'), 3);
  assert.equal(dadoDe, '2026-08-07T09:00:00.000Z');
});

/**
 * **A prova de que o tipo atravessou o disco.** `YEAR()` de texto erra alto no
 * avaliador. Se o formato tivesse perdido a data, este teste falharia com erro de
 * tipo — não com número errado, que é a única coisa boa de errar alto.
 */
test('data lida do disco continua data para o DAX', async () => {
  const dir = await comSnapshot();
  const dash = pagina([card('Ano')]);
  const { ev } = await carrega({ dir, model: modelo(), dashboards: [dash], now: AGORA });
  assert.equal(calculaCard(dash, dash.visuals[0]!, ev).valor, 2026);
});

test('a tabela calculada é materializada sobre o que veio do disco', async () => {
  const dir = await comSnapshot();
  const dash = pagina([{ ...card('Total'), entities_used: ['OS', 'CIDADES'] }]);
  const { linhasPorTabela, plano } = await carrega({
    dir, model: modelo(), dashboards: [dash], now: AGORA,
  });
  assert.deepEqual(plano.calculadas, ['CIDADES']);
  assert.equal(linhasPorTabela.get('CIDADES'), 2); // Bauru e Jaú
});

/**
 * Só o que a página precisa entra. Carregar o catálogo todo puxaria
 * `field-agenda` — 1,4 milhão de linhas — para páginas que não a mencionam.
 */
test('tabela fora do plano não é carregada nem materializada', async () => {
  const dir = await comSnapshot();
  const dash = pagina([card('Total')]); // não menciona CIDADES
  const { ev, linhasPorTabela } = await carrega({
    dir, model: modelo(), dashboards: [dash], now: AGORA,
  });
  assert.deepEqual([...linhasPorTabela.keys()], ['OS']);
  assert.equal(ev.dataset.hasTable('CIDADES'), false);
});

// ---------------------------------------------------------------------------
// O que erra alto
// ---------------------------------------------------------------------------

/**
 * A alternativa é o `Tabela 'X' não está no dataset` do avaliador no meio do
 * cálculo de um visual: diz o sintoma, não o que fazer.
 */
test('arquivo faltando erra alto nomeando a tabela, a query e o comando', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapvazio-'));
  await assert.rejects(
    () => carrega({ dir, model: modelo(), dashboards: [pagina([card('Total')])], now: AGORA }),
    /Snapshot incompleto.*'OS' \(query q-os\).*npm run snapshot -- --pagina=pag/s,
  );
});

// ---------------------------------------------------------------------------
// Manifesto
// ---------------------------------------------------------------------------

test('o manifesto diz a idade do dado mais antigo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapman-'));
  const e = (query: string, geradoEm: string) => ({
    query, tabelas: [query], linhas: 1, colunas: 1, bytes: 10, geradoEm,
  });
  const m = escreveManifesto(dir, [
    e('b', '2026-08-07T10:00:00.000Z'),
    e('a', '2026-08-05T10:00:00.000Z'),
  ]);
  assert.equal(maisAntigo(m), '2026-08-05T10:00:00.000Z');
  assert.deepEqual(leManifesto(dir), m);
  assert.equal(leManifesto(fs.mkdtempSync(path.join(os.tmpdir(), 'snapnada-'))), null);
});

test('manifesto de outro formato erra alto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapman2-'));
  escreveManifesto(dir, []);
  const p = path.join(dir, 'manifesto.json');
  fs.writeFileSync(p, JSON.stringify({ formato: 9, tabelas: [] }));
  assert.throws(() => leManifesto(dir), /manifesto de formato 9, esperado 1/);
});
