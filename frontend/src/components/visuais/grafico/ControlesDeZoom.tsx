// P/M/G: quantas categorias entram por página. Já não estica o desenho — ver `Grafico.tsx`.

const ROTULOS = ['P', 'M', 'G'];

export function ControlesDeZoom(props: { nivel: number; niveis: number; aoMudar: (nivel: number) => void }) {
  const { nivel, niveis, aoMudar } = props;
  return (
    <div className="controles-zoom" title="Densidade: quantas categorias por página">
      <button
        type="button"
        title="Mais categorias por página, colunas mais finas"
        disabled={nivel === 0}
        onClick={() => aoMudar(Math.max(0, nivel - 1))}
      >
        −
      </button>
      <span className="zoom-rotulo">{ROTULOS[nivel] ?? 'G'}</span>
      <button
        type="button"
        title="Menos categorias por página, colunas mais largas"
        disabled={nivel === niveis - 1}
        onClick={() => aoMudar(Math.min(niveis - 1, nivel + 1))}
      >
        +
      </button>
    </div>
  );
}
