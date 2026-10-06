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
  const y = (v: number) => topoDoPainel + altura * (1 - v / topo);

  return (
    <g>
      {marcas.map((m) => (
        <g key={m}>
          <line className="grade" x1={esquerda} x2={direita} y1={y(m)} y2={y(m)} />
          <text className="tick" x={esquerda - 8} y={y(m) + 3.5} textAnchor="end">
            {inteiro(m)}
          </text>
        </g>
      ))}
      {series.map((s) => (
        <g key={s.chave}>
          <path className="linha-serie" d={caminhoDaSerie(s.valores, xMeio, y)} stroke={s.cor} />
          {s.valores.map((v, i) =>
            v === null ? null : (
              <circle key={i} className="ponto-serie" cx={xMeio(i)} cy={y(v)} r={4} fill={s.cor} />
            ),
          )}
        </g>
      ))}
    </g>
  );
}
