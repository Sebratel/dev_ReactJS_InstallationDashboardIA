// A casca: topo com a marca, faixa horizontal de navegação entre telas, e a área
// de conteúdo. É o formato do padrão de dashboards — topbar, nav, filtros, área —
// e não a barra lateral que estava aqui. As peças: `MarcaSebratel`,
// `AcoesDoCabecalho` e `NavDeTelas` (fase 4 de `docs/PLANO-PADROES-FRONTEND.md`).

import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { DashboardDaLista } from '../../services/dashboardService.ts';
import type { EstadoAvisoSaude } from '../../utils/avisoSaude.ts';
import { cn } from '../../utils/cn.ts';
import { MarcaSebratel } from '../ui/MarcaSebratel.tsx';
import { AcoesDoCabecalho } from './AcoesDoCabecalho.tsx';
import { NavDeTelas } from './NavDeTelas.tsx';

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
  return (
    <div className="casca">
      <header className="topo">
        <div className="marca">
          <MarcaSebratel fundo="var(--pbi-primary)" letra="var(--pbi-sobre-primary)" tamanho={30} />
          <div className="marca-textos">
            <span className="marca-nome">SEBRATEL</span>
            <span className="marca-sub">Relatório Instalação</span>
          </div>
        </div>

        <div className="titulo-tela">
          <h1 className="cabecalho-titulo">{props.titulo}</h1>
          {props.sub ? (
            <span className={cn('cabecalho-sub', props.subAviso && 'cabecalho-sub-aviso')}>
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

        <AcoesDoCabecalho acoes={props.acoes} aoSair={props.aoSair} />
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

      <NavDeTelas
        paginas={props.paginas}
        atual={props.atual}
        aoEscolher={props.aoEscolher}
        aoPassarMouse={props.aoPassarMouse}
        aoSairDoMouse={props.aoSairDoMouse}
      />

      <main className="area">{props.children}</main>

      <footer className="rodape">
        <span>Fonte: dbVoalle · dbMaria · GSheets</span>
        <span>Somente leitura · snapshot agendado</span>
      </footer>
    </div>
  );
}
