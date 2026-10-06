// Os dois botões de ação da tela. A base de todo `<button>` (fonte, borda fina, raio,
// padding) é o reset de `@layer base` no `estilo.css`, e `button:disabled` (opacidade)
// também mora lá; aqui fica só o que distingue as variantes.
//
// Primário: a primária é FUNDO, e a letra é o papel `sobre-primary` — nunca a primária
// como letra (cor cheia é fundo, escurecida é letra; `DESIGN-SYSTEM.md` § 1.1).

import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../utils/cn.ts';

const VARIANTE = {
  primario: cn(
    'border-pbi-primary-texto bg-pbi-primary font-semibold text-pbi-sobre-primary',
    'enabled:hover:border-pbi-primary-dark enabled:hover:bg-pbi-primary-dark',
    'disabled:border-pbi-neutro disabled:bg-pbi-neutro',
  ),
  secundario: cn(
    'bg-pbi-superficie font-semibold',
    'enabled:hover:border-pbi-primary-texto enabled:hover:text-pbi-primary-texto',
  ),
} as const;

export function Botao({
  variante,
  className,
  type = 'button',
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante: keyof typeof VARIANTE }) {
  return <button type={type} className={cn(VARIANTE[variante], className)} {...resto} />;
}
