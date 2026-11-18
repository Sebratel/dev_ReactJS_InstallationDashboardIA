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
import { AlertTriangle } from 'lucide-react';
import { useModo } from '../../context/ModoContext.tsx';
import { useContextoDaPagina } from '../../context/ContextoDaPagina.tsx';
import { ehVisualComIaNaTela } from '../../services/iaService.ts';
import { BotaoInsights } from '../ia/InsightsIA.tsx';
import { alturaDoConteudo, type AlturaDeVisual } from '../../utils/alturaDoConteudo.ts';
import { cn } from '../../utils/cn.ts';
import { IdVisual } from './IdVisual.tsx';

// `alturaDoConteudo`/`AlturaDeVisual` moraram aqui até esta linha; agora vêm de
// `alturaDoConteudo.ts` (sem JSX, importável por `backend/tools/layout`) e são reexportados
// para `VisualPronto.tsx`/`SobDemanda.tsx` não precisarem trocar de import.
export { alturaDoConteudo, type AlturaDeVisual };

/** Os controles que cada visual põe no cabeçalho (exportar, transpor, paginar, buscar)
 *  são o `.btn-exportar` do COM: pílula de contorno claro sobre a faixa bordô, que vira
 *  branca com a letra na primária no hover. O ícone é irmão do texto e a linha de base
 *  não os alinha — `inline-flex` centraliza os dois. */
const ACOES = cn(
  'flex flex-[0_0_auto] items-center gap-[6px] normal-case',
  // 17/11/2026: cantos retos e 22px, o `.btn-cab` da Manutenção (era pílula).
  '[&_:is(button,input)]:rounded-[4px] [&_:is(button,input)]:border-pbi-sobre-primary-fraco',
  '[&_:is(button,input)]:bg-transparent [&_:is(button,input)]:px-[7px] [&_:is(button,input)]:py-0 [&_:is(button,input)]:h-[22px]',
  '[&_:is(button,input)]:text-[11px] [&_:is(button,input)]:font-semibold [&_:is(button,input)]:text-pbi-sobre-primary',
  '[&_button]:inline-flex [&_button]:items-center [&_button]:gap-[4px]',
  '[&_button:hover]:bg-pbi-sobre-primary/15',
  '[&_input]:font-normal [&_input]:placeholder:text-pbi-sobre-primary-fraco',
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
  const contexto = useContextoDaPagina();
  const altura = CLASSE_DE_ALTURA[props.altura ?? 'auto'];
  const temInsightsIa = Boolean(
    contexto && props.id && ehVisualComIaNaTela(contexto.pagina, props.id),
  );

  return (
    // A MOLDURA (`.cartao`, `.v-*`, `.cartao-corpo`) fica no `estilo.css`: é a conta de
    // altura que faz a tela caber, e `useAlturaMedida` a procura pela classe.
    <section data-visual className={cn('cartao', altura, props.largo && 'largo')}>
      {/* O cabeçalho do `.visual` da Manutenção (17/11/2026): faixa bordô com o título à
          ESQUERDA e as ações encostadas à direita; o subtítulo sai da faixa e vem logo
          abaixo dela, em texto discreto. Antes era tudo centralizado dentro da faixa, com
          o subtítulo em 10px — o desenho antigo do relatório. */}
      <header className="flex min-h-[32px] flex-[0_0_auto] items-center bg-pbi-primary px-[8px] pl-[12px] text-pbi-sobre-primary">
        <div className="flex min-w-0 flex-1 items-center gap-x-[8px] py-[5px] leading-[1.2]">
          <h2
            title={props.titulo}
            className="m-0 min-w-0 flex-1 truncate text-[12.5px] font-semibold tracking-[0.3px] uppercase"
          >
            {props.titulo}
          </h2>
          {props.acoes || temInsightsIa || (conferencia && props.id) ? (
            <div className={ACOES}>
              {props.acoes}
              {temInsightsIa && contexto && props.id ? (
                <BotaoInsights
                  pagina={contexto.pagina}
                  visualId={props.id}
                  titulo={props.titulo}
                  filtros={contexto.filtros}
                  clicados={contexto.clicados}
                />
              ) : null}
              {conferencia && props.id ? (
                <IdVisual id={props.id} title="id do visual na spec" />
              ) : null}
            </div>
          ) : null}
        </div>
      </header>
      {props.sub ? (
        <p
          title={props.sub}
          className="m-0 flex-[0_0_auto] truncate px-[12px] pt-[6px] text-[11.5px] leading-[1.4] text-pbi-muted"
        >
          {props.sub}
        </p>
      ) : null}
      <div className="cartao-corpo">{props.children}</div>
    </section>
  );
}

/** O aviso do COM (`.banner`): fundo suave do tom, borda fina e um filete de 3px à
 *  esquerda na cor cheia, letra escurecida e o ícone na frente (cor cheia é fundo). */
const CAIXA =
  'flex items-start gap-[7px] rounded-[6px] border border-l-[3px] px-[11px] py-[6px] text-[12px] leading-[1.45] [&>svg]:mt-[2px] [&>svg]:flex-none';

export function Erro({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        CAIXA,
        'border-pbi-critico border-l-pbi-critico bg-pbi-erro-bg whitespace-pre-wrap text-pbi-critico-texto',
      )}
    >
      <AlertTriangle size={14} aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Aviso({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        CAIXA,
        'border-pbi-gold-200 border-l-pbi-gold bg-pbi-aviso-bg text-pbi-gold-600',
      )}
    >
      <AlertTriangle size={14} aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
