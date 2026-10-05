// A sessão da tela: logado ou não.
//
// Otimista — começa logado e vira `false` no primeiro pedido que a API recusa por falta
// de sessão (401). Saiu do `useState` do `App.tsx` na fase 2 porque o 401 agora pode
// nascer em qualquer consulta do React Query (página, layout, valores de segmentação,
// visual abaixo da dobra), e quem fica sabendo é o `QueryCache` (`queryClient.ts`), fora
// de qualquer componente. A fase 3 do plano completa a store de auth.

import { create } from 'zustand';

type SessaoState = {
  logado: boolean;
  expirou: () => void;
};

export const useSessaoStore = create<SessaoState>((set) => ({
  logado: true,
  expirou: () => set({ logado: false }),
}));
