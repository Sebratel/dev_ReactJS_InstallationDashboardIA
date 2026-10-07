// O diálogo dos filtros: faixa bordô com o título e o fechar, corpo que rola e rodapé.
//
// **DIÁLOGO, NÃO POPOVER.** Popover ancorado dentro de contêiner com rolagem é cortado
// pela borda dele, e a lista interna rolando dentro de um painel rolando empilha três
// recortes para escolher um item. Aqui é portal no `body`, centralizado: nada recorta,
// cabe grade de 2 colunas, e há busca e rodapé de confirmação. Clicar no fundo fecha.

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { BotaoDeIcone } from './BotaoDeIcone.tsx';

export function Dialogo(props: {
  titulo: string;
  aoFechar: () => void;
  rodape: ReactNode;
  children: ReactNode;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-[color-mix(in_srgb,var(--pbi-ink)_45%,transparent)] p-[24px]"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.aoFechar();
      }}
    >
      <div
        className="flex max-h-[min(70vh,560px)] w-[min(560px,100%)] flex-col overflow-hidden rounded-[2px] border border-pbi-borda bg-pbi-superficie"
        role="dialog"
        aria-modal="true"
        aria-label={props.titulo}
      >
        <div className="flex flex-[0_0_auto] items-center gap-[10px] bg-pbi-primary px-[10px] py-[6px] text-pbi-sobre-primary">
          <h3 className="m-0 text-[0.76rem] font-bold">{props.titulo}</h3>
          <BotaoDeIcone tom="primaria" onClick={props.aoFechar} title="Fechar">
            <X size={13} />
          </BotaoDeIcone>
        </div>
        <div className="flex min-h-0 flex-[1_1_auto] flex-col gap-[8px] overflow-auto p-[10px]">
          {props.children}
        </div>
        <div className="flex flex-[0_0_auto] items-center gap-[8px] border-t border-pbi-borda px-[10px] py-[8px]">
          {props.rodape}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Os botões do rodapé (Todos, Limpar, Aplicar), encostados à direita. */
export function AcoesDoDialogo({ children }: { children: ReactNode }) {
  return <div className="ml-auto flex gap-[6px]">{children}</div>;
}
