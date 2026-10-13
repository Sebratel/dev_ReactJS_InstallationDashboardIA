// As colunas (empilhadas ou agrupadas), uma `<g>` por categoria, com a faixa clicável
// atrás. É a parte de `Grafico.tsx` que desenha as séries de área.
//
// A forma é a das colunas do COM · Gestão Comercial: topo arredondado em 4px só no alto
// da coluna (ou da pilha) — a base fica reta, ancorada no eixo —, a série única em
// dourado graduado pelo valor, e o valor num chip escuro acima da coluna quando cabe.

import type { TipoDeValor } from '../../../services/dashboardService.ts';
import { formata } from '../../../utils/formato.ts';
import { DOURADO, corDaColunaPorValor } from '../../../utils/graficoForma.ts';
import type { InteracaoDoGrafico } from '../../../hooks/useCliqueNoEixo.ts';
import { VAO, type Geometria } from './geometria.ts';

export interface SerieDesenhada {
  chave: string;
  nome: string;
  cor: string;
  valores: (number | null)[];
}

/** Acima de tantas categorias o chip vira ruído e a leitura fica com o `title` (COM). */
export const MAXIMO_COM_ROTULO = 24;
const RAIO = 4;
const FONTE_DO_CHIP = 11;

/** Retângulo com só os cantos de cima arredondados. */
function colunaDeTopoRedondo(x: number, y: number, w: number, h: number): string {
  const r = Math.max(0, Math.min(RAIO, w / 2, h));
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** O chip do valor: retângulo na cor do texto, letra na cor da superfície — escuro no
 *  tema claro e claro no escuro (`.chip-valor` no `estilo.css`). */
function ChipDeValor(props: { x: number; topo: number; texto: string }) {
  const w = Math.max(props.texto.length * FONTE_DO_CHIP * 0.58 + 10, 22);
  const h = FONTE_DO_CHIP + 7;
  const cy = props.topo - h / 2 - 3;
  return (
    <g className="chip-valor" pointerEvents="none">
      <rect x={props.x - w / 2} y={cy - h / 2} width={w} height={h} rx={3} />
      <text x={props.x} y={cy} textAnchor="middle" dominantBaseline="central">
        {props.texto}
      </text>
    </g>
  );
}

export function ColunasDoGrafico(props: {
  categorias: readonly { rotulo: string }[];
  areas: readonly SerieDesenhada[];
  empilha: boolean;
  percentual: boolean;
  tipo: TipoDeValor;
  geo: Geometria;
  interacao: InteracaoDoGrafico;
  /** Desenhar o chip de valor (decidido por `Grafico`, que reservou a margem). */
  comRotulos: boolean;
}) {
  const { categorias, areas, empilha, percentual, geo, interacao } = props;
  const base = geo.margemTopo + geo.alturaDoPlot;

  /** A soma da pilha numa categoria — o divisor do modo percentual. */
  const somaEm = (i: number) => areas.reduce((a, s) => a + (s.valores[i] ?? 0), 0);
  const valorDesenhado = (v: number | null, i: number): number | null => {
    if (v === null) return null;
    if (!percentual) return v;
    const soma = somaEm(i);
    return soma > 0 ? (v / soma) * 100 : null;
  };

  // Série única e dourada: a cor gradua com o valor, entre o menor e o maior da página.
  const unica = areas.length === 1 && areas[0]!.cor === DOURADO && !percentual ? areas[0]! : null;
  const visiveis = unica ? unica.valores.filter((v): v is number => v !== null) : [];
  const min = visiveis.length ? Math.min(...visiveis) : 0;
  const max = visiveis.length ? Math.max(...visiveis) : 0;

  return (
    <>
      {categorias.map((c, i) => {
        const acumulado = { alto: 0 };
        // A fatia de cima da pilha é a última com valor: só ela leva o topo redondo.
        let ultima = -1;
        areas.forEach((s, k) => {
          const v = valorDesenhado(s.valores[i] ?? null, i);
          if (v !== null && v !== 0) ultima = k;
        });
        let topoDaCategoria = base;
        const marcas = areas.map((s, k) => {
          const v = valorDesenhado(s.valores[i] ?? null, i);
          if (v === null || v === 0) return null;
          const alturaCrua = (v / geo.topo) * geo.alturaDoPlot;
          const alto = Math.max(1, alturaCrua - (empilha ? VAO : 0));
          const cima = empilha ? base - acumulado.alto - alto : geo.y(v);
          if (empilha) acumulado.alto += alturaCrua;
          const esquerda = empilha
            ? geo.xMeio(i) - geo.larguraDaFatia / 2
            : geo.xMeio(i) - geo.larguraDaMarca / 2 + k * (geo.larguraDaFatia + VAO);
          const altura = Math.max(1, empilha ? alto : base - cima);
          topoDaCategoria = Math.min(topoDaCategoria, cima);
          const cor = unica ? corDaColunaPorValor(v, min, max) : s.cor;
          const titulo = `${c.rotulo} · ${s.nome}: ${formata(s.valores[i] ?? null, props.tipo).texto}`;
          return !empilha || k === ultima ? (
            <path
              key={s.chave}
              d={colunaDeTopoRedondo(esquerda, cima, geo.larguraDaFatia, altura)}
              fill={cor}
            >
              <title>{titulo}</title>
            </path>
          ) : (
            <rect
              key={s.chave}
              x={esquerda}
              y={cima}
              width={geo.larguraDaFatia}
              height={altura}
              fill={cor}
            >
              <title>{titulo}</title>
            </rect>
          );
        });
        // O chip: o valor da série única, ou o total da pilha.
        const total = empilha
          ? somaEm(i)
          : areas.length === 1
            ? (areas[0]!.valores[i] ?? null)
            : null;
        const texto = total ? formata(total, props.tipo).texto : '';
        const cabe = texto.length * FONTE_DO_CHIP * 0.58 + 14 <= geo.banda;
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
              x={geo.xMeio(i) - geo.banda / 2}
              y={geo.margemTopo}
              width={geo.banda}
              height={geo.alturaDoPlot}
            />
            {marcas}
            {props.comRotulos && texto && cabe ? (
              <ChipDeValor x={geo.xMeio(i)} topo={topoDaCategoria} texto={texto} />
            ) : null}
          </g>
        );
      })}
    </>
  );
}
