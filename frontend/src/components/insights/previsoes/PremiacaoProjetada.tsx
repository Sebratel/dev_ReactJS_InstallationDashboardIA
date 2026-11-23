// Premiação projetada: a chance de cada técnico fechar o mês em cada faixa.
//
// São dois gráficos lado a lado — quantos técnicos devem cair em cada faixa, e a barra
// de 100% de cada técnico. O preparo dos dados (que antes tinha um `map` dentro de
// outro) mora em `dados.ts`.

import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Tooltip, XAxis, YAxis } from 'recharts';
import type { RespostaPrevisoes } from '../../../services/insightsService.ts';
import { Cartao } from '../../ui/Cartao.tsx';
import {
  COR,
  EIXO,
  EIXO_NOME,
  FAIXA_COR,
  FAIXA_NOME,
  ORDEM_FAIXAS,
  dec,
  int,
  mesNome,
  pct,
  sinal,
} from '../formato.ts';
import { Dica, Grafico, Legenda, Paginador, Rodape, numero } from '../partes.tsx';
import { faixasRelevantes, tecnicosPorEsperado, type TecnicoComFaixas } from './dados.ts';

const POR_PAGINA = 20;
const numeroOuNulo = (valor: unknown): number | null => (typeof valor === 'number' ? valor : null);

type ResumoDeFaixa = RespostaPrevisoes['premiacao']['resumoFaixas'][number];

