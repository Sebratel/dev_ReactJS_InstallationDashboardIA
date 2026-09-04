// Um visual da página: pronto, ou sob demanda.

import type { FiltroDaTela, VisualCalculado } from '../api.ts';
import type { AoFiltrar } from '../rota.ts';
import { SobDemanda } from './SobDemanda.tsx';
import { VisualPronto } from './VisualPronto.tsx';
import { VisualErrorBoundary } from './VisualErrorBoundary.tsx';

export function Visual(props: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
  clicados?: readonly { tabela: string; coluna: string }[];
  aoFiltrar?: AoFiltrar;
  render?: string;
}) {
  const corpo = props.visual.sobDemanda ? (
    <SobDemanda
      pagina={props.pagina}
      visual={props.visual}
      filtros={props.filtros}
      clicados={props.clicados}
      render={props.render}
    />
  ) : (
    <VisualPronto
      pagina={props.pagina}
      visual={props.visual}
      filtros={props.filtros}
      aoFiltrar={props.aoFiltrar}
      render={props.render}
    />
  );

  return <VisualErrorBoundary visual={props.visual}>{corpo}</VisualErrorBoundary>;
}
