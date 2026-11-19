import { ATIVACAO } from './sql.ts';
import { dias, diaDaSemana, ehDiaDeEscala, ehFeriado, fimDoMes, inicioDoMes, somaDias, type Agora } from './calendario.ts';
import { arred, gerador, icMediana, mediana, quantil, soma, type Aleatorio } from './estat.ts';
import type { ChuvaDoDia } from './clima.ts';
import type { LinhaAgendaFutura, LinhaDemanda, LinhaInstalacao } from './tipos.ts';

/**
 * PREVISÃO DIÁRIA DE ATIVAÇÕES
 *
 * Modelo deliberadamente simples, porque o padrão é forte e simples:
 *   previsto(d) = nível × fator do dia da semana(d) × [fator feriado] × [fator chuva]
 *  - fator do dia da semana: média de cada dia nos últimos ~6 meses ÷ média de seg–sex
 *    (sábado rende ~60% de um dia útil, segunda ~90%);
 *  - nível: média ponderada (meia-vida de 10 dias de trabalho) das últimas 40 razões
 *    real ÷ fator, aparada nos extremos para um dia atípico não puxar a previsão.
 *
 * O que separa isto de um chute é o TESTE: o modelo é refeito em cada dia do histórico
 * usando só o que se sabia até a véspera, e prevê os 21 dias seguintes. Os erros desse
 * teste dão (1) os intervalos — nada de "±10%" inventado — e (2) o acerto mostrado na tela.
 * A cobertura do intervalo é medida em dias que NÃO entraram no cálculo dele.
 */

const INICIO = '2025-01-01';
const JANELA_NIVEL = 40;
const MEIA_VIDA = 10;
const JANELA_FATORES = 156; // ~6 meses de dias de escala
const HORIZONTE = 21;
const SIMULACOES = 4000;

interface Ponto {
  d: string;
  y: number;
  dow: number;
  feriado: boolean;
}

interface PassoDoTeste {
  d: string;
  y: number;
  base: number;
  feriado: boolean;
}

interface Origem {
  d: string;
  caminho: PassoDoTeste[];
}

export function montaSerie(instalacoes: readonly LinhaInstalacao[], ate: string): Ponto[] {
  const conta = new Map<string, number>();
  for (const r of instalacoes) {
    if (ATIVACAO.includes(r.tipo_id) && r.data >= INICIO && r.data <= ate) conta.set(r.data, (conta.get(r.data) ?? 0) + 1);
  }
  return dias(INICIO, ate).filter(ehDiaDeEscala).map((d) => ({ d, y: conta.get(d) ?? 0, dow: diaDaSemana(d), feriado: ehFeriado(d) }));
}

function fatores(pontos: readonly Ponto[], i: number): number[] {
  const somaDia = Array<number>(8).fill(0);
  const nDia = Array<number>(8).fill(0);
  for (let k = Math.max(0, i - JANELA_FATORES); k < i; k++) {
    const p = pontos[k];
    if (p.feriado) continue;
    somaDia[p.dow] += p.y;
    nDia[p.dow] += 1;
  }
  const medias = somaDia.map((s, j) => (nDia[j] ? s / nDia[j] : null));
  const uteis = medias.slice(1, 6).filter((m): m is number => m !== null);
  const base = uteis.length ? uteis.reduce((a, b) => a + b, 0) / uteis.length : 1;
  return medias.map((m) => (m === null || !base ? 1 : m / base));
}

function nivel(pontos: readonly Ponto[], i: number, f: readonly number[]): number {
  const razoes: number[] = [];
  for (let k = i - 1; k >= 0 && razoes.length < JANELA_NIVEL; k--) {
    const p = pontos[k];
    if (p.feriado || !f[p.dow]) continue;
    razoes.push(p.y / f[p.dow]);
  }
  if (!razoes.length) return 0;
  const m = mediana(razoes) ?? 0;
  let s = 0;
  let sp = 0;
  razoes.forEach((r, idade) => {
    const w = 0.5 ** (idade / MEIA_VIDA);
    s += w * Math.min(Math.max(r, 0.4 * m), 1.6 * m);
    sp += w;
  });
  return s / sp;
}

