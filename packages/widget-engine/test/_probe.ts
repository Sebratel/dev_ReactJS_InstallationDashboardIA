// Sonda temporária. Apagar depois.
import { SemanticModel } from '../../semantic-model/src/model.ts';
import { ambiente, SPECS } from '../../measure-engine/test/ambiente-sintetico.ts';
import { calculaTabela, tabelasDoDashboard } from '../src/tabela.ts';
import { ehFiltroDeGrupo } from '../src/filtro.ts';
import { loadDashboards } from '../src/spec.ts';

const model = SemanticModel.fromSpecsDir(SPECS);
const { ev } = ambiente(model);
const dashboards = loadDashboards(SPECS);

function familia(msg: string): string {
  if (msg.includes('HAVING')) return 'filtro sobre agregado';
  if (msg.includes('tabelas')) return 'chaves de mais de uma tabela';
  if (msg.includes("kind 'hierarchy_level'")) return 'nível de hierarquia como célula';
  if (msg.includes("kind 'arithmetic'")) return 'campo aritmético';
  if (msg.includes('[CONTAGEM])')) return 'CONTAGEM: texto onde se declarou int64';
  return 'NÃO CLASSIFICADA: ' + msg.slice(0, 110);
}

let total = 0;
let ok = 0;
let linhas = 0;
let comHaving = 0;
const fam: Record<string, number> = {};
for (const d of dashboards) {
  for (const v of tabelasDoDashboard(d)) {
    total++;
    const temHaving = [...(d.filters ?? []), ...(v.filters ?? [])].some(ehFiltroDeGrupo);
    try {
      const r = calculaTabela(d, v, ev);
      ok++;
      linhas += r.linhas.length;
      if (temHaving) comHaving++;
    } catch (e) {
      const k = familia((e as Error).message);
      fam[k] = (fam[k] ?? 0) + 1;
    }
  }
}
console.log(`tableEx ${total} | calculam ${ok} | linhas ${linhas} | com HAVING que agora rodam ${comHaving}`);
console.log(fam);

// Os 10 filtros sobre agregado: quantos ainda não têm quem os aplique?
let deGrupo = 0;
const porTipo: Record<string, number> = {};
for (const d of dashboards) {
  for (const f of d.filters ?? []) if (ehFiltroDeGrupo(f)) { deGrupo++; porTipo['PAGINA'] = (porTipo['PAGINA'] ?? 0) + 1; }
  for (const v of d.visuals ?? []) {
    for (const f of v.filters ?? []) if (ehFiltroDeGrupo(f)) { deGrupo++; porTipo[v.type] = (porTipo[v.type] ?? 0) + 1; }
  }
}
console.log(`filtros sobre agregado: ${deGrupo}`, porTipo);
