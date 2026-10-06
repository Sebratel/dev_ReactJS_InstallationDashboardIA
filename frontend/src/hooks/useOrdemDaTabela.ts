// A ordenação da tabela de detalhe pelo cabeçalho: crescente, decrescente, nenhuma.
//
// **O padrão é a primeira coluna de DATA, da mais nova para a mais velha.** O servidor
// (`ordenaPorDataPadrao`) já entrega as linhas nesta ordem — o estado só a espelha no
// cabeçalho, para a seta aparecer e o primeiro clique na própria coluna alternar para
// crescente em vez de saltar de "nada" para "crescente". Tabela sem coluna de data fica
// sem ordenação até o clique.

import { useState } from 'react';

export interface OrdemDaTabela {
  coluna: number | null;
  desc: boolean;
  /** Clique no cabeçalho: crescente → decrescente → nenhuma; outra coluna começa crescente. */
  alterna: (coluna: number) => void;
  /**
   * A ordem saiu do padrão? Só ela alcança apenas as linhas EM MEMÓRIA (a tela diz isso);
   * o padrão de data veio do servidor, sobre a consulta inteira. Sem esta distinção, abrir
   * a tabela já ligaria o aviso "vale só sobre esta fatia".
   */
  foraDoPadrao: boolean;
}

/** @param colunaDataPadrao o índice da primeira coluna de data, ou -1. */
export function useOrdemDaTabela(colunaDataPadrao: number): OrdemDaTabela {
  const temPadrao = colunaDataPadrao >= 0;
  const [coluna, setColuna] = useState<number | null>(temPadrao ? colunaDataPadrao : null);
  const [desc, setDesc] = useState<boolean>(temPadrao);

  const alterna = (index: number) => {
    if (coluna === index) {
      if (desc) {
        setColuna(null);
        setDesc(false);
      } else {
        setDesc(true);
      }
    } else {
      setColuna(index);
      setDesc(false);
    }
  };

  const foraDoPadrao = temPadrao ? !(coluna === colunaDataPadrao && desc) : coluna !== null;
  return { coluna, desc, alterna, foraDoPadrao };
}
