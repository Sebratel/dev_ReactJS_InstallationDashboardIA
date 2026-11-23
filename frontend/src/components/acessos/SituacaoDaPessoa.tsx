// A situação de uma pessoa na aba Configurações (20/10/2026): o selo diz se ela entra e
// por quê (Senior, suspensão, validade), e o clique abre o que o admin pode fazer —
// suspender, reativar, dar prazo ao acesso e abrir exceção à Senior. Valem no clique,
// como "Dispensar" pedido: são ações, não edições da matriz, e não passam pelo rascunho.
//
// Os três blocos do diálogo moram em `situacao/blocos.tsx`; aqui ficam o selo e a
// abertura do diálogo.

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { MatrizDeAcesso, PessoaDeAcesso } from '../../services/acessoService.ts';
import { Botao } from '../ui/Botao.tsx';
import { Erro } from '../ui/Cartao.tsx';
import { AcoesDoDialogo, Dialogo } from '../ui/Dialogo.tsx';
import { Nota } from '../ui/Nota.tsx';
import { Selo, type TomDeSelo } from '../ui/Selo.tsx';
import {
  BlocoDaSenior,
  BlocoDeSuspensao,
  BlocoDeValidade,
  LinhaDaSenior,
} from './situacao/blocos.tsx';

const dataBr = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

/** O selo: o que vale agora, do mais grave para o mais leve. */
export function seloDaPessoa(pessoa: PessoaDeAcesso): { tom: TomDeSelo; texto: string } {
  if (pessoa.fixo) return { tom: 'apagado', texto: 'Fixo (.env)' };

  const bloqueio = pessoa.bloqueio;
  const situacaoNaSenior = pessoa.senior?.situacao;
  if (bloqueio && pessoa.barrada) {
    if (bloqueio.origem === 'manual') return { tom: 'ruim', texto: 'Suspensa' };
    if (bloqueio.origem === 'validade') return { tom: 'ruim', texto: 'Acesso expirou' };
    return { tom: 'ruim', texto: situacaoNaSenior ?? 'Fora da Senior' };
  }
  if (bloqueio) {
    return {
      tom: 'neutro',
      texto: `Seria barrada: ${situacaoNaSenior ?? 'fora da Senior'}`,
    };
  }
  if (pessoa.regra?.expiraEm) {
    return { tom: 'neutro', texto: `Até ${dataBr(pessoa.regra.expiraEm)}` };
  }
  if (pessoa.regra?.excecaoSenior) return { tom: 'ok', texto: 'Exceção à Senior' };
  return { tom: 'ok', texto: situacaoNaSenior ?? 'Liberada' };
}

export function SituacaoDaPessoa({
  pessoa,
  podeAgir,
  aoAtualizar,
}: {
  pessoa: PessoaDeAcesso;
  /** Admin mexe em qualquer um; dev, só em quem não tem papel (o servidor confere). */
  podeAgir: boolean;
  aoAtualizar: (matriz: MatrizDeAcesso) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const acao = useMutation({
    mutationFn: (executa: () => Promise<MatrizDeAcesso>) => executa(),
    onSuccess: aoAtualizar,
  });
  const selo = seloDaPessoa(pessoa);

  return (
    <>
      <button
        type="button"
        className="cursor-pointer border-0 bg-transparent p-0 disabled:cursor-default"
        onClick={() => setAberto(true)}
        disabled={pessoa.fixo}
        title={pessoa.bloqueio?.motivo ?? 'Situação e ações de acesso'}
        aria-label={`Situação de ${pessoa.email}: ${selo.texto}`}
      >
        <Selo tom={selo.tom}>{selo.texto}</Selo>
      </button>

      {aberto ? (
        <DialogoDeSituacao
          pessoa={pessoa}
          podeAgir={podeAgir}
          gravando={acao.isPending}
          erro={acao.error}
          executa={(executa) => acao.mutate(executa)}
          aoFechar={() => setAberto(false)}
        />
      ) : null}
    </>
  );
}

function DialogoDeSituacao({
  pessoa,
  podeAgir,
  gravando,
  erro,
  executa,
  aoFechar,
}: {
  pessoa: PessoaDeAcesso;
  podeAgir: boolean;
  gravando: boolean;
  erro: Error | null;
  executa: (acao: () => Promise<MatrizDeAcesso>) => void;
  aoFechar: () => void;
}) {
  const travado = !podeAgir || gravando;
  const suspensaManualmente =
    Boolean(pessoa.regra?.suspensa) && pessoa.bloqueio?.origem === 'manual';

  return (
    <Dialogo
      titulo={`Acesso de ${pessoa.email}`}
      aoFechar={aoFechar}
      rodape={
        <AcoesDoDialogo>
          <Botao variante="secundario" onClick={aoFechar}>
            Fechar
          </Botao>
        </AcoesDoDialogo>
      }
    >
      <div className="grid gap-[12px] text-[0.78rem]">
        {pessoa.bloqueio ? (
          <p className="m-0">
            <strong>
              {pessoa.barrada ? 'Barrada agora: ' : 'A Senior barraria (modo observar): '}
            </strong>
            {pessoa.bloqueio.motivo}
          </p>
        ) : (
          <p className="m-0">Pode entrar.</p>
        )}

        <LinhaDaSenior pessoa={pessoa} />
        {erro ? <Erro>{erro.message}</Erro> : null}

        <BlocoDeSuspensao
          pessoa={pessoa}
          suspensa={suspensaManualmente}
          travado={travado}
          executa={executa}
        />
        <BlocoDeValidade pessoa={pessoa} travado={travado} executa={executa} />
        <BlocoDaSenior pessoa={pessoa} travado={travado} executa={executa} />

        {!podeAgir ? <Nota como="p">Só administrador barra ou libera quem tem papel.</Nota> : null}
      </div>
    </Dialogo>
  );
}
