// O preparo dos dados da aba OPERAÇÃO AO VIVO — sem React e sem JSX.
//
// O motivo de existir é o mesmo da pasta de previsões: nenhum componente desta aba deve
// ter laço dentro de laço. O caso mais caro era o mapa de calor, que para cada dia da
// semana varria a lista inteira de células (`dias.map(… calor.filter(…))`) — custo
// dia × células. Aqui ele vira um agrupamento só, numa passada.

import type { RespostaOperacao, TecnicoAgora } from '../../../services/insightsService.ts';
import { COR, FAIXA_COR } from '../formato.ts';

type CelulaDoCalor = RespostaOperacao['calor'][number];

/** O mapa de calor pronto para desenhar: as horas, os dias e as células de cada dia. */
export interface GradeDoCalor {
  horas: number[];
  dias: string[];
  /** As células de cada dia, na ordem em que vieram. */
  porDia: Map<string, CelulaDoCalor[]>;
  /** A maior média da grade — é ela que define a intensidade da cor. */
  maiorMedia: number;
}

export function gradeDoCalor(calor: RespostaOperacao['calor']): GradeDoCalor {
  const horas: number[] = [];
  const dias: string[] = [];
  const porDia = new Map<string, CelulaDoCalor[]>();
  let maiorMedia = 1;

  for (const celula of calor) {
    if (!horas.includes(celula.hora)) horas.push(celula.hora);
    const doDia = porDia.get(celula.dia);
    if (doDia) {
      doDia.push(celula);
    } else {
      dias.push(celula.dia);
      porDia.set(celula.dia, [celula]);
    }
    maiorMedia = Math.max(maiorMedia, celula.media ?? 0);
  }

  return { horas, dias, porDia, maiorMedia };
}

/** A cor de uma célula do mapa de calor, da mais clara à mais cheia. */
export function corDaCelula(media: number | null, maiorMedia: number) {
  const intensidade = (media ?? 0) / maiorMedia;
  return {
    background: `color-mix(in srgb, var(--pbi-primary) ${Math.round(6 + 86 * intensidade)}%, var(--pbi-superficie))`,
    color: intensidade > 0.5 ? 'var(--pbi-sobre-primary)' : 'var(--pbi-ink)',
  };
}

/**
 * A cor de um técnico no gráfico de qualidade × volume.
 *
 * Mais de 25% acima do retrabalho da equipe é crítico; 20% abaixo é bom; o resto é a
 * média. Sem taxa medida, neutro.
 */
export function corDoRetrabalho(taxa: number | null, taxaDaEquipe: number): string {
  if (taxa === null) return COR.neutro;
  if (taxa > taxaDaEquipe * 1.25) return COR.critico;
  if (taxa < taxaDaEquipe * 0.8) return COR.bom;
  return COR.serie;
}

/** O volume mediano de ativações entre os técnicos — a linha vertical do gráfico. */
export function volumeMediano(qualidade: RespostaOperacao['qualidade']): number {
  const volumes = qualidade.map((tecnico) => tecnico.instalacoes).sort((a, b) => a - b);
  return volumes[Math.floor(volumes.length / 2)] ?? 0;
}

type TecnicoNaCorrida = RespostaOperacao['premiacao']['tecnicos'][number];

/** Um técnico da corrida, com a barra e o intervalo prontos. */
export type BarraDaCorrida = TecnicoNaCorrida & {
  corDaFaixa: string;
  /** O quanto falta até a projeção — a parte clara da barra. */
  falta: number;
  /** As distâncias até p10 e p90, como o `ErrorBar` espera. */
  erro: [number, number];
};

export function barrasDaCorrida(tecnicos: readonly TecnicoNaCorrida[]): BarraDaCorrida[] {
  return tecnicos.map((tecnico) => ({
    ...tecnico,
    corDaFaixa: FAIXA_COR[tecnico.faixaAtual ?? 'sem'],
    falta: Math.max(0, tecnico.esperado - tecnico.realizado),
    erro: [
      Math.max(0, tecnico.esperado - (tecnico.p10 ?? tecnico.esperado)),
      Math.max(0, (tecnico.p90 ?? tecnico.esperado) - tecnico.esperado),
    ],
  }));
}

/** O que a linha do técnico diz embaixo da situação: há quanto tempo, próximo, GPS. */
export function detalheDoTecnico(tecnico: TecnicoAgora): string {
  const partes = [
    tecnico.desde !== null && tecnico.desde >= 0 ? `há ${tecnico.desde} min` : null,
    tecnico.situacao === 'aguardando' && tecnico.proximoAs
      ? `próximo às ${tecnico.proximoAs}`
      : null,
    tecnico.sinalHaMin === null ? 'sem GPS na última hora' : `GPS há ${tecnico.sinalHaMin} min`,
  ];
  return partes.filter(Boolean).join(' · ');
}

/** O índice do último ponto do dia com valor — é nele que vai o rótulo do número. */
export function ultimoPontoComValor<T>(pontos: readonly T[], temValor: (ponto: T) => boolean) {
  let ultimo = -1;
  pontos.forEach((ponto, indice) => {
    if (temValor(ponto)) ultimo = indice;
  });
  return ultimo;
}
