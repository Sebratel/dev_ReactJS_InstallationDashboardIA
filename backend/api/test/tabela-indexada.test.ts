// Paridade e orçamento de memória da TabelaIndexada (cache por Int32Array de índices).

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../packages/semantic-model/src/model.ts';
import type { ModelColumn } from '../../packages/semantic-model/src/types.ts';
import { Dataset, type Row } from '../../packages/measure-engine/src/dataset.ts';
import { Evaluator } from '../../packages/measure-engine/src/evaluator.ts';
import { BLANK, makeDate } from '../../packages/measure-engine/src/value.ts';
import type { CampoSpec, DashboardSpec, VisualSpec } from '../../packages/widget-engine/src/spec.ts';
import { calculaTabela } from '../../packages/widget-engine/src/index.ts';
import { calculaPagina, janelaDe, tipoDe, type MemoDeCompletos, type TabelaCompleta, type TabelaIndexada } from '../src/calcula.ts';
import { CacheDeVisual, estimaBytes } from '../src/cache-visual.ts';
import { VistaDeLinhas } from '../../packages/snapshot/src/linha-vista.ts';
import { ConstrutorDeTabela } from '../../packages/snapshot/src/tabela-colunar.ts';

const AGORA = makeDate(2026, 11, 23);

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

function modelo(): SemanticModel {
  const m = new SemanticModel();
  m.addTable({
    id: 'os',
    name: 'OS',
    queryRef: null,
    columns: [
      col('PROTOCOLO'),
      col('DATA', { type: 'dateTime' }),
      col('CIDADE'),
      col('VALOR'),
    ],
  });
  return m;
}

const campo = (property: string): CampoSpec => ({
  role: 'Values',
  kind: 'column',
  entity: 'OS',
  property,
  name: property,
});

function visualTabela(): VisualSpec {
  return {
    id: 'v-tab',
    type: 'tableEx',
    position: { x: 0, y: 0, width: 10, height: 10 },
    entities_used: ['OS'],
    fields: [campo('PROTOCOLO'), campo('DATA'), campo('CIDADE'), campo('VALOR')],
    filters: [],
    filters_vazios: 0,
  };
}

function pagina(v: VisualSpec): DashboardSpec {
  return {
    spec: 'v1',
    id: 'pag',
    page_id: 'p',
    name: 'Página',
    type: 'page',
    visibility: null,
    size: { width: 1920, height: 1080 },
    visual_count: 1,
    filters: [],
    filters_vazios: 0,
    visuals: [v],
  };
}

function serializaValor(v: unknown): unknown {
  if (v === null || v === undefined || v === BLANK) return null;
  return v instanceof Date ? v.toISOString() : v;
}

function tabelaCompletaDeReferencia(dash: DashboardSpec, v: VisualSpec, ev: Evaluator): TabelaCompleta {
  const r = calculaTabela(dash, v, ev);
  return {
    especie: 'tabela',
    colunas: r.colunas.map((nome, i) => ({
      nome,
      tipo: r.linhas.map((l) => tipoDe(l[i]!.valor)).find((t) => t !== null) ?? null,
      chave: true,
      tabela: r.origemDasColunas[i]?.tabela ?? null,
      coluna: r.origemDasColunas[i]?.coluna ?? null,
      nivel: r.origemDasColunas[i]?.nivel ?? null,
    })),
    linhas: r.linhas.map((l) => l.map((c) => serializaValor(c.valor))),
    linhasTotais: r.linhas.length,
    filtros: r.filtros,
  };
}

function criaDatasetColunarComOverlay(): Evaluator {
  const model = modelo();
  const c = new ConstrutorDeTabela('OS', ['protocolo', 'data', 'cidade', 'valor'], 5);
  c.poeLinha(['P001', makeDate(2026, 1, 10), 'Canoas', 10]);
  c.poeLinha(['P002', makeDate(2026, 3, 5), 'São Leopoldo', 50]);
  c.poeLinha(['P003', BLANK, 'CANOAS', 20]);
  c.poeLinha(['P004', makeDate(2026, 2, 20), BLANK, BLANK]);
  c.poeLinha(['P005', makeDate(2026, 3, 5), 'Canoas', 5]);
  const colunar = new VistaDeLinhas(c.fecha()).todas();
  // Remove a linha 0 (simula remoção por overlay) e anexa objeto simples (simula delta do poller).
  const linhas: Row[] = [
    ...colunar.slice(1),
    { protocolo: 'P006', data: makeDate(2026, 4, 1), cidade: 'Novo Hamburgo', valor: 100 },
  ];
  const dataset = new Dataset();
  dataset.adotaTabela('OS', linhas);
  return new Evaluator({ model, dataset, now: AGORA });
}

test('estimaBytes mede Int32Array pelo byteLength (~0,4 MB para 100k linhas)', () => {
  const bytes = estimaBytes(new Int32Array(100_000));
  assert.equal(bytes, 16 + 400_000);
});

test('TabelaIndexada guarda só índices no cache e cabe num teto pequeno', () => {
  const ev = criaDatasetColunarComOverlay();
  const v = visualTabela();
  const dash = pagina(v);
  const cache = new CacheDeVisual({ tetoBytes: 64 * 1024 });
  const memo: MemoDeCompletos = {
    le: (id) => cache.le(id),
    guarda: (id, c) => cache.guarda(id, c),
  };

  calculaPagina(dash, ev, { de: 0, linhas: 2 }, undefined, memo);
  const guardado = cache.le(v.id) as TabelaIndexada | undefined;
  assert.ok(guardado, 'entrada tem de estar no cache');
  assert.equal(guardado.especie, 'tabela-indexada');
  assert.ok(guardado.indices instanceof Int32Array);
  assert.equal(guardado.indices.length, 5);
});

test('TabelaIndexada tem paridade exata com TabelaCompleta em paginação, busca e ordenação (inclusive com overlay)', () => {
  const ev = criaDatasetColunarComOverlay();
  const v = visualTabela();
  const dash = pagina(v);
  const ref = tabelaCompletaDeReferencia(dash, v, ev);

  const cache = new CacheDeVisual({ tetoBytes: 1024 * 1024 });
  const memo: MemoDeCompletos = {
    le: (id) => cache.le(id),
    guarda: (id, c) => cache.guarda(id, c),
  };

  const cenarios = [
    { de: 0, linhas: 10 },
    { de: 2, linhas: 2 },
    { de: 0, linhas: 10, termo: 'canoas' },
    { de: 0, linhas: 10, termo: 'novo' },
    { de: 0, linhas: 10, termo: 'nao-existe' },
    { de: 0, linhas: 10, ordem: { coluna: 0, desc: false } },
    { de: 0, linhas: 10, ordem: { coluna: 0, desc: true } },
    { de: 0, linhas: 10, ordem: { coluna: 2, desc: false } },
    { de: 0, linhas: 10, ordem: { coluna: 3, desc: true } },
    { de: 1, linhas: 2, termo: 'canoas', ordem: { coluna: 3, desc: false } },
  ];

  for (const janela of cenarios) {
    const p = calculaPagina(dash, ev, janela, undefined, memo);
    const obtido = p.visuais[0]!.dados;
    const esperado = janelaDe(ref, janela);
    assert.deepEqual(obtido, esperado, `divergência no cenário ${JSON.stringify(janela)}`);
  }
});
