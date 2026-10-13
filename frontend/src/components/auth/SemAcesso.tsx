// A conta entrou, mas `permissoes.yaml` não libera nenhuma aba para ela. Mesmo cartão do
// `Login.tsx`: para quem vê, é o mesmo portão, um passo adiante. Diz o e-mail porque é
// ele que o administrador precisa pôr no arquivo — e oferece sair, para trocar de conta.

import { Botao } from '../ui/Botao.tsx';

type SemAcessoProps = {
  usuario: string | null;
  aoSair: () => void;
};

export function SemAcesso({ usuario, aoSair }: SemAcessoProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-pbi-fundo">
      <div className="flex max-w-[360px] flex-col items-center gap-[10px] rounded-[2px] border border-pbi-borda bg-pbi-superficie px-[36px] py-[32px] text-center">
        <h1 className="mt-[4px] mb-0 text-[1.05rem] text-pbi-ink">Sem acesso ao dashboard</h1>
        <p className="mt-0 mb-[8px] text-[0.8rem] text-pbi-muted">
          {usuario ? (
            <>
              A conta <strong className="text-pbi-ink">{usuario}</strong> ainda não tem nenhuma aba
              liberada.
            </>
          ) : (
            'Sua conta ainda não tem nenhuma aba liberada.'
          )}{' '}
          Peça acesso a um administrador do dashboard.
        </p>
        <Botao variante="primario" onClick={aoSair} className="mt-[8px] w-[280px]">
          Sair e trocar de conta
        </Botao>
      </div>
    </div>
  );
}
