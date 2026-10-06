// Os selos: a pílula de estado da faixa do modo conferência e o badge de status de uma
// célula de tabela. Mesmos tons (fundo suave + letra escurecida + borda), medidas
// diferentes: o badge mora dentro de uma linha de tabela e é mais baixo.
//
// `data-selo` é o gancho das ferramentas (`backend/tools/tela`, E2E): o primeiro selo
// na tela é o sinal de "página calculada". Seletor de teste não depende de classe de
// estilo — a classe muda quando o estilo muda, o gancho não.

import type { ReactNode } from 'react';
import { cn } from '../../utils/cn.ts';

export type TomDeSelo = 'ok' | 'ruim' | 'neutro' | 'apagado';

const TOM: Record<TomDeSelo, string> = {
  ok: 'bg-pbi-ok-bg text-pbi-green-texto border-pbi-green',
  ruim: 'bg-pbi-erro-bg text-pbi-critico-texto border-pbi-critico-texto',
  neutro: 'bg-pbi-aviso-bg text-pbi-gold-600 border-pbi-gold-600',
  apagado: 'bg-pbi-fundo text-pbi-muted border-pbi-borda',
};

export function Selo(props: { tom?: TomDeSelo; children: ReactNode }) {
  const tom = props.tom ?? 'ok';
  return (
    <span
      data-selo={tom}
      className={cn(
        'inline-flex items-center gap-[5px] rounded-full border px-[9px] py-[3px]',
        'text-[0.66rem] font-bold whitespace-nowrap',
        TOM[tom],
      )}
    >
      {props.children}
    </span>
  );
}

export type TomDeStatus = 'sim' | 'nao' | 'alerta';

const TOM_DE_STATUS: Record<TomDeStatus, string> = {
  sim: TOM.ok,
  nao: TOM.apagado,
  // A borda do alerta é a cor cheia, não a escurecida do selo `ruim`: no escuro as duas
  // diferem, e o badge sempre foi assim.
  alerta: 'bg-pbi-erro-bg text-pbi-critico-texto border-pbi-critico',
};

export function BadgeDeStatus(props: { tom: TomDeStatus; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-[8px] py-[1px]',
        'text-[0.64rem] font-bold tracking-[0.03em] uppercase',
        TOM_DE_STATUS[props.tom],
      )}
    >
      {props.children}
    </span>
  );
}
