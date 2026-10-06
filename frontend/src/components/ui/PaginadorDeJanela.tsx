// « ‹ 1–30 de 197 › » — a janela de categorias do gráfico, de linhas do ranking e de
// colunas da matriz. Eram três cópias da mesma marcação; o que muda entre elas são os
// textos de ajuda (no gráfico a última página é a mais recente, no ranking é o menor
// valor) e o elemento de fora (na matriz ele fica entre outros botões, como `span`).
//
// GRÁFICO NÃO ROLA: ELE PAGINA — ver `Grafico.tsx`.

import { inteiro } from '../../utils/formato.ts';

export interface TitulosDoPaginador {
  primeira: string;
  anterior: string;
  proxima: string;
  ultima: string;
}

export function PaginadorDeJanela(props: {
  /** Índice do primeiro item visível. */
  de: number;
  /** Índice depois do último visível. */
  ate: number;
  total: number;
  /** O maior `de` possível — a última página. */
  maxInicio: number;
  /** Quantos itens uma página anda. */
  passo: number;
  aoIr: (inicio: number) => void;
  titulos: TitulosDoPaginador;
  /** O `title` do conjunto ("197 categorias no total"). */
  resumo: string;
  elemento?: 'div' | 'span';
}) {
  const { de, ate, total, maxInicio, passo, aoIr, titulos } = props;
  const Elemento = props.elemento ?? 'div';
  const anda = (sentido: number) => aoIr(Math.max(0, Math.min(maxInicio, de + sentido * passo)));
  return (
    <Elemento className="paginador-grafico" title={props.resumo}>
      <button type="button" title={titulos.primeira} disabled={de === 0} onClick={() => aoIr(0)}>
        «
      </button>
      <button type="button" title={titulos.anterior} disabled={de === 0} onClick={() => anda(-1)}>
        ‹
      </button>
      <span className="paginador-rotulo">
        {inteiro(de + 1)}–{inteiro(ate)} <span className="de">de {inteiro(total)}</span>
      </span>
      <button type="button" title={titulos.proxima} disabled={de >= maxInicio} onClick={() => anda(1)}>
        ›
      </button>
      <button type="button" title={titulos.ultima} disabled={de >= maxInicio} onClick={() => aoIr(maxInicio)}>
        »
      </button>
    </Elemento>
  );
}
