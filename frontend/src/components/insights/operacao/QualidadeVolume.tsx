// Qualidade × volume por técnico: as ativações de 150 a 30 dias atrás contra quanto
// delas voltou por problema em 30 dias. O quadrante de baixo à direita é o que a
// premiação deveria procurar.

import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type { RespostaOperacao } from '../../../services/insightsService.ts';
import { Cartao } from '../../ui/Cartao.tsx';
import { COR, EIXO, int, pct } from '../formato.ts';
import { Dica, Grafico, Legenda, Rodape } from '../partes.tsx';
import { corDoRetrabalho, volumeMediano } from './dados.ts';

type TecnicoNaQualidade = RespostaOperacao['qualidade'][number];

function DicaDoTecnico({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  const tecnico = active ? (payload?.[0]?.payload as TecnicoNaQualidade | undefined) : undefined;
  if (!tecnico) return null;
  return (
    <Dica
      titulo={tecnico.nome}
      linhas={[
        ['Ativações', int(tecnico.instalacoes)],
        ['Voltaram por problema', `${int(tecnico.retornos)} (${pct(tecnico.taxa, 1)})`],
        tecnico.execucaoMin ? ['Tempo em execução', `${int(tecnico.execucaoMin)} min`] : null,
      ]}
    />
  );
}

export function QualidadeVolume({ dados }: { dados: RespostaOperacao }) {
  const tecnicos = dados.qualidade;
  const taxaDaEquipe = dados.kpis.retrabalho30d ?? 0;
  const volumeDoMeio = volumeMediano(tecnicos);

  return (
    <Cartao
      titulo="Qualidade × volume por técnico"
      sub="Ativações de 150 a 30 dias atrás × quanto delas voltou por problema em 30 dias."
    >
      <Grafico altura={330}>
        <ScatterChart margin={{ top: 10, right: 24, bottom: 16, left: 0 }}>
          <CartesianGrid stroke={COR.grade} />
          <XAxis
            type="number"
            dataKey="instalacoes"
            name="Ativações"
            tick={EIXO}
            tickLine={false}
            axisLine={{ stroke: COR.linha }}
            label={{
              value: 'ativações na janela',
              position: 'insideBottom',
              offset: -8,
              fontSize: 11,
              fill: COR.cinza,
            }}
          />
          <YAxis
            type="number"
            dataKey="taxa"
            name="Retrabalho"
            tick={EIXO}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(valor: number) => pct(valor)}
          />
          <ZAxis range={[70, 70]} />
          <ReferenceLine y={taxaDaEquipe} stroke={COR.cinza} strokeDasharray="4 4" />
          <ReferenceLine x={volumeDoMeio} stroke={COR.cinza} strokeDasharray="4 4" />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} content={DicaDoTecnico} />
          <Scatter data={tecnicos} isAnimationActive={false}>
            {tecnicos.map((tecnico) => (
              <Cell
                key={tecnico.tec_id}
                fill={corDoRetrabalho(tecnico.taxa, taxaDaEquipe)}
                stroke="var(--pbi-superficie)"
                strokeWidth={1.5}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </Grafico>
      <Legenda
        itens={[
          { rotulo: 'Retrabalho 25% acima da equipe', cor: COR.critico, forma: 'bola' },
          { rotulo: 'Na média', cor: COR.serie, forma: 'bola' },
          { rotulo: '20% abaixo da equipe', cor: COR.bom, forma: 'bola' },
        ]}
      />
      <Rodape>
        Linhas: retrabalho da equipe ({pct(taxaDaEquipe, 1)}) e volume mediano ({int(volumeDoMeio)}
        ). Embaixo à direita é o quadrante que a premiação deveria procurar. Só técnicos com 15
        ativações ou mais na janela.
      </Rodape>
    </Cartao>
  );
}
