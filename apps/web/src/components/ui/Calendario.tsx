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
import { inteiro } from '../../utils/formato.ts';

const DIAS_DA_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
/** Nunca some a zero: a célula do dia 1 do mês some visualmente contra o fundo. */
const OPACIDADE_MINIMA = 0.12;

interface CelulaDoDia {
  dia: number;
  valor: number;
  rotulo: string;
}

interface Semanas {
  celulas: (CelulaDoDia | null)[];
  maior: number;
}

function constroiSemanas(d: DadosDeMatriz): Semanas | null {
  if (d.chavesDeColuna.length !== 1 || d.tiposDeColuna[0] !== 'date') return null;
  if (d.colunas.length === 0) return null;
  if (d.linhas.length !== d.linhasTotais) return null;

  const df = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  const porDia = new Map<number, number>();
  let anoMes: { ano: number; mes: number } | null = null;

  for (let j = 0; j < d.colunas.length; j++) {
    const bruto = d.colunas[j]?.[0];
    if (bruto == null) continue;
    const data = new Date(bruto as string);
    if (Number.isNaN(data.getTime())) continue;
    const ano = data.getUTCFullYear();
    const mes = data.getUTCMonth();
    if (anoMes && (anoMes.ano !== ano || anoMes.mes !== mes)) return null;
    anoMes = { ano, mes };

    let total = 0;
    for (let i = 0; i < d.linhas.length; i++) {
      const v = d.celulas[i]?.[j]?.[0];
      if (typeof v === 'number') total += v;
    }
    porDia.set(data.getUTCDate(), total);
  }

  if (!anoMes) return null;

  const primeiroDiaDaSemana = new Date(Date.UTC(anoMes.ano, anoMes.mes, 1)).getUTCDay();
  const ultimoDia = new Date(Date.UTC(anoMes.ano, anoMes.mes + 1, 0)).getUTCDate();

  const celulas: (CelulaDoDia | null)[] = new Array(primeiroDiaDaSemana).fill(null);
  let maior = 0;
  for (let dia = 1; dia <= ultimoDia; dia++) {
    const valor = porDia.get(dia) ?? 0;
    maior = Math.max(maior, valor);
    celulas.push({ dia, valor, rotulo: df.format(new Date(Date.UTC(anoMes.ano, anoMes.mes, dia))) });
  }
  while (celulas.length % 7 !== 0) celulas.push(null);

  return { celulas, maior };
}

export function Calendario({ dados }: { dados: DadosDeMatriz }) {
  const semanas = useMemo(() => constroiSemanas(dados), [dados]);

  if (!semanas || semanas.celulas.every((c) => c === null)) return null;

  return (
    <div className="kpi-calendario" role="img" aria-label="Distribuição diária no mês, um quadrado por dia">
      <div className="kpi-calendario-cabecalho">
        {DIAS_DA_SEMANA.map((letra, i) => (
          <span key={i}>{letra}</span>
        ))}
      </div>
      <div className="kpi-calendario-grade">
        {semanas.celulas.map((c, i) =>
          c === null ? (
            <span key={i} className="kpi-calendario-dia vazio" />
          ) : (
            <span
              key={i}
              className="kpi-calendario-dia"
              style={{ opacity: semanas.maior > 0 ? OPACIDADE_MINIMA + (1 - OPACIDADE_MINIMA) * (c.valor / semanas.maior) : OPACIDADE_MINIMA }}
              title={`${c.rotulo}: ${inteiro(c.valor)}`}
            />
          ),
        )}
      </div>
    </div>
  );
}
