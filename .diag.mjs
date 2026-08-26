// Diagnóstico 5: o avaliador consegue AVALIAR as 7 tabelas calculadas hoje?
import path from 'node:path';
import { SemanticModel } from './packages/semantic-model/src/model.ts';
import { Dataset } from './packages/measure-engine/src/dataset.ts';
import { Evaluator } from './packages/measure-engine/src/evaluator.ts';
import { makeDate } from './packages/measure-engine/src/value.ts';

const model = SemanticModel.fromSpecsDir(path.join(process.cwd(), 'specs'));
const DATAS = [makeDate(2025, 8, 4), makeDate(2026, 8, 3), makeDate(2026, 8, 7), makeDate(2026, 8, 8), makeDate(2026, 8, 9)];

const dataset = new Dataset();
for (const t of model.tables.values()) {
  const rows = [];
  for (let i = 0; i < DATAS.length; i++) {
    const row = {};
    for (const c of t.columns) {
      if (c.calculated) continue;
      row[c.name] = c.type === 'dateTime' ? DATAS[i % DATAS.length]
        : c.type === 'int64' ? (i + 1) * 10
        : c.type === 'double' ? (i + 1) * 1.5
        : /data|dia/i.test(c.name) ? DATAS[i % DATAS.length]
        : `v${i % 2}`;
    }
    rows.push(row);
  }
  dataset.addTable(t.name, rows);
}

const ev = new Evaluator({ model, dataset, now: makeDate(2026, 8, 4) });
for (const t of model.calculatedTables) {
  try {
    const v = ev.evaluateExpression(t.tableDax, ev.rootScope());
    const forma = v && typeof v === 'object' && 'rows' in v
      ? `TableValue ${v.rows.length} linhas, table=${v.table}`
      : typeof v;
    console.log(`  OK    ${t.name.padEnd(24)} ${forma}`);
  } catch (e) {
    console.log(`  FALHA ${t.name.padEnd(24)} ${String(e.message).split('\n')[0]}`);
  }
}
