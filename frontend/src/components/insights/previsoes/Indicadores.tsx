// A faixa de indicadores da aba PREVISÕES: o que o mês deve fechar, o de amanhã, a
// semana, o backlog, os técnicos com faixa e o erro do modelo.

import type { RespostaPrevisoes } from '../../../services/insightsService.ts';
import { dataCurta, dec, diaCurto, int, pct } from '../formato.ts';
import { Kpi } from '../partes.tsx';

/** A soma das chances de pegar QUALQUER faixa, somada técnico a técnico. */
function tecnicosComFaixa(tecnicos: RespostaPrevisoes['premiacao']['tecnicos']): number {
  return tecnicos.reduce((soma, tecnico) => soma + (1 - tecnico.probs.sem), 0);
}

/** O mesmo, só para a Faixa 3 e acima. */
function tecnicosEmFaixaAlta(tecnicos: RespostaPrevisoes['premiacao']['tecnicos']): number {
  return tecnicos.reduce((soma, t) => soma + t.probs.F3 + t.probs.F4 + t.probs.F5 + t.probs.F6, 0);
}

/** A descrição do fechamento previsto: intervalo, mês passado e chance de meta. */
function descricaoDoFechamento(mes: RespostaPrevisoes['mes']): string {
  const intervalo = `80% de chance entre ${int(mes.p10)} e ${int(mes.p90)}`;
  const mesPassado = `mês passado ${int(mes.totalMesAnterior)}`;
  const meta = mes.meta ? ` · chance de bater a meta ${pct(mes.chanceMeta)}` : '';
  return `${intervalo} · ${mesPassado}${meta}`;
}

/** A descrição do dia de amanhã: intervalo e, quando houver, a chuva e o desconto dela. */
function descricaoDeAmanha(dia: RespostaPrevisoes['previsao'][number] | undefined): string {
  if (!dia) return '';
  const intervalo = `entre ${int(dia.p10)} e ${int(dia.p90)}`;
  if (dia.chuvaMm === null) return intervalo;
  const desconto = dia.ajusteChuva ? ` (−${pct(1 - dia.ajusteChuva)})` : '';
  return `${intervalo} · chuva prevista ${dec(dia.chuvaMm, 1)} mm${desconto}`;
}

/** O período da semana prevista, "12/03 a 18/03". */
function periodoDaSemana(semana: readonly RespostaPrevisoes['previsao'][number][]): string {
  const primeiro = semana[0];
  const ultimo = semana[semana.length - 1];
  if (!primeiro || !ultimo) return '';
  return `${dataCurta(primeiro.d)} a ${dataCurta(ultimo.d)}`;
}

export function Indicadores({ dados }: { dados: RespostaPrevisoes }) {
  const mes = dados.mes;
  const amanha = dados.previsao.find((dia) => dia.d > dados.agora.data && !dia.feriado);
  const semana = dados.previsao.filter((dia) => dia.d > dados.agora.data).slice(0, 6);
  const somaDaSemana = semana.reduce((soma, dia) => soma + dia.previsto, 0);
  const mediaDiaria = somaDaSemana / Math.max(1, semana.length);
  const comFaixa = tecnicosComFaixa(dados.premiacao.tecnicos);
  const emFaixaAlta = tecnicosEmFaixaAlta(dados.premiacao.tecnicos);
  const umDia = dados.qualidade[0];

  return (
    <section className="ins-kpis" aria-label="Indicadores previstos">
      <Kpi
        destaque
        rotulo="Fechamento previsto do mês"
        valor={int(mes.p50)}
        delta={mes.totalMesAnterior && mes.p50 !== null ? mes.p50 / mes.totalMesAnterior - 1 : null}
        desc={descricaoDoFechamento(mes)}
      />
      <Kpi
        rotulo={`Amanhã (${amanha ? diaCurto(amanha.d) : '—'})`}
        valor={int(amanha?.previsto)}
        desc={descricaoDeAmanha(amanha)}
      />
      <Kpi
        rotulo="Próximos 6 dias de trabalho"
        valor={int(somaDaSemana)}
        desc={`${periodoDaSemana(semana)} · média ${int(mediaDiaria)}/dia`}
      />
      <Kpi
        rotulo="Pedidos abertos que devem instalar"
        valor={int(dados.backlog.devemInstalar)}
        unidade={` de ${int(dados.backlog.abertos)}`}
        desc={`${int(dados.backlog.devemCair)} devem cair (cancelar ou desistir) pela idade de cada pedido`}
      />
      <Kpi
        rotulo="Técnicos que devem pegar faixa"
        valor={dec(comFaixa, 0)}
        desc={`${dec(emFaixaAlta, 0)} na Faixa 3 ou acima · ${dados.premiacao.diasRestantes} dias de trabalho até o fechamento`}
      />
      <Kpi
        rotulo="Quanto o modelo erra"
        valor={
          umDia?.erroMedio !== null && umDia?.erroMedio !== undefined
            ? `±${int(umDia.erroMedio * 100)}`
            : '—'
        }
        unidade="%"
        desc={
          umDia
            ? `erro médio de um dia para o outro · o intervalo de 80% acertou ${pct(umDia.cobertura)} dos dias testados`
            : ''
        }
      />
    </section>
  );
}
