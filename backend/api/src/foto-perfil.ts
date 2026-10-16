/** A foto vem em claim assinado do Google/Firebase e será usada pelo navegador.
 * Só HTTPS entra na sessão para não transformar o cabeçalho em conteúdo misto. */
export function fotoDePerfilSegura(valor: unknown): string | undefined {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > 2_048) return undefined;
  try {
    const url = new URL(valor);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
