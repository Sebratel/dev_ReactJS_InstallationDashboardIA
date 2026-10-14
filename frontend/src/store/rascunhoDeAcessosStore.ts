// O rascunho da aba PERMISSÕES fora do componente: trocar de aba e voltar não pode
// perder o que a pessoa marcou e ainda não salvou — e a própria aba, na faixa de
// navegação, mostra quantas alterações estão esperando. A regra mora em
// `utils/rascunhoDeAcessos.ts`; aqui só o lugar onde ele fica.

import { create } from 'zustand';
import { RASCUNHO_VAZIO, type RascunhoDeAcessos } from '../utils/rascunhoDeAcessos.ts';

type RascunhoState = {
  rascunho: RascunhoDeAcessos;
  /** Quantos pedidos "Salvar" faria — publicado pela página, lido pela aba. */
  pendentes: number;
  muda: (f: (r: RascunhoDeAcessos) => RascunhoDeAcessos) => void;
  conta: (n: number) => void;
  descarta: () => void;
};

export const useRascunhoDeAcessos = create<RascunhoState>((set) => ({
  rascunho: RASCUNHO_VAZIO,
  pendentes: 0,
  muda: (f) => set((s) => ({ rascunho: f(s.rascunho) })),
  conta: (pendentes) => set({ pendentes }),
  descarta: () => set({ rascunho: RASCUNHO_VAZIO }),
}));