/** O modelo refeito em cada dia do histórico, prevendo os 21 dias seguintes. */
function teste(pontos: readonly Ponto[]): Origem[] {
  const origens: Origem[] = [];
  const primeira = pontos.findIndex((p) => p.d >= '2025-03-03');
  for (let o = Math.max(primeira, 50); o < pontos.length; o++) {
    const f = fatores(pontos, o);
    const nv = nivel(pontos, o, f);
    const caminho: PassoDoTeste[] = [];
    for (let h = 0; h < HORIZONTE && o + h < pontos.length; h++) {
      const p = pontos[o + h];
      caminho.push({ d: p.d, y: p.y, base: nv * f[p.dow], feriado: p.feriado });
    }
    origens.push({ d: pontos[o].d, caminho });
  }
  return origens;
}

const FAIXAS_CHUVA = [
  { id: 'seco', rotulo: 'Sem chuva (< 1 mm)', ate: 1 },
  { id: 'fraca', rotulo: 'Fraca (1–10 mm)', ate: 10 },
  { id: 'moderada', rotulo: 'Moderada (10–25 mm)', ate: 25 },
  { id: 'forte', rotulo: 'Forte (≥ 25 mm)', ate: Infinity },
] as const;
type IdChuva = (typeof FAIXAS_CHUVA)[number]['id'];
const faixaChuva = (mm: number): IdChuva => (FAIXAS_CHUVA.find((f) => mm < f.ate) ?? FAIXAS_CHUVA[3]).id;

export interface EfeitoDaChuva {
  id: IdChuva;
  rotulo: string;
  dias: number;
  efeito: number | null;
  ic: [number | null, number | null];
  fator: number;
  aplicado: boolean;
}

/** Quanto a chuva derruba, medido no erro do próprio modelo (que não sabe da chuva). */
function efeitoChuva(origens: readonly Origem[], clima: Map<string, ChuvaDoDia> | null, aleatorio: Aleatorio) {
  const porFaixa: Record<IdChuva, number[]> = { seco: [], fraca: [], moderada: [], forte: [] };
  for (const o of origens) {
    const p = o.caminho[0];
    const c = clima?.get(p.d);
    if (!c || p.feriado || p.base <= 0) continue;
    porFaixa[faixaChuva(c.mm)].push(p.y / p.base);
  }
  const referencia = mediana(porFaixa.seco) || 1;
  const faixas: EfeitoDaChuva[] = FAIXAS_CHUVA.map((f) => {
    const v = porFaixa[f.id];
    const med = mediana(v);
    const [lo, hi] = icMediana(v, aleatorio);
    // só vira ajuste o que é claro: dias suficientes e o intervalo inteiro abaixo do seco
    const aplica = f.id !== 'seco' && v.length >= 8 && hi !== null && hi / referencia < 0.97;
    return {
      id: f.id,
      rotulo: f.rotulo,
      dias: v.length,
      efeito: med === null ? null : arred(med / referencia - 1, 3),
      ic: [lo !== null ? arred(lo / referencia - 1, 3) : null, hi !== null ? arred(hi / referencia - 1, 3) : null],
      fator: aplica && med !== null ? (arred(med / referencia, 3) ?? 1) : 1,
      aplicado: aplica,
    };
  });
  const fatorDe = (mm: number | null | undefined): number =>
    mm === null || mm === undefined ? 1 : (faixas.find((x) => x.id === faixaChuva(mm))?.fator ?? 1);
  return { faixas, fatorDe };
}

/** Quanto um feriado de fato rende, em vez de zerar por decreto. */
function fatorFeriado(origens: readonly Origem[]): { fator: number; dias: number } {
  const r = origens.map((o) => o.caminho[0]).filter((p) => p.feriado && p.base > 0).map((p) => p.y / p.base);
  return { fator: r.length >= 3 ? (mediana(r) ?? 0.1) : 0.1, dias: r.length };
}

/** Razões real ÷ previsto por horizonte, sem feriados (eles têm fator próprio). */
function razoesPorHorizonte(origens: readonly Origem[]): number[][] {
  const por = Array.from({ length: HORIZONTE }, (): number[] => []);
  for (const o of origens) {
    o.caminho.forEach((p, h) => {
      if (!p.feriado && p.base > 0) por[h].push(p.y / p.base);
    });
  }
  return por;
}

export interface PerfilHorario {
  util: number[];
  sab: number[];
}

