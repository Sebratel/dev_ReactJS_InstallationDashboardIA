// Rótulos curtos da navegação. Sem JSX, para caber em `npm test`.

/**
 * Duas letras para o ícone da barra lateral fechada, onde só cabem elas.
 *
 * O ponto separa como o espaço separa: sem isso `L.INST`, `L.MAPA` e `L.TEC` viravam
 * três ícones "L." idênticos, e a barra fechada — que é o estado de repouso — não
 * distinguia três das catorze páginas.
 */
export function sigla(nome: string): string {
  const palavras = nome.split(/[\s/&.-]+/).filter(Boolean);
  if (palavras.length === 0) return '??';
  if (palavras.length === 1) return palavras[0]!.slice(0, 2).toUpperCase();
  return (palavras[0]![0]! + palavras[1]![0]!).toUpperCase();
}
