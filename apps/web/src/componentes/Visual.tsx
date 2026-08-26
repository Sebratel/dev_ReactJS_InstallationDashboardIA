// Um visual da página: pronto, ou sob demanda.

import type { FiltroDaTela, Valor, VisualCalculado } from '../api.ts';
import { SobDemanda } from './SobDemanda.tsx';
import { VisualPronto } from './VisualPronto.tsx';

export function Visual(props: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
  aoFiltrar?: (tabela: string, coluna: string, valor: Valor) => void;
  tabelaEstreita?: boolean;
}) {
  if (props.visual.sobDemanda) {
    return <SobDemanda pagina={props.pagina} visual={props.visual} filtros={props.filtros} />;
  }
  return (
    <VisualPronto
      pagina={props.pagina}
      visual={props.visual}
      filtros={props.filtros}
      aoFiltrar={props.aoFiltrar}
      tabelaEstreita={props.tabelaEstreita}
    />
  );
}
