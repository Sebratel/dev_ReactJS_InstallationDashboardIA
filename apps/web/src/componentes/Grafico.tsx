// O gráfico, em SVG: eixo, grade, colunas empilhadas ou agrupadas, e a linha por cima.
//
// **O que existia aqui não era gráfico.** Era uma lista de barras horizontais em `div`,
// uma linha por ponto, sem eixo — e sem olhar o papel das chaves, então o campo de
// legenda virava mais um ponto no eixo. A `TAXAS DE PRODUTIVIDADE`, que são 4 status
// por dia, saía como 124 tiras em vez de 31 colunas de 4 fatias.
//
// A decisão de forma, escala e cor está em `grafico-forma.ts`, que `npm test` cobre.
// Aqui é só geometria.

import { useMemo, useState } from 'react';
import type { DadosDeGrafico, FiltroDaTela, VisualCalculado } from '../api.ts';
import { formata, inteiro } from '../formato.ts';
import { corNoTema, maiorValorDe, marcasDoEixo, montaGrafico, tetoDasAreas } from '../grafico-forma.ts';
import { useThemeStore } from '../store/useThemeStore.ts';
import { Cartao } from './Cartao.tsx';
import { tituloDoVisual } from '../rotulos.ts';
import { selecaoDe, type AoFiltrar } from '../rota.ts';
import { usaModo } from '../modo.tsx';
import { usaCaixa } from './usa-caixa.ts';

const FACETA = 96;
// `base` de 64 e nao 46: a margem de baixo e o teto do rotulo girado, e com 46 ele
// cabia em 8 caracteres. Numa caixa de 460px sobra espaco, e o plot fica com 382.
const MARGEM = { topo: 14, direita: 8, base: 64, esquerda: 54 };
/** Marca de 24px é o teto do guia: acima disso a coluna vira bloco. */
const LARGURA_MAXIMA = 24;
/** O vão de 2px na cor do fundo é o que separa as fatias — nunca uma borda. */
const VAO = 2;

/* ============================================================================
   GRÁFICO NÃO ROLA: ELE PAGINA.

   O desenho tinha largura FIXA por categoria (`max(420, nCat * 34)`) dentro de um
   contêiner com `overflow-x: auto`. Com 87 categorias isso são **2.958px de
   desenho num card de ~1.600px**: você vê metade e arrasta o resto. É o que a
   regra de layout existe para impedir — gráfico maior que a tela é gráfico que
   ninguém vê inteiro.

   Agora a caixa do desenho é MEDIDA, o `<svg>` recebe exatamente a medida dela, e
   quando as categorias não cabem com largura legível o gráfico mostra uma janela
   com paginador. O P/M/G escolhe a densidade: quantas categorias por página.
   ============================================================================ */

/**
 * Largura mínima por categoria em cada densidade (P, M, G).
 *
 * Vem do rótulo, não do gosto: girado a 45°, o rótulo dispõe de `banda / cos(45°)`
 * px de diagonal, e a fonte do eixo gasta ~5,6px por caractere. Em 40px isso dá
 * ~10 caracteres — o suficiente para "26/08" ou uma sigla de equipe.
 */
const BANDA_MINIMA = [24, 40, 64];
/** Abaixo de 4 categorias por página o gráfico deixa de comunicar tendência. */
const MINIMO_POR_PAGINA = 4;

// A ALTURA É A DA CAIXA, SEM PISO — e aqui havia um, de 160px, dentro de `usaCaixa`
// (agora em `usa-caixa.ts`, compartilhado com `Rosca.tsx`).
//
// O cabeçalho do `.caixa-grafico` no CSS diz, com todas as letras, que piso acima da
// caixa faz o `<svg>` transbordar. Aquela linha era esse piso, uma camada acima: quando
// o corpo do card sobrava menos de 160px para o desenho, a medida MENTIA 160 e o `<svg>`
// saía maior que a caixa que o contém, cortado pelo `overflow: hidden` dela — sem erro,
// sem rolagem, sem nada acusando.
//
// Medido em 27/08/2026 no RELATÓRIO DO ANO a 1366x768: card de 273px em que a legenda e
// dois avisos comem 164px, caixa real de **109px**, `<svg>` desenhado com **160px**.
// Aparecia só em 1366 e 1440 — nas telas altas a caixa passava dos 160 e o piso nunca
// pegava. E o SEGUNDO piso, de 120px, contradizia o comentário — somados aos 160,
// garantiam o transbordo em vez de evitá-lo. Sem piso nenhum, `topo + plot + base` fecha
// EXATAMENTE em `alturaSvg`: `base` é no máximo 30% do espaço, então o que sobra para o
// plot é sempre positivo.
//
// Foi visto também na MANUTENÇÃO INICIAL (27/08/2026): `<svg height="372">` dentro de
// uma caixa de 344px — o desenho fora medido antes de a barra de filtros publicar a
// altura real dela, `--util` encolheu 21px depois, e o gráfico ficou com o tamanho
// antigo transbordando por 28px. `usa-caixa.ts` remede no `resize` e quando a fonte
// carrega, exatamente para pegar esses dois casos.