/** Que fração das ativações do dia já costuma estar lançada a cada 15 minutos. */
export function perfilHorario(instalacoes: readonly LinhaInstalacao[], hoje: string): PerfilHorario {
  const desde = somaDias(hoje, -60);
  const util = Array<number>(96).fill(0);
  const sab = Array<number>(96).fill(0);
  for (const r of instalacoes) {
    if (!ATIVACAO.includes(r.tipo_id) || r.data < desde || r.data >= hoje || !r.hora) continue;
    const [hh, mm] = r.hora.split(':').map(Number);
    const slot = Math.min(95, hh * 4 + Math.floor(mm / 15));
    (diaDaSemana(r.data) === 6 ? sab : util)[slot] += 1;
  }
  const acumula = (v: number[]): number[] => {
    const total = soma(v) || 1;
    let s = 0;
    return v.map((x) => (s += x) / total);
  };
  return { util: acumula(util), sab: acumula(sab) };
}

export function fracaoDoDia(perfil: PerfilHorario, dia: string, hora: number, minuto: number): number {
  const v = diaDaSemana(dia) === 6 ? perfil.sab : perfil.util;
  return v[Math.min(95, hora * 4 + Math.floor(minuto / 15))] ?? 0;
}

export interface DiaPrevisto {
  d: string;
  dow: number;
  feriado: boolean;
  previsto: number;
  p10: number;
  p90: number;
  chuvaMm: number | null;
  chuvaProb: number | null;
  ajusteChuva: number | null;
  agendaSlots: number | null;
  agendaReservados: number | null;
  agendaTecnicos: number | null;
  real?: number;
  fracaoDecorrida?: number;
  estimativaHoje?: number;
  esperadoAteAgora?: number;
}

