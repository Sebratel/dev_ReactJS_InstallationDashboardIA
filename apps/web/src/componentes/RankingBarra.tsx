// A barra de ranking com rótulo dentro — Fase L6, docs/PLANO-LAYOUT-V1.md §8, 6/6.
//
// Mesmo dado do `Grafico.tsx` (`DadosDeGrafico`, uma categoria + uma medida — TÉCNICO
// ou EQUIPE): zero requisição nova, zero campo novo. O que muda é o desenho: em vez de
// coluna vertical com rótulo girado no eixo, cada categoria vira uma linha horizontal,
// ordenada da maior para a menor (o "ranking"), com o RÓTULO DENTRO da própria barra —
// a coluna de rótulo que um gráfico de barras convencional reserva à esquerda (~30% da
// largura num card estreito) deixa de existir.
//
// A troca de forma é DECLARADA em `layout.yaml` (`render: ranking-barra`), nunca
// decidida por cardinalidade em tempo de render — mesma disciplina anti-heurística de
// `Rosca.tsx`. O tipo original do PBIP fica registrado em `improvements:`, com
// `numero_muda: false`: a ordenação é só de DESENHO, o valor de cada categoria é o
// mesmo que `Grafico.tsx` já mostrava.
//
// GRÁFICO NÃO ROLA: ELE PAGINA (mesma regra do `Grafico.tsx`) — aqui a paginação é por
// LINHA, não por categoria no eixo X, porque a lista cresce para baixo, não para os
// lados.

import { useState } from 'react';
import type { DadosDeGrafico, FiltroDaTela, Valor, VisualCalculado } from '../api.ts';
import { formata, inteiro } from '../formato.ts';
import {
  alvosDaCategoria,
  chavesDeEixoDe,
  estaSelecionadaCategoria,
  selecaoDoEixoDe,
  type ChaveDoGrafico,
} from '../grafico-clique.ts';
import { corDaSerie, corDoRotuloSobre, corNoTema, maiorValorDe, montaGrafico } from '../grafico-forma.ts';
import { useThemeStore } from '../store/useThemeStore.ts';
import { Cartao } from './Cartao.tsx';
import { tituloDoVisual } from '../rotulos.ts';
import type { AoFiltrar } from '../rota.ts';
import { usaCaixa } from './usa-caixa.ts';

const MARGEM = { topo: 4, base: 4, esquerda: 4, direita: 52 };
const VAO = 6;
/** Faixa de altura por linha: abaixo de `MINIMA` o rótulo vira traço ilegível (mesmo
 *  piso de espírito da `ESPESSURA_MINIMA` da `Rosca.tsx`); acima de `MAXIMA` uma lista
 *  de 3 categorias vira 3 barras gigantes, mais vazio que informação. */
const ALTURA_LINHA_MINIMA = 22;
const ALTURA_LINHA_MAXIMA = 40;
/** ~5,6px por caractere na fonte do rótulo (mesma conta de `Grafico.tsx`), com 8px de
 *  folga em cada ponta — o mesmo orçamento que decide se o texto cabe DENTRO da barra. */
const PX_POR_CARACTERE = 5.6;
const FOLGA_ROTULO = 16;

interface LinhaRanking {
  rotulo: string;
  valores: Valor[];
  valor: number | null;
}

function truncado(texto: string, orcamentoPx: number): string {
  const cabem = Math.max(1, Math.floor(orcamentoPx / PX_POR_CARACTERE));
  return texto.length <= cabem ? texto : texto.slice(0, Math.max(1, cabem - 1)) + '…';
}

