// Um visual que já tem número: escolhe o desenho pelo `conteudo` que a API declarou —
// ou pela forma NOVA que `layout.yaml` declarou (`render:`, Fase L6, §8), quando ela
// existir e o conteúdo aceitar essa troca.

import type { FiltroDaTela, VisualCalculado } from '../api.ts';
import type { AoFiltrar } from '../rota.ts';
import { Card } from './Card.tsx';
import { Cartao, Erro, alturaDoConteudo } from './Cartao.tsx';
import { Grafico } from './Grafico.tsx';
import { Matriz } from './Matriz.tsx';
import { Rosca } from './Rosca.tsx';
import { Tabela } from './Tabela.tsx';

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
  if (visual.erro) {
    return (
      <Cartao titulo={visual.tipo} sub="não calculou" id={visual.id} altura={alturaDoConteudo(visual.conteudo)}>
        <Erro>{visual.erro}</Erro>
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
    return <Grafico visual={visual} aoFiltrar={aoFiltrar} filtros={filtros} />;
  }

  return null;
}
