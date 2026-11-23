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
// `numero_muda: false`: a ordenação é só de DESENHO.
//
// GRÁFICO NÃO ROLA: ELE PAGINA (mesma regra do `Grafico.tsx`) — aqui a paginação é por
// LINHA, não por categoria no eixo X, porque a lista cresce para baixo.

import { useState } from 'react';
import type {
  DadosDeGrafico,
  FiltroDaTela,
  VisualCalculado,
} from '../../services/dashboardService.ts';
import { inteiro } from '../../utils/formato.ts';
import {
  corDaSerie,
  corDoRotuloSobre,
  corNoTema,
  maiorValorDe,
  montaGrafico,
} from '../../utils/graficoForma.ts';
import { useThemeStore } from '../../store/themeStore.ts';
import { Cartao } from '../ui/Cartao.tsx';
import { PaginadorDeJanela } from '../ui/PaginadorDeJanela.tsx';
import { tituloDoVisual } from '../../utils/rotulos.ts';
import type { AoFiltrar } from '../../utils/rota.ts';
import { useCaixa } from '../../hooks/useCaixa.ts';
import { useCliqueNoEixo } from '../../hooks/useCliqueNoEixo.ts';
import { LinhaDoRanking } from './ranking/LinhaDoRanking.tsx';
import { TooltipDoGrafico } from './TooltipDoGrafico.tsx';
import { MensagemDeEstado } from '../ui/Estado.tsx';
import { montaTooltipDeRanking, type PosicaoDoPonteiro } from '../../utils/graficoTooltip.ts';

const MARGEM = { topo: 4, base: 4, esquerda: 4, direita: 52 };
const VAO = 6;
/** Faixa de altura por linha: abaixo de `MINIMA` o rótulo vira traço ilegível (mesmo
 *  piso de espírito da `ESPESSURA_MINIMA` da `Rosca.tsx`); acima de `MAXIMA` uma lista
 *  de 3 categorias vira 3 barras gigantes, mais vazio que informação. */
const ALTURA_LINHA_MINIMA = 22;
const ALTURA_LINHA_MAXIMA = 40;

