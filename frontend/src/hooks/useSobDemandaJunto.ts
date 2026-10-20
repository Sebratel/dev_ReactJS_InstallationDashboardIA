// Os visuais `sobDemanda` pedidos JUNTO com a abertura, e não depois dela.
//
// **A cascata (20/10/2026, teste de cliques no staging).** Um clique de filtro na
// `agendamento-field` pedia a abertura (~5 s) e só quando ela voltava os 5 visuais caros
// montavam e pediam cada um o seu — terminando em 11 s. Quais são os caros o servidor
// já disse na resposta anterior desta mesma página (a que o `placeholderData` mantém na
// tela), então eles podem sair no instante do clique, lado a lado com a abertura. O
// cartão que monta depois se junta ao pedido a caminho (mesma chave, `consultaDoVisual`).

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { FiltroDaTela } from '../services/dashboardService.ts';
import type { CampoClicado } from '../utils/rota.ts';
import { consultaDoVisual } from './useVisualSobDemanda.ts';

export function useSobDemandaJunto(
  pagina: string | null,
  filtros: FiltroDaTela[],
  clicados: CampoClicado[],
  ids: readonly string[],
): void {
  const qc = useQueryClient();
  const assinatura = ids.join('\n');

  useEffect(() => {
    if (!pagina || assinatura === '') return;
    for (const id of assinatura.split('\n')) {
      // Interativo (sem `origem`): é a resposta do clique que acabou de acontecer.
      qc.prefetchQuery(consultaDoVisual(pagina, id, filtros, clicados)).catch(() => undefined);
    }
  }, [pagina, filtros, clicados, assinatura, qc]);
}
