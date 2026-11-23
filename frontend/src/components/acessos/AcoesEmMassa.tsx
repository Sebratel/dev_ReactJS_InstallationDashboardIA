// A faixa que aparece quando há pessoas marcadas na matriz: aplicar perfil, suspender,
// reativar, limpar a seleção.
//
// Cada ação é um pedido por pessoa, em ordem — o que gravou fica, mesmo se um falhar, e
// é isso que a mensagem de erro diz.

import {
  definePerfilDaPessoa,
  reativaPessoa,
  suspendePessoa,
  type MatrizDeAcesso,
  type PerfilDeAcesso,
} from '../../services/acessoService.ts';
import { Botao } from '../ui/Botao.tsx';
import { Erro } from '../ui/Cartao.tsx';

/** O valor da opção "(sem perfil)" — `''` já é o placeholder do seletor. */
const SEM_PERFIL = '-';

interface AcoesEmMassaProps {
  quantidadeSelecionada: number;
  perfisDisponiveis: readonly PerfilDeAcesso[];
  gravando: boolean;
  erro: Error | null;
  aoAplicarEmCadaPessoa: (acao: (email: string) => Promise<MatrizDeAcesso>) => void;
  aoLimparSelecao: () => void;
}

export function AcoesEmMassa({
  quantidadeSelecionada,
  perfisDisponiveis,
  gravando,
  erro,
  aoAplicarEmCadaPessoa,
  aoLimparSelecao,
}: AcoesEmMassaProps) {
  if (quantidadeSelecionada === 0) return null;

  const aplicaPerfilEscolhido = (valor: string) => {
    if (!valor) return;
    const perfil = valor === SEM_PERFIL ? null : valor;
    aoAplicarEmCadaPessoa((email) => definePerfilDaPessoa(email, perfil));
  };

  const suspendeComMotivo = () => {
    const motivo = window.prompt('Motivo da suspensão (vai para a tela de login):');
    if (motivo === null) return;
    aoAplicarEmCadaPessoa((email) => suspendePessoa(email, motivo.trim(), null));
  };

  return (
    <div className="flex flex-none flex-wrap items-center gap-[8px] rounded-[2px] bg-pbi-aviso-bg px-[8px] py-[6px] text-[0.74rem]">
      <strong>{quantidadeSelecionada} selecionada(s)</strong>

      <select
        value=""
        disabled={gravando}
        aria-label="Aplicar perfil às selecionadas"
        onChange={(evento) => aplicaPerfilEscolhido(evento.target.value)}
      >
        <option value="">Aplicar perfil…</option>
        {perfisDisponiveis.map((perfil) => (
          <option key={perfil.id} value={perfil.id}>
            {perfil.nome}
          </option>
        ))}
        <option value={SEM_PERFIL}>(sem perfil)</option>
      </select>

      <Botao variante="secundario" disabled={gravando} onClick={suspendeComMotivo}>
        Suspender
      </Botao>
      <Botao
        variante="secundario"
        disabled={gravando}
        onClick={() => aoAplicarEmCadaPessoa(reativaPessoa)}
      >
        Reativar
      </Botao>
      <Botao variante="secundario" disabled={gravando} onClick={aoLimparSelecao}>
        Limpar seleção
      </Botao>

      {erro ? <Erro>{erro.message} — as anteriores ficaram gravadas.</Erro> : null}
    </div>
  );
}
