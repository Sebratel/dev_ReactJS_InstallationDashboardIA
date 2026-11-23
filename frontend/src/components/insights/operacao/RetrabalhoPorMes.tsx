// Retrabalho por mês de ativação: a fração das ativações do mês com chamado por problema
// em até 30 dias. O primeiro mês da janela é parcial.

import { Bar, BarChart, CartesianGrid, LabelList, Tooltip, XAxis, YAxis } from 'recharts';
import type { RespostaOperacao } from '../../../services/insightsService.ts';
import { Cartao } from '../../ui/Cartao.tsx';
import { COR, EIXO, int, mesNome, pct } from '../formato.ts';
import { Dica, Grafico, Rodape } from '../partes.tsx';

type MesComRotulo = RespostaOperacao['retrabalhoPorMes'][number] & { rotulo: string };

const numeroOuNulo = (valor: unknown): number | null => (typeof valor === 'number' ? valor : null);

function DicaDoMes({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  const mes = active ? (payload?.[0]?.payload as MesComRotulo | undefined) : undefined;
  if (!mes) return null;
  return (
    <Dica
      titulo={mes.rotulo}
      linhas={[
        ['Ativações', int(mes.n)],
        ['Voltaram por problema', int(mes.retornos)],
        ['Taxa', pct(mes.taxa, 1)],
      ]}
    />
  );
}

export function RetrabalhoPorMes({ dados }: { dados: RespostaOperacao }) {
  const meses: MesComRotulo[] = dados.retrabalhoPorMes.map((mes) => ({
    ...mes,
    rotulo: mesNome(mes.mes),
  }));

  return (
    <Cartao
      titulo="Retrabalho por mês de ativação"
      sub="Fração das ativações do mês com chamado por problema em até 30 dias."
    >
      <Grafico altura={230}>
        <BarChart data={meses} margin={{ top: 18, right: 10, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={COR.grade} />
          <XAxis dataKey="rotulo" tick={EIXO} tickLine={false} axisLine={{ stroke: COR.linha }} />
          <YAxis
            tick={EIXO}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(valor: number) => pct(valor)}
            domain={[0, 'auto']}
          />
          <Tooltip cursor={{ fill: COR.cursor }} content={DicaDoMes} />
          <Bar
            dataKey="taxa"
            fill={COR.serie}
            radius={[3, 3, 0, 0]}
            maxBarSize={44}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="taxa"
              position="top"
              formatter={(valor: unknown) => pct(numeroOuNulo(valor), 1)}
              fontSize={11}
              fill={COR.tinta}
            />
          </Bar>
        </BarChart>
      </Grafico>
      <Rodape>O primeiro mês da janela é parcial.</Rodape>
    </Cartao>
  );
}
