// O conjunto da JANELA que serve as páginas de protocolos ao vivo (docs/DECISAO-AO-VIVO.md,
// fase 2): Visão Geral, Relatório do Mês, Relatório do Ano, Telefonia e as três dicas.
//
// Elas mostram a janela inteira da PROTOCOLOS GERAL — desde o início do ano anterior, a
// regra do Misael de 24/10/2026 — sem corte de página e, quase todas, sem filtro de
// período ao abrir. Então o conjunto é a janela: a PG, a telefonia e a agenda nas
// consultas do catálogo, e o filtro da tela é aplicado no cálculo, como hoje. Leva ~2 min
// de SRD; é buscado em segundo plano e guardado por 10 min (`periodos-ao-vivo.ts`).
//
// **A agenda vem no grão de slot**, não a completa (640 mil linhas). Pelo snapshot, o
// Relatório do Mês carrega a completa só porque o tempo real recalcula a `calendar` dela
// sobre o grão relato (`recalculosAoVivo`); o ao vivo não tem overlay, e a `calendar` é o
// DISTINCT (protocolo, data) do slot — o mesmo. Visual que cita coluna do grão relato fica
// fora, como na Agendamento Field.
//
// **As calculadas são recalculadas** sobre o dado ao vivo (DAX no carregamento, ≤ 4 s no
// total): nenhuma destas páginas tem corte, então o recálculo é o que o refresh faz.

import { relogioDeParede } from '../../measure-engine/src/relogio.ts';
import type { SemanticModel } from '../../semantic-model/src/model.ts';
import type { DashboardSpec } from '../../widget-engine/src/spec.ts';
import { buscaAoVivo, type ContextoAoVivo } from './executor.ts';
import { visuaisForaDoAoVivo, type Decisao, type PeriodoAoVivo } from './periodo.ts';
import type { TabelaDoPeriodo } from './snapshot-do-periodo.ts';

/** As páginas que o conjunto da janela serve. */
export const PAGINAS_DA_JANELA: readonly string[] = [
  'visao-geral',
  'relatorio-do-mes',
  'relatorio-do-ano',
  'telefonia-ouvidoria',
  'l-inst',
  'l-mapa',
  'l-tec',
];

/** As queries que vêm do SRD — inteiras, as do catálogo; as outras são copiadas do snapshot. */
export const QUERIES_DA_JANELA: readonly string[] = ['protocolos-geral', 'protocolos-telefonia', 'field-agenda-slot'];

/** A janela do histórico: do início do ano anterior ao início do próximo (o piso das specs). */
export function periodoDaJanela(agora: Date): PeriodoAoVivo {
  const ano = relogioDeParede(agora).getUTCFullYear();
  return { desde: `${ano - 1}-01-01`, ate: `${ano + 1}-01-01` };
}

/** Todo pedido destas páginas vai pela janela; ficam fora os visuais do grão relato. */
export function decideDaJanela(dash: DashboardSpec, model: SemanticModel, agora: Date): Decisao {
  return { periodo: periodoDaJanela(agora), fora: visuaisForaDoAoVivo(dash, model) };
}

/** As três consultas do catálogo, ao mesmo tempo. */
export async function buscaDaJanela(
  ctx: ContextoAoVivo,
  agora: Date,
): Promise<{ consultas: TabelaDoPeriodo[]; protocolos: number }> {
  // Uma depois da outra, a PG primeiro: juntas, os pipelines de M somavam os picos e o
  // processo da busca não cabia em 800 MB de heap; assim cabe, com pico de 902 MB de RSS
  // (24/10/2026, `geracao-em-processo.ts`).
  const feitas = [];
  for (const query of QUERIES_DA_JANELA) feitas.push(await buscaAoVivo(ctx, { query, agora }));
  const consultas = feitas.map((r) => ({ query: r.query, colunas: r.colunas, linhas: r.linhas }));
  return { consultas, protocolos: feitas[0]!.linhas.length };
}
