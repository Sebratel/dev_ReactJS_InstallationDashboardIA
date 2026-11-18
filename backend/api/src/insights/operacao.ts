import { ATIVACAO, MOVIMENTACAO } from './sql.ts';
import { diaDaSemana, ehDiaDeTrabalho, NOME_DIA, somaDias, type Agora } from './calendario.ts';
import { arred, mediana, quantil } from './estat.ts';
import { FAIXAS, type Desfecho, type Projecao } from './premiacao.ts';
import type { DiaPrevisto } from './previsao.ts';
import type { LinhaAgenda, LinhaBase, LinhaInstalacao, LinhaRastreio, LinhaRetrabalho, LinhaTempo } from './tipos.ts';

export const NOME_BASE: Readonly<Record<number, string>> = { 29: 'Canoas', 30: 'São Leopoldo', 34: 'Corporativo' };

const MINUSCULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);

/** "JOAO DA SILVA" → "Joao da Silva". */
export function nomeProprio(nome: string | null | undefined): string {
  if (!nome) return '—';
  return nome
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

/** Primeiro e último nome, para eixo de gráfico. */
export function nomeCurto(nome: string | null | undefined): string {
  const p = nomeProprio(nome).split(' ').filter((x) => !MINUSCULAS.has(x.toLowerCase()));
  return p.length > 1 ? `${p[0]} ${p[p.length - 1]}` : (p[0] ?? '—');
}

/**
 * Estado do atendimento no app (`fsm_attendance_history.routing_status`). O Voalle não
 * publica a tabela de códigos; os rótulos foram INFERIDOS da sequência típica medida em
 * 17/11/2026 — 0 › 1 › 3 › 4 › 7 › 5 › 6 em 180 de 337 atendimentos do dia — e da
 * duração mediana de cada passo (4 ≈ 12 min, 5 ≈ 43 min).
 */
export const ESTADO_APP: Readonly<Record<number, string>> = {
  0: 'reservado',
  1: 'atribuído',
  3: 'na fila do técnico',
  4: 'a caminho',
  7: 'chegou',
  5: 'em execução',
  6: 'concluído',
  8: 'encerrado sem concluir',
};

const STATUS_CONCLUIDO = new Set(['A Faturar', 'Fechado', 'Encerrado']);
const STATUS_SEM_SUCESSO = /improdutivo|pend[eê]ncia|desist|falta de contato|retorno|cancel/i;

export type Categoria = 'concluido' | 'execucao' | 'aCaminho' | 'aguardando' | 'semSucesso';
const CATS: readonly Categoria[] = ['concluido', 'execucao', 'aCaminho', 'aguardando', 'semSucesso'];

export function categoriaDoAtendimento(r: Pick<LinhaAgenda, 'alocado_em' | 'estado' | 'status'>, hoje: string): Categoria {
  if (r.alocado_em === hoje || r.estado === 6 || STATUS_CONCLUIDO.has(r.status ?? '')) return 'concluido';
  if (r.estado === 8 || STATUS_SEM_SUCESSO.test(r.status ?? '')) return 'semSucesso';
  if (r.estado === 5 || r.estado === 7) return 'execucao';
  if (r.estado === 4) return 'aCaminho';
  return 'aguardando';
}

const minutosDesde = (texto: string | null, agora: Agora): number | null => {
  if (!texto) return null;
  const [d, h] = texto.split(' ');
  if (d !== agora.data || !h) return null;
  const [hh = 0, mm = 0] = h.split(':').map(Number);
  return agora.hora * 60 + agora.minuto - (hh * 60 + mm);
};

type Atendimento = LinhaAgenda & { categoria: Categoria };

export interface AgendaDaBase extends Record<Categoria, number> {
  regiao: number;
  base: string;
  total: number;
  ativacoes: number;
  slotsLivres: number;
}

export type Situacao = 'execucao' | 'aCaminho' | 'aguardando' | 'agendaConcluida' | 'semAgenda';

export interface TecnicoAgora {
  tec_id: number;
  nome: string;
  curto: string;
  base: string | null;
  situacao: Situacao;
  semSinal: boolean;
  desde: number | null;
  protocolo: string | null;
  proximoAs: string | null;
  lat: number | null;
  lng: number | null;
  sinalHaMin: number | null;
  agendados: number;
  concluidos: number;
  semSucesso: number;
  hoje: number;
  mes: number;
  faixa: string | null;
}

export interface QualidadeDoTecnico {
  tec_id: number;
  nome: string;
  curto: string;
  instalacoes: number;
  retornos: number;
  taxa: number | null;
  execucaoMin: number | null;
}

export interface Insight {
  pergunta: string;
  resposta: string;
  tom: 'bom' | 'atencao' | 'neutro';
}

interface TempoDoTecnico {
  execucao?: { n: number; min: number | null };
  deslocamento?: { n: number; min: number | null };
}

export function montaOperacao(entrada: {
  agora: Agora;
  regioesAtivacao: readonly number[];
  instalacoes: readonly LinhaInstalacao[];
  agenda: readonly LinhaAgenda[];
  rastreio: readonly LinhaRastreio[];
  bases: readonly LinhaBase[];
  retrabalho: readonly LinhaRetrabalho[];
  tempos: readonly LinhaTempo[];
  projecao: Projecao;
  previsaoHoje: DiaPrevisto | null;
  fatores: Record<string, number | null> | null;
}) {
  const { agora, instalacoes, agenda, rastreio, bases, retrabalho, tempos, projecao, previsaoHoje, fatores } = entrada;
  const hoje = agora.data;
  const regioesAtiv = new Set(entrada.regioesAtivacao);

  // ---------------------------------------------------------------- base de cada técnico
  const baseDo = new Map<number, { regiao: number; n: number }>();
  const totalPorTec = new Map<number, number>();
  for (const b of bases) {
    totalPorTec.set(b.tec_id, (totalPorTec.get(b.tec_id) ?? 0) + b.n);
    if (!regioesAtiv.has(b.regiao)) continue;
    const atual = baseDo.get(b.tec_id);
    if (!atual || b.n > atual.n) baseDo.set(b.tec_id, { regiao: b.regiao, n: b.n });
  }
  // técnico de instalação = a maior parte da agenda dele está numa base de ativação
  const ehDaInstalacao = (id: number | null): boolean => {
    if (id === null) return false;
    const b = baseDo.get(id);
    return b !== undefined && b.n >= 0.5 * (totalPorTec.get(id) ?? 1);
  };

  // ------------------------------------------------------------------ agenda do dia
  const atendimentos = new Map<string, Atendimento>(); // por atendimento reservado
  const slotsLivres = new Map<number, number>();
  const escalados = new Map<number, { tec_id: number; tecnico: string | null; regiao: number; slots: number }>();
  for (const r of agenda) {
    if (r.tec_id) {
      const e = escalados.get(r.tec_id) ?? { tec_id: r.tec_id, tecnico: r.tecnico, regiao: r.regiao, slots: 0 };
      e.slots += 1;
      escalados.set(r.tec_id, e);
    }
    if (!r.reservado || !r.aid) {
      slotsLivres.set(r.regiao, (slotsLivres.get(r.regiao) ?? 0) + 1);
      continue;
    }
    if (!atendimentos.has(r.aid)) atendimentos.set(r.aid, { ...r, categoria: categoriaDoAtendimento(r, hoje) });
  }
  const zerado = (): Record<Categoria, number> => ({ concluido: 0, execucao: 0, aCaminho: 0, aguardando: 0, semSucesso: 0 });
  const porBase = new Map<number, AgendaDaBase>();
  for (const a of atendimentos.values()) {
    const b = porBase.get(a.regiao) ?? { regiao: a.regiao, base: NOME_BASE[a.regiao] ?? `Região ${a.regiao}`, total: 0, ...zerado(), ativacoes: 0, slotsLivres: 0 };
    b.total += 1;
    b[a.categoria] += 1;
    if (a.tipo_id !== null && ATIVACAO.includes(a.tipo_id)) b.ativacoes += 1;
    porBase.set(a.regiao, b);
  }
  const agendaPorBase = [...porBase.values()].map((b) => ({ ...b, slotsLivres: slotsLivres.get(b.regiao) ?? 0 })).sort((a, b) => b.total - a.total);
  const agendaTotal = { ...zerado(), total: 0, slotsLivres: 0, ativacoes: 0 };
  for (const b of agendaPorBase) {
    for (const c of CATS) agendaTotal[c] += b[c];
    agendaTotal.total += b.total;
    agendaTotal.slotsLivres += b.slotsLivres;
    agendaTotal.ativacoes += b.ativacoes;
  }

  // --------------------------------------------------------------- técnicos agora
  const ultimoPonto = new Map(rastreio.map((p) => [p.tec_id, p]));
  const hojePorTec = new Map(projecao.tecnicos.map((t) => [t.tec_id, t]));
  const ids = new Set<number>([...escalados.keys(), ...rastreio.filter((p) => ehDaInstalacao(p.tec_id)).map((p) => p.tec_id)]);
  const todos = [...atendimentos.values()];
  const tecnicos: TecnicoAgora[] = [];
  for (const id of ids) {
    const meus = todos.filter((a) => a.tec_id === id);
    const ponto = ultimoPonto.get(id);
    const emCurso = meus
      .filter((a) => a.categoria === 'execucao' || a.categoria === 'aCaminho')
      .sort((a, b) => (b.estado_desde ?? '').localeCompare(a.estado_desde ?? ''))[0];
    const proximo = meus.filter((a) => a.categoria === 'aguardando').sort((a, b) => (a.inicio ?? '').localeCompare(b.inicio ?? ''))[0];
    let situacao: Situacao = 'semAgenda';
    if (emCurso) situacao = emCurso.categoria === 'execucao' ? 'execucao' : 'aCaminho';
    else if (proximo) situacao = 'aguardando';
    else if (meus.length) situacao = 'agendaConcluida';
    const p = hojePorTec.get(id);
    const esc = escalados.get(id);
    const regiao = esc?.regiao ?? baseDo.get(id)?.regiao;
    const nome = esc?.tecnico ?? ponto?.tecnico ?? p?.tecnico;
    const comPosicao = ponto !== undefined && ponto.ha_min <= 60;
    tecnicos.push({
      tec_id: id,
      nome: nomeProprio(nome),
      curto: nomeCurto(nome),
      base: regiao !== undefined ? (NOME_BASE[regiao] ?? null) : null,
      situacao,
      semSinal: !ponto || ponto.ha_min > 15,
      desde: emCurso ? minutosDesde(emCurso.estado_desde, agora) : null,
      protocolo: emCurso?.protocolo ?? null,
      proximoAs: proximo?.inicio ?? null,
      lat: comPosicao ? Number(ponto.latitude) : null,
      lng: comPosicao ? Number(ponto.longitude) : null,
      sinalHaMin: ponto ? ponto.ha_min : null,
      agendados: meus.length,
      concluidos: meus.filter((a) => a.categoria === 'concluido').length,
      semSucesso: meus.filter((a) => a.categoria === 'semSucesso').length,
      hoje: p?.hoje ?? 0,
      mes: p?.realizado ?? 0,
      faixa: p?.faixaAtual ?? null,
    });
  }
  const ordemSit: Record<Situacao, number> = { execucao: 0, aCaminho: 1, aguardando: 2, agendaConcluida: 3, semAgenda: 4 };
  tecnicos.sort((a, b) => ordemSit[a.situacao] - ordemSit[b.situacao] || b.hoje - a.hoje);

  // ------------------------------------------------------------------- KPIs do dia
  const ativHoje = instalacoes.filter((r) => r.data === hoje && ATIVACAO.includes(r.tipo_id));
  const movHoje = instalacoes.filter((r) => r.data === hoje && MOVIMENTACAO.includes(r.tipo_id)).length;
  const desde30 = somaDias(hoje, -30);
  const prazos = instalacoes
    .filter((r) => ATIVACAO.includes(r.tipo_id) && r.data >= desde30 && r.data < hoje && r.criado)
    .map((r) => Math.max(0, Math.round((Date.parse(`${r.data}T12:00:00Z`) - Date.parse(`${r.criado ?? r.data}T12:00:00Z`)) / 86_400_000)));
  const escaladosInst = [...escalados.values()];
  const comSinal = escaladosInst.filter((e) => (ultimoPonto.get(e.tec_id)?.ha_min ?? 999) <= 15).length;

  // ------------------------------------------------------- ritmo do dia (acumulado)
  const passo = (hora: string | null): number => {
    const [h = 0, m = 0] = (hora ?? '00:00').split(':').map(Number);
    return Math.max(0, Math.min(47, h * 2 + Math.floor(m / 30)));
  };
  const curvaDe = (lista: readonly LinhaInstalacao[]): number[] => {
    const v = Array<number>(48).fill(0);
    for (const r of lista) v[passo(r.hora)] += 1;
    let s = 0;
    return v.map((x) => (s += x));
  };
  const anteriores: number[][] = [];
  for (let d = somaDias(hoje, -7); anteriores.length < 6 && d >= somaDias(hoje, -70); d = somaDias(d, -7)) {
    if (!ehDiaDeTrabalho(d)) continue;
    anteriores.push(curvaDe(instalacoes.filter((r) => r.data === d && ATIVACAO.includes(r.tipo_id))));
  }
  const curvaHoje = curvaDe(ativHoje);
  const passoAgora = agora.hora * 2 + Math.floor(agora.minuto / 30);
  const ritmo: { hora: string; hoje: number | null; tipico: number | null; p25: number | null; p75: number | null }[] = [];
  for (let i = 14; i <= 40; i++) {
    // 07:00 às 20:00
    const naHora = anteriores.map((c) => c[i] ?? 0);
    ritmo.push({
      hora: `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
      hoje: i <= passoAgora ? (curvaHoje[i] ?? 0) : null,
      tipico: arred(mediana(naHora), 0),
      p25: arred(quantil(naHora, 0.25), 0),
      p75: arred(quantil(naHora, 0.75), 0),
    });
  }
  const tipicoAgora = mediana(anteriores.map((c) => c[Math.min(47, passoAgora)] ?? 0));

  // --------------------------------------- mapa de calor: dia da semana × hora (90 dias)
  const desde90 = somaDias(hoje, -90);
  const contagem = new Map<string, number>();
  const diasPorDow = new Map<number, number>();
  for (let d = desde90; d < hoje; d = somaDias(d, 1)) {
    if (ehDiaDeTrabalho(d)) diasPorDow.set(diaDaSemana(d), (diasPorDow.get(diaDaSemana(d)) ?? 0) + 1);
  }
  for (const r of instalacoes) {
    if (!ATIVACAO.includes(r.tipo_id) || r.data < desde90 || r.data >= hoje || !ehDiaDeTrabalho(r.data) || !r.hora) continue;
    const k = `${diaDaSemana(r.data)}-${Number(r.hora.slice(0, 2))}`;
    contagem.set(k, (contagem.get(k) ?? 0) + 1);
  }
  const calor: { dia: string; dow: number; hora: number; media: number | null }[] = [];
  for (let d = 1; d <= 6; d++) {
    for (let h = 8; h <= 19; h++) calor.push({ dia: NOME_DIA[d] ?? '', dow: d, hora: h, media: arred((contagem.get(`${d}-${h}`) ?? 0) / (diasPorDow.get(d) ?? 1), 1) });
  }

  // -------------------------------------------------------------------- retrabalho
  const nomeDo = new Map<number, string>();
  for (const r of instalacoes) if (r.tec_id && r.tecnico) nomeDo.set(r.tec_id, r.tecnico);
  const retPorTec = new Map<number, { tec_id: number; n: number; retornos: number }>();
  const retPorMes = new Map<string, { mes: string; n: number; retornos: number }>();
  for (const r of retrabalho) {
    if (r.tec_id !== null) {
      const t = retPorTec.get(r.tec_id) ?? { tec_id: r.tec_id, n: 0, retornos: 0 };
      t.n += 1;
      if (r.retorno) t.retornos += 1;
      retPorTec.set(r.tec_id, t);
    }
    const m = r.data.slice(0, 7);
    const v = retPorMes.get(m) ?? { mes: m, n: 0, retornos: 0 };
    v.n += 1;
    if (r.retorno) v.retornos += 1;
    retPorMes.set(m, v);
  }
  const taxaGeral = retrabalho.length ? retrabalho.filter((r) => r.retorno).length / retrabalho.length : null;
  const tempoPor = new Map<number, TempoDoTecnico>();
  for (const t of tempos) {
    const v = tempoPor.get(t.tec_id) ?? {};
    v[t.estado === 5 ? 'execucao' : 'deslocamento'] = { n: t.n, min: arred(t.mediana_min, 0) };
    tempoPor.set(t.tec_id, v);
  }
  const qualidade: QualidadeDoTecnico[] = [...retPorTec.values()]
    .filter((t) => t.n >= 15 && ehDaInstalacao(t.tec_id))
    .map((t) => ({
      tec_id: t.tec_id,
      nome: nomeProprio(nomeDo.get(t.tec_id)),
      curto: nomeCurto(nomeDo.get(t.tec_id)),
      instalacoes: t.n,
      retornos: t.retornos,
      taxa: arred(t.retornos / t.n, 3),
      execucaoMin: tempoPor.get(t.tec_id)?.execucao?.min ?? null,
    }));

  const pondera = (estado: number): number | null => {
    const v = tempos.filter((t) => t.estado === estado);
    const n = v.reduce((s, t) => s + t.n, 0);
    return n ? arred(v.reduce((s, t) => s + t.mediana_min * t.n, 0) / n, 0) : null;
  };

  const insights = montaInsights({
    projecao,
    qualidade,
    taxaGeral,
    agendaPorBase,
    fatores,
    previsaoHoje,
    realHoje: ativHoje.length,
    tempos: tempoPor,
    agora,
    escalados: escaladosInst.length,
    comSinal,
  });

  return {
    agora,
    kpis: {
      ativacoesHoje: ativHoje.length,
      movimentacoesHoje: movHoje,
      esperadoAteAgora: previsaoHoje?.esperadoAteAgora ?? null,
      tipicoAteAgora: tipicoAgora,
      estimativaHoje: previsaoHoje?.estimativaHoje ?? null,
      previstoHoje: previsaoHoje?.previsto ?? null,
      agenda: agendaTotal,
      tecnicosEscalados: escaladosInst.length,
      tecnicosComSinal: comSinal,
      tecnicosEmExecucao: tecnicos.filter((t) => t.situacao === 'execucao').length,
      tecnicosACaminho: tecnicos.filter((t) => t.situacao === 'aCaminho').length,
      prazoMedianoDias: mediana(prazos),
      instaladoAte2Dias: prazos.length ? arred(prazos.filter((p) => p <= 2).length / prazos.length, 3) : null,
      retrabalho30d: arred(taxaGeral, 3),
      execucaoMediana: pondera(5),
      deslocamentoMediano: pondera(4),
    },
    agendaPorBase,
    tecnicos,
    ritmo,
    calor,
    qualidade,
    retrabalhoPorMes: [...retPorMes.values()].sort((a, b) => a.mes.localeCompare(b.mes)).map((m) => ({ ...m, taxa: arred(m.retornos / m.n, 3) })),
    insights,
    faixas: FAIXAS,
    estados: ESTADO_APP,
  };
}

export type Operacao = ReturnType<typeof montaOperacao>;

const pct = (x: number, casas = 0): string => `${(x * 100).toFixed(casas).replace('.', ',')}%`;
const num = (x: number, casas = 0): string => x.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const sinal = (x: number): string => `${x >= 0 ? '+' : ''}${pct(x)}`;

const NOME_DESFECHO: Record<Desfecho, string> = {
  sem: 'sem faixa',
  F1: 'Faixa 1',
  F2: 'Faixa 2',
  F3: 'Faixa 3',
  F4: 'Faixa 4',
  F5: 'Faixa 5',
  F6: 'Faixa 6',
  OUTROS: '136 (fora da régua)',
};
const NOME_DIA_LONGO: Record<number, string> = { 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta', 6: 'Sábado' };

/** Perguntas que um coordenador de instalação faz, respondidas com os números do dia. */
function montaInsights(e: {
  projecao: Projecao;
  qualidade: readonly QualidadeDoTecnico[];
  taxaGeral: number | null;
  agendaPorBase: readonly AgendaDaBase[];
  fatores: Record<string, number | null> | null;
  previsaoHoje: DiaPrevisto | null;
  realHoje: number;
  tempos: Map<number, TempoDoTecnico>;
  agora: Agora;
  escalados: number;
  comSinal: number;
}): Insight[] {
  const out: Insight[] = [];
  const { projecao, agora } = e;

  // 1) quem deve fechar mais alto
  const topo = [...projecao.tecnicos].sort((a, b) => b.esperado - a.esperado).slice(0, 3);
  if (topo.length) {
    out.push({
      pergunta: 'Quem deve fechar o mês nas faixas mais altas?',
      resposta: topo
        .map((t) => `${nomeCurto(t.tecnico)}: ${t.realizado} hoje → ${t.esperado} projetados, ${NOME_DESFECHO[t.maisProvavel]} (${pct(t.probs[t.maisProvavel])})`)
        .join(' · '),
      tom: 'bom',
    });
  }

  // 2) a fronteira: o limite de faixa que o técnico tem entre 30% e 70% de chance de passar
  const fronteira: { nome: string; faixa: (typeof FAIXAS)[number]; chance: number; esperado: number }[] = [];
  for (const t of projecao.tecnicos) {
    let acima = 0;
    for (let i = FAIXAS.length - 1; i >= 0; i--) {
      const f = FAIXAS[i];
      if (!f) continue;
      acima += t.probs[f.id] + (f.id === 'F6' ? t.probs.OUTROS : 0);
      if (acima >= 0.3 && acima <= 0.7 && f.min > t.realizado) {
        fronteira.push({ nome: nomeCurto(t.tecnico), faixa: f, chance: acima, esperado: t.esperado });
        break;
      }
    }
  }
  fronteira.sort((a, b) => Math.abs(a.chance - 0.5) - Math.abs(b.chance - 0.5));
  if (fronteira.length) {
    out.push({
      pergunta: `Quem está na fronteira de uma faixa (${fronteira.length} técnicos)?`,
      resposta: `${fronteira
        .slice(0, 4)
        .map((x) => `${x.nome}: ${pct(x.chance)} de chegar à ${x.faixa.nome} (${x.faixa.min}; projeção ${x.esperado})`)
        .join(' · ')}. É aqui que acompanhamento e agenda bem montada mudam o resultado.`,
      tom: 'atencao',
    });
  }
  const perto136 = projecao.tecnicos.filter((t) => t.perto136 || t.probs.OUTROS >= 0.05);
  if (perto136.length) {
    out.push({
      pergunta: 'Alguém pode cair no buraco da regra oficial (exatamente 136)?',
      resposta: `${perto136.map((t) => nomeCurto(t.tecnico)).join(', ')}. Na medida Faixas do relatório, 136 não é Faixa 5 nem Faixa 6 (o DAX usa "> 136"). Vale corrigir a régua antes do fechamento.`,
      tom: 'atencao',
    });
  }

  // 3) ritmo de hoje
  const esperado = e.previsaoHoje?.esperadoAteAgora;
  if (e.previsaoHoje && esperado !== undefined && esperado > 5 && ehDiaDeTrabalho(agora.data)) {
    const desvio = e.realHoje / esperado - 1;
    out.push({
      pergunta: `Estamos no ritmo às ${String(agora.hora).padStart(2, '0')}h${String(agora.minuto).padStart(2, '0')}?`,
      resposta: `${num(e.realHoje)} ativações contra ${num(esperado)} esperadas até agora (${sinal(desvio)}). Fechamento estimado do dia: ${num(e.previsaoHoje.estimativaHoje ?? e.realHoje)}.`,
      tom: desvio >= -0.05 ? 'bom' : 'atencao',
    });
  }

  // 4) base com mais agenda por fazer
  const comAgenda = e.agendaPorBase.filter((b) => b.total >= 10);
  if (comAgenda.length >= 2) {
    const atraso = comAgenda
      .map((b) => ({ ...b, pendente: (b.aguardando + b.aCaminho + b.execucao) / b.total, sucesso: b.concluido / b.total }))
      .sort((a, b) => b.pendente - a.pendente);
    out.push({
      pergunta: 'Qual base tem mais agenda por fazer agora?',
      resposta: atraso
        .map((b) => `${b.base}: ${pct(b.pendente)} da agenda em aberto, ${pct(b.sucesso)} concluída, ${b.semSucesso} sem sucesso, ${b.slotsLivres} slots livres`)
        .join(' · '),
      tom: 'neutro',
    });
  }

  // 5) dia da semana
  if (e.fatores) {
    const f = e.fatores;
    const lista = [1, 2, 3, 4, 5].map((d) => ({ d, f: f[d] ?? 1 })).sort((a, b) => b.f - a.f);
    const [primeiro, segundo] = lista;
    const ultimo = lista[lista.length - 1];
    if (primeiro && segundo && ultimo) {
      out.push({
        pergunta: 'Qual dia da semana mais instala?',
        resposta: `${NOME_DIA_LONGO[primeiro.d]} (${sinal(primeiro.f - 1)}) e ${NOME_DIA_LONGO[segundo.d]?.toLowerCase()} (${sinal(segundo.f - 1)}) contra a média de segunda a sexta; ${NOME_DIA_LONGO[ultimo.d]?.toLowerCase()} é o dia útil mais fraco (${sinal(ultimo.f - 1)}). Sábado rende ${sinal((f[6] ?? 1) - 1)} — meio expediente e menos técnicos.`,
        tom: 'neutro',
      });
    }
  }

  // 6) retrabalho
  if (e.qualidade.length >= 5 && e.taxaGeral !== null) {
    const ord = [...e.qualidade].sort((a, b) => (b.taxa ?? 0) - (a.taxa ?? 0));
    const pior = ord.slice(0, 2);
    const melhor = ord[ord.length - 1];
    if (melhor) {
      out.push({
        pergunta: 'Onde está o retrabalho (cliente chamando por problema em até 30 dias)?',
        resposta: `Equipe: ${pct(e.taxaGeral, 1)} das ativações. Maiores taxas: ${pior.map((t) => `${t.curto} ${pct(t.taxa ?? 0)} (${t.retornos} de ${t.instalacoes})`).join(', ')}. Menor: ${melhor.curto} ${pct(melhor.taxa ?? 0)}.`,
        tom: 'atencao',
      });
    }
  }

  // 7) tempo de instalação
  const exec = [...e.tempos.values()].flatMap((v) => (v.execucao && v.execucao.n >= 20 && v.execucao.min !== null ? [v.execucao.min] : []));
  const med = mediana(exec);
  if (exec.length >= 5 && med !== null) {
    const lentos = exec.filter((m) => m >= med * 1.4).length;
    out.push({
      pergunta: 'Quanto tempo leva uma instalação na casa do cliente?',
      resposta: `Mediana de ${num(med)} min em execução no app (do "chegou" ao "concluído"). ${lentos} técnico(s) levam 40% ou mais acima disso — candidato a acompanhamento em campo, não a cobrança: pode ser a região ou o tipo de serviço.`,
      tom: 'neutro',
    });
  }

  // 8) sinal
  const semSinal = e.escalados - e.comSinal;
  if (e.escalados && agora.hora >= 8 && agora.hora < 19) {
    out.push({
      pergunta: 'Todo mundo escalado está aparecendo no mapa?',
      resposta:
        semSinal > 0
          ? `${semSinal} de ${e.escalados} técnicos escalados estão sem ponto de GPS há mais de 15 minutos (app fechado, celular sem sinal ou fora de serviço).`
          : `Sim: os ${e.escalados} técnicos escalados mandaram posição nos últimos 15 minutos.`,
      tom: semSinal > 0 ? 'atencao' : 'bom',
    });
  }
  return out;
}
