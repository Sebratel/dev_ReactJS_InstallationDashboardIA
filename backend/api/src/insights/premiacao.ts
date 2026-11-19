import { PREMIACAO, TROCA } from './sql.ts';
import { dias, ehDiaDeTrabalho, fimDoMes, inicioDoMes, somaDias } from './calendario.ts';
import { arred, gama, gerador, poisson, quantil } from './estat.ts';
import type { Credito, LinhaAuxiliar, LinhaInstalacao, LinhaTroca } from './tipos.ts';

/**
 * Régua da medida `Faixas` (`protocolos-produtividade.measures.yaml`), por protocolos
 * distintos no mês:
 *   ≤59 sem faixa · 60–74 F1 · 75–89 F2 · 90–104 F3 · 105–119 F4 · 120–135 F5 · >136 F6
 *
 * Reproduzida COMO ESTÁ, inclusive o defeito: o DAX diz `> 136` para a Faixa 6, então quem
 * fecha com exatamente 136 cai em "Outros". A tela avisa quando alguém chega perto.
 */
export const FAIXAS = [
  { id: 'F1', nome: 'Faixa 1', min: 60 },
  { id: 'F2', nome: 'Faixa 2', min: 75 },
  { id: 'F3', nome: 'Faixa 3', min: 90 },
  { id: 'F4', nome: 'Faixa 4', min: 105 },
  { id: 'F5', nome: 'Faixa 5', min: 120 },
  { id: 'F6', nome: 'Faixa 6', min: 137 },
] as const;

export type IdFaixa = (typeof FAIXAS)[number]['id'];
export type Desfecho = IdFaixa | 'sem' | 'OUTROS';
export const DESFECHOS: readonly Desfecho[] = ['sem', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'OUTROS'];

export function faixaDe(n: number): IdFaixa | 'OUTROS' | null {
  if (n <= 59) return null;
  if (n <= 74) return 'F1';
  if (n <= 89) return 'F2';
  if (n <= 104) return 'F3';
  if (n <= 119) return 'F4';
  if (n <= 135) return 'F5';
  if (n > 136) return 'F6';
  return 'OUTROS';
}

export interface ProximaFaixa {
  id: IdFaixa;
  nome: string;
  faltam: number;
}

/** Próxima faixa e quantos protocolos faltam para ela. */
export function proximaFaixa(n: number): ProximaFaixa | null {
  const f = FAIXAS.find((x) => x.min > n);
  return f ? { id: f.id, nome: f.nome, faltam: f.min - n } : null;
}

/** O auxiliar (RAUX) só ganha o protocolo nos 10 tipos do ramo de auxiliares. */
const TIPOS_AUXILIAR = PREMIACAO.filter((t) => t !== 1256 && t !== 279);

/**
 * Cada protocolo que conta, para quem conta. Um protocolo com auxiliar aparece duas vezes
 * (técnico e auxiliar) — é o que o relatório faz ao anexar os dois ramos da consulta.
 */
export function montaCreditos(
  instalacoes: readonly LinhaInstalacao[],
  fontes: { trocas: readonly LinhaTroca[]; auxiliares: readonly LinhaAuxiliar[]; desde: string },
  excluir: readonly string[] = [],
): Credito[] {
  const fora = new Set(excluir.map((s) => s.toUpperCase()));
  const creditos: Credito[] = [];
  const doProtocolo = new Map<string, { data: string; tipo: number }>();

  for (const r of instalacoes) {
    if (r.data < fontes.desde || !PREMIACAO.includes(r.tipo_id) || TROCA.includes(r.tipo_id)) continue;
    doProtocolo.set(r.protocolo, { data: r.data, tipo: r.tipo_id });
    if (r.tec_id) creditos.push({ protocolo: r.protocolo, tec_id: r.tec_id, tecnico: r.tecnico, data: r.data, papel: 'instalador' });
  }
  for (const t of fontes.trocas) {
    doProtocolo.set(t.protocolo, { data: t.data, tipo: t.tipo_id });
    if (t.tec_id) creditos.push({ protocolo: t.protocolo, tec_id: t.tec_id, tecnico: t.tecnico, data: t.data, papel: 'troca' });
  }
  for (const a of fontes.auxiliares) {
    const p = doProtocolo.get(a.protocolo);
    if (!p || !a.tec_id || !TIPOS_AUXILIAR.includes(p.tipo)) continue;
    creditos.push({ protocolo: a.protocolo, tec_id: a.tec_id, tecnico: a.tecnico, data: p.data, papel: 'auxiliar' });
  }
  return creditos.filter((c) => !fora.has((c.tecnico ?? '').toUpperCase()));
}

