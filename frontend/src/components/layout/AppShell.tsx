// A casca: topo com a marca, faixa horizontal de navegação entre telas, e a área
// de conteúdo. É o formato do padrão de dashboards — topbar, nav, filtros, área —
// e não a barra lateral que estava aqui. As peças: `MarcaSebratel`,
// `AcoesDoCabecalho` e `NavDeTelas` (fase 4 de `docs/PLANO-PADROES-FRONTEND.md`).

import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { DashboardDaLista } from '../../services/dashboardService.ts';
import type { EstadoAvisoSaude } from '../../utils/avisoSaude.ts';
import { cn } from '../../utils/cn.ts';
import { SO_ICONE } from './soIcone.ts';
import { MarcaSebratel } from '../ui/MarcaSebratel.tsx';
import { AcoesDoCabecalho } from './AcoesDoCabecalho.tsx';
import { NavDeTelas } from './NavDeTelas.tsx';

/** Título e subtítulo da tela numa linha só, cortados com reticências; somem abaixo de
 *  640px, onde a faixa de abas precisa da largura. */
const TEXTO_DO_TITULO =
  'overflow-hidden text-ellipsis whitespace-nowrap [@media(max-width:640px)]:hidden';

/** O banner de saúde do snapshot (Marco A6): impossível de ignorar. */
const BANNER: Record<EstadoAvisoSaude['nivel'], string> = {
  falhou: 'border-pbi-critico-texto bg-pbi-erro-bg text-pbi-critico-texto',
  vencida: 'border-pbi-gold-600 bg-pbi-aviso-bg text-pbi-gold-600',
  ok: '',
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
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-[var(--h-topbar)] flex-none items-center gap-[16px] border-b border-pbi-borda bg-pbi-superficie px-[16px]">
        <div className="flex flex-none items-center gap-[10px]">
          <MarcaSebratel fundo="var(--pbi-primary)" letra="var(--pbi-sobre-primary)" tamanho={30} />
          <div className={cn('flex flex-col', SO_ICONE)}>
            <span className="text-[0.82rem] leading-[1.1] font-extrabold tracking-[0.06em] text-pbi-primary-texto">
              SEBRATEL
            </span>
            <span className="text-[0.62rem] text-pbi-muted">Relatório Instalação</span>
          </div>
        </div>

        {/* A régua à esquerda separa o título da tela da marca — sem ela as duas colunas
            de texto se leem como um bloco só. */}
        <div className="flex min-w-0 flex-col border-l border-pbi-borda pl-[16px]">
          <h1
            className={cn(TEXTO_DO_TITULO, 'text-[0.95rem] leading-[1.2] font-bold text-pbi-ink')}
          >
            {props.titulo}
          </h1>
          {props.sub ? (
            <span
              className={cn(
                TEXTO_DO_TITULO,
                'text-[0.72rem] text-pbi-muted',
                // Os tokens do `Aviso` e do selo `neutro`: dado velho é o mesmo estado de
                // atenção em outro lugar da tela, não uma cor nova.
                props.subAviso &&
                  'rounded-[4px] border border-pbi-gold-600 bg-pbi-aviso-bg px-[6px] py-[1px] font-bold text-pbi-gold-600',
              )}
            >
              {props.sub}
            </span>
          ) : null}
          {props.ultimaAtualizacaoRealtime ? (
            <span
              className="badge-realtime"
              title="Conectado ao Voalle via SSE — dados atualizam automaticamente sem F5"
            >
              <span className="ponto-vivo" aria-hidden="true" />
              <span className={SO_ICONE}>Ao vivo • {props.ultimaAtualizacaoRealtime}</span>
            </span>
          ) : null}
        </div>

        <AcoesDoCabecalho acoes={props.acoes} aoSair={props.aoSair} />
      </header>

      {props.avisoSaude?.temAviso ? (
        <div
          className={cn(
            'flex flex-none items-center gap-[8px] border-b border-transparent px-[16px] py-[6px] text-[0.72rem] font-semibold',
            BANNER[props.avisoSaude.nivel],
          )}
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

      <footer className="mt-auto flex flex-none flex-wrap gap-[16px] border-t border-pbi-borda px-[16px] py-[8px] text-[0.62rem] text-pbi-muted">
        <span>Fonte: dbVoalle · dbMaria · GSheets</span>
        <span>Somente leitura · snapshot agendado</span>
      </footer>
    </div>
  );
}
