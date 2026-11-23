// Ritmo do dia: as ativações acumuladas de hoje contra o mesmo dia da semana nas últimas
// seis semanas (mediana e a faixa do 1º ao 3º quartil).

import {
  Area,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { RespostaOperacao } from '../../../services/insightsService.ts';
import { Cartao } from '../../ui/Cartao.tsx';
import { COR, EIXO, int } from '../formato.ts';
import { Dica, Grafico, Legenda, Rodape, numero } from '../partes.tsx';
import { ultimoPontoComValor } from './dados.ts';

type PontoDoRitmo = RespostaOperacao['ritmo'][number] & {
  faixa: [number | null, number | null];
};

function DicaDoRitmo({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
  label?: unknown;
}) {
  const ponto = active ? (payload?.[0]?.payload as PontoDoRitmo | undefined) : undefined;
  if (!ponto) return null;
  return (
    <Dica
      titulo={String(label)}
      linhas={[
        ['Hoje', int(ponto.hoje)],
        ['Típico', int(ponto.tipico)],
        ['Faixa normal', `${int(ponto.p25)}–${int(ponto.p75)}`],
      ]}
    />
  );
}

export function RitmoDoDia({ dados }: { dados: RespostaOperacao }) {
  const pontos: PontoDoRitmo[] = dados.ritmo.map((hora) => ({
    ...hora,
    faixa: [hora.p25, hora.p75],
  }));
  // O rótulo do número vai só na última hora que já tem valor de hoje.
  const ultimaHoraPreenchida = ultimoPontoComValor(pontos, (ponto) => ponto.hoje !== null);

  return (
    <Cartao
      titulo="Ritmo do dia — ativações acumuladas"
      sub="Hoje contra o mesmo dia da semana nas últimas 6 semanas (mediana e 1º–3º quartil)."
    >
      <Legenda
        itens={[
          { rotulo: 'Hoje', cor: COR.vinho, forma: 'linha' },
          { rotulo: 'Típico (mediana)', cor: COR.cinza, forma: 'tracejada' },
          { rotulo: 'Faixa normal (25%–75%)', cor: COR.faixaNeutra },
        ]}
      />
      <Grafico altura={270}>
        <ComposedChart data={pontos} margin={{ top: 8, right: 40, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={COR.grade} />
          <XAxis
            dataKey="hora"
            tick={EIXO}
            tickLine={false}
            axisLine={{ stroke: COR.linha }}
            interval={3}
          />
          <YAxis tick={EIXO} tickLine={false} axisLine={false} width={36} />
          <Tooltip content={DicaDoRitmo} />
          <Area dataKey="faixa" stroke="none" fill={COR.faixaNeutra} isAnimationActive={false} />
          <Line
            dataKey="tipico"
            stroke={COR.cinza}
            strokeDasharray="5 4"
            strokeWidth={1.6}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="hoje"
            stroke={COR.vinho}
            strokeWidth={2.4}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="hoje"
              content={(parte) =>
                numero(parte.index) === ultimaHoraPreenchida ? (
                  <text
                    x={numero(parte.x) + 6}
                    y={numero(parte.y) + 4}
                    fontSize={12}
                    fontWeight={700}
                    fill={COR.tinta}
                  >
                    {String(parte.value)}
                  </text>
                ) : null
              }
            />
          </Line>
        </ComposedChart>
      </Grafico>
      <Rodape>Conta pela hora em que o material foi lançado no protocolo.</Rodape>
    </Cartao>
  );
}
