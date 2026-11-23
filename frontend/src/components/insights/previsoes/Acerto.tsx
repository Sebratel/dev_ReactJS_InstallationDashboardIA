// Quanto o modelo acerta: o total previsto na segunda-feira, só com o que se sabia até
// ali, contra o realizado da semana — e a tabela de erro por distância da previsão.

import { Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts';
import type { RespostaPrevisoes } from '../../../services/insightsService.ts';
import { Cartao } from '../../ui/Cartao.tsx';
import { COR, EIXO, dataCurta, int, pct, sinal } from '../formato.ts';
import { Dica, Grafico, Legenda, Rodape } from '../partes.tsx';

type SemanaComRotulo = RespostaPrevisoes['semanas'][number] & { rotulo: string };

function DicaDaSemana({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  const semana = active ? (payload?.[0]?.payload as SemanaComRotulo | undefined) : undefined;
  if (!semana) return null;
  return (
    <Dica
      titulo={`Semana de ${semana.rotulo}`}
      linhas={[
        ['Realizado', int(semana.real)],
        ['Previsto', int(semana.previsto)],
        ['Erro', sinal(semana.erro, 1)],
      ]}
    />
  );
}

/** O erro medido por distância da previsão (um dia à frente, dois, …). */
function TabelaDeQualidade({ qualidade }: { qualidade: RespostaPrevisoes['qualidade'] }) {
  return (
    <table className="ins-tab">
      <thead>
        <tr>
          <th className="txt">Distância da previsão</th>
          <th>Dias testados</th>
          <th>Erro médio</th>
          <th>Dentro do intervalo de 80%</th>
        </tr>
      </thead>
      <tbody>
        {qualidade.map((linha) => (
          <tr key={linha.horizonte}>
            <td className="txt">{linha.horizonte}</td>
            <td>{int(linha.dias)}</td>
            <td>{pct(linha.erroMedio, 1)}</td>
            <td>{pct(linha.cobertura)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Acerto({ dados }: { dados: RespostaPrevisoes }) {
  const semanas: SemanaComRotulo[] = dados.semanas.map((semana) => ({
    ...semana,
    rotulo: dataCurta(semana.semana),
  }));

  return (
    <Cartao
      titulo="Quanto o modelo acerta"
      sub="Total previsto na segunda-feira, só com o que se sabia até ali, contra o realizado da semana."
    >
      <Legenda
        itens={[
          { rotulo: 'Realizado', cor: COR.serie },
          { rotulo: 'Previsto na segunda', cor: COR.ouro, forma: 'linha' },
        ]}
      />
      <Grafico altura={200}>
        <ComposedChart data={semanas} margin={{ top: 16, right: 10, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={COR.grade} />
          <XAxis dataKey="rotulo" tick={EIXO} tickLine={false} axisLine={{ stroke: COR.linha }} />
          <YAxis tick={EIXO} tickLine={false} axisLine={false} width={40} />
          <Tooltip cursor={{ fill: COR.cursor }} content={DicaDaSemana} />
          <Bar
            dataKey="real"
            fill={COR.serie}
            maxBarSize={34}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
          <Line
            dataKey="previsto"
            stroke={COR.ouro}
            strokeWidth={2.2}
            dot={{ r: 3, fill: COR.ouro }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </Grafico>
      <TabelaDeQualidade qualidade={dados.qualidade} />
      <Rodape>
        Testado nos 60 dias de trabalho mais recentes, com o intervalo calculado só com os{' '}
        {int(dados.modelo.origensTestadas - 60)} dias anteriores a eles.
      </Rodape>
    </Cartao>
  );
}
