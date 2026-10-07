// A faixa de navegação entre as telas, abaixo do topo.
//
// **Por que ela mede a própria altura.** `--util` (o que sobra da tela depois do cromo)
// alimenta a altura de todo card, e ela soma `--h-nav`. Com 14 telas e nomes longos, a
// faixa quebra em duas linhas em monitor estreito e pode caber em uma no largo — medido
// em 27/08/2026: os rótulos somam 2.113px com ícone e respiro, contra 1.366px de tela.
// Fixar `--h-nav` seria mentir para a conta em metade das resoluções.
//
// `flex-wrap` e não rolagem horizontal: aba escondida atrás de um scroll é aba que
// ninguém acha, e a regra de layout desta casa proíbe a PÁGINA rolar na horizontal.

import type { ComponentType } from 'react';
import {
  Award,
  Calendar,
  CalendarCheck,
  CalendarDays,
  Clock,
  FileText,
  LayoutDashboard,
  Phone,
  RotateCcw,
  Wrench,
} from 'lucide-react';
import type { DashboardDaLista } from '../../services/dashboardService.ts';
import { useAlturaMedida } from '../../hooks/useAlturaMedida.ts';
import { cn } from '../../utils/cn.ts';

const ICONES_MENU: Record<string, ComponentType<{ size?: number }>> = {
  'visao-geral': LayoutDashboard,
  // ATENCAO AOS IDS: sao `relatorio-do-mes` e `relatorio-do-ano`, COM o `-do-`. Estava
  // sem, e essas duas telas ficavam sem icone — falha silenciosa. Os ids reais estao em
  // `backend/specs/dashboards/*.spec.yaml`.
  'relatorio-do-mes': CalendarDays,
  'relatorio-do-ano': Calendar,
  'diario-instalacao': Clock,
  'agendamento-field': CalendarCheck,
  'protocolos-detalhados': FileText,
  'premiacao-instalacao': Award,
  'telefonia-ouvidoria': Phone,
  'manutencao-inicial': Wrench,
  'instalacao-reincidente': RotateCcw,
};

/**
 * A aba. Navegação ativa na primária — o mesmo papel que ela cumpre no cabeçalho do
 * visual; cor CHEIA é fundo, e a letra vem do token do papel (9,87:1). Sem snapshot, a
 * aba fica cinza e sem hover.
 *
 * Em tela estreita a aba encolhe e o rótulo cede espaço ao ícone, em vez de a faixa virar
 * quatro linhas e comer a altura que os cards usam (`--h-nav` entra em `--chrome`);
 * abaixo de 640px fica só o ícone, e o nome continua no `title`.
 */
const ABA =
  'inline-flex cursor-pointer items-center gap-[7px] rounded-[2px] border-0 border-b-2 border-transparent bg-transparent px-[10px] py-[5px] text-[0.74rem] font-semibold whitespace-nowrap text-pbi-ink disabled:cursor-default disabled:text-pbi-neutro [@media(max-width:900px)]:gap-[5px] [@media(max-width:900px)]:px-[7px] [@media(max-width:900px)]:text-[0.7rem]';

export function NavDeTelas(props: {
  paginas: DashboardDaLista[];
  atual: string | null;
  aoEscolher: (id: string) => void;
  aoPassarMouse?: (id: string) => void;
  aoSairDoMouse?: () => void;
}) {
  // `useLayoutEffect` e `resize`, não `ResizeObserver` — ver `useAlturaMedida.ts`.
  const navRef = useAlturaMedida<HTMLElement>('--h-nav');
  return (
    <nav className="nav-telas" ref={navRef} aria-label="Telas do relatório">
      {props.paginas.map((p) => {
        const Icone = ICONES_MENU[p.id] ?? LayoutDashboard;
        const ativo = p.id === props.atual;
        return (
          <button
            key={p.id}
            className={cn(
              ABA,
              ativo
                ? 'border-b-pbi-gold bg-pbi-primary font-bold text-pbi-sobre-primary'
                : 'enabled:hover:bg-pbi-primary-soft',
            )}
            onClick={() => props.aoEscolher(p.id)}
            // Nem a aba já ativa (nada para adiantar) nem uma sem snapshot (o clique nem
            // chega a `aoEscolher` — `disabled` abaixo já barra isso).
            onMouseEnter={ativo || !p.pronta ? undefined : () => props.aoPassarMouse?.(p.id)}
            onMouseLeave={ativo || !p.pronta ? undefined : () => props.aoSairDoMouse?.()}
            disabled={!p.pronta}
            aria-current={ativo ? 'page' : undefined}
            title={p.pronta ? p.nome : `${p.nome} — sem snapshot`}
          >
            <Icone size={14} />
            <span className="overflow-hidden text-ellipsis [@media(max-width:640px)]:hidden [@media(max-width:900px)]:max-w-[11ch]">
              {p.nome}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
