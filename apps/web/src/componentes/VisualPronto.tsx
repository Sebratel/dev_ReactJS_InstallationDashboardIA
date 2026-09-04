// Um visual que já tem número: escolhe o desenho pelo `conteudo` que a API declarou —
// ou pela forma NOVA que `layout.yaml` declarou (`render:`, Fase L6, §8), quando ela
// existir e o conteúdo aceitar essa troca.

import type { FiltroDaTela, VisualCalculado } from '../api.ts';
import type { AoFiltrar } from '../rota.ts';
import { Card } from './Card.tsx';
import { Cartao, Erro, alturaDoConteudo } from './Cartao.tsx';
import { Grafico } from './Grafico.tsx';
import { Matriz } from './Matriz.tsx';
import { RankingBarra } from './RankingBarra.tsx';
import { Rosca } from './Rosca.tsx';
import { Tabela } from './Tabela.tsx';
import { tituloDoVisual } from '../rotulos.ts';

export function VisualPronto({
  pagina,
  visual,
  filtros,
  aoFiltrar,
  render,
}: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
  aoFiltrar?: AoFiltrar;
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

  if (!visual.dados) {
    return (
      <Cartao titulo={titulo} sub="sem dados" id={visual.id} altura={altura}>
        <p className="sob-demanda">Sem dados disponíveis para este visual.</p>
      </Cartao>
    );
  }

  if (visual.conteudo === 'card') return <Card visual={visual} />;
  if (visual.conteudo === 'tabela') {
    if (render === 'rosca') return <Rosca visual={visual} />;
    return <Tabela pagina={pagina} visual={visual} filtros={filtros} />;
  }
  if (visual.conteudo === 'matriz') {
    return <Matriz pagina={pagina} visual={visual} filtros={filtros} />;
  }
  if (visual.conteudo === 'grafico') {
    if (render === 'ranking-barra') return <RankingBarra visual={visual} aoFiltrar={aoFiltrar} filtros={filtros} />;
    return <Grafico visual={visual} aoFiltrar={aoFiltrar} filtros={filtros} />;
  }

  return (
    <Cartao titulo={titulo} sub="não suportado" id={visual.id} altura="auto">
      <Erro>Tipo de visual não suportado: {visual.conteudo ?? visual.tipo}</Erro>
    </Cartao>
  );
}
