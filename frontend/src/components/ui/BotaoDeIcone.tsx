// O botão quadrado só com ícone: as ações do topo (link, conferência, tema, sair) e o
// fechar do diálogo de filtro. Sem rótulo visível, o nome vai em `title`/`aria-label`.

import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../utils/cn.ts';

const TONS = {
  /** Sobre a superfície: o `.icon-btn` do COM — contorno de grade, ícone na primária. */
  superficie: 'size-[30px] rounded-[6px] border-pbi-grid bg-pbi-superficie text-pbi-primary-texto',
  /** Sobre a faixa bordô do diálogo: contorno e ícone na letra do papel, sem hover. */
  primaria:
    'ml-auto size-[24px] border-pbi-sobre-primary-fraco bg-transparent text-pbi-sobre-primary',
} as const;

export function BotaoDeIcone({
  tom = 'superficie',
  ativo = false,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tom?: keyof typeof TONS;
  /** Interruptor ligado (conferência) ou confirmação momentânea (link copiado). */
  ativo?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex cursor-pointer items-center justify-center rounded-[2px] border p-0',
        TONS[tom],
        tom === 'superficie' && 'enabled:hover:bg-pbi-hover',
        ativo && 'border-pbi-primary-texto bg-pbi-primary-soft text-pbi-primary-texto',
        className,
      )}
      {...props}
    />
  );
}
