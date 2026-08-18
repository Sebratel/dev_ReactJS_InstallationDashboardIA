// Como um valor vira texto na tela.
//
// **Sem JSX de propósito.** Este módulo é a única parte da tela que decide o que a
// pessoa lê, e ele roda em `npm test` junto com as engines — `node --test` executa
// TypeScript direto, mas não JSX. Manter a decisão aqui e o desenho no `.tsx` é o
// que permite testar a decisão sem montar um DOM.
//
// **O tipo vem do servidor, e não se adivinha aqui.** JSON não tem data: sem o tipo
// por coluna, `"2026-03-15T00:00:00.000Z"` e um protocolo que por acaso se pareça com
// uma data seriam indistinguíveis. Adivinhar pelo formato do texto transformaria o
// segundo numa data — número errado plausível, que é o erro que este projeto não pode
// cometer.

/** O tipo que a API manda junto de cada valor. `null` é BLANK. */
export type TipoDeValor = 'number' | 'string' | 'boolean' | 'date' | null;

export interface Formatado {
  texto: string;
  /** Alinhar à direita e usar algarismo tabular. */
  numerico: boolean;
  /** É BLANK — a tela pinta em cinza de "sem dado", nunca em vermelho. */
  vazio: boolean;
}

const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const nfInt = new Intl.NumberFormat('pt-BR');
// UTC em todos: o snapshot grava instante, e formatar no fuso local faria a mesma
// data virar o dia anterior para quem estivesse a oeste de Greenwich.
const df = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' });
const dfh = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export function formata(v: unknown, tipo: TipoDeValor): Formatado {
  if (v === null || v === undefined) return { texto: '—', numerico: false, vazio: true };

  if (tipo === 'date') {
    const d = new Date(v as string);
    // Data inválida não vira "Invalid Date" na tela: isso parece defeito da tela, e o
    // defeito está no dado. Dizer o valor cru é o que deixa a causa achável.
    if (Number.isNaN(d.getTime())) {
      return { texto: `data inválida: ${String(v)}`, numerico: false, vazio: false };
    }
    // Meia-noite exata é data pura; qualquer hora e a hora importa. É o que separa
    // "10/08/2026" de "10/08/2026 09:08" no mesmo card.
    const soData = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
    return { texto: (soData ? df : dfh).format(d), numerico: true, vazio: false };
  }

  if (tipo === 'number') {
    const n = v as number;
    return {
      texto: Number.isInteger(n) ? nfInt.format(n) : nf.format(n),
      numerico: true,
      vazio: false,
    };
  }

  if (tipo === 'boolean') return { texto: v ? 'Sim' : 'Não', numerico: false, vazio: false };

  return { texto: String(v), numerico: false, vazio: false };
}

/** Inteiro com separador de milhar — contagens de linha, totais, etc. */
export function inteiro(n: number): string {
  return nfInt.format(n);
}

/** Data e hora de um ISO, para o carimbo de "dado de". */
export function dataHora(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dfh.format(d);
}

/**
 * Duração em ms, na unidade que cabe.
 *
 * Uma página desta base leva de 40 ms a 104 minutos. "6240000 ms" é ilegível
 * exatamente no caso em que o número importa.
 */
export function duracao(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const min = Math.floor(ms / 60_000);
  const seg = Math.round((ms % 60_000) / 1000);
  return `${min} min ${String(seg).padStart(2, '0')} s`;
}
