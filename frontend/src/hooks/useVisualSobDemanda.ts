// O hook por trás de um visual buscado à parte — usado por `SobDemanda.tsx` (visual
// caro demais para a abertura, decidido pelo servidor) e por `VisualNaDobra.tsx`
// (visual fora da dobra, decidido pela rolagem — Fase L5, R4). Extraído de dentro de
// `SobDemanda.tsx` para os dois nunca terem duas implementações do mesmo fetch.
//
// **R3 do contrato de carregamento: cancelável e voo único.** A busca anterior tem de
// morrer quando chega a seguinte — senão o servidor segue calculando uma resposta que
// ninguém vai usar, e uma resposta tardia pinta o recorte errado. E "Tentar de novo"
// tem de refazer o pedido de verdade (um bug antigo o deixava preso em "carregando").
//
// **Desde a fase 2 (`docs/PLANO-PADROES-FRONTEND.md`), no React Query.** O cancelamento
// (o `signal` do `queryFn`), o voo único por chave e a nova tentativa vêm dele. A chave é
// a URL do visual sob o prefixo `['pagina', id]` (`chavesDeConsulta`): o aviso do servidor
// que invalida a página alcança também este visual, e ele busca de novo MANTENDO o número
// atual na tela (`placeholderData`) — antes ele buscava uma vez, ao aparecer, e parava.
// `clicados` entra pela URL, que é texto: um array novo com o mesmo conteúdo não muda a
// chave, que era o motivo de ele ficar fora das dependências do efeito antigo.

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  chavesDeConsulta,
  pegaPagina,
  urlDaPagina,
  type FiltroDaTela,
  type VisualCalculado,
} from '../services/dashboardService.ts';

export type EstadoSobDemanda = 'carregando' | 'parado';

export interface VisualSobDemanda {
  estado: EstadoSobDemanda;
  pronto: VisualCalculado | null;
  erro: string | null;
  tentarDeNovo: () => void;
}

export function useVisualSobDemanda(
  pagina: string,
  visualId: string,
  filtros: readonly FiltroDaTela[],
  clicados: readonly { tabela: string; coluna: string }[] = [],
): VisualSobDemanda {
  const opcoes = { visual: visualId };
  const q = useQuery({
    queryKey: chavesDeConsulta.pagina(pagina, urlDaPagina(pagina, filtros, opcoes, clicados)),
    queryFn: async ({ signal }) => {
      const p = await pegaPagina(pagina, filtros, opcoes, signal, clicados);
      const achado = p.visuais.find((v) => v.id === visualId);
      if (!achado) throw new Error('a resposta não trouxe este visual.');
      if (achado.erro) throw new Error(achado.erro);
      return achado;
    },
    placeholderData: keepPreviousData,
  });
  return {
    estado: q.isFetching ? 'carregando' : 'parado',
    pronto: q.data ?? null,
    erro: q.error ? (q.error instanceof Error ? q.error.message : String(q.error)) : null,
    tentarDeNovo: () => void q.refetch(),
  };
}
