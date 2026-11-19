// A aba OPERAÇÃO AO VIVO: o dia da instalação agora — quem está onde, a agenda por base,
// o ritmo contra o típico, a corrida da premiação e as perguntas que um coordenador faz.
// Os números vêm de `/api/insights/operacao` (Voalle ao vivo, cache de 30–45 s).

import './insights.css';
import { Fragment, useMemo, useState } from 'react';
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
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { useOperacao } from '../../hooks/useInsights.ts';
import type { RespostaOperacao, TecnicoAgora } from '../../services/insightsService.ts';
import { Cartao, Erro } from '../ui/Cartao.tsx';
import { Esqueleto } from '../ui/Estado.tsx';
import { MapaTecnicos } from './Mapa.tsx';
import {
  CATEGORIAS,
  COR,
  EIXO,
  EIXO_NOME,
  FAIXA_COR,
  FAIXA_NOME,
  FAIXA_TEXTO,
  SITUACAO,
  dec,
  int,
  mesNome,
  pct,
} from './formato.ts';
import { Dica, Grafico, Kpi, Legenda, Paginador, Rodape, n } from './partes.tsx';

const POR_PAGINA = 20;

export default function Operacao() {
  const q = useOperacao();
  // Técnico escolhido na tabela "Quem está em quê": o mapa ao lado voa até ele.
  const [focado, setFocado] = useState<number | null>(null);
  if (q.isPending) return <Esqueleto titulo="a operação de hoje" />;
  if (q.isError) return <Erro>{q.error.message}</Erro>;
  const d = q.data;
  return (
    <div className="ins">
      <Indicadores d={d} />
      <div className="ins-faixa dupla">
        <Cartao
          titulo="Onde está cada técnico agora"
          sub="Último ponto do GPS do app na última hora; cor = situação na agenda de hoje. Clique num técnico da lista ao lado para achá-lo no mapa."
        >
          <MapaTecnicos tecnicos={d.tecnicos} altura={420} focado={focado} />
          <Legenda
            itens={Object.values(SITUACAO).map((s) => ({
              rotulo: s.rotulo,
              cor: s.cor,
              forma: 'bola' as const,
            }))}
          />
        </Cartao>
        <QuemEstaEmQue
          d={d}
          focado={focado}
          aoEscolher={(id) => setFocado((atual) => (atual === id ? null : id))}
        />
      </div>
      <CorridaPremiacao d={d} />
      <div className="ins-faixa meio">
        <RitmoDoDia d={d} />
        <AgendaPorBase d={d} />
      </div>
      <div className="ins-faixa terco">
        <Cartao
          titulo="Perguntas que o painel responde agora"
          sub="Calculadas a cada atualização, com os números de hoje."
        >
          <div className="ins-perguntas">
            {d.insights.map((i) => (
              <article key={i.pergunta} className={`ins-pergunta ${i.tom}`}>
                <h3>{i.pergunta}</h3>
                <p>{i.resposta}</p>
              </article>
            ))}
          </div>
        </Cartao>
        <QualidadeVolume d={d} />
      </div>
      <div className="ins-faixa dupla">
        <QuandoInstala d={d} />
        <RetrabalhoPorMes d={d} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- indicadores
function Indicadores({ d }: { d: RespostaOperacao }) {
  const k = d.kpis;
  const a = k.agenda;
  const porFazer = a.aguardando + a.aCaminho + a.execucao;
  const ritmo = k.esperadoAteAgora ? k.ativacoesHoje / k.esperadoAteAgora - 1 : null;
  const mesDelta = d.mes.mesmoPontoMesAnterior
    ? d.mes.realizado / d.mes.mesmoPontoMesAnterior - 1
    : null;
  const larg = (v: number): string => `${a.total ? (100 * v) / a.total : 0}%`;
  return (
    <section className="ins-kpis" aria-label="Indicadores de hoje">
      <Kpi
        destaque
        rotulo="Ativações hoje"
        valor={int(k.ativacoesHoje)}
        delta={ritmo}
        title="Comparado com o esperado para este horário, pelo perfil das últimas semanas"
        desc={`${int(k.esperadoAteAgora)} esperadas até agora · fechamento estimado ${int(k.estimativaHoje)} · +${int(k.movimentacoesHoje)} movimentações`}
      />
      <Kpi
        rotulo="Agenda de hoje"
        valor={int(a.concluido)}
        unidade={` de ${int(a.total)}`}
        desc={`${int(porFazer)} por fazer · ${int(a.semSucesso)} sem sucesso · ${int(a.slotsLivres)} slots livres`}
      >
        <span className="ins-barrinha" aria-hidden="true">
          {CATEGORIAS.map((c) => (
            <i key={c.k} style={{ width: larg(a[c.k]), background: c.cor }} />
          ))}
        </span>
      </Kpi>
      <Kpi
        rotulo="Técnicos com GPS agora"
        valor={int(k.tecnicosComSinal)}
        unidade={` de ${int(k.tecnicosEscalados)}`}
        desc={`${int(k.tecnicosEmExecucao)} em execução · ${int(k.tecnicosACaminho)} a caminho de um cliente`}
      />
      <Kpi
        rotulo="Ativações no mês"
        valor={int(d.mes.realizado)}
        delta={mesDelta}
        desc={`mesmo ponto do mês passado: ${int(d.mes.mesmoPontoMesAnterior)} · fechamento previsto ${int(d.mes.p50)}${d.mes.meta ? ` · meta ${int(d.mes.meta)}` : ''}`}
      />
      <Kpi
        rotulo="Da venda à instalação"
        valor={dec(k.prazoMedianoDias, 0)}
        unidade={k.prazoMedianoDias === 1 ? ' dia' : ' dias'}
        desc={`mediana dos últimos 30 dias · ${pct(k.instaladoAte2Dias)} instaladas em até 2 dias`}
      />
      <Kpi
        rotulo="Retrabalho em 30 dias"
        valor={pct(k.retrabalho30d, 1)}
        deltaBom={false}
        title="Ativações cujo cliente abriu chamado técnico por problema (incidente, suporte, pendência, retorno prioritário) em até 30 dias"
        desc="cliente chamou por problema em até 30 dias (ativações de 30 a 150 dias atrás)"
      />
      <Kpi
        rotulo="Tempo na casa do cliente"
        valor={int(k.execucaoMediana)}
        unidade=" min"
        desc={`mediana em execução no app · deslocamento ${int(k.deslocamentoMediano)} min (30 dias)`}
      />
    </section>
  );
}

// ------------------------------------------------------------- quem está em quê
function Chip({ t }: { t: TecnicoAgora }) {
  const s = SITUACAO[t.situacao];
  if (t.semSinal && t.situacao !== 'agendaConcluida' && t.situacao !== 'semAgenda') {
    return (
      <span className="ins-chip semSinal" title="Sem ponto de GPS há mais de 15 minutos">
        {s.rotulo}
      </span>
    );
  }
  return (
    <span className={`ins-chip ${t.situacao}`}>
      <i style={{ background: s.cor }} />
      {s.rotulo}
    </span>
  );
}

function QuemEstaEmQue({
  d,
  focado,
  aoEscolher,
}: {
  d: RespostaOperacao;
  focado: number | null;
  aoEscolher: (tecId: number) => void;
}) {
  return (
    <Cartao
      titulo={`Quem está em quê (${d.tecnicos.length} técnicos)`}
      sub="Escalados hoje nas bases de ativação e quem está com GPS ligado. Ordem: em execução, a caminho, aguardando. Clique na linha para achar o técnico no mapa."
    >
      <div className="ins-rolagem" style={{ maxHeight: 440 }}>
        <table className="ins-tab">
          <thead>
            <tr>
              <th className="txt">Técnico</th>
              <th className="txt">Agora</th>
              <th title="Concluídos de agendados hoje">Agenda</th>
              <th>Hoje</th>
              <th>Mês</th>
            </tr>
          </thead>
          <tbody>
            {d.tecnicos.map((t) => {
              const detalhe = [
                t.desde !== null && t.desde >= 0 ? `há ${t.desde} min` : null,
                t.situacao === 'aguardando' && t.proximoAs ? `próximo às ${t.proximoAs}` : null,
                t.sinalHaMin === null ? 'sem GPS na última hora' : `GPS há ${t.sinalHaMin} min`,
              ]
                .filter(Boolean)
                .join(' · ');
              const faixa = t.faixa as keyof typeof FAIXA_COR | null;
              const aceso = t.tec_id === focado;
              return (
                <tr
                  key={t.tec_id}
                  className={`ins-tr-clicavel${aceso ? ' aceso' : ''}`}
                  onClick={() => aoEscolher(t.tec_id)}
                >
                  <td className="txt" title={t.nome}>
                    {/* Botão de verdade: é por ele que o teclado e o leitor de tela
                          chegam ao mapa — a linha só repete o mesmo clique. */}
                    <button
                      type="button"
                      className="ins-tec-botao"
                      aria-pressed={aceso}
                      title={`Achar ${t.nome} no mapa`}
                      onClick={(e) => {
                        e.stopPropagation();
                        aoEscolher(t.tec_id);
                      }}
                    >
                      {t.curto}
                    </button>
                    <div className="ins-sub">{t.base ?? '—'}</div>
                  </td>
                  <td className="txt">
                    <Chip t={t} />
                    <div className="ins-sub">{detalhe}</div>
                  </td>
                  <td>
                    {t.concluidos}/{t.agendados}
                    {t.semSucesso ? (
                      <span className="ins-critico" title="sem sucesso">
                        {' '}
                        ·{t.semSucesso}✕
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <b>{t.hoje}</b>
                  </td>
                  <td>
                    {t.mes}
                    {faixa && faixa in FAIXA_COR ? (
                      <span
                        className="ins-faixa-tag"
                        style={{ background: FAIXA_COR[faixa], color: FAIXA_TEXTO[faixa] }}
                      >
                        {faixa}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Cartao>
  );
}

// ---------------------------------------------------------- corrida da premiação
function CorridaPremiacao({ d }: { d: RespostaOperacao }) {
  const [pagina, setPagina] = useState(0);
  const ordenados = useMemo(
    () => [...d.premiacao.tecnicos].sort((a, b) => b.esperado - a.esperado),
    [d.premiacao.tecnicos],
  );
  const ultima = Math.max(0, Math.ceil(ordenados.length / POR_PAGINA) - 1);
  const atual = Math.min(pagina, ultima);
  const dados = ordenados.slice(atual * POR_PAGINA, (atual + 1) * POR_PAGINA).map((t) => ({
    ...t,
    corDaFaixa: FAIXA_COR[t.faixaAtual ?? 'sem'],
    falta: Math.max(0, t.esperado - t.realizado),
    erro: [
      Math.max(0, t.esperado - (t.p10 ?? t.esperado)),
      Math.max(0, (t.p90 ?? t.esperado) - t.esperado),
    ],
  }));
  const maximo = Math.max(150, ...ordenados.map((t) => t.p90 ?? 0));
  return (
    <Cartao
      titulo="Corrida da premiação — mês corrente"
      sub="Cheio = protocolos que já contam, na cor da faixa atual; claro = projeção até o fim do mês, com o intervalo de 80%."
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
      <Legenda
        itens={[
          ...(['F1', 'F2', 'F3', 'F4', 'F5', 'F6'] as const).map((f) => ({
            rotulo: FAIXA_NOME[f],
            cor: FAIXA_COR[f],
          })),
          { rotulo: 'Ainda sem faixa', cor: FAIXA_COR.sem },
          { rotulo: `Projeção (${d.premiacao.diasRestantes} dias de trabalho)`, cor: COR.projecao },
        ]}
      />
      <Grafico altura={46 + POR_PAGINA * 22}>
        <BarChart
          data={dados}
          layout="vertical"
          margin={{ top: 18, right: 46, bottom: 4, left: 4 }}
          barCategoryGap={4}
        >
          <CartesianGrid horizontal={false} stroke={COR.grade} />
          <XAxis
            type="number"
            domain={[0, maximo]}
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
          {d.premiacao.faixas.map((f) => (
            <ReferenceLine
              key={f.id}
              x={f.min}
              stroke={COR.neutro}
              strokeDasharray="3 3"
              label={{ value: f.id, position: 'top', fill: COR.cinza, fontSize: 10.5 }}
            />
          ))}
          <Tooltip
            cursor={{ fill: COR.cursor }}
            content={({ active, payload }) => {
              const t = active
                ? (payload?.[0]?.payload as (typeof dados)[number] | undefined)
                : undefined;
              if (!t) return null;
              return (
                <Dica
                  titulo={t.nome}
                  linhas={[
                    ['Já contam', int(t.realizado)],
                    ['Hoje', int(t.hoje)],
                    ['Projeção do mês', `${int(t.esperado)} (${int(t.p10)}–${int(t.p90)})`],
                    [
                      'Faixa mais provável',
                      `${FAIXA_NOME[t.maisProvavel]} · ${pct(t.probs[t.maisProvavel])}`,
                    ],
                    t.proxima
                      ? [
                          'Próxima faixa',
                          `${t.proxima.nome}: faltam ${t.proxima.faltam} (${dec(t.porDiaNecessario, 1)}/dia)`,
                        ]
                      : null,
                    t.proxima ? ['Chance de chegar', pct(t.pSubir)] : null,
                    ['Ritmo (por dia de trabalho)', dec(t.ritmo, 1)],
                    t.base ? ['Base', t.base] : null,
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="realizado" stackId="a" isAnimationActive={false}>
            {dados.map((t) => (
              <Cell key={t.tec_id} fill={t.corDaFaixa} />
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
            {/* o número da projeção vai DEPOIS do traço do intervalo: a escala sai do
                próprio trecho (largura em px ÷ protocolos que ele representa) */}
            <LabelList
              dataKey="esperado"
              content={(p) => {
                const t = dados[n(p.index)];
                if (!t) return null;
                const x = n(p.x);
                const largura = n(p.width);
                const pxPorUnidade = t.falta > 0 ? largura / t.falta : 0;
                const fimDoTraco =
                  x + largura + ((t.p90 ?? t.esperado) - t.esperado) * pxPorUnidade;
                return (
                  <text
                    x={fimDoTraco + 6}
                    y={n(p.y) + n(p.height) / 2 + 4}
                    fontSize={10.5}
                    fill={COR.tinta}
                    fontWeight={600}
                  >
                    {t.esperado}
                  </text>
                );
              }}
            />
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

// -------------------------------------------------------------------- ritmo do dia
function RitmoDoDia({ d }: { d: RespostaOperacao }) {
  const dados = d.ritmo.map((r) => ({
    ...r,
    faixa: [r.p25, r.p75] as [number | null, number | null],
  }));
  let ultimo = -1;
  dados.forEach((r, i) => {
    if (r.hoje !== null) ultimo = i;
  });
  return (
    <Cartao
      titulo="Ritmo do dia — ativações acumuladas"
      sub="Hoje contra o mesmo dia da semana nas últimas 6 semanas (mediana e 1º–3º quartil)."
    >
      <Legenda
        itens={[
          { rotulo: 'Hoje', cor: COR.vinho, forma: 'linha' },
          { rotulo: 'Típico (mediana)', cor: COR.cinza, forma: 'tracejada' },
          { rotulo: 'Faixa normal (25%–75%)', cor: COR.faixaNeutra },
        ]}
      />
      <Grafico altura={270}>
        <ComposedChart data={dados} margin={{ top: 8, right: 40, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={COR.grade} />
          <XAxis
            dataKey="hora"
            tick={EIXO}
            tickLine={false}
            axisLine={{ stroke: COR.linha }}
            interval={3}
          />
          <YAxis tick={EIXO} tickLine={false} axisLine={false} width={36} />
          <Tooltip
            content={({ active, payload, label }) => {
              const r = active
                ? (payload?.[0]?.payload as (typeof dados)[number] | undefined)
                : undefined;
              if (!r) return null;
              return (
                <Dica
                  titulo={String(label)}
                  linhas={[
                    ['Hoje', int(r.hoje)],
                    ['Típico', int(r.tipico)],
                    ['Faixa normal', `${int(r.p25)}–${int(r.p75)}`],
                  ]}
                />
              );
            }}
          />
          <Area dataKey="faixa" stroke="none" fill={COR.faixaNeutra} isAnimationActive={false} />
          <Line
            dataKey="tipico"
            stroke={COR.cinza}
            strokeDasharray="5 4"
            strokeWidth={1.6}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="hoje"
            stroke={COR.vinho}
            strokeWidth={2.4}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="hoje"
              content={(p) =>
                n(p.index) === ultimo ? (
                  <text
                    x={n(p.x) + 6}
                    y={n(p.y) + 4}
                    fontSize={12}
                    fontWeight={700}
                    fill={COR.tinta}
                  >
                    {String(p.value)}
                  </text>
                ) : null
              }
            />
          </Line>
        </ComposedChart>
      </Grafico>
      <Rodape>Conta pela hora em que o material foi lançado no protocolo.</Rodape>
    </Cartao>
  );
}

// ------------------------------------------------------------------ agenda por base
function AgendaPorBase({ d }: { d: RespostaOperacao }) {
  return (
    <Cartao
      titulo="Agenda de hoje por base"
      sub="Atendimentos reservados nas bases de ativação, pelo último estado no app."
    >
      <Legenda itens={CATEGORIAS.map((c) => ({ rotulo: c.rotulo, cor: c.cor }))} />
      <Grafico altura={170}>
        <BarChart
          data={d.agendaPorBase}
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
          <Tooltip
            cursor={{ fill: COR.cursor }}
            content={({ active, payload }) => {
              const b = active
                ? (payload?.[0]?.payload as RespostaOperacao['agendaPorBase'][number] | undefined)
                : undefined;
              if (!b) return null;
              return (
                <Dica
                  titulo={b.base}
                  linhas={[
                    ...CATEGORIAS.map((c): [string, string] => [c.rotulo, int(b[c.k])]),
                    ['Ativações na agenda', int(b.ativacoes)],
                    ['Slots livres', int(b.slotsLivres)],
                  ]}
                />
              );
            }}
          />
          {CATEGORIAS.map((c, i) => (
            <Bar
              key={c.k}
              dataKey={c.k}
              stackId="b"
              fill={c.cor}
              isAnimationActive={false}
              radius={i === CATEGORIAS.length - 1 ? [0, 3, 3, 0] : 0}
            />
          ))}
        </BarChart>
      </Grafico>
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
          {d.agendaPorBase.map((b) => (
            <tr key={b.base}>
              <td className="txt">{b.base}</td>
              <td>{int(b.total)}</td>
              <td>{pct(b.total ? b.concluido / b.total : null)}</td>
              <td>{int(b.aguardando + b.aCaminho + b.execucao)}</td>
              <td className={b.semSucesso ? 'ins-critico' : undefined}>{int(b.semSucesso)}</td>
              <td>{int(b.slotsLivres)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Rodape>Sem sucesso = improdutivo, pendência, desistência ou encerrado sem concluir.</Rodape>
    </Cartao>
  );
}

// ------------------------------------------------------------- qualidade × volume
function QualidadeVolume({ d }: { d: RespostaOperacao }) {
  const q = d.qualidade;
  const taxa = d.kpis.retrabalho30d ?? 0;
  const volumes = q.map((t) => t.instalacoes).sort((a, b) => a - b);
  const medVol = volumes[Math.floor(volumes.length / 2)] ?? 0;
  const corDe = (x: number | null): string =>
    x === null ? COR.neutro : x > taxa * 1.25 ? COR.critico : x < taxa * 0.8 ? COR.bom : COR.serie;
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
            tickFormatter={(v: number) => pct(v)}
          />
          <ZAxis range={[70, 70]} />
          <ReferenceLine y={taxa} stroke={COR.cinza} strokeDasharray="4 4" />
          <ReferenceLine x={medVol} stroke={COR.cinza} strokeDasharray="4 4" />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              const t = active
                ? (payload?.[0]?.payload as (typeof q)[number] | undefined)
                : undefined;
              if (!t) return null;
              return (
                <Dica
                  titulo={t.nome}
                  linhas={[
                    ['Ativações', int(t.instalacoes)],
                    ['Voltaram por problema', `${int(t.retornos)} (${pct(t.taxa, 1)})`],
                    t.execucaoMin ? ['Tempo em execução', `${int(t.execucaoMin)} min`] : null,
                  ]}
                />
              );
            }}
          />
          <Scatter data={q} isAnimationActive={false}>
            {q.map((t) => (
              <Cell
                key={t.tec_id}
                fill={corDe(t.taxa)}
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
        Linhas: retrabalho da equipe ({pct(taxa, 1)}) e volume mediano ({int(medVol)}). Embaixo à
        direita é o quadrante que a premiação deveria procurar. Só técnicos com 15 ativações ou mais
        na janela.
      </Rodape>
    </Cartao>
  );
}

// ------------------------------------------------------------------ mapa de calor
function QuandoInstala({ d }: { d: RespostaOperacao }) {
  const max = Math.max(1, ...d.calor.map((c) => c.media ?? 0));
  const horas = [...new Set(d.calor.map((c) => c.hora))];
  const dias = [...new Set(d.calor.map((c) => c.dia))];
  return (
    <Cartao
      titulo="Quando a equipe instala"
      sub="Média de ativações por hora em cada dia da semana, últimos 90 dias (feriados fora)."
    >
      <div className="ins-calor" role="table" aria-label="Ativações por dia da semana e hora">
        <span />
        {horas.map((h) => (
          <span key={h} className="eixo">
            {h}h
          </span>
        ))}
        {dias.map((dia) => (
          <Fragment key={dia}>
            <span className="eixo">{dia}</span>
            {d.calor
              .filter((c) => c.dia === dia)
              .map((c) => {
                const t = (c.media ?? 0) / max;
                return (
                  <span
                    key={c.hora}
                    className="c"
                    title={`${dia} ${c.hora}h: ${dec(c.media, 1)} ativações em média`}
                    style={{
                      background: `color-mix(in srgb, var(--pbi-primary) ${Math.round(6 + 86 * t)}%, var(--pbi-superficie))`,
                      color: t > 0.5 ? 'var(--pbi-sobre-primary)' : 'var(--pbi-ink)',
                    }}
                  >
                    {(c.media ?? 0) >= 0.5 ? dec(c.media, 0) : ''}
                  </span>
                );
              })}
          </Fragment>
        ))}
      </div>
      <Rodape>Mostra onde a agenda rende e onde sobra capacidade.</Rodape>
    </Cartao>
  );
}

// ------------------------------------------------------------ retrabalho por mês
function RetrabalhoPorMes({ d }: { d: RespostaOperacao }) {
  const dados = d.retrabalhoPorMes.map((m) => ({ ...m, rotulo: mesNome(m.mes) }));
  return (
    <Cartao
      titulo="Retrabalho por mês de ativação"
      sub="Fração das ativações do mês com chamado por problema em até 30 dias."
    >
      <Grafico altura={230}>
        <BarChart data={dados} margin={{ top: 18, right: 10, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={COR.grade} />
          <XAxis dataKey="rotulo" tick={EIXO} tickLine={false} axisLine={{ stroke: COR.linha }} />
          <YAxis
            tick={EIXO}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v: number) => pct(v)}
            domain={[0, 'auto']}
          />
          <Tooltip
            cursor={{ fill: COR.cursor }}
            content={({ active, payload }) => {
              const m = active
                ? (payload?.[0]?.payload as (typeof dados)[number] | undefined)
                : undefined;
              if (!m) return null;
              return (
                <Dica
                  titulo={m.rotulo}
                  linhas={[
                    ['Ativações', int(m.n)],
                    ['Voltaram por problema', int(m.retornos)],
                    ['Taxa', pct(m.taxa, 1)],
                  ]}
                />
              );
            }}
          />
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
              formatter={(v: unknown) => pct(typeof v === 'number' ? v : null, 1)}
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
