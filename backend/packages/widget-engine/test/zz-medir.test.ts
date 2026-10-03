import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import { SPECS, ambiente } from '../../measure-engine/test/ambiente-sintetico.ts';

const NUMERICO = new Set(['int64', 'double', 'decimal']);

test('colunas calculadas declaradas numericas: o que cada uma devolve', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  let n = 0;
  const porEspecie: Record<string, number> = {};
  for (const t of model.tables.values()) {
    for (const c of t.columns) {
      if (!c.calculated || !c.dax) continue;
      n++;
      if (!NUMERICO.has(c.type ?? '')) continue;
      const linhas = ev.rootScope().filter.rowsOf(t.name);
      let especie = '(sem linha)';
      let amostra: unknown = undefined;
      try {
        if (linhas.length > 0) {
          const v = ev.columnValue(t.name, c.name, { ...linhas[0]! });
          amostra = v;
          especie = v === null ? 'blank' : v instanceof Date ? 'date' : typeof v;
        }
      } catch (e) {
        especie = `ERRO: ${(e as Error).message.slice(0, 60)}`;
      }
      porEspecie[especie] = (porEspecie[especie] ?? 0) + 1;
      if (especie !== 'number' && especie !== 'blank') {
        console.log(`  ${especie.padEnd(10)} '${t.name}'[${c.name}] type=${c.type} dax=${c.dax.slice(0, 60).replace(/\n/g, ' ')} amostra=${JSON.stringify(amostra)}`);
      }
    }
  }
  console.log(`\ncolunas calculadas no total: ${n}`);
  console.log('espécie devolvida pelas declaradas numéricas:', JSON.stringify(porEspecie, null, 1));
});

test('colunas calculadas declaradas texto que devolvem numero', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ev } = ambiente(model);
  const tipos: Record<string, number> = {};
  for (const t of model.tables.values()) {
    for (const c of t.columns) {
      if (!c.calculated || !c.dax) continue;
      tipos[c.type ?? '(sem tipo)'] = (tipos[c.type ?? '(sem tipo)'] ?? 0) + 1;
    }
  }
  console.log('tipos declarados das calculadas:', JSON.stringify(tipos, null, 1));
});