export function Grafico({
  visual,
  aoFiltrar,
  filtros,
}: {
  visual: VisualCalculado;
  aoFiltrar?: AoFiltrar;
  filtros?: readonly FiltroDaTela[];
}) {
  const { conferencia } = usaModo();
  const { isDark } = useThemeStore();

  // TODOS os hooks vêm ANTES de qualquer `return`. O guarda de nulo estava acima do
  // `useState`, o que muda a ORDEM DOS HOOKS entre renderizações: se `dados`
  // chegasse vazio num quadro e cheio no seguinte, o React derrubaria a árvore.
  const [sob, setSob] = useState<number | null>(null);
  const [zoomIdx, setZoomIdx] = useState<number>(1);
  const [inicio, setInicio] = useState<number | null>(null);
  const [caixaRef, caixa] = usaCaixa();

  const d = visual.dados as DadosDeGrafico | undefined;
  const gTudo = useMemo(() => (d && d.series && d.pontos ? montaGrafico(d) : null), [d]);

  // ----------------------------------------------- quantas cabem, e qual janela
  const nTotal = gTudo?.categorias.length ?? 0;
  const larguraDoPlot = Math.max(120, caixa.w - MARGEM.esquerda - MARGEM.direita);
  const bandaMinima = BANDA_MINIMA[zoomIdx] ?? 40;
  const cabem = Math.max(MINIMO_POR_PAGINA, Math.floor(larguraDoPlot / bandaMinima));
  const pagina = Math.min(cabem, Math.max(nTotal, 1));
  const precisaPaginar = nTotal > pagina;
  // Abre na ÚLTIMA página: categoria de gráfico operacional é quase sempre tempo
  // ordenado, e o que interessa é o presente. `null` = ainda no padrão, então a
  // janela acompanha o fim quando um filtro muda o tamanho da série.
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

  if (!d || !g || !gTudo) return null;

  const areas = g.series.filter((s) => s.desenho === 'area');
  const linhas = g.series.filter((s) => s.desenho === 'linha');
  const naFaceta = g.facetada !== null;
  const linhasJuntas = naFaceta ? [] : linhas;

  const nCat = g.categorias.length;
  const largura = caixa.w;
  // A altura é EXATAMENTE a da caixa, sem piso: piso acima dela faz o `<svg>`
  // transbordar e devolve a rolagem, agora vertical. Quem cede é a margem de
  // baixo, não o tamanho do desenho.
  // E aqui havia o SEGUNDO piso, de 120px, contradizendo o comentário logo acima.
  // Somados aos 160 de `usaCaixa`, eram dois números que garantiam o transbordo em vez
  // de evitá-lo. Sem piso nenhum, `topo + plot + base` fecha EXATAMENTE em `alturaSvg`:
  // `base` é no máximo 30% do espaço, então o que sobra para o plot é sempre positivo.
  const alturaSvg = caixa.h;
  const espacoAbaixoDoTopo = alturaSvg - MARGEM.topo - (naFaceta ? FACETA : 0);
  const base = Math.max(18, Math.min(MARGEM.base, Math.round(espacoAbaixoDoTopo * 0.3)));
  const alturaDoPlot = Math.max(1, espacoAbaixoDoTopo - base);
  /** Rótulo girado a 45° só cabe se a margem de baixo der ~34px. */
  const cabemRotulos = base >= 34;
  const banda = nCat > 0 ? larguraDoPlot / nCat : larguraDoPlot;

  // O TETO SAI DE TODAS AS CATEGORIAS, não das visíveis. Reescalar o eixo a cada
  // página faria duas páginas com colunas de altura igual valerem números
  // diferentes — o jeito mais rápido de fazer alguém ler o gráfico errado.
  const linhasDoTudo = naFaceta ? [] : gTudo.series.filter((x) => x.desenho === 'linha');
  const teto = gTudo.percentual
    ? 100
    : maiorValorDe(linhasDoTudo, tetoDasAreas(gTudo.series, gTudo.empilha));
  const marcas = marcasDoEixo(teto);
  const topo = Math.max(...marcas, 1);
  const y = (v: number) => MARGEM.topo + alturaDoPlot * (1 - v / topo);
  const xMeio = (i: number) => MARGEM.esquerda + banda * (i + 0.5);

  /** A soma da pilha numa categoria — o divisor do modo percentual. */
  const somaEm = (i: number) => areas.reduce((a, s) => a + (s.valores[i] ?? 0), 0);
  const valorDesenhado = (v: number | null, i: number): number | null => {
    if (v === null) return null;
    if (!g.percentual) return v;
    const soma = somaEm(i);
    return soma > 0 ? (v / soma) * 100 : null;
  };

  const larguraDaMarca = Math.min(LARGURA_MAXIMA, Math.max(6, banda - 10));
  const larguraDaFatia = g.empilha ? larguraDaMarca : Math.max(3, (larguraDaMarca - VAO * (areas.length - 1)) / Math.max(areas.length, 1));

  const chavesArray = (d.chaves ?? []) as {
    papel?: string;
    tabela?: string;
    coluna?: string;
    nivel?: string | null;
    nome?: string;
  }[];

  /**
   * O clique manda a CATEGORIA INTEIRA, um alvo por chave de eixo.
   *
   * A ordem casa porque as duas listas saem do mesmo filtro: `grafico-forma.ts` monta
   * `iEixo` filtrando `chaves` por papel e projeta `categorias[].valores` por esse
   * mesmo `iEixo` (linhas 199 e 214 de lá). Posição a posição, `chavesDeEixo[k]`
   * descreve `valores[k]`.
   *
   * Antes daqui saía UM par, da primeira chave e do primeiro valor — numa hierarquia
   * de data isso virava `Data = 2026` sem nível, com a barra significando um dia. Ver
   * `AlvoDeFiltro` em `rota.ts` para o estrago que isso fazia na tela.
   *
   * Valor nulo sai da lista: `(vazio)` não é valor de banco, e filtrar por ele
   * devolveria tela vazia. Se a categoria inteira for nula não sobra alvo e o clique
   * não faz nada — que é o certo para um rótulo-sentinela.
   */
  const alvosDa = (i: number) => {
    const chavesDeEixo = chavesArray.filter((c) => (c.papel ?? 'Category') === 'Category');
    const valores = g.categorias[i]?.valores ?? [];
    return chavesDeEixo
      .map((c, k) => ({
        tabela: c.tabela ?? '',
        coluna: c.coluna ?? '',
        ...(c.nivel ? { nivel: c.nivel } : {}),
        valor: valores[k] ?? null,
      }))
      .filter((a) => a.tabela !== '' && a.coluna !== '' && a.valor !== null);
  };

  /**
   * CURSOR DE MÃO SÓ ONDE O CLIQUE FILTRA — e ele não estava em lugar nenhum.
   *
   * `.col-grupo` tinha `onClick` e nenhuma regra de `cursor`: medido em 28/08/2026,
   * zero elementos com cursor de mão no `<svg>`. O gráfico inteiro era clicável em
   * silêncio, e a barra que NÃO filtra (categoria nula, eixo sem tabela) parecia igual
   * à que filtra. Promessa falsa nos dois sentidos.
   */
  const podeClicar = (i: number) => aoFiltrar !== undefined && alvosDa(i).length > 0;

  /**
   * O QUE ESTÁ SELECIONADO NO EIXO — e por que o gráfico precisa saber disto.
   *
   * Com a auto-exclusão do servidor, o visual clicado volta com TODAS as categorias:
   * é o que faz clicar em SÃO LEOPOLDO manter as outras cidades na tela, em vez de
   * deixar uma barra só e matar a comparação que motivou o clique. Mas aí o clique
   * não teria efeito VISÍVEL nenhum — a mesma tela de antes. Quem carrega o recorte
   * é o destaque: a selecionada fica cheia, as outras esmaecem.
   *
   * `null` num nível significa "sem filtro nele", e aí ele não restringe nada. Sem
   * filtro em nenhum nível do eixo, `haSelecao` é falso e nada esmaece — tela sem
   * clique é tela normal.
   */
  const selecaoDoEixo = chavesArray
    .filter((c) => (c.papel ?? 'Category') === 'Category')
    .map((c) => {
      if (!filtros || !c.tabela || !c.coluna) return null;
      const sel = selecaoDe(filtros, c.tabela, c.coluna, c.nivel ?? undefined);
      return sel.length > 0 ? sel : null;
    });
  const haSelecao = selecaoDoEixo.some((s) => s !== null);

  const estaSelecionada = (i: number) => {
    const valores = g.categorias[i]?.valores ?? [];
    return selecaoDoEixo.every(
      (sel, k) => sel === null || sel.some((v) => Object.is(v, valores[k] ?? null)),
    );
  };

  const clica = (i: number) => {
    if (!aoFiltrar) return;
    const alvos = alvosDa(i);
    if (alvos.length > 0) aoFiltrar(alvos);
  };

  const sub = conferencia
    ? [`${inteiro(d.pontos.length)} pontos`, `${g.series.length} série(s)`, ...(g.percentual ? ['100% empilhado'] : [])]
    : g.percentual
      ? ['100% empilhado']
      : [];

  const eixo = chavesArray.find((c) => (c.papel ?? 'Category') === 'Category');
  const nomesMedidas = (d.series ?? []).map((s) => s.nome).filter((n): n is string => !!n);
  const nomeEixo = (eixo as { nome?: string; coluna?: string })?.nome ?? (eixo as { nome?: string; coluna?: string })?.coluna;
  const tituloVisualVisual = (visual as { titulo?: string }).titulo;
  const titulo =
    tituloVisualVisual?.trim() || !(nomesMedidas.length && nomeEixo)
      ? tituloDoVisual(visual)
      : `${nomesMedidas.slice(0, 3).join(' · ')} por ${nomeEixo}`;

  // O prefixo comum sai de TODAS as categorias, não das da página: se saísse da
  // página, virar de página mudaria o que o rótulo significa — numa página de um
  // mês só o mês seria "comum" e desapareceria, na seguinte não.
  const partesPorCat = gTudo.categorias.map((c) => c.rotulo.split(' / '));
  let prefixoComum = 0;
  if (partesPorCat.length > 1) {
    const minPartes = Math.min(...partesPorCat.map((x) => x.length));
    while (
      prefixoComum < minPartes - 1 &&
      partesPorCat.every((x) => x[prefixoComum] === partesPorCat[0]![prefixoComum])
    ) {
      prefixoComum += 1;
    }
  }

  /**
   * O rótulo do eixo, montado DO NÍVEL MAIS ESPECÍFICO PARA TRÁS.
   *
   * O corte era `rotulo.slice(0, 17)`, os primeiros caracteres. Numa hierarquia de
   * data o rótulo é `"2026 / julho / 15"`, e cortar pelo começo devolve
   * **"2026 / julho /…"** — come exatamente o dia, a única parte que distingue uma
   * coluna da vizinha. Vinte rótulos idênticos são piores que nenhum, porque
   * parecem informar.
   *
   * Aqui começamos pelo último nível e só acrescentamos os anteriores enquanto
   * couberem, com `/` apertado: com 10 caracteres de orçamento, `"julho / 15"`
   * vira **"julho/15"**.
   */
  const rotuloEixo = (iVisivel: number, orcamento: number): string => {
    const partes = partesPorCat[de + iVisivel]?.slice(prefixoComum) ?? [];
    const base2 = partes.length > 0 ? partes : [g.categorias[iVisivel]?.rotulo ?? ''];
    let texto = base2[base2.length - 1] ?? '';
    for (let k = base2.length - 2; k >= 0; k -= 1) {
      const tentativa = base2[k] + '/' + texto;
      if (tentativa.length > orcamento) break;
      texto = tentativa;
    }
    // Sobrando um nível longo (cidade, equipe), aí sim corta no fim.
    return texto.length > orcamento ? texto.slice(0, orcamento - 1) + '…' : texto;
  };

  /** Move a janela de categorias; `passo` em páginas. */
  const anda = (passo: number) => setInicio(Math.max(0, Math.min(maxInicio, de + passo * pagina)));

  const paginador = precisaPaginar ? (
    <div className="paginador-grafico" title={inteiro(nTotal) + ' categorias no total'}>
      <button type="button" title="Primeira" disabled={de === 0} onClick={() => setInicio(0)}>
        «
      </button>
      <button type="button" title="Página anterior" disabled={de === 0} onClick={() => anda(-1)}>
        ‹
      </button>
      <span className="paginador-rotulo">
        {inteiro(de + 1)}–{inteiro(ate)} <span className="de">de {inteiro(nTotal)}</span>
      </span>
      <button type="button" title="Próxima página" disabled={de >= maxInicio} onClick={() => anda(1)}>
        ›
      </button>
      <button
        type="button"
        title="Última (mais recente)"
        disabled={de >= maxInicio}
        onClick={() => setInicio(maxInicio)}
      >
        »
      </button>
    </div>
  ) : null;

  // P/M/G já não estica o desenho: escolhe QUANTAS categorias entram na página.
  const acoesGrafico = (
    <div className="grupo-acoes-grafico">
      {paginador}
      <div className="controles-zoom" title="Densidade: quantas categorias por página">
        <button
          type="button"
          title="Mais categorias por página, colunas mais finas"
          disabled={zoomIdx === 0}
          onClick={() => setZoomIdx(Math.max(0, zoomIdx - 1))}
        >
          −
        </button>
        <span className="zoom-rotulo">{zoomIdx === 0 ? 'P' : zoomIdx === 1 ? 'M' : 'G'}</span>
        <button
          type="button"
          title="Menos categorias por página, colunas mais largas"
          disabled={zoomIdx === BANDA_MINIMA.length - 1}
          onClick={() => setZoomIdx(Math.min(BANDA_MINIMA.length - 1, zoomIdx + 1))}
        >
          +
        </button>
      </div>
    </div>
  );

  const semDados = g.categorias.length === 0 || g.series.every((s) => s.valores.every((v) => v === null || v === 0));
  if (semDados) {
    return (
      // `altura="grafico"` pelo mesmo motivo da Matriz (ver Matriz.tsx): sem ela o
      // Cartao cai em `auto`, o clamp do `.v-grafico` nunca se aplica e o cartao
      // cresce com o conteudo. Como grafico e a maioria dos visuais, era essa a
      // parcela grande dos 8.460px da pagina medidos em 27/08/2026.
      <Cartao titulo={titulo} sub={sub.join(' · ')} id={visual.id} altura="grafico">
        <p className="sob-demanda">Sem dados para os filtros atuais.</p>
      </Cartao>
    );
  }

  return (
    // `largo` saiu junto: ele so vale dentro de um pai `display: grid`
    // (`.largo { grid-column: 1 / -1 }`), e quem posiciona os graficos hoje e o
    // `VisualGridSection`, que usa flex. Ficava inerte, sugerindo um controle de
    // largura que nao existia — e o lado a lado dos compactos ja vem de la.
    <Cartao titulo={titulo} sub={sub.join(' · ')} id={visual.id} altura="grafico" acoes={acoesGrafico}>
      {g.series.length > 1 ? (
        <div className="legenda">
          {g.series.map((s) => (
            <span className="chave" key={s.chave}>
              {s.desenho === 'linha' ? (
                <i className="tracinho" style={{ background: s.cor }} />
              ) : (
                <i className="ponto" style={{ background: s.cor }} />
              )}
              <span>{s.nome}</span>
            </span>
          ))}
        </div>
      ) : null}

      {g.avisos.map((a) => (
        <p className="aviso-grafico" key={a}>
          {a}
        </p>
      ))}

      {/* A caixa do desenho é este div, e o `<svg>` recebe exatamente a medida
          dela — então não há o que arrastar. `overflow: hidden` é deliberado:
          gráfico NÃO rola; se não cabe, ele pagina. */}
      <div className="caixa-grafico" ref={caixaRef}>
        <svg
          className="grafico-svg"
          width={largura}
          height={alturaSvg}
          role="img"
          aria-label={
            tituloDoVisual(visual) +
            (precisaPaginar ? ` — categorias ${de + 1} a ${ate} de ${nTotal}` : '')
          }
        >
          {marcas.map((m) => (
            <g key={m}>
              <line className="grade" x1={MARGEM.esquerda} x2={largura - MARGEM.direita} y1={y(m)} y2={y(m)} />
              <text className="tick" x={MARGEM.esquerda - 8} y={y(m) + 3.5} textAnchor="end">
                {g.percentual ? `${m}%` : inteiro(m)}
              </text>
            </g>
          ))}

          {g.categorias.map((c, i) => {
            const acumulado = { alto: 0 };
            return (
              <g
                key={i}
                className={
                  'col-grupo' +
                  (podeClicar(i) ? ' clicavel' : '') +
                  (haSelecao && !estaSelecionada(i) ? ' apagada' : '')
                }
                onClick={() => clica(i)}
                onMouseEnter={() => setSob(i)}
                onMouseLeave={() => setSob(null)}
              >
                <rect
                  className={`banda${sob === i ? ' sob' : ''}`}
                  x={MARGEM.esquerda + banda * i}
                  y={MARGEM.topo}
                  width={banda}
                  height={alturaDoPlot}
                />
                {areas.map((s, k) => {
                  const v = valorDesenhado(s.valores[i] ?? null, i);
                  if (v === null || v === 0) return null;
                  const alturaCrua = (v / topo) * alturaDoPlot;
                  const alto = Math.max(1, alturaCrua - (g.empilha ? VAO : 0));
                  const cima = g.empilha
                    ? MARGEM.topo + alturaDoPlot - acumulado.alto - alto
                    : y(v);
                  if (g.empilha) acumulado.alto += alturaCrua;
                  const esquerda = g.empilha
                    ? xMeio(i) - larguraDaFatia / 2
                    : xMeio(i) - larguraDaMarca / 2 + k * (larguraDaFatia + VAO);
                  return (
                    <rect
                      key={s.chave}
                      x={esquerda}
                      y={cima}
                      width={larguraDaFatia}
                      height={Math.max(1, g.empilha ? alto : MARGEM.topo + alturaDoPlot - cima)}
                      fill={s.cor}
                      rx={3}
                    >
                      <title>{`${c.rotulo} · ${s.nome}: ${formata(s.valores[i] ?? null, d.tiposDeSerie[0] ?? null).texto}`}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}

          <line className="eixo" x1={MARGEM.esquerda} x2={largura - MARGEM.direita} y1={y(0)} y2={y(0)} />
          {(() => {
            // O passo existe porque a densidade P chega perto de 64 por página; e o
            // orçamento conta a banda VEZES o passo, porque um rótulo desenhado a
            // cada 2 dispõe do espaço das duas bandas.
            const passoX = banda < 30 ? 3 : banda < 44 ? 2 : 1;

            // O ORÇAMENTO TEM DUAS RESTRIÇÕES, e usar só uma corta o rótulo.
            //
            // Pela LARGURA: um rótulo desenhado a cada `passoX` dispõe da banda dele
            // mais as vizinhas em branco, e girado a 45° a diagonal é `banda/cos(45°)`.
            //
            // Pela ALTURA: girado a 45°, ele DESCE `14 + n * 5.6 * sen(45°)` px abaixo
            // do eixo. Se isso passar da margem de baixo, a caixa corta — e corta em
            // silêncio, porque `.caixa-grafico` tem `overflow: hidden`. Medido em
            // 27/08/2026 na VISÃO GERAL, que tem 5 categorias: a banda de 330px
            // liberava o rótulo inteiro e o desenho descia **66px além** da caixa.
            //
            // Poucas categorias é justamente o caso em que a largura não limita nada,
            // então sem a segunda conta o defeito só aparece nos gráficos pequenos.
            const porLargura = Math.floor((banda * passoX) / 0.71 / 5.6);
            // `- 22` e nao `- 14`: os 14 sao o deslocamento do rotulo, e os 8 a mais
            // sao folga, porque 5,6px por caractere e MEDIA — maiuscula e a reticencia
            // passam disso. Medido: com 4px de folga ainda cortava 2px; com 8, cabe.
            const porAltura = Math.floor((base - 22) / (5.6 * 0.71));
            const orcamento = Math.max(4, Math.min(porLargura, porAltura));
            return g.categorias.map((c, i) => {
              // A barra sob o mouse sempre mostra o rótulo, mesmo fora do passo — e é
              // o único que aparece quando a caixa é baixa demais para o eixo.
              if (!cabemRotulos ? sob !== i : i % passoX !== 0 && sob !== i) return null;
              return (
                <text
                  key={i}
                  className={`rotulo-x${sob === i ? ' sob' : ''}`}
                  x={xMeio(i)}
                  y={y(0) + 14}
                  textAnchor="end"
                  transform={`rotate(-45 ${xMeio(i)} ${y(0) + 14})`}
                >
                  {/* O rótulo inteiro fica no tooltip; no eixo vai o que distingue. */}
                  <title>{c.rotulo}</title>
                  {rotuloEixo(i, orcamento)}
                </text>
              );
            });
          })()}

          {linhasJuntas.map((s) => (
            <g key={s.chave}>
              <path className="linha-serie" d={caminho(s.valores, xMeio, y)} stroke={s.cor} />
              {s.valores.map((v, i) =>
                v === null ? null : (
                  <circle key={i} className="ponto-serie" cx={xMeio(i)} cy={y(v)} r={4} fill={s.cor}>
                    <title>{`${g.categorias[i]?.rotulo ?? ''} · ${s.nome}: ${inteiro(v)}`}</title>
                  </circle>
                ),
              )}
            </g>
          ))}

          {linhasJuntas.map((s) => {
            const iMax = maiorIndice(s.valores);
            if (iMax === null) return null;
            return (
              <text key={s.chave} className="rotulo-valor" x={xMeio(iMax)} y={y(s.valores[iMax]!) - 9} textAnchor="middle">
                {inteiro(s.valores[iMax]!)}
              </text>
            );
          })}

          {naFaceta ? (
            <FacetaDeLinha
              series={linhas}
              xMeio={xMeio}
              topoDoPainel={alturaSvg - FACETA + 6}
              altura={FACETA - 22}
              esquerda={MARGEM.esquerda}
              direita={largura - MARGEM.direita}
            />
          ) : null}
        </svg>
      </div>
    </Cartao>
  );
}

function FacetaDeLinha({
  series,
  xMeio,
  topoDoPainel,
  altura,
  esquerda,
  direita,
}: {
  series: readonly { chave: string; nome: string; cor: string; valores: (number | null)[] }[];
  xMeio: (i: number) => number;
  topoDoPainel: number;
  altura: number;
  esquerda: number;
  direita: number;
}) {
  const teto = maiorValorDe(series, 1);
  const marcas = marcasDoEixo(teto, 2);
  const topo = Math.max(...marcas, 1);
  const y = (v: number) => topoDoPainel + altura * (1 - v / topo);

  return (
    <g>
      {marcas.map((m) => (
        <g key={m}>
          <line className="grade" x1={esquerda} x2={direita} y1={y(m)} y2={y(m)} />
          <text className="tick" x={esquerda - 8} y={y(m) + 3.5} textAnchor="end">
            {inteiro(m)}
          </text>
        </g>
      ))}
      {series.map((s) => (
        <g key={s.chave}>
          <path className="linha-serie" d={caminho(s.valores, xMeio, y)} stroke={s.cor} />
          {s.valores.map((v, i) =>
            v === null ? null : <circle key={i} className="ponto-serie" cx={xMeio(i)} cy={y(v)} r={4} fill={s.cor} />,
          )}
        </g>
      ))}
    </g>
  );
}

function caminho(valores: readonly (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  const partes: string[] = [];
  let abriu = false;
  valores.forEach((v, i) => {
    if (v === null) {
      abriu = false;
      return;
    }
    partes.push(`${abriu ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`);
    abriu = true;
  });
  return partes.join(' ');
}

function maiorIndice(valores: readonly (number | null)[]): number | null {
  let melhor: number | null = null;
  valores.forEach((v, i) => {
    if (v === null) return;
    if (melhor === null || v > valores[melhor]!) melhor = i;
  });
  return melhor;
}
