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
import { prefixoComum } from '../../utils/graficoEixo.ts';
import { useThemeStore } from '../../store/themeStore.ts';
import { Cartao } from '../ui/Cartao.tsx';
import { PaginadorDeJanela } from '../ui/PaginadorDeJanela.tsx';
import { tituloDeGrafico, tituloDoVisual } from '../../utils/rotulos.ts';
import type { AoFiltrar } from '../../utils/rota.ts';
import { useModo } from '../../context/ModoContext.tsx';
import { useCaixa } from '../../hooks/useCaixa.ts';
import { useCliqueNoEixo } from '../../hooks/useCliqueNoEixo.ts';
import { MARGEM, geometriaDoGrafico } from './grafico/geometria.ts';
import { ControlesDeZoom } from './grafico/ControlesDeZoom.tsx';
import { DesenhoDoGrafico } from './grafico/DesenhoDoGrafico.tsx';
import { LegendaDoGrafico } from './grafico/LegendaDoGrafico.tsx';
import { MensagemDeEstado } from '../ui/Estado.tsx';

/**
 * Largura mínima por categoria em cada densidade (P, M, G). Vem do rótulo, não do
 * gosto: girado a 45°, em 40px cabem ~10 caracteres — "26/08" ou uma sigla de equipe.
 */
const BANDA_MINIMA = [24, 40, 64];
/** Abaixo de 4 categorias por página o gráfico deixa de comunicar tendência. */
const MINIMO_POR_PAGINA = 4;

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
  const [zoomIdx, setZoomIdx] = useState<number>(1);
  const [inicio, setInicio] = useState<number | null>(null);
  const [caixaRef, caixa] = useCaixa();

  const d = visual.dados as DadosDeGrafico | undefined;
  const gTudo = useMemo(() => (d && d.series && d.pontos ? montaGrafico(d) : null), [d]);

  // ----------------------------------------------- quantas cabem, e qual janela
  const nTotal = gTudo?.categorias.length ?? 0;
  const larguraDoPlot = Math.max(120, caixa.w - MARGEM.esquerda - MARGEM.direita);
  const cabem = Math.max(
    MINIMO_POR_PAGINA,
    Math.floor(larguraDoPlot / (BANDA_MINIMA[zoomIdx] ?? 40)),
  );
  const pagina = Math.min(cabem, Math.max(nTotal, 1));
  const precisaPaginar = nTotal > pagina;
  // Abre na ÚLTIMA página: categoria de gráfico operacional é quase sempre tempo
  // ordenado, e o que interessa é o presente. `null` = ainda no padrão, então a janela
  // acompanha o fim quando um filtro muda o tamanho da série.
  const maxInicio = Math.max(0, nTotal - pagina);
  const de = Math.min(inicio ?? maxInicio, maxInicio);
  const ate = Math.min(de + pagina, nTotal);

  /** Só a fatia visível, já com a cor do tema. O `teto` vem do TODO — ver abaixo. */
  const g = useMemo(() => {
    if (!gTudo) return null;
    const inteira = de === 0 && ate >= nTotal;
    return {
      ...gTudo,
      categorias: inteira ? gTudo.categorias : gTudo.categorias.slice(de, ate),
      series: gTudo.series.map((s) => ({
        ...s,
        cor: corNoTema(s.cor, isDark),
        valores: inteira ? s.valores : s.valores.slice(de, ate),
      })),
    };
  }, [gTudo, de, ate, nTotal, isDark]);

  const clique = useCliqueNoEixo(
    d?.chaves ?? [],
    g?.categorias ?? [],
    filtros,
    aoFiltrar,
    aoPrever,
  );

  if (!d || !g || !gTudo) {
    return (
      <Cartao titulo={tituloDoVisual(visual)} id={visual.id} altura="grafico">
        <MensagemDeEstado>Sem dados disponíveis para o gráfico.</MensagemDeEstado>
      </Cartao>
    );
  }

  const areas = g.series.filter((s) => s.desenho === 'area');
  const linhas = g.series.filter((s) => s.desenho === 'linha');
  const naFaceta = g.facetada !== null;

  // O TETO SAI DE TODAS AS CATEGORIAS, não das visíveis — ver `geometriaDoGrafico`.
  const linhasDoTudo = naFaceta ? [] : gTudo.series.filter((x) => x.desenho === 'linha');
  const { geo, marcas } = geometriaDoGrafico({
    alturaDaCaixa: caixa.h,
    larguraDoPlot,
    nCategorias: g.categorias.length,
    naFaceta,
    teto: gTudo.percentual
      ? 100
      : maiorValorDe(linhasDoTudo, tetoDasAreas(gTudo.series, gTudo.empilha)),
    empilha: g.empilha,
    nAreas: areas.length,
  });

  const sub = conferencia
    ? [
        `${inteiro(d.pontos.length)} pontos`,
        `${g.series.length} série(s)`,
        ...(g.percentual ? ['100% empilhado'] : []),
      ]
    : g.percentual
      ? ['100% empilhado']
      : [];
  const titulo = tituloDeGrafico(visual, d);

  // O prefixo comum sai de TODAS as categorias — ver `prefixoComum`.
  const partesPorCat = gTudo.categorias.map((c) => c.rotulo.split(' / '));
  const comum = prefixoComum(partesPorCat);
  const partesVisiveis = g.categorias.map((_, i) => partesPorCat[de + i]?.slice(comum) ?? []);

  const acoesGrafico = (
    <div className="grupo-acoes-grafico">
      {precisaPaginar ? (
        <PaginadorDeJanela
          de={de}
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
      <ControlesDeZoom nivel={zoomIdx} niveis={BANDA_MINIMA.length} aoMudar={setZoomIdx} />
    </div>
  );

  const semDados =
    g.categorias.length === 0 ||
    g.series.every((s) => s.valores.every((v) => v === null || v === 0));
  if (semDados) {
    return (
      // `altura="grafico"`: sem ela o Cartao cai em `auto` e cresce com o conteúdo.
      <Cartao titulo={titulo} sub={sub.join(' · ')} id={visual.id} altura="grafico">
        <MensagemDeEstado>Sem dados para os filtros atuais.</MensagemDeEstado>
      </Cartao>
    );
  }

  return (
    <Cartao
      titulo={titulo}
      sub={sub.join(' · ')}
      id={visual.id}
      altura="grafico"
      acoes={acoesGrafico}
    >
      {g.series.length > 1 ? <LegendaDoGrafico series={g.series} /> : null}

      {g.avisos.map((a) => (
        <p className="aviso-grafico" key={a}>
          {a}
        </p>
      ))}

      {/* A caixa do desenho é este div, e o `<svg>` recebe exatamente a medida dela.
          `overflow: hidden` é deliberado: gráfico NÃO rola; se não cabe, ele pagina. */}
      <div className="caixa-grafico" ref={caixaRef}>
        <DesenhoDoGrafico
          largura={caixa.w}
          altura={caixa.h}
          ariaLabel={
            tituloDoVisual(visual) +
            (precisaPaginar ? ` — categorias ${de + 1} a ${ate} de ${nTotal}` : '')
          }
          categorias={g.categorias}
          partes={partesVisiveis}
          areas={areas}
          linhas={linhas}
          empilha={g.empilha}
          percentual={g.percentual}
          naFaceta={naFaceta}
          tipo={d.tiposDeSerie[0] ?? null}
          marcas={marcas}
          geo={geo}
          interacao={clique}
        />
      </div>
    </Cartao>
  );
}
