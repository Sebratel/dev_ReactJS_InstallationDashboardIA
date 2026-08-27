// A moldura de um visual: cabeçalho colorido, subtítulo e slot de ações.
//
// O padrão de dashboards põe **tudo que é "desta visão" no cabeçalho** — título,
// leitura auxiliar, exportação, granularidade — em vez de repetir markup em cada
// tela. Por isso as ações são prop, não filho: um bloco flutuante por cima do corpo
// (o `position: absolute` de antes) briga com a rolagem do card.
//
// A altura vem de `altura`, que é uma fração da área útil (`--util`), nunca um pixel
// chutado: gráfico maior que a tela é gráfico que ninguém vê inteiro.

import type { ReactNode } from 'react';
import type { VisualCalculado } from '../api.ts';
import { usaModo } from '../modo.tsx';

/** As faixas do padrão. `grafico` + `tabela` somam exatamente uma tela. */
export type AlturaDeVisual = 'grafico' | 'tabela' | 'meia' | 'matriz' | 'auto';

/**
 * A altura que um visual VAI ter quando terminar de carregar.
 *
 * O cartao de "carregando" e o de "nao calculou" precisam da **mesma** altura do
 * visual que os substitui. Sem isso a tela pula quando a resposta chega — e pula uma
 * vez por visual sob demanda, que e justamente o caso em que a espera e longa e a
 * pessoa esta olhando. `card` fica em `auto` de proposito: KPI tem altura propria.
 */
export function alturaDoConteudo(conteudo: VisualCalculado['conteudo']): AlturaDeVisual {
  switch (conteudo) {
    case 'grafico':
      return 'grafico';
    case 'tabela':
      return 'tabela';
    case 'matriz':
      return 'matriz';
    default:
      return 'auto';
  }
}

const CLASSE_DE_ALTURA: Record<AlturaDeVisual, string> = {
  grafico: 'v-grafico',
  tabela: 'v-tabela',
  meia: 'v-meia',
  matriz: 'v-matriz',
  auto: 'v-auto',
};

export function Cartao(props: {
  titulo: string;
  sub?: string;
  id?: string;
  largo?: boolean;
  altura?: AlturaDeVisual;
  acoes?: ReactNode;
  children: ReactNode;
}) {
  const { conferencia } = usaModo();
  const altura = CLASSE_DE_ALTURA[props.altura ?? 'auto'];

  return (
    <section className={`cartao ${altura}${props.largo ? ' largo' : ''}`}>
      <div className="cartao-topo">
        <h2 title={props.titulo}>{props.titulo}</h2>
        {props.sub ? (
          <span className="sub" title={props.sub}>
            {props.sub}
          </span>
        ) : null}
        {props.acoes || (conferencia && props.id) ? (
          <div className="cartao-acoes">
            {props.acoes}
            {conferencia && props.id ? (
              <span className="id-visual" title="id do visual na spec">
                {props.id}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="cartao-corpo">{props.children}</div>
    </section>
  );
}

export function Erro({ children }: { children: ReactNode }) {
  return <div className="erro">{children}</div>;
}
