// A JANELA DE 20 LINHAS dentro da fatia de 200.
//
// `useJanela` traz 200 linhas do servidor; a tela desenha 20 por vez. Virar página
// DENTRO das 200 é instantâneo e não custa requisição — só ao sair delas se busca a
// fatia seguinte. A ANÁLISE DETALHADA ficou 10x mais curta e com MENOS pedidos.
//
// Saiu do corpo da `Tabela`, onde os três estados e a comparação de âncora ficavam
// soltos entre os `useMemo` e o JSX.

import { useState } from 'react';
import { janelaDeServidorPara } from '../utils/janela.ts';

interface OpcoesDaPaginacao {
  /** O índice global da primeira linha da fatia que está na tela. */
  deDaFatia: number | undefined;
  /** Quantas linhas a fatia trouxe. */
  linhasNaFatia: number;
  /**
   * O que, mudando, refaz o conjunto (busca e ordem). Continuar na página 7 mostraria o
   * vazio; comparar durante a renderização volta ao início sem o quadro em branco que um
   * efeito deixaria.
   */
  ancoraDoConjunto: string;
  /** Pede outra fatia ao servidor. */
  pedeFatia: (de: number) => void;
}

export function usePaginacaoLocal({
  deDaFatia,
  linhasNaFatia,
  ancoraDoConjunto,
  pedeFatia,
}: OpcoesDaPaginacao) {
  const [inicioLocal, setInicioLocal] = useState(0);
  /**
   * Onde cair quando a fatia pedida chegar. Sem isto, a fatia nova mudava a âncora e a
   * tela voltava ao começo dela: "anterior" a partir da linha 201 mostrava 1–20, não
   * 181–200 (07/10/2026). E enquanto a fatia não chega, as linhas atuais ficam — antes a
   * tela já pulava para o começo da fatia velha.
   */
  const [alvo, setAlvo] = useState<{ fatia: number; inicio: number } | null>(null);

  const ancora = `${deDaFatia}|${ancoraDoConjunto}`;
  const [ancoraAnterior, setAncoraAnterior] = useState(ancora);
  if (ancoraAnterior !== ancora) {
    setAncoraAnterior(ancora);
    setInicioLocal(alvo && alvo.fatia === deDaFatia ? alvo.inicio : 0);
    setAlvo(null);
  }

  /** Recebe um índice GLOBAL e decide se anda em memória ou busca outra fatia. */
  const vaiParaLinha = (linhaGlobal: number) => {
    const de = deDaFatia ?? 0;
    if (linhaGlobal >= de && linhaGlobal < de + linhasNaFatia) {
      setInicioLocal(linhaGlobal - de);
      return;
    }
    const novaFatia = janelaDeServidorPara(linhaGlobal);
    setAlvo({ fatia: novaFatia, inicio: linhaGlobal - novaFatia });
    pedeFatia(novaFatia);
  };

  return { inicioLocal, vaiParaLinha };
}
