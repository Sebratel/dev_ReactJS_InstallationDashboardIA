/** Ferramentas estatísticas pequenas, sem dependência. */

export type Aleatorio = () => number;

export function quantil(valores: readonly number[], q: number): number | null {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q;
  const i = Math.floor(pos);
  const f = pos - i;
  return v[i + 1] === undefined ? v[i] : v[i] + f * (v[i + 1] - v[i]);
}

export const mediana = (v: readonly number[]): number | null => quantil(v, 0.5);
export const soma = (v: readonly number[]): number => v.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);

/**
 * Gerador pseudoaleatório com semente (mulberry32). A semente é o dia: a projeção não
 * "pula" a cada atualização da tela com os mesmos dados de entrada.
 */
export function gerador(semente: string): Aleatorio {
  let a = [...semente].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 7);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Poisson por inversão (λ pequeno, que é o caso: protocolos por técnico-dia). */
export function poisson(lambda: number, aleatorio: Aleatorio): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= aleatorio();
  } while (p > L && k < 200);
  return k - 1;
}

/** Gama (Marsaglia–Tsang), para dar à taxa diária a variação que a Poisson sozinha não tem. */
export function gama(forma: number, escala: number, aleatorio: Aleatorio): number {
  if (forma < 1) return gama(forma + 1, escala, aleatorio) * Math.pow(aleatorio(), 1 / forma);
  const d = forma - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = Math.sqrt(-2 * Math.log(aleatorio() || 1e-12)) * Math.cos(2 * Math.PI * aleatorio());
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = aleatorio();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * escala;
  }
}

/** Intervalo de 90% da mediana por reamostragem. */
export function icMediana(valores: readonly number[], aleatorio: Aleatorio, reamostras = 400): [number | null, number | null] {
  if (valores.length < 3) return [null, null];
  const meds: number[] = [];
  for (let i = 0; i < reamostras; i++) {
    const am = Array.from({ length: valores.length }, () => valores[Math.floor(aleatorio() * valores.length)]);
    meds.push(mediana(am) ?? 0);
  }
  return [quantil(meds, 0.05), quantil(meds, 0.95)];
}

export const arred = (x: number | null | undefined, casas = 0): number | null =>
  x !== null && x !== undefined && Number.isFinite(x) ? Number(x.toFixed(casas)) : null;
