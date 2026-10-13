// As partes de um indicador, comuns ao `KpiCard` (a faixa de indicadores), ao `Card` (o
// KPI como visual de grade) e ao esqueleto da página.
//
// A forma é a do `.kpi-faixa` do COM · Gestão Comercial: cartão claro com sombra, o
// VALOR em cima, grande, na primária (9,87:1 sobre o branco), e o nome embaixo, miúdo.

import type { ReactNode } from 'react';
import { cn } from '../../../utils/cn.ts';

/** A moldura do indicador. `data-visual` é o gancho de `backend/tools/tela/src/varre.ts`. */
export function MolduraDoKpi(props: { children: ReactNode; esqueleto?: boolean }) {
  return (
    <section
      data-visual
      aria-hidden={props.esqueleto || undefined}
      className={cn(
        'flex min-h-[74px] min-w-0 flex-col justify-center gap-[1px] rounded-[var(--card-radius)] px-[14px] py-[10px]',
        'border border-pbi-borda bg-pbi-superficie shadow-[var(--card-shadow)]',
      )}
    >
      {props.children}
    </section>
  );
}

export function NomeDoKpi(props: { children: ReactNode; title?: string }) {
  return (
    <h3
      title={props.title}
      className="m-0 truncate text-[9.5px] font-semibold tracking-[0.8px] text-pbi-muted uppercase"
    >
      {props.children}
    </h3>
  );
}

export function ValorDoKpi(props: { children: ReactNode; vazio?: boolean; destaque?: boolean }) {
  return (
    <div
      className={cn(
        'text-[clamp(20px,3.1vh,30px)] leading-[1.05] font-semibold whitespace-nowrap text-pbi-primary-texto tabular-nums',
        props.vazio && 'text-[16px] text-pbi-neutro',
        // Depois do vazio: no CSS antigo o tamanho do destaque vencia o do vazio.
        props.destaque && 'text-[clamp(24px,3.8vh,38px)]',
      )}
    >
      {props.children}
    </div>
  );
}

/** Linha miúda sob o valor: a origem (conferência) ou os filtros que o afetam. */
export function LinhaDoKpi(props: {
  children: ReactNode;
  title?: string;
  tom?: 'origem' | 'filtros';
}) {
  return (
    <div
      title={props.title}
      className={cn(
        'mt-[2px] text-[10.5px] leading-[1.35]',
        props.tom === 'filtros' ? 'font-bold text-pbi-gold-600' : 'truncate text-pbi-muted',
      )}
    >
      {props.children}
    </div>
  );
}
