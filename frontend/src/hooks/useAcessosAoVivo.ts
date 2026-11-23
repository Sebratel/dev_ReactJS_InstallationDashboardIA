import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { chavesDeConsulta, listaDashboards } from '../services/dashboardService.ts';

/** As chaves de cache por página: o primeiro segmento é o tipo, o segundo o id da aba. */
const POR_PAGINA = new Set(['pagina', 'layout', 'valores']);

/** O que só quem gere acessos lê — a matriz tem e-mails de todo mundo. */
const DA_GESTAO = new Set(['acessos', 'acessos-historico', 'sessoes', 'uso-das-telas']);

/**
 * Os acessos mudaram: tudo que os mostra busca de novo — a lista de abas (e o papel), a
 * matriz, o HISTÓRICO e as sessões. O histórico ficou de fora na primeira versão e só
 * aparecia com F5 (Erick, 22/10/2026): `['acessos']` não alcança `['acessos-historico', …]`,
 * porque a chave casa por elemento e não por começo de texto.
 */
export function releAcessos(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: chavesDeConsulta.dashboards });
  for (const tipo of DA_GESTAO) void queryClient.invalidateQueries({ queryKey: [tipo] });
}

/**
 * Apaga do navegador o que esta conta deixou de poder ver.
 *
 * A trava é do servidor (403 a cada pedido); isto é para a TELA acompanhar. Sem isto,
 * depois de perder uma aba ou o papel de admin, os dados já baixados continuavam na
 * memória da tela (`staleTime: Infinity`) e reapareciam ao clicar, até o F5.
 */
export function limpaAcessoPerdido(
  queryClient: QueryClient,
  abasLiberadas: ReadonlySet<string>,
  podeGerir: boolean,
): void {
  queryClient.removeQueries({
    predicate: (erro) => {
      const [tipo, id] = erro.queryKey;
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
  const queryClient = useQueryClient();
  const consulta = useQuery({
    queryKey: chavesDeConsulta.dashboards,
    queryFn: () => listaDashboards(),
    // 'always', não true: com `staleTime: Infinity` (queryClient.ts) a lista nunca fica
    // velha, e `true` só rebusca o que está velho — não faria nada.
    refetchOnWindowFocus: 'always',
    refetchInterval: 5 * 60_000,
    select: (registro) => ({
      ids: registro.dashboards.map((dados) => dados.id).join('|'),
      podeGerir: registro.eu?.podeGerir === true,
    }),
  });
  const ids = consulta.data?.ids;
  const podeGerir = consulta.data?.podeGerir;
  useEffect(() => {
    if (ids === undefined || podeGerir === undefined) return;
    limpaAcessoPerdido(queryClient, new Set(ids ? ids.split('|') : []), podeGerir);
  }, [queryClient, ids, podeGerir]);
}
