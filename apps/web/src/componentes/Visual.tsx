// Um visual da página: pronto, ou sob demanda.

import type { FiltroDaTela, VisualCalculado } from '../api.ts';
import type { AoFiltrar } from '../rota.ts';
import { SobDemanda } from './SobDemanda.tsx';
import { VisualPronto } from './VisualPronto.tsx';

export function Visual(props: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
  aoFiltrar?: AoFiltrar;
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
    />
  );
}
