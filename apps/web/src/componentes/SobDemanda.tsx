// O visual que a página não trouxe — e que ela mesma vai buscar.

import { useState, useEffect } from 'react';
import { pegaPagina, type FiltroDaTela, type VisualCalculado } from '../api.ts';
import { Cartao, Erro, alturaDoConteudo } from './Cartao.tsx';
import { VisualPronto } from './VisualPronto.tsx';
import { tituloDoVisual } from '../rotulos.ts';

export function SobDemanda(props: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
}) {
  const [estado, setEstado] = useState<'parado' | 'carregando'>('carregando');
  const [pronto, setPronto] = useState<VisualCalculado | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let atual = true;
    setEstado('carregando');
    setErro(null);

    pegaPagina(props.pagina, props.filtros, { visual: props.visual.id })
      .then((p) => {
        const achado = p.visuais.find((v) => v.id === props.visual.id);
        if (!achado) throw new Error('a resposta não trouxe este visual.');
        if (achado.erro) throw new Error(achado.erro);
        if (atual) setPronto(achado);
      })
      .catch((err: unknown) => {
        if (atual) setErro(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (atual) setEstado('parado');
      });

    return () => {
      atual = false;
    };
  }, [props.pagina, props.visual.id, props.filtros]);

  if (pronto) return <VisualPronto pagina={props.pagina} visual={pronto} filtros={props.filtros} />;

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
        <button className="primario" onClick={() => setEstado('carregando')}>
          Tentar de novo
        </button>
      </div>
    </Cartao>
  );
}
