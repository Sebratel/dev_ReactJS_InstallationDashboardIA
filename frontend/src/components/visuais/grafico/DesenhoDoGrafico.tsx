// O `<svg>` do gráfico, na ordem em que as camadas se sobrepõem: grade, colunas, eixo,
// rótulos do eixo, linhas e, quando há, a faceta das linhas embaixo.

import type { TipoDeValor } from '../../../services/dashboardService.ts';
import type { InteracaoDoGrafico } from '../../../hooks/useCliqueNoEixo.ts';
import { inteiro } from '../../../utils/formato.ts';
import { ColunasDoGrafico, type ModoDeRotulo, type SerieDesenhada } from './ColunasDoGrafico.tsx';
import { EixoXDoGrafico } from './EixoXDoGrafico.tsx';
import { FacetaDeLinha } from './FacetaDeLinha.tsx';
import { LinhasDoGrafico } from './LinhasDoGrafico.tsx';
import { FACETA, MARGEM, type Geometria } from './geometria.ts';

export function DesenhoDoGrafico(props: {
  largura: number;
  altura: number;
  ariaLabel: string;
  categorias: readonly { rotulo: string }[];
  /** Os níveis de cada categoria visível, sem o prefixo comum — ver `EixoXDoGrafico`. */
  partes: readonly (readonly string[])[];
  areas: readonly SerieDesenhada[];
  linhas: readonly SerieDesenhada[];
  empilha: boolean;
  percentual: boolean;
  naFaceta: boolean;
  tipo: TipoDeValor;
  /** As casas do `format` da medida (`"0.0"` → 1), ou `null` para o genérico da tela. */
  casas: number | null;
  marcas: readonly number[];
  geo: Geometria;
  interacao: InteracaoDoGrafico;
  /** Onde o número das COLUNAS é escrito — ver `ModoDeRotulo`. */
  rotulos: ModoDeRotulo;
  /** Escrever todos os pontos da linha, não só o maior de cada série. */
  rotulosDeLinha: boolean;
}) {
  const { largura, altura, categorias, geo, marcas } = props;
  return (
    <svg
      className="grafico-svg"
      width={largura}
      height={altura}
      role="img"
      aria-label={props.ariaLabel}
    >
      {marcas.map((m) => (
        <g key={m}>
          <line
            className="grade"
            x1={MARGEM.esquerda}
            x2={largura - MARGEM.direita}
            y1={geo.y(m)}
            y2={geo.y(m)}
          />
          <text className="tick" x={MARGEM.esquerda - 8} y={geo.y(m) + 3.5} textAnchor="end">
            {props.percentual ? `${m}%` : inteiro(m)}
          </text>
        </g>
      ))}
      <ColunasDoGrafico
        categorias={categorias}
        areas={props.areas}
        empilha={props.empilha}
        percentual={props.percentual}
        tipo={props.tipo}
        casas={props.casas}
        geo={geo}
        interacao={props.interacao}
        rotulos={props.rotulos}
      />
      <line
        className="eixo"
        x1={MARGEM.esquerda}
        x2={largura - MARGEM.direita}
        y1={geo.y(0)}
        y2={geo.y(0)}
      />
      {/* Rótulo girado a 45° só cabe se a margem de baixo der ~34px. */}
      <EixoXDoGrafico
        categorias={categorias}
        partes={props.partes}
        geo={geo}
        cabemRotulos={geo.base >= 34}
        sob={props.interacao.sob}
      />
      <LinhasDoGrafico
        linhas={props.naFaceta ? [] : props.linhas}
        categorias={categorias}
        geo={geo}
        casas={props.casas}
        todosOsPontos={props.rotulosDeLinha}
      />
      {props.naFaceta ? (
        <FacetaDeLinha
          series={props.linhas}
          xMeio={geo.xMeio}
          topoDoPainel={altura - FACETA + 6}
          altura={FACETA - 22}
          esquerda={MARGEM.esquerda}
          direita={largura - MARGEM.direita}
        />
      ) : null}
    </svg>
  );
}
