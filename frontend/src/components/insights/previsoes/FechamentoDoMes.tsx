// Fechamento do mês: o acumulado realizado e, daí em diante, a projeção com o intervalo
// de 80% — 4.000 simulações com sequências reais de erro do histórico.

import {
  Area,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { RespostaPrevisoes } from '../../../services/insightsService.ts';
import { Cartao } from '../../ui/Cartao.tsx';
import { COR, EIXO, dataCurta, diaCurto, int, pct } from '../formato.ts';
import { Dica, Grafico, Legenda, Rodape, numero } from '../partes.tsx';
import { curvaDoMes, type PontoDaCurvaDoMes } from './dados.ts';

const numeroOuNulo = (valor: unknown): number | null => (typeof valor === 'number' ? valor : null);

function DicaDoMes({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  const ponto = active ? (payload?.[0]?.payload as PontoDaCurvaDoMes | undefined) : undefined;
  if (!ponto) return null;
  return (
    <Dica
      titulo={diaCurto(ponto.d)}
      linhas={[
        ponto.realizado !== undefined ? ['Realizado', int(ponto.realizado)] : null,
        ponto.p50 !== undefined ? ['Projeção', int(ponto.p50)] : null,
        ponto.faixa ? ['Intervalo de 80%', `${int(ponto.faixa[0])}–${int(ponto.faixa[1])}`] : null,
      ]}
    />
  );
}

/** A linha de referência do mês passado, quando houve mês passado. */
function LinhaDoMesAnterior({ total }: { total: number }) {
  return (
    <ReferenceLine
      y={total}
      stroke={COR.cinza}
      strokeDasharray="4 4"
      label={{
        value: `mês passado ${int(total)}`,
        position: 'insideTopLeft',
        fontSize: 10.5,
        fill: COR.cinza,
      }}
    />
  );
}

/** O fecho do rodapé: a meta, ou o aviso de que não há meta gravada. */
function textoDaMeta(mes: RespostaPrevisoes['mes']): string {
  if (!mes.meta) return ' · sem meta gravada na aba Metas';
  return ` · meta ${int(mes.meta)}: ${pct(mes.chanceMeta)} de chance`;
}

export function FechamentoDoMes({ dados }: { dados: RespostaPrevisoes }) {
  const mes = dados.mes;
  const curva = curvaDoMes(mes);
  const ultimoPonto = curva.length - 1;

  return (
    <Cartao
      titulo="Fechamento do mês — acumulado"
      sub="Realizado e, daí em diante, 4.000 simulações com sequências reais de erro do histórico."
    >
      <Legenda
        itens={[
          { rotulo: 'Realizado', cor: COR.vinho, forma: 'linha' },
          { rotulo: 'Projeção (mediana)', cor: COR.ouro, forma: 'tracejada' },
          { rotulo: 'Intervalo de 80%', cor: COR.faixa },
        ]}
      />
      <Grafico altura={290}>
        <ComposedChart data={curva} margin={{ top: 10, right: 50, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={COR.grade} />
          <XAxis
            dataKey="d"
            tick={EIXO}
            tickLine={false}
            axisLine={{ stroke: COR.linha }}
            tickFormatter={dataCurta}
            minTickGap={16}
          />
          <YAxis
            tick={EIXO}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(valor: number) => int(valor)}
          />
          {mes.totalMesAnterior ? <LinhaDoMesAnterior total={mes.totalMesAnterior} /> : null}
          {mes.meta ? (
            <ReferenceLine
              y={mes.meta}
              stroke={COR.vinho}
              label={{
                value: `meta ${int(mes.meta)}`,
                position: 'insideTopLeft',
                fontSize: 10.5,
                fill: COR.vinho,
              }}
            />
          ) : null}
          <Tooltip content={DicaDoMes} />
          <Area dataKey="faixa" stroke="none" fill={COR.faixa} isAnimationActive={false} />
          <Line
            dataKey="p50"
            stroke={COR.ouro}
            strokeDasharray="5 4"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="p50"
              content={(parte) =>
                numero(parte.index) === ultimoPonto ? (
                  <text
                    x={numero(parte.x) + 6}
                    y={numero(parte.y) + 4}
                    fontSize={12}
                    fontWeight={700}
                    fill={COR.tinta}
                  >
                    {int(numeroOuNulo(parte.value))}
                  </text>
                ) : null
              }
            />
          </Line>
          <Line
            dataKey="realizado"
            stroke={COR.vinho}
            strokeWidth={2.4}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </Grafico>
      <Rodape>
        Mediana {int(mes.p50)} · 80% entre {int(mes.p10)} e {int(mes.p90)} · mês passado{' '}
        {int(mes.totalMesAnterior)} (no mesmo ponto: {int(mes.mesmoPontoMesAnterior)}) ·{' '}
        {mes.diasDeTrabalhoRestantes} dias de trabalho restantes{textoDaMeta(mes)}. As simulações
        reaproveitam semanas boas e ruins seguidas, não sorteios independentes.
      </Rodape>
    </Cartao>
  );
}
