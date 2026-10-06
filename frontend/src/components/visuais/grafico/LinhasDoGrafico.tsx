// As séries de linha desenhadas por cima das colunas, e o rótulo do maior valor de cada
// uma. A faceta (linhas num painel próprio, embaixo) é `FacetaDeLinha.tsx`.

import { inteiro } from '../../../utils/formato.ts';
import { caminhoDaSerie, maiorIndice } from '../../../utils/graficoEixo.ts';
import type { SerieDesenhada } from './ColunasDoGrafico.tsx';
import type { Geometria } from './geometria.ts';

export function LinhasDoGrafico(props: {
  linhas: readonly SerieDesenhada[];
  categorias: readonly { rotulo: string }[];
  geo: Geometria;
}) {
  const { linhas, categorias, geo } = props;
  return (
    <>
      {linhas.map((s) => (
        <g key={s.chave}>
          <path className="linha-serie" d={caminhoDaSerie(s.valores, geo.xMeio, geo.y)} stroke={s.cor} />
          {s.valores.map((v, i) =>
            v === null ? null : (
              <circle key={i} className="ponto-serie" cx={geo.xMeio(i)} cy={geo.y(v)} r={4} fill={s.cor}>
                <title>{`${categorias[i]?.rotulo ?? ''} · ${s.nome}: ${inteiro(v)}`}</title>
              </circle>
            ),
          )}
        </g>
      ))}

      {linhas.map((s) => {
        const iMax = maiorIndice(s.valores);
        if (iMax === null) return null;
        return (
          <text key={s.chave} className="rotulo-valor" x={geo.xMeio(iMax)} y={geo.y(s.valores[iMax]!) - 9} textAnchor="middle">
            {inteiro(s.valores[iMax]!)}
          </text>
        );
      })}
    </>
  );
}