export function RankingBarra({
  visual,
  aoFiltrar,
  aoPrever,
  filtros,
}: {
  visual: VisualCalculado;
  aoFiltrar?: AoFiltrar;
  /** Hover-prefetch do alvo de um clique cruzado — ver `usePreCargas`. */
  aoPrever?: AoFiltrar;
  filtros?: readonly FiltroDaTela[];
}) {
  const { isDark } = useThemeStore();

  // TODOS os hooks antes de qualquer `return` — mesma ordem de `Grafico.tsx`, pelo
  // mesmo motivo: `dados` pode chegar vazio num quadro e cheio no seguinte.
  const [inicio, setInicio] = useState(0);
  const [posPonteiro, setPosPonteiro] = useState<PosicaoDoPonteiro | null>(null);
  const [caixaRef, caixa] = useCaixa();

  const dadosDoGrafico = visual.dados as DadosDeGrafico | undefined;
  const gTudo =
    dadosDoGrafico && dadosDoGrafico.series && dadosDoGrafico.pontos
      ? montaGrafico(dadosDoGrafico)
      : null;

  const serie = gTudo?.series[0];
  // A ORDENAÇÃO É O RANKING: mesmo valor de sempre, só a ORDEM de desenho muda — a
  // posição sai de um sort, mais barato que uma medida DAX porque o valor já está pronto.
  const ordenadas = (gTudo?.categorias ?? [])
    .map((categoria, indice) => ({
      rotulo: categoria.rotulo,
      valores: categoria.valores,
      valor: serie?.valores[indice] ?? null,
    }))
    .sort((primeiro, segundo) => (segundo.valor ?? -Infinity) - (primeiro.valor ?? -Infinity));
  const maior = maiorValorDe([{ valores: ordenadas.map((linha) => linha.valor) }]);

  const totalLinhas = ordenadas.length;
  const alturaUtil = Math.max(0, caixa.h - MARGEM.topo - MARGEM.base);
  // Quantas linhas cabem NO MÍNIMO — é o teto de paginação. Se o total cabe dentro dele,
  // as linhas ESTICAM até `ALTURA_LINHA_MAXIMA` para preencher o cartão; se não cabe, a
  // altura fica no mínimo e o resto pagina — decidido pelo total e não por um botão,
  // porque técnico/equipe não tem a leitura "role para ver o mais recente" de uma série.
  const capacidadeNoMinimo = Math.max(
    1,
    Math.floor((alturaUtil + VAO) / (ALTURA_LINHA_MINIMA + VAO)),
  );
  const precisaPaginar = totalLinhas > capacidadeNoMinimo;
  const linhasPorPagina = precisaPaginar ? capacidadeNoMinimo : totalLinhas;
  const alturaLinha = precisaPaginar
    ? ALTURA_LINHA_MINIMA
    : Math.min(
        ALTURA_LINHA_MAXIMA,
        Math.max(
          ALTURA_LINHA_MINIMA,
          Math.floor((alturaUtil - VAO * (linhasPorPagina - 1)) / linhasPorPagina),
        ),
      );
  const maxInicio = Math.max(0, totalLinhas - linhasPorPagina);
  const deslocamento = Math.min(inicio, maxInicio);
  const ate = Math.min(deslocamento + linhasPorPagina, totalLinhas);
  const visiveis = ordenadas.slice(deslocamento, ate);

  const clique = useCliqueNoEixo(
    dadosDoGrafico?.chaves ?? [],
    visiveis,
    filtros,
    aoFiltrar,
    aoPrever,
  );

  if (!dadosDoGrafico || !gTudo) {
    return (
      <Cartao titulo={tituloDoVisual(visual)} id={visual.id} altura="grafico">
        <MensagemDeEstado>Sem dados disponíveis para o ranking.</MensagemDeEstado>
      </Cartao>
    );
  }

  // O NOME VEM DE `d.series`, a metadata DECLARADA da medida — não de `gTudo.series` (o
  // RESULTADO calculado). Sem categoria alguma, `montaGrafico` devolve `series: []`, e o
  // card ficaria com o id cru no título bem no caso em que ele mais importa.
  const eixo = (dadosDoGrafico.chaves ?? []).find(
    (chave) => ((chave as { papel?: string }).papel ?? 'Category') === 'Category',
  ) as { nome?: string; coluna?: string } | undefined;
  const nomeMedida = (dadosDoGrafico.series ?? [])[0]?.nome ?? null;
  const nomeEixo = eixo?.nome ?? eixo?.coluna;
  const titulo =
    visual.titulo?.trim() ||
    (nomeMedida && nomeEixo ? `${nomeMedida} por ${nomeEixo}` : tituloDoVisual(visual));

  const corBarra = corNoTema(corDaSerie(nomeMedida ?? '', 0), isDark);

  if (totalLinhas === 0 || ordenadas.every((linha) => !linha.valor)) {
    return (
      <Cartao titulo={titulo} id={visual.id} altura="grafico">
        <MensagemDeEstado>Sem dados para os filtros atuais.</MensagemDeEstado>
      </Cartao>
    );
  }

  const larguraTotal = Math.max(1, caixa.w - MARGEM.esquerda - MARGEM.direita);
  const alturaSvg = Math.max(
    1,
    visiveis.length * alturaLinha +
      Math.max(0, visiveis.length - 1) * VAO +
      MARGEM.topo +
      MARGEM.base,
  );

  const paginador = precisaPaginar ? (
    <PaginadorDeJanela
      de={deslocamento}
      ate={ate}
      total={totalLinhas}
      maxInicio={maxInicio}
      passo={linhasPorPagina}
      aoIr={setInicio}
      resumo={inteiro(totalLinhas) + ' categorias no total'}
      titulos={{
        primeira: 'Primeira (maior valor)',
        anterior: 'Página anterior',
        proxima: 'Próxima página',
        ultima: 'Última (menor valor)',
      }}
    />
  ) : null;

  const somaTotal = ordenadas.reduce((soma, linha) => soma + Math.max(0, linha.valor ?? 0), 0);
  const opcaoAtiva = clique.sob !== null ? (visiveis[clique.sob] ?? null) : null;
  const dadosTooltip =
    opcaoAtiva && clique.sob !== null
      ? montaTooltipDeRanking({
          rotulo: opcaoAtiva.rotulo,
          valor: opcaoAtiva.valor,
          posicao: deslocamento + clique.sob + 1,
          totalItens: totalLinhas,
          maior,
          somaTotal,
          cor: corBarra,
          tipo: dadosDoGrafico.tiposDeSerie[0] ?? null,
          nomeMedida,
          podeClicar: clique.podeClicar(clique.sob),
        })
      : null;

  return (
    <Cartao titulo={titulo} id={visual.id} altura="grafico" acoes={paginador}>
      {gTudo.avisos.map((aviso) => (
        <p className="aviso-grafico" key={aviso}>
          {aviso}
        </p>
      ))}

      {/* Mesma regra do `Grafico.tsx`: a caixa é medida, o `<svg>` recebe a medida dela —
          `overflow: hidden` é deliberado, quem não cabe pagina. */}
      <div
        className="caixa-grafico"
        ref={caixaRef}
        onMouseMove={(evento) => setPosPonteiro({ x: evento.clientX, y: evento.clientY })}
        onMouseLeave={() => {
          setPosPonteiro(null);
          clique.aoSair();
        }}
      >
        <svg
          className="grafico-svg ranking-barra-svg"
          width={caixa.w}
          height={alturaSvg}
          role="img"
          aria-label={
            titulo +
            (precisaPaginar ? ` — posições ${deslocamento + 1} a ${ate} de ${totalLinhas}` : '')
          }
        >
          {visiveis.map((opcao, indice) => (
            <LinhaDoRanking
              key={`${opcao.rotulo}-${deslocamento + indice + 1}`}
              rotulo={opcao.rotulo}
              valor={opcao.valor}
              posicao={deslocamento + indice + 1}
              y0={MARGEM.topo + indice * (alturaLinha + VAO)}
              alturaLinha={alturaLinha}
              larguraTotal={larguraTotal}
              larguraDaCaixa={caixa.w}
              esquerda={MARGEM.esquerda}
              maior={maior}
              corBarra={corBarra}
              corDoRotuloDentro={corDoRotuloSobre(corBarra)}
              tipo={dadosDoGrafico.tiposDeSerie[0] ?? null}
              sob={clique.sob === indice}
              classe={clique.classeDa(indice)}
              aoClicar={() => clique.clica(indice)}
              aoEntrar={() => clique.aoEntrar(indice)}
              aoSair={clique.aoSair}
            />
          ))}
        </svg>
      </div>
      <TooltipDoGrafico dados={dadosTooltip} pos={posPonteiro} />
    </Cartao>
  );
}
