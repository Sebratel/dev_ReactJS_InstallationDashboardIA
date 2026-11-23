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
function colunaDeTopoRedondo(posX: number, posY: number, largura: number, altura: number): string {
  const raio = Math.max(0, Math.min(RAIO, largura / 2, altura));
  return `M${posX},${posY + altura}V${posY + raio}Q${posX},${posY} ${posX + raio},${posY}H${posX + largura - raio}Q${posX + largura},${posY} ${posX + largura},${posY + raio}V${posY + altura}Z`;
}

/** O chip do valor: retângulo na cor do texto, letra na cor da superfície — escuro no
 *  tema claro e claro no escuro (`.chip-valor` no `estilo.css`). */
function ChipDeValor(props: { x: number; topo: number; texto: string }) {
  const largura = Math.max(props.texto.length * FONTE_DO_CHIP * 0.58 + 10, 22);
  const altura = FONTE_DO_CHIP + 7;
  const centroY = props.topo - altura / 2 - 3;
  return (
    <g className="chip-valor" pointerEvents="none">
      <rect
        x={props.x - largura / 2}
        y={centroY - altura / 2}
        width={largura}
        height={altura}
        rx={3}
      />
      <text x={props.x} y={centroY} textAnchor="middle" dominantBaseline="central">
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
  indice: number,
  somaEm: (i: number) => number | null,
): number | null {
  if (empilha) return somaEm(indice);
  if (areas.length !== 1) return null;
  return areas[0]!.valores[indice] ?? null;
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
  const fmt = (valor: number | null): string =>
    formata(valor, props.tipo, { casas: props.casas }).texto;
  const base = geo.margemTopo + geo.alturaDoPlot;

  /** A soma da pilha numa categoria — o divisor do modo percentual. */
  const somaEm = (indice: number) =>
    areas.reduce((soma, area) => soma + (area.valores[indice] ?? 0), 0);
  const valorDesenhado = (valor: number | null, indice: number): number | null => {
    if (valor === null) return null;
    if (!percentual) return valor;
    const soma = somaEm(indice);
    return soma > 0 ? (valor / soma) * 100 : null;
  };

  // Série única e dourada: a cor gradua com o valor, entre o menor e o maior da página.
  const unica = areas.length === 1 && areas[0]!.cor === DOURADO && !percentual ? areas[0]! : null;
  const visiveis = unica ? unica.valores.filter((valor): valor is number => valor !== null) : [];
  const min = visiveis.length ? Math.min(...visiveis) : 0;
  const max = visiveis.length ? Math.max(...visiveis) : 0;

  return (
    <>
      {categorias.map((_, posicao) => {
        const acumulado = { alto: 0 };
        // A fatia de cima da pilha é a última com valor: só ela leva o topo redondo.
        let ultima = -1;
        areas.forEach((area, indice) => {
          const valor = valorDesenhado(area.valores[posicao] ?? null, posicao);
          if (valor !== null && valor !== 0) ultima = indice;
        });
        let topoDaCategoria = base;
        /** Os números de `fatia`/`dentro`, colhidos enquanto as marcas são posicionadas. */
        const porFatia: { chave: string; x: number; y: number; dentro: boolean; texto: string }[] =
          [];
        const marcas = areas.map((area, indice) => {
          const valorAtual = valorDesenhado(area.valores[posicao] ?? null, posicao);
          if (valorAtual === null || valorAtual === 0) return null;
          const { cima, esquerda, altura } = geometriaDaFatia({
            valor: valorAtual,
            geo,
            base,
            empilha,
            acumulado,
            categoria: posicao,
            serie: indice,
          });
          topoDaCategoria = Math.min(topoDaCategoria, cima);
          const cor = unica ? corDaColunaPorValor(valorAtual, min, max) : area.cor;

          // O número de CADA fatia. `percentual` escreve a porcentagem desenhada (que é o
          // valor da parte); os demais escrevem o valor cru, não o da pilha.
          if (modo === 'fatia' || modo === 'dentro') {
            const texto = percentual
              ? `${Math.round(valorAtual)}%`
              : fmt(area.valores[posicao] ?? null);
            if (texto && numeroCabeNaFatia(texto, geo.larguraDaFatia, altura, modo)) {
              const dentro = modo === 'dentro';
              porFatia.push({
                chave: area.chave,
                x: esquerda + geo.larguraDaFatia / 2,
                y: dentro ? cima + altura / 2 : cima - 4,
                dentro,
                texto,
              });
            }
          }
          return !empilha || indice === ultima ? (
            <path
              key={area.chave}
              d={colunaDeTopoRedondo(esquerda, cima, geo.larguraDaFatia, altura)}
              fill={cor}
            />
          ) : (
            <rect
              key={area.chave}
              x={esquerda}
              y={cima}
              width={geo.larguraDaFatia}
              height={altura}
              fill={cor}
            />
          );
        });
        // O chip: o valor da série única, ou o total da pilha.
        const total = totalDaCategoria(empilha, areas, posicao, somaEm);
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
            key={posicao}
            className={interacao.classeDa(posicao)}
            onClick={() => interacao.clica(posicao)}
            onMouseEnter={() => interacao.aoEntrar(posicao)}
            onMouseLeave={interacao.aoSair}
          >
            <rect
              className={`banda${interacao.sob === posicao ? ' sob' : ''}`}
              x={geo.xMeio(posicao) - geo.banda / 2}
              y={geo.margemTopo}
              width={geo.banda}
              height={geo.alturaDoPlot}
            />
            {marcas}
            {modo === 'categoria' && texto && cabeOChip ? (
              <ChipDeValor x={geo.xMeio(posicao)} topo={topoDaCategoria} texto={texto} />
            ) : null}
            {modo === 'categoria' && texto && !cabeOChip && cabeOTexto ? (
              <text
                className="rotulo-valor"
                x={geo.xMeio(posicao)}
                y={topoDaCategoria - 5}
                textAnchor="middle"
                pointerEvents="none"
              >
                {texto}
              </text>
            ) : null}
            {porFatia.map((rotulo) =>
              rotulo.dentro ? (
                <ValorNaFatia key={rotulo.chave} x={rotulo.x} y={rotulo.y} texto={rotulo.texto} />
              ) : (
                <text
                  key={rotulo.chave}
                  className="rotulo-valor"
                  x={rotulo.x}
                  y={rotulo.y}
                  textAnchor="middle"
                  pointerEvents="none"
                >
                  {rotulo.texto}
                </text>
              ),
            )}
          </g>
        );
      })}
    </>
  );
}