export function preve(entrada: {
  instalacoes: readonly LinhaInstalacao[];
  clima: Map<string, ChuvaDoDia> | null;
  agendaFutura: readonly LinhaAgendaFutura[];
  agora: Agora;
  metaMes: number | null;
}) {
  const { instalacoes, clima, agendaFutura, agora, metaMes } = entrada;
  const hoje = agora.data;
  const aleatorio = gerador(`previsao-${hoje}`);
  const pontos = montaSerie(instalacoes, somaDias(hoje, -1));
  const origens = teste(pontos);
  const fer = fatorFeriado(origens);
  const chuva = efeitoChuva(origens, clima, aleatorio);
  const razoes = razoesPorHorizonte(origens);
  const q = (h: number, p: number, padrao: number): number => quantil(razoes[Math.min(h, HORIZONTE - 1)], p) ?? padrao;

  // ---- qualidade: intervalo calculado nas origens antigas, conferido nas 60 mais novas
  const recentes = origens.slice(-60);
  const razoesAntigas = razoesPorHorizonte(origens.slice(0, -60));
  const blocos = [
    { rotulo: 'amanhã', hs: [1] },
    { rotulo: '2 a 5 dias', hs: [2, 3, 4, 5] },
    { rotulo: '6 a 10 dias', hs: [6, 7, 8, 9, 10] },
    { rotulo: '11 a 20 dias', hs: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20] },
  ];
  const qualidade = blocos.map((b) => {
    let erro = 0;
    let real = 0;
    let dentro = 0;
    let n = 0;
    for (const o of recentes) {
      for (const h of b.hs) {
        const p = o.caminho[h];
        if (!p || p.feriado || p.base <= 0) continue;
        const r = razoesAntigas[h];
        erro += Math.abs(p.y - p.base * (quantil(r, 0.5) ?? 1));
        real += p.y;
        if (p.y >= p.base * (quantil(r, 0.1) ?? 0.8) && p.y <= p.base * (quantil(r, 0.9) ?? 1.2)) dentro += 1;
        n += 1;
      }
    }
    return { horizonte: b.rotulo, dias: n, erroMedio: real ? arred(erro / real, 3) : null, cobertura: n ? arred(dentro / n, 3) : null };
  });

  // ---- o modelo de hoje
  const f = fatores(pontos, pontos.length);
  const nv = nivel(pontos, pontos.length, f);
  const perfil = perfilHorario(instalacoes, hoje);
  const fracao = ehDiaDeEscala(hoje) ? fracaoDoDia(perfil, hoje, agora.hora, agora.minuto) : 1;
  const realHoje = instalacoes.filter((r) => r.data === hoje && ATIVACAO.includes(r.tipo_id)).length;
  const agendaPorDia = new Map(agendaFutura.map((a) => [a.dia, a]));

  // 21 dias de trabalho à frente — ou até o fim do mês, se ele for mais longe (dia 1)
  const fimMes = fimDoMes(hoje);
  const escalaAdiante = dias(hoje, somaDias(hoje, 45)).filter(ehDiaDeEscala);
  const futuros = escalaAdiante.slice(0, Math.max(HORIZONTE, escalaAdiante.filter((d) => d <= fimMes).length));
  const bases: number[] = [];
  const previsao: DiaPrevisto[] = futuros.map((d, h) => {
    const c = clima?.get(d) ?? null;
    const ajuste = chuva.fatorDe(c?.mm);
    const base = nv * f[diaDaSemana(d)] * (ehFeriado(d) ? fer.fator : 1) * ajuste;
    bases.push(base);
    const ag = agendaPorDia.get(d);
    return {
      d,
      dow: diaDaSemana(d),
      feriado: ehFeriado(d),
      previsto: arred(base * q(h, 0.5, 1), 0) ?? 0,
      p10: arred(base * q(h, 0.1, 0.8), 0) ?? 0,
      p90: arred(base * q(h, 0.9, 1.2), 0) ?? 0,
      chuvaMm: c ? arred(c.mm, 1) : null,
      chuvaProb: c?.prob ?? null,
      ajusteChuva: ajuste !== 1 ? arred(ajuste, 3) : null,
      agendaSlots: ag?.slots ?? null,
      agendaReservados: ag?.reservados ?? null,
      agendaTecnicos: ag?.tecnicos ?? null,
    };
  });
  const hojeNaPrevisao = previsao[0]?.d === hoje ? previsao[0] : null;
  if (hojeNaPrevisao) {
    hojeNaPrevisao.real = realHoje;
    hojeNaPrevisao.fracaoDecorrida = arred(fracao, 3) ?? 0;
    // fechamento estimado de hoje: o que já entrou + o que o perfil diz que falta
    hojeNaPrevisao.estimativaHoje = arred(realHoje + hojeNaPrevisao.previsto * (1 - fracao), 0) ?? realHoje;
    hojeNaPrevisao.esperadoAteAgora = arred(hojeNaPrevisao.previsto * fracao, 0) ?? 0;
  }

  // ---- fechamento do mês por simulação em blocos: cada simulação usa a sequência de erros
  // de UMA origem real do histórico, o que preserva semanas boas e ruins seguidas
  const ini = inicioDoMes(hoje);
  const realizadoAntes = pontos.filter((p) => p.d >= ini).reduce((s, p) => s + p.y, 0);
  const iRestantes = previsao.map((p, i) => ({ p, i })).filter(({ p }) => p.d > hoje && p.d <= fimMes);
  const caminhosCheios = origens.filter((o) => o.caminho.length === HORIZONTE);
  const diasMes = dias(ini, fimMes).filter(ehDiaDeEscala);
  const acumulados = diasMes.map((): number[] => []);
  const finais: number[] = [];
  for (let s = 0; s < SIMULACOES && caminhosCheios.length; s++) {
    const caminho = caminhosCheios[Math.floor(aleatorio() * caminhosCheios.length)].caminho;
    const r = (h: number): number => {
      const p = caminho[h % HORIZONTE];
      return p.feriado || p.base <= 0 ? 1 : p.y / p.base;
    };
    let total = realizadoAntes + realHoje;
    if (hojeNaPrevisao) total += bases[0] * (1 - fracao) * r(0);
    const fimDeHoje = total;
    const porDia = new Map<string, number>();
    iRestantes.forEach(({ p, i }, k) => {
      total += bases[i] * r(k + 1);
      porDia.set(p.d, total);
    });
    finais.push(total);
    diasMes.forEach((d, i) => {
      if (d >= hoje) acumulados[i].push(d === hoje ? fimDeHoje : (porDia.get(d) ?? total));
    });
  }
  let corrente = 0;
  const curva = diasMes.map((d, i) => {
    if (d < hoje) {
      corrente += pontos.find((p) => p.d === d)?.y ?? 0;
      return { d, realizado: corrente };
    }
    const faixa = { p10: arred(quantil(acumulados[i], 0.1), 0), p50: arred(quantil(acumulados[i], 0.5), 0), p90: arred(quantil(acumulados[i], 0.9), 0) };
    return d === hoje ? { d, realizado: corrente + realHoje, ...faixa } : { d, ...faixa };
  });

  const iniAnt = inicioDoMes(somaDias(ini, -1));
  const diaDoMes = Number(hoje.slice(8, 10));
  const doMesAnterior = pontos.filter((p) => p.d >= iniAnt && p.d < ini);
  const mes = {
    realizado: realizadoAntes + realHoje,
    p10: arred(quantil(finais, 0.1), 0),
    p50: arred(quantil(finais, 0.5), 0),
    p90: arred(quantil(finais, 0.9), 0),
    meta: metaMes,
    chanceMeta: metaMes && finais.length ? arred(finais.filter((x) => x >= metaMes).length / finais.length, 3) : null,
    totalMesAnterior: doMesAnterior.reduce((s, p) => s + p.y, 0),
    mesmoPontoMesAnterior: doMesAnterior.filter((p) => Number(p.d.slice(8, 10)) < diaDoMes).reduce((s, p) => s + p.y, 0),
    diasDeTrabalhoRestantes: iRestantes.filter(({ p }) => !p.feriado).length,
    curva,
  };

  // ---- previsto × realizado semana a semana (previsão feita na segunda de cada semana)
  const semanas: { semana: string; previsto: number | null; real: number; erro: number | null }[] = [];
  for (let k = origens.length - 1; k >= 0 && semanas.length < 10; k--) {
    const o = origens[k];
    if (diaDaSemana(o.d) !== 1) continue;
    const daSemana = o.caminho.filter((p) => p.d < somaDias(o.d, 7));
    if (daSemana.length < 6) continue;
    const prevSemana = daSemana.reduce((s, p, h) => s + (p.feriado ? p.base * fer.fator : p.base * (quantil(razoesAntigas[h], 0.5) ?? 1)), 0);
    const realSemana = daSemana.reduce((s, p) => s + p.y, 0);
    semanas.unshift({ semana: o.d, previsto: arred(prevSemana, 0), real: realSemana, erro: realSemana ? arred((prevSemana - realSemana) / realSemana, 3) : null });
  }

  // ---- histórico recente com o "previsto na véspera", para mostrar o ajuste
  const ultimos = origens.slice(-60).map((o) => {
    const p = o.caminho[0];
    const c = clima?.get(p.d);
    return {
      d: p.d,
      real: p.y,
      previstoVespera: arred(p.feriado ? p.base * fer.fator : p.base * q(0, 0.5, 1), 0),
      chuvaMm: c ? arred(c.mm, 1) : null,
    };
  });

  // ---- choque comum da equipe: em blocos de 10 dias de trabalho, quanto o realizado
  // desviou do previsto. Semana de chuva ou de sistema fora pega TODO MUNDO junto — é o
  // que a projeção da premiação precisa para não tratar cada técnico como independente.
  const blocos10 = caminhosCheios.map((o) => {
    const v = o.caminho.slice(0, 10).filter((p) => !p.feriado && p.base > 0);
    const b = v.reduce((s, p) => s + p.base, 0);
    return b ? v.reduce((s, p) => s + p.y, 0) / b : null;
  }).filter((x): x is number => x !== null);
  const medBloco = mediana(blocos10) || 1;

  return {
    choqueComum: blocos10.map((x) => x / medBloco),
    modelo: {
      nivel: arred(nv, 1),
      fatoresDiaDaSemana: Object.fromEntries([1, 2, 3, 4, 5, 6].map((d) => [d, arred(f[d], 3)])) as Record<string, number | null>,
      feriado: { fator: arred(fer.fator, 3), dias: fer.dias },
      origensTestadas: origens.length,
      climaDisponivel: clima !== null,
    },
    qualidade,
    previsao,
    mes,
    semanas,
    ultimos,
    chuva: chuva.faixas,
    fracaoDoDia: arred(fracao, 3),
  };
}

