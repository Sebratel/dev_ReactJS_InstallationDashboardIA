// A casca: barra lateral de navegação e a coluna de conteúdo.
//
// A navegação desta tela gasta **largura**, não altura — por isso `--h-nav` é 0 na
// conta do cromo. O item ativo vai na primária, o mesmo papel que ela cumpre no
// cabeçalho de cada visual: quem olha a tela sabe onde está pela mesma cor.

import type { ReactNode } from 'react';
import type { DashboardDaLista } from '../api.ts';
import {
  LayoutDashboard,
  CalendarDays,
  Calendar,
  Clock,
  CalendarCheck,
  FileText,
  Award,
  Phone,
  Wrench,
  RotateCcw,
} from 'lucide-react';
import type { ComponentType } from 'react';

const ICONES_MENU: Record<string, ComponentType<{ size?: number }>> = {
  'visao-geral': LayoutDashboard,
  'relatorio-mes': CalendarDays,
  'relatorio-ano': Calendar,
  'diario-instalacao': Clock,
  'agendamento-field': CalendarCheck,
  'protocolos-detalhados': FileText,
  'premiacao-instalacao': Award,
  'telefonia-ouvidoria': Phone,
  'manutencao-inicial': Wrench,
  'instalacao-reincidente': RotateCcw,
};

export function AppShell(props: {
  paginas: DashboardDaLista[];
  atual: string | null;
  aoEscolher: (id: string) => void;
  titulo: string;
  sub: string;
  acoes?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="barra-lateral">
        <div className="marca-topo">
          <img
            src="/assets/logo-sebratel-circular.png"
            alt="Sebratel"
            width={30}
            height={30}
            style={{ borderRadius: '50%', objectFit: 'contain', flex: 'none' }}
          />
          <div className="flex flex-col">
            <span className="marca-nome">SEBRATEL</span>
            <span className="marca-sub">Relatório Instalação</span>
          </div>
        </div>

        <nav className="menu">
          <span className="menu-titulo">Relatório</span>
          {props.paginas.map((p) => {
            const Icone = ICONES_MENU[p.id] ?? LayoutDashboard;
            const ativo = p.id === props.atual;
            return (
              <button
                key={p.id}
                className={`item-menu${ativo ? ' ativo' : ''}`}
                onClick={() => props.aoEscolher(p.id)}
                disabled={!p.pronta}
                aria-current={ativo}
                title={p.pronta ? p.nome : `${p.nome} — sem snapshot`}
              >
                <Icone size={15} />
                <span className="item-rotulo">{p.nome}</span>
              </button>
            );
          })}
        </nav>

        <div className="rodape-lateral">
          <span>Fonte: dbValle · dbMaria · GSheets</span>
          <span>Somente leitura · snapshot agendado</span>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">{props.children}</div>
    </div>
  );
}
