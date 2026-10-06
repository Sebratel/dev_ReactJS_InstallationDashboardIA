// O CSV que a tabela e a matriz exportam. Eram duas cópias da mesma montagem.
//
// Ponto e vírgula e não vírgula, e o BOM na frente: é o que o Excel em português abre
// direto, com acento e com o número na coluna certa.

const aspas = (texto: string): string => `"${texto.replace(/"/g, '""')}"`;

/** O conteúdo do arquivo: BOM, cabeçalho e uma linha por registro, tudo entre aspas. */
export function textoCsv(cabecalho: readonly string[], linhas: readonly (readonly string[])[]): string {
  const corpo = linhas.map((l) => l.map(aspas).join(';')).join('\n');
  return `\uFEFF${cabecalho.map(aspas).join(';')}\n${corpo}`;
}

/** Entrega o arquivo ao navegador, como um download. */
export function baixaCsv(nomeDoArquivo: string, conteudo: string): void {
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', nomeDoArquivo);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
