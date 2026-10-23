// O rótulo curto de cada chip: sem o pedaço que TODOS os valores repetem.
//
// **O caso (20/10/2026).** Os 10 tipos de protocolo do relatório são "TEC - Instalação de
// Fibra", "#HR - TEC - Troca de Endereço"… — o "TEC" está em todos e não distingue nada,
// mas custava ~40px por chip e empurrava a fileira para duas linhas. O pedaço repetido é
// achado no próprio dado (partes separadas por " - "), não escrito à mão: tipo novo que
// não tenha "TEC" desliga o corte sozinho. O valor do filtro não muda — só o texto do
// chip, e o nome inteiro continua no `title`.

const SEPARADOR = ' - ';

export function rotulosCurtos(textos: readonly string[]): string[] {
  if (textos.length < 2) return [...textos];
  const partes = textos.map((t) => t.split(SEPARADOR).map((p) => p.trim()));
  const emTodos = partes[0]!.filter((p) => p !== '' && partes.every((ps) => ps.includes(p)));
  if (emTodos.length === 0) return [...textos];
  const curtos = partes.map((ps) => ps.filter((p) => !emTodos.includes(p)).join(SEPARADOR));
  // Se o corte apagar um valor inteiro, ou fizer dois valores ficarem iguais, não corta.
  if (curtos.some((c) => c === '') || new Set(curtos).size !== new Set(textos).size)
    return [...textos];
  return curtos;
}
