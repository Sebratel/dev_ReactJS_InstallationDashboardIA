// A aba PREVISÕES: só o que vem pela frente — ativações por dia, fechamento do mês, efeito
// da chuva, premiação projetada e backlog — e quanto cada modelo acerta, medido no próprio
// histórico. Os números vêm de `/api/insights/previsoes` (`backend/api/src/insights/`).

import './insights.css';
import { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  ErrorBar,
  LabelList,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePrevisoes } from '../../hooks/useInsights.ts';
import type { RespostaPrevisoes } from '../../services/insightsService.ts';
import { Cartao, Erro } from '../ui/Cartao.tsx';
import { Esqueleto } from '../ui/Estado.tsx';
import {
  COR,
  EIXO,
  EIXO_NOME,
  FAIXA_COR,
  FAIXA_NOME,
  ORDEM_FAIXAS,
  dataCurta,
  dec,
  diaCurto,
  int,
  mesNome,
  pct,
  sinal,
} from './formato.ts';
import { Dica, Grafico, Kpi, Legenda, Paginador, Rodape, n } from './partes.tsx';

const POR_PAGINA = 20;
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

export default function Previsoes() {
  const q = usePrevisoes();
  if (q.isPending) return <Esqueleto titulo="as previsões" />;
  if (q.isError) return <Erro>{q.error.message}</Erro>;
  const d = q.data;
  return (
    <div className="ins">
      <Indicadores d={d} />
      <SerieDiaria d={d} />
      <div className="ins-faixa meio">
        <FechamentoDoMes d={d} />
        <EfeitoChuva d={d} />
      </div>
      <PremiacaoProjetada d={d} />
      <div className="ins-faixa meio">
        <Backlog d={d} />
        <Acerto d={d} />
      </div>
      <p className="ins-nota">
        <b>Como ler.</b> Cada número vem com o intervalo de 80%: em 8 de cada 10 dias o real deve
        cair dentro dele — e o painel confere isso no próprio histórico (cartão “Quanto o modelo
        acerta”). A previsão diária é nível recente × perfil do dia da semana, com o efeito de
        feriado e de chuva medidos nos dados, não arbitrados. A premiação é simulada técnico a
        técnico, com a taxa e a presença de cada um e o choque comum da equipe.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------- indicadores
function Indicadores({ d }: { d: RespostaPrevisoes }) {
  const amanha = d.previsao.find((p) => p.d > d.agora.data && !p.feriado);
  const semana = d.previsao.filter((p) => p.d > d.agora.data).slice(0, 6);
  const somaSemana = semana.reduce((s, p) => s + p.previsto, 0);
  const comFaixa = d.premiacao.tecnicos.reduce((s, t) => s + (1 - t.probs.sem), 0);
  const altas = d.premiacao.tecnicos.reduce(
    (s, t) => s + t.probs.F3 + t.probs.F4 + t.probs.F5 + t.probs.F6,
    0,
  );
  const q1 = d.qualidade[0];
  const m = d.mes;
  const primeiroDia = semana[0];
  const ultimoDia = semana[semana.length - 1];
  return (
    <section className="ins-kpis" aria-label="Indicadores previstos">
      <Kpi
        destaque
        rotulo="Fechamento previsto do mês"
        valor={int(m.p50)}
        delta={m.totalMesAnterior && m.p50 !== null ? m.p50 / m.totalMesAnterior - 1 : null}
        desc={`80% de chance entre ${int(m.p10)} e ${int(m.p90)} · mês passado ${int(m.totalMesAnterior)}${m.meta ? ` · chance de bater a meta ${pct(m.chanceMeta)}` : ''}`}
      />
      <Kpi
        rotulo={`Amanhã (${amanha ? diaCurto(amanha.d) : '—'})`}
        valor={int(amanha?.previsto)}
        desc={
          amanha
            ? `entre ${int(amanha.p10)} e ${int(amanha.p90)}${amanha.chuvaMm !== null ? ` · chuva prevista ${dec(amanha.chuvaMm, 1)} mm${amanha.ajusteChuva ? ` (−${pct(1 - amanha.ajusteChuva)})` : ''}` : ''}`
            : ''
        }
      />
      <Kpi
        rotulo="Próximos 6 dias de trabalho"
        valor={int(somaSemana)}
        desc={`${primeiroDia && ultimoDia ? `${dataCurta(primeiroDia.d)} a ${dataCurta(ultimoDia.d)}` : ''} · média ${int(somaSemana / Math.max(1, semana.length))}/dia`}
      />
      <Kpi
        rotulo="Pedidos abertos que devem instalar"
        valor={int(d.backlog.devemInstalar)}
        unidade={` de ${int(d.backlog.abertos)}`}
        desc={`${int(d.backlog.devemCair)} devem cair (cancelar ou desistir) pela idade de cada pedido`}
      />
      <Kpi
        rotulo="Técnicos que devem pegar faixa"
        valor={dec(comFaixa, 0)}
        desc={`${dec(altas, 0)} na Faixa 3 ou acima · ${d.premiacao.diasRestantes} dias de trabalho até o fechamento`}
      />
      <Kpi
        rotulo="Quanto o modelo erra"
        valor={
          q1?.erroMedio !== null && q1?.erroMedio !== undefined
            ? `±${int(q1.erroMedio * 100)}`
            : '—'
        }
        unidade="%"
        desc={
          q1
            ? `erro médio de um dia para o outro · o intervalo de 80% acertou ${pct(q1.cobertura)} dos dias testados`
            : ''
        }
      />
    </section>
  );
}

// ------------------------------------------------------------------- série diária
interface PontoDiario {
  d: string;
  real?: number;
  vespera?: number | null;
  previsto?: number;
  faixa?: [number, number];
  chuva: number | null;
  prob?: number | null;
  ajusteChuva?: number | null;
  feriado?: boolean;
  reservados?: number | null;
  estimativaHoje?: number;
}

function DicaDiaria({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  const p = active ? (payload?.[0]?.payload as PontoDiario | undefined) : undefined;
  if (!p) return null;
  return (
    <Dica
      titulo={diaCurto(p.d) + (p.feriado ? ' · feriado' : '')}
      linhas={[
        p.real !== undefined ? ['Real', int(p.real)] : null,
        p.vespera !== undefined ? ['Previsto na véspera', int(p.vespera)] : null,
        p.previsto !== undefined ? ['Previsão', int(p.previsto)] : null,
        p.faixa ? ['Intervalo de 80%', `${int(p.faixa[0])}–${int(p.faixa[1])}`] : null,
        p.estimativaHoje !== undefined
          ? ['Fechamento estimado de hoje', int(p.estimativaHoje)]
          : null,
        p.chuva !== null
          ? [
              'Chuva',
              `${dec(p.chuva, 1)} mm${p.prob !== null && p.prob !== undefined ? ` (${p.prob}% de chance)` : ''}`,
            ]
          : null,
        p.ajusteChuva ? ['Efeito da chuva aplicado', `−${pct(1 - p.ajusteChuva)}`] : null,
        p.reservados ? ['Já reservado na agenda', `${int(p.reservados)} slots`] : null,
      ]}
    />
  );
}

function SerieDiaria({ d }: { d: RespostaPrevisoes }) {
  const hoje = d.agora.data;
  const dados = useMemo((): PontoDiario[] => {
    const futuro: PontoDiario[] = d.previsao.map((p) => ({
      d: p.d,
      ...(p.d === hoje && p.real !== undefined ? { real: p.real } : {}),
      previsto: p.previsto,
      faixa: [p.p10, p.p90],
      chuva: p.chuvaMm,
      prob: p.chuvaProb,
      ajusteChuva: p.ajusteChuva,
      feriado: p.feriado,
      reservados: p.agendaReservados,
      ...(p.estimativaHoje !== undefined ? { estimativaHoje: p.estimativaHoje } : {}),
    }));
    const vistos = new Set(futuro.map((f) => f.d));
    const passado: PontoDiario[] = d.ultimos
      .filter((u) => !vistos.has(u.d))
      .map((u) => ({ d: u.d, real: u.real, vespera: u.previstoVespera, chuva: u.chuvaMm }));
    return [...passado, ...futuro];
  }, [d, hoje]);
  const f = d.modelo.fatoresDiaDaSemana;
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
      <Grafico altura={300}>
        <ComposedChart
          data={dados}
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
      <Grafico altura={90}>
        <BarChart data={dados} syncId="diaria" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
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
            {dados.map((x) => (
              <Cell
                key={x.d}
                fill={
                  (x.chuva ?? 0) >= 25
                    ? COR.chuvaForte
                    : (x.chuva ?? 0) >= 10
                      ? COR.chuvaMedia
                      : COR.chuvaFraca
                }
              />
            ))}
          </Bar>
        </BarChart>
      </Grafico>
      <Rodape>
        Modelo: nível recente {dec(d.modelo.nivel, 0)}/dia útil × fator do dia da semana (seg{' '}
        {pct(f['1'])}, ter {pct(f['2'])}, qua {pct(f['3'])}, qui {pct(f['4'])}, sex {pct(f['5'])},
        sáb {pct(f['6'])}). Feriado rende {pct(d.modelo.feriado.fator)} de um dia normal (
        {d.modelo.feriado.dias} feriados medidos). Domingos fora.
        {d.modelo.climaDisponivel
          ? ''
          : ' Chuva indisponível agora: a previsão segue sem o ajuste.'}
      </Rodape>
    </Cartao>
  );
}

// ------------------------------------------------------------- fechamento do mês
function FechamentoDoMes({ d }: { d: RespostaPrevisoes }) {
  const m = d.mes;
  const dados = m.curva.map((c) => ({
    ...c,
    faixa:
      c.p10 !== undefined && c.p10 !== null && c.p90 !== undefined && c.p90 !== null
        ? ([c.p10, c.p90] as [number, number])
        : undefined,
  }));
  const ultimo = dados.length - 1;
  return (
    <Cartao
      titulo="Fechamento do mês — acumulado"
      sub="Realizado e, daí em diante, 4.000 simulações com sequências reais de erro do histórico."
    >
      <Legenda
        itens={[
          { rotulo: 'Realizado', cor: COR.vinho, forma: 'linha' },
          { rotulo: 'Projeção (mediana)', cor: COR.ouro, forma: 'tracejada' },
          { rotulo: 'Intervalo de 80%', cor: COR.faixa },
        ]}
      />
      <Grafico altura={290}>
        <ComposedChart data={dados} margin={{ top: 10, right: 50, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={COR.grade} />
          <XAxis
            dataKey="d"
            tick={EIXO}
            tickLine={false}
            axisLine={{ stroke: COR.linha }}
            tickFormatter={dataCurta}
            minTickGap={16}
          />
          <YAxis
            tick={EIXO}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v: number) => int(v)}
          />
          {m.totalMesAnterior ? (
            <ReferenceLine
              y={m.totalMesAnterior}
              stroke={COR.cinza}
              strokeDasharray="4 4"
              label={{
                value: `mês passado ${int(m.totalMesAnterior)}`,
                position: 'insideTopLeft',
                fontSize: 10.5,
                fill: COR.cinza,
              }}
            />
          ) : null}
          {m.meta ? (
            <ReferenceLine
              y={m.meta}
              stroke={COR.vinho}
              label={{
                value: `meta ${int(m.meta)}`,
                position: 'insideTopLeft',
                fontSize: 10.5,
                fill: COR.vinho,
              }}
            />
          ) : null}
          <Tooltip
            content={({ active, payload }) => {
              const c = active
                ? (payload?.[0]?.payload as (typeof dados)[number] | undefined)
                : undefined;
              if (!c) return null;
              return (
                <Dica
                  titulo={diaCurto(c.d)}
                  linhas={[
                    c.realizado !== undefined ? ['Realizado', int(c.realizado)] : null,
                    c.p50 !== undefined ? ['Projeção', int(c.p50)] : null,
                    c.faixa ? ['Intervalo de 80%', `${int(c.faixa[0])}–${int(c.faixa[1])}`] : null,
                  ]}
                />
              );
            }}
          />
          <Area dataKey="faixa" stroke="none" fill={COR.faixa} isAnimationActive={false} />
          <Line
            dataKey="p50"
            stroke={COR.ouro}
            strokeDasharray="5 4"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="p50"
              content={(p) =>
                n(p.index) === ultimo ? (
                  <text
                    x={n(p.x) + 6}
                    y={n(p.y) + 4}
                    fontSize={12}
                    fontWeight={700}
                    fill={COR.tinta}
                  >
                    {int(num(p.value))}
                  </text>
                ) : null
              }
            />
          </Line>
          <Line
            dataKey="realizado"
            stroke={COR.vinho}
            strokeWidth={2.4}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </Grafico>
      <Rodape>
        Mediana {int(m.p50)} · 80% entre {int(m.p10)} e {int(m.p90)} · mês passado{' '}
        {int(m.totalMesAnterior)} (no mesmo ponto: {int(m.mesmoPontoMesAnterior)}) ·{' '}
        {m.diasDeTrabalhoRestantes} dias de trabalho restantes
        {m.meta
          ? ` · meta ${int(m.meta)}: ${pct(m.chanceMeta)} de chance`
          : ' · sem meta gravada na aba Metas'}
        . As simulações reaproveitam semanas boas e ruins seguidas, não sorteios independentes.
      </Rodape>
    </Cartao>
  );
}

// -------------------------------------------------------------------- efeito chuva
function EfeitoChuva({ d }: { d: RespostaPrevisoes }) {
  const dados = d.chuva.map((c) => {
    const e = c.efeito ?? 0;
    const [lo, hi] = c.ic;
    return {
      ...c,
      valor: e,
      erro: lo !== null && hi !== null ? [Math.max(0, e - lo), Math.max(0, hi - e)] : [0, 0],
    };
  });
  const chuvosos = d.previsao.filter((p) => p.d > d.agora.data && p.ajusteChuva).slice(0, 4);
  return (
    <Cartao
      titulo="Quanto a chuva derruba as ativações"
      sub="Erro do modelo em cada faixa de chuva contra os dias secos. Barra = mediana; traço = intervalo de 90%."
    >
      <Grafico altura={270}>
        <BarChart data={dados} margin={{ top: 22, right: 16, bottom: 0, left: 0 }}>
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
            tickFormatter={(v: number) => sinal(v)}
            domain={[-0.9, 0.1]}
          />
          <ReferenceLine y={0} stroke={COR.cinza} />
          <Tooltip
            cursor={{ fill: COR.cursor }}
            content={({ active, payload }) => {
              const c = active
                ? (payload?.[0]?.payload as (typeof dados)[number] | undefined)
                : undefined;
              if (!c) return null;
              return (
                <Dica
                  titulo={c.rotulo}
                  linhas={[
                    ['Dias medidos', int(c.dias)],
                    ['Efeito (mediana)', sinal(c.efeito, 1)],
                    ['Intervalo de 90%', `${sinal(c.ic[0], 1)} a ${sinal(c.ic[1], 1)}`],
                    ['Entra na previsão', c.aplicado ? 'sim' : 'não'],
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="valor" maxBarSize={56} isAnimationActive={false}>
            {dados.map((c) => (
              <Cell key={c.id} fill={c.aplicado ? COR.serie : COR.neutro} />
            ))}
            <ErrorBar dataKey="erro" width={8} strokeWidth={1.4} stroke={COR.tinta} />
            <LabelList
              dataKey="valor"
              position="bottom"
              offset={8}
              formatter={(v: unknown) => sinal(num(v))}
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
        {chuvosos.length
          ? `Ajuste nos próximos dias: ${chuvosos.map((p) => `${diaCurto(p.d)} (${dec(p.chuvaMm, 0)} mm → −${pct(1 - (p.ajusteChuva ?? 1))})`).join(' · ')}.`
          : 'Nenhum dos próximos dias tem chuva prevista na faixa que derruba a produção.'}{' '}
        Medido desde mar/2025: só vira ajuste o que fica claramente abaixo de zero.
      </Rodape>
    </Cartao>
  );
}

// ------------------------------------------------------------- premiação projetada
function PremiacaoProjetada({ d }: { d: RespostaPrevisoes }) {
  const [pagina, setPagina] = useState(0);
  const ordenados = useMemo(
    () =>
      [...d.premiacao.tecnicos]
        .sort((a, b) => b.esperado - a.esperado)
        .map((t) => ({
          ...t,
          // 136 (fora da régua) soma na F5 para a barra fechar 100%; a dica mostra separado
          ...Object.fromEntries(
            ORDEM_FAIXAS.map((f) => [f, t.probs[f] + (f === 'F5' ? t.probs.OUTROS : 0)]),
          ),
        })) as (RespostaPrevisoes['premiacao']['tecnicos'][number] &
        Record<(typeof ORDEM_FAIXAS)[number], number>)[],
    [d.premiacao.tecnicos],
  );
  const ultima = Math.max(0, Math.ceil(ordenados.length / POR_PAGINA) - 1);
  const atual = Math.min(pagina, ultima);
  const lista = ordenados.slice(atual * POR_PAGINA, (atual + 1) * POR_PAGINA);
  const t = d.premiacao.teste;
  return (
    <Cartao
      titulo="Premiação projetada — chance de fechar o mês em cada faixa"
      sub="Cada barra soma 100%: quanto da simulação do técnico termina em cada faixa. Barra dividida em duas cores fortes = fronteira."
      acoes={
        <Paginador
          pagina={atual}
          total={ordenados.length}
          porPagina={POR_PAGINA}
          aoMudar={setPagina}
        />
      }
      largo
    >
      <div className="ins-faixa terco">
        <div>
          <span className="ins-kpi-rotulo">Quantos técnicos devem fechar em cada faixa</span>
          <Grafico altura={250}>
            <BarChart
              data={d.premiacao.resumoFaixas}
              margin={{ top: 18, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} stroke={COR.grade} />
              <XAxis
                dataKey="faixa"
                tick={EIXO}
                tickLine={false}
                axisLine={{ stroke: COR.linha }}
              />
              <YAxis tick={EIXO} tickLine={false} axisLine={false} width={30} />
              <Tooltip
                cursor={{ fill: COR.cursor }}
                content={({ active, payload }) => {
                  const r = active
                    ? (payload?.[0]?.payload as
                        RespostaPrevisoes['premiacao']['resumoFaixas'][number] | undefined)
                    : undefined;
                  if (!r) return null;
                  return (
                    <Dica
                      titulo={FAIXA_NOME[r.faixa]}
                      linhas={[
                        ['Esperado no fechamento', dec(r.esperado, 1)],
                        ['Já estão nela hoje', int(r.hoje)],
                      ]}
                    />
                  );
                }}
              />
              <Bar
                dataKey="esperado"
                radius={[3, 3, 0, 0]}
                maxBarSize={40}
                isAnimationActive={false}
              >
                {d.premiacao.resumoFaixas.map((r) => (
                  <Cell key={r.faixa} fill={FAIXA_COR[r.faixa]} />
                ))}
                <LabelList
                  dataKey="esperado"
                  position="top"
                  formatter={(v: unknown) => dec(num(v), 0)}
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
        <div>
          <Legenda
            itens={ORDEM_FAIXAS.map((f) => ({ rotulo: FAIXA_NOME[f], cor: FAIXA_COR[f] }))}
          />
          <Grafico altura={40 + POR_PAGINA * 22}>
            <BarChart
              data={lista}
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
                tickFormatter={(v: number) => pct(v)}
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
              <Tooltip
                cursor={{ fill: COR.cursor }}
                content={({ active, payload }) => {
                  const r = active
                    ? (payload?.[0]?.payload as (typeof lista)[number] | undefined)
                    : undefined;
                  if (!r) return null;
                  return (
                    <Dica
                      titulo={r.nome}
                      linhas={[
                        ['Hoje no mês', int(r.realizado)],
                        ['Projeção', `${int(r.esperado)} (${int(r.p10)}–${int(r.p90)})`],
                        ...ORDEM_FAIXAS.filter((f) => r.probs[f] >= 0.01).map(
                          (f): [string, string] => [FAIXA_NOME[f], pct(r.probs[f])],
                        ),
                        r.probs.OUTROS >= 0.01
                          ? ['Cai em 136 (fora da régua)', pct(r.probs.OUTROS)]
                          : null,
                      ]}
                    />
                  );
                }}
              />
              {ORDEM_FAIXAS.map((f, i) => (
                <Bar key={f} dataKey={f} stackId="p" fill={FAIXA_COR[f]} isAnimationActive={false}>
                  {i === ORDEM_FAIXAS.length - 1 ? (
                    <LabelList
                      dataKey="esperado"
                      content={(p) => (
                        <text
                          x={n(p.x) + n(p.width) + 6}
                          y={n(p.y) + n(p.height) / 2 + 4}
                          fontSize={10.5}
                          fill={COR.cinza}
                        >
                          {`→ ${String(p.value)}`}
                        </text>
                      )}
                    />
                  ) : null}
                </Bar>
              ))}
            </BarChart>
          </Grafico>
        </div>
      </div>
      {t.tecnicos ? (
        <Rodape>
          Conferido em {t.meses.map((m) => mesNome(m.mes)).join(', ')}, refazendo cada mês como se
          fosse o dia 15 ({t.tecnicos} técnico-meses): a faixa mais provável acertou {pct(t.acerto)}{' '}
          na mosca e {pct(t.acertoUmaFaixa)} com até uma faixa de diferença; o intervalo de 80% do
          total cobriu {pct(t.coberturaP10P90)}; viés {sinal(t.vies, 1)}.
        </Rodape>
      ) : null}
    </Cartao>
  );
}

// ------------------------------------------------------------------------- backlog
function Backlog({ d }: { d: RespostaPrevisoes }) {
  const b = d.backlog;
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
      <Grafico altura={190}>
        <BarChart data={b.porIdade} margin={{ top: 16, right: 10, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={COR.grade} />
          <XAxis
            dataKey="faixa"
            tick={EIXO}
            tickLine={false}
            axisLine={{ stroke: COR.linha }}
            interval={0}
          />
          <YAxis tick={EIXO} tickLine={false} axisLine={false} width={36} />
          <Tooltip
            cursor={{ fill: COR.cursor }}
            content={({ active, payload }) => {
              const r = active
                ? (payload?.[0]?.payload as (typeof b.porIdade)[number] | undefined)
                : undefined;
              if (!r) return null;
              return (
                <Dica
                  titulo={`Abertos há ${r.faixa}`}
                  linhas={[
                    ['Pedidos', int(r.abertos)],
                    ['Devem instalar', int(r.devemInstalar)],
                    ['Devem cair', int(r.devemCair)],
                    ['Agendamentos por pedido', dec(r.agendasMedia, 1)],
                  ]}
                />
              );
            }}
          />
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
      <Grafico altura={150}>
        <ComposedChart data={b.curva} margin={{ top: 14, right: 18, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={COR.grade} />
          <XAxis
            dataKey="idade"
            tick={EIXO}
            tickLine={false}
            axisLine={{ stroke: COR.linha }}
            tickFormatter={(v: number) => `${v}d`}
          />
          <YAxis
            tick={EIXO}
            tickLine={false}
            axisLine={false}
            width={36}
            tickFormatter={(v: number) => pct(v)}
            domain={[0, 1]}
          />
          <Tooltip
            content={({ active, payload }) => {
              const r = active
                ? (payload?.[0]?.payload as (typeof b.curva)[number] | undefined)
                : undefined;
              if (!r) return null;
              return (
                <Dica
                  titulo={`Aberto há ${r.idade} dia(s)`}
                  linhas={[
                    ['Chance de ainda instalar', pct(r.chanceInstalar)],
                    ['Pedidos na conta', int(r.pedidos)],
                  ]}
                />
              );
            }}
          />
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
              formatter={(v: unknown) => pct(num(v))}
              fontSize={10.5}
              fill={COR.tinta}
            />
          </Line>
        </ComposedChart>
      </Grafico>
      <Rodape>
        Mediana da venda à instalação: {int(b.medianaDiasAteInstalar)} dia(s).{' '}
        {pct(b.prazo.find((p) => p.dias === 2)?.fracao)} das instaladas saem em até 2 dias;{' '}
        {pct(b.prazo.find((p) => p.dias === 7)?.fracao)} em até 7.
      </Rodape>
    </Cartao>
  );
}

// -------------------------------------------------------------------------- acerto
function Acerto({ d }: { d: RespostaPrevisoes }) {
  const dados = d.semanas.map((s) => ({ ...s, rotulo: dataCurta(s.semana) }));
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
        <ComposedChart data={dados} margin={{ top: 16, right: 10, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={COR.grade} />
          <XAxis dataKey="rotulo" tick={EIXO} tickLine={false} axisLine={{ stroke: COR.linha }} />
          <YAxis tick={EIXO} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            cursor={{ fill: COR.cursor }}
            content={({ active, payload }) => {
              const s = active
                ? (payload?.[0]?.payload as (typeof dados)[number] | undefined)
                : undefined;
              if (!s) return null;
              return (
                <Dica
                  titulo={`Semana de ${s.rotulo}`}
                  linhas={[
                    ['Realizado', int(s.real)],
                    ['Previsto', int(s.previsto)],
                    ['Erro', sinal(s.erro, 1)],
                  ]}
                />
              );
            }}
          />
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
          {d.qualidade.map((q) => (
            <tr key={q.horizonte}>
              <td className="txt">{q.horizonte}</td>
              <td>{int(q.dias)}</td>
              <td>{pct(q.erroMedio, 1)}</td>
              <td>{pct(q.cobertura)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Rodape>
        Testado nos 60 dias de trabalho mais recentes, com o intervalo calculado só com os{' '}
        {int(d.modelo.origensTestadas - 60)} dias anteriores a eles.
      </Rodape>
    </Cartao>
  );
}
