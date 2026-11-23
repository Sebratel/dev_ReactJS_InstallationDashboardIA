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
  const fmt = (valor: number): string =>
    props.casas === undefined || props.casas === null
      ? inteiro(valor)
      : formata(valor, 'number', { casas: props.casas }).texto;
  return (
    <>
      {linhas.map((linha) => (
        <g key={linha.chave}>
          <path
            className="linha-serie"
            d={caminhoDaSerie(linha.valores, geo.xMeio, geo.y)}
            stroke={linha.cor}
          />
          {linha.valores.map((valor, indice) =>
            valor === null ? null : (
              <circle
                key={indice}
                className="ponto-serie"
                cx={geo.xMeio(indice)}
                cy={geo.y(valor)}
                r={4}
                fill={linha.cor}
              >
                <title>{`${categorias[indice]?.rotulo ?? ''} · ${linha.nome}: ${fmt(valor)}`}</title>
              </circle>
            ),
          )}
        </g>
      ))}

      {linhas.map((linha) => {
        if (todos) {
          return (
            <g key={linha.chave}>
              {linha.valores.map((valor, indice) =>
                valor === null ? null : (
                  <text
                    key={indice}
                    className="rotulo-valor"
                    x={geo.xMeio(indice)}
                    y={geo.y(valor) - 9}
                    textAnchor="middle"
                    pointerEvents="none"
                  >
                    {fmt(valor)}
                  </text>
                ),
              )}
            </g>
          );
        }
        const iMax = maiorIndice(linha.valores);
        if (iMax === null) return null;
        return (
          <text
            key={linha.chave}
            className="rotulo-valor"
            x={geo.xMeio(iMax)}
            y={geo.y(linha.valores[iMax]!) - 9}
            textAnchor="middle"
          >
            {fmt(linha.valores[iMax]!)}
          </text>
        );
      })}
    </>
  );
}
