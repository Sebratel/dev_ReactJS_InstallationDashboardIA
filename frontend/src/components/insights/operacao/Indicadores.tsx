// A faixa de indicadores da aba OPERAÇÃO: o dia até agora, a agenda, os técnicos com
// GPS, o mês, o prazo da venda à instalação, o retrabalho e o tempo na casa do cliente.

import type { RespostaOperacao } from '../../../services/insightsService.ts';
import { CATEGORIAS, dec, int, pct } from '../formato.ts';
import { Kpi } from '../partes.tsx';

type Agenda = RespostaOperacao['kpis']['agenda'];

/** A barrinha colorida embaixo do cartão da agenda: uma fatia por categoria. */
function BarraDaAgenda({ agenda }: { agenda: Agenda }) {
  const larguraDe = (quantidade: number): string =>
    `${agenda.total ? (100 * quantidade) / agenda.total : 0}%`;

  return (
    <span className="ins-barrinha" aria-hidden="true">
      {CATEGORIAS.map((categoria) => (
        <i
          key={categoria.k}
          style={{ width: larguraDe(agenda[categoria.k]), background: categoria.cor }}
        />
      ))}
    </span>
  );
}

/** A variação contra uma referência — `null` quando não há com o que comparar. */
function variacao(atual: number, referencia: number | null): number | null {
  return referencia ? atual / referencia - 1 : null;
}

/** A descrição do mês: mesmo ponto do mês passado, previsão e, se houver, a meta. */
function descricaoDoMes(mes: RespostaOperacao['mes']): string {
  const base = `mesmo ponto do mês passado: ${int(mes.mesmoPontoMesAnterior)} · fechamento previsto ${int(mes.p50)}`;
  return mes.meta ? `${base} · meta ${int(mes.meta)}` : base;
}

export function Indicadores({ dados }: { dados: RespostaOperacao }) {
  const kpis = dados.kpis;
  const agenda = kpis.agenda;
  const porFazer = agenda.aguardando + agenda.aCaminho + agenda.execucao;

  return (
    <section className="ins-kpis" aria-label="Indicadores de hoje">
      <Kpi
        destaque
        rotulo="Ativações hoje"
        valor={int(kpis.ativacoesHoje)}
        delta={variacao(kpis.ativacoesHoje, kpis.esperadoAteAgora)}
        title="Comparado com o esperado para este horário, pelo perfil das últimas semanas"
        desc={`${int(kpis.esperadoAteAgora)} esperadas até agora · fechamento estimado ${int(kpis.estimativaHoje)} · +${int(kpis.movimentacoesHoje)} movimentações`}
      />
      <Kpi
        rotulo="Agenda de hoje"
        valor={int(agenda.concluido)}
        unidade={` de ${int(agenda.total)}`}
        desc={`${int(porFazer)} por fazer · ${int(agenda.semSucesso)} sem sucesso · ${int(agenda.slotsLivres)} slots livres`}
      >
        <BarraDaAgenda agenda={agenda} />
      </Kpi>
      <Kpi
        rotulo="Técnicos com GPS agora"
        valor={int(kpis.tecnicosComSinal)}
        unidade={` de ${int(kpis.tecnicosEscalados)}`}
        desc={`${int(kpis.tecnicosEmExecucao)} em execução · ${int(kpis.tecnicosACaminho)} a caminho de um cliente`}
      />
      <Kpi
        rotulo="Ativações no mês"
        valor={int(dados.mes.realizado)}
        delta={variacao(dados.mes.realizado, dados.mes.mesmoPontoMesAnterior)}
        desc={descricaoDoMes(dados.mes)}
      />
      <Kpi
        rotulo="Da venda à instalação"
        valor={dec(kpis.prazoMedianoDias, 0)}
        unidade={kpis.prazoMedianoDias === 1 ? ' dia' : ' dias'}
        desc={`mediana dos últimos 30 dias · ${pct(kpis.instaladoAte2Dias)} instaladas em até 2 dias`}
      />
      <Kpi
        rotulo="Retrabalho em 30 dias"
        valor={pct(kpis.retrabalho30d, 1)}
        deltaBom={false}
        title="Ativações cujo cliente abriu chamado técnico por problema (incidente, suporte, pendência, retorno prioritário) em até 30 dias"
        desc="cliente chamou por problema em até 30 dias (ativações de 30 a 150 dias atrás)"
      />
      <Kpi
        rotulo="Tempo na casa do cliente"
        valor={int(kpis.execucaoMediana)}
        unidade=" min"
        desc={`mediana em execução no app · deslocamento ${int(kpis.deslocamentoMediano)} min (30 dias)`}
      />
    </section>
  );
}