interface ContaDoTecnico {
  tec_id: number;
  tecnico: string | null;
  protocolos: Set<string>;
  porDia: Map<string, number>;
  papeis: Partial<Record<Credito['papel'], number>>;
}

/** Protocolos distintos por técnico num intervalo [de, ate]. */
export function contaPorTecnico(creditos: readonly Credito[], de: string, ate: string): Map<number, ContaDoTecnico> {
  const porTec = new Map<number, ContaDoTecnico>();
  for (const c of creditos) {
    if (c.data < de || c.data > ate) continue;
    let t = porTec.get(c.tec_id);
    if (!t) {
      t = { tec_id: c.tec_id, tecnico: c.tecnico, protocolos: new Set(), porDia: new Map(), papeis: {} };
      porTec.set(c.tec_id, t);
    }
    if (!t.protocolos.has(c.protocolo)) {
      t.protocolos.add(c.protocolo);
      t.porDia.set(c.data, (t.porDia.get(c.data) ?? 0) + 1);
      t.papeis[c.papel] = (t.papeis[c.papel] ?? 0) + 1;
    }
  }
  return porTec;
}

export interface ProjecaoDoTecnico {
  tec_id: number;
  tecnico: string | null;
  realizado: number;
  hoje: number;
  papeis: Partial<Record<Credito['papel'], number>>;
  faixaAtual: IdFaixa | 'OUTROS' | null;
  proxima: ProximaFaixa | null;
  porDiaNecessario: number | null;
  ritmo: number | null;
  taxaDiaTrabalhado: number | null;
  presenca: number | null;
  esperado: number;
  p10: number | null;
  p90: number | null;
  probs: Record<Desfecho, number>;
  maisProvavel: Desfecho;
  pSubir: number;
  perto136: boolean;
}

export interface Projecao {
  tecnicos: ProjecaoDoTecnico[];
  diasRestantes: number;
  restoHoje: number | null;
  taxaEquipe: number | null;
  presencaEquipe: number | null;
}

const SIMULACOES = 4000;

/**
 * Projeção do fechamento do mês por técnico, por simulação. Quatro incertezas, e as quatro
 * pesaram no teste dos meses passados (sem elas a projeção dava 100% para quase tudo):
 *  1. a taxa do técnico (protocolos por dia em que trabalhou) é estimada, não sabida —
 *     sorteada da gama a posteriori, encolhida para a média da equipe;
 *  2. a presença (fração dos dias de trabalho em que produziu) também — beta a posteriori,
 *     porque folga e férias vêm em bloco;
 *  3. o choque comum da equipe (chuva, sistema fora), igual para todos na mesma simulação;
 *  4. a variação de um dia para o outro (gama de forma 6 em cima da Poisson).
 *
 * `restoHoje` é a fração do dia de hoje que ainda falta, pelo perfil horário.
 */
