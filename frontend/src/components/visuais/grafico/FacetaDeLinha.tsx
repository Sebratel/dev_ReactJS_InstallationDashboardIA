// As séries de linha num painel próprio, embaixo das colunas, com escala própria —
// quando a escala delas não convive com a das colunas (ver `graficoForma.ts`, `facetada`).

import { inteiro } from '../../../utils/formato.ts';
import { caminhoDaSerie } from '../../../utils/graficoEixo.ts';
import { maiorValorDe, marcasDoEixo } from '../../../utils/graficoForma.ts';

export function FacetaDeLinha({
  series,
  xMeio,
  topoDoPainel,
  altura,
  esquerda,
  direita,
}: {
  series: readonly { chave: string; nome: string; cor: string; valores: (number | null)[] }[];
  xMeio: (i: number) => number;
  topoDoPainel: number;
  altura: number;
  esquerda: number;
  direita: number;
}) {
  const teto = maiorValorDe(series, 1);
  const marcas = marcasDoEixo(teto, 2);
  const topo = Math.max(...marcas, 1);
  const posY = (valor: number) => topoDoPainel + altura * (1 - valor / topo);

  return (
    <g>
      {marcas.map((medida) => (
        <g key={medida}>
          <line className="grade" x1={esquerda} x2={direita} y1={posY(medida)} y2={posY(medida)} />
          <text className="tick" x={esquerda - 8} y={posY(medida) + 3.5} textAnchor="end">
            {inteiro(medida)}
          </text>
        </g>
      ))}
      {series.map((serie) => (
        <g key={serie.chave}>
          <path
            className="linha-serie"
            d={caminhoDaSerie(serie.valores, xMeio, posY)}
            stroke={serie.cor}
          />
          {serie.valores.map((valor, indice) =>
            valor === null ? null : (
              <circle
                key={indice}
                className="ponto-serie"
                cx={xMeio(indice)}
                cy={posY(valor)}
                r={4}
                fill={serie.cor}
              />
            ),
          )}
        </g>
      ))}
    </g>
  );
}
