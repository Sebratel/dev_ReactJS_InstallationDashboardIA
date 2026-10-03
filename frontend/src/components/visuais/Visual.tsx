// Um visual da página: pronto, ou sob demanda.

import type { FiltroDaTela, VisualCalculado } from '../../services/dashboardService.ts';
import type { AoFiltrar } from '../../utils/rota.ts';
import { SobDemanda } from './SobDemanda.tsx';
import { VisualPronto } from './VisualPronto.tsx';
import { VisualErrorBoundary } from './VisualErrorBoundary.tsx';

export function Visual(props: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
  clicados?: readonly { tabela: string; coluna: string }[];
  aoFiltrar?: AoFiltrar;
  aoPrever?: AoFiltrar;
  render?: string;
}) {
  const corpo = props.visual.sobDemanda ? (
    <SobDemanda
      pagina={props.pagina}
      visual={props.visual}
      filtros={props.filtros}
      clicados={props.clicados}
      aoFiltrar={props.aoFiltrar}
      aoPrever={props.aoPrever}
      render={props.render}
    />
  ) : (
    <VisualPronto
      pagina={props.pagina}
      visual={props.visual}
      filtros={props.filtros}
      aoFiltrar={props.aoFiltrar}
      aoPrever={props.aoPrever}
      render={props.render}
    />
  );

  return <VisualErrorBoundary visual={props.visual}>{corpo}</VisualErrorBoundary>;
}
