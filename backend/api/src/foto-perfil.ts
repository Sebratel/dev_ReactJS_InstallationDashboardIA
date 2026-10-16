/** Dados visuais vêm em claims assinados do Google/Firebase e serão usados pelo navegador. */
export function fotoDePerfilSegura(valor: unknown): string | undefined {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > 2_048) return undefined;
  try {
    const url = new URL(valor);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function nomeDePerfilSeguro(valor: unknown): string | undefined {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > 160) return undefined;
  const nome = valor.trim().replace(/\s+/g, ' ');
  return nome || undefined;
}
