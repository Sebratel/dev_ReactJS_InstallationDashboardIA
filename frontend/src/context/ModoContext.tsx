// O diagnóstico técnico de paridade continua nos componentes, mas a operação só recebe
// apresentação. O botão de conferência saiu do cabeçalho para dar lugar ao perfil Google;
// a preferência antiga é limpa para ninguém permanecer no modo técnico sem um controle.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const CHAVE = 'modo-conferencia';

interface Modo {
  /** Diagnóstico técnico visível: id do visual, origem DAX, faixa de cálculo. */
  conferencia: boolean;
}

const APRESENTACAO: Modo = { conferencia: false };
const ContextoModo = createContext<Modo>(APRESENTACAO);

function ehConferenciaDeArnes(): boolean {
  try {
    return (
      typeof navigator !== 'undefined' &&
      navigator.webdriver === true &&
      localStorage.getItem(CHAVE) === '1'
    );
  } catch {
    return false;
  }
}

export function ProvedorModo({ children }: { children: ReactNode }) {
  const [conferencia] = useState<boolean>(ehConferenciaDeArnes);

  useEffect(() => {
    if (conferencia) return;
    try {
      localStorage.removeItem(CHAVE);
    } catch {
      // localStorage indisponível: apresentação já é o padrão em memória.
    }
  }, [conferencia]);

  return (
    <ContextoModo.Provider value={conferencia ? { conferencia: true } : APRESENTACAO}>
      {children}
    </ContextoModo.Provider>
  );
}

export function useModo(): Modo {
  return useContext(ContextoModo);
}
