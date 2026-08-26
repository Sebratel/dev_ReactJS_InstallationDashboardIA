// O gráfico, em SVG: eixo, grade, colunas empilhadas ou agrupadas, e a linha por cima.
//
// **O que existia aqui não era gráfico.** Era uma lista de barras horizontais em `div`,
// uma linha por ponto, sem eixo — e sem olhar o papel das chaves, então o campo de
// legenda virava mais um ponto no eixo. A `TAXAS DE PRODUTIVIDADE`, que são 4 status
// por dia, saía como 124 tiras em vez de 31 colunas de 4 fatias.
//
// A decisão de forma, escala e cor está em `grafico-forma.ts`, que `npm test` cobre.
// Aqui é só geometria.

import { useState } from 'react';
import type { DadosDeGrafico, Valor, VisualCalculado } from '../api.ts';
import { formata, inteiro } from '../formato.ts';
import { corNoTema, maiorValorDe, marcasDoEixo, montaGrafico, tetoDasAreas } from '../grafico-forma.ts';
import { useThemeStore } from '../store/useThemeStore.ts';
import { Cartao } from './Cartao.tsx';
import { tituloDoVisual } from '../rotulos.ts';
import { usaModo } from '../modo.tsx';

/** Geometria do desenho. A faixa do eixo X entra na altura — o cartão não rola. */
const ALTURA = 260;
const FACETA = 96;
const MARGEM = { topo: 14, direita: 8, base: 46, esquerda: 54 };
/** Marca de 24px é o teto do guia: acima disso a coluna vira bloco. */
const LARGURA_MAXIMA = 24;
/** O vão de 2px na cor do fundo é o que separa as fatias — nunca uma borda. */
const VAO = 2;

