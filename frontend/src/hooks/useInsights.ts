import { useQuery } from '@tanstack/react-query';
import {
  CHAVE_OPERACAO,
  CHAVE_PREVISOES,
  pegaOperacao,
  pegaPrevisoes,
} from '../services/insightsService.ts';

/** Operação ao vivo: a cada 60 s (GPS e agenda têm cache de 30–45 s no servidor). */
export const useOperacao = () =>
  useQuery({
    queryKey: CHAVE_OPERACAO,
    queryFn: ({ signal }) => pegaOperacao(signal),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

/** Previsões: a cada 5 min — o modelo muda devagar; o que mexe é o realizado do dia. */
export const usePrevisoes = () =>
  useQuery({
    queryKey: CHAVE_PREVISOES,
    queryFn: ({ signal }) => pegaPrevisoes(signal),
    refetchInterval: 300_000,
    staleTime: 120_000,
  });
