// A sessão da tela: logado ou não.
//
// **Começa SEM SABER (`null`) desde 20/10/2026**, e o `App.tsx` pergunta à API
// (`GET /auth/sessao`, sempre 200) antes de pedir qualquer dado. Até então começava
// otimista (`true`): a tela de login de quem não tinha sessão disparava `/api/dashboards`
// e `/api/eventos`, levava 401 e o Chrome os registrava em vermelho no console. Depois de
// logado, vira `false` no primeiro pedido que a API recusa por falta de sessão (401). Saiu do `useState` do `App.tsx` na fase 2 porque o 401 agora pode
// nascer em qualquer consulta do React Query (página, layout, valores de segmentação,
// visual abaixo da dobra), e quem fica sabendo é o `QueryCache` (`queryClient.ts`), fora
// de qualquer componente. A fase 3 do plano completa a store de auth.

import { create } from 'zustand';

type SessaoState = {
  /** `null` = ainda não perguntou à API. */
  logado: boolean | null;
  define: (logado: boolean) => void;
  expirou: () => void;
};

export const useSessaoStore = create<SessaoState>((set) => ({
  logado: null,
  define: (logado) => set({ logado }),
  expirou: () => set({ logado: false }),
}));

/** Pergunta à API se há sessão. Falha de rede vale como "não" — o login tenta de novo. */
export async function perguntaSessao(): Promise<boolean> {
  try {
    const r = await fetch('/auth/sessao', { cache: 'no-store' });
    const j = (await r.json()) as { logado?: unknown };
    return j.logado === true;
  } catch {
    return false;
  }
}
