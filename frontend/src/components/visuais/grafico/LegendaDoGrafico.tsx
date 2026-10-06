// A legenda: um ponto por série de coluna, um tracinho por série de linha.

export function LegendaDoGrafico(props: { series: readonly { chave: string; nome: string; cor: string; desenho: string }[] }) {
  return (
    <div className="legenda">
      {props.series.map((s) => (
        <span className="chave" key={s.chave}>
          <i className={s.desenho === 'linha' ? 'tracinho' : 'ponto'} style={{ background: s.cor }} />
          <span>{s.nome}</span>
        </span>
      ))}
    </div>
  );
}
