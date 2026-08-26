// Um visual da página: pronto, ou sob demanda.

import type { FiltroDaTela, VisualCalculado } from '../api.ts';
import { SobDemanda } from './SobDemanda.tsx';
import { VisualPronto } from './VisualPronto.tsx';

export function Visual(props: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
}) {
  // Sob demanda vem antes do erro e do conteúdo: a API já decidiu, **antes** de
  // calcular, que este visual amarra coluna que ficou fora da carga. Ele não falhou.
  if (props.visual.sobDemanda) {
    return <SobDemanda pagina={props.pagina} visual={props.visual} filtros={props.filtros} />;
  }
  return <VisualPronto pagina={props.pagina} visual={props.visual} filtros={props.filtros} />;
}