export function projeta(
  creditos: readonly Credito[],
  hoje: string,
  restoHoje: number,
  opcoes: { semente?: string; choques?: readonly number[] | null } = {},
): Projecao {
  const semente = opcoes.semente ?? hoje;
  const choques = opcoes.choques ?? null;
  const ini = inicioDoMes(hoje);
  const fim = fimDoMes(hoje);
  const noMes = contaPorTecnico(creditos, ini, hoje);

  const diasTaxa: string[] = [];
  for (let d = somaDias(hoje, -1); diasTaxa.length < 30 && d >= somaDias(hoje, -60); d = somaDias(d, -1)) {
    if (ehDiaDeTrabalho(d)) diasTaxa.push(d);
  }
  const ultimoTaxa = diasTaxa[diasTaxa.length - 1] ?? hoje;
  const janela = contaPorTecnico(creditos, ultimoTaxa, diasTaxa[0] ?? hoje);
  const diasNaJanela = (t: ContaDoTecnico): number => [...t.porDia.keys()].filter((d) => diasTaxa.includes(d)).length;
  const ativos = [...janela.values()].map((t) => ({ diasAtivos: diasNaJanela(t), n: t.protocolos.size })).filter((x) => x.diasAtivos > 0);
  const somaDiasAtivos = ativos.reduce((s, x) => s + x.diasAtivos, 0);
  const taxaEquipe = somaDiasAtivos ? ativos.reduce((s, x) => s + x.n, 0) / somaDiasAtivos : 3;
  const presencaEquipe = ativos.length && diasTaxa.length ? somaDiasAtivos / (ativos.length * diasTaxa.length) : 0.8;

  const restantes = dias(somaDias(hoje, 1), fim).filter(ehDiaDeTrabalho);
  const K = 3;
  const sorteio = gerador(`premiacao-${semente}`);
  // o mesmo choque na simulação s para todos os técnicos — é isso que o torna "comum"
  const sorteioDoChoque = gerador(`choque-${semente}`);
  const sorteioComum = Array.from({ length: SIMULACOES }, () => sorteioDoChoque());
  const tecIds = new Set([...noMes.keys(), ...janela.keys()]);

  const saida: ProjecaoDoTecnico[] = [];
  for (const id of tecIds) {
    const mes = noMes.get(id);
    const jan = janela.get(id);
    const realizado = mes ? mes.protocolos.size : 0;
    const nJan = jan ? jan.protocolos.size : 0;
    const diasAtivos = jan ? diasNaJanela(jan) : 0;
    if (!realizado && !nJan) continue; // fora da corrida

    const taxa = (nJan + K * taxaEquipe) / (diasAtivos + K);
    const presenca = (diasAtivos + K * presencaEquipe) / (diasTaxa.length + K);
    const hojeAtivo = (mes?.porDia.get(hoje) ?? 0) > 0;
    const formaTaxa = nJan + K * taxaEquipe;
    const escalaTaxa = 1 / (diasAtivos + K);
    const aPres = diasAtivos + K * presencaEquipe;
    const bPres = Math.max(0.5, diasTaxa.length - diasAtivos + K * (1 - presencaEquipe));

    const finais: number[] = new Array(SIMULACOES);
    for (let s = 0; s < SIMULACOES; s++) {
      const choque = choques?.length ? choques[Math.floor(sorteioComum[s] * choques.length)] : 1;
      const taxaSim = gama(formaTaxa, escalaTaxa, sorteio) * choque;
      const ga = gama(aPres, 1, sorteio);
      const presencaSim = ga / (ga + gama(bPres, 1, sorteio));
      let total = realizado;
      // o que falta de hoje: quem já produziu hoje está na rua; quem não, depende da presença
      if (restoHoje > 0 && (hojeAtivo || sorteio() < presencaSim)) {
        total += poisson(gama(6, (taxaSim * restoHoje) / 6, sorteio), sorteio);
      }
      for (let i = 0; i < restantes.length; i++) {
        if (sorteio() < presencaSim) total += poisson(gama(6, taxaSim / 6, sorteio), sorteio);
      }
      finais[s] = total;
    }

    const probs = Object.fromEntries(DESFECHOS.map((k) => [k, 0])) as Record<Desfecho, number>;
    for (const f of finais) probs[faixaDe(f) ?? 'sem'] += 1 / SIMULACOES;
    const prox = proximaFaixa(realizado);
    const maisProvavel = (Object.entries(probs) as [Desfecho, number][]).sort((a, b) => b[1] - a[1])[0][0];
    const pSubir = prox ? finais.filter((f) => f >= realizado + prox.faltam).length / SIMULACOES : 0;
    const diasQueFaltam = restantes.length + (restoHoje > 0 ? restoHoje : 0);

    saida.push({
      tec_id: id,
      tecnico: (mes ?? jan)?.tecnico ?? null,
      realizado,
      hoje: mes?.porDia.get(hoje) ?? 0,
      papeis: mes?.papeis ?? {},
      faixaAtual: faixaDe(realizado),
      proxima: prox,
      porDiaNecessario: prox && diasQueFaltam > 0 ? arred(prox.faltam / diasQueFaltam, 1) : null,
      ritmo: arred(taxa * presenca, 2),
      taxaDiaTrabalhado: arred(taxa, 2),
      presenca: arred(presenca, 2),
      esperado: Math.round(finais.reduce((a, b) => a + b, 0) / SIMULACOES),
      p10: quantil(finais, 0.1),
      p90: quantil(finais, 0.9),
      probs: Object.fromEntries(DESFECHOS.map((k) => [k, arred(probs[k], 3) ?? 0])) as Record<Desfecho, number>,
      maisProvavel,
      pSubir: arred(pSubir, 3) ?? 0,
      perto136: realizado >= 126 && realizado <= 136,
    });
  }
  saida.sort((a, b) => b.realizado - a.realizado || b.esperado - a.esperado);
  return {
    tecnicos: saida,
    diasRestantes: restantes.length,
    restoHoje: arred(restoHoje, 2),
    taxaEquipe: arred(taxaEquipe, 2),
    presencaEquipe: arred(presencaEquipe, 2),
  };
}

