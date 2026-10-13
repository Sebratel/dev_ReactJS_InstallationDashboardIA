// A gestão de quem abre cada aba — a matriz pessoa × aba do dashboard comercial
// (`Configuracoes.jsx`, aba "Acessos"), em diálogo. Só admin/dev a abre; o servidor confere
// de novo a cada clique (ACHADOS #208).
//
// Cada caixinha grava a LINHA inteira da pessoa (como no comercial): o resultado não
// depende da ordem dos cliques. A resposta de cada gravação já é a matriz nova, relida do
// banco — a tela mostra o que ficou gravado, não o que pediu.

import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  definePapel,
  defineModoDaTela,
  defineTelasDaPessoa,
  dispensaPedido,
  pegaMatriz,
  removePessoa,
  type MatrizDeAcesso,
  type Papel,
} from '../../services/acessoService.ts';
import { chavesDeConsulta } from '../../services/dashboardService.ts';
import { BotaoDeIcone } from '../ui/BotaoDeIcone.tsx';
import { Botao } from '../ui/Botao.tsx';
import { Aviso, Erro } from '../ui/Cartao.tsx';

const CHAVE = ['acessos'] as const;
const nomeCurto = (nome: string) => nome.replace(/\s*\/\s*/g, ' / ');

export function GestaoDeAcessos({ aoFechar }: { aoFechar: () => void }) {
  const qc = useQueryClient();
  const matrizQ = useQuery({ queryKey: CHAVE, queryFn: pegaMatriz });
  const [novos, setNovos] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const muda = useMutation({
    mutationFn: (acao: () => Promise<MatrizDeAcesso>) => acao(),
    onSuccess: (nova) => {
      qc.setQueryData(CHAVE, nova);
      // As abas de QUEM ESTÁ LOGADO podem ter mudado junto.
      void qc.invalidateQueries({ queryKey: chavesDeConsulta.dashboards });
    },
  });

  const m = matrizQ.data;
  const souAdmin = m?.eu.papel === 'admin';
  const pessoas = m
    ? [
        ...m.pessoas,
        ...novos
          .filter((e) => !m.pessoas.some((p) => p.email === e))
          .map((e) => ({ email: e, papel: 'viewer' as Papel, fixo: false, telas: [] as string[] })),
      ]
    : [];

  const adiciona = (ev: FormEvent) => {
    ev.preventDefault();
    const e = email.trim().toLowerCase();
    if (e && !novos.includes(e)) setNovos([...novos, e]);
    setEmail('');
  };

  return createPortal(
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-[color-mix(in_srgb,var(--pbi-ink)_45%,transparent)] p-[16px]"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div
        className="flex max-h-[min(88vh,900px)] w-[min(1200px,100%)] flex-col overflow-hidden rounded-[2px] border border-pbi-borda bg-pbi-superficie"
        role="dialog"
        aria-modal="true"
        aria-label="Acessos às abas"
      >
        <div className="flex flex-[0_0_auto] items-center gap-[10px] bg-pbi-primary px-[10px] py-[6px] text-pbi-sobre-primary">
          <h3 className="m-0 text-[0.76rem] font-bold">Acessos às abas</h3>
          <BotaoDeIcone tom="primaria" onClick={aoFechar} title="Fechar">
            <X size={13} />
          </BotaoDeIcone>
        </div>

        <div className="flex min-h-0 flex-[1_1_auto] flex-col gap-[8px] overflow-auto p-[10px] text-[0.76rem]">
          <p className="m-0 text-pbi-muted">
            Admin abre todas as abas. As demais contas abrem só o que estiver marcado — ou a aba em{' '}
            <strong>Todos</strong>. Toda mudança fica registrada com o seu e-mail.
          </p>
          {m && !m.banco.ok ? (
            <Aviso>
              O banco de acessos não respondeu na última leitura — o que aparece pode estar
              desatualizado.
            </Aviso>
          ) : null}
          {matrizQ.error ? <Erro>{(matrizQ.error as Error).message}</Erro> : null}
          {muda.error ? <Erro>{(muda.error as Error).message}</Erro> : null}

          {m && m.pedidos.length > 0 ? (
            <section className="rounded-[2px] border border-pbi-borda p-[8px]">
              <h4 className="m-0 mb-[6px] text-[0.74rem]">
                Pedidos de acesso ({m.pedidos.length})
              </h4>
              <ul className="m-0 grid list-none gap-[4px] p-0">
                {m.pedidos.map((p) => (
                  <li key={p.email} className="flex flex-wrap items-center gap-[8px]">
                    <span className="font-semibold">{p.email}</span>
                    <span className="text-pbi-muted">
                      {p.tentativas} tentativa(s), última em{' '}
                      {new Date(p.ultimaVez).toLocaleString('pt-BR')}
                    </span>
                    <Botao
                      variante="secundario"
                      className="ml-auto"
                      onClick={() => !novos.includes(p.email) && setNovos([...novos, p.email])}
                    >
                      Dar abas
                    </Botao>
                    <Botao
                      variante="secundario"
                      disabled={muda.isPending}
                      onClick={() => muda.mutate(() => dispensaPedido(p.email))}
                    >
                      Dispensar
                    </Botao>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <form onSubmit={adiciona} className="flex gap-[6px]">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nome.sobrenome@sebratel.com.br"
              aria-label="E-mail da pessoa"
              className="w-[min(320px,100%)] rounded-[2px] border border-pbi-borda bg-pbi-superficie px-[8px] py-[4px]"
            />
            <Botao variante="secundario" type="submit">
              Adicionar pessoa
            </Botao>
          </form>

          {m ? (
            <div className="overflow-auto rounded-[2px] border border-pbi-borda">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-pbi-fundo">
                  <tr>
                    <th className="px-[8px] py-[6px] text-left">Pessoa</th>
                    <th className="px-[8px] py-[6px] text-left">Papel</th>
                    {m.telas.map((t) => (
                      <th
                        key={t.id}
                        className="min-w-[84px] px-[6px] py-[6px] text-center align-bottom"
                      >
                        <div className="text-[0.68rem] leading-tight">{nomeCurto(t.nome)}</div>
                        <label className="mt-[4px] flex items-center justify-center gap-[3px] text-[0.64rem] font-normal text-pbi-muted">
                          <input
                            type="checkbox"
                            checked={t.modo === 'todos'}
                            disabled={muda.isPending}
                            onChange={(e) =>
                              muda.mutate(() =>
                                defineModoDaTela(t.id, e.target.checked ? 'todos' : 'lista'),
                              )
                            }
                          />
                          Todos
                        </label>
                      </th>
                    ))}
                    <th className="w-[1%]" />
                  </tr>
                </thead>
                <tbody>
                  {pessoas.map((p) => {
                    const veTudo = p.papel === 'admin';
                    const podeRemover = !p.fixo && (souAdmin || p.papel === 'viewer');
                    return (
                      <tr key={p.email} className="border-t border-pbi-borda">
                        <td className="px-[8px] py-[4px] whitespace-nowrap">{p.email}</td>
                        <td className="px-[8px] py-[4px]">
                          {souAdmin && !p.fixo ? (
                            <select
                              value={p.papel}
                              disabled={muda.isPending}
                              onChange={(e) =>
                                muda.mutate(() => definePapel(p.email, e.target.value as Papel))
                              }
                              aria-label={`Papel de ${p.email}`}
                            >
                              <option value="viewer">viewer</option>
                              <option value="dev">dev</option>
                              <option value="admin">admin</option>
                            </select>
                          ) : (
                            <span title={p.fixo ? 'Definido no .env do servidor' : undefined}>
                              {p.papel}
                              {p.fixo ? ' (fixo)' : ''}
                            </span>
                          )}
                        </td>
                        {m.telas.map((t) => {
                          const marcada = veTudo || t.modo === 'todos' || p.telas.includes(t.id);
                          return (
                            <td key={t.id} className="px-[6px] py-[4px] text-center">
                              <input
                                type="checkbox"
                                checked={marcada}
                                disabled={veTudo || t.modo === 'todos' || muda.isPending}
                                title={
                                  veTudo
                                    ? 'Admin abre todas as abas'
                                    : t.modo === 'todos'
                                      ? 'Aba aberta para todos'
                                      : undefined
                                }
                                aria-label={`${p.email} abre ${t.nome}`}
                                onChange={(e) => {
                                  const telas = e.target.checked
                                    ? [...p.telas, t.id]
                                    : p.telas.filter((x) => x !== t.id);
                                  muda.mutate(() => defineTelasDaPessoa(p.email, telas));
                                }}
                              />
                            </td>
                          );
                        })}
                        <td className="px-[6px] py-[4px]">
                          <BotaoDeIcone
                            onClick={() => {
                              setNovos(novos.filter((e) => e !== p.email));
                              if (m.pessoas.some((x) => x.email === p.email))
                                muda.mutate(() => removePessoa(p.email));
                            }}
                            disabled={!podeRemover || muda.isPending}
                            title={
                              podeRemover
                                ? 'Tirar todos os acessos'
                                : 'Só admin remove quem tem papel; papel fixo não sai pela tela'
                            }
                            aria-label={`Remover ${p.email}`}
                          >
                            <Trash2 size={13} />
                          </BotaoDeIcone>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : matrizQ.isPending ? (
            <p className="m-0 text-pbi-muted">Lendo os acessos…</p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
