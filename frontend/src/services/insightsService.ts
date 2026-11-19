// As abas "Operação ao vivo" e "Previsões" (`/api/insights/*`, 18/11/2026).
//
// O servidor lê o Voalle direto (GPS, agenda e estado no app são do minuto) e calcula os
// modelos — `backend/api/src/insights/`. Aqui só os tipos da resposta e o pedido. Quem
// barra é o 403 do servidor; a faixa só mostra a aba a quem a recebeu em "Acessos".

import { pega } from './dashboardService.ts';

export type IdFaixa = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6';
export type Desfecho = IdFaixa | 'sem' | 'OUTROS';
export type Situacao = 'execucao' | 'aCaminho' | 'aguardando' | 'agendaConcluida' | 'semAgenda';
export type Categoria = 'concluido' | 'execucao' | 'aCaminho' | 'aguardando' | 'semSucesso';

export interface Agora {
  data: string;
  hora: number;
  minuto: number;
}

export interface Faixa {
  id: IdFaixa;
  nome: string;
  min: number;
}

export interface TecnicoNaPremiacao {
  tec_id: number;
  nome: string;
  curto: string;
  base: string | null;
  realizado: number;
  hoje: number;
  faixaAtual: IdFaixa | 'OUTROS' | null;
  proxima: { id: IdFaixa; nome: string; faltam: number } | null;
  porDiaNecessario: number | null;
  ritmo: number | null;
  esperado: number;
  p10: number | null;
  p90: number | null;
  probs: Record<Desfecho, number>;
  maisProvavel: Desfecho;
  pSubir: number;
  perto136: boolean;
}

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

export type AgendaDaBase = Record<Categoria, number> & {
  regiao: number;
  base: string;
  total: number;
  ativacoes: number;
  slotsLivres: number;
};

export interface Insight {
  pergunta: string;
  resposta: string;
  tom: 'bom' | 'atencao' | 'neutro';
}

export interface RespostaOperacao {
  agora: Agora;
  kpis: {
    ativacoesHoje: number;
    movimentacoesHoje: number;
    esperadoAteAgora: number | null;
    tipicoAteAgora: number | null;
    estimativaHoje: number | null;
    previstoHoje: number | null;
    agenda: Record<Categoria, number> & { total: number; slotsLivres: number; ativacoes: number };
    tecnicosEscalados: number;
    tecnicosComSinal: number;
    tecnicosEmExecucao: number;
    tecnicosACaminho: number;
    prazoMedianoDias: number | null;
    instaladoAte2Dias: number | null;
    retrabalho30d: number | null;
    execucaoMediana: number | null;
    deslocamentoMediano: number | null;
  };
  agendaPorBase: AgendaDaBase[];
  tecnicos: TecnicoAgora[];
  ritmo: {
    hora: string;
    hoje: number | null;
    tipico: number | null;
    p25: number | null;
    p75: number | null;
  }[];
  calor: { dia: string; dow: number; hora: number; media: number | null }[];
  qualidade: {
    tec_id: number;
    nome: string;
    curto: string;
    instalacoes: number;
    retornos: number;
    taxa: number | null;
    execucaoMin: number | null;
  }[];
  retrabalhoPorMes: { mes: string; n: number; retornos: number; taxa: number | null }[];
  insights: Insight[];
  premiacao: {
    tecnicos: TecnicoNaPremiacao[];
    faixas: Faixa[];
    diasRestantes: number;
    restoHoje: number | null;
  };
  mes: {
    realizado: number;
    p50: number | null;
    meta: number | null;
    mesmoPontoMesAnterior: number;
    totalMesAnterior: number;
  };
  geradoEm: string;
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

export interface RespostaPrevisoes {
  agora: Agora;
  modelo: {
    nivel: number | null;
    fatoresDiaDaSemana: Record<string, number | null>;
    feriado: { fator: number | null; dias: number };
    origensTestadas: number;
    climaDisponivel: boolean;
  };
  qualidade: {
    horizonte: string;
    dias: number;
    erroMedio: number | null;
    cobertura: number | null;
  }[];
  previsao: DiaPrevisto[];
  mes: {
    realizado: number;
    p10: number | null;
    p50: number | null;
    p90: number | null;
    meta: number | null;
    chanceMeta: number | null;
    totalMesAnterior: number;
    mesmoPontoMesAnterior: number;
    diasDeTrabalhoRestantes: number;
    curva: {
      d: string;
      realizado?: number;
      p10?: number | null;
      p50?: number | null;
      p90?: number | null;
    }[];
  };
  semanas: { semana: string; previsto: number | null; real: number; erro: number | null }[];
  ultimos: { d: string; real: number; previstoVespera: number | null; chuvaMm: number | null }[];
  chuva: {
    id: string;
    rotulo: string;
    dias: number;
    efeito: number | null;
    ic: [number | null, number | null];
    fator: number;
    aplicado: boolean;
  }[];
  fracaoDoDia: number | null;
  premiacao: {
    tecnicos: TecnicoNaPremiacao[];
    faixas: Faixa[];
    resumoFaixas: { faixa: Exclude<Desfecho, 'OUTROS'>; esperado: number; hoje: number }[];
    diasRestantes: number;
    teste: {
      meses: { mes: string }[];
      tecnicos: number;
      acerto: number | null;
      acertoUmaFaixa: number | null;
      vies: number | null;
      coberturaP10P90: number | null;
    };
  };
  backlog: {
    abertos: number;
    devemInstalar: number;
    devemCair: number;
    porIdade: {
      faixa: string;
      abertos: number;
      devemInstalar: number;
      devemCair: number;
      agendasMedia: number | null;
    }[];
    curva: { idade: number; pedidos: number; chanceInstalar: number | null }[];
    prazo: { dias: number; fracao: number | null }[];
    medianaDiasAteInstalar: number | null;
    conversao: {
      mes: string;
      pedidos: number;
      instalados: number;
      cairam: number;
      abertos: number;
    }[];
  };
  geradoEm: string;
}

/** As chaves do React Query; o prefixo comum é o que o botão "Atualizar" invalida. */
export const CHAVE_INSIGHTS = ['insights'] as const;
export const CHAVE_OPERACAO = [...CHAVE_INSIGHTS, 'operacao'] as const;
export const CHAVE_PREVISOES = [...CHAVE_INSIGHTS, 'previsoes'] as const;

export const pegaOperacao = (signal?: AbortSignal): Promise<RespostaOperacao> =>
  pega<RespostaOperacao>('/api/insights/operacao', signal);

export const pegaPrevisoes = (signal?: AbortSignal): Promise<RespostaPrevisoes> =>
  pega<RespostaPrevisoes>('/api/insights/previsoes', signal);
