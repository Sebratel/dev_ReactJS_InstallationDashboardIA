// A rosca com centro numérico — Fase L6, docs/PLANO-LAYOUT-V1.md §8.
//
// Mesmo dado de sempre: lê o `DadosDeTabela` que `Tabela.tsx` já lê (zero requisição
// nova, zero campo novo). O que muda é o desenho — para uma composição de poucas
// categorias (STATUS, TURNO, PRAZO SLA), uma barra-por-linha gasta uma linha inteira
// por valor; a rosca mostra a composição inteira de um golpe só, com o total no centro.
//
// A troca de forma é DECLARADA em `layout.yaml` (`render: rosca`), nunca decidida por
// cardinalidade em tempo de render — é a mesma disciplina anti-heurística da Fase L4
// (`VisualGridSection.tsx`). O tipo original do PBIP fica registrado ao lado, em
// `improvements:`, com `numero_muda: false`: o número é idêntico ao da tabela que saiu.

import { useMemo } from 'react';
import type { DadosDeTabela, VisualCalculado } from '../../services/dashboardService.ts';
import { formata, inteiro } from '../../utils/formato.ts';
import { corDaSerie, corNoTema } from '../../utils/graficoForma.ts';
import { useThemeStore } from '../../store/themeStore.ts';
import { tituloDeTabela } from '../../utils/rotulos.ts';
import { Cartao } from '../ui/Cartao.tsx';
import { useCaixa } from '../../hooks/useCaixa.ts';

/** A faixa da rosca, fração do raio externo. 0 seria pizza cheia; perto de 1, ela some. */
const ESPESSURA = 0.34;
/** Abaixo disso a faixa vira um traço ilegível — mesmo piso de espírito do `Grafico.tsx`. */
const ESPESSURA_MINIMA = 14;

interface Fatia {
  rotulo: string;
  valor: number;
  cor: string;
}

export function Rosca({ visual }: { visual: VisualCalculado }) {
  const { isDark } = useThemeStore();
  const [caixaRef, caixa] = useCaixa();

  const d = visual.dados as DadosDeTabela | undefined;

  /**
   * A coluna-categoria é a marcada `chave` (o mesmo sinal que a API já manda para
   * `Tabela.tsx` saber qual coluna é o rótulo); a coluna-valor é a primeira numérica
   * que sobrar. Sem isso, teria de adivinhar por nome — e nome de medida varia por
   * página (`Qtd`, `Total`, `Vezes Agendado`).
   */
  const fatias = useMemo<Fatia[]>(() => {
    if (!d || !d.colunas || !d.linhas) return [];
    const iCatMarcada = d.colunas.findIndex((c) => c.chave);
    const iCat = iCatMarcada >= 0 ? iCatMarcada : 0;
    const iVal = d.colunas.findIndex((c, i) => i !== iCat && c.tipo === 'number');
    if (iVal < 0) return [];

    return d.linhas
      .map((linha) => ({
        rotulo: formata(linha[iCat] ?? null, d.colunas[iCat]?.tipo ?? null).texto,
        valor: typeof linha[iVal] === 'number' ? linha[iVal] : 0,
      }))
      .filter((f) => f.valor > 0)
      .map((f, i) => ({ ...f, cor: corNoTema(corDaSerie(f.rotulo, i), isDark) }));
  }, [d, isDark]);

  if (!d) return null;

  const total = fatias.reduce((a, f) => a + f.valor, 0);
  const titulo = tituloDeTabela(visual, d.colunas ?? []);

  if (fatias.length === 0 || total === 0) {
    return (
      <Cartao titulo={titulo} id={visual.id} altura="tabela">
        <p className="sob-demanda">Sem dados para os filtros atuais.</p>
      </Cartao>
    );
  }

  const lado = Math.max(1, Math.min(caixa.w, caixa.h));
  const raioExterno = lado / 2 - 4;
  const espessuraTraco = Math.max(ESPESSURA_MINIMA, raioExterno * ESPESSURA);
  const raioMedio = Math.max(1, raioExterno - espessuraTraco / 2);
  const circunferencia = 2 * Math.PI * raioMedio;
  const cx = caixa.w / 2;
  const cy = lado / 2;

  // Mutação controlada dentro do `.map`, mesmo idioma de `Grafico.tsx` (`acumulado.alto`
  // nas colunas empilhadas): a ordem de `fatias` é a ordem de desenho, e cada fatia
  // precisa saber quanto já foi desenhado antes dela.
  const acumulado = { valor: 0 };

  return (
    <Cartao titulo={titulo} id={visual.id} altura="tabela">
      <div className="legenda">
        {fatias.map((f) => (
          <span className="chave" key={f.rotulo}>
            <i className="ponto" style={{ background: f.cor }} />
            <span>
              {f.rotulo} · {inteiro(f.valor)}
            </span>
          </span>
        ))}
      </div>
      <div className="caixa-grafico" ref={caixaRef}>
        <svg
          className="grafico-svg"
          width={caixa.w}
          height={lado}
          role="img"
          aria-label={`${titulo}: total ${inteiro(total)}, ${fatias.length} categoria(s)`}
        >
          <g transform={`rotate(-90 ${cx} ${cy})`}>
            {fatias.map((f) => {
              const comprimento = (f.valor / total) * circunferencia;
              const deslocamento = -((acumulado.valor / total) * circunferencia);
              acumulado.valor += f.valor;
              return (
                <circle
                  key={f.rotulo}
                  cx={cx}
                  cy={cy}
                  r={raioMedio}
                  fill="none"
                  stroke={f.cor}
                  strokeWidth={espessuraTraco}
                  strokeDasharray={`${comprimento} ${Math.max(0, circunferencia - comprimento)}`}
                  strokeDashoffset={deslocamento}
                >
                  <title>{`${f.rotulo}: ${inteiro(f.valor)} (${((f.valor / total) * 100).toFixed(0)}%)`}</title>
                </circle>
              );
            })}
          </g>
          <text x={cx} y={cy - 3} textAnchor="middle" className="rosca-total">
            {inteiro(total)}
          </text>
          <text x={cx} y={cy + 15} textAnchor="middle" className="rosca-total-rotulo">
            total
          </text>
        </svg>
      </div>
    </Cartao>
  );
}
