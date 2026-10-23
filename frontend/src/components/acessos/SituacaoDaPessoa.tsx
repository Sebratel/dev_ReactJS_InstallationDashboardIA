// A situação de uma pessoa na aba PERMISSÕES (20/10/2026): o selo diz se ela entra e por
// quê (Senior, suspensão, validade), e o clique abre o que o admin pode fazer — suspender,
// reativar, dar prazo ao acesso e abrir exceção à Senior. Valem no clique, como "Dispensar"
// pedido: são ações, não edições da matriz, e não passam pelo rascunho.

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  defineExcecaoSenior,
  defineValidade,
  reativaPessoa,
  suspendePessoa,
  type MatrizDeAcesso,
  type PessoaDeAcesso,
} from '../../services/acessoService.ts';
import { Botao } from '../ui/Botao.tsx';
import { Erro } from '../ui/Cartao.tsx';
import { AcoesDoDialogo, Dialogo } from '../ui/Dialogo.tsx';
import { Nota } from '../ui/Nota.tsx';
import { Selo, type TomDeSelo } from '../ui/Selo.tsx';

const dataBr = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
/** O `<input type="date">` dá o dia; o prazo vale até o fim dele, no fuso do RS. */
const fimDoDia = (dia: string) => (dia ? `${dia}T23:59:59-03:00` : null);

/** O selo: o que vale agora, do mais grave para o mais leve. */
export function seloDaPessoa(p: PessoaDeAcesso): { tom: TomDeSelo; texto: string } {
  if (p.fixo) return { tom: 'apagado', texto: 'Fixo (.env)' };
  const b = p.bloqueio;
  if (b && p.barrada) {
    if (b.origem === 'manual') return { tom: 'ruim', texto: 'Suspensa' };
    if (b.origem === 'validade') return { tom: 'ruim', texto: 'Acesso expirou' };
    return { tom: 'ruim', texto: p.senior ? p.senior.situacao : 'Fora da Senior' };
  }
  if (b)
    return {
      tom: 'neutro',
      texto: `Seria barrada: ${p.senior ? p.senior.situacao : 'fora da Senior'}`,
    };
  if (p.regra?.expiraEm) return { tom: 'neutro', texto: `Até ${dataBr(p.regra.expiraEm)}` };
  if (p.regra?.excecaoSenior) return { tom: 'ok', texto: 'Exceção à Senior' };
  return { tom: 'ok', texto: p.senior?.situacao ?? 'Liberada' };
}

