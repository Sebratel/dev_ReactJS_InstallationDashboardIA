// Corta o `order by` de APRESENTAÇÃO de um SQL, e só ele.
//
// Mora num módulo próprio porque a sonda que o usa abre conexão no topo do
// arquivo: importar a sonda para testar a função conectaria no banco a cada
// `npm test`.
//
// A DISTINÇÃO QUE ELE FAZ, e por que ela não é preciosismo: um `order by` dentro
// de `row_number() over (...)` ou de subconsulta É semântica — é ele que escolhe
// qual linha sobrevive a um dedup. (Neste repositório essa ordem já custou um
// achado inteiro: o desempate "contrato antes de active" das queries de
// protocolo.) Arrancá-lo não mede a mesma query mais barata: mede outra query.
// Só o `order by` do topo, fora de qualquer parêntese, é ordenação de saída.

/**
 * Devolve o SQL sem o `order by` de topo, e se havia um.
 *
 * Reconhece o de topo pela única propriedade que o distingue sem um parser de
 * verdade: dali até o fim do texto os parênteses fecham em equilíbrio e nenhum
 * fecha antes de abrir. Um `order by` dentro de parêntese sempre fere isso.
 */
export function semOrdemDeTopo(texto: string): { sql: string; achou: boolean } {
  const re = /\border\s+by\b/gi;
  let ultimo = -1;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const resto = texto.slice(m.index);
    let saldo = 0;
    let equilibrado = true;
    for (const c of resto) {
      if (c === '(') saldo++;
      else if (c === ')') saldo--;
      if (saldo < 0) {
        equilibrado = false;
        break;
      }
    }
    if (equilibrado && saldo === 0) ultimo = m.index;
  }
  if (ultimo < 0) return { sql: texto, achou: false };
  return { sql: texto.slice(0, ultimo).trimEnd(), achou: true };
}
