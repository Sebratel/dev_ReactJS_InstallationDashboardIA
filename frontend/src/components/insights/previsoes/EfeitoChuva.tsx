// Quanto a chuva derruba as ativações: o erro do modelo em cada faixa de chuva contra os
// dias secos. Só vira ajuste na previsão o que fica claramente abaixo de zero.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ErrorBar,
  LabelList,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { RespostaPrevisoes } from '../../../services/insightsService.ts';
import { Cartao } from '../../ui/Cartao.tsx';
import { COR, EIXO, dec, diaCurto, int, pct, sinal } from '../formato.ts';
import { Dica, Grafico, Legenda, Rodape } from '../partes.tsx';
import { efeitosDaChuva, type EfeitoDaChuva } from './dados.ts';

const numeroOuNulo = (valor: unknown): number | null => (typeof valor === 'number' ? valor : null);

function DicaDaChuva({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  const faixa = active ? (payload?.[0]?.payload as EfeitoDaChuva | undefined) : undefined;
  if (!faixa) return null;
  return (
    <Dica
      titulo={faixa.rotulo}
      linhas={[
        ['Dias medidos', int(faixa.dias)],
        ['Efeito (mediana)', sinal(faixa.efeito, 1)],
        ['Intervalo de 90%', `${sinal(faixa.ic[0], 1)} a ${sinal(faixa.ic[1], 1)}`],
        ['Entra na previsão', faixa.aplicado ? 'sim' : 'não'],
      ]}
    />
  );
}

/** "ter (18 mm → −12%)" para cada dia chuvoso que vem pela frente. */
function ajusteDosProximosDias(dias: readonly RespostaPrevisoes['previsao'][number][]): string {
  if (dias.length === 0) {
    return 'Nenhum dos próximos dias tem chuva prevista na faixa que derruba a produção.';
  }
  const partes = dias.map(
    (dia) => `${diaCurto(dia.d)} (${dec(dia.chuvaMm, 0)} mm → −${pct(1 - (dia.ajusteChuva ?? 1))})`,
  );
  return `Ajuste nos próximos dias: ${partes.join(' · ')}.`;
}

export function EfeitoChuva({ dados }: { dados: RespostaPrevisoes }) {
  const faixas = efeitosDaChuva(dados.chuva);
  const proximosChuvosos = dados.previsao
    .filter((dia) => dia.d > dados.agora.data && dia.ajusteChuva)
    .slice(0, 4);

  return (
    <Cartao
      titulo="Quanto a chuva derruba as ativações"
      sub="Erro do modelo em cada faixa de chuva contra os dias secos. Barra = mediana; traço = intervalo de 90%."
    >
      <Grafico altura={270}>
        <BarChart data={faixas} margin={{ top: 22, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={COR.grade} />
          <XAxis
            dataKey="rotulo"
            tick={EIXO}
            tickLine={false}
            axisLine={{ stroke: COR.linha }}
            interval={0}
          />
          <YAxis
            tick={EIXO}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(valor: number) => sinal(valor)}
            domain={[-0.9, 0.1]}
          />
          <ReferenceLine y={0} stroke={COR.cinza} />
          <Tooltip cursor={{ fill: COR.cursor }} content={DicaDaChuva} />
          <Bar dataKey="valor" maxBarSize={56} isAnimationActive={false}>
            {faixas.map((faixa) => (
              <Cell key={faixa.id} fill={faixa.aplicado ? COR.serie : COR.neutro} />
            ))}
            <ErrorBar dataKey="erro" width={8} strokeWidth={1.4} stroke={COR.tinta} />
            <LabelList
              dataKey="valor"
              position="bottom"
              offset={8}
              formatter={(valor: unknown) => sinal(numeroOuNulo(valor))}
              fontSize={11.5}
              fontWeight={700}
              fill={COR.tinta}
            />
          </Bar>
        </BarChart>
      </Grafico>
      <Legenda
        itens={[
          { rotulo: 'Efeito comprovado — entra na previsão', cor: COR.serie },
          { rotulo: 'Pequeno ou incerto — fica de fora', cor: COR.neutro },
        ]}
      />
      <Rodape>
        {ajusteDosProximosDias(proximosChuvosos)} Medido desde mar/2025: só vira ajuste o que fica
        claramente abaixo de zero.
      </Rodape>
    </Cartao>
  );
}
