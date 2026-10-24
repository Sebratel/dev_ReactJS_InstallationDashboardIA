// O que um pedido de `agendamento-field` pode buscar ao vivo: o PERÍODO que a tela
// pediu e os VISUAIS que esse período responde. Ver docs/DECISAO-AO-VIVO.md.
//
// O período sai da segmentação da tela em `calendar[Data]` (Ano > Mês, a que a página
// abre por padrão — `filtros-padrao.ts`). É o MESMO critério do recorte da agenda,
// porque `calendar[Data]` é `DATEVALUE('FIELD AGENDA'[Slot Agenda])` e o recorte guarda
// todo protocolo com algum `Slot Agenda` no período. Meses salteados viram o intervalo
// que os cobre: protocolo a mais é seguro (o filtro da tela continua valendo no cálculo,
// e o protocolo sem dia no período não passa por ele); protocolo a menos não seria.
//
// Fica FORA do ao vivo — o pedido ou o visual segue pelo snapshot, como hoje:
//   - pedido sem período reconhecível (sem filtro de calendário, data crua, nível Dia…);
//   - período mais longo que `TETO_DE_DIAS` (o ano inteiro é a fase de cache aquecido);
//   - filtro de tela em coluna gatilho do grão reduzido (o grão relato não vem para a API);
//   - visual que cita coluna gatilho, pela MESMA regra de `sobDemandaDoVisual`
//     (servidor.ts): campo que não é medida, e filtro do visual;
//   - visual de horizonte de previsão (`ignoraDataDaTela`): ele ignora o mês da tela, e o
//     que ele mostra vive de hoje em diante, fora do período buscado.

import { projecaoDeHierarquia } from '../../measure-engine/src/evaluator.ts';
import { normalizeName, type SemanticModel } from '../../semantic-model/src/model.ts';
import { rotuloDeColuna } from '../../semantic-model/src/projecao.ts';
import { ignoraDataDaTela } from '../../widget-engine/src/filtros-padrao.ts';
import type { DashboardSpec, FiltroSpec } from '../../widget-engine/src/spec.ts';

export interface PeriodoAoVivo {
  /** `AAAA-MM-DD`, início inclusive. */
  readonly desde: string;
  /** `AAAA-MM-DD`, fim exclusivo. */
  readonly ate: string;
}

/** A coluna cuja segmentação dá o período. */
export const COLUNA_DO_PERIODO = { tabela: 'calendar', coluna: 'Data' } as const;

/**
 * Dois meses. Um mês com a virada para o seguinte cabe; o ano não — a agenda de 3
 * meses e os protocolos dela levam ~1 min no SRD (22/10/2026), e isso só serve com o
 * cache aquecido em segundo plano.
 */
export const TETO_DE_DIAS = 62;

/** Os meses como a hierarquia de datas os escreve — a MESMA tabela que o filtro aplica. */
const MESES: readonly string[] = Array.from({ length: 12 }, (_, m) =>
  String(projecaoDeHierarquia('Mês')!(new Date(Date.UTC(2000, m, 15)))),
);

const dia = (ano: number, mes: number): string => new Date(Date.UTC(ano, mes, 1)).toISOString().slice(0, 10);

export type Decisao =
  | { readonly periodo: PeriodoAoVivo; readonly fora: ReadonlyMap<string, string> }
  | { readonly porque: string };

/** O período da segmentação da tela, ou por que ela não dá um. */
export function periodoDaTela(filtros: readonly FiltroSpec[], tetoDeDias = TETO_DE_DIAS): { periodo: PeriodoAoVivo } | { porque: string } {
  const alvo = normalizeName(rotuloDeColuna(COLUNA_DO_PERIODO.tabela, COLUNA_DO_PERIODO.coluna));
  const doCalendario = filtros.filter((f) => f.entity && f.property && normalizeName(rotuloDeColuna(f.entity, f.property)) === alvo);
  if (doCalendario.length === 0) return { porque: 'sem segmentação de calendar[Data] — o período seria a janela inteira' };

  let anos: number[] | null = null;
  let meses: number[] | null = null;
  for (const f of doCalendario) {
    const c = f.conditions[0];
    if (f.conditions.length !== 1 || c?.op !== 'in') return { porque: 'filtro de calendar[Data] que não é uma lista de valores' };
    const nivel = f.nivel ? normalizeName(f.nivel) : null;
    if (nivel === 'ano') {
      const lidos = c.values.map((v) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d{4}$/.test(v) ? Number(v) : NaN));
      if (lidos.some((a) => !Number.isInteger(a))) return { porque: 'ano da segmentação que não é um ano' };
      anos = lidos;
    } else if (nivel === 'mês' || nivel === 'mes') {
      const lidos = c.values.map((v) => MESES.indexOf(String(v)));
      if (lidos.some((m) => m < 0)) return { porque: 'mês da segmentação que não é um mês' };
      meses = lidos;
    } else {
      return { porque: `calendar[Data] pelo nível ${f.nivel ?? '(data crua)'} — só Ano e Mês têm período ao vivo` };
    }
  }
  if (!anos) return { porque: 'segmentação de mês sem ano — o mês de todos os anos' };

  const a0 = Math.min(...anos);
  const a1 = Math.max(...anos);
  const m0 = meses ? Math.min(...meses) : 0;
  const m1 = meses ? Math.max(...meses) : 11;
  const periodo = { desde: dia(a0, m0), ate: dia(a1, m1 + 1) };
  const dias = (Date.parse(periodo.ate) - Date.parse(periodo.desde)) / 86_400_000;
  if (dias > tetoDeDias) return { porque: `período de ${dias} dias, acima do teto de ${tetoDeDias} do ao vivo` };
  return { periodo };
}

