// O preparo dos dados da aba PREVISÕES — sem React e sem JSX, testável sozinho.
//
// Cada função aqui existe para que nenhum componente desta pasta tenha laço dentro de
// laço: onde havia `tecnicos.map(t => … ORDEM_FAIXAS.map(…))`, agora há um `.map` que
// chama uma função nomeada, e o laço de dentro mora nela.

import type { RespostaPrevisoes } from '../../../services/insightsService.ts';
import { COR, ORDEM_FAIXAS } from '../formato.ts';

type Tecnico = RespostaPrevisoes['premiacao']['tecnicos'][number];
type Faixa = (typeof ORDEM_FAIXAS)[number];

/** Um técnico com a chance de cada faixa pronta para a barra empilhada. */
export type TecnicoComFaixas = Tecnico & Record<Faixa, number>;

/**
 * As chances de um técnico, prontas para empilhar.
 *
 * A faixa 136 (fora da régua) soma na F5 para a barra fechar 100% — a dica do gráfico
 * continua mostrando as duas separadas.
 */
function comFaixasEmpilhadas(tecnico: Tecnico): TecnicoComFaixas {
  const porFaixa = {} as Record<Faixa, number>;
  for (const faixa of ORDEM_FAIXAS) {
    porFaixa[faixa] = tecnico.probs[faixa] + (faixa === 'F5' ? tecnico.probs.OUTROS : 0);
  }
  return { ...tecnico, ...porFaixa };
}

/** Os técnicos do maior esperado para o menor, prontos para a barra empilhada. */
export function tecnicosPorEsperado(tecnicos: readonly Tecnico[]): TecnicoComFaixas[] {
  return [...tecnicos].sort((a, b) => b.esperado - a.esperado).map(comFaixasEmpilhadas);
}

/** As faixas que valem a pena mostrar na dica de um técnico (≥ 1% de chance). */
export function faixasRelevantes(tecnico: Tecnico): Faixa[] {
  return ORDEM_FAIXAS.filter((faixa) => tecnico.probs[faixa] >= 0.01);
}

/** Um ponto da série diária — passado e futuro no mesmo eixo. */
export interface PontoDiario {
  d: string;
  real?: number;
  vespera?: number | null;
  previsto?: number;
  faixa?: [number, number];
  chuva: number | null;
  prob?: number | null;
  ajusteChuva?: number | null;
  feriado?: boolean;
  reservados?: number | null;
  estimativaHoje?: number;
}

/**
 * A série diária inteira: os últimos dias realizados, depois os previstos.
 *
 * Um dia que aparece nos dois lados fica com a versão do futuro — ela tem a previsão e
 * o intervalo; a do passado, só o real.
 */
export function pontosDiarios(dados: RespostaPrevisoes, hoje: string): PontoDiario[] {
  const futuro: PontoDiario[] = dados.previsao.map((dia) => ({
    d: dia.d,
    ...(dia.d === hoje && dia.real !== undefined ? { real: dia.real } : {}),
    previsto: dia.previsto,
    faixa: [dia.p10, dia.p90],
    chuva: dia.chuvaMm,
    prob: dia.chuvaProb,
    ajusteChuva: dia.ajusteChuva,
    feriado: dia.feriado,
    reservados: dia.agendaReservados,
    ...(dia.estimativaHoje !== undefined ? { estimativaHoje: dia.estimativaHoje } : {}),
  }));

  const jaNoFuturo = new Set(futuro.map((ponto) => ponto.d));
  const passado: PontoDiario[] = dados.ultimos
    .filter((dia) => !jaNoFuturo.has(dia.d))
    .map((dia) => ({
      d: dia.d,
      real: dia.real,
      vespera: dia.previstoVespera,
      chuva: dia.chuvaMm,
    }));

  return [...passado, ...futuro];
}

/** Chuva fraca, média ou forte — a cor da barrinha do gráfico de baixo. */
export function corDaChuva(milimetros: number | null): string {
  const mm = milimetros ?? 0;
  if (mm >= 25) return COR.chuvaForte;
  if (mm >= 10) return COR.chuvaMedia;
  return COR.chuvaFraca;
}

/** Um ponto da curva do mês, com o intervalo pronto para a área sombreada. */
export type PontoDaCurvaDoMes = RespostaPrevisoes['mes']['curva'][number] & {
  faixa?: [number, number];
};

export function curvaDoMes(mes: RespostaPrevisoes['mes']): PontoDaCurvaDoMes[] {
  return mes.curva.map((ponto) => {
    const temIntervalo =
      ponto.p10 !== undefined &&
      ponto.p10 !== null &&
      ponto.p90 !== undefined &&
      ponto.p90 !== null;
    return {
      ...ponto,
      ...(temIntervalo ? { faixa: [ponto.p10, ponto.p90] as [number, number] } : {}),
    };
  });
}

/** Uma faixa de chuva com a barra de erro pronta (distâncias, não limites). */
export type EfeitoDaChuva = RespostaPrevisoes['chuva'][number] & {
  valor: number;
  erro: [number, number];
};

export function efeitosDaChuva(chuva: RespostaPrevisoes['chuva']): EfeitoDaChuva[] {
  return chuva.map((faixa) => {
    const efeito = faixa.efeito ?? 0;
    const [piso, teto] = faixa.ic;
    const temIntervalo = piso !== null && teto !== null;
    return {
      ...faixa,
      valor: efeito,
      erro: temIntervalo
        ? ([Math.max(0, efeito - piso), Math.max(0, teto - efeito)] as [number, number])
        : ([0, 0] as [number, number]),
    };
  });
}
