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
// A regra de ONDE o número vai mora em `utils/graficoRotulos.ts` (pura, sob `npm test`);
// aqui é só o desenho. Reexportados para quem já importava daqui.
import { MAXIMO_COM_ROTULO, type ModoDeRotulo } from '../../../utils/graficoRotulos.ts';

export { MAXIMO_COM_ROTULO, type ModoDeRotulo };

export interface SerieDesenhada {
  chave: string;
  nome: string;
  cor: string;
  valores: (number | null)[];
}

const RAIO = 4;
const FONTE_DO_CHIP = 11;
/** O número sem chip (`.rotulo-valor`): 10px, e é por isso que ele cabe onde o chip não cabe. */
const FONTE_DO_ROTULO = 10;

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

/** O número escrito DENTRO da fatia (pilha percentual): sem chip, com contorno, porque o
 *  fundo é a cor da série e não dá para escolher uma letra que contraste com todas. */
function ValorNaFatia(props: { x: number; y: number; texto: string }) {
  return (
    <text
      className="valor-na-fatia"
      x={props.x}
      y={props.y}
      textAnchor="middle"
      dominantBaseline="central"
      pointerEvents="none"
    >
      {props.texto}
    </text>
  );
}

/** Largura que o texto ocupa no chip, com a folga das bordas. */
function larguraDoChip(texto: string): number {
  return texto.length * FONTE_DO_CHIP * 0.58 + 14;
}

/** A largura que um texto ocupa nesta fonte, com a folga das bordas. */
function larguraDoTexto(texto: string): number {
  return texto.length * FONTE_DO_ROTULO * 0.58 + 4;
}

/**
 * O número de uma fatia cabe nela?
 *
 * `dentro` ainda precisa de ALTURA: numa fatia de 8px o número sai por fora dela e passa
 * a mentir sobre a qual série pertence.
 */
function numeroCabeNaFatia(
  texto: string,
  larguraDaFatia: number,
  altura: number,
  modo: 'fatia' | 'dentro',
): boolean {
  if (larguraDoTexto(texto) > larguraDaFatia + VAO) return false;
  return modo === 'fatia' || altura >= FONTE_DO_ROTULO + 4;
}

/** O número do chip de uma categoria: o total da pilha, ou o valor da série única. */
function totalDaCategoria(
  empilha: boolean,
  areas: readonly { valores: readonly (number | null)[] }[],
  i: number,
  somaEm: (i: number) => number | null,
): number | null {
  if (empilha) return somaEm(i);
  if (areas.length !== 1) return null;
  return areas[0]!.valores[i] ?? null;
}

/** A geometria de uma fatia: onde ela começa, onde termina e quanto ocupa. */
interface GeometriaDaFatia {
  cima: number;
  esquerda: number;
  altura: number;
}

/**
 * Onde desenhar a fatia de uma série nesta categoria.
 *
 * **Empilhado e lado a lado são contas diferentes.** Empilhado cresce a partir do que já
 * foi empilhado (`acumulado`, que esta função avança); lado a lado reparte a largura da
 * marca entre as séries. O vão entre fatias sai da altura empilhada, nunca da posição —
 * tirar dos dois abriria um buraco que cresce a cada série.
 */
function geometriaDaFatia(opcoes: {
  valor: number;
  geo: {
    topo: number;
    alturaDoPlot: number;
    larguraDaFatia: number;
    larguraDaMarca: number;
    y: (valor: number) => number;
    xMeio: (categoria: number) => number;
  };
  base: number;
  empilha: boolean;
  acumulado: { alto: number };
  categoria: number;
  serie: number;
}): GeometriaDaFatia {
  const { valor, geo, base, empilha, acumulado, categoria, serie } = opcoes;
  const alturaCrua = (valor / geo.topo) * geo.alturaDoPlot;

  if (empilha) {
    const alto = Math.max(1, alturaCrua - VAO);
    const cima = base - acumulado.alto - alto;
    acumulado.alto += alturaCrua;
    return { cima, esquerda: geo.xMeio(categoria) - geo.larguraDaFatia / 2, altura: alto };
  }

  const cima = geo.y(valor);
  const esquerda =
    geo.xMeio(categoria) - geo.larguraDaMarca / 2 + serie * (geo.larguraDaFatia + VAO);
  return { cima, esquerda, altura: Math.max(1, base - cima) };
}