export type Previsao = ReturnType<typeof preve>;

/**
 * BACKLOG: dos pedidos de ativação abertos hoje, quantos devem virar instalação?
 *
 * Curva medida em 12 meses de pedidos: entre os que AINDA estavam abertos com X dias de vida,
 * que fração acabou instalada (o resto foi cancelado, desistiu ou foi encerrado sem material).
 * Aplicada à idade de cada pedido aberto agora.
 */
const FECHA_SEM_INSTALAR = new Set(['Cancelado', 'Desistência', 'Encerrado', 'Fechado']);

export function backlog(demanda: readonly LinhaDemanda[], hoje: string) {
  const diasEntre = (a: string, b: string): number => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
  const itens = demanda.map((r) => {
    const instalado = r.instalado ?? (r.status === 'A Faturar' ? r.modificado : null);
    const caiu = !instalado && (FECHA_SEM_INSTALAR.has(r.status ?? '') || r.contrato === 'Cancelado');
    const fim = instalado ?? (caiu ? r.modificado : null);
    return { criado: r.criado, instalado, caiu, aberto: !instalado && !caiu, t: fim ? Math.max(0, diasEntre(r.criado, fim)) : null, agendas: r.agendas, idade: diasEntre(r.criado, hoje) };
  });

  const historico = itens.filter((i) => i.criado <= somaDias(hoje, -21));
  const curva = [0, 1, 2, 3, 5, 7, 10, 14, 21, 30].map((a) => {
    const emRisco = historico.filter((i) => i.t === null || i.t >= a);
    const inst = emRisco.filter((i) => i.instalado).length;
    const caiu = emRisco.filter((i) => i.caiu).length;
    return { idade: a, pedidos: emRisco.length, chanceInstalar: inst + caiu ? arred(inst / (inst + caiu), 3) : null };
  });
  const chanceNa = (idade: number): number => {
    let c = curva[0];
    for (const p of curva) if (p.idade <= idade && p.chanceInstalar !== null) c = p;
    return c.chanceInstalar ?? 0.5;
  };

  const abertos = itens.filter((i) => i.aberto);
  const faixas = [
    { rotulo: 'até 2 dias', de: 0, ate: 2 },
    { rotulo: '3 a 6 dias', de: 3, ate: 6 },
    { rotulo: '7 a 14 dias', de: 7, ate: 14 },
    { rotulo: '15 a 29 dias', de: 15, ate: 29 },
    { rotulo: '30 dias ou mais', de: 30, ate: 99_999 },
  ];
  const porIdade = faixas.map((f) => {
    const g = abertos.filter((i) => i.idade >= f.de && i.idade <= f.ate);
    const esperado = g.reduce((s, i) => s + chanceNa(i.idade), 0);
    return {
      faixa: f.rotulo,
      abertos: g.length,
      devemInstalar: arred(esperado, 0) ?? 0,
      devemCair: arred(g.length - esperado, 0) ?? 0,
      agendasMedia: g.length ? arred(g.reduce((s, i) => s + i.agendas, 0) / g.length, 1) : null,
    };
  });
  const esperado = abertos.reduce((s, i) => s + chanceNa(i.idade), 0);
  const instalados = historico.filter((i) => i.instalado && i.t !== null);
  const prazo = [1, 2, 3, 5, 7, 14].map((d) => ({ dias: d, fracao: instalados.length ? arred(instalados.filter((i) => (i.t ?? 0) <= d).length / instalados.length, 3) : null }));

  const porMes = new Map<string, { mes: string; pedidos: number; instalados: number; cairam: number; abertos: number }>();
  for (const i of itens) {
    const m = i.criado.slice(0, 7);
    const v = porMes.get(m) ?? { mes: m, pedidos: 0, instalados: 0, cairam: 0, abertos: 0 };
    v.pedidos += 1;
    if (i.instalado) v.instalados += 1;
    else if (i.caiu) v.cairam += 1;
    else v.abertos += 1;
    porMes.set(m, v);
  }

  return {
    abertos: abertos.length,
    devemInstalar: arred(esperado, 0) ?? 0,
    devemCair: arred(abertos.length - esperado, 0) ?? 0,
    porIdade,
    curva,
    prazo,
    medianaDiasAteInstalar: instalados.length ? mediana(instalados.map((i) => i.t ?? 0)) : null,
    conversao: [...porMes.values()].sort((a, b) => a.mes.localeCompare(b.mes)).slice(-12),
  };
}
