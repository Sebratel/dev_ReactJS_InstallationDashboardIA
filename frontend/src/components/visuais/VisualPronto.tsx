// Um visual que já tem número: escolhe o desenho pelo `conteudo` que a API declarou —
// ou pela forma NOVA que `layout.yaml` declarou (`render:`, Fase L6, §8), quando ela
// existir e o conteúdo aceitar essa troca.

import type { FiltroDaTela, VisualCalculado } from '../../services/dashboardService.ts';
import type { AoFiltrar } from '../../utils/rota.ts';
import { Card } from './Card.tsx';
import { Cartao, Erro, alturaDoConteudo } from '../ui/Cartao.tsx';
import { Grafico } from './Grafico.tsx';
import { Matriz } from './Matriz.tsx';
import { RankingBarra } from './RankingBarra.tsx';
import { Rosca } from './Rosca.tsx';
import { Tabela } from './Tabela.tsx';
import { tituloDoVisual } from '../../utils/rotulos.ts';
import { MensagemDeEstado } from '../ui/Estado.tsx';

export function VisualPronto({
  pagina,
  visual,
  filtros,
  aoFiltrar,
  aoPrever,
  render,
}: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
  aoFiltrar?: AoFiltrar;
  /** Hover-prefetch do alvo de um clique cruzado — ver `App.tsx` (`aoPreverAlvos`). */
  aoPrever?: AoFiltrar;
  /** A forma declarada em `layout.yaml` para esta coluna — `undefined` fora de uma faixa
   *  (KPI, visual sob demanda antigo) usa sempre o desenho padrão do `conteudo`. */
  render?: string;
}) {
  const titulo = tituloDoVisual(visual);
  const altura = alturaDoConteudo(visual.conteudo);

  if (visual.erro) {
    return (
      <Cartao titulo={titulo} sub="não calculou" id={visual.id} altura={altura}>
        <Erro>{visual.erro}</Erro>
      </Cartao>
    );
  }

  // Indisponível não é erro: o número existe, só não vem por este pedido (o motivo diz
  // por onde ele vem).
  if (visual.indisponivel) {
    return (
      <Cartao titulo={titulo} sub="indisponível" id={visual.id} altura={altura}>
        <MensagemDeEstado>{visual.indisponivel}</MensagemDeEstado>
      </Cartao>
    );
  }

  if (!visual.dados) {
    return (
      <Cartao titulo={titulo} sub="sem dados" id={visual.id} altura={altura}>
        <MensagemDeEstado>Sem dados disponíveis para este visual.</MensagemDeEstado>
      </Cartao>
    );
  }

  if (visual.conteudo === 'card') return <Card visual={visual} />;
  if (visual.conteudo === 'tabela') {
    if (render === 'rosca') return <Rosca visual={visual} />;
    return <Tabela pagina={pagina} visual={visual} filtros={filtros} aoFiltrar={aoFiltrar} />;
  }
  if (visual.conteudo === 'matriz') {
    return <Matriz pagina={pagina} visual={visual} filtros={filtros} />;
  }
  if (visual.conteudo === 'grafico') {
    if (render === 'ranking-barra') {
      return (
        <RankingBarra visual={visual} aoFiltrar={aoFiltrar} aoPrever={aoPrever} filtros={filtros} />
      );
    }
    return <Grafico visual={visual} aoFiltrar={aoFiltrar} aoPrever={aoPrever} filtros={filtros} />;
  }

  return (
    <Cartao titulo={titulo} sub="não suportado" id={visual.id} altura="auto">
      <Erro>Tipo de visual não suportado: {visual.conteudo ?? visual.tipo}</Erro>
    </Cartao>
  );
}
