// A seção "Usuários e acessos": a matriz pessoa × aba, mais os pedidos de acesso.
//
// Nada grava sozinho — o que a pessoa mexe fica no rascunho
// (`utils/rascunhoDeAcessos.ts`), a linha alterada fica marcada, e o rodapé diz o que
// vai mudar antes de "Salvar alterações". Perfil, situação, pedido dispensado e sessão
// derrubada continuam valendo no clique: são ações, não edições da matriz.

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  definePerfilDaPessoa,
  type MatrizDeAcesso,
  type Papel,
} from '../../services/acessoService.ts';
import { useRascunhoDeAcessos } from '../../store/rascunhoDeAcessosStore.ts';
import { nomeDaAba } from '../../utils/ordemDasTelas.ts';
import {
  alternaRemocao,
  comModo,
  comPapel,
  comPessoa,
  comTela,
  matrizComRascunho,
  operacoesDoRascunho,
} from '../../utils/rascunhoDeAcessos.ts';
import type { AcoesDeAcesso } from '../../hooks/useAcoesDeAcesso.ts';
import { Botao } from '../ui/Botao.tsx';
import { Aviso, Cartao } from '../ui/Cartao.tsx';
import { AcoesEmMassa } from './AcoesEmMassa.tsx';
import { AvisoDaSenior } from './AvisoDaSenior.tsx';
import { CabecalhoDaMatriz } from './CabecalhoDaMatriz.tsx';
import { LinhaDaMatriz } from './LinhaDaMatriz.tsx';
import { PedidosDeAcesso } from './PedidosDeAcesso.tsx';
import { RodapeDeAlteracoes } from './RodapeDeAlteracoes.tsx';

const EXPLICACAO_DA_MATRIZ =
  'Admin abre todas as abas. As demais contas abrem só o que estiver marcado — ou a aba em Todos. Toda mudança salva fica registrada com o seu e-mail.';

interface AbaDeUsuariosProps {
  matriz: MatrizDeAcesso;
  souAdmin: boolean;
  acoes: AcoesDeAcesso;
  emailsSelecionados: ReadonlySet<string>;
  aoMudarSelecao: (emails: ReadonlySet<string>) => void;
}

/** As pessoas que a busca deixa passar — por e-mail ou pelo nome vindo da Senior. */
function filtraPorBusca<T extends { email: string; senior?: { nome: string } | null }>(
  pessoas: readonly T[],
  busca: string,
): readonly T[] {
  const termo = busca.trim().toLowerCase();
  if (!termo) return pessoas;
  return pessoas.filter(
    (pessoa) =>
      pessoa.email.includes(termo) || (pessoa.senior?.nome ?? '').toLowerCase().includes(termo),
  );
}

