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

import type { ReactNode } from 'react';
import type { DashboardDaLista } from '../api.ts';
import type { EstadoAvisoSaude } from '../aviso-saude.ts';
import { usaAlturaMedida } from '../altura-medida.ts';
import { useThemeStore } from '../store/useThemeStore.ts';
import { usaModo } from '../modo.tsx';
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
  Sun,
  Moon,
  Eye,
  LogOut,
  AlertTriangle,
  Share2,
  Check,
} from 'lucide-react';
import { useState, type ComponentType } from 'react';

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

export function AppShell(props: {
  paginas: DashboardDaLista[];
  atual: string | null;
  aoEscolher: (id: string) => void;
  /** FASE L5, R6: o mouse parou sobre uma aba — chance de já ter o dado pronto
   *  quando o clique vier. Opcional porque o teste de layout/estados de AppShell
   *  não precisa simular hover para continuar válido. */
  aoPassarMouse?: (id: string) => void;
  /** FASE L5, R6: o mouse saiu da aba antes do debounce de hover disparar — cancela
   *  o prefetch pendente. Mesmo motivo de opcional que `aoPassarMouse`. */
  aoSairDoMouse?: () => void;
  titulo: string;
  sub: string;
  /** O dado por trás da tela passou do limite sem `npm run snapshot` — ver
   *  `LIMITE_DIAS_DADO_ATRASADO` em `formato.ts`. Troca o carimbo discreto por
   *  um aviso, em vez de deixar a idade do dado só no texto pequeno do canto. */
  subAviso?: boolean;
  /** Aviso de saúde ou falha das queries do snapshot (Marco A6). */
  avisoSaude?: EstadoAvisoSaude;
  /** Horário da última atualização automática recebida via SSE (Marco C2). */
  ultimaAtualizacaoRealtime?: string | null;
  acoes?: ReactNode;
  /** Encerra a sessão de login. Sempre presente — a tela só chega a existir
   *  depois que há sessão, então sempre há como sair dela. */
  aoSair: () => void;
  children: ReactNode;
}) {
  // A altura real da faixa entra em `--util`, e todo card depende dela. Ver
  // `altura-medida.ts` para o porquê de medir em vez de declarar.
  const navRef = usaAlturaMedida<HTMLElement>('--h-nav');
  const { isDark, toggleTheme } = useThemeStore();
  const { conferencia, alterna } = usaModo();
  const [copiado, setCopiado] = useState(false);

  const copiaLink = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href).then(() => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      });
    }
  };

  return (
    <div className="casca">
      <header className="topo">
        {/* A MARCA É DESENHADA, NÃO BAIXADA.
            Aqui havia `<img src="/assets/logo-sebratel-circular.png">`, e esse
            arquivo NUNCA existiu no repositório — não há `apps/web/public/`, e o
            `dist` só tem o CSS e o JS. Resultado: 404 em toda carga de página e o
            ícone quebrado do navegador ao lado do nome da empresa, desde
            `0aae15c`. Imagem quebrada em cabeçalho de relatório é a primeira coisa
            que alguém vê e a última que confia.
            Um `<svg>` inline não pede rede, não quebra e acompanha a paleta. Se o
            arquivo oficial entrar em `apps/web/public/`, troque só este bloco. */}
        <div className="marca">
          <svg width={30} height={30} viewBox="0 0 30 30" aria-hidden="true" style={{ flex: 'none' }}>
            <circle cx="15" cy="15" r="14" fill="var(--pbi-primary)" />
            <circle cx="15" cy="15" r="14" fill="none" stroke="var(--pbi-gold)" strokeWidth="1.5" />
            <text
              x="15"
              y="15"
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--pbi-sobre-primary)"
              fontSize="14"
              fontWeight="800"
              fontFamily="var(--font)"
            >
              S
            </text>
          </svg>
          <div className="marca-textos">
            <span className="marca-nome">SEBRATEL</span>
            <span className="marca-sub">Relatório Instalação</span>
          </div>
        </div>

        <div className="titulo-tela">
          <h1 className="cabecalho-titulo">{props.titulo}</h1>
          {props.sub ? (
            <span className={`cabecalho-sub${props.subAviso ? ' cabecalho-sub-aviso' : ''}`}>
              {props.sub}
            </span>
          ) : null}
          {props.ultimaAtualizacaoRealtime ? (
            <span
              className="badge-realtime"
              title="Conectado ao Voalle via SSE — dados atualizam automaticamente sem F5"
            >
              <span className="ponto-vivo" aria-hidden="true" />
              Ao vivo • {props.ultimaAtualizacaoRealtime}
            </span>
          ) : null}
        </div>

        {/* OS DOIS INTERRUPTORES GLOBAIS MORAM AQUI, e não numa tela.
            Ambos gravam no localStorage e sobrevivem ao F5 — de propósito, mas isso
            os torna ARMADILHA quando não há botão: os dois estavam órfãos (o tema no
            `useThemeStore`, o modo no `usaModo`), ligados por código e desligáveis
            por ninguém. Quem caísse em conferência ou no escuro ficava lá. */}
        <div className="grupo-acoes-cabecalho">
          <button
            className={`btn-icone${copiado ? ' ativo' : ''}`}
            onClick={copiaLink}
            aria-label="Copiar link com filtros aplicados"
            title={copiado ? 'Link copiado com sucesso!' : 'Copiar link com filtros aplicados'}
          >
            {copiado ? <Check size={15} /> : <Share2 size={15} />}
          </button>

          <button
            className={`btn-icone${conferencia ? ' ativo' : ''}`}
            onClick={alterna}
            aria-pressed={conferencia}
            title={
              conferencia
                ? 'Modo conferência: id do visual, origem DAX e faixa de cálculo à vista. Clique para apresentar.'
                : 'Modo apresentação. Clique para conferir contra o Power BI.'
            }
          >
            {conferencia ? <Wrench size={15} /> : <Eye size={15} />}
          </button>

          <button
            className="btn-icone"
            onClick={toggleTheme}
            aria-pressed={isDark}
            title={isDark ? 'Tema escuro. Clique para o claro.' : 'Tema claro. Clique para o escuro.'}
          >
            {isDark ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          {props.acoes}

          <button className="btn-icone" onClick={props.aoSair} title="Sair">
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {props.avisoSaude?.temAviso ? (
        <div
          className={`banner-saude banner-saude-${props.avisoSaude.nivel}`}
          role="alert"
          title={props.avisoSaude.mensagem}
        >
          <AlertTriangle size={15} style={{ flex: 'none' }} />
          <span>{props.avisoSaude.mensagem}</span>
        </div>
      ) : null}

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
              // Nem a aba já ativa (nada para adiantar) nem uma sem snapshot (o
              // clique nem chega a `aoEscolher` — `disabled` abaixo já barra isso).
              onMouseEnter={ativo || !p.pronta ? undefined : () => props.aoPassarMouse?.(p.id)}
              onMouseLeave={ativo || !p.pronta ? undefined : () => props.aoSairDoMouse?.()}
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
        <span>Fonte: dbVoalle · dbMaria · GSheets</span>
        <span>Somente leitura · snapshot agendado</span>
      </footer>
    </div>
  );
}
