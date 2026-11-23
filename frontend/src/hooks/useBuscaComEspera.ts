// O campo de busca da tabela, em duas velocidades.
//
// `termo` é o que está escrito e acompanha a tecla; `aplicado` é o que já virou pedido.
// Sem a espera, `1784218` são sete requisições — e as seis primeiras são perguntas que
// ninguém fez. A normalização acontece aqui (para `1784218 ` não gastar um pedido) e de
// novo no servidor, que é a garantia: a URL pode chegar de qualquer lugar.

import { useEffect, useState } from 'react';

/** Quanto o pedido espera depois da última tecla. */
export const ESPERA_DA_BUSCA_MS = 250;

export function useBuscaComEspera(esperaMs: number = ESPERA_DA_BUSCA_MS) {
  const [termo, setTermo] = useState('');
  const [aplicado, setAplicado] = useState('');

  useEffect(() => {
    const agendado = setTimeout(() => setAplicado(termo.trim().toLowerCase()), esperaMs);
    return () => clearTimeout(agendado);
  }, [termo, esperaMs]);

  return { termo, aplicado, escreve: setTermo };
}
