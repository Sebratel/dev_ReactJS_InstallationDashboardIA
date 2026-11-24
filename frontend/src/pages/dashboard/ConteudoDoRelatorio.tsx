// O corpo de uma aba DO RELATÓRIO: a faixa de conferência, o esqueleto enquanto o
// cálculo não chega, a faixa de indicadores (ou a capa) e a grade de visuais.
//
// Saiu de dentro da `DashboardPage`, onde era o ramo final de uma cadeia de quatro
// ternários no JSX. As outras abas (Configurações, Metas, Insights) não passam por
// aqui: elas não têm layout, filtro nem dado de snapshot.

import type { RefObject } from 'react';
import type {
  FiltroDaTela,
  LayoutSpec,
  PaginaCalculada,
  RespostaSaude,
  VisualCalculado,
} from '../../services/dashboardService.ts';
import type { AoFiltrar, CampoClicado } from '../../utils/rota.ts';
import { EsqueletoDaPagina } from '../../components/layout/EsqueletoDaPagina.tsx';
import { FaixaDeConferencia } from '../../components/layout/FaixaDeConferencia.tsx';
import { Capa } from '../../components/capa/Capa.tsx';
import { KpiGridSection } from '../../components/visuais/KpiGridSection.tsx';
import { VisualGridSection } from '../../components/visuais/VisualGridSection.tsx';
import { Esqueleto, MensagemDeEstado } from '../../components/ui/Estado.tsx';

/** A aba de abertura é a única tela escrita à mão — ver `AberturaOuIndicadores`. */
const ABA_CAPA = 'capa';

interface ConteudoDoRelatorioProps {
  abaAberta: string;
  /** A página calculada desta aba; `null` enquanto o cálculo da aba nova não chegou. */
  paginaCalculada: PaginaCalculada | null;
  layout: LayoutSpec | null;
  visuais: VisualCalculado[];
  filtros: FiltroDaTela[];
  clicados: CampoClicado[];
  saude: RespostaSaude | null;
  quantidadeDeTelas: number;
  /** O modo conferência mostra a faixa com o resumo do cálculo. */
  emConferencia: boolean;
  /** Há erro na tela: o esqueleto não aparece por cima da mensagem. */
  temErro: boolean;
  aoFiltrarAlvos: AoFiltrar;
  aoPreverAlvos: AoFiltrar;
  /** Mede a distância do topo do conteúdo até o primeiro card (`--h-antes`). */
  refDoEspacoAntesDosVisuais: RefObject<HTMLDivElement | null>;
}

/**
 * A CAPA é a única tela escrita à mão, e o motivo é medido: das 30 formas que a spec
 * traz para ela, 28 não têm número — a tela gerada renderizava DOIS cartões de indicador
 * num vazio. Os dois KPIs são dado de verdade e continuam na tela, como selo da faixa.
 */
function AberturaOuIndicadores({
  abaAberta,
  paginaCalculada,
  saude,
  quantidadeDeTelas,
  layout,
  visuais,
}: Pick<
  ConteudoDoRelatorioProps,
  'abaAberta' | 'paginaCalculada' | 'saude' | 'quantidadeDeTelas' | 'layout' | 'visuais'
>) {
  if (abaAberta === ABA_CAPA) {
    return (
      <Capa
        dadoDe={paginaCalculada?.dadoDe ?? null}
        saude={saude}
        telas={quantidadeDeTelas}
        visuais={visuais}
      />
    );
  }
  return <KpiGridSection layout={layout} visuais={visuais} />;
}

/**
 * O que ocupa a tela enquanto o cálculo da aba não chegou.
 *
 * Com o layout em mãos, o esqueleto copia a forma real da página. Sem ele há uma janela
 * residual — tipicamente um sub-frame (Fase L4: o endpoint é um mapa em memória) — e o
 * bloco genérico é o que resta.
 */
function EsqueletoDeEspera({ layout }: { layout: LayoutSpec | null }) {
  return layout ? <EsqueletoDaPagina layout={layout} /> : <Esqueleto />;
}

export function ConteudoDoRelatorio({
  abaAberta,
  paginaCalculada,
  layout,
  visuais,
  filtros,
  clicados,
  saude,
  quantidadeDeTelas,
  emConferencia,
  temErro,
  aoFiltrarAlvos,
  aoPreverAlvos,
  refDoEspacoAntesDosVisuais,
}: ConteudoDoRelatorioProps) {
  const esperandoCalculo = paginaCalculada === null && !temErro;
  const nenhumVisualTemNumero =
    paginaCalculada !== null && visuais.every((visual) => visual.conteudo === null);

  return (
    <>
      {emConferencia && paginaCalculada ? (
        <FaixaDeConferencia pagina={paginaCalculada} filtros={filtros} />
      ) : null}

      {esperandoCalculo ? <EsqueletoDeEspera layout={layout} /> : null}

      <AberturaOuIndicadores
        abaAberta={abaAberta}
        paginaCalculada={paginaCalculada}
        saude={saude}
        quantidadeDeTelas={quantidadeDeTelas}
        layout={layout}
        visuais={visuais}
      />

      {/* O `div` existe para medir: é dele que sai `--h-antes`, a distância do topo do
          conteúdo até o primeiro card. Só montamos a grade depois que `paginaCalculada`
          chega — antes disso `visuais` está vazio e todos os cartões cairiam em
          `VisualNaDobra`, disparando uma rajada de pedidos paralelos à abertura. */}
      <div ref={refDoEspacoAntesDosVisuais}>
        {paginaCalculada !== null ? (
          <VisualGridSection
            pagina={abaAberta}
            layout={layout}
            visuais={visuais}
            filtros={filtros}
            clicados={clicados}
            aoFiltrar={aoFiltrarAlvos}
            aoPrever={aoPreverAlvos}
          />
        ) : null}
      </div>

      {nenhumVisualTemNumero ? (
        <MensagemDeEstado como="div">Esta página não tem visual com número.</MensagemDeEstado>
      ) : null}
    </>
  );
}
