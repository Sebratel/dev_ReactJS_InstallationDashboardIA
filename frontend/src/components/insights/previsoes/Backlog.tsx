// Backlog de ativação: o que dos pedidos abertos agora vira instalação.
//
// São dois gráficos: os pedidos por idade (quantos devem instalar e quantos devem cair)
// e a curva da chance de instalar conforme o pedido envelhece.

import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { RespostaPrevisoes } from '../../../services/insightsService.ts';
import { Cartao } from '../../ui/Cartao.tsx';
import { COR, EIXO, dec, int, pct } from '../formato.ts';
import { Dica, Grafico, Legenda, Rodape } from '../partes.tsx';

type Backlog = RespostaPrevisoes['backlog'];
type FaixaDeIdade = Backlog['porIdade'][number];
type PontoDaCurva = Backlog['curva'][number];

const numeroOuNulo = (valor: unknown): number | null => (typeof valor === 'number' ? valor : null);

function DicaDaIdade({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  const faixa = active ? (payload?.[0]?.payload as FaixaDeIdade | undefined) : undefined;
  if (!faixa) return null;
  return (
    <Dica
      titulo={`Abertos há ${faixa.faixa}`}
      linhas={[
        ['Pedidos', int(faixa.abertos)],
        ['Devem instalar', int(faixa.devemInstalar)],
        ['Devem cair', int(faixa.devemCair)],
        ['Agendamentos por pedido', dec(faixa.agendasMedia, 1)],
      ]}
    />
  );
}

function DicaDaCurva({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  const ponto = active ? (payload?.[0]?.payload as PontoDaCurva | undefined) : undefined;
  if (!ponto) return null;
  return (
    <Dica
      titulo={`Aberto há ${ponto.idade} dia(s)`}
      linhas={[
        ['Chance de ainda instalar', pct(ponto.chanceInstalar)],
        ['Pedidos na conta', int(ponto.pedidos)],
      ]}
    />
  );
}

/** Os pedidos abertos por faixa de idade, separados entre instalar e cair. */
function PedidosPorIdade({ porIdade }: { porIdade: Backlog['porIdade'] }) {
  return (
    <Grafico altura={190}>
      <BarChart data={porIdade} margin={{ top: 16, right: 10, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={COR.grade} />
        <XAxis
          dataKey="faixa"
          tick={EIXO}
          tickLine={false}
          axisLine={{ stroke: COR.linha }}
          interval={0}
        />
        <YAxis tick={EIXO} tickLine={false} axisLine={false} width={36} />
        <Tooltip cursor={{ fill: COR.cursor }} content={DicaDaIdade} />
        <Bar dataKey="devemInstalar" stackId="b" fill={COR.serie} isAnimationActive={false} />
        <Bar
          dataKey="devemCair"
          stackId="b"
          fill={COR.neutro}
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="abertos"
            position="top"
            fontSize={11}
            fontWeight={700}
            fill={COR.tinta}
          />
        </Bar>
      </BarChart>
    </Grafico>
  );
}

/** A chance de instalar conforme o pedido envelhece. */
function CurvaDaChance({ curva }: { curva: Backlog['curva'] }) {
  return (
    <Grafico altura={150}>
      <ComposedChart data={curva} margin={{ top: 14, right: 18, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={COR.grade} />
        <XAxis
          dataKey="idade"
          tick={EIXO}
          tickLine={false}
          axisLine={{ stroke: COR.linha }}
          tickFormatter={(valor: number) => `${valor}d`}
        />
        <YAxis
          tick={EIXO}
          tickLine={false}
          axisLine={false}
          width={36}
          tickFormatter={(valor: number) => pct(valor)}
          domain={[0, 1]}
        />
        <Tooltip content={DicaDaCurva} />
        <Line
          dataKey="chanceInstalar"
          stroke={COR.ouro}
          strokeWidth={2.2}
          dot={{ r: 3, fill: COR.ouro }}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="chanceInstalar"
            position="top"
            formatter={(valor: unknown) => pct(numeroOuNulo(valor))}
            fontSize={10.5}
            fill={COR.tinta}
          />
        </Line>
      </ComposedChart>
    </Grafico>
  );
}

/** A fração das instaladas que sai dentro de um prazo (2 ou 7 dias). */
function fracaoEmDias(prazo: Backlog['prazo'], dias: number): string {
  return pct(prazo.find((item) => item.dias === dias)?.fracao);
}

export function Backlog({ dados }: { dados: RespostaPrevisoes }) {
  const backlog = dados.backlog;
  return (
    <Cartao
      titulo="Backlog de ativação: o que vira instalação"
      sub="Pedidos abertos agora, por idade; a chance de cada um vem de 12 meses de pedidos."
    >
      <Legenda
        itens={[
          { rotulo: 'Devem instalar', cor: COR.serie },
          { rotulo: 'Devem cair', cor: COR.neutro },
          { rotulo: 'Chance de instalar pela idade', cor: COR.ouro, forma: 'linha' },
        ]}
      />
      <PedidosPorIdade porIdade={backlog.porIdade} />
      <CurvaDaChance curva={backlog.curva} />
      <Rodape>
        Mediana da venda à instalação: {int(backlog.medianaDiasAteInstalar)} dia(s).{' '}
        {fracaoEmDias(backlog.prazo, 2)} das instaladas saem em até 2 dias;{' '}
        {fracaoEmDias(backlog.prazo, 7)} em até 7.
      </Rodape>
    </Cartao>
  );
}
