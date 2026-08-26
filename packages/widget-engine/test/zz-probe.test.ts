import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import { SPECS, ambiente } from '../../measure-engine/test/ambiente-sintetico.ts';
import { loadDashboards } from '../src/spec.ts';
import { calculaTabela, tabelasDoDashboard } from '../src/tabela.ts';
import { calculaGrafico, graficosDoDashboard } from '../src/grafico.ts';

const DASHBOARDS = loadDashboards(SPECS);

test('probe', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  let calculam = 0;
  let linhas = 0;
  const familias: Record<string, number> = {};
  for (const d of DASHBOARDS) {
    for (const v of tabelasDoDashboard(d)) {
      try {
        linhas += calculaTabela(d, v, ev).linhas.length;
        calculam++;
      } catch (e) {
        const m = (e as Error).message;
        familias[m.slice(0, 150)] = (familias[m.slice(0, 150)] ?? 0) + 1;
      }
    }
  }
  console.log('TABELAS calculam=', calculam, 'linhas=', linhas);
  console.log(JSON.stringify(familias, null, 1));

  let g = 0, pontos = 0, series = 0;
  const gfam: Record<string, number> = {};
  for (const d of DASHBOARDS) {
    for (const v of graficosDoDashboard(d)) {
      try {
        const r = calculaGrafico(d, v, ev);
        g++;
        pontos += r.pontos.length;
        series += r.series.length;
        console.log(`  OK ${r.dashboard}/${r.visual} pontos=${r.pontos.length} series=${r.series.length} chaves=${r.chaves.map((c) => c.coluna + (c.nivel ? '.' + c.nivel : '')).join('+')}`);
        if (r.pontos.length) console.log('     p0=', JSON.stringify(r.pontos[0]));
      } catch (e) {
        const m = (e as Error).message;
        gfam[m.slice(0, 150)] = (gfam[m.slice(0, 150)] ?? 0) + 1;
      }
    }
  }
  console.log('GRAFICOS calculam=', g, 'pontos=', pontos, 'series=', series);
  console.log(JSON.stringify(gfam, null, 1));
});
