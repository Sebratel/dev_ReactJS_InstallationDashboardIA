// A legenda: um ponto por série de coluna, um tracinho por série de linha.

export function LegendaDoGrafico(props: {
  series: readonly { chave: string; nome: string; cor: string; desenho: string }[];
}) {
  return (
    <div className="legenda">
      {props.series.map((serie) => (
        <span className="chave" key={serie.chave}>
          <i
            className={serie.desenho === 'linha' ? 'tracinho' : 'ponto'}
            style={{ background: serie.cor }}
          />
          <span>{serie.nome}</span>
        </span>
      ))}
    </div>
  );
}
