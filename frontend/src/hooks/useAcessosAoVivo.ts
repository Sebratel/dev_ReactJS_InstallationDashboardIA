import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { chavesDeConsulta, listaDashboards } from '../services/dashboardService.ts';

/** As chaves de cache por página: o primeiro segmento é o tipo, o segundo o id da aba. */
const POR_PAGINA = new Set(['pagina', 'layout', 'valores']);

/** O que só quem gere acessos lê — a matriz tem e-mails de todo mundo. */
const DA_GESTAO = new Set(['acessos', 'acessos-historico', 'sessoes', 'uso-das-telas']);

/**
 * Apaga do navegador o que esta conta deixou de poder ver.
 *
 * A trava é do servidor (403 a cada pedido); isto é para a TELA acompanhar. Sem isto,
 * depois de perder uma aba ou o papel de admin, os dados já baixados continuavam na
 * memória da tela (`staleTime: Infinity`) e reapareciam ao clicar, até o F5.
 */
export function limpaAcessoPerdido(
  qc: QueryClient,
  abasLiberadas: ReadonlySet<string>,
  podeGerir: boolean,
): void {
  qc.removeQueries({
    predicate: (q) => {
      const [tipo, id] = q.queryKey;
      if (typeof tipo !== 'string') return false;
      if (POR_PAGINA.has(tipo)) return typeof id === 'string' && !abasLiberadas.has(id);
      return !podeGerir && DA_GESTAO.has(tipo);
    },
  });
}

/**
 * Mantém a tela em dia com os acessos desta conta, sem F5 (Erick, 22/10/2026).
 *
 * Quem dispara é o servidor: o evento `acessos` do SSE (`useTempoReal`) refaz a lista de
 * abas. Aqui, toda vez que a lista muda, sai do cache o que a conta perdeu. A lista também
 * é conferida ao voltar o foco e a cada 5 min — rede de segurança para quando o SSE cai
 * (proxy, rede) e o aviso não chega.
 */
export function useAcessosAoVivo(): void {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: chavesDeConsulta.dashboards,
    queryFn: () => listaDashboards(),
    // 'always', não true: com `staleTime: Infinity` (queryClient.ts) a lista nunca fica
    // velha, e `true` só rebusca o que está velho — não faria nada.
    refetchOnWindowFocus: 'always',
    refetchInterval: 5 * 60_000,
    select: (r) => ({
      ids: r.dashboards.map((d) => d.id).join('|'),
      podeGerir: r.eu?.podeGerir === true,
    }),
  });
  const ids = q.data?.ids;
  const podeGerir = q.data?.podeGerir;
  useEffect(() => {
    if (ids === undefined || podeGerir === undefined) return;
    limpaAcessoPerdido(qc, new Set(ids ? ids.split('|') : []), podeGerir);
  }, [qc, ids, podeGerir]);
}
