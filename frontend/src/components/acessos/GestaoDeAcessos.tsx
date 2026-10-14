// A aba PERMISSÕES: quem abre cada aba — a matriz pessoa × aba do dashboard comercial
// (`Configuracoes.jsx`, aba "Acessos"). Só admin/dev a vê na faixa; o servidor confere de
// novo a cada pedido (ACHADOS #208).
//
// Até 14/10/2026 era um diálogo aberto por um ícone no topo, e cada caixinha gravava na
// hora. Agora é uma aba como as outras e nada grava sozinho: o que a pessoa mexe fica no
// rascunho (`utils/rascunhoDeAcessos.ts`), a linha alterada fica marcada, e a lista do
// rodapé diz o que vai mudar antes de "Salvar alterações". Pedido de acesso dispensado e
// sessão derrubada continuam valendo no clique — são ações, não edições da matriz.

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Trash2, Undo2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  aplicaOperacao,
  dispensaPedido,
  pegaMatriz,
  type MatrizDeAcesso,
  type Papel,
} from '../../services/acessoService.ts';
import { chavesDeConsulta } from '../../services/dashboardService.ts';
import { useRascunhoDeAcessos } from '../../store/rascunhoDeAcessosStore.ts';
import { cn } from '../../utils/cn.ts';
import { nomeDaAba } from '../../utils/ordemDasTelas.ts';
import {
  alternaRemocao,
  comModo,
  comPapel,
  comPessoa,
  comTela,
  descreveOperacao,
  matrizComRascunho,
  operacoesDoRascunho,
  semOperacao,
  type OperacaoDeAcesso,
} from '../../utils/rascunhoDeAcessos.ts';
import { BotaoDeIcone } from '../ui/BotaoDeIcone.tsx';
import { Botao } from '../ui/Botao.tsx';
import { Aviso, Cartao, Erro } from '../ui/Cartao.tsx';
import { CHAVE_SESSOES, SessoesAtivas } from './SessoesAtivas.tsx';

export const CHAVE_ACESSOS = ['acessos'] as const;

