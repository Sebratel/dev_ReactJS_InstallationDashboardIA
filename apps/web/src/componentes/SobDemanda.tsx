// O visual que a página não trouxe — e que ela mesma vai buscar.
//
// O fetch em si mora em `usaVisualSobDemanda` (cancelável e single-flight — R3 do
// contrato de carregamento, `docs/PLANO-LAYOUT-V1.md` §7); este componente só decide
// o que desenhar em cada um dos três estados.

import type { FiltroDaTela, VisualCalculado } from '../api.ts';
import { Cartao, Erro, alturaDoConteudo } from './Cartao.tsx';
import { VisualPronto } from './VisualPronto.tsx';
import { tituloDoVisual } from '../rotulos.ts';
import { usaVisualSobDemanda } from './usa-visual-sob-demanda.ts';

export function SobDemanda(props: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
  clicados?: readonly { tabela: string; coluna: string }[];
  render?: string;
}) {
  const { estado, pronto, erro, tentarDeNovo } = usaVisualSobDemanda(
    props.pagina,
    props.visual.id,
    props.filtros,
    props.clicados,
  );

  if (pronto) {
    return (
      <VisualPronto pagina={props.pagina} visual={pronto} filtros={props.filtros} render={props.render} />
    );
  }

  const titulo = tituloDoVisual(props.visual);
  // A mesma altura do visual que vai substituir este cartao — ver `alturaDoConteudo`.
  const altura = alturaDoConteudo(props.visual.conteudo);

  if (estado === 'carregando') {
    return (
      <Cartao titulo={titulo} sub="carregando…" id={props.visual.id} altura={altura}>
        <div className="esqueleto" aria-busy="true" aria-live="polite">
          <span className="sr-only">Carregando {titulo}…</span>
          <div className="esqueleto-linha" />
          <div className="esqueleto-linha" />
          <div className="esqueleto-linha" />
        </div>
      </Cartao>
    );
  }

  return (
    <Cartao titulo={titulo} sub="não carregou" id={props.visual.id} altura={altura}>
      <div className="sob-demanda">
        {erro ? <Erro>{erro}</Erro> : null}
        <p>
          Este visual usa {(props.visual.sobDemanda ?? []).join(', ')}, que fica fora da abertura da
          página por ser grande demais para carregar sempre.
        </p>
        <button className="primario" onClick={tentarDeNovo}>
          Tentar de novo
        </button>
      </div>
    </Cartao>
  );
}