function DicaDoResumo({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  const faixa = active ? (payload?.[0]?.payload as ResumoDeFaixa | undefined) : undefined;
  if (!faixa) return null;
  return (
    <Dica
      titulo={FAIXA_NOME[faixa.faixa]}
      linhas={[
        ['Esperado no fechamento', dec(faixa.esperado, 1)],
        ['Já estão nela hoje', int(faixa.hoje)],
      ]}
    />
  );
}

function DicaDoTecnico({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  const tecnico = active ? (payload?.[0]?.payload as TecnicoComFaixas | undefined) : undefined;
  if (!tecnico) return null;

  const porFaixa = faixasRelevantes(tecnico).map((faixa): [string, string] => [
    FAIXA_NOME[faixa],
    pct(tecnico.probs[faixa]),
  ]);

  return (
    <Dica
      titulo={tecnico.nome}
      linhas={[
        ['Hoje no mês', int(tecnico.realizado)],
        ['Projeção', `${int(tecnico.esperado)} (${int(tecnico.p10)}–${int(tecnico.p90)})`],
        ...porFaixa,
        tecnico.probs.OUTROS >= 0.01
          ? ['Cai em 136 (fora da régua)', pct(tecnico.probs.OUTROS)]
          : null,
      ]}
    />
  );
}

/** Quantos técnicos devem fechar em cada faixa — a base para provisionar o custo. */
function ResumoPorFaixa({ resumo }: { resumo: RespostaPrevisoes['premiacao']['resumoFaixas'] }) {
  return (
    <div>
      <span className="ins-kpi-rotulo">Quantos técnicos devem fechar em cada faixa</span>
      <Grafico altura={250}>
        <BarChart data={resumo} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={COR.grade} />
          <XAxis dataKey="faixa" tick={EIXO} tickLine={false} axisLine={{ stroke: COR.linha }} />
          <YAxis tick={EIXO} tickLine={false} axisLine={false} width={30} />
          <Tooltip cursor={{ fill: COR.cursor }} content={DicaDoResumo} />
          <Bar dataKey="esperado" radius={[3, 3, 0, 0]} maxBarSize={40} isAnimationActive={false}>
            {resumo.map((faixa) => (
              <Cell key={faixa.faixa} fill={FAIXA_COR[faixa.faixa]} />
            ))}
            <LabelList
              dataKey="esperado"
              position="top"
              formatter={(valor: unknown) => dec(numeroOuNulo(valor), 0)}
              fontSize={11}
              fontWeight={700}
              fill={COR.tinta}
            />
          </Bar>
        </BarChart>
      </Grafico>
      <Rodape>
        Soma das chances de cada técnico — base para provisionar o custo da premiação antes do
        fechamento.
      </Rodape>
    </div>
  );
}

/**
 * Uma faixa da barra empilhada de um técnico.
 *
 * A última da pilha leva o rótulo com o total esperado, à direita da barra — por isso a
 * prop `comTotalAoLado`, em vez do índice e de um `if` dentro do laço que monta as
 * barras.
 */
function BarraDaFaixa({
  faixa,
  comTotalAoLado,
}: {
  faixa: (typeof ORDEM_FAIXAS)[number];
  comTotalAoLado: boolean;
}) {
  return (
    <Bar dataKey={faixa} stackId="p" fill={FAIXA_COR[faixa]} isAnimationActive={false}>
      {comTotalAoLado ? (
        <LabelList
          dataKey="esperado"
          content={(parte) => (
            <text
              x={numero(parte.x) + numero(parte.width) + 6}
              y={numero(parte.y) + numero(parte.height) / 2 + 4}
              fontSize={10.5}
              fill={COR.cinza}
            >
              {`→ ${String(parte.value)}`}
            </text>
          )}
        />
      ) : null}
    </Bar>
  );
}

/** A barra de 100% de cada técnico da página atual. */
function FaixasPorTecnico({ tecnicos }: { tecnicos: readonly TecnicoComFaixas[] }) {
  const ultimaFaixa = ORDEM_FAIXAS[ORDEM_FAIXAS.length - 1];
  return (
    <div>
      <Legenda
        itens={ORDEM_FAIXAS.map((faixa) => ({ rotulo: FAIXA_NOME[faixa], cor: FAIXA_COR[faixa] }))}
      />
      <Grafico altura={40 + POR_PAGINA * 22}>
        <BarChart
          data={tecnicos}
          layout="vertical"
          stackOffset="expand"
          margin={{ top: 4, right: 52, bottom: 0, left: 0 }}
          barCategoryGap={4}
        >
          <XAxis
            type="number"
            tick={EIXO}
            tickLine={false}
            axisLine={{ stroke: COR.linha }}
            tickFormatter={(valor: number) => pct(valor)}
          />
          <YAxis
            type="category"
            dataKey="curto"
            width={124}
            tick={EIXO_NOME}
            tickLine={false}
            axisLine={false}
            interval={0}
          />
          <Tooltip cursor={{ fill: COR.cursor }} content={DicaDoTecnico} />
          {ORDEM_FAIXAS.map((faixa) => (
            <BarraDaFaixa key={faixa} faixa={faixa} comTotalAoLado={faixa === ultimaFaixa} />
          ))}
        </BarChart>
      </Grafico>
    </div>
  );
}

/** O que a conferência no histórico diz da projeção por técnico. */
function RodapeDoTeste({ teste }: { teste: RespostaPrevisoes['premiacao']['teste'] }) {
  if (!teste.tecnicos) return null;
  const meses = teste.meses.map((mes) => mesNome(mes.mes)).join(', ');
  return (
    <Rodape>
      Conferido em {meses}, refazendo cada mês como se fosse o dia 15 ({teste.tecnicos}{' '}
      técnico-meses): a faixa mais provável acertou {pct(teste.acerto)} na mosca e{' '}
      {pct(teste.acertoUmaFaixa)} com até uma faixa de diferença; o intervalo de 80% do total cobriu{' '}
      {pct(teste.coberturaP10P90)}; viés {sinal(teste.vies, 1)}.
    </Rodape>
  );
}

export function PremiacaoProjetada({ dados }: { dados: RespostaPrevisoes }) {
  const [pagina, setPagina] = useState(0);
  const ordenados = useMemo(
    () => tecnicosPorEsperado(dados.premiacao.tecnicos),
    [dados.premiacao.tecnicos],
  );

  const ultimaPagina = Math.max(0, Math.ceil(ordenados.length / POR_PAGINA) - 1);
  const paginaAtual = Math.min(pagina, ultimaPagina);
  const daPagina = ordenados.slice(paginaAtual * POR_PAGINA, (paginaAtual + 1) * POR_PAGINA);

  return (
    <Cartao
      titulo="Premiação projetada — chance de fechar o mês em cada faixa"
      sub="Cada barra soma 100%: quanto da simulação do técnico termina em cada faixa. Barra dividida em duas cores fortes = fronteira."
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
      <div className="ins-faixa terco">
        <ResumoPorFaixa resumo={dados.premiacao.resumoFaixas} />
        <FaixasPorTecnico tecnicos={daPagina} />
      </div>
      <RodapeDoTeste teste={dados.premiacao.teste} />
    </Cartao>
  );
}
