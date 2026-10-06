// As colunas (empilhadas ou agrupadas), uma `<g>` por categoria, com a faixa clicável
// atrás. É a parte de `Grafico.tsx` que desenha as séries de área.

import type { TipoDeValor } from '../../../services/dashboardService.ts';
import { formata } from '../../../utils/formato.ts';
import type { InteracaoDoGrafico } from '../../../hooks/useCliqueNoEixo.ts';
import { MARGEM, VAO, type Geometria } from './geometria.ts';

export interface SerieDesenhada {
  chave: string;
  nome: string;
  cor: string;
  valores: (number | null)[];
}

export function ColunasDoGrafico(props: {
  categorias: readonly { rotulo: string }[];
  areas: readonly SerieDesenhada[];
  empilha: boolean;
  percentual: boolean;
  tipo: TipoDeValor;
  geo: Geometria;
  interacao: InteracaoDoGrafico;
}) {
  const { categorias, areas, empilha, percentual, geo, interacao } = props;

  /** A soma da pilha numa categoria — o divisor do modo percentual. */
  const somaEm = (i: number) => areas.reduce((a, s) => a + (s.valores[i] ?? 0), 0);
  const valorDesenhado = (v: number | null, i: number): number | null => {
    if (v === null) return null;
    if (!percentual) return v;
    const soma = somaEm(i);
    return soma > 0 ? (v / soma) * 100 : null;
  };

  return (
    <>
      {categorias.map((c, i) => {
        const acumulado = { alto: 0 };
        return (
          <g
            key={i}
            className={interacao.classeDa(i)}
            onClick={() => interacao.clica(i)}
            onMouseEnter={() => interacao.aoEntrar(i)}
            onMouseLeave={interacao.aoSair}
          >
            <rect
              className={`banda${interacao.sob === i ? ' sob' : ''}`}
              x={MARGEM.esquerda + geo.banda * i}
              y={MARGEM.topo}
              width={geo.banda}
              height={geo.alturaDoPlot}
            />
            {areas.map((s, k) => {
              const v = valorDesenhado(s.valores[i] ?? null, i);
              if (v === null || v === 0) return null;
              const alturaCrua = (v / geo.topo) * geo.alturaDoPlot;
              const alto = Math.max(1, alturaCrua - (empilha ? VAO : 0));
              const cima = empilha ? MARGEM.topo + geo.alturaDoPlot - acumulado.alto - alto : geo.y(v);
              if (empilha) acumulado.alto += alturaCrua;
              const esquerda = empilha
                ? geo.xMeio(i) - geo.larguraDaFatia / 2
                : geo.xMeio(i) - geo.larguraDaMarca / 2 + k * (geo.larguraDaFatia + VAO);
              return (
                <rect
                  key={s.chave}
                  x={esquerda}
                  y={cima}
                  width={geo.larguraDaFatia}
                  height={Math.max(1, empilha ? alto : MARGEM.topo + geo.alturaDoPlot - cima)}
                  fill={s.cor}
                  rx={3}
                >
                  <title>{`${c.rotulo} · ${s.nome}: ${formata(s.valores[i] ?? null, props.tipo).texto}`}</title>
                </rect>
              );
            })}
          </g>
        );
      })}
    </>
  );
}
