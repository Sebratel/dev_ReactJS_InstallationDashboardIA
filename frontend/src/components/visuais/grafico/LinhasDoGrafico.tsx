// As séries de linha desenhadas por cima das colunas, e o rótulo do maior valor de cada
// uma. A faceta (linhas num painel próprio, embaixo) é `FacetaDeLinha.tsx`.

import { formata, inteiro } from '../../../utils/formato.ts';
import { caminhoDaSerie, maiorIndice } from '../../../utils/graficoEixo.ts';
import type { SerieDesenhada } from './ColunasDoGrafico.tsx';
import type { Geometria } from './geometria.ts';

export function LinhasDoGrafico(props: {
  linhas: readonly SerieDesenhada[];
  categorias: readonly { rotulo: string }[];
  geo: Geometria;
  /**
   * As casas que o `format` da medida pede. Sem elas o número da linha saía SEMPRE
   * inteiro (`inteiro`) — o `PRAZO MÉDIO (DIAS)`, que é `"0.0"`, virava `5` em vez de
   * `5,3`, e a mesma medida lia diferente em coluna e em linha (19/11/2026).
   */
  casas?: number | null;
  /**
   * Escrever TODOS os pontos, não só o maior de cada série.
   *
   * O rótulo-só-do-maior nasceu para o combo, em que a linha passa por cima de colunas que
   * já trazem os próprios números. Num gráfico que é SÓ linha — PROTOCOLOS REALIZADOS,
   * PROTOCOLOS GERADOS, o prazo do RELATÓRIO DO ANO — ele deixa a tela com um número só, e
   * o print que o gestor manda no grupo sai sem valor legível (pedido de 19/11/2026).
   * `Grafico.tsx` só liga isto com UMA série e poucas categorias: duas linhas rotuladas
   * ponto a ponto se cruzam e o número deixa de ter dono.
   */
  todosOsPontos?: boolean;
}) {
  const { linhas, categorias, geo } = props;
  const todos = props.todosOsPontos === true;
  const fmt = (v: number): string =>
    props.casas === undefined || props.casas === null
      ? inteiro(v)
      : formata(v, 'number', { casas: props.casas }).texto;
  return (
    <>
      {linhas.map((s) => (
        <g key={s.chave}>
          <path
            className="linha-serie"
            d={caminhoDaSerie(s.valores, geo.xMeio, geo.y)}
            stroke={s.cor}
          />
          {s.valores.map((v, i) =>
            v === null ? null : (
              <circle
                key={i}
                className="ponto-serie"
                cx={geo.xMeio(i)}
                cy={geo.y(v)}
                r={4}
                fill={s.cor}
              >
                <title>{`${categorias[i]?.rotulo ?? ''} · ${s.nome}: ${fmt(v)}`}</title>
              </circle>
            ),
          )}
        </g>
      ))}

      {linhas.map((s) => {
        if (todos) {
          return (
            <g key={s.chave}>
              {s.valores.map((v, i) =>
                v === null ? null : (
                  <text
                    key={i}
                    className="rotulo-valor"
                    x={geo.xMeio(i)}
                    y={geo.y(v) - 9}
                    textAnchor="middle"
                    pointerEvents="none"
                  >
                    {fmt(v)}
                  </text>
                ),
              )}
            </g>
          );
        }
        const iMax = maiorIndice(s.valores);
        if (iMax === null) return null;
        return (
          <text
            key={s.chave}
            className="rotulo-valor"
            x={geo.xMeio(iMax)}
            y={geo.y(s.valores[iMax]!) - 9}
            textAnchor="middle"
          >
            {fmt(s.valores[iMax]!)}
          </text>
        );
      })}
    </>
  );
}
