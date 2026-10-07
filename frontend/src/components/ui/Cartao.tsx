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
import { IdVisual } from './IdVisual.tsx';

// `alturaDoConteudo`/`AlturaDeVisual` moraram aqui até esta linha; agora vêm de
// `alturaDoConteudo.ts` (sem JSX, importável por `backend/tools/layout`) e são reexportados
// para `VisualPronto.tsx`/`SobDemanda.tsx` não precisarem trocar de import.
export { alturaDoConteudo, type AlturaDeVisual };

/** Os controles que cada visual põe no cabeçalho (exportar, transpor, paginar, buscar)
 *  herdam a faixa colorida: fundo transparente, letra sobre a primária. O ícone é irmão do
 *  texto e a linha de base não os alinha — `inline-flex` centraliza os dois, senão o SVG
 *  desce a caixa do botão e empurra o corpo do card, a altura que `--util` já disputa. */
const ACOES = cn(
  'ml-auto flex flex-[0_0_auto] items-center gap-[6px]',
  '[&_:is(button,input)]:rounded-[2px] [&_:is(button,input)]:border-pbi-sobre-primary-fraco',
  '[&_:is(button,input)]:bg-transparent [&_:is(button,input)]:px-[8px] [&_:is(button,input)]:py-[2px]',
  '[&_:is(button,input)]:text-[0.68rem] [&_:is(button,input)]:text-pbi-sobre-primary',
  '[&_button]:inline-flex [&_button]:items-center [&_button]:gap-[4px]',
  '[&_button:hover]:bg-pbi-primary-dark [&_input]:placeholder:text-pbi-sobre-primary-fraco',
);

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
    // A MOLDURA (`.cartao`, `.v-*`, `.cartao-corpo`) fica no `estilo.css`: é a conta de
    // altura que faz a tela caber, e `useAlturaMedida` a procura pela classe.
    <section data-visual className={cn('cartao', altura, props.largo && 'largo')}>
      <div className="flex flex-[0_0_auto] items-center gap-[10px] bg-pbi-primary px-[10px] py-[5px] text-pbi-sobre-primary">
        <h2
          title={props.titulo}
          className="m-0 truncate text-[0.74rem] font-bold tracking-[0.02em]"
        >
          {props.titulo}
        </h2>
        {props.sub ? (
          <span title={props.sub} className="truncate text-[0.68rem] text-pbi-sobre-primary-fraco">
            {props.sub}
          </span>
        ) : null}
        {props.acoes || (conferencia && props.id) ? (
          <div className={ACOES}>
            {props.acoes}
            {conferencia && props.id ? (
              <IdVisual id={props.id} title="id do visual na spec" />
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="cartao-corpo">{props.children}</div>
    </section>
  );
}

/** Caixa de mensagem: fundo suave do tom, letra escurecida, borda (cor cheia é fundo). */
const CAIXA = 'rounded-[2px] border px-[10px] py-[8px] text-[0.74rem] font-semibold';

export function Erro({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        CAIXA,
        'border-pbi-critico bg-pbi-erro-bg whitespace-pre-wrap text-pbi-critico-texto',
      )}
    >
      {children}
    </div>
  );
}

export function Aviso({ children }: { children: ReactNode }) {
  return (
    <div className={cn(CAIXA, 'border-pbi-gold-600 bg-pbi-aviso-bg text-pbi-gold-600')}>
      {children}
    </div>
  );
}
