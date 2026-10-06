// O "S" da Sebratel, DESENHADO e não baixado.
//
// No topo havia `<img src="/assets/logo-sebratel-circular.png">` e na capa
// `/assets/logo-sebratel.png` — arquivos que NUNCA existiram no repositório: 404 em toda
// carga e o ícone quebrado do navegador ao lado do nome da empresa, desde `0aae15c`.
// Um `<svg>` inline não pede rede, não quebra e acompanha a paleta. Se o arquivo oficial
// entrar em `frontend/public/`, troque só este componente.
//
// No topo o círculo é bordô com letra clara; na faixa bordô da capa, o contrário.

export function MarcaSebratel(props: {
  /** Cor do círculo (token). */
  fundo: string;
  /** Cor da letra (token). */
  letra: string;
  className?: string;
  /** Lado em px; sem ele, quem manda é o CSS da `className`. */
  tamanho?: number;
}) {
  return (
    <svg
      className={props.className}
      width={props.tamanho}
      height={props.tamanho}
      viewBox="0 0 30 30"
      aria-hidden="true"
      style={props.tamanho ? { flex: 'none' } : undefined}
    >
      <circle cx="15" cy="15" r="14" fill={props.fundo} />
      <circle cx="15" cy="15" r="14" fill="none" stroke="var(--pbi-gold)" strokeWidth="1.5" />
      <text
        x="15"
        y="15"
        textAnchor="middle"
        dominantBaseline="central"
        fill={props.letra}
        fontSize="14"
        fontWeight="800"
        fontFamily="var(--font)"
      >
        S
      </text>
    </svg>
  );
}
