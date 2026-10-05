// A parte pura de `entrada.ts`: em que ordem medir e o que é "passou".
//
// O critério é o de `docs/PLANO-CARREGAMENTO.md` §0–§1 (Erick, 05/10/2026): a
// `agendamento-field` (VISÃO PRODUTIVA) é a página nº 1 e abre em ≤ 1 s; as análises
// detalhadas, em ≤ 2 s; e nenhuma mostra "carregando…" ao entrar — sem carga rodando
// ou com uma carga gravando o snapshot.

/** A página que manda: medida primeiro, com a meta mais apertada. */
export const PAGINA_PRINCIPAL = 'agendamento-field';

export const META_PRINCIPAL_MS = 1000;
export const META_DEMAIS_MS = 2000;

export interface Medida {
  pagina: string;
  /** Até o HTML da tela chegar (`domcontentloaded`); `null` = não chegou no teto. */
  htmlMs: number | null;
  /** Até o `.selo` do modo conferência, que só aparece com a página calculada; `null` = não ficou pronta. */
  prontaMs: number | null;
  /** Quantas vezes "carregando" aparece no texto da página quando ela fica pronta. */
  carregando: number;
}

export interface Veredito extends Medida {
  metaMs: number;
  passou: boolean;
  motivo: string | null;
}

/** A principal primeiro; as outras na ordem em que vieram. */
export function ordemDeMedida(paginas: readonly string[]): string[] {
  return paginas.includes(PAGINA_PRINCIPAL)
    ? [PAGINA_PRINCIPAL, ...paginas.filter((p) => p !== PAGINA_PRINCIPAL)]
    : [...paginas];
}

export function metaDe(pagina: string): number {
  return pagina === PAGINA_PRINCIPAL ? META_PRINCIPAL_MS : META_DEMAIS_MS;
}

export function avalia(m: Medida): Veredito {
  const metaMs = metaDe(m.pagina);
  let motivo: string | null = null;
  if (m.htmlMs === null) motivo = 'a tela nem chegou';
  else if (m.prontaMs === null) motivo = 'não ficou pronta';
  else if (m.prontaMs > metaMs) motivo = `${m.prontaMs} ms > ${metaMs} ms`;
  else if (m.carregando > 0) motivo = `"carregando" ×${m.carregando}`;
  return { ...m, metaMs, passou: motivo === null, motivo };
}

/** Resumo de uma página medida em várias rodadas: o pior caso é o que o usuário sente. */
export function resume(vereditos: readonly Veredito[]): {
  pagina: string;
  rodadas: number;
  reprovadas: number;
  piorMs: number | null;
  medianaMs: number | null;
} {
  const prontas = vereditos.map((v) => v.prontaMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const naoProntas = vereditos.length - prontas.length;
  return {
    pagina: vereditos[0]?.pagina ?? '',
    rodadas: vereditos.length,
    reprovadas: vereditos.filter((v) => !v.passou).length,
    // Uma rodada que não ficou pronta é o pior caso possível, e ele não tem número.
    piorMs: naoProntas > 0 ? null : (prontas.at(-1) ?? null),
    medianaMs: prontas.length ? prontas[Math.floor(prontas.length / 2)]! : null,
  };
}
