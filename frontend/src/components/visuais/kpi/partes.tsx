// As partes de um indicador, comuns ao `KpiCard` (a faixa de indicadores), ao `Card` (o
// KPI como visual de grade) e ao esqueleto da página.
//
// O valor nunca vai na cor da série: a identidade fica no marcador (a borda dourada à
// esquerda), não no texto.

import type { ReactNode } from 'react';
import { cn } from '../../../utils/cn.ts';

/** A moldura do indicador. `data-visual` é o gancho de `backend/tools/tela/src/varre.ts`. */
export function MolduraDoKpi(props: { children: ReactNode; esqueleto?: boolean }) {
  return (
    <section
      data-visual
      aria-hidden={props.esqueleto || undefined}
      className={cn(
        'flex min-w-0 flex-col justify-between rounded-[2px] px-[10px] py-[8px]',
        'border border-l-[3px] border-pbi-borda border-l-pbi-gold bg-pbi-superficie',
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
      className="m-0 mb-[3px] truncate text-[0.62rem] font-bold tracking-[0.05em] text-pbi-muted uppercase"
    >
      {props.children}
    </h3>
  );
}

export function ValorDoKpi(props: { children: ReactNode; vazio?: boolean; destaque?: boolean }) {
  return (
    <div
      className={cn(
        'text-[1.4rem] leading-[1.1] font-bold tracking-[-0.02em] text-pbi-ink tabular-nums',
        props.vazio && 'text-[1rem] font-semibold text-pbi-neutro',
        // Depois do vazio: no CSS antigo o tamanho do destaque vencia o do vazio.
        props.destaque && 'text-[1.9rem]',
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
        'mt-[4px] text-[0.62rem]',
        props.tom === 'filtros' ? 'font-bold text-pbi-gold-600' : 'truncate text-pbi-muted',
      )}
    >
      {props.children}
    </div>
  );
}
