// Um visual que já tem número: escolhe o desenho pelo `conteudo` que a API declarou.
//
// **Arquivo separado do `Visual.tsx` por causa de um ciclo.** `Visual` precisa da
// ramificação "sob demanda", e `SobDemanda`, depois de carregar, precisa desenhar o
// visual pronto. Um importando o outro fecha um ciclo de módulos; com este terceiro
// arquivo, os dois dependem dele e nenhum depende do outro.

import type { FiltroDaTela, Valor, VisualCalculado } from '../api.ts';
import { Card } from './Card.tsx';
import { Cartao, Erro } from './Cartao.tsx';
import { Grafico } from './Grafico.tsx';
import { Matriz } from './Matriz.tsx';
import { Tabela } from './Tabela.tsx';

export function VisualPronto({
  pagina,
  visual,
  filtros,
  aoFiltrar,
}: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
  aoFiltrar?: (tabela: string, coluna: string, valor: Valor) => void;
}) {
  // O erro de um visual é informação, e viaja no payload justamente para aparecer.
  // Esconder o card quebrado deixaria a página com um buraco silencioso.
  if (visual.erro) {
    return (
      <Cartao titulo={visual.tipo} sub="não calculou" id={visual.id} largo>
        <Erro>{visual.erro}</Erro>
      </Cartao>
    );
  }

  if (visual.conteudo === 'card') return <Card visual={visual} />;
  if (visual.conteudo === 'tabela') {
    return <Tabela pagina={pagina} visual={visual} filtros={filtros} />;
  }
  if (visual.conteudo === 'matriz') {
    return <Matriz pagina={pagina} visual={visual} filtros={filtros} />;
  }
  if (visual.conteudo === 'grafico') return <Grafico visual={visual} aoFiltrar={aoFiltrar} />;

  // `conteudo: null` sem ser segmentação nem sob demanda: imagem, forma, caixa de
  // texto. São 189 no relatório inteiro e não têm número — a página os conta na
  // faixa em vez de desenhar uma moldura vazia para cada um.
  return null;
}
