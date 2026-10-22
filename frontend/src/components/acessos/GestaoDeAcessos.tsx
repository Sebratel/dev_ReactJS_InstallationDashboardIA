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
  definePerfilDaPessoa,
  dispensaPedido,
  pegaMatriz,
  reativaPessoa,
  suspendePessoa,
  type MatrizDeAcesso,
  type Papel,
} from '../../services/acessoService.ts';
import { ultimoAcessoNaTela } from '../../utils/inatividade.ts';
import { Selo } from '../ui/Selo.tsx';
import { HistoricoDeAcessos } from './HistoricoDeAcessos.tsx';
import { PerfisDeAcesso } from './PerfisDeAcesso.tsx';
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
import { SituacaoDaPessoa } from './SituacaoDaPessoa.tsx';
import { UsoDasTelas } from './UsoDasTelas.tsx';

export const CHAVE_ACESSOS = ['acessos'] as const;

export function GestaoDeAcessos() {
  const qc = useQueryClient();
  // Ao contrário do dado das páginas, a matriz não tem aviso do servidor quando muda: outra
  // aba do navegador, ou outro admin, salva e esta continuava mostrando quem já saiu (até
  // o F5). Reler ao abrir a aba e ao voltar o foco é barato — o GET lê a memória da API.
  const matrizQ = useQuery({
    queryKey: CHAVE_ACESSOS,
    queryFn: pegaMatriz,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const { rascunho, muda, conta, descarta } = useRascunhoDeAcessos();
  const [email, setEmail] = useState('');
  const [busca, setBusca] = useState('');
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const m = matrizQ.data;
  const ops = useMemo(() => (m ? operacoesDoRascunho(m, rascunho) : []), [m, rascunho]);
  useEffect(() => conta(ops.length), [ops.length, conta]);

  // As abas de QUEM ESTÁ LOGADO podem ter mudado junto, e remover pessoa derruba as
  // sessões dela no servidor (S2).
  const releLigadas = () => {
    void qc.invalidateQueries({ queryKey: chavesDeConsulta.dashboards });
    void qc.invalidateQueries({ queryKey: CHAVE_SESSOES });
    // O histórico também: a gravação acabou de entrar nele, e sem isto ele só aparecia
    // com F5 (22/10/2026). A matriz não: ela já vem na resposta de cada gravação.
    void qc.invalidateQueries({ queryKey: ['acessos-historico'] });
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
  // Ações no clique (perfil, suspensão, situação): a resposta já é a matriz relida.
  const aoAtualizar = (nova: MatrizDeAcesso) => {
    qc.setQueryData(CHAVE_ACESSOS, nova);
    releLigadas();
  };
  // Em massa: um pedido por pessoa, em ordem; o que gravou fica, mesmo se um falhar.
  const emMassa = useMutation({
    mutationFn: async (f: (email: string) => Promise<MatrizDeAcesso>) => {
      for (const e of selecionados) aoAtualizar(await f(e));
    },
    onSuccess: () => setSelecionados(new Set()),
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
  const perfis = m.perfis ?? [];
  const perfilDe = (id: string | null | undefined) => perfis.find((p) => p.id === id);
  const termo = busca.trim().toLowerCase();
  const visiveis = termo
    ? vista.pessoas.filter(
        (p) => p.email.includes(termo) || (p.senior?.nome ?? '').toLowerCase().includes(termo),
      )
    : vista.pessoas;
  const alterna = (e: string) =>
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(e)) novo.delete(e);
      else novo.add(e);
      return novo;
    });
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
      {m.senior ? <AvisoDaSenior m={m} /> : null}

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
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por e-mail ou nome"
            aria-label="Buscar pessoa"
            className="ml-auto w-[min(240px,100%)] rounded-[2px] border border-pbi-borda bg-pbi-superficie px-[8px] py-[4px]"
          />
        </form>

        {selecionados.size > 0 ? (
          <div className="flex flex-none flex-wrap items-center gap-[8px] rounded-[2px] bg-pbi-aviso-bg px-[8px] py-[6px] text-[0.74rem]">
            <strong>{selecionados.size} selecionada(s)</strong>
            <select
              value=""
              disabled={emMassa.isPending}
              aria-label="Aplicar perfil às selecionadas"
              onChange={(e) => {
                const perfil = e.target.value === '-' ? null : e.target.value;
                if (e.target.value) emMassa.mutate((x) => definePerfilDaPessoa(x, perfil));
              }}
            >
              <option value="">Aplicar perfil…</option>
              {perfis.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
              <option value="-">(sem perfil)</option>
            </select>
            <Botao
              variante="secundario"
              disabled={emMassa.isPending}
              onClick={() => {
                const motivo = window.prompt('Motivo da suspensão (vai para a tela de login):');
                if (motivo !== null) emMassa.mutate((x) => suspendePessoa(x, motivo.trim(), null));
              }}
            >
              Suspender
            </Botao>
            <Botao
              variante="secundario"
              disabled={emMassa.isPending}
              onClick={() => emMassa.mutate(reativaPessoa)}
            >
              Reativar
            </Botao>
            <Botao
              variante="secundario"
              disabled={emMassa.isPending}
              onClick={() => setSelecionados(new Set())}
            >
              Limpar seleção
            </Botao>
            {emMassa.error ? (
              <Erro>{(emMassa.error as Error).message} — as anteriores ficaram gravadas.</Erro>
            ) : null}
          </div>
        ) : null}

        <table className="w-full border-collapse text-[0.76rem]">
          <thead className="sticky top-0 z-10 bg-pbi-fundo">
            <tr>
              <th className="w-[1%] px-[6px] py-[6px]">
                <input
                  type="checkbox"
                  className="w-auto"
                  aria-label="Selecionar todas as visíveis"
                  checked={
                    visiveis.length > 0 &&
                    visiveis.every((p) => p.fixo || p.nova || selecionados.has(p.email))
                  }
                  onChange={(e) =>
                    setSelecionados(
                      e.target.checked
                        ? new Set(visiveis.filter((p) => !p.fixo && !p.nova).map((p) => p.email))
                        : new Set(),
                    )
                  }
                />
              </th>
              <th className="px-[8px] py-[6px] text-left">Pessoa</th>
              <th className="px-[8px] py-[6px] text-left">Papel</th>
              <th className="px-[8px] py-[6px] text-left">Perfil</th>
              <th className="px-[8px] py-[6px] text-left">Situação</th>
              <th className="px-[8px] py-[6px] text-left">Último acesso</th>
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
            {visiveis.map((p) => {
              const veTudo = p.papel === 'admin';
              const doPerfil = perfilDe(p.perfil);
              const peloPerfil = (tela: string) => Boolean(doPerfil?.telas.includes(tela));
              const ultimo = ultimoAcessoNaTela(p.ultimoAcesso);
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
                  <td className="px-[6px] py-[4px]">
                    <input
                      type="checkbox"
                      className="w-auto"
                      aria-label={`Selecionar ${p.email}`}
                      disabled={p.fixo || p.nova}
                      checked={selecionados.has(p.email)}
                      onChange={() => alterna(p.email)}
                    />
                  </td>
                  <td className="px-[8px] py-[4px] whitespace-nowrap">
                    {p.email}
                    {p.nova ? <span className="ml-[6px] text-pbi-muted">(nova)</span> : null}
                    {p.senior?.nome ? (
                      <div className="text-[0.66rem] text-pbi-muted">{p.senior.nome}</div>
                    ) : null}
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
                  <td className="px-[8px] py-[4px]">
                    {p.nova || p.fixo ? (
                      <span className="text-pbi-muted">—</span>
                    ) : (
                      <select
                        value={p.perfil ?? ''}
                        disabled={emMassa.isPending || p.removida}
                        aria-label={`Perfil de ${p.email}`}
                        onChange={(e) =>
                          void definePerfilDaPessoa(p.email, e.target.value || null).then(
                            aoAtualizar,
                          )
                        }
                      >
                        <option value="">(sem perfil)</option>
                        {perfis.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.nome}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-[8px] py-[4px] whitespace-nowrap">
                    {p.nova ? (
                      <span className="text-pbi-muted">ao salvar</span>
                    ) : (
                      <SituacaoDaPessoa
                        pessoa={p}
                        podeAgir={souAdmin || p.papel === 'viewer'}
                        aoAtualizar={aoAtualizar}
                      />
                    )}
                  </td>
                  <td
                    className="px-[8px] py-[4px] whitespace-nowrap"
                    title={
                      p.ultimoAcesso
                        ? new Date(p.ultimoAcesso).toLocaleString('pt-BR')
                        : 'Nenhum acesso registrado'
                    }
                  >
                    {p.nova ? null : <Selo tom={ultimo.tom}>{ultimo.texto}</Selo>}
                  </td>
                  {vista.telas.map((t) => (
                    <td key={t.id} className="px-[6px] py-[4px] text-center">
                      <input
                        type="checkbox"
                        checked={
                          veTudo || t.modo === 'todos' || p.telas.includes(t.id) || peloPerfil(t.id)
                        }
                        disabled={
                          veTudo || t.modo === 'todos' || p.removida || travado || peloPerfil(t.id)
                        }
                        title={
                          veTudo
                            ? 'Admin abre todas as abas'
                            : t.modo === 'todos'
                              ? 'Aba aberta para todos'
                              : peloPerfil(t.id)
                                ? `Vem do perfil ${doPerfil!.nome}`
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

      <UsoDasTelas />

      <PerfisDeAcesso m={m} aoAtualizar={aoAtualizar} />

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
                {perfis.length > 0 ? (
                  <select
                    value=""
                    className="ml-auto"
                    aria-label={`Aprovar ${p.email} com um perfil`}
                    onChange={(e) => {
                      if (e.target.value) {
                        void definePerfilDaPessoa(p.email, e.target.value).then(aoAtualizar);
                      }
                    }}
                  >
                    <option value="">Aprovar com perfil…</option>
                    {perfis.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nome}
                      </option>
                    ))}
                  </select>
                ) : null}
                <Botao
                  variante="secundario"
                  className={perfis.length > 0 ? undefined : 'ml-auto'}
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

      <HistoricoDeAcessos />
    </>
  );
}

/** O estado da Senior em cima da matriz: em `observar`, quantos ela barraria. */
function AvisoDaSenior({ m }: { m: MatrizDeAcesso }) {
  const s = m.senior!;
  const seriam = m.pessoas.filter((p) => p.bloqueio?.origem === 'senior' && !p.barrada).length;
  if (!s.carregada) {
    return (
      <Aviso>
        A Senior ainda não foi lida{s.falhou ? ` (${s.falhou})` : ''} — por enquanto ela não barra
        ninguém.
      </Aviso>
    );
  }
  return (
    <>
      {s.falhou ? (
        <Aviso>
          A última leitura da Senior falhou ({s.falhou}); vale a de{' '}
          {s.lidaEm ? new Date(s.lidaEm).toLocaleString('pt-BR') : '—'}.
        </Aviso>
      ) : null}
      {s.modo === 'observar' ? (
        <Aviso>
          Senior em modo observar: {seriam} pessoa(s) seriam barradas (selo amarelo na coluna
          Situação). Confira e, quando estiver certo, troque SENIOR_MODO para bloquear na stack.
        </Aviso>
      ) : null}
    </>
  );
}
