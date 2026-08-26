import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import { SPECS, ambiente } from '../../measure-engine/test/ambiente-sintetico.ts';
import { loadDashboards } from '../src/spec.ts';
import { calculaGrafico, graficosDoDashboard } from '../src/grafico.ts';
import { tabelaExpandida } from '../src/expansao.ts';

const DASHBOARDS = loadDashboards(SPECS);

test('probe', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  for (const d of DASHBOARDS) {
    for (const v of graficosDoDashboard(d)) {
      try {
        calculaGrafico(d, v, ev);
      } catch (e) {
        console.log(`${d.id}/${v.id}:\n${(e as Error).message}\n`);
      }
    }
  }
  for (const t of ['FIELD AGENDA', 'PROTOCOLOS GERAL', 'BASE DE ORIGEM', 'CALENDARIO INSTALADO']) {
    console.log(t, '->', [...tabelaExpandida(model, t)].join(', '));
  }
});
