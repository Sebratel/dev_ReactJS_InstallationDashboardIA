// A faixa de abas das Configurações, no desenho do `.cfg-abas` da Manutenção: rótulo com
// ícone, a aberta sublinhada na primária. À direita, quem está logado e com que papel — o
// subtítulo que a Manutenção põe no cartão "Configurações".
//
// NÃO é um `.cartao`, de propósito: `useEspacoSemVisual` mede o espaço ANTES do primeiro
// cartão e desconta de `--util`. Como faixa solta, ela entra nessa conta e a matriz de
// acessos (altura `matriz`) continua cabendo numa tela; como cartão, viraria o primeiro
// e a matriz passaria da dobra.

import { Activity, History, Layers, Monitor, Sparkles, Users } from 'lucide-react';
import type { Papel } from '../../services/acessoService.ts';
import { cn } from '../../utils/cn.ts';

export type AbaDeConfiguracao = 'usuarios' | 'perfis' | 'uso' | 'ia' | 'sessoes' | 'historico';

export const ROTULO_DO_PAPEL: Record<Papel, string> = {
  admin: 'Administrador',
  dev: 'DEV',
  viewer: 'Visualizador',
};

interface DefinicaoDeAba {
  id: AbaDeConfiguracao;
  rotulo: string;
  Icone: typeof Users;
  soAdmin?: boolean;
}

/** As seções da aba, na ordem de uso: quem acessa primeiro, o resto depois. A IA e as
 *  sessões continuam só para administrador. */
export const ABAS_DE_CONFIGURACAO: readonly DefinicaoDeAba[] = [
  { id: 'usuarios', rotulo: 'Usuários e acessos', Icone: Users },
  { id: 'perfis', rotulo: 'Perfis', Icone: Layers },
  { id: 'uso', rotulo: 'Uso das abas', Icone: Activity },
  { id: 'ia', rotulo: 'Provedor de IA', Icone: Sparkles, soAdmin: true },
  { id: 'sessoes', rotulo: 'Sessões abertas', Icone: Monitor, soAdmin: true },
  { id: 'historico', rotulo: 'Histórico', Icone: History },
];

/** As abas que esta conta vê. */
export function abasVisiveis(souAdmin: boolean): DefinicaoDeAba[] {
  return ABAS_DE_CONFIGURACAO.filter((aba) => souAdmin || !aba.soAdmin);
}

interface AbasDeConfiguracaoProps {
  abas: readonly DefinicaoDeAba[];
  aberta: AbaDeConfiguracao;
  aoEscolher: (aba: AbaDeConfiguracao) => void;
  /** Pedidos de acesso esperando resposta — viram a bolinha na aba de usuários. */
  pedidos: number;
  quem: string;
}

export function AbasDeConfiguracao({
  abas,
  aberta,
  aoEscolher,
  pedidos,
  quem,
}: AbasDeConfiguracaoProps) {
  return (
    <div className="flex flex-none flex-wrap items-end gap-x-[16px] rounded-[4px] border border-pbi-borda bg-pbi-superficie px-[10px] shadow-[var(--card-shadow)]">
      <div
        role="tablist"
        aria-label="Seções das configurações"
        className="flex flex-wrap gap-[6px]"
      >
        {abas.map(({ id, rotulo, Icone }) => {
          const ativa = id === aberta;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={ativa}
              onClick={() => aoEscolher(id)}
              className={cn(
                'inline-flex cursor-pointer items-center gap-[6px] rounded-none border-0 border-b-2 border-transparent bg-transparent px-[12px] py-[9px] text-[13px] font-semibold text-pbi-muted hover:text-pbi-ink',
                ativa &&
                  'border-b-pbi-primary-texto text-pbi-primary-texto hover:text-pbi-primary-texto',
              )}
            >
              <Icone size={14} aria-hidden />
              {rotulo}
              {id === 'usuarios' && pedidos > 0 ? (
                <span
                  className="rounded-full bg-pbi-primary px-[6px] text-[10px] leading-[16px] text-pbi-sobre-primary"
                  title={`${pedidos} pedido(s) de acesso esperando resposta`}
                >
                  {pedidos}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <span className="ml-auto truncate py-[9px] text-[11.5px] text-pbi-muted" title={quem}>
        {quem} — quem entra no dashboard e o que cada pessoa enxerga
      </span>
    </div>
  );
}
