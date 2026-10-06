// Uma linha do ranking: o trilho, a barra, o rótulo (dentro da barra quando cabe, fora
// quando não) e o valor na ponta. Ver `RankingBarra.tsx`.

import { formata } from '../../../utils/formato.ts';
import type { TipoDeValor } from '../../../services/dashboardService.ts';

/** ~5,6px por caractere na fonte do rótulo (mesma conta do gráfico), 8px de folga em cada ponta. */
const PX_POR_CARACTERE = 5.6;
const FOLGA_ROTULO = 16;

export function truncado(texto: string, orcamentoPx: number): string {
  const cabem = Math.max(1, Math.floor(orcamentoPx / PX_POR_CARACTERE));
  return texto.length <= cabem ? texto : texto.slice(0, Math.max(1, cabem - 1)) + '…';
}

export function LinhaDoRanking(props: {
  rotulo: string;
  valor: number | null;
  /** A posição no ranking inteiro, a partir de 1. */
  posicao: number;
  y0: number;
  alturaLinha: number;
  larguraTotal: number;
  larguraDaCaixa: number;
  esquerda: number;
  maior: number;
  corBarra: string;
  corDoRotuloDentro: string;
  tipo: TipoDeValor;
  sob: boolean;
  classe: string;
  aoClicar: () => void;
  aoEntrar: () => void;
  aoSair: () => void;
}) {
  const { rotulo, valor, posicao, y0, alturaLinha, larguraTotal, esquerda } = props;
  const meio = y0 + alturaLinha / 2 + 4;
  const fracao = props.maior > 0 ? Math.max(0, valor ?? 0) / props.maior : 0;
  const largBarra = valor && valor > 0 ? Math.max(3, fracao * larguraTotal) : 0;
  const prefixo = `${posicao}º `;
  const orcamentoDentro = largBarra - FOLGA_ROTULO - prefixo.length * PX_POR_CARACTERE;
  const cabeDentro = orcamentoDentro >= PX_POR_CARACTERE * 2;
  const rotuloDeFora = truncado(
    rotulo,
    larguraTotal - largBarra - 12 - prefixo.length * PX_POR_CARACTERE,
  );
  return (
    <g
      className={props.classe}
      onClick={props.aoClicar}
      onMouseEnter={props.aoEntrar}
      onMouseLeave={props.aoSair}
    >
      <rect
        className={`banda${props.sob ? ' sob' : ''}`}
        x={0}
        y={y0}
        width={props.larguraDaCaixa}
        height={alturaLinha}
        rx={4}
      />
      <rect
        className="ranking-trilho"
        x={esquerda}
        y={y0}
        width={larguraTotal}
        height={alturaLinha}
        rx={4}
      />
      {largBarra > 0 ? (
        <rect
          className="ranking-preenche"
          x={esquerda}
          y={y0}
          width={largBarra}
          height={alturaLinha}
          rx={4}
          fill={props.corBarra}
        />
      ) : null}
      {cabeDentro ? (
        <text
          className="ranking-rotulo-dentro"
          x={esquerda + 8}
          y={meio}
          textAnchor="start"
          fill={props.corDoRotuloDentro}
        >
          {prefixo}
          {truncado(rotulo, orcamentoDentro)}
        </text>
      ) : (
        <text
          className="ranking-rotulo-fora"
          x={esquerda + largBarra + 8}
          y={meio}
          textAnchor="start"
        >
          {prefixo}
          {rotuloDeFora}
        </text>
      )}
      <text className="ranking-valor" x={esquerda + larguraTotal + 8} y={meio} textAnchor="start">
        {formata(valor, props.tipo).texto}
      </text>
      <title>{`${posicao}º · ${rotulo}: ${formata(valor, props.tipo).texto}`}</title>
    </g>
  );
}