export function Grafico({
  visual,
  aoFiltrar,
}: {
  visual: VisualCalculado;
  aoFiltrar?: (tabela: string, coluna: string, valor: Valor) => void;
}) {
  const { conferencia } = usaModo();
  const d = visual.dados as DadosDeGrafico;
  const g = montaGrafico(d);
  const [sob, setSob] = useState<number | null>(null);

  const areas = g.series.filter((s) => s.desenho === 'area');
  const linhas = g.series.filter((s) => s.desenho === 'linha');
  const naFaceta = g.facetada !== null;
  const linhasJuntas = naFaceta ? [] : linhas;

  const nCat = g.categorias.length;
  const larguraDoPlot = Math.max(420, nCat * 34);
  const largura = larguraDoPlot + MARGEM.esquerda + MARGEM.direita;
  const alturaDoPlot = ALTURA - MARGEM.topo - MARGEM.base;
  const banda = nCat > 0 ? larguraDoPlot / nCat : larguraDoPlot;

  const teto = g.percentual ? 100 : maiorValorDe(linhasJuntas, tetoDasAreas(g.series, g.empilha));
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

  const clica = (i: number) => {
    const chaveDeEixo = (d.chaves ?? []).find((c) => (c.papel ?? 'Category') === 'Category');
    const valor = g.categorias[i]?.valores[0];
    if (aoFiltrar && chaveDeEixo && valor !== undefined) aoFiltrar(chaveDeEixo.tabela, chaveDeEixo.coluna, valor);
  };

  // Em apresentação, a contagem de pontos e séries é ruído — a legenda já nomeia as
  // séries e o eixo já mostra as categorias. Sobra só a dica que muda a leitura do
  // gráfico: que ele é proporção, não valor absoluto.
  const sub = conferencia
    ? [`${inteiro(d.pontos.length)} pontos`, `${g.series.length} série(s)`, ...(g.percentual ? ['100% empilhado'] : [])]
    : g.percentual
      ? ['100% empilhado']
      : [];

  // Título auto-descritivo quando o visual não tem título próprio no relatório: em vez
  // de "Gráfico de colunas", diz o que ele mede e por qual eixo — "Qtd Protocolos por
  // EQUIPE". O nome cru do tipo não ajudava a operação a saber o que está vendo.
  const eixo = (d.chaves ?? []).find((c) => (c.papel ?? 'Category') === 'Category');
  const nomesMedidas = (d.series ?? []).map((s) => s.nome).filter((n): n is string => !!n);
  const nomeEixo = eixo?.nome ?? eixo?.coluna;
  const titulo =
    visual.titulo?.trim() || !(nomesMedidas.length && nomeEixo)
      ? tituloDoVisual(visual)
      : `${nomesMedidas.slice(0, 3).join(' · ')} por ${nomeEixo}`;

  // Sem nenhuma categoria, ou tudo zerado/nulo: um eixo vazio com um "0" solto confunde
  // mais do que informa. Dizemos que não há dado para os filtros atuais.
  const semDados = g.categorias.length === 0 || g.series.every((s) => s.valores.every((v) => v === null || v === 0));
  if (semDados) {
    return (
      <Cartao titulo={titulo} sub={sub.join(' · ')} id={visual.id} largo>
        <p className="sob-demanda">Sem dados para os filtros atuais.</p>
      </Cartao>
    );
  }

  // Rótulos de eixo hierárquicos ("2026 / agosto / 5") repetem os níveis altos em toda
  // barra. Removemos o prefixo comum a todas as categorias — sobra o que varia, como no
  // eixo hierárquico do Power BI. O rótulo cheio continua no tooltip da barra.
  // O prefixo comum sai de TODAS as categorias, não das da página. Se saísse da
  // página, virar de página poderia mudar o que o rótulo significa — numa página
  // de um mês só o mês seria "comum" e desapareceria, na seguinte não.
  const partesPorCat = gTudo.categorias.map((c) => c.rotulo.split(' / '));
  let prefixoComum = 0;
  if (partesPorCat.length > 1) {
    const min = Math.min(...partesPorCat.map((p) => p.length));
    while (
      prefixoComum < min - 1 &&
      partesPorCat.every((p) => p[prefixoComum] === partesPorCat[0]![prefixoComum])
    ) {
      prefixoComum++;
    }
  }

  /**
   * O rótulo do eixo, montado DO NÍVEL MAIS ESPECÍFICO PARA TRÁS.
   *
   * Corrigido em 26/08/2026, e o sintoma era óbvio na tela: numa hierarquia de
   * data o rótulo virava `"julho / 15"` e o corte por orçamento de caracteres
   * ("primeiros N, depois …") devolvia **"julho /…"** — cortava exatamente o dia,
   * que é a única parte que distingue uma coluna da vizinha. Um eixo com vinte
   * rótulos idênticos é pior do que um eixo sem rótulo, porque parece informar.
   *
   * A regra do padrão é "extraia a parte que distingue". Então começamos pelo
   * último nível e só acrescentamos os anteriores enquanto couberem, com `/`
   * apertado em vez de ` / `: com 8 caracteres de orçamento, `"julho / 15"` vira
   * **"julho/15"** em vez de "julho /…".
   */
  const rotuloEixo = (iVisivel: number, orcamento: number): string => {
    const partes = partesPorCat[de + iVisivel]?.slice(prefixoComum) ?? [];
    const base = partes.length > 0 ? partes : [g.categorias[iVisivel]?.rotulo ?? ''];
    let texto = base[base.length - 1] ?? '';
    for (let k = base.length - 2; k >= 0; k -= 1) {
      const tentativa = `${base[k]}/${texto}`;
      if (tentativa.length > orcamento) break;
      texto = tentativa;
    }
    // Sobrando só um nível longo (nome de cidade, de equipe), aí sim corta no fim.
    return texto.length > orcamento ? `${texto.slice(0, orcamento - 1)}…` : texto;
  };

  return (
    <Cartao titulo={titulo} sub={sub.join(' · ')} id={visual.id} largo>
      {/* Legenda sempre que há duas séries: identidade nunca fica só na cor. */}
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

      <div className="rolagem-grafico">
        <svg
          className="grafico-svg"
          width={largura}
          height={ALTURA + (naFaceta ? FACETA : 0)}
          role="img"
          aria-label={tituloDoVisual(visual)}
        >
          {/* Grade e marcas: hairline sólido, um passo do fundo, recuado. */}
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
                className="col-grupo"
                onClick={() => clica(i)}
                onMouseEnter={() => setSob(i)}
                onMouseLeave={() => setSob(null)}
              >
                {/* Alvo de clique/hover maior que a marca — a banda inteira. */}
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

          {/* Linha do eixo e rótulos das categorias. */}
          <line className="eixo" x1={MARGEM.esquerda} x2={largura - MARGEM.direita} y1={y(0)} y2={y(0)} />
          {g.categorias.map((c, i) => (
            <text
              key={i}
              className={`rotulo-x${sob === i ? ' sob' : ''}`}
              x={xMeio(i)}
              y={y(0) + 14}
              textAnchor="end"
              transform={`rotate(-45 ${xMeio(i)} ${y(0) + 14})`}
            >
              {c.rotulo.length > 18 ? `${c.rotulo.slice(0, 17)}…` : c.rotulo}
            </text>
          ))}

          {/* A linha por cima das colunas, na mesma escala. */}
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

          {/* Rótulo direto só no extremo de cada série de linha — nunca em todo ponto. */}
          {linhasJuntas.map((s) => {
            const iMax = maiorIndice(s.valores);
            if (iMax === null) return null;
            return (
              <text key={s.chave} className="rotulo-valor" x={xMeio(iMax)} y={y(s.valores[iMax]!) - 9} textAnchor="middle">
                {inteiro(s.valores[iMax]!)}
              </text>
            );
          })}

          {/* Painel próprio da linha, quando a escala não dá para dividir. */}
          {naFaceta ? (
            <FacetaDeLinha
              series={linhas}
              xMeio={xMeio}
              topoDoPainel={ALTURA + 6}
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

/** O painel de baixo: a linha na escala dela, compartilhando o eixo X de cima. */
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

/** O `d` do path, quebrando em `null` — buraco no dado é buraco na linha, não zero. */
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
