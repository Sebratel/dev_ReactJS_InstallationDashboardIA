// Peças comuns das abas de insights: indicador, legenda, caixa de dica, rodapé, a
// moldura de altura fixa dos gráficos e o paginador do cabeçalho.

import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';
import { cn } from '../../utils/cn.ts';

export function Kpi(props: {
  rotulo: string;
  valor: string;
  unidade?: string;
  /** Variação relativa (0,12 = +12%). */
  delta?: number | null;
  /** `false` quando subir é ruim. */
  deltaBom?: boolean;
  desc?: string;
  destaque?: boolean;
  title?: string;
  children?: ReactNode;
}) {
  const { delta } = props;
  const temDelta = delta !== null && delta !== undefined && Number.isFinite(delta);
  const sentido =
    !temDelta || delta === 0 ? '' : delta > 0 === (props.deltaBom ?? true) ? 'sobe' : 'desce';
  return (
    <div className={cn('ins-kpi', props.destaque && 'destaque')} title={props.title}>
      <span className="ins-kpi-rotulo">{props.rotulo}</span>
      <span className="ins-kpi-linha">
        <span className="ins-kpi-valor">
          {props.valor}
          {props.unidade ? <small>{props.unidade}</small> : null}
        </span>
        {temDelta ? (
          <span className={cn('ins-delta', sentido)}>
            {delta > 0 ? '↑' : delta < 0 ? '↓' : '→'} {Math.abs(delta * 100).toFixed(0)}%
          </span>
        ) : null}
      </span>
      {props.children}
      {props.desc ? <span className="ins-kpi-desc">{props.desc}</span> : null}
    </div>
  );
}

export interface ItemDeLegenda {
  rotulo: string;
  cor: string;
  forma?: 'linha' | 'tracejada' | 'bola';
}

export function Legenda({ itens }: { itens: readonly ItemDeLegenda[] }) {
  return (
    <div className="ins-legenda">
      {itens.map((i) => (
        <span key={i.rotulo}>
          <i
            className={i.forma}
            style={i.forma === 'tracejada' ? { borderColor: i.cor } : { background: i.cor }}
          />
          {i.rotulo}
        </span>
      ))}
    </div>
  );
}

/** A caixa de dica de todos os gráficos: título e pares rótulo → valor. */
export function Dica(props: {
  titulo?: string;
  linhas: readonly ([string, string] | null | false)[];
}) {
  return (
    <div className="ins-dica">
      {props.titulo ? <b>{props.titulo}</b> : null}
      {props.linhas
        .filter((l): l is [string, string] => Boolean(l))
        .map(([r, v]) => (
          <div key={r}>
            <span>{r}</span>
            <span>{v}</span>
          </div>
        ))}
    </div>
  );
}

export function Rodape({ children }: { children: ReactNode }) {
  return <p className="ins-rodape">{children}</p>;
}

/** Gráfico de altura fixa: o `ResponsiveContainer` precisa de um pai com altura. */
export function Grafico({ altura, children }: { altura: number; children: ReactElement }) {
  const estilo: CSSProperties = { height: altura, minWidth: 0 };
  return (
    <div style={estilo}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Página de um gráfico de barras por técnico. Gráfico não rola: pagina (CLAUDE.md, Tela).
 * Vai no cabeçalho do cartão, ao lado do título.
 */
export function Paginador(props: {
  pagina: number;
  total: number;
  porPagina: number;
  aoMudar: (p: number) => void;
}) {
  const paginas = Math.max(1, Math.ceil(props.total / props.porPagina));
  if (paginas <= 1) return null;
  const de = props.pagina * props.porPagina + 1;
  const ate = Math.min(props.total, de + props.porPagina - 1);
  return (
    <span className="ins-pagina" role="group" aria-label="Página do gráfico">
      <button
        type="button"
        disabled={props.pagina === 0}
        onClick={() => props.aoMudar(props.pagina - 1)}
        aria-label="Anteriores"
      >
        ‹
      </button>
      <span>
        {de}–{ate} de {props.total}
      </span>
      <button
        type="button"
        disabled={props.pagina >= paginas - 1}
        onClick={() => props.aoMudar(props.pagina + 1)}
        aria-label="Próximos"
      >
        ›
      </button>
    </span>
  );
}

/** Valor numérico de uma prop do Recharts (que tipa x/y/largura como `number | string`). */
export const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