export function GestaoDeAcessos() {
  const qc = useQueryClient();
  const matrizQ = useQuery({ queryKey: CHAVE_ACESSOS, queryFn: pegaMatriz });
  const { rascunho, muda, conta, descarta } = useRascunhoDeAcessos();
  const [email, setEmail] = useState('');

  const m = matrizQ.data;
  const ops = useMemo(() => (m ? operacoesDoRascunho(m, rascunho) : []), [m, rascunho]);
  useEffect(() => conta(ops.length), [ops.length, conta]);

  // As abas de QUEM ESTÁ LOGADO podem ter mudado junto, e remover pessoa derruba as
  // sessões dela no servidor (S2).
  const releLigadas = () => {
    void qc.invalidateQueries({ queryKey: chavesDeConsulta.dashboards });
    void qc.invalidateQueries({ queryKey: CHAVE_SESSOES });
  };

  // Um pedido por vez, na ordem de `operacoesDoRascunho`. Cada resposta já é a matriz
  // relida do banco, e o que gravou sai do rascunho na hora: se o terceiro falhar, os
  // dois primeiros ficam gravados e só o resto continua pendente na tela.
  const salva = useMutation({
    mutationFn: async (lista: OperacaoDeAcesso[]) => {
      try {
        for (const op of lista) {
          const nova = await aplicaOperacao(op);
          qc.setQueryData(CHAVE_ACESSOS, nova);
          muda((r) => semOperacao(r, op));
        }
      } finally {
        releLigadas();
      }
    },
    onSuccess: descarta,
  });
  const dispensa = useMutation({
    mutationFn: dispensaPedido,
    onSuccess: (nova: MatrizDeAcesso) => qc.setQueryData(CHAVE_ACESSOS, nova),
  });

  if (!m) {
    return matrizQ.error ? (
      <Erro>{(matrizQ.error as Error).message}</Erro>
    ) : (
      <p className="m-0 text-pbi-muted">Lendo os acessos…</p>
    );
  }

  const souAdmin = m.eu.papel === 'admin';
  const vista = matrizComRascunho(m, rascunho);
  const nomeDaTela = (id: string) => nomeDaAba(m.telas.find((t) => t.id === id)?.nome ?? id);
  const travado = salva.isPending;

  const adiciona = (ev: FormEvent) => {
    ev.preventDefault();
    muda((r) => comPessoa(r, email));
    setEmail('');
  };

  return (
    <>
      {!m.banco.ok ? (
        <Aviso>
          O banco de acessos não respondeu na última leitura — o que aparece pode estar
          desatualizado.
        </Aviso>
      ) : null}
      {m.pedidos.length > 0 ? (
        <Aviso>
          {m.pedidos.length} pedido(s) de acesso esperando resposta — logo abaixo da matriz.
        </Aviso>
      ) : null}

      <Cartao
        titulo="Acessos às abas"
        sub="Admin abre todas as abas. As demais contas abrem só o que estiver marcado — ou a aba em Todos. Toda mudança salva fica registrada com o seu e-mail."
        altura="matriz"
        largo
      >
        <form onSubmit={adiciona} className="flex flex-none gap-[6px]">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome.sobrenome@sebratel.com.br"
            aria-label="E-mail da pessoa"
            className="w-[min(320px,100%)] rounded-[2px] border border-pbi-borda bg-pbi-superficie px-[8px] py-[4px]"
          />
          <Botao variante="secundario" type="submit" disabled={travado}>
            Adicionar pessoa
          </Botao>
        </form>

        <table className="w-full border-collapse text-[0.76rem]">
          <thead className="sticky top-0 z-10 bg-pbi-fundo">
            <tr>
              <th className="px-[8px] py-[6px] text-left">Pessoa</th>
              <th className="px-[8px] py-[6px] text-left">Papel</th>
              {vista.telas.map((t) => (
                <th
                  key={t.id}
                  className={cn(
                    'min-w-[84px] px-[6px] py-[6px] text-center align-bottom',
                    t.mudou && 'bg-pbi-aviso-bg',
                  )}
                >
                  <div className="text-[0.68rem] leading-tight">{nomeDaAba(t.nome)}</div>
                  <label className="mt-[4px] flex items-center justify-center gap-[3px] text-[0.64rem] font-normal text-pbi-muted">
                    <input
                      type="checkbox"
                      checked={t.modo === 'todos'}
                      disabled={travado}
                      onChange={(e) =>
                        muda((r) => comModo(m, r, t.id, e.target.checked ? 'todos' : 'lista'))
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
            {vista.pessoas.map((p) => {
              const veTudo = p.papel === 'admin';
              const podeRemover = !p.fixo && (souAdmin || p.papel === 'viewer');
              return (
                <tr
                  key={p.email}
                  className={cn(
                    'border-t border-pbi-borda',
                    p.mudou && 'bg-pbi-aviso-bg',
                    p.removida && 'text-pbi-muted line-through',
                  )}
                >
                  <td className="px-[8px] py-[4px] whitespace-nowrap">
                    {p.email}
                    {p.nova ? <span className="ml-[6px] text-pbi-muted">(nova)</span> : null}
                  </td>
                  <td className="px-[8px] py-[4px]">
                    {souAdmin && !p.fixo ? (
                      <select
                        value={p.papel}
                        disabled={travado || p.removida}
                        onChange={(e) =>
                          muda((r) => comPapel(m, r, p.email, e.target.value as Papel))
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
                  {vista.telas.map((t) => (
                    <td key={t.id} className="px-[6px] py-[4px] text-center">
                      <input
                        type="checkbox"
                        checked={veTudo || t.modo === 'todos' || p.telas.includes(t.id)}
                        disabled={veTudo || t.modo === 'todos' || p.removida || travado}
                        title={
                          veTudo
                            ? 'Admin abre todas as abas'
                            : t.modo === 'todos'
                              ? 'Aba aberta para todos'
                              : undefined
                        }
                        aria-label={`${p.email} abre ${t.nome}`}
                        onChange={(e) =>
                          muda((r) => comTela(m, r, p.email, t.id, e.target.checked))
                        }
                      />
                    </td>
                  ))}
                  <td className="px-[6px] py-[4px]">
                    <BotaoDeIcone
                      onClick={() => muda((r) => alternaRemocao(m, r, p.email))}
                      disabled={!podeRemover || travado}
                      title={
                        p.removida
                          ? 'Desfazer a remoção'
                          : podeRemover
                            ? 'Tirar todos os acessos (ao salvar)'
                            : 'Só admin remove quem tem papel; papel fixo não sai pela tela'
                      }
                      aria-label={p.removida ? `Manter ${p.email}` : `Remover ${p.email}`}
                    >
                      {p.removida ? <Undo2 size={13} /> : <Trash2 size={13} />}
                    </BotaoDeIcone>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* O rodapé fica preso embaixo do cartão enquanto a matriz rola: o botão de
            salvar e a lista do que muda estão sempre à vista. */}
        <div className="sticky bottom-0 left-0 mt-auto flex flex-none flex-wrap items-end gap-[8px] border-t border-pbi-borda bg-pbi-superficie pt-[6px] text-[0.74rem]">
          <div className="min-w-[240px] flex-1">
            {ops.length === 0 ? (
              <span className="text-pbi-muted">Nenhuma alteração pendente.</span>
            ) : (
              <>
                <strong>{ops.length} alteração(ões) por salvar</strong>
                <ul className="m-0 mt-[2px] max-h-[72px] list-disc overflow-auto pl-[18px] text-pbi-muted">
                  {ops.map((op) => (
                    <li key={JSON.stringify(op)}>{descreveOperacao(op, nomeDaTela)}</li>
                  ))}
                </ul>
              </>
            )}
            {salva.error ? (
              <div className="mt-[4px]">
                <Erro>
                  {(salva.error as Error).message} — o que já tinha gravado ficou; o resto continua
                  pendente.
                </Erro>
              </div>
            ) : null}
          </div>
          <Botao
            variante="secundario"
            disabled={travado || (ops.length === 0 && rascunho.novos.length === 0)}
            onClick={() => {
              salva.reset();
              descarta();
            }}
          >
            Descartar
          </Botao>
          <Botao
            variante="primario"
            disabled={travado || ops.length === 0}
            onClick={() => salva.mutate(ops)}
          >
            {travado ? 'Salvando…' : 'Salvar alterações'}
          </Botao>
        </div>
      </Cartao>

      {m.pedidos.length > 0 ? (
        <Cartao titulo={`Pedidos de acesso (${m.pedidos.length})`} largo>
          {dispensa.error ? <Erro>{(dispensa.error as Error).message}</Erro> : null}
          <ul className="m-0 grid list-none gap-[4px] p-0 text-[0.76rem]">
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
                  disabled={travado}
                  onClick={() => muda((r) => comPessoa(r, p.email))}
                >
                  Dar abas
                </Botao>
                <Botao
                  variante="secundario"
                  disabled={dispensa.isPending}
                  onClick={() => dispensa.mutate(p.email)}
                >
                  Dispensar
                </Botao>
              </li>
            ))}
          </ul>
        </Cartao>
      ) : null}

      {souAdmin ? <SessoesAtivas eu={m.eu.usuario} /> : null}
    </>
  );
}
