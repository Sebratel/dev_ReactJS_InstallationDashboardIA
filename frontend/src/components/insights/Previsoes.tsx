// A aba PREVISÕES: só o que vem pela frente — ativações por dia, fechamento do mês, efeito
// da chuva, premiação projetada e backlog — e quanto cada modelo acerta, medido no próprio
// histórico. Os números vêm de `/api/insights/previsoes` (`backend/api/src/insights/`).
//
// **Este arquivo só compõe.** Cada cartão é um componente em `previsoes/`, e o preparo
// dos dados (o que antes tinha laço dentro de laço) é função pura em `previsoes/dados.ts`.
// Antes eram 933 linhas e sete gráficos no mesmo arquivo — o maior do frontend.

import './insights.css';
import { usePrevisoes } from '../../hooks/useInsights.ts';
import { Erro } from '../ui/Cartao.tsx';
import { Esqueleto } from '../ui/Estado.tsx';
import { Acerto } from './previsoes/Acerto.tsx';
import { Backlog } from './previsoes/Backlog.tsx';
import { EfeitoChuva } from './previsoes/EfeitoChuva.tsx';
import { FechamentoDoMes } from './previsoes/FechamentoDoMes.tsx';
import { Indicadores } from './previsoes/Indicadores.tsx';
import { PremiacaoProjetada } from './previsoes/PremiacaoProjetada.tsx';
import { SerieDiaria } from './previsoes/SerieDiaria.tsx';

export default function Previsoes() {
  const previsoesQ = usePrevisoes();
  if (previsoesQ.isPending) return <Esqueleto titulo="as previsões" />;
  if (previsoesQ.isError) return <Erro>{previsoesQ.error.message}</Erro>;

  const dados = previsoesQ.data;
  return (
    <div className="ins">
      <Indicadores dados={dados} />
      <SerieDiaria dados={dados} />
      <div className="ins-faixa meio">
        <FechamentoDoMes dados={dados} />
        <EfeitoChuva dados={dados} />
      </div>
      <PremiacaoProjetada dados={dados} />
      <div className="ins-faixa meio">
        <Backlog dados={dados} />
        <Acerto dados={dados} />
      </div>
      <ComoLer />
    </div>
  );
}

function ComoLer() {
  return (
    <p className="ins-nota">
      <b>Como ler.</b> Cada número vem com o intervalo de 80%: em 8 de cada 10 dias o real deve cair
      dentro dele — e o painel confere isso no próprio histórico (cartão “Quanto o modelo acerta”).
      A previsão diária é nível recente × perfil do dia da semana, com o efeito de feriado e de
      chuva medidos nos dados, não arbitrados. A premiação é simulada técnico a técnico, com a taxa
      e a presença de cada um e o choque comum da equipe.
    </p>
  );
}
