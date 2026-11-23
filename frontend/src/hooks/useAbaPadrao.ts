// Qual aba deve estar aberta quando a URL não resolve sozinha.
//
// São duas situações, e as duas terminam no mesmo lugar — a primeira página pronta da
// lista: a URL não trouxe aba nenhuma, ou trouxe uma que esta conta não abre (link
// compartilhado, favorito antigo). Estavam como dois `useEffect` soltos no corpo da
// `DashboardPage`; aqui viram um hook com nome, e o componente só diz o que quer.
//
// Quem barra o dado de verdade é o 403 do servidor; isto é só não deixar a pessoa
// parada diante dele.

import { useEffect } from 'react';

interface PaginaDisponivel {
  id: string;
  pronta: boolean;
}

interface OpcoesDaAbaPadrao {
  /** A aba que a URL diz; `null` quando ela não trouxe nenhuma. */
  abaAberta: string | null;
  /** A lista de páginas do relatório; `undefined` enquanto ela não chegou. */
  paginasDisponiveis: readonly PaginaDisponivel[] | undefined;
  /** Se a aba aberta está liberada; `null` enquanto não dá para saber. */
  liberada: boolean | null;
  /** Abre esta aba mantendo o filtro que o link trouxe. */
  iniciaEm: (id: string) => void;
  /** Troca para esta aba, com o filtro padrão dela. */
  escolhe: (id: string) => void;
}

/** A primeira página pronta, ou a primeira de todas quando nenhuma está pronta. */
function primeiraPaginaUtil(paginas: readonly PaginaDisponivel[]): string | undefined {
  return paginas.find((pagina) => pagina.pronta)?.id ?? paginas[0]?.id;
}

export function useAbaPadrao({
  abaAberta,
  paginasDisponiveis,
  liberada,
  iniciaEm,
  escolhe,
}: OpcoesDaAbaPadrao): void {
  // A URL não trouxe aba: abre a primeira pronta da lista.
  useEffect(() => {
    if (!paginasDisponiveis || abaAberta) return;
    const escolhida = primeiraPaginaUtil(paginasDisponiveis);
    if (escolhida) iniciaEm(escolhida);
  }, [paginasDisponiveis, abaAberta, iniciaEm]);

  // A URL trouxe uma aba que esta conta não abre: vai para a primeira liberada.
  useEffect(() => {
    if (liberada !== false || !abaAberta || !paginasDisponiveis) return;
    const destino = primeiraPaginaUtil(paginasDisponiveis);
    if (destino) escolhe(destino);
  }, [liberada, abaAberta, paginasDisponiveis, escolhe]);
}
