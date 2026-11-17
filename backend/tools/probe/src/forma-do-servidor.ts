// A forma completa que o SERVIDOR pede ao carregar uma página do snapshot, refeita para as
// sondas, que carregam com `carrega` direto e precisam da mesma carga para comparar com ela.
// As contas de lá são privadas da classe (`#liberacaoDaPagina`, `#liberacaoDoRecorte`,
// servidor.ts); as daqui seguem as mesmas regras, sem as colunas sob demanda
// (`sob_demanda` está vazio em `projecao.yaml`).

import type { DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';
import { recalculosAoVivo } from '../../../packages/snapshot/src/nativas.ts';
import { planeja } from '../../../packages/snapshot/src/plano.ts';
import { normalizeName, type SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { rotuloDeColuna } from '../../../packages/semantic-model/src/projecao.ts';

/** As tabelas de grão reduzido que os visuais e os filtros de página de `dash` pedem completas. */
function amarradas(dash: DashboardSpec, model: SemanticModel): Set<string> {
  const gatilhos = new Map<string, string>();
  for (const g of model.graoReduzido) for (const c of g.colunasGatilho) gatilhos.set(normalizeName(rotuloDeColuna(g.tabela, c)), g.tabela);
  const completas = new Set<string>();
  const olha = (e: string | null, p: string | null) => {
    const t = e && p ? gatilhos.get(normalizeName(rotuloDeColuna(e, p))) : undefined;
    if (t) completas.add(t);
  };
  for (const v of dash.visuals ?? []) {
    for (const c of v.fields ?? []) if (c.kind !== 'measure') olha(c.entity, c.property);
    for (const f of v.filters ?? []) olha(f.entity, f.property);
  }
  for (const f of dash.filters ?? []) olha(f.entity, f.property);
  return completas;
}

/** A forma completa da página inteira (`#liberacaoDaPagina`): com as fontes do recálculo do tempo real. */
export function formaDaPagina(dash: DashboardSpec, model: SemanticModel): string[] {
  const completas = amarradas(dash, model);
  const recalc = recalculosAoVivo();
  for (const c of planeja([dash], model).calculadas) for (const f of recalc.get(normalizeName(c))?.fontes ?? []) completas.add(f);
  return [...completas];
}

/**
 * A forma completa de um recorte de página ao vivo (`#liberacaoDoRecorte`) — os visuais de
 * fora dela, ou os seletores que listam do snapshot: sem o tempo real.
 */
export function formaDoRecorte(recorte: DashboardSpec, model: SemanticModel): string[] {
  return [...amarradas(recorte, model)];
}
