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

import { useMemo, useState } from 'react';
import type { DadosDeTabela, VisualCalculado } from '../../services/dashboardService.ts';
import { formata, inteiro } from '../../utils/formato.ts';
import { corDaSerie, corNoTema } from '../../utils/graficoForma.ts';
import { montaTooltipDeRosca, type PosicaoDoPonteiro } from '../../utils/graficoTooltip.ts';
import { useThemeStore } from '../../store/themeStore.ts';
import { tituloDeTabela } from '../../utils/rotulos.ts';
import { Cartao } from '../ui/Cartao.tsx';
import { useCaixa } from '../../hooks/useCaixa.ts';
import { MensagemDeEstado } from '../ui/Estado.tsx';
import { TooltipDoGrafico } from './TooltipDoGrafico.tsx';

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
  const [sob, setSob] = useState<number | null>(null);
  const [posPonteiro, setPosPonteiro] = useState<PosicaoDoPonteiro | null>(null);

  const dadosDaTabela = visual.dados as DadosDeTabela | undefined;

  /**
   * A coluna-categoria é a marcada `chave` (o mesmo sinal que a API já manda para
   * `Tabela.tsx` saber qual coluna é o rótulo); a coluna-valor é a primeira numérica
   * que sobrar. Sem isso, teria de adivinhar por nome — e nome de medida varia por
   * página (`Qtd`, `Total`, `Vezes Agendado`).
   */
  const fatias = useMemo<Fatia[]>(() => {
    if (!dadosDaTabela || !dadosDaTabela.colunas || !dadosDaTabela.linhas) return [];
    const iCatMarcada = dadosDaTabela.colunas.findIndex((coluna) => coluna.chave);
    const iCat = iCatMarcada >= 0 ? iCatMarcada : 0;
    const iVal = dadosDaTabela.colunas.findIndex(
      (coluna, indice) => indice !== iCat && coluna.tipo === 'number',
    );
    if (iVal < 0) return [];

    return dadosDaTabela.linhas
      .map((linha) => ({
        rotulo: formata(linha[iCat] ?? null, dadosDaTabela.colunas[iCat]?.tipo ?? null).texto,
        valor: typeof linha[iVal] === 'number' ? linha[iVal] : 0,
      }))
      .filter((linha) => linha.valor > 0)
      .map((linha, indice) => ({
        ...linha,
        cor: corNoTema(corDaSerie(linha.rotulo, indice), isDark),
      }));
  }, [dadosDaTabela, isDark]);

  if (!dadosDaTabela) return null;

  const total = fatias.reduce((soma, fatia) => soma + fatia.valor, 0);
  const titulo = tituloDeTabela(visual, dadosDaTabela.colunas ?? []);

  if (fatias.length === 0 || total === 0) {
    return (
      <Cartao titulo={titulo} id={visual.id} altura="tabela">
        <MensagemDeEstado>Sem dados para os filtros atuais.</MensagemDeEstado>
      </Cartao>
    );
  }

  const lado = Math.max(1, Math.min(caixa.w, caixa.h));
  const raioExterno = lado / 2 - 4;
  const espessuraTraco = Math.max(ESPESSURA_MINIMA, raioExterno * ESPESSURA);
  const raioMedio = Math.max(1, raioExterno - espessuraTraco / 2);
  const circunferencia = 2 * Math.PI * raioMedio;
  const centroX = caixa.w / 2;
  const centroY = lado / 2;

  // Mutação controlada dentro do `.map`, mesmo idioma de `Grafico.tsx` (`acumulado.alto`
  // nas colunas empilhadas): a ordem de `fatias` é a ordem de desenho, e cada fatia
  // precisa saber quanto já foi desenhado antes dela.
  const acumulado = { valor: 0 };

  const fatiaAtiva = sob !== null ? (fatias[sob] ?? null) : null;
  const dadosTooltip = fatiaAtiva
    ? montaTooltipDeRosca({
        rotulo: fatiaAtiva.rotulo,
        valor: fatiaAtiva.valor,
        cor: fatiaAtiva.cor,
        total,
      })
    : null;

  return (
    <Cartao titulo={titulo} id={visual.id} altura="tabela">
      <div className="legenda">
        {fatias.map((fatia) => (
          <span className="chave" key={fatia.rotulo}>
            <i className="ponto" style={{ background: fatia.cor }} />
            <span>
              {fatia.rotulo} · {inteiro(fatia.valor)}
            </span>
          </span>
        ))}
      </div>
      <div
        className="caixa-grafico"
        ref={caixaRef}
        onMouseMove={(evento) => setPosPonteiro({ x: evento.clientX, y: evento.clientY })}
        onMouseLeave={() => {
          setSob(null);
          setPosPonteiro(null);
        }}
      >
        <svg
          className="grafico-svg"
          width={caixa.w}
          height={lado}
          role="img"
          aria-label={`${titulo}: total ${inteiro(total)}, ${fatias.length} categoria(s)`}
        >
          <g transform={`rotate(-90 ${centroX} ${centroY})`}>
            {fatias.map((fatia, indice) => {
              const comprimento = (fatia.valor / total) * circunferencia;
              const deslocamento = -((acumulado.valor / total) * circunferencia);
              acumulado.valor += fatia.valor;
              const ativa = sob === indice;
              return (
                <circle
                  key={fatia.rotulo}
                  className="rosca-fatia"
                  cx={centroX}
                  cy={centroY}
                  r={raioMedio}
                  fill="none"
                  stroke={fatia.cor}
                  strokeWidth={ativa ? espessuraTraco + 3 : espessuraTraco}
                  opacity={sob !== null && !ativa ? 0.55 : 1}
                  strokeDasharray={`${comprimento} ${Math.max(0, circunferencia - comprimento)}`}
                  strokeDashoffset={deslocamento}
                  onMouseEnter={() => setSob(indice)}
                  onMouseLeave={() => setSob(null)}
                />
              );
            })}
          </g>
          <text x={centroX} y={centroY - 3} textAnchor="middle" className="rosca-total">
            {inteiro(total)}
          </text>
          <text x={centroX} y={centroY + 15} textAnchor="middle" className="rosca-total-rotulo">
            total
          </text>
        </svg>
      </div>
      <TooltipDoGrafico dados={dadosTooltip} pos={posPonteiro} />
    </Cartao>
  );
}
