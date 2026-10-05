// O cliente do React Query da tela (fase 2 de `docs/PLANO-PADROES-FRONTEND.md`).
//
// Os padrões aqui são escolha medida, não o padrão da biblioteca:
//  - `retry: false` — `pega()` já tem teto, novas tentativas e abort cobertos por
//    teste. Duas camadas de nova tentativa multiplicariam a espera de um erro de verdade.
//  - `refetchOnWindowFocus: false` — o dado chega pelo aviso do servidor
//    (`/api/eventos`) e pelo relógio de 60 s; voltar à aba não pode virar uma rajada.
//  - `staleTime: Infinity` por padrão — nada envelhece sozinho: quem diz que a página
//    mudou é o servidor, com `invalidateQueries`. Uma combinação já vista volta NA HORA
//    (o papel do antigo `paginasVistas`), e a rede só roda quando há motivo.
//  - `gcTime` de 5 min — o teto de memória: combinação de filtro sem ninguém olhando
//    sai do cache. Era o teto de 30 entradas do antigo `utils/cachePagina.ts`.
//
// O 401 de QUALQUER consulta leva ao login, como antes levava o de cada `fetch` à mão.

import { QueryCache, QueryClient } from '@tanstack/react-query';
import { ehErroDeSessao } from './dashboardService.ts';
import { useSessaoStore } from '../store/sessaoStore.ts';

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => {
      if (ehErroDeSessao(err)) useSessaoStore.getState().expirou();
    },
  }),
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      gcTime: 5 * 60_000,
    },
  },
});