export function SituacaoDaPessoa(props: {
  pessoa: PessoaDeAcesso;
  /** Admin mexe em qualquer um; dev, só em quem não tem papel (o servidor confere). */
  podeAgir: boolean;
  aoAtualizar: (m: MatrizDeAcesso) => void;
}) {
  const p = props.pessoa;
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [ate, setAte] = useState('');
  const [validade, setValidade] = useState(p.regra?.expiraEm?.slice(0, 10) ?? '');
  const acao = useMutation({
    mutationFn: (f: () => Promise<MatrizDeAcesso>) => f(),
    onSuccess: (m) => props.aoAtualizar(m),
  });
  const selo = seloDaPessoa(p);
  const suspensa = Boolean(p.regra?.suspensa) && p.bloqueio?.origem === 'manual';

  return (
    <>
      <button
        type="button"
        className="cursor-pointer border-0 bg-transparent p-0 disabled:cursor-default"
        onClick={() => setAberto(true)}
        disabled={p.fixo}
        title={p.bloqueio?.motivo ?? 'Situação e ações de acesso'}
        aria-label={`Situação de ${p.email}: ${selo.texto}`}
      >
        <Selo tom={selo.tom}>{selo.texto}</Selo>
      </button>
      {aberto ? (
        <Dialogo
          titulo={`Acesso de ${p.email}`}
          aoFechar={() => setAberto(false)}
          rodape={
            <AcoesDoDialogo>
              <Botao variante="secundario" onClick={() => setAberto(false)}>
                Fechar
              </Botao>
            </AcoesDoDialogo>
          }
        >
          <div className="grid gap-[12px] text-[0.78rem]">
            {p.bloqueio ? (
              <p className="m-0">
                <strong>
                  {p.barrada ? 'Barrada agora: ' : 'A Senior barraria (modo observar): '}
                </strong>
                {p.bloqueio.motivo}
              </p>
            ) : (
              <p className="m-0">Pode entrar.</p>
            )}
            <Nota como="p">
              Senior:{' '}
              {p.senior === undefined
                ? 'sem leitura da Senior no servidor.'
                : p.senior === null
                  ? 'e-mail não encontrado entre os colaboradores.'
                  : `${p.senior.nome || '—'} · matrícula ${p.senior.matricula || '—'} · ${p.senior.situacao}`}
            </Nota>
            {acao.error ? <Erro>{(acao.error as Error).message}</Erro> : null}

            <fieldset
              className="m-0 grid gap-[6px] border border-pbi-borda p-[8px]"
              disabled={!props.podeAgir || acao.isPending}
            >
              <legend className="px-[4px] font-semibold">Suspensão manual (opcional)</legend>
              {suspensa ? (
                <div className="flex flex-wrap items-center gap-[8px]">
                  <span>{p.bloqueio?.motivo}</span>
                  <Botao
                    variante="primario"
                    onClick={() => acao.mutate(() => reativaPessoa(p.email))}
                  >
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
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder="ex.: afastado do projeto"
                    />
                  </label>
                  <label className="grid gap-[2px]">
                    Até (opcional)
                    <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
                  </label>
                  <Botao
                    variante="primario"
                    onClick={() =>
                      acao.mutate(() => suspendePessoa(p.email, motivo.trim(), fimDoDia(ate)))
                    }
                  >
                    Suspender
                  </Botao>
                </div>
              )}
              <Nota>
                Para casos que a Senior não conhece (saiu do projeto, auditoria). Férias e
                afastamentos não precisam disto: vêm da Senior sozinhos. Suspender derruba as
                sessões dela na hora.
              </Nota>
            </fieldset>

            <fieldset
              className="m-0 grid gap-[6px] border border-pbi-borda p-[8px]"
              disabled={!props.podeAgir || acao.isPending}
            >
              <legend className="px-[4px] font-semibold">Acesso temporário</legend>
              <div className="flex flex-wrap items-end gap-[8px]">
                <label className="grid gap-[2px]">
                  Acesso até
                  <input
                    type="date"
                    value={validade}
                    onChange={(e) => setValidade(e.target.value)}
                  />
                </label>
                <Botao
                  variante="primario"
                  disabled={!validade}
                  onClick={() => acao.mutate(() => defineValidade(p.email, fimDoDia(validade)))}
                >
                  Salvar prazo
                </Botao>
                {p.regra?.expiraEm ? (
                  <Botao
                    variante="secundario"
                    onClick={() => {
                      setValidade('');
                      acao.mutate(() => defineValidade(p.email, null));
                    }}
                  >
                    Sem prazo
                  </Botao>
                ) : null}
              </div>
              <Nota>
                Depois do dia escolhido, a pessoa não entra mais — sem ninguém precisar lembrar.
              </Nota>
            </fieldset>

            <fieldset
              className="m-0 grid gap-[6px] border border-pbi-borda p-[8px]"
              disabled={!props.podeAgir || acao.isPending}
            >
              <legend className="px-[4px] font-semibold">Senior (automático)</legend>
              <label className="flex items-center gap-[6px]">
                <input
                  type="checkbox"
                  className="w-auto"
                  checked={Boolean(p.regra?.excecaoSenior)}
                  onChange={(e) => {
                    const ligada = e.target.checked;
                    acao.mutate(() => defineExcecaoSenior(p.email, ligada));
                  }}
                />
                Ignorar a Senior para esta pessoa (consultor, terceiro, conta de serviço)
              </label>
              <Nota>
                Férias, atestado, licença e desligamento barram sozinhos e liberam quando a Senior
                voltar a dizer Trabalhando. Com a exceção ligada, a Senior é ignorada; suspensão e
                prazo continuam valendo.
              </Nota>
            </fieldset>
            {!props.podeAgir ? (
              <Nota como="p">Só administrador barra ou libera quem tem papel.</Nota>
            ) : null}
          </div>
        </Dialogo>
      ) : null}
    </>
  );
}
