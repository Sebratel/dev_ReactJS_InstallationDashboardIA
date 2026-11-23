// Ativações por dia: o que aconteceu e o que vem — com a chuva no gráfico de baixo,
// sincronizado pelo mesmo eixo de datas.

import { useMemo } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { RespostaPrevisoes } from '../../../services/insightsService.ts';
import { Cartao } from '../../ui/Cartao.tsx';
import { COR, EIXO, dataCurta, dec, diaCurto, int, pct } from '../formato.ts';
import { Dica, Grafico, Legenda, Rodape } from '../partes.tsx';
import { corDaChuva, pontosDiarios, type PontoDiario } from './dados.ts';

function DicaDiaria({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  const ponto = active ? (payload?.[0]?.payload as PontoDiario | undefined) : undefined;
  if (!ponto) return null;

  const chanceDeChuva =
    ponto.prob !== null && ponto.prob !== undefined ? ` (${ponto.prob}% de chance)` : '';

  return (
    <Dica
      titulo={diaCurto(ponto.d) + (ponto.feriado ? ' · feriado' : '')}
      linhas={[
        ponto.real !== undefined ? ['Real', int(ponto.real)] : null,
        ponto.vespera !== undefined ? ['Previsto na véspera', int(ponto.vespera)] : null,
        ponto.previsto !== undefined ? ['Previsão', int(ponto.previsto)] : null,
        ponto.faixa ? ['Intervalo de 80%', `${int(ponto.faixa[0])}–${int(ponto.faixa[1])}`] : null,
        ponto.estimativaHoje !== undefined
          ? ['Fechamento estimado de hoje', int(ponto.estimativaHoje)]
          : null,
        ponto.chuva !== null ? ['Chuva', `${dec(ponto.chuva, 1)} mm${chanceDeChuva}`] : null,
        ponto.ajusteChuva ? ['Efeito da chuva aplicado', `−${pct(1 - ponto.ajusteChuva)}`] : null,
        ponto.reservados ? ['Já reservado na agenda', `${int(ponto.reservados)} slots`] : null,
      ]}
    />
  );
}

/** O gráfico de cima: real, previsto na véspera, previsão e o intervalo de 80%. */
function GraficoDasAtivacoes({ pontos, hoje }: { pontos: PontoDiario[]; hoje: string }) {
  return (
    <Grafico altura={300}>
      <ComposedChart
        data={pontos}
        syncId="diaria"
        margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
      >
        <CartesianGrid vertical={false} stroke={COR.grade} />
        <XAxis
          dataKey="d"
          tick={EIXO}
          tickLine={false}
          axisLine={{ stroke: COR.linha }}
          tickFormatter={dataCurta}
          minTickGap={18}
        />
        <YAxis tick={EIXO} tickLine={false} axisLine={false} width={36} />
        <ReferenceLine
          x={hoje}
          stroke={COR.vinho}
          strokeDasharray="2 3"
          label={{ value: 'hoje', position: 'insideTopRight', fontSize: 10.5, fill: COR.vinho }}
        />
        <Tooltip content={DicaDiaria} />
        <Area
          dataKey="faixa"
          stroke="none"
          fill={COR.faixa}
          isAnimationActive={false}
          connectNulls={false}
        />
        <Bar
          dataKey="real"
          fill={COR.serie}
          maxBarSize={14}
          radius={[2, 2, 0, 0]}
          isAnimationActive={false}
        />
        <Line
          dataKey="vespera"
          stroke={COR.ouro}
          strokeDasharray="4 3"
          strokeWidth={1.4}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="previsto"
          stroke={COR.ouro}
          strokeWidth={2.2}
          dot={{ r: 2.5, fill: COR.ouro }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </Grafico>
  );
}

/** O gráfico de baixo: a chuva em mm, na cor da intensidade. */
function GraficoDaChuva({ pontos }: { pontos: PontoDiario[] }) {
  return (
    <Grafico altura={90}>
      <BarChart data={pontos} syncId="diaria" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <XAxis dataKey="d" hide />
        <YAxis
          tick={EIXO}
          tickLine={false}
          axisLine={false}
          width={36}
          label={{
            value: 'mm',
            angle: -90,
            position: 'insideLeft',
            fontSize: 10,
            fill: COR.cinza,
          }}
        />
        <ReferenceLine y={10} stroke={COR.neutro} strokeDasharray="3 3" />
        <Tooltip content={DicaDiaria} />
        <Bar dataKey="chuva" maxBarSize={14} radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {pontos.map((ponto) => (
            <Cell key={ponto.d} fill={corDaChuva(ponto.chuva)} />
          ))}
        </Bar>
      </BarChart>
    </Grafico>
  );
}

/** O rodapé que explica o modelo: nível, fator de cada dia da semana e feriado. */
function ComoOModeloFunciona({ modelo }: { modelo: RespostaPrevisoes['modelo'] }) {
  const fatores = modelo.fatoresDiaDaSemana;
  return (
    <Rodape>
      Modelo: nível recente {dec(modelo.nivel, 0)}/dia útil × fator do dia da semana (seg{' '}
      {pct(fatores['1'])}, ter {pct(fatores['2'])}, qua {pct(fatores['3'])}, qui {pct(fatores['4'])}
      , sex {pct(fatores['5'])}, sáb {pct(fatores['6'])}). Feriado rende {pct(modelo.feriado.fator)}{' '}
      de um dia normal ({modelo.feriado.dias} feriados medidos). Domingos fora.
      {modelo.climaDisponivel ? '' : ' Chuva indisponível agora: a previsão segue sem o ajuste.'}
    </Rodape>
  );
}

export function SerieDiaria({ dados }: { dados: RespostaPrevisoes }) {
  const hoje = dados.agora.data;
  const pontos = useMemo(() => pontosDiarios(dados, hoje), [dados, hoje]);

  return (
    <Cartao
      titulo="Ativações por dia — o que aconteceu e o que vem"
      sub="Últimos 60 dias de trabalho com o previsto na véspera; próximos 21 com o intervalo de 80%. Embaixo, a chuva (mm)."
    >
      <Legenda
        itens={[
          { rotulo: 'Real', cor: COR.serie },
          { rotulo: 'Previsto na véspera', cor: COR.ouro, forma: 'tracejada' },
          { rotulo: 'Previsão', cor: COR.ouro, forma: 'linha' },
          { rotulo: 'Intervalo de 80%', cor: COR.faixa },
        ]}
      />
      <GraficoDasAtivacoes pontos={pontos} hoje={hoje} />
      <GraficoDaChuva pontos={pontos} />
      <ComoOModeloFunciona modelo={dados.modelo} />
    </Cartao>
  );
}
