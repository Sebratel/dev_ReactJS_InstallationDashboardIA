// A aba OPERAÇÃO AO VIVO: o dia da instalação agora — quem está onde, a agenda por base,
// o ritmo contra o típico, a corrida da premiação e as perguntas que um coordenador faz.
// Os números vêm de `/api/insights/operacao` (Voalle ao vivo, cache de 30–45 s).
//
// **Este arquivo só compõe.** Cada cartão é um componente em `operacao/`, e o preparo
// dos dados é função pura em `operacao/dados.ts` — inclusive a grade do mapa de calor,
// que antes varria a lista inteira de células uma vez por dia da semana. Antes eram 818
// linhas e nove gráficos no mesmo arquivo.

import './insights.css';
import { useState } from 'react';
import { useOperacao } from '../../hooks/useInsights.ts';
import { Erro } from '../ui/Cartao.tsx';
import { Esqueleto } from '../ui/Estado.tsx';
import { AgendaPorBase } from './operacao/AgendaPorBase.tsx';
import { CorridaPremiacao } from './operacao/CorridaPremiacao.tsx';
import { Indicadores } from './operacao/Indicadores.tsx';
import { OndeEstaCadaTecnico, PerguntasDoPainel } from './operacao/PainelDeMapa.tsx';
import { QualidadeVolume } from './operacao/QualidadeVolume.tsx';
import { QuandoInstala } from './operacao/QuandoInstala.tsx';
import { QuemEstaEmQue } from './operacao/QuemEstaEmQue.tsx';
import { RetrabalhoPorMes } from './operacao/RetrabalhoPorMes.tsx';
import { RitmoDoDia } from './operacao/RitmoDoDia.tsx';

export default function Operacao() {
  const operacaoQ = useOperacao();
  // Técnico escolhido na tabela "Quem está em quê": o mapa ao lado voa até ele.
  const [focado, setFocado] = useState<number | null>(null);

  if (operacaoQ.isPending) return <Esqueleto titulo="a operação de hoje" />;
  if (operacaoQ.isError) return <Erro>{operacaoQ.error.message}</Erro>;

  const dados = operacaoQ.data;
  const alternaFoco = (tecId: number) => setFocado((atual) => (atual === tecId ? null : tecId));

  return (
    <div className="ins">
      <Indicadores dados={dados} />

      <div className="ins-faixa dupla">
        <OndeEstaCadaTecnico tecnicos={dados.tecnicos} focado={focado} />
        <QuemEstaEmQue dados={dados} focado={focado} aoEscolher={alternaFoco} />
      </div>

      <CorridaPremiacao dados={dados} />

      <div className="ins-faixa meio">
        <RitmoDoDia dados={dados} />
        <AgendaPorBase dados={dados} />
      </div>

      <div className="ins-faixa terco">
        <PerguntasDoPainel insights={dados.insights} />
        <QualidadeVolume dados={dados} />
      </div>

      <div className="ins-faixa dupla">
        <QuandoInstala dados={dados} />
        <RetrabalhoPorMes dados={dados} />
      </div>
    </div>
  );
}
