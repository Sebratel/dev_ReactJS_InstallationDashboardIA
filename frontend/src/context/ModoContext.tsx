// O diagnóstico técnico de paridade continua nos componentes, mas a operação só recebe
// apresentação. O botão de conferência saiu do cabeçalho para dar lugar ao perfil Google;
// a preferência antiga é limpa para ninguém permanecer no modo técnico sem um controle.

import { createContext, useContext, useEffect, type ReactNode } from 'react';

const CHAVE = 'modo-conferencia';

interface Modo {
  /** Diagnóstico técnico visível: id do visual, origem DAX, faixa de cálculo. */
  conferencia: boolean;
}

const APRESENTACAO: Modo = { conferencia: false };
const ContextoModo = createContext<Modo>(APRESENTACAO);

export function ProvedorModo({ children }: { children: ReactNode }) {
  useEffect(() => {
    try {
      localStorage.removeItem(CHAVE);
    } catch {
      // localStorage indisponível: apresentação já é o padrão em memória.
    }
  }, []);

  return <ContextoModo.Provider value={APRESENTACAO}>{children}</ContextoModo.Provider>;
}

export function useModo(): Modo {
  return useContext(ContextoModo);
}
