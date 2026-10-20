// Os visuais abaixo da dobra, adiantados assim que a abertura termina.
//
// **O defeito (20/10/2026, staging).** Na `agendamento-field`, HISTÓRICO DE RELATOS,
// HISTÓRICO DE RELATOS COMPLETOS e VISÃO GERAL eram "sempre os últimos a carregar":
// `VisualNaDobra` só pede o visual quando o cartão chega a 200px da tela, então quem
// rolava até o fim encontrava esqueleto — o contrário de "tudo pré-carregado". O
// aquecedor do servidor também os prepara por último, e só no recorte de abertura.
//
// **Um por vez, com `origem=prefetch`, e sem repetir o que já está fresco no cache.** A regra
// do `VisualNaDobra` contra a rajada continua valendo para o que a ROLAGEM pede: oito
// pedidos simultâneos brigavam pela mesma worker. Aqui a fila é sequencial e de fundo
// (`prioridadeDe`), então um clique passa na frente de todos eles. A chave é a mesma do
// cartão (`consultaDoVisual`): ao rolar, o dado já está lá, e um aviso do tempo real
// que invalide a página faz o cartão mostrar o número atual enquanto busca o novo.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { FiltroDaTela, LayoutSpec } from '../services/dashboardService.ts';
import type { CampoClicado } from '../utils/rota.ts';
import { idsRestantes } from '../utils/cargaProgressiva.ts';
import { consultaDoVisual } from './useVisualSobDemanda.ts';

export function useAbaixoDaDobra(
  pagina: string | null,
  layout: LayoutSpec | null,
  filtros: FiltroDaTela[],
  clicados: CampoClicado[],
  ativo: boolean,
): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!ativo || !pagina || !layout) return;
    let parou = false;
    void (async () => {
      for (const id of idsRestantes(layout)) {
        if (parou) return;
        // Sem checar o cache à mão: com `staleTime: Infinity` (`queryClient.ts`), o
        // `prefetchQuery` só busca o que falta ou o que um aviso do servidor invalidou —
        // e é isso que deixa o fim da página atualizado também depois do tempo real.
        // Falhar aqui não aparece em lugar nenhum: o cartão pede de novo ao aparecer.
        await qc
          .prefetchQuery(consultaDoVisual(pagina, id, filtros, clicados, 'prefetch'))
          .catch(() => undefined);
      }
    })();
    return () => {
      parou = true;
    };
  }, [pagina, layout, filtros, clicados, ativo, qc]);
}
