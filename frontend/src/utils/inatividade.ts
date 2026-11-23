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
  return { texto: textoDaAusencia(dias), tom: tomDaAusencia(dias) };
}

/** "hoje", "ontem" ou "há N dias". */
function textoDaAusencia(dias: number): string {
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  return `há ${dias} dias`;
}

/** A cor do selo: quanto mais tempo sem entrar, mais grave. */
function tomDaAusencia(dias: number): TomDeSelo {
  if (dias >= DIAS_ALERTA) return 'ruim';
  if (dias >= DIAS_ATENCAO) return 'neutro';
  return 'ok';
}
