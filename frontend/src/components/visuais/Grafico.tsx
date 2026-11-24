// O gráfico, em SVG: eixo, grade, colunas empilhadas ou agrupadas, e a linha por cima.
//
// A decisão de forma, escala e cor está em `graficoForma.ts`, e a do eixo em
// `graficoEixo.ts` — as duas cobertas por `npm test`. Aqui é a janela, a geometria e o
// clique; o desenho de cada parte está em `grafico/` (fase 4 de
// `docs/PLANO-PADROES-FRONTEND.md`).
//
// GRÁFICO NÃO ROLA: ELE PAGINA. O desenho tinha largura FIXA por categoria dentro de um
// contêiner com `overflow-x: auto` — com 87 categorias, 2.958px de desenho num card de
// ~1.600px. Agora a caixa do desenho é MEDIDA, o `<svg>` recebe exatamente a medida dela,
// e quando as categorias não cabem com largura legível o gráfico mostra uma janela com
// paginador. O P/M/G escolhe a densidade: quantas categorias por página.
//
// A ALTURA É A DA CAIXA, SEM PISO. Piso acima da caixa faz o `<svg>` transbordar,
// cortado pelo `overflow: hidden` dela, sem erro nenhum — medido em 27/08/2026 no
// RELATÓRIO DO ANO (caixa de 109px, `<svg>` de 160px) e na MANUTENÇÃO INICIAL. Quem
// cede é a margem de baixo: `base` é no máximo 30% do espaço, então o plot é sempre
// positivo. `useCaixa.ts` remede no `resize` e quando a fonte carrega.

import { useMemo, useState } from 'react';
import type {
  DadosDeGrafico,
  FiltroDaTela,
  VisualCalculado,
} from '../../services/dashboardService.ts';
import { inteiro } from '../../utils/formato.ts';
import { corNoTema, maiorValorDe, montaGrafico, tetoDasAreas } from '../../utils/graficoForma.ts';
import { bandaMinimaPara, prefixoComum, rotuloDoEixo } from '../../utils/graficoEixo.ts';
import { useThemeStore } from '../../store/themeStore.ts';
import { Cartao } from '../ui/Cartao.tsx';
import { PaginadorDeJanela } from '../ui/PaginadorDeJanela.tsx';
import { tituloDeGrafico, tituloDoVisual } from '../../utils/rotulos.ts';
import type { AoFiltrar } from '../../utils/rota.ts';
import { useModo } from '../../context/ModoContext.tsx';
import { useCaixa } from '../../hooks/useCaixa.ts';
import { useCliqueNoEixo } from '../../hooks/useCliqueNoEixo.ts';
import { MARGEM, geometriaDoGrafico } from './grafico/geometria.ts';
import {
  modoDeRotulo,
  precisaDeMargemParaRotulo,
  rotulaTodosOsPontos,
} from '../../utils/graficoRotulos.ts';
import { DesenhoDoGrafico } from './grafico/DesenhoDoGrafico.tsx';
import { LegendaDoGrafico } from './grafico/LegendaDoGrafico.tsx';
import { TooltipDoGrafico } from './TooltipDoGrafico.tsx';
import { MensagemDeEstado } from '../ui/Estado.tsx';
import { montaTooltipDeCategoria, type PosicaoDoPonteiro } from '../../utils/graficoTooltip.ts';

/** Abaixo de 4 categorias por página o gráfico deixa de comunicar tendência. */
const MINIMO_POR_PAGINA = 4;

/**
 * O subtítulo do cartão. Em conferência ele conta pontos e séries; fora dela, só diz se
 * o gráfico está em 100% empilhado — o que muda como o número se lê.
 */
function subtituloDoGrafico(
  emConferencia: boolean,
  pontos: number,
  series: number,
  percentual: boolean | undefined,
): string[] {
  const empilhado = percentual ? ['100% empilhado'] : [];
  if (!emConferencia) return empilhado;
  return [`${inteiro(pontos)} pontos`, `${series} série(s)`, ...empilhado];
}

