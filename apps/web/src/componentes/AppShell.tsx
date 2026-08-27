// A casca: topo com a marca, faixa horizontal de navegação entre telas, e a área
// de conteúdo. É o formato do padrão de dashboards — topbar, nav, filtros, área —
// e não a barra lateral que estava aqui.
//
// **Por que a nav mede a própria altura.** `--util` (o que sobra da tela depois do
// cromo) alimenta a altura de todo card, e ela soma `--h-nav`. Com 14 telas e nomes
// longos, a faixa quebra em duas linhas em monitor estreito e pode caber em uma no
// largo — medido em 27/08/2026: os rótulos somam **1.511px de texto**, 2.113px com
// ícone e respiro, contra 1.366px de tela. Fixar `--h-nav` num número seria mentir
// para a conta em metade das resoluções, e o sintoma seria card estourando a tela
// só em quem tem monitor pequeno.
//
// `useLayoutEffect` e `resize`, não `ResizeObserver`: mesma escolha do medidor do
// gráfico, pelo mesmo motivo — no dashboard de referência o observer não disparou e
// os visuais ficaram invisíveis, sem erro no console.

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
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
  // ATENCAO AOS IDS: sao `relatorio-do-mes` e `relatorio-do-ano`, COM o `-do-`.
  // Estava sem, e como o mapa e indexado por id essas duas telas ficavam sem
  // icone na navegacao — falha silenciosa, porque um icone ausente nao quebra
  // nada. Os ids reais estao em `specs/dashboards/*.spec.yaml`.
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
 * Mede a faixa de navegação e publica a altura em `--h-nav`.
 *
 * Escreve no `documentElement` porque `--util` é lido por regras que não descendem
 * da nav (`.v-matriz`, `.caixa-grafico`). Só escreve quando o valor MUDA — sem essa
 * guarda, cada render reescreveria a variável e dispararia o próximo layout.
 */
function usaAlturaDaNav(): React.RefObject<HTMLElement | null> {
  const ref = useRef<HTMLElement | null>(null);
  const ultima = useRef<number>(-1);

  const medir = useCallback(() => {
    const h = ref.current?.getBoundingClientRect().height;
    if (h === undefined) return;
    const px = Math.round(h);
    if (px === ultima.current) return;
    ultima.current = px;
    document.documentElement.style.setProperty('--h-nav', `${px}px`);
  }, []);

  useLayoutEffect(medir);
  useEffect(() => {
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [medir]);

  return ref;
}

export function AppShell(props: {
  paginas: DashboardDaLista[];
  atual: string | null;
  aoEscolher: (id: string) => void;
  titulo: string;
  sub: string;
  acoes?: ReactNode;
  children: ReactNode;
}) {
  const navRef = usaAlturaDaNav();

  return (
    <div className="casca">
      <header className="topo">
        <div className="marca">
          <img
            src="/assets/logo-sebratel-circular.png"
            alt="Sebratel"
            width={30}
            height={30}
            style={{ borderRadius: '50%', objectFit: 'contain', flex: 'none' }}
          />
          <div className="marca-textos">
            <span className="marca-nome">SEBRATEL</span>
            <span className="marca-sub">Relatório Instalação</span>
          </div>
        </div>

        <div className="titulo-tela">
          <h1 className="cabecalho-titulo">{props.titulo}</h1>
          {props.sub ? <span className="cabecalho-sub">{props.sub}</span> : null}
        </div>

        <div className="grupo-acoes-cabecalho">{props.acoes}</div>
      </header>

      {/* `flex-wrap` e não rolagem horizontal: aba escondida atrás de um scroll é
          aba que ninguém acha, e a regra de layout desta casa proíbe a PÁGINA rolar
          na horizontal. Quebrar em duas linhas mostra as 14 de uma vez. */}
      <nav className="nav-telas" ref={navRef} aria-label="Telas do relatório">
        {props.paginas.map((p) => {
          const Icone = ICONES_MENU[p.id] ?? LayoutDashboard;
          const ativo = p.id === props.atual;
          return (
            <button
              key={p.id}
              className={`aba${ativo ? ' ativo' : ''}`}
              onClick={() => props.aoEscolher(p.id)}
              disabled={!p.pronta}
              aria-current={ativo ? 'page' : undefined}
              title={p.pronta ? p.nome : `${p.nome} — sem snapshot`}
            >
              <Icone size={14} />
              <span className="aba-rotulo">{p.nome}</span>
            </button>
          );
        })}
      </nav>

      <main className="area">{props.children}</main>

      <footer className="rodape">
        <span>Fonte: dbValle · dbMaria · GSheets</span>
        <span>Somente leitura · snapshot agendado</span>
      </footer>
    </div>
  );
}
