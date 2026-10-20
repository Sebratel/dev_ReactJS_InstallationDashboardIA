// O último acesso de uma pessoa na aba PERMISSÕES (20/10/2026): "hoje", "há 12 dias",
// "nunca" — e o tom que chama atenção para quem parou de usar (sugestão de remover).

import type { TomDeSelo } from '../components/ui/Selo.tsx';

/** A partir de quantos dias sem acesso a linha chama atenção, e a partir de quantos alerta. */
export const DIAS_ATENCAO = 30;
export const DIAS_ALERTA = 60;

export function diasSemAcesso(
  iso: string | null | undefined,
  agora: number = Date.now(),
): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((agora - Date.parse(iso)) / 86_400_000));
}

export function ultimoAcessoNaTela(
  iso: string | null | undefined,
  agora: number = Date.now(),
): { texto: string; tom: TomDeSelo } {
  const dias = diasSemAcesso(iso, agora);
  if (dias === null) return { texto: 'nunca', tom: 'apagado' };
  const texto = dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`;
  return { texto, tom: dias >= DIAS_ALERTA ? 'ruim' : dias >= DIAS_ATENCAO ? 'neutro' : 'ok' };
}