/** As colunas gatilho do grão reduzido, por rótulo normalizado. */
function colunasGatilho(model: SemanticModel): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of model.graoReduzido) {
    for (const c of g.colunasGatilho) m.set(normalizeName(rotuloDeColuna(g.tabela, c)), rotuloDeColuna(g.tabela, c));
  }
  return m;
}

/** Os visuais da página que o ao vivo não responde, com o motivo de cada um. */
export function visuaisForaDoAoVivo(dash: DashboardSpec, model: SemanticModel): Map<string, string> {
  const gatilhos = colunasGatilho(model);
  const fora = new Map<string, string>();
  for (const v of dash.visuals ?? []) {
    if (ignoraDataDaTela(dash.id, v.id)) {
      fora.set(v.id, 'horizonte de previsão: ignora o mês da tela');
      continue;
    }
    const citadas = new Set<string>();
    const olha = (entity: string | null, property: string | null): void => {
      if (!entity || !property) return;
      const r = gatilhos.get(normalizeName(rotuloDeColuna(entity, property)));
      if (r) citadas.add(r);
    };
    for (const c of v.fields ?? []) if (c.kind !== 'measure') olha(c.entity, c.property);
    for (const f of v.filters ?? []) olha(f.entity, f.property);
    if (citadas.size) fora.set(v.id, `cita ${[...citadas].join(', ')} (grão relato)`);
  }
  return fora;
}

/** A página sem os visuais que o ao vivo não responde — o plano de carga do snapshot do período. */
export function semForaDoAoVivo(dash: DashboardSpec, model: SemanticModel): DashboardSpec {
  const fora = visuaisForaDoAoVivo(dash, model);
  return { ...dash, visuals: (dash.visuals ?? []).filter((v) => !fora.has(v.id)) };
}

const MARCA_AO_VIVO = '@ao-vivo:';

/**
 * O id com que a página ao vivo de UM período anda pela piscina de workers.
 *
 * Próprio, e não o da página: a worker guarda o conjunto carregado por id de página
 * (`cacheDeCarga`, `identidadePorPagina`). Com o mesmo id, o snapshot pequeno de um
 * período e o snapshot inteiro da página (que ainda responde os visuais de fora) se
 * derrubariam a cada pedido, e o aviso do poller (`invalidaPagina`) limparia junto um
 * dado que não veio do snapshot.
 */
export function idDaPaginaAoVivo(pagina: string, p: PeriodoAoVivo): string {
  return `${pagina}${MARCA_AO_VIVO}${p.desde}..${p.ate}`;
}

/** A página de um id ao vivo, ou `null` se o id é de página comum. */
export function paginaDoIdAoVivo(id: string): string | null {
  const i = id.indexOf(MARCA_AO_VIVO);
  return i < 0 ? null : id.slice(0, i);
}

/** O pedido inteiro: dá para buscar ao vivo? E, se dá, quais visuais ficam de fora. */
export function decideAoVivo(dash: DashboardSpec, daTela: readonly FiltroSpec[], model: SemanticModel): Decisao {
  const gatilhos = colunasGatilho(model);
  const tocada = daTela.find((f) => f.entity && f.property && gatilhos.has(normalizeName(rotuloDeColuna(f.entity, f.property))));
  if (tocada) return { porque: `filtro de tela em ${rotuloDeColuna(tocada.entity!, tocada.property!)} (grão relato)` };
  const p = periodoDaTela(daTela);
  if ('porque' in p) return p;
  return { periodo: p.periodo, fora: visuaisForaDoAoVivo(dash, model) };
}