export interface TesteDoMes {
  mes: string;
  corte: string;
  tecnicos: number;
  acerto: number | null;
  acertoUmaFaixa: number | null;
  brier: number | null;
  /** projeção somada ÷ realizado somado − 1 (positivo = projetou demais) */
  vies: number | null;
  coberturaP10P90: number | null;
}

/**
 * A projeção contra a realidade: refaz cada mês passado como se fosse o dia 15 (só com o
 * que se sabia até o dia 14) e compara a faixa mais provável com a que cada técnico fechou.
 */
function testaUmMes(creditos: readonly Credito[], ref: string, choques: readonly number[] | null): TesteDoMes {
  const mesPassado = somaDias(inicioDoMes(ref), -1);
  const ini = inicioDoMes(mesPassado);
  let corte = `${mesPassado.slice(0, 7)}-15`;
  while (!ehDiaDeTrabalho(corte)) corte = somaDias(corte, -1);
  const conhecido = creditos.filter((c) => c.data < corte);
  const proj = projeta(conhecido, somaDias(corte, -1), 0, { semente: `teste-${corte}`, choques });
  const real = contaPorTecnico(creditos, ini, fimDoMes(mesPassado));

  const ordem: Desfecho[] = ['sem', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6'];
  let n = 0;
  let acertos = 0;
  let pertos = 0;
  let brier = 0;
  let somaPrevisto = 0;
  let somaReal = 0;
  let dentro = 0;
  for (const t of proj.tecnicos) {
    const final = real.get(t.tec_id)?.protocolos.size ?? 0;
    if (final < 30 && t.probs.sem > 0.9) continue; // fora da corrida dos dois lados
    const fr = faixaDe(final) ?? 'sem';
    const frNorm: Desfecho = fr === 'OUTROS' ? 'F5' : fr;
    n += 1;
    somaPrevisto += t.esperado;
    somaReal += final;
    if (t.p10 !== null && t.p90 !== null && final >= t.p10 && final <= t.p90) dentro += 1;
    if (t.maisProvavel === frNorm) acertos += 1;
    if (Math.abs(ordem.indexOf(t.maisProvavel) - ordem.indexOf(frNorm)) <= 1) pertos += 1;
    for (const k of ordem) brier += ((t.probs[k] ?? 0) - (k === frNorm ? 1 : 0)) ** 2;
  }
  return {
    mes: mesPassado.slice(0, 7),
    corte,
    tecnicos: n,
    acerto: n ? arred(acertos / n, 3) : null,
    acertoUmaFaixa: n ? arred(pertos / n, 3) : null,
    brier: n ? arred(brier / n, 3) : null,
    vies: somaReal ? arred(somaPrevisto / somaReal - 1, 3) : null,
    coberturaP10P90: n ? arred(dentro / n, 3) : null,
  };
}

export interface TesteDaPremiacao extends Omit<TesteDoMes, 'mes' | 'corte'> {
  meses: TesteDoMes[];
}

export function testaNosMesesPassados(creditos: readonly Credito[], hoje: string, choques: readonly number[] | null, meses = 3): TesteDaPremiacao {
  const resultados: TesteDoMes[] = [];
  let ref = hoje;
  for (let i = 0; i < meses; i++) {
    resultados.push(testaUmMes(creditos, ref, choques));
    ref = somaDias(inicioDoMes(ref), -1);
  }
  const n = resultados.reduce((s, r) => s + r.tecnicos, 0);
  const pond = (k: 'acerto' | 'acertoUmaFaixa' | 'brier' | 'vies' | 'coberturaP10P90'): number | null =>
    n ? arred(resultados.reduce((s, r) => s + (r[k] ?? 0) * r.tecnicos, 0) / n, 3) : null;
  return {
    meses: resultados,
    tecnicos: n,
    acerto: pond('acerto'),
    acertoUmaFaixa: pond('acertoUmaFaixa'),
    brier: pond('brier'),
    vies: pond('vies'),
    coberturaP10P90: pond('coberturaP10P90'),
  };
}
