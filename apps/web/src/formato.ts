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
const dfHora = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short', timeZone: 'UTC' });

/**
 * O nível [Ano] da hierarquia de datas ("DATA INSTALADO Ano", "Data Criado Ano" — a
 * convenção do extrator é sempre terminar em " Ano") chega como `number` puro
 * (2025), e o formatador genérico aplicaria o separador de milhar do pt-BR — "2.025".
 * Ano não é quantidade: nunca leva separador de milhar.
 */
export function ehColunaDeAno(nomeDaColuna: string | null | undefined): boolean {
  return /\bano$/i.test((nomeDaColuna ?? '').trim());
}

export function formata(v: unknown, tipo: TipoDeValor, opts?: { semAgrupamento?: boolean }): Formatado {
  if (v === null || v === undefined) return { texto: '—', numerico: false, vazio: true };

  if (opts?.semAgrupamento && tipo === 'number' && Number.isInteger(v)) {
    return { texto: String(v), numerico: true, vazio: false };
  }

  if (tipo === 'date') {
    const d = new Date(v as string);
    // Data inválida não vira "Invalid Date" na tela: isso parece defeito da tela, e o
    // defeito está no dado. Dizer o valor cru é o que deixa a causa achável.
    if (Number.isNaN(d.getTime())) {
      return { texto: `data inválida: ${String(v)}`, numerico: false, vazio: false };
    }
    // Campo só-de-hora: a origem é `time`, que o snapshot grava sobre a época OLE
    // (1899-12-30). Mostrar "30/12/1899, 18:23" expõe um detalhe de armazenamento como
    // se fosse a data do dado — aqui vale só a hora. Qualquer ano <= 1900 é época, não
    // dado real desta operação.
    if (d.getUTCFullYear() <= 1900) {
      return { texto: dfHora.format(d), numerico: true, vazio: false };
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

/**
 * Uma medida de porcentagem como texto de tela.
 *
 * O relatório guarda `%` como **razão** (`0,0525`) e o Power BI a exibe multiplicada por
 * 100 (`5,25%`) — foi o que a conferência de paridade documentou. Casar com o Power BI é
 * o certo. Um valor já em escala de percentual (> 1,5, como `45`) não é multiplicado de
 * novo: só recebe o sinal.
 */
export function percentualDeRazao(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  const escala = Math.abs(v) <= 1.5 ? v * 100 : v;
  return `${nf.format(escala)}%`;
}

/** Data e hora de um ISO, para o carimbo de "dado de". */
export function dataHora(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dfh.format(d);
}

/** A partir de quantos dias sem `npm run snapshot` o carimbo vira aviso.
 *  Ver DECISAO-REALTIME.md: o dado não se atualiza sozinho, e escondê-lo
 *  é a alternativa que a decisão explicitamente recusa. */
export const LIMITE_DIAS_DADO_ATRASADO = 2;

/** Dias desde um ISO até agora — null se a data faltar ou for inválida. */
export function diasDesde(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / 86_400_000;
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
