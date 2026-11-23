// Corrida da premiação do mês corrente: o que cada técnico já tem (barra cheia, na cor
// da faixa atual) e até onde deve chegar (barra clara, com o intervalo de 80%).

import { useMemo, useState } from 'react';
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
import type { RespostaOperacao } from '../../../services/insightsService.ts';
import { Cartao } from '../../ui/Cartao.tsx';
import { COR, EIXO, EIXO_NOME, FAIXA_COR, FAIXA_NOME, dec, int, pct } from '../formato.ts';
import { Dica, Grafico, Legenda, Paginador, Rodape, numero } from '../partes.tsx';
import { barrasDaCorrida, type BarraDaCorrida } from './dados.ts';

const POR_PAGINA = 20;
const FAIXAS_NA_LEGENDA = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'] as const;

/** A régua mínima do eixo: 150 protocolos, ou o maior p90 se alguém passar disso. */
function tetoDoEixo(tecnicos: readonly RespostaOperacao['premiacao']['tecnicos'][number][]) {
  return Math.max(150, ...tecnicos.map((tecnico) => tecnico.p90 ?? 0));
}

function DicaDoTecnico({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  const tecnico = active ? (payload?.[0]?.payload as BarraDaCorrida | undefined) : undefined;
  if (!tecnico) return null;

  return (
    <Dica
      titulo={tecnico.nome}
      linhas={[
        ['Já contam', int(tecnico.realizado)],
        ['Hoje', int(tecnico.hoje)],
        ['Projeção do mês', `${int(tecnico.esperado)} (${int(tecnico.p10)}–${int(tecnico.p90)})`],
        [
          'Faixa mais provável',
          `${FAIXA_NOME[tecnico.maisProvavel]} · ${pct(tecnico.probs[tecnico.maisProvavel])}`,
        ],
        tecnico.proxima
          ? [
              'Próxima faixa',
              `${tecnico.proxima.nome}: faltam ${tecnico.proxima.faltam} (${dec(tecnico.porDiaNecessario, 1)}/dia)`,
            ]
          : null,
        tecnico.proxima ? ['Chance de chegar', pct(tecnico.pSubir)] : null,
        ['Ritmo (por dia de trabalho)', dec(tecnico.ritmo, 1)],
        tecnico.base ? ['Base', tecnico.base] : null,
      ]}
    />
  );
}

/**
 * O número da projeção, DEPOIS do traço do intervalo.
 *
 * A escala sai do próprio trecho claro da barra (largura em px ÷ protocolos que ele
 * representa) — é assim que o rótulo sabe onde o traço de p90 termina.
 */
function RotuloDaProjecao({ barras }: { barras: readonly BarraDaCorrida[] }) {
  return (
    <LabelList
      dataKey="esperado"
      content={(parte) => {
        const tecnico = barras[numero(parte.index)];
        if (!tecnico) return null;
        const inicio = numero(parte.x);
        const largura = numero(parte.width);
        const pxPorUnidade = tecnico.falta > 0 ? largura / tecnico.falta : 0;
        const fimDoTraco =
          inicio + largura + ((tecnico.p90 ?? tecnico.esperado) - tecnico.esperado) * pxPorUnidade;
        return (
          <text
            x={fimDoTraco + 6}
            y={numero(parte.y) + numero(parte.height) / 2 + 4}
            fontSize={10.5}
            fill={COR.tinta}
            fontWeight={600}
          >
            {tecnico.esperado}
          </text>
        );
      }}
    />
  );
}

export function CorridaPremiacao({ dados }: { dados: RespostaOperacao }) {
  const [pagina, setPagina] = useState(0);
  const ordenados = useMemo(
    () =>
      [...dados.premiacao.tecnicos].sort(
        (primeiro, segundo) => segundo.esperado - primeiro.esperado,
      ),
    [dados.premiacao.tecnicos],
  );

  const ultimaPagina = Math.max(0, Math.ceil(ordenados.length / POR_PAGINA) - 1);
  const paginaAtual = Math.min(pagina, ultimaPagina);
  const barras = barrasDaCorrida(
    ordenados.slice(paginaAtual * POR_PAGINA, (paginaAtual + 1) * POR_PAGINA),
  );
  const teto = tetoDoEixo(ordenados);

  return (
    <Cartao
      titulo="Corrida da premiação — mês corrente"
      sub="Cheio = protocolos que já contam, na cor da faixa atual; claro = projeção até o fim do mês, com o intervalo de 80%."
      acoes={
        <Paginador
          pagina={paginaAtual}
          total={ordenados.length}
          porPagina={POR_PAGINA}
          aoMudar={setPagina}
        />
      }
      largo
    >
      <Legenda
        itens={[
          ...FAIXAS_NA_LEGENDA.map((faixa) => ({
            rotulo: FAIXA_NOME[faixa],
            cor: FAIXA_COR[faixa],
          })),
          { rotulo: 'Ainda sem faixa', cor: FAIXA_COR.sem },
          {
            rotulo: `Projeção (${dados.premiacao.diasRestantes} dias de trabalho)`,
            cor: COR.projecao,
          },
        ]}
      />
      <Grafico altura={46 + POR_PAGINA * 22}>
        <BarChart
          data={barras}
          layout="vertical"
          margin={{ top: 18, right: 46, bottom: 4, left: 4 }}
          barCategoryGap={4}
        >
          <CartesianGrid horizontal={false} stroke={COR.grade} />
          <XAxis
            type="number"
            domain={[0, teto]}
            tick={EIXO}
            tickLine={false}
            axisLine={{ stroke: COR.linha }}
          />
          <YAxis
            type="category"
            dataKey="curto"
            width={128}
            tick={EIXO_NOME}
            tickLine={false}
            axisLine={false}
            interval={0}
          />
          {dados.premiacao.faixas.map((faixa) => (
            <ReferenceLine
              key={faixa.id}
              x={faixa.min}
              stroke={COR.neutro}
              strokeDasharray="3 3"
              label={{ value: faixa.id, position: 'top', fill: COR.cinza, fontSize: 10.5 }}
            />
          ))}
          <Tooltip cursor={{ fill: COR.cursor }} content={DicaDoTecnico} />
          <Bar dataKey="realizado" stackId="a" isAnimationActive={false}>
            {barras.map((tecnico) => (
              <Cell key={tecnico.tec_id} fill={tecnico.corDaFaixa} />
            ))}
          </Bar>
          <Bar
            dataKey="falta"
            stackId="a"
            fill={COR.projecao}
            radius={[0, 3, 3, 0]}
            isAnimationActive={false}
          >
            <ErrorBar dataKey="erro" width={5} strokeWidth={1.4} stroke={COR.vinho} direction="x" />
            <RotuloDaProjecao barras={barras} />
          </Bar>
        </BarChart>
      </Grafico>
      <Rodape>
        Barra cheia = protocolos que já contam (instalador, troca de endereço e auxiliar). Régua da
        medida Faixas do relatório: 60 / 75 / 90 / 105 / 120 / acima de 136. Exatamente 136 fica
        fora (o DAX usa “&gt; 136”).
      </Rodape>
    </Cartao>
  );
}
