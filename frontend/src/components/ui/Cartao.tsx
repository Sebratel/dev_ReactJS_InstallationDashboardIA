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
import { useModo } from '../../context/ModoContext.tsx';
import { alturaDoConteudo, type AlturaDeVisual } from '../../utils/alturaDoConteudo.ts';
import { cn } from '../../utils/cn.ts';

// `alturaDoConteudo`/`AlturaDeVisual` moraram aqui até esta linha; agora vêm de
// `alturaDoConteudo.ts` (sem JSX, importável por `backend/tools/layout`) e são reexportados
// para `VisualPronto.tsx`/`SobDemanda.tsx` não precisarem trocar de import.
export { alturaDoConteudo, type AlturaDeVisual };

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
  const { conferencia } = useModo();
  const altura = CLASSE_DE_ALTURA[props.altura ?? 'auto'];

  return (
    <section className={cn('cartao', altura, props.largo && 'largo')}>
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
