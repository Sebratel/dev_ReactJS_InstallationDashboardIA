// Ícones como SVG inline, com nome em português.
//
// **Sem emoji, em nenhum lugar** — nem herdado do relatório de origem. Emoji renderiza
// diferente por sistema operacional e destrói o alinhamento vertical: `▲`/`▼`/`⇅` num
// cabeçalho de tabela saem em alturas diferentes no Windows e no macOS, e `📥` num botão
// muda a altura da linha inteira. O que já vem do `lucide-react` continua valendo — é
// SVG também; aqui ficam só os que o lucide não cobre bem no tamanho de 8–10px.

export function SetaDeOrdem({ ativa, desc }: { ativa: boolean; desc: boolean }) {
  // Inativa: as duas pontas, apagadas — o cabeçalho diz que dá para ordenar sem
  // afirmar uma direção. Ativa: só a ponta da direção em vigor.
  return (
    <svg
      className="icone-ordem"
      width="8"
      height="10"
      viewBox="0 0 8 10"
      aria-hidden="true"
      style={{ opacity: ativa ? 1 : 0.45 }}
    >
      {(!ativa || !desc) && <path fill="currentColor" d="M4 0 8 4H0z" />}
      {(!ativa || desc) && <path fill="currentColor" d="M4 10 0 6h8z" />}
    </svg>
  );
}

/** Duas setas opostas: a troca de orientação da matriz. */
export function Transpor() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.4" d="M1 3.5h8M6.5 1 9.5 3.5 6.5 6M11 8.5H3M5.5 6 2.5 8.5 5.5 11" />
    </svg>
  );
}

/** Barra vertical + seta: ir para a primeira janela. */
export function Primeira() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path fill="currentColor" d="M2 2h1.6v8H2z" />
      <path fill="currentColor" d="M10 2 4.8 6l5.2 4z" />
    </svg>
  );
}
