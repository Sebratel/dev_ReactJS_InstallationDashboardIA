// Um filtro da barra: o nome da coluna EM CIMA e, embaixo, o botão que abre o diálogo
// com o resumo da escolha ("todos", o valor, "3 selecionados") — a forma medida no BY
// (09/09/2026), não os dois lado a lado numa linha só. A caixa do botão herda borda e
// fundo de `button` em `@layer base`.

import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn.ts';

/** O nome do filtro, pequeno e em maiúsculas — também o da fileira de chips. */
export function RotuloDeFiltro({ children }: { children: ReactNode }) {
  return (
    <span className="text-[0.6rem] font-extrabold tracking-[0.08em] whitespace-nowrap text-pbi-muted uppercase">
      {children}
    </span>
  );
}

export function GatilhoDoFiltro(props: {
  rotulo: string;
  /** "todos", o valor escolhido, ou "N selecionados". */
  resumo: string;
  /** Quantos valores estão marcados; com 0 o botão fica neutro e sem contador. */
  marcados: number;
  aberto: boolean;
  aoClicar: () => void;
  title: string;
  /** O diálogo, quando aberto. */
  children?: ReactNode;
}) {
  return (
    <div className="relative flex min-w-[130px] flex-col items-stretch gap-[3px]">
      <RotuloDeFiltro>{props.rotulo}</RotuloDeFiltro>
      <button
        className={cn(
          'flex min-w-[110px] items-center gap-[6px] bg-pbi-superficie text-left font-semibold',
          props.marcados > 0 && 'border-pbi-primary-texto text-pbi-primary-texto',
        )}
        onClick={props.aoClicar}
        aria-haspopup="dialog"
        aria-expanded={props.aberto}
        title={props.title}
      >
        <span className="flex-1 truncate">{props.resumo}</span>
        {props.marcados > 0 && (
          <span className="rounded-full bg-pbi-primary px-[7px] py-[1px] text-[0.62rem] font-extrabold text-pbi-sobre-primary">
            {props.marcados}
          </span>
        )}
        <ChevronDown size={12} />
      </button>
      {props.children}
    </div>
  );
}
