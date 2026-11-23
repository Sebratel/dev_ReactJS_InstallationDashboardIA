// Quem está logado agora, e de onde (S2 de docs/PLANO-SEGURANCA.md). Só admin vê — o
// servidor confere de novo (`/api/admin/sessoes`). "Derrubar" fecha TODAS as sessões
// daquele e-mail: é o que se faz quando um cookie pode ter sido copiado.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { derrubaSessoes, pegaSessoes, type SessaoAtiva } from '../../services/acessoService.ts';
import { Botao } from '../ui/Botao.tsx';
import { Cartao, Erro } from '../ui/Cartao.tsx';

export const CHAVE_SESSOES = ['sessoes'] as const;

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR');

export function SessoesAtivas({ eu }: { eu: string }) {
  const queryClient = useQueryClient();
  const sessoesQ = useQuery({ queryKey: CHAVE_SESSOES, queryFn: pegaSessoes });
  const derruba = useMutation({
    mutationFn: derrubaSessoes,
    onSuccess: (sessao) => queryClient.setQueryData(CHAVE_SESSOES, { sessoes: sessao.sessoes }),
  });
  const sessoes = sessoesQ.data?.sessoes ?? [];

  return (
    <Cartao titulo={`Sessões abertas (${sessoes.length})`} largo>
      {sessoesQ.error ? <Erro>{(sessoesQ.error as Error).message}</Erro> : null}
      {derruba.error ? <Erro>{(derruba.error as Error).message}</Erro> : null}
      <CorpoDasSessoes
        sessoes={sessoes}
        lendo={sessoesQ.isPending}
        eu={eu}
        derrubando={derruba.isPending}
        aoDerrubar={(usuario) => derruba.mutate(usuario)}
      />
    </Cartao>
  );
}

/** A tabela das sessões, o "Lendo…" enquanto elas não chegam, ou nada. */
function CorpoDasSessoes({
  sessoes,
  lendo,
  eu,
  derrubando,
  aoDerrubar,
}: {
  sessoes: readonly SessaoAtiva[];
  lendo: boolean;
  eu: string;
  derrubando: boolean;
  aoDerrubar: (usuario: string) => void;
}) {
  if (sessoes.length === 0) {
    return lendo ? <p className="m-0 text-pbi-muted">Lendo as sessões…</p> : null;
  }
  return (
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
        {sessoes.map((sessao) => (
          <tr key={`${sessao.usuario}-${sessao.criadaEm}`} className="border-t border-pbi-borda">
            <td className="px-[6px] py-[3px] whitespace-nowrap">{sessao.usuario}</td>
            <td className="px-[6px] py-[3px]">{sessao.ip ?? '—'}</td>
            <td className="px-[6px] py-[3px] whitespace-nowrap">{quando(sessao.ultimoUso)}</td>
            <td className="px-[6px] py-[3px] whitespace-nowrap">{quando(sessao.expiraEm)}</td>
            <td className="px-[6px] py-[3px]">
              <Botao
                variante="secundario"
                disabled={derrubando}
                onClick={() => aoDerrubar(sessao.usuario)}
                title={
                  sessao.usuario === eu
                    ? 'Fecha também a sua sessão — você vai precisar entrar de novo'
                    : `Fecha todas as sessões de ${sessao.usuario}`
                }
              >
                Derrubar
              </Botao>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
