// Um filtro da barra — o `.filtro` do COM · Gestão Comercial: um botão compacto de 30px
// com o NOME e o VALOR lado a lado ("Turno todos ▾"), que abre o diálogo. Até
// 13/10/2026 o nome ficava em cima e o botão embaixo (a forma medida no BY em 09/09):
// uma barra de 12 filtros quebrava em duas linhas de 56px. Na forma do COM ela cabe em
// uma linha de 50px na maioria das telas.

import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn.ts';
import { rotuloDeCampo } from '../../utils/rotulos.ts';

/** O nome de uma fileira da barra (a dos chips), pequeno e em maiúsculas. */
export function RotuloDeFiltro({ children }: { children: ReactNode }) {
  return (
    <span className="flex-none text-[10px] font-extrabold tracking-[0.9px] whitespace-nowrap text-pbi-muted uppercase">
      {children}
    </span>
  );
}

export function GatilhoDoFiltro(props: {
  /** O nome da coluna, como a spec o traz; a tela mostra o rótulo de gente. */
  rotulo: string;
  /** "todos", o valor escolhido, ou "N selecionados". */
  resumo: string;
  /** Quantos valores estão marcados; com 0 o botão fica neutro. */
  marcados: number;
  aberto: boolean;
  aoClicar: () => void;
  title: string;
  /** O diálogo, quando aberto. */
  children?: ReactNode;
}) {
  const marcado = props.marcados > 0;
  return (
    <div className="relative">
      <button
        className={cn(
          'inline-flex h-[30px] max-w-[280px] items-center gap-[6px] rounded-[8px] border-pbi-borda bg-pbi-superficie px-[10px] py-0 whitespace-nowrap text-pbi-ink transition-colors enabled:hover:border-pbi-primary-texto',
          marcado && 'border-pbi-primary-texto bg-pbi-primary-soft text-pbi-primary-texto',
        )}
        onClick={props.aoClicar}
        aria-haspopup="dialog"
        aria-expanded={props.aberto}
        title={props.title}
      >
        <span className={cn('font-semibold text-pbi-muted', marcado && 'text-pbi-primary-texto')}>
          {rotuloDeCampo(props.rotulo)}
        </span>
        <span className="max-w-[140px] truncate">{props.resumo}</span>
        {props.marcados > 1 && (
          <span className="rounded-full bg-pbi-primary px-[6px] text-[10px] leading-[1.5] font-bold text-pbi-sobre-primary">
            {props.marcados}
          </span>
        )}
        <ChevronDown size={12} className="flex-none text-pbi-muted" aria-hidden="true" />
      </button>
      {props.children}
    </div>
  );
}
