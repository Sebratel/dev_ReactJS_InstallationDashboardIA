// Os dois cartões que não têm gráfico próprio: o mapa com a posição de cada técnico e as
// perguntas que o painel responde com os números de hoje.

import type { RespostaOperacao } from '../../../services/insightsService.ts';
import { Cartao } from '../../ui/Cartao.tsx';
import { MapaTecnicos } from '../Mapa.tsx';
import { SITUACAO } from '../formato.ts';
import { Legenda } from '../partes.tsx';

/** A posição de cada técnico agora, pelo último ponto de GPS do app. */
export function OndeEstaCadaTecnico({
  tecnicos,
  focado,
}: {
  tecnicos: RespostaOperacao['tecnicos'];
  focado: number | null;
}) {
  return (
    <Cartao
      titulo="Onde está cada técnico agora"
      sub="Último ponto do GPS do app na última hora; cor = situação na agenda de hoje. Clique num técnico da lista ao lado para achá-lo no mapa."
    >
      <MapaTecnicos tecnicos={tecnicos} altura={420} focado={focado} />
      <Legenda
        itens={Object.values(SITUACAO).map((situacao) => ({
          rotulo: situacao.rotulo,
          cor: situacao.cor,
          forma: 'bola' as const,
        }))}
      />
    </Cartao>
  );
}

/** As perguntas de coordenação, calculadas a cada atualização. */
export function PerguntasDoPainel({ insights }: { insights: RespostaOperacao['insights'] }) {
  return (
    <Cartao
      titulo="Perguntas que o painel responde agora"
      sub="Calculadas a cada atualização, com os números de hoje."
    >
      <div className="ins-perguntas">
        {insights.map((insight) => (
          <article key={insight.pergunta} className={`ins-pergunta ${insight.tom}`}>
            <h3>{insight.pergunta}</h3>
            <p>{insight.resposta}</p>
          </article>
        ))}
      </div>
    </Cartao>
  );
}
