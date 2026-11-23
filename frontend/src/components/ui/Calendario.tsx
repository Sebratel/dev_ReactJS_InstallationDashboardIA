// O calendário de um KPI — Fase L6, docs/PLANO-LAYOUT-V1.md §8.
//
// Zero requisição nova: `calendario` (layout.yaml, `kpis[].calendario`) aponta para
// uma MATRIZ que já está na mesma página — o mesmo `visuais[]` que a página inteira
// recebeu. Este componente só lê as células que já chegaram (somando as linhas por
// coluna de data); nunca busca nada sozinho.
//
// **Por que não é a matriz que estoura em coluna.** A DIÁRIO INSTALAÇÃO tem uma matriz
// técnico × dia com até 31 colunas de data — a mesma informação, lida em grade de
// semana (5-6 linhas de 7 dias), cabe em uma fração da altura sem rolar para o lado.
// A matriz original continua na tela, intacta: isto é um resumo adicional, não uma
// substituição — o "número igual" da Fase L6 vale para o KPI, que nunca muda.
//
// **Só desenha com a matriz INTEIRA carregada.** `Matriz.tsx`/`useJanela.ts` paginam
// linhas de 200 em 200; somar uma página parcial (`linhas.length < linhasTotais`)
// devolveria um total por dia menor que o real — silencioso e errado, pior que não
// mostrar nada. Mesmo raciocínio do `tudoCarregado` que `Matriz.tsx` já usa para
// decidir se pode transpor.
//
// **Um mês só.** Duas colunas do mesmo dia-do-mês em meses diferentes se confundiriam
// na mesma célula — por isso a extração recusa a matriz se as datas não vierem todas
// do mesmo ano/mês (guarda explícita, não heurística de "provavelmente é um mês").
//
// Cor por opacidade de UM token (`--pbi-gold`), não por hex interpolado: é a mesma
// leitura "claro → escuro, um só tom" que a paleta reserva para MAGNITUDE.
//
// Sem número dentro da célula, mesma escolha da Sparkline: o quadrado mostra a FORMA
// (quais dias pesam mais), o valor exato mora no `title` — texto sobre um preenchimento
// que varia de opacidade não tem token de contraste garantido em todo o intervalo.

import { useMemo } from 'react';
import type { DadosDeMatriz } from '../../services/dashboardService.ts';
import { cn } from '../../utils/cn.ts';
import { inteiro } from '../../utils/formato.ts';

const DIAS_DA_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
/** Nunca some a zero: a célula do dia 1 do mês some visualmente contra o fundo. */
const OPACIDADE_MINIMA = 0.12;

/** 7 colunas fixas (dias da semana); as linhas nascem do conteúdo do mês. */
const GRADE = 'grid grid-cols-[repeat(7,1fr)] gap-[2px]';
/** Magnitude por OPACIDADE de um só token (`--pbi-gold`), não hex interpolado. */
const DIA = 'aspect-square rounded-[2px]';

interface CelulaDoDia {
  dia: number;
  valor: number;
  rotulo: string;
}

interface Semanas {
  celulas: (CelulaDoDia | null)[];
  maior: number;
}

const DIAS_NA_SEMANA = 7;

/** O formato do rótulo de cada dia ("05 nov"). */
const formatoDoDia = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
});

/** A soma de uma coluna da matriz — o total daquele dia, somando todas as linhas. */
function somaDaColuna(d: DadosDeMatriz, coluna: number): number {
  let total = 0;
  for (let linha = 0; linha < d.linhas.length; linha++) {
    const valor = d.celulas[linha]?.[coluna]?.[0];
    if (typeof valor === 'number') total += valor;
  }
  return total;
}

/**
 * O total de cada dia do mês, lido das colunas de data.
 *
 * `null` quando a matriz cobre MAIS DE UM MÊS: a grade é de um mês só, e juntar dois
 * daria um calendário em que o dia 3 soma dois meses diferentes.
 */
function totaisPorDia(
  d: DadosDeMatriz,
): { porDia: Map<number, number>; ano: number; mes: number } | null {
  const porDia = new Map<number, number>();
  let anoMes: { ano: number; mes: number } | null = null;

  for (let coluna = 0; coluna < d.colunas.length; coluna++) {
    const bruto = d.colunas[coluna]?.[0];
    if (bruto == null) continue;
    const data = new Date(bruto as string);
    if (Number.isNaN(data.getTime())) continue;

    const ano = data.getUTCFullYear();
    const mes = data.getUTCMonth();
    if (anoMes && (anoMes.ano !== ano || anoMes.mes !== mes)) return null;
    anoMes = { ano, mes };

    porDia.set(data.getUTCDate(), somaDaColuna(d, coluna));
  }

  return anoMes ? { porDia, ...anoMes } : null;
}

/** A grade do mês: os vazios antes do dia 1, um por dia, e os vazios até fechar a semana. */
function celulasDoMes(ano: number, mes: number, porDia: ReadonlyMap<number, number>): Semanas {
  const primeiroDiaDaSemana = new Date(Date.UTC(ano, mes, 1)).getUTCDay();
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();

  const celulas: (CelulaDoDia | null)[] = new Array(primeiroDiaDaSemana).fill(null);
  let maior = 0;
  for (let dia = 1; dia <= ultimoDia; dia++) {
    const valor = porDia.get(dia) ?? 0;
    maior = Math.max(maior, valor);
    celulas.push({ dia, valor, rotulo: formatoDoDia.format(new Date(Date.UTC(ano, mes, dia))) });
  }
  while (celulas.length % DIAS_NA_SEMANA !== 0) celulas.push(null);

  return { celulas, maior };
}

/**
 * A matriz vira calendário — ou não vira.
 *
 * Recusa sozinha o que não dá grade de mês: coluna que não é data, matriz sem coluna,
 * matriz ainda incompleta (o detalhe chega paginado) e mais de um mês.
 */
function constroiSemanas(d: DadosDeMatriz): Semanas | null {
  if (d.chavesDeColuna.length !== 1 || d.tiposDeColuna[0] !== 'date') return null;
  if (d.colunas.length === 0) return null;
  if (d.linhas.length !== d.linhasTotais) return null;

  const totais = totaisPorDia(d);
  if (!totais) return null;
  return celulasDoMes(totais.ano, totais.mes, totais.porDia);
}

export function Calendario({ dados }: { dados: DadosDeMatriz }) {
  const semanas = useMemo(() => constroiSemanas(dados), [dados]);

  if (!semanas || semanas.celulas.every((c) => c === null)) return null;

  return (
    <div
      className="mt-[6px] w-full"
      role="img"
      aria-label="Distribuição diária no mês, um quadrado por dia"
    >
      <div className={cn(GRADE, 'mb-[2px] text-center text-[0.55rem] font-bold text-pbi-muted')}>
        {DIAS_DA_SEMANA.map((letra, i) => (
          <span key={i}>{letra}</span>
        ))}
      </div>
      <div className={GRADE}>
        {semanas.celulas.map((c, i) =>
          c === null ? (
            <span key={i} className={DIA} />
          ) : (
            <span
              key={i}
              className={cn(DIA, 'bg-pbi-gold')}
              style={{
                opacity:
                  semanas.maior > 0
                    ? OPACIDADE_MINIMA + (1 - OPACIDADE_MINIMA) * (c.valor / semanas.maior)
                    : OPACIDADE_MINIMA,
              }}
              title={`${c.rotulo}: ${inteiro(c.valor)}`}
            />
          ),
        )}
      </div>
    </div>
  );
}
