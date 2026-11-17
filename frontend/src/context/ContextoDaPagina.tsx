// Contexto leve que informa ao `<Cartao>` qual página, filtros e seleções cruzadas
// estão ativos, permitindo que ele desenhe o botão "Insights" automaticamente nos
// visuais agregados do catálogo `VISUAIS_IA` sem precisar furar a árvore de props.

import { createContext, useContext, type ReactNode } from 'react';
import type { FiltroDaTela } from '../services/dashboardService.ts';

export interface DadosContextoDaPagina {
  readonly pagina: string;
  readonly filtros: readonly FiltroDaTela[];
  readonly clicados?: readonly { tabela: string; coluna: string }[];
}

const ContextoDaPagina = createContext<DadosContextoDaPagina | null>(null);

export function ProvedorContextoDaPagina({
  pagina,
  filtros,
  clicados,
  children,
}: DadosContextoDaPagina & { children: ReactNode }) {
  return (
    <ContextoDaPagina.Provider value={{ pagina, filtros, clicados }}>
      {children}
    </ContextoDaPagina.Provider>
  );
}

export function useContextoDaPagina(): DadosContextoDaPagina | null {
  return useContext(ContextoDaPagina);
}
