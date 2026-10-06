// A sparkline de um KPI — Fase L6, docs/PLANO-LAYOUT-V1.md §8.
//
// Zero requisição nova: `tendencia` (layout.yaml, `kpis[].tendencia`) aponta para um
// gráfico QUE JÁ ESTÁ na mesma página — o mesmo `visuais[]` que a página inteira recebeu.
// Este componente só lê os pontos que já chegaram; nunca busca nada sozinho.
//
// Sem eixo, sem grade, sem rótulo: o valor grande do KPI já diz o número, a sparkline
// só diz a FORMA da tendência. `viewBox` + `preserveAspectRatio="none"` em vez do
// `useCaixa` de `Grafico.tsx` — aqui não há rótulo girado nem grade para alinhar em
// pixel exato, então escalar por CSS é suficiente e mais simples.

import { useMemo } from 'react';
import type { DadosDeGrafico } from '../../services/dashboardService.ts';
import { inteiro } from '../../utils/formato.ts';
import { corDaSerie, corNoTema, montaGrafico } from '../../utils/graficoForma.ts';
import { useThemeStore } from '../../store/themeStore.ts';

/** 12 pontos de contexto — o mesmo número que o §8 do plano pede. */
const N_PONTOS = 12;
const LARGURA = 100;
const ALTURA = 28;
const FOLGA = 3;

export function Sparkline({ dados }: { dados: DadosDeGrafico }) {
  const { isDark } = useThemeStore();

  const janela = useMemo(() => {
    const g = montaGrafico(dados);
    // A soma de todas as séries por ponto: para um gráfico de série única (o caso de
    // hoje) é o mesmo valor da série; para um empilhado seria o total da pilha — o
    // mesmo raciocínio de "a fatia inteira" que a Rosca já usa.
    const totais = g.categorias.map((_, i) =>
      g.series.reduce((soma, s) => soma + (s.valores[i] ?? 0), 0),
    );
    return totais.slice(-N_PONTOS);
  }, [dados]);

  if (janela.length < 2) return null;

  const maior = Math.max(...janela);
  const menor = Math.min(...janela);
  const alcance = maior - menor || 1;
  const x = (i: number) => (i / (janela.length - 1)) * LARGURA;
  const y = (v: number) => ALTURA - FOLGA - ((v - menor) / alcance) * (ALTURA - FOLGA * 2);

  const caminho = janela
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ');
  const ultimo = janela[janela.length - 1]!;
  const cor = corNoTema(corDaSerie('', 0), isDark);

  return (
    <svg
      className="kpi-sparkline"
      viewBox={`0 0 ${LARGURA} ${ALTURA}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Tendência dos últimos ${janela.length} pontos: de ${inteiro(menor)} a ${inteiro(maior)}`}
    >
      <path className="sparkline-linha" d={caminho} fill="none" stroke={cor} />
      <circle
        className="sparkline-ponto"
        cx={x(janela.length - 1)}
        cy={y(ultimo)}
        r={2}
        fill={cor}
      />
    </svg>
  );
}
