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
    const grafico = montaGrafico(dados);
    // A soma de todas as séries por ponto: para um gráfico de série única (o caso de
    // hoje) é o mesmo valor da série; para um empilhado seria o total da pilha — o
    // mesmo raciocínio de "a fatia inteira" que a Rosca já usa.
    const totais = grafico.categorias.map((_, indice) =>
      grafico.series.reduce((soma, serie) => soma + (serie.valores[indice] ?? 0), 0),
    );
    return totais.slice(-N_PONTOS);
  }, [dados]);

  if (janela.length < 2) return null;

  const maior = Math.max(...janela);
  const menor = Math.min(...janela);
  const alcance = maior - menor || 1;
  const posX = (indice: number) => (indice / (janela.length - 1)) * LARGURA;
  const posY = (valor: number) =>
    ALTURA - FOLGA - ((valor - menor) / alcance) * (ALTURA - FOLGA * 2);

  const caminho = janela
    .map(
      (valor, indice) =>
        `${indice === 0 ? 'M' : 'L'}${posX(indice).toFixed(1)} ${posY(valor).toFixed(1)}`,
    )
    .join(' ');
  const ultimo = janela[janela.length - 1]!;
  const cor = corNoTema(corDaSerie('', 0), isDark);

  return (
    <svg
      className="mt-[6px] block h-[28px] w-full overflow-visible"
      viewBox={`0 0 ${LARGURA} ${ALTURA}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Tendência dos últimos ${janela.length} pontos: de ${inteiro(menor)} a ${inteiro(maior)}`}
    >
      {/* `non-scaling-stroke`: o viewBox é esticado por CSS (sem medida em pixel), e sem
          isso o traço engrossaria ou afinaria com a largura real do card. */}
      <path
        d={caminho}
        fill="none"
        stroke={cor}
        strokeWidth={1.6}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        className="sparkline-ponto"
        cx={posX(janela.length - 1)}
        cy={posY(ultimo)}
        r={2}
        fill={cor}
      />
    </svg>
  );
}