export function ColunasDoGrafico(props: {
  categorias: readonly { rotulo: string }[];
  areas: readonly SerieDesenhada[];
  empilha: boolean;
  percentual: boolean;
  tipo: TipoDeValor;
  /** As casas do `format` da medida; `null` deixa o genérico de `formata` decidir. */
  casas: number | null;
  geo: Geometria;
  interacao: InteracaoDoGrafico;
  /** Onde escrever o número (decidido por `Grafico`, que reservou a margem). */
  rotulos: ModoDeRotulo;
}) {
  const { categorias, areas, empilha, percentual, geo, interacao } = props;
  const modo = props.rotulos;
  /** O valor como a tela o escreve: com as casas que o `format` da medida pede. */
  const fmt = (v: number | null): string => formata(v, props.tipo, { casas: props.casas }).texto;
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
        /** Os números de `fatia`/`dentro`, colhidos enquanto as marcas são posicionadas. */
        const porFatia: { chave: string; x: number; y: number; dentro: boolean; texto: string }[] =
          [];
        const marcas = areas.map((s, k) => {
          const v = valorDesenhado(s.valores[i] ?? null, i);
          if (v === null || v === 0) return null;
          const { cima, esquerda, altura } = geometriaDaFatia({
            valor: v,
            geo,
            base,
            empilha,
            acumulado,
            categoria: i,
            serie: k,
          });
          topoDaCategoria = Math.min(topoDaCategoria, cima);
          const cor = unica ? corDaColunaPorValor(v, min, max) : s.cor;
          const titulo = `${c.rotulo} · ${s.nome}: ${fmt(s.valores[i] ?? null)}`;

          // O número de CADA fatia. `percentual` escreve a porcentagem desenhada (que é o
          // valor da parte); os demais escrevem o valor cru, não o da pilha.
          if (modo === 'fatia' || modo === 'dentro') {
            const texto = percentual ? `${Math.round(v)}%` : fmt(s.valores[i] ?? null);
            if (texto && numeroCabeNaFatia(texto, geo.larguraDaFatia, altura, modo)) {
              const dentro = modo === 'dentro';
              porFatia.push({
                chave: s.chave,
                x: esquerda + geo.larguraDaFatia / 2,
                y: dentro ? cima + altura / 2 : cima - 4,
                dentro,
                texto,
              });
            }
          }
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
        const total = totalDaCategoria(empilha, areas, i, somaEm);
        const texto = total ? fmt(total) : '';
        // O chip precisa de ~33px para três dígitos; o mesmo número SEM chip precisa de
        // ~21px. Num mês inteiro num cartão de meia largura a banda fica em ~25px, e a
        // regra antiga (só chip, ou nada) deixava o gráfico mudo justamente ali. O chip
        // continua sendo a primeira escolha — é mais legível sobre a coluna colorida —,
        // e o texto puro é o que sobra antes de desistir do número.
        const cabeOChip = larguraDoChip(texto) <= geo.banda;
        const cabeOTexto = larguraDoTexto(texto) <= geo.banda;
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
            {modo === 'categoria' && texto && cabeOChip ? (
              <ChipDeValor x={geo.xMeio(i)} topo={topoDaCategoria} texto={texto} />
            ) : null}
            {modo === 'categoria' && texto && !cabeOChip && cabeOTexto ? (
              <text
                className="rotulo-valor"
                x={geo.xMeio(i)}
                y={topoDaCategoria - 5}
                textAnchor="middle"
                pointerEvents="none"
              >
                {texto}
              </text>
            ) : null}
            {porFatia.map((r) =>
              r.dentro ? (
                <ValorNaFatia key={r.chave} x={r.x} y={r.y} texto={r.texto} />
              ) : (
                <text
                  key={r.chave}
                  className="rotulo-valor"
                  x={r.x}
                  y={r.y}
                  textAnchor="middle"
                  pointerEvents="none"
                >
                  {r.texto}
                </text>
              ),
            )}
          </g>
        );
      })}
    </>
  );
}
