// A agenda de hoje por base: os atendimentos reservados nas bases de ativação, pelo
// último estado registrado no app.

import { Bar, BarChart, Tooltip, XAxis, YAxis } from 'recharts';
import type { RespostaOperacao } from '../../../services/insightsService.ts';
import { Cartao } from '../../ui/Cartao.tsx';
import { CATEGORIAS, COR, EIXO, EIXO_NOME, int, pct } from '../formato.ts';
import { Dica, Grafico, Legenda, Rodape } from '../partes.tsx';

type Base = RespostaOperacao['agendaPorBase'][number];

function DicaDaBase({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  const base = active ? (payload?.[0]?.payload as Base | undefined) : undefined;
  if (!base) return null;

  const porCategoria = CATEGORIAS.map((categoria): [string, string] => [
    categoria.rotulo,
    int(base[categoria.k]),
  ]);

  return (
    <Dica
      titulo={base.base}
      linhas={[
        ...porCategoria,
        ['Ativações na agenda', int(base.ativacoes)],
        ['Slots livres', int(base.slotsLivres)],
      ]}
    />
  );
}

/** A tabela embaixo do gráfico, com os mesmos números em texto. */
function TabelaDasBases({ bases }: { bases: readonly Base[] }) {
  return (
    <table className="ins-tab">
      <thead>
        <tr>
          <th className="txt">Base</th>
          <th>Agendados</th>
          <th>Concluídos</th>
          <th>Por fazer</th>
          <th>Sem sucesso</th>
          <th>Slots livres</th>
        </tr>
      </thead>
      <tbody>
        {bases.map((base) => (
          <tr key={base.base}>
            <td className="txt">{base.base}</td>
            <td>{int(base.total)}</td>
            <td>{pct(base.total ? base.concluido / base.total : null)}</td>
            <td>{int(base.aguardando + base.aCaminho + base.execucao)}</td>
            <td className={base.semSucesso ? 'ins-critico' : undefined}>{int(base.semSucesso)}</td>
            <td>{int(base.slotsLivres)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AgendaPorBase({ dados }: { dados: RespostaOperacao }) {
  // Só a última categoria da pilha arredonda a ponta direita da barra.
  const ultimaCategoria = CATEGORIAS[CATEGORIAS.length - 1]?.k;

  return (
    <Cartao
      titulo="Agenda de hoje por base"
      sub="Atendimentos reservados nas bases de ativação, pelo último estado no app."
    >
      <Legenda
        itens={CATEGORIAS.map((categoria) => ({ rotulo: categoria.rotulo, cor: categoria.cor }))}
      />
      <Grafico altura={170}>
        <BarChart
          data={dados.agendaPorBase}
          layout="vertical"
          margin={{ top: 4, right: 30, bottom: 0, left: 0 }}
          barCategoryGap={14}
        >
          <XAxis type="number" tick={EIXO} tickLine={false} axisLine={{ stroke: COR.linha }} />
          <YAxis
            type="category"
            dataKey="base"
            width={100}
            tick={EIXO_NOME}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip cursor={{ fill: COR.cursor }} content={DicaDaBase} />
          {CATEGORIAS.map((categoria) => (
            <Bar
              key={categoria.k}
              dataKey={categoria.k}
              stackId="b"
              fill={categoria.cor}
              isAnimationActive={false}
              radius={categoria.k === ultimaCategoria ? [0, 3, 3, 0] : 0}
            />
          ))}
        </BarChart>
      </Grafico>
      <TabelaDasBases bases={dados.agendaPorBase} />
      <Rodape>Sem sucesso = improdutivo, pendência, desistência ou encerrado sem concluir.</Rodape>
    </Cartao>
  );
}
