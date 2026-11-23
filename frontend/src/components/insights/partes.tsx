// Peças comuns das abas de insights: indicador, legenda, caixa de dica, rodapé, a
// moldura de altura fixa dos gráficos e o paginador do cabeçalho.

import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';
import { juntarClasses } from '../../utils/cn.ts';

/**
 * A classe do delta: `sobe` quando a variação vai para o lado bom, `desce` para o ruim,
 * vazio quando não variou. Qual lado é o bom vem de `deltaBom` — retrabalho que sobe é
 * ruim, ativação que sobe é boa.
 */
function sentidoDoDelta(delta: number, subirEhBom: boolean): string {
  if (delta === 0) return '';
  return delta > 0 === subirEhBom ? 'sobe' : 'desce';
}

/** A seta que acompanha o número do delta. */
function setaDoDelta(delta: number): string {
  if (delta > 0) return '↑';
  if (delta < 0) return '↓';
  return '→';
}

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
  const sentido = temDelta ? sentidoDoDelta(delta, props.deltaBom ?? true) : '';
  return (
    <div className={juntarClasses('ins-kpi', props.destaque && 'destaque')} title={props.title}>
      <span className="ins-kpi-rotulo">{props.rotulo}</span>
      <span className="ins-kpi-linha">
        <span className="ins-kpi-valor">
          {props.valor}
          {props.unidade ? <small>{props.unidade}</small> : null}
        </span>
        {temDelta ? (
          <span className={juntarClasses('ins-delta', sentido)}>
            {setaDoDelta(delta)} {Math.abs(delta * 100).toFixed(0)}%
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
      {itens.map((indice) => (
        <span key={indice.rotulo}>
          <i
            className={indice.forma}
            style={
              indice.forma === 'tracejada'
                ? { borderColor: indice.cor }
                : { background: indice.cor }
            }
          />
          {indice.rotulo}
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
        .filter((linha): linha is [string, string] => Boolean(linha))
        .map(([registro, valor]) => (
          <div key={registro}>
            <span>{registro}</span>
            <span>{valor}</span>
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
  const inicio = props.pagina * props.porPagina + 1;
  const ate = Math.min(props.total, inicio + props.porPagina - 1);
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
        {inicio}–{ate} de {props.total}
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
export const numero = (valor: unknown): number =>
  typeof valor === 'number' ? valor : Number(valor ?? 0);