export function AbaDeUsuarios({
  matriz,
  souAdmin,
  acoes,
  emailsSelecionados,
  aoMudarSelecao,
}: AbaDeUsuariosProps) {
  const { rascunho, muda, conta, descarta } = useRascunhoDeAcessos();
  const [emailNovo, setEmailNovo] = useState('');
  const [busca, setBusca] = useState('');

  const operacoesPendentes = useMemo(
    () => operacoesDoRascunho(matriz, rascunho),
    [matriz, rascunho],
  );
  useEffect(() => conta(operacoesPendentes.length), [operacoesPendentes.length, conta]);

  const vista = matrizComRascunho(matriz, rascunho);
  const perfis = matriz.perfis ?? [];
  const perfilPorId = (id: string | null | undefined) => perfis.find((perfil) => perfil.id === id);
  const pessoasVisiveis = filtraPorBusca(vista.pessoas, busca);
  const nomeDaTela = (id: string) =>
    nomeDaAba(matriz.telas.find((tela) => tela.id === id)?.nome ?? id);
  const travado = acoes.salva.isPending;

  const alternaSelecao = (email: string) => {
    const nova = new Set(emailsSelecionados);
    if (nova.has(email)) nova.delete(email);
    else nova.add(email);
    aoMudarSelecao(nova);
  };

  const adicionaPessoa = (evento: FormEvent) => {
    evento.preventDefault();
    muda((atual) => comPessoa(atual, emailNovo));
    setEmailNovo('');
  };

  const mudaPerfilDaPessoa = (email: string, perfil: string | null) => {
    void definePerfilDaPessoa(email, perfil).then(acoes.aoAtualizar);
  };

  return (
    <>
      {!matriz.banco.ok ? (
        <Aviso>
          O banco de acessos não respondeu na última leitura — o que aparece pode estar
          desatualizado.
        </Aviso>
      ) : null}
      {matriz.pedidos.length > 0 ? (
        <Aviso>
          {matriz.pedidos.length} pedido(s) de acesso esperando resposta — logo abaixo da matriz.
        </Aviso>
      ) : null}
      <AvisoDaSenior matriz={matriz} />

      <Cartao titulo="Acessos às abas" sub={EXPLICACAO_DA_MATRIZ} altura="matriz" largo>
        <form onSubmit={adicionaPessoa} className="flex flex-none gap-[6px]">
          <input
            type="email"
            value={emailNovo}
            onChange={(evento) => setEmailNovo(evento.target.value)}
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
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Buscar por e-mail ou nome"
            aria-label="Buscar pessoa"
            className="ml-auto w-[min(240px,100%)] rounded-[2px] border border-pbi-borda bg-pbi-superficie px-[8px] py-[4px]"
          />
        </form>

        <AcoesEmMassa
          quantidadeSelecionada={emailsSelecionados.size}
          perfisDisponiveis={perfis}
          gravando={acoes.emMassa.isPending}
          erro={acoes.emMassa.error}
          aoAplicarEmCadaPessoa={(acao) => acoes.emMassa.mutate(acao)}
          aoLimparSelecao={() => aoMudarSelecao(new Set())}
        />

        <table className="w-full border-collapse text-[0.76rem]">
          <CabecalhoDaMatriz
            telas={vista.telas}
            pessoasVisiveis={pessoasVisiveis}
            emailsSelecionados={emailsSelecionados}
            travado={travado}
            aoSelecionarTodas={(emails) => aoMudarSelecao(new Set(emails))}
            aoMudarModoDaTela={(tela, aberta) =>
              muda((atual) => comModo(matriz, atual, tela, aberta ? 'todos' : 'lista'))
            }
          />
          <tbody>
            {pessoasVisiveis.map((pessoa) => (
              <LinhaDaMatriz
                key={pessoa.email}
                pessoa={pessoa}
                telas={vista.telas}
                perfilDaPessoa={perfilPorId(pessoa.perfil)}
                perfisDisponiveis={perfis}
                souAdmin={souAdmin}
                travado={travado}
                gravandoEmMassa={acoes.emMassa.isPending}
                selecionada={emailsSelecionados.has(pessoa.email)}
                aoSelecionar={alternaSelecao}
                aoMudarPapel={(email, papel: Papel) =>
                  muda((atual) => comPapel(matriz, atual, email, papel))
                }
                aoMudarPerfil={mudaPerfilDaPessoa}
                aoMarcarTela={(email, tela, marcada) =>
                  muda((atual) => comTela(matriz, atual, email, tela, marcada))
                }
                aoAlternarRemocao={(email) => muda((atual) => alternaRemocao(matriz, atual, email))}
                aoAtualizarMatriz={acoes.aoAtualizar}
              />
            ))}
          </tbody>
        </table>

        <RodapeDeAlteracoes
          operacoesPendentes={operacoesPendentes}
          temPessoaNova={rascunho.novos.length > 0}
          salvando={travado}
          erro={acoes.salva.error}
          nomeDaTela={nomeDaTela}
          aoSalvar={() => acoes.salva.mutate(operacoesPendentes)}
          aoDescartar={() => {
            acoes.salva.reset();
            descarta();
          }}
        />
      </Cartao>

      <PedidosDeAcesso
        pedidos={matriz.pedidos}
        perfisDisponiveis={perfis}
        travado={travado}
        dispensando={acoes.dispensa.isPending}
        erro={acoes.dispensa.error}
        aoAprovarComPerfil={acoes.aoAtualizar}
        aoDarAbas={(email) => muda((atual) => comPessoa(atual, email))}
        aoDispensar={(email) => acoes.dispensa.mutate(email)}
      />
    </>
  );
}
