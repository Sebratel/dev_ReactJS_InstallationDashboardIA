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
import { maiorValorDe, marcasDoEixo, montaGrafico, tetoDasAreas } from '../grafico-forma.ts';
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

  const chavesArray = (d.chaves ?? []) as { papel?: string; tabela?: string; coluna?: string; nome?: string }[];
  const clica = (i: number) => {
    const chaveDeEixo = chavesArray.find((c) => (c.papel ?? 'Category') === 'Category');
    const valor = g.categorias[i]?.valores[0];
    if (aoFiltrar && chaveDeEixo && valor !== undefined) {
      const tabela = chaveDeEixo.tabela ?? '';
      const coluna = chaveDeEixo.coluna ?? '';
      aoFiltrar(tabela, coluna, valor);
    }
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

  const semDados = g.categorias.length === 0 || g.series.every((s) => s.valores.every((v) => v === null || v === 0));
  if (semDados) {
    return (
      <Cartao titulo={titulo} sub={sub.join(' · ')} id={visual.id} largo>
        <p className="sob-demanda">Sem dados para os filtros atuais.</p>
      </Cartao>
    );
  }

  return (
    <Cartao titulo={titulo} sub={sub.join(' · ')} id={visual.id} largo>
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
