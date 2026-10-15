import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { pegaUsoDasTelas, type UsoDeTela } from '../../services/acessoService.ts';
import { nomeDaAba } from '../../utils/ordemDasTelas.ts';
import { Cartao, Erro } from '../ui/Cartao.tsx';

export const PERIODOS_DE_USO = [7, 30, 90] as const;
export const chaveDoUso = (dias: (typeof PERIODOS_DE_USO)[number]) =>
  ['uso-das-telas', dias] as const;

function nomeOuTraco(tela: UsoDeTela | undefined): string {
  return tela ? nomeDaAba(tela.nome) : '—';
}

export function UsoDasTelas() {
  const [dias, setDias] = useState<(typeof PERIODOS_DE_USO)[number]>(30);
  const usoQ = useQuery({
    queryKey: chaveDoUso(dias),
    queryFn: () => pegaUsoDasTelas(dias),
  });
  const telas = useMemo(
    () =>
      [...(usoQ.data?.telas ?? [])].sort(
        (a, b) => b.aberturas - a.aberturas || a.nome.localeCompare(b.nome),
      ),
    [usoQ.data?.telas],
  );
  const comUso = telas.filter((tela) => tela.aberturas > 0);
  const maisAberta = comUso[0];
  const menosAberta = [...comUso].sort((a, b) => a.aberturas - b.aberturas)[0];
  const semUso = telas.filter((tela) => tela.aberturas === 0);

  return (
    <Cartao
      titulo="Uso das abas"
      sub="Aberturas deduplicadas por pessoa e aba a cada 30 minutos; sem tempo de permanência."
      largo
      acoes={
        <label className="flex items-center gap-[5px]">
          Período
          <select
            aria-label="Período do uso das abas"
            value={dias}
            onChange={(evento) => setDias(Number(evento.target.value) as typeof dias)}
          >
            {PERIODOS_DE_USO.map((periodo) => (
              <option key={periodo} value={periodo}>
                {periodo} dias
              </option>
            ))}
          </select>
        </label>
      }
    >
      {usoQ.error ? <Erro>{(usoQ.error as Error).message}</Erro> : null}
      {!usoQ.data && !usoQ.error ? <p className="m-0 text-pbi-muted">Lendo o uso…</p> : null}
      {usoQ.data ? (
        <>
          <div className="grid grid-cols-2 gap-[8px] lg:grid-cols-4">
            {[
              ['Mais aberta', nomeOuTraco(maisAberta), maisAberta?.aberturas ?? 0],
              ['Menos aberta', nomeOuTraco(menosAberta), menosAberta?.aberturas ?? 0],
              ['Sem abertura', String(semUso.length), null],
              ['Pessoas ativas', String(usoQ.data.pessoasAtivas), null],
            ].map(([rotulo, valor, detalhe]) => (
              <div key={rotulo} className="rounded-[4px] border border-pbi-borda p-[9px]">
                <div className="text-[0.68rem] uppercase text-pbi-muted">{rotulo}</div>
                <strong className="block truncate text-[1rem]" title={String(valor)}>
                  {valor}
                </strong>
                {detalhe !== null ? (
                  <span className="text-[0.68rem] text-pbi-muted">{detalhe} abertura(s)</span>
                ) : null}
              </div>
            ))}
          </div>

          <div className="overflow-auto">
            <table className="w-full border-collapse text-[0.76rem]">
              <thead className="sticky top-0 bg-pbi-fundo">
                <tr>
                  <th className="px-[8px] py-[6px] text-left">Aba</th>
                  <th className="px-[8px] py-[6px] text-right">Aberturas</th>
                  <th className="px-[8px] py-[6px] text-right">Pessoas</th>
                  <th className="px-[8px] py-[6px] text-left">Última abertura</th>
                </tr>
              </thead>
              <tbody>
                {telas.map((tela) => (
                  <tr key={tela.id} className="border-t border-pbi-borda">
                    <td className="px-[8px] py-[5px]">{nomeDaAba(tela.nome)}</td>
                    <td className="px-[8px] py-[5px] text-right tabular-nums">{tela.aberturas}</td>
                    <td className="px-[8px] py-[5px] text-right tabular-nums">{tela.pessoas}</td>
                    <td className="px-[8px] py-[5px] whitespace-nowrap">
                      {tela.ultimaAbertura
                        ? new Date(tela.ultimaAbertura).toLocaleString('pt-BR')
                        : 'Nunca no período'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Cartao>
  );
}
