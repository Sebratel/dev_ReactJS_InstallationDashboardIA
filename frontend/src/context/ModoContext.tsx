// Dois públicos, uma tela.
//
// O relatório é lido por dois olhares: a **operação**, que quer o número e o que ele
// significa, e a **conferência**, que precisa do id do visual (chave de
// `backend/specs/paridade/*.yaml`), da origem DAX de cada card e da faixa de diagnóstico para
// bater a tela contra o Power BI. Antes disto os dois viam a mesma tela — e a de
// diagnóstico é a que vazava, contra o próprio `DESIGN-SYSTEM.md` ("baixa fadiga
// cognitiva"). O comentário do `Card.tsx` já dizia a intenção: a origem "some quando o
// card está certo e aparece quando alguém duvida". Este modo é essa intenção.
//
// Apresentação é o padrão. Conferência é opt-in, fica no localStorage e não some ao
// recarregar — quem confere não quer reativar a cada F5.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

const CHAVE = 'modo-conferencia';

interface Modo {
  /** Diagnóstico técnico visível: id do visual, origem DAX, faixa de cálculo. */
  conferencia: boolean;
  alterna: () => void;
}

const ContextoModo = createContext<Modo>({ conferencia: false, alterna: () => {} });

export function ProvedorModo({ children }: { children: ReactNode }) {
  const [conferencia, setConferencia] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CHAVE) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE, conferencia ? '1' : '0');
    } catch {
      // localStorage indisponível (modo privado): o estado ainda vale nesta sessão.
    }
  }, [conferencia]);

  const alterna = useCallback(() => setConferencia((c) => !c), []);

  return <ContextoModo.Provider value={{ conferencia, alterna }}>{children}</ContextoModo.Provider>;
}

export function useModo(): Modo {
  return useContext(ContextoModo);
}
