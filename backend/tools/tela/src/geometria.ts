// Geometria de linha — puro, sem DOM. `varre.ts` lê `getBoundingClientRect()` de cada
// `.cartao` dentro dos dois contêineres `div.flex.flex-wrap` de `VisualGridSection.tsx`
// (gráficos compactos e tabelas estreitas — os únicos lugares onde o flexbox decide o
// wrap sozinho) e passa as caixas para cá.

export interface CaixaMedida {
  id: string;
  top: number;
  height: number;
}

/**
 * Agrupa caixas cujo `top` coincide (dentro de `epsilon`) — é o que "mesma linha"
 * significa depois do wrap do flexbox, que não expõe essa informação de outro jeito.
 */
export function agrupaPorLinha(caixas: readonly CaixaMedida[], epsilon = 2): CaixaMedida[][] {
  const ordenadas = [...caixas].sort((a, b) => a.top - b.top);
  const grupos: CaixaMedida[][] = [];
  for (const caixa of ordenadas) {
    const grupo = grupos.at(-1);
    if (grupo && Math.abs(caixa.top - grupo[0]!.top) <= epsilon) {
      grupo.push(caixa);
    } else {
      grupos.push([caixa]);
    }
  }
  return grupos;
}

export interface LinhaDivergente {
  ids: string[];
  alturas: number[];
}

/** Dentro de cada linha (2+ caixas), a altura tem de ser a mesma — vem do mesmo `--util`. */
export function linhasComAlturaDivergente(grupos: readonly CaixaMedida[][], epsilon = 1): LinhaDivergente[] {
  const divergentes: LinhaDivergente[] = [];
  for (const grupo of grupos) {
    if (grupo.length < 2) continue;
    const alturas = grupo.map((c) => c.height);
    const min = Math.min(...alturas);
    const max = Math.max(...alturas);
    if (max - min > epsilon) {
      divergentes.push({ ids: grupo.map((c) => c.id), alturas });
    }
  }
  return divergentes;
}
