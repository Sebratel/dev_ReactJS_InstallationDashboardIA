// A casca: topo, faixa de navegação entre telas e a área de conteúdo — o formato do
// COM · Gestão Comercial (`dados_ReactJS_CommercialDashboards/web/src/App.jsx`), o
// frontend da Sebratel aprovado pelo QA e em produção, que esta tela segue desde
// 13/10/2026. As peças: `AcoesDoCabecalho` e `NavDeTelas`.
//
// O topo diz três coisas e nada mais: QUAL relatório (a marca, à esquerda), QUAL tela (o
// título, no centro) e SE o dado está em dia (o ponto e a idade, à direita). O aviso de
// saúde, que antes ocupava o subtítulo E uma faixa inteira abaixo do topo — a mesma
// frase duas vezes —, desce para dentro da página como aviso, igual ao do COM.

import type { ReactNode } from 'react';
import type { DashboardDaLista } from '../../services/dashboardService.ts';
import type { EstadoAvisoSaude } from '../../utils/avisoSaude.ts';
import { dataHora, haQuanto } from '../../utils/formato.ts';
import { cn } from '../../utils/cn.ts';
import { Aviso, Erro } from '../ui/Cartao.tsx';
import { SO_ICONE } from './soIcone.ts';
import { AcoesDoCabecalho } from './AcoesDoCabecalho.tsx';
import { NavDeTelas } from './NavDeTelas.tsx';

/** Abaixo de 860px o título e a idade cedem a largura às ações, como no COM. */
const SOME_ESTREITO = '[@media(max-width:860px)]:hidden';

/** O ponto ao lado da idade do dado: verde pulsando (em dia), dourado (parado), vermelho
 *  (alguma fonte falhou). O pulso é animação e mora no `estilo.css` (`.ponto-vivo`). */
const PONTO: Record<EstadoAvisoSaude['nivel'], { classe: string; title: string }> = {
  ok: { classe: '', title: 'Atualização automática ativa' },
  vencida: { classe: 'parado', title: 'Dado parado além do esperado' },
  falhou: { classe: 'falhou', title: 'Falha em alguma fonte' },
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
  /** Quando o dado desta tela foi lido (ISO). Vira "há 12min" ao lado do ponto. */
  dadoDe?: string | null;
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
  const nivel = props.avisoSaude?.temAviso ? props.avisoSaude.nivel : 'ok';
  const ponto = PONTO[nivel];
  const quando = props.ultimaAtualizacaoRealtime
    ? `ao vivo · ${props.ultimaAtualizacaoRealtime}`
    : props.dadoDe
      ? haQuanto(props.dadoDe)
      : '—';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 flex h-[var(--h-topbar)] flex-none items-center gap-[16px] border-b border-pbi-borda bg-pbi-superficie px-[14px]">
        <div className="flex flex-none items-center gap-[11px] font-bold tracking-[0.5px] whitespace-nowrap text-pbi-primary-texto">
          <img src="/logo-sebratel.svg" alt="Sebratel" className="block h-[34px] w-auto" />
          <span className={cn('text-[12px] tracking-[0.9px]', SO_ICONE)}>
            INST · RELATÓRIO INSTALAÇÃO
          </span>
        </div>

        <h1
          className={cn(
            'm-0 min-w-0 flex-1 truncate text-center text-[16px] font-semibold tracking-[0.8px] text-pbi-ink uppercase',
            SOME_ESTREITO,
          )}
        >
          {props.titulo}
        </h1>

        <div className="ml-auto flex items-center gap-[8px] text-[12.5px] whitespace-nowrap text-pbi-muted">
          <span
            className={cn('ponto-vivo', ponto.classe)}
            title={props.avisoSaude?.temAviso ? props.avisoSaude.mensagem : ponto.title}
            aria-hidden="true"
          />
          <span
            className={SOME_ESTREITO}
            title={props.dadoDe ? `Dado de ${dataHora(props.dadoDe)}` : undefined}
          >
            {quando}
          </span>
          <AcoesDoCabecalho acoes={props.acoes} aoSair={props.aoSair} />
        </div>
      </header>

      <NavDeTelas
        paginas={props.paginas}
        atual={props.atual}
        aoEscolher={props.aoEscolher}
        aoPassarMouse={props.aoPassarMouse}
        aoSairDoMouse={props.aoSairDoMouse}
      />

      <main className="area">
        {props.avisoSaude?.temAviso ? (
          <div role="alert" title={props.avisoSaude.mensagem}>
            {props.avisoSaude.nivel === 'falhou' ? (
              <Erro>{props.avisoSaude.mensagem}</Erro>
            ) : (
              <Aviso>{props.avisoSaude.mensagem}</Aviso>
            )}
          </div>
        ) : null}
        {props.children}
      </main>
    </div>
  );
}
