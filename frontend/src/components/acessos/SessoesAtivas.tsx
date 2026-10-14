// Quem está logado agora, e de onde (S2 de docs/PLANO-SEGURANCA.md). Só admin vê — o
// servidor confere de novo (`/api/admin/sessoes`). "Derrubar" fecha TODAS as sessões
// daquele e-mail: é o que se faz quando um cookie pode ter sido copiado.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { derrubaSessoes, pegaSessoes } from '../../services/acessoService.ts';
import { Botao } from '../ui/Botao.tsx';
import { Cartao, Erro } from '../ui/Cartao.tsx';

export const CHAVE_SESSOES = ['sessoes'] as const;

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR');

export function SessoesAtivas({ eu }: { eu: string }) {
  const qc = useQueryClient();
  const sessoesQ = useQuery({ queryKey: CHAVE_SESSOES, queryFn: pegaSessoes });
  const derruba = useMutation({
    mutationFn: derrubaSessoes,
    onSuccess: (r) => qc.setQueryData(CHAVE_SESSOES, { sessoes: r.sessoes }),
  });
  const sessoes = sessoesQ.data?.sessoes ?? [];

  return (
    <Cartao titulo={`Sessões abertas (${sessoes.length})`} largo>
      {sessoesQ.error ? <Erro>{(sessoesQ.error as Error).message}</Erro> : null}
      {derruba.error ? <Erro>{(derruba.error as Error).message}</Erro> : null}
      {sessoes.length > 0 ? (
        <table className="w-full border-collapse text-[0.76rem]">
          <thead>
            <tr className="text-left text-pbi-muted">
              <th className="px-[6px] py-[3px]">Pessoa</th>
              <th className="px-[6px] py-[3px]">IP</th>
              <th className="px-[6px] py-[3px]">Último uso</th>
              <th className="px-[6px] py-[3px]">Vence</th>
              <th className="w-[1%]" />
            </tr>
          </thead>
          <tbody>
            {sessoes.map((s) => (
              <tr key={`${s.usuario}-${s.criadaEm}`} className="border-t border-pbi-borda">
                <td className="px-[6px] py-[3px] whitespace-nowrap">{s.usuario}</td>
                <td className="px-[6px] py-[3px]">{s.ip ?? '—'}</td>
                <td className="px-[6px] py-[3px] whitespace-nowrap">{quando(s.ultimoUso)}</td>
                <td className="px-[6px] py-[3px] whitespace-nowrap">{quando(s.expiraEm)}</td>
                <td className="px-[6px] py-[3px]">
                  <Botao
                    variante="secundario"
                    disabled={derruba.isPending}
                    onClick={() => derruba.mutate(s.usuario)}
                    title={
                      s.usuario === eu
                        ? 'Fecha também a sua sessão — você vai precisar entrar de novo'
                        : `Fecha todas as sessões de ${s.usuario}`
                    }
                  >
                    Derrubar
                  </Botao>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : sessoesQ.isPending ? (
        <p className="m-0 text-pbi-muted">Lendo as sessões…</p>
      ) : null}
    </Cartao>
  );
}
