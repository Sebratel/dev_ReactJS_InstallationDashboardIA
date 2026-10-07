// Os estados de um visual que ainda não é número: carregando (esqueleto), vazio e
// "não carregou". Não são opcionais — tela de dashboard passa a vida carregando,
// filtrando para vazio e tomando erro de rede; sem eles o usuário vê card branco e
// conclui que o número é zero.
//
// O brilho que varre a barra do esqueleto é animação e fica no CSS (`.brilho`), com o
// corte de `prefers-reduced-motion`.

import type { ReactNode } from 'react';
import { cn } from '../../utils/cn.ts';

/** Uma barra do esqueleto; `className` troca a altura (o KPI usa 40px). */
export function EsqueletoLinha({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'brilho relative h-[68px] overflow-hidden rounded-[2px] border border-pbi-borda bg-pbi-superficie',
        className,
      )}
    />
  );
}

/**
 * Três barras no lugar do visual. Com `titulo`, o bloco se anuncia ("Carregando X…");
 * sem, é decoração de algo que já se anuncia (a página inteira, por exemplo).
 */
export function Esqueleto({ titulo }: { titulo?: string }) {
  const anuncio =
    titulo === undefined
      ? ({ 'aria-hidden': true } as const)
      : ({ 'aria-busy': true, 'aria-live': 'polite' } as const);
  return (
    <div className="flex w-full flex-col gap-[8px]" {...anuncio}>
      {titulo === undefined ? null : <span className="sr-only">Carregando {titulo}…</span>}
      <EsqueletoLinha />
      <EsqueletoLinha />
      <EsqueletoLinha />
    </div>
  );
}

/**
 * A mensagem centralizada no corpo do cartão: "sem dados", "não carregou" com o botão
 * de tentar de novo. `como="div"` quando leva bloco dentro (erro, botão).
 */
export function MensagemDeEstado({
  children,
  como: Tag = 'p',
}: {
  children: ReactNode;
  como?: 'p' | 'div';
}) {
  return (
    <Tag className="flex h-full flex-col items-center justify-center gap-[12px] px-[12px] py-[24px] text-center text-[0.76rem] text-pbi-muted">
      {children}
    </Tag>
  );
}
