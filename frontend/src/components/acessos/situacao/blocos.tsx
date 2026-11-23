// Os três blocos do diálogo de situação de uma pessoa: suspensão manual, acesso
// temporário e exceção à Senior.
//
// Cada um é um `fieldset` que se desabilita inteiro enquanto a gravação corre ou quando
// quem abriu não pode agir — por isso a prop `travado` em todos. As ações valem no
// clique, como "Dispensar" pedido: são ações, não edições da matriz, e não passam pelo
// rascunho.

import { useState, type ReactNode } from 'react';
import {
  defineExcecaoSenior,
  defineValidade,
  reativaPessoa,
  suspendePessoa,
  type MatrizDeAcesso,
  type PessoaDeAcesso,
} from '../../../services/acessoService.ts';
import { Botao } from '../../ui/Botao.tsx';
import { Nota } from '../../ui/Nota.tsx';

/** O `<input type="date">` dá o dia; o prazo vale até o fim dele, no fuso do RS. */
export const fimDoDia = (dia: string) => (dia ? `${dia}T23:59:59-03:00` : null);

/** Quem executa uma ação de acesso e devolve a matriz relida. */
export type ExecutaAcao = (acao: () => Promise<MatrizDeAcesso>) => void;

function BlocoDeAcao({
  titulo,
  travado,
  children,
}: {
  titulo: string;
  travado: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset className="m-0 grid gap-[6px] border border-pbi-borda p-[8px]" disabled={travado}>
      <legend className="px-[4px] font-semibold">{titulo}</legend>
      {children}
    </fieldset>
  );
}

/**
 * Suspensão manual — para casos que a Senior não conhece (saiu do projeto, auditoria).
 * Férias e afastamentos não precisam disto: vêm da Senior sozinhos.
 */
export function BlocoDeSuspensao({
  pessoa,
  suspensa,
  travado,
  executa,
}: {
  pessoa: PessoaDeAcesso;
  suspensa: boolean;
  travado: boolean;
  executa: ExecutaAcao;
}) {
  const [motivo, setMotivo] = useState('');
  const [ate, setAte] = useState('');

  return (
    <BlocoDeAcao titulo="Suspensão manual (opcional)" travado={travado}>
      {suspensa ? (
        <div className="flex flex-wrap items-center gap-[8px]">
          <span>{pessoa.bloqueio?.motivo}</span>
          <Botao variante="primario" onClick={() => executa(() => reativaPessoa(pessoa.email))}>
            Reativar
          </Botao>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-[8px]">
          <label className="grid gap-[2px]">
            Motivo
            <input
              value={motivo}
              maxLength={200}
              onChange={(evento) => setMotivo(evento.target.value)}
              placeholder="ex.: afastado do projeto"
            />
          </label>
          <label className="grid gap-[2px]">
            Até (opcional)
            <input type="date" value={ate} onChange={(evento) => setAte(evento.target.value)} />
          </label>
          <Botao
            variante="primario"
            onClick={() =>
              executa(() => suspendePessoa(pessoa.email, motivo.trim(), fimDoDia(ate)))
            }
          >
            Suspender
          </Botao>
        </div>
      )}
      <Nota>
        Para casos que a Senior não conhece (saiu do projeto, auditoria). Férias e afastamentos não
        precisam disto: vêm da Senior sozinhos. Suspender derruba as sessões dela na hora.
      </Nota>
    </BlocoDeAcao>
  );
}

/** Acesso temporário: depois do dia escolhido a pessoa não entra mais. */
export function BlocoDeValidade({
  pessoa,
  travado,
  executa,
}: {
  pessoa: PessoaDeAcesso;
  travado: boolean;
  executa: ExecutaAcao;
}) {
  const [validade, setValidade] = useState(pessoa.regra?.expiraEm?.slice(0, 10) ?? '');

  return (
    <BlocoDeAcao titulo="Acesso temporário" travado={travado}>
      <div className="flex flex-wrap items-end gap-[8px]">
        <label className="grid gap-[2px]">
          Acesso até
          <input
            type="date"
            value={validade}
            onChange={(evento) => setValidade(evento.target.value)}
          />
        </label>
        <Botao
          variante="primario"
          disabled={!validade}
          onClick={() => executa(() => defineValidade(pessoa.email, fimDoDia(validade)))}
        >
          Salvar prazo
        </Botao>
        {pessoa.regra?.expiraEm ? (
          <Botao
            variante="secundario"
            onClick={() => {
              setValidade('');
              executa(() => defineValidade(pessoa.email, null));
            }}
          >
            Sem prazo
          </Botao>
        ) : null}
      </div>
      <Nota>Depois do dia escolhido, a pessoa não entra mais — sem ninguém precisar lembrar.</Nota>
    </BlocoDeAcao>
  );
}

/** Exceção à Senior: consultor, terceiro, conta de serviço. */
export function BlocoDaSenior({
  pessoa,
  travado,
  executa,
}: {
  pessoa: PessoaDeAcesso;
  travado: boolean;
  executa: ExecutaAcao;
}) {
  return (
    <BlocoDeAcao titulo="Senior (automático)" travado={travado}>
      <label className="flex items-center gap-[6px]">
        <input
          type="checkbox"
          className="w-auto"
          checked={Boolean(pessoa.regra?.excecaoSenior)}
          onChange={(evento) => {
            const ligada = evento.target.checked;
            executa(() => defineExcecaoSenior(pessoa.email, ligada));
          }}
        />
        Ignorar a Senior para esta pessoa (consultor, terceiro, conta de serviço)
      </label>
      <Nota>
        Férias, atestado, licença e desligamento barram sozinhos e liberam quando a Senior voltar a
        dizer Trabalhando. Com a exceção ligada, a Senior é ignorada; suspensão e prazo continuam
        valendo.
      </Nota>
    </BlocoDeAcao>
  );
}

/** O que a Senior sabe desta pessoa — ou por que ela não sabe nada. */
export function LinhaDaSenior({ pessoa }: { pessoa: PessoaDeAcesso }) {
  if (pessoa.senior === undefined) {
    return <Nota como="p">Senior: sem leitura da Senior no servidor.</Nota>;
  }
  if (pessoa.senior === null) {
    return <Nota como="p">Senior: e-mail não encontrado entre os colaboradores.</Nota>;
  }
  const { nome, matricula, situacao } = pessoa.senior;
  return (
    <Nota como="p">
      Senior: {nome || '—'} · matrícula {matricula || '—'} · {situacao}
    </Nota>
  );
}
