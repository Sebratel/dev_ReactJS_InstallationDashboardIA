// Se um número na tela é GRANDEZA (ganha barra de dados) ou só um código.
//
// Compartilhado entre Tabela.tsx e Matriz.tsx (Fase L6, §8: "data bar na célula da
// matriz" é o mesmo critério que a tabela já usa, só falta o segundo consumidor) —
// duplicar divergiria no primeiro ajuste feito só de um lado, mesmo raciocínio de
// `usa-caixa.ts` para o AutoSizer compartilhado entre Grafico.tsx e Rosca.tsx.
//
// Nem toda coluna de número é grandeza: desenhar barra num protocolo diria que
// "32.461 é quase o máximo" de coisa nenhuma. O critério é conservador — a coluna
// precisa ser numérica, ter nome de contagem/valor e variar dentro de uma ordem de
// grandeza razoável. Na dúvida, não desenha.

const NOME_DE_MEDIDA = /(qtd|quantidade|total|soma|contagem|valor|m[ée]dia|percentual|%|dias|horas)/i;

export function ehMagnitude(nome: string | null, tipo: unknown): boolean {
  return tipo === 'number' && !!nome && NOME_DE_MEDIDA.test(nome);
}

/** Largura da barra (0-70% da célula — a folga que sobra é o que deixa o texto legível). */
export function larguraDaBarra(valor: number, escala: number): number {
  return (Math.abs(valor) / escala) * 70;
}