export function RankingBarra({
  visual,
  aoFiltrar,
  aoPrever,
  filtros,
}: {
  visual: VisualCalculado;
  aoFiltrar?: AoFiltrar;
  /** Hover-prefetch do alvo de um clique cruzado — ver `App.tsx` (`aoPreverAlvos`). */
  aoPrever?: AoFiltrar;
  filtros?: readonly FiltroDaTela[];
}) {
  const { isDark } = useThemeStore();

  // TODOS os hooks antes de qualquer `return` — mesma ordem de `Grafico.tsx`, pelo
  // mesmo motivo: `dados` pode chegar vazio num quadro e cheio no seguinte.
  const [sob, setSob] = useState<number | null>(null);
  const [inicio, setInicio] = useState(0);
  const [caixaRef, caixa] = usaCaixa();

  const d = visual.dados as DadosDeGrafico | undefined;
  const gTudo = d && d.series && d.pontos ? montaGrafico(d) : null;

  if (!d || !gTudo) {
    const titulo = tituloDoVisual(visual);
    return (
      <Cartao titulo={titulo} id={visual.id} altura="grafico">
        <p className="sob-demanda">Sem dados disponíveis para o ranking.</p>
      </Cartao>
    );
  }

  const serie = gTudo.series[0];
  const linhas: LinhaRanking[] = gTudo.categorias.map((c, i) => ({
    rotulo: c.rotulo,
    valores: c.valores,
    valor: serie?.valores[i] ?? null,
  }));
  // A ORDENAÇÃO É O RANKING: mesmo valor de sempre, só a ORDEM de desenho muda — é por
  // isso que este visual não pede medida nova (o §8 cita RANKX só para dizer que o
  // motor já sabe calcular posição; aqui a posição sai de um sort, mais barato que uma
  // medida DAX porque o valor já está calculado).
  const ordenadas = [...linhas].sort((a, b) => (b.valor ?? -Infinity) - (a.valor ?? -Infinity));
  const maior = maiorValorDe([{ valores: ordenadas.map((l) => l.valor) }]);

  const totalLinhas = ordenadas.length;
  const alturaUtil = Math.max(0, caixa.h - MARGEM.topo - MARGEM.base);
  // Quantas linhas cabem NO MÍNIMO — é o teto de paginação. Se o total cabe dentro
  // dele, as linhas ESTICAM até `ALTURA_LINHA_MAXIMA` para preencher o cartão (3
  // equipes não ficam 3 tiras finas no topo com o resto do card vazio); se não cabe,
  // a altura fica no mínimo e o resto pagina — mesma ideia do zoom P/M/G do
  // `Grafico.tsx`, só que decidida pelo total em vez de um botão, porque aqui a
  // categoria (técnico/equipe) não tem a mesma leitura "role para ver mais recente"
  // de uma série temporal.
  const capacidadeNoMinimo = Math.max(1, Math.floor((alturaUtil + VAO) / (ALTURA_LINHA_MINIMA + VAO)));
  const precisaPaginar = totalLinhas > capacidadeNoMinimo;
  const linhasPorPagina = precisaPaginar ? capacidadeNoMinimo : totalLinhas;
  const alturaLinha = precisaPaginar
    ? ALTURA_LINHA_MINIMA
    : Math.min(
        ALTURA_LINHA_MAXIMA,
        Math.max(ALTURA_LINHA_MINIMA, Math.floor((alturaUtil - VAO * (linhasPorPagina - 1)) / linhasPorPagina)),
      );
  const maxInicio = Math.max(0, totalLinhas - linhasPorPagina);
  const de = Math.min(inicio, maxInicio);
  const ate = Math.min(de + linhasPorPagina, totalLinhas);
  const visiveis = ordenadas.slice(de, ate);

  const chavesArray = (d.chaves ?? []) as ChaveDoGrafico[];
  const chavesDeEixo = chavesDeEixoDe(chavesArray);
  const alvosDe = (l: LinhaRanking) => alvosDaCategoria(chavesDeEixo, l.valores);
  const podeClicar = (l: LinhaRanking) => aoFiltrar !== undefined && alvosDe(l).length > 0;
  const clica = (l: LinhaRanking) => {
    if (!aoFiltrar) return;
    const alvos = alvosDe(l);
    if (alvos.length > 0) aoFiltrar(alvos);
  };

  const selecaoDoEixo = selecaoDoEixoDe(chavesDeEixo, filtros);
  const haSelecao = selecaoDoEixo.some((s) => s !== null);
  const estaSelecionada = (l: LinhaRanking) => estaSelecionadaCategoria(selecaoDoEixo, l.valores);

  // O NOME VEM DE `d.series`, a metadata DECLARADA da medida — não de `gTudo.series`
  // (o RESULTADO calculado). Sem categoria alguma (0 pontos), `montaGrafico` devolve
  // `series: []`: o card ficaria com o id cru no título bem no caso em que o título
  // mais importa (avisar que não há dado). Mesma fonte que `Grafico.tsx` já usa.
  const eixo = chavesArray.find((c) => (c.papel ?? 'Category') === 'Category');
  const nomeMedida = (d.series ?? [])[0]?.nome ?? null;
  const nomeEixo = (eixo as { nome?: string; coluna?: string } | undefined)?.nome ?? (eixo as { nome?: string; coluna?: string } | undefined)?.coluna;
  const titulo =
    visual.titulo?.trim() || (nomeMedida && nomeEixo ? `${nomeMedida} por ${nomeEixo}` : tituloDoVisual(visual));

  const corBarra = corNoTema(corDaSerie(nomeMedida ?? '', 0), isDark);
  const corDoRotuloDentro = corDoRotuloSobre(corBarra);
  const tipoDoValor = d.tiposDeSerie[0] ?? null;

  const semDados = totalLinhas === 0 || ordenadas.every((l) => !l.valor);
  if (semDados) {
    return (
      <Cartao titulo={titulo} id={visual.id} altura="grafico">
        <p className="sob-demanda">Sem dados para os filtros atuais.</p>
      </Cartao>
    );
  }

  const larguraTotal = Math.max(1, caixa.w - MARGEM.esquerda - MARGEM.direita);
  const alturaSvg = Math.max(
    1,
    visiveis.length * alturaLinha + Math.max(0, visiveis.length - 1) * VAO + MARGEM.topo + MARGEM.base,
  );

  const anda = (passo: number) => setInicio(Math.max(0, Math.min(maxInicio, de + passo * linhasPorPagina)));

  const paginador = precisaPaginar ? (
    <div className="paginador-grafico" title={inteiro(totalLinhas) + ' categorias no total'}>
      <button type="button" title="Primeira (maior valor)" disabled={de === 0} onClick={() => setInicio(0)}>
        «
      </button>
      <button type="button" title="Página anterior" disabled={de === 0} onClick={() => anda(-1)}>
        ‹
      </button>
      <span className="paginador-rotulo">
        {inteiro(de + 1)}–{inteiro(ate)} <span className="de">de {inteiro(totalLinhas)}</span>
      </span>
      <button type="button" title="Próxima página" disabled={de >= maxInicio} onClick={() => anda(1)}>
        ›
      </button>
      <button type="button" title="Última (menor valor)" disabled={de >= maxInicio} onClick={() => setInicio(maxInicio)}>
        »
      </button>
    </div>
  ) : null;

  return (
    <Cartao titulo={titulo} id={visual.id} altura="grafico" acoes={paginador}>
      {gTudo.avisos.map((a) => (
        <p className="aviso-grafico" key={a}>
          {a}
        </p>
      ))}

      {/* Mesma regra do `Grafico.tsx`: a caixa é medida, o `<svg>` recebe a medida
          dela — `overflow: hidden` é deliberado, quem não cabe pagina. */}
      <div className="caixa-grafico" ref={caixaRef}>
        <svg
          className="grafico-svg ranking-barra-svg"
          width={caixa.w}
          height={alturaSvg}
          role="img"
          aria-label={titulo + (precisaPaginar ? ` — posições ${de + 1} a ${ate} de ${totalLinhas}` : '')}
        >
          {visiveis.map((l, j) => {
            const y0 = MARGEM.topo + j * (alturaLinha + VAO);
            const meio = y0 + alturaLinha / 2 + 4;
            const fracao = maior > 0 ? Math.max(0, l.valor ?? 0) / maior : 0;
            const largBarra = l.valor && l.valor > 0 ? Math.max(3, fracao * larguraTotal) : 0;
            const posicao = de + j + 1;
            const prefixo = `${posicao}º `;
            const orcamentoDentro = largBarra - FOLGA_ROTULO - prefixo.length * PX_POR_CARACTERE;
            const cabeDentro = orcamentoDentro >= PX_POR_CARACTERE * 2;
            const rotuloDeFora = truncado(l.rotulo, larguraTotal - largBarra - 12 - prefixo.length * PX_POR_CARACTERE);
            return (
              <g
                key={`${l.rotulo}-${posicao}`}
                className={
                  'col-grupo' +
                  (podeClicar(l) ? ' clicavel' : '') +
                  (haSelecao && !estaSelecionada(l) ? ' apagada' : '')
                }
                onClick={() => clica(l)}
                onMouseEnter={() => {
                  setSob(de + j);
                  if (podeClicar(l)) aoPrever?.(alvosDe(l));
                }}
                onMouseLeave={() => setSob(null)}
              >
                <rect
                  className={`banda${sob === de + j ? ' sob' : ''}`}
                  x={0}
                  y={y0}
                  width={caixa.w}
                  height={alturaLinha}
                  rx={4}
                />
                <rect className="ranking-trilho" x={MARGEM.esquerda} y={y0} width={larguraTotal} height={alturaLinha} rx={4} />
                {largBarra > 0 ? (
                  <rect
                    className="ranking-preenche"
                    x={MARGEM.esquerda}
                    y={y0}
                    width={largBarra}
                    height={alturaLinha}
                    rx={4}
                    fill={corBarra}
                  />
                ) : null}
                {cabeDentro ? (
                  <text
                    className="ranking-rotulo-dentro"
                    x={MARGEM.esquerda + 8}
                    y={meio}
                    textAnchor="start"
                    fill={corDoRotuloDentro}
                  >
                    {prefixo}
                    {truncado(l.rotulo, orcamentoDentro)}
                  </text>
                ) : (
                  <text className="ranking-rotulo-fora" x={MARGEM.esquerda + largBarra + 8} y={meio} textAnchor="start">
                    {prefixo}
                    {rotuloDeFora}
                  </text>
                )}
                <text className="ranking-valor" x={MARGEM.esquerda + larguraTotal + 8} y={meio} textAnchor="start">
                  {formata(l.valor, tipoDoValor).texto}
                </text>
                <title>{`${posicao}º · ${l.rotulo}: ${formata(l.valor, tipoDoValor).texto}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
    </Cartao>
  );
}
