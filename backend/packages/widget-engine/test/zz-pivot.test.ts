import test from 'node:test';
import { SPECS } from '../../measure-engine/test/ambiente-sintetico.ts';
import { loadDashboards } from '../src/spec.ts';

const DASHBOARDS = loadDashboards(SPECS);

test('forma dos pivotTable', () => {
  let n = 0;
  const papeis: Record<string, number> = {};
  for (const d of DASHBOARDS) {
    for (const v of d.visuals ?? []) {
      if (v.type !== 'pivotTable') continue;
      n++;
      console.log(`\n${d.id}/${v.id}`);
      for (const c of v.fields ?? []) {
        const k = `${c.role}/${c.kind}`;
        papeis[k] = (papeis[k] ?? 0) + 1;
        console.log(
          `   ${c.role}:${c.kind} '${c.entity}'[${c.property}]` +
            `${c.level ? '.[' + c.level + ']' : ''}` +
            `${c.aggregation ? ' agg=' + c.aggregation : ''}` +
            ` active=${c.active} nome=${c.name}`,
        );
      }
      const fs = [...(d.filters ?? []), ...(v.filters ?? [])];
      console.log(`   filtros: ${fs.length} (having: ${fs.filter((f) => (f.conditions ?? []).some((c) => (c as { left_aggregation?: string }).left_aggregation)).length})`);
    }
  }
  console.log('\nTOTAL', n, JSON.stringify(papeis));
});