export function Grafico({
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
  const { conferencia } = useModo();
  const { isDark } = useThemeStore();

  // TODOS os hooks vêm ANTES de qualquer `return`: um guarda de nulo acima de um hook
  // muda a ORDEM DOS HOOKS entre renderizações, e o React derruba a árvore.
  const [inicio, setInicio] = useState<number | null>(null);
  const [posPonteiro, setPosPonteiro] = useState<PosicaoDoPonteiro | null>(null);
  const [caixaRef, caixa] = useCaixa();

  const dadosDoGrafico = visual.dados as DadosDeGrafico | undefined;
  const gTudo = useMemo(
    () =>
      dadosDoGrafico && dadosDoGrafico.series && dadosDoGrafico.pontos
        ? montaGrafico(dadosDoGrafico)
        : null,
    [dadosDoGrafico],
  );

  // Os níveis de cada categoria sem o prefixo comum a TODAS (ver `prefixoComum`), e o
  // maior rótulo que o eixo vai desenhar. Calculado aqui, antes da janela, porque é ele
  // que diz quantas categorias cabem numa página — ver `bandaMinimaPara`.
  const partesPorCat = useMemo(
    () =>
      (gTudo?.categorias ?? []).map((categoria) =>
        categoria.eixo !== undefined ? [categoria.eixo] : categoria.rotulo.split(' / '),
      ),
    [gTudo],
  );
  const comum = useMemo(() => prefixoComum(partesPorCat), [partesPorCat]);
  const maiorRotulo = useMemo(
    () =>
      (gTudo?.categorias ?? []).reduce(
        (maior, categoria, indice) =>
          Math.max(
            maior,
            rotuloDoEixo(partesPorCat[indice]?.slice(comum) ?? [], categoria.rotulo, 999).length,
          ),
        1,
      ),
    [gTudo, partesPorCat, comum],
  );

  // ----------------------------------------------- quantas cabem, e qual janela
  const nTotal = gTudo?.categorias.length ?? 0;
  const larguraDoPlot = Math.max(120, caixa.w - MARGEM.esquerda - MARGEM.direita);
  const cabem = Math.max(
    MINIMO_POR_PAGINA,
    Math.floor(larguraDoPlot / bandaMinimaPara(maiorRotulo)),
  );
  const pagina = Math.min(cabem, Math.max(nTotal, 1));
  const precisaPaginar = nTotal > pagina;
  // Abre na página que TERMINA NO ÚLTIMO DIA COM DADO: categoria de gráfico operacional
  // é quase sempre tempo ordenado, e o que interessa é o presente. Não no fim da série:
  // o calendário do mês corrente vem até o dia 31, e a última página caía inteira em
  // dias futuros (nulos). `null` = ainda no padrão, então a janela acompanha o fim
  // quando um filtro muda o tamanho da série.
  const maxInicio = Math.max(0, nTotal - pagina);
  const fimComDado = gTudo ? ultimaCategoriaComDado(gTudo.series) + 1 : nTotal;
  const inicioPadrao = Math.min(maxInicio, Math.max(0, fimComDado - pagina));
  const deslocamento = Math.min(inicio ?? inicioPadrao, maxInicio);
  const ate = Math.min(deslocamento + pagina, nTotal);

  /** Só a fatia visível, já com a cor do tema. O `teto` vem do TODO — ver abaixo. */
  const grafico = useMemo(() => {
    if (!gTudo) return null;
    const inteira = deslocamento === 0 && ate >= nTotal;
    return {
      ...gTudo,
      categorias: inteira ? gTudo.categorias : gTudo.categorias.slice(deslocamento, ate),
      series: gTudo.series.map((serie) => ({
        ...serie,
        cor: corNoTema(serie.cor, isDark),
        valores: inteira ? serie.valores : serie.valores.slice(deslocamento, ate),
      })),
    };
  }, [gTudo, deslocamento, ate, nTotal, isDark]);

  const clique = useCliqueNoEixo(
    dadosDoGrafico?.chaves ?? [],
    grafico?.categorias ?? [],
    filtros,
    aoFiltrar,
    aoPrever,
  );

  if (!dadosDoGrafico || !grafico || !gTudo) {
    return (
      <Cartao titulo={tituloDoVisual(visual)} id={visual.id} altura="grafico">
        <MensagemDeEstado>Sem dados disponíveis para o gráfico.</MensagemDeEstado>
      </Cartao>
    );
  }

  const areas = grafico.series.filter((serie) => serie.desenho === 'area');
  const linhas = grafico.series.filter((serie) => serie.desenho === 'linha');
  const naFaceta = grafico.facetada !== null;

  // O TETO SAI DE TODAS AS CATEGORIAS, não das visíveis — ver `geometriaDoGrafico`.
  const linhasDoTudo = naFaceta ? [] : gTudo.series.filter((serie) => serie.desenho === 'linha');
  // ONDE O NÚMERO APARECE (19/11/2026) — a regra está em `utils/graficoRotulos.ts`, com
  // o porquê de cada caso e os testes. Aqui só se descreve a forma desta janela.
  const forma = {
    nAreas: areas.length,
    nLinhas: linhas.length,
    empilha: grafico.empilha,
    percentual: grafico.percentual,
    nCategorias: grafico.categorias.length,
    naFaceta,
  };
  const rotulos = modoDeRotulo(forma);
  const rotulosDeLinha = rotulaTodosOsPontos(forma);
  const comRotulos = precisaDeMargemParaRotulo(forma);
  const { geo, marcas } = geometriaDoGrafico({
    alturaDaCaixa: caixa.h,
    larguraDoPlot,
    nCategorias: grafico.categorias.length,
    naFaceta,
    teto: gTudo.percentual
      ? 100
      : maiorValorDe(linhasDoTudo, tetoDasAreas(gTudo.series, gTudo.empilha)),
    empilha: grafico.empilha,
    nAreas: areas.length,
    comRotulos,
  });

  const sub = subtituloDoGrafico(
    conferencia,
    dadosDoGrafico.pontos.length,
    grafico.series.length,
    grafico.percentual,
  );
  const titulo = tituloDeGrafico(visual, dadosDoGrafico);

  // `partesPorCat` e `comum` saem de TODAS as categorias e já foram calculados lá em
  // cima, junto com `maiorRotulo` — aqui só se recorta a janela visível.
  const partesVisiveis = grafico.categorias.map(
    (_, indice) => partesPorCat[deslocamento + indice]?.slice(comum) ?? [],
  );

  const acoesGrafico = (
    <div className="grupo-acoes-grafico">
      {precisaPaginar ? (
        <PaginadorDeJanela
          de={deslocamento}
          ate={ate}
          total={nTotal}
          maxInicio={maxInicio}
          passo={pagina}
          aoIr={setInicio}
          resumo={inteiro(nTotal) + ' categorias no total'}
          titulos={{
            primeira: 'Primeira',
            anterior: 'Página anterior',
            proxima: 'Próxima página',
            ultima: 'Última (mais recente)',
          }}
        />
      ) : null}
    </div>
  );

  // Do TODO, não da janela: uma página vazia ainda é um gráfico com dados (navegável), e
  // este ramo não monta a `caixa-grafico` — a largura nunca era medida, a página ficava
  // no tamanho padrão e o cartão preso em "sem dados".
  const semDados = gTudo.categorias.length === 0 || ultimaCategoriaComDado(gTudo.series) < 0;
  if (semDados) {
    return (
      // `altura="grafico"`: sem ela o Cartao cai em `auto` e cresce com o conteúdo.
      <Cartao titulo={titulo} sub={sub.join(' · ')} id={visual.id} altura="grafico">
        <MensagemDeEstado>Sem dados para os filtros atuais.</MensagemDeEstado>
      </Cartao>
    );
  }

  const tipoPrincipal = dadosDoGrafico.tiposDeSerie[0] ?? null;
  const casasPrincipais = dadosDoGrafico.casasDasSeries?.[0] ?? null;
  const dadosTooltip =
    clique.sob !== null && grafico.categorias[clique.sob]
      ? montaTooltipDeCategoria({
          rotulo: grafico.categorias[clique.sob]!.rotulo,
          series: grafico.series,
          indice: clique.sob,
          empilha: grafico.empilha,
          percentual: grafico.percentual,
          tipo: tipoPrincipal,
          casas: casasPrincipais,
          podeClicar: clique.podeClicar(clique.sob),
          maxReferencia: grafico.series.length === 1 ? maiorValorDe(gTudo.series, 0) : undefined,
        })
      : null;

  return (
    <Cartao
      titulo={titulo}
      sub={sub.join(' · ')}
      id={visual.id}
      altura="grafico"
      acoes={acoesGrafico}
    >
      {grafico.series.length > 1 ? <LegendaDoGrafico series={grafico.series} /> : null}

      {grafico.avisos.map((aviso) => (
        <p className="aviso-grafico" key={aviso}>
          {aviso}
        </p>
      ))}

      {/* A caixa do desenho é este div, e o `<svg>` recebe exatamente a medida dela.
          `overflow: hidden` é deliberado: gráfico NÃO rola; se não cabe, ele pagina. */}
      <div
        className="caixa-grafico"
        ref={caixaRef}
        onMouseMove={(evento) => setPosPonteiro({ x: evento.clientX, y: evento.clientY })}
        onMouseLeave={() => {
          setPosPonteiro(null);
          clique.aoSair();
        }}
      >
        <DesenhoDoGrafico
          largura={caixa.w}
          altura={caixa.h}
          ariaLabel={
            tituloDoVisual(visual) +
            (precisaPaginar ? ` — categorias ${deslocamento + 1} a ${ate} de ${nTotal}` : '')
          }
          categorias={grafico.categorias}
          partes={partesVisiveis}
          areas={areas}
          linhas={linhas}
          empilha={grafico.empilha}
          percentual={grafico.percentual}
          naFaceta={naFaceta}
          tipo={tipoPrincipal}
          casas={casasPrincipais}
          marcas={marcas}
          geo={geo}
          interacao={clique}
          rotulos={rotulos}
          rotulosDeLinha={rotulosDeLinha}
        />
      </div>
      <TooltipDoGrafico dados={dadosTooltip} pos={posPonteiro} />
    </Cartao>
  );
}

/** Índice da última categoria em que alguma série tem valor (≠ nulo e ≠ 0); -1 se nenhuma. */
function ultimaCategoriaComDado(
  series: readonly { valores: readonly (number | null)[] }[],
): number {
  let ultima = -1;
  for (const serie of series) {
    for (let indice = serie.valores.length - 1; indice > ultima; indice--) {
      if (serie.valores[indice] !== null && serie.valores[indice] !== 0) {
        ultima = indice;
        break;
      }
    }
  }
  return ultima;
}
