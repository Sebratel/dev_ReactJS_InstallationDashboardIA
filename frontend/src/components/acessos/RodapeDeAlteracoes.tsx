// O rodapé da matriz: o que muda ao salvar, e os botões de salvar e descartar.
//
// Fica preso embaixo do cartão enquanto a matriz rola — o botão de salvar e a lista do
// que muda estão sempre à vista.

import { descreveOperacao, type OperacaoDeAcesso } from '../../utils/rascunhoDeAcessos.ts';
import { Botao } from '../ui/Botao.tsx';
import { Erro } from '../ui/Cartao.tsx';

interface RodapeDeAlteracoesProps {
  operacoesPendentes: readonly OperacaoDeAcesso[];
  /** Há pessoa adicionada no rascunho que ainda não virou operação. */
  temPessoaNova: boolean;
  salvando: boolean;
  erro: Error | null;
  nomeDaTela: (id: string) => string;
  aoSalvar: () => void;
  aoDescartar: () => void;
}

function ListaDeAlteracoes({
  operacoes,
  nomeDaTela,
}: {
  operacoes: readonly OperacaoDeAcesso[];
  nomeDaTela: (id: string) => string;
}) {
  if (operacoes.length === 0) {
    return <span className="text-pbi-muted">Nenhuma alteração pendente.</span>;
  }
  return (
    <>
      <strong>{operacoes.length} alteração(ões) por salvar</strong>
      <ul className="m-0 mt-[2px] max-h-[72px] list-disc overflow-auto pl-[18px] text-pbi-muted">
        {operacoes.map((operacao) => (
          <li key={JSON.stringify(operacao)}>{descreveOperacao(operacao, nomeDaTela)}</li>
        ))}
      </ul>
    </>
  );
}

export function RodapeDeAlteracoes({
  operacoesPendentes,
  temPessoaNova,
  salvando,
  erro,
  nomeDaTela,
  aoSalvar,
  aoDescartar,
}: RodapeDeAlteracoesProps) {
  const nadaParaDescartar = operacoesPendentes.length === 0 && !temPessoaNova;

  return (
    <div className="sticky bottom-0 left-0 mt-auto flex flex-none flex-wrap items-end gap-[8px] border-t border-pbi-borda bg-pbi-superficie pt-[6px] text-[0.74rem]">
      <div className="min-w-[240px] flex-1">
        <ListaDeAlteracoes operacoes={operacoesPendentes} nomeDaTela={nomeDaTela} />
        {erro ? (
          <div className="mt-[4px]">
            <Erro>{erro.message} — o que já tinha gravado ficou; o resto continua pendente.</Erro>
          </div>
        ) : null}
      </div>

      <Botao variante="secundario" disabled={salvando || nadaParaDescartar} onClick={aoDescartar}>
        Descartar
      </Botao>
      <Botao
        variante="primario"
        disabled={salvando || operacoesPendentes.length === 0}
        onClick={aoSalvar}
      >
        {salvando ? 'Salvando…' : 'Salvar alterações'}
      </Botao>
    </div>
  );
}
