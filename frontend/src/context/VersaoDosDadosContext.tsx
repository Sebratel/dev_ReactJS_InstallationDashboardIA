// Quando a tela inteira tem de buscar de novo.
//
// A abertura da página (`App.tsx`) sempre reagiu ao aviso do servidor (`/api/eventos`)
// e ao relógio de segundo plano. Os visuais buscados à parte — abaixo da dobra
// (`VisualNaDobra.tsx`) e sob demanda (`SobDemanda.tsx`) — não: buscavam uma vez, ao
// aparecer, e ficavam com aquele número até a pessoa trocar de filtro. Na VISÃO
// PRODUTIVA isso era meia tela em tempo real e meia parada (05/10/2026). Este contexto
// é o sinal único de "busque de novo", lido pelos dois lados.
//
// **Duas versões, porque o custo é diferente.**
//  - `dados` sobe a cada aviso do servidor, a cada volta do relógio e no botão
//    "Atualizar". Quem a lê busca de novo MANTENDO o número atual na tela até o novo
//    chegar — nunca volta para o esqueleto (`feedback-tudo-pre-carregado`).
//  - `filtros` sobe só no botão "Atualizar". A lista de valores de uma segmentação
//    muda raramente, e buscá-la a cada aviso seria trabalho do servidor por nada.
//
// Nenhuma das duas força recálculo no servidor: buscar de novo é pedir o que ele já
// tem pronto. Recalcular para todo mundo é decisão da plataforma, não de um clique.

import { createContext, useContext } from 'react';

export interface VersaoDosDados {
  dados: number;
  filtros: number;
}

export const ContextoVersaoDosDados = createContext<VersaoDosDados>({ dados: 0, filtros: 0 });

export function useVersaoDosDados(): VersaoDosDados {
  return useContext(ContextoVersaoDosDados);
}
