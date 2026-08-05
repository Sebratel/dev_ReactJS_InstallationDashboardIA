// Valores DAX e as regras de conversão entre eles.
//
// Este arquivo é onde a paridade com o Power BI é ganha ou perdida. As regras
// abaixo não são escolhas de design: são o comportamento do DAX, e cada desvio
// aqui vira um número errado num dashboard da operação sem nenhum erro no meio
// do caminho.

/** `null` é BLANK. Não é "ausente" nem "erro": BLANK é um valor de primeira classe do DAX. */
export type DaxValue = number | string | boolean | Date | null;

export const BLANK: DaxValue = null;

/** Erro de avaliação. Carrega o que estava sendo avaliado, para a mensagem ser útil. */
export class DaxEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DaxEvalError';
  }
}

export function isBlank(v: DaxValue): boolean {
  return v === null || v === undefined;
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

/**
 * Época do número de série de data do DAX: 1899-12-30 = 0.
 *
 * Data no DAX **é** número com formato — `TODAY() + 7` é aritmética normal. Por
 * isso toda operação numérica converte data para série, em vez de tratar data
 * como tipo separado com regras próprias.
 *
 * Ressalva conhecida: Excel considera 1900 bissexto e erra em 1 dia as séries
 * antes de 1900-03-01. Os dados deste modelo começam em 2022; se algum dia
 * entrar data anterior a março de 1900, esta conversão diverge do Excel.
 */
const EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

export function serialFromDate(d: Date): number {
  return (d.getTime() - EPOCH_MS) / DAY_MS;
}

export function dateFromSerial(serial: number): Date {
  return new Date(EPOCH_MS + serial * DAY_MS);
}

/** Data pura em UTC, sem hora. Datas do modelo são meia-noite UTC. */
export function makeDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

export function isDate(v: DaxValue): v is Date {
  return v instanceof Date;
}

// ---------------------------------------------------------------------------
// Conversões
// ---------------------------------------------------------------------------

/**
 * Valor como número.
 *
 * BLANK vira 0 (`BLANK() + 1` é 1 no DAX) e booleano vira 1/0. Texto **não**
 * vira número nem quando "parece" número: várias colunas desta base chegam como
 * texto `DD/MM/YYYY`, e converter na surdina é como se produz um número errado
 * plausível. Quem quiser converter escreve `VALUE` ou `DATEVALUE`.
 */
export function toNumber(v: DaxValue, onde: string): number {
  if (isBlank(v)) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isDate(v)) return serialFromDate(v);
  throw new DaxEvalError(
    `${onde}: esperava número e recebeu o texto ${JSON.stringify(v)}. ` +
      `DAX não converte texto para número aqui. Se é uma data em texto (DD/MM/YYYY), ` +
      `converta explicitamente antes de comparar ou somar.`,
  );
}

/**
 * Valor como texto, na cultura do modelo (`pt-BR`, lida de model.tmdl).
 *
 * A cultura importa: o `&` do DAX formata número pela cultura, então 3,5 sai
 * com **vírgula**. Trocar por ponto muda o texto que aparece no cartão.
 */
export function toText(v: DaxValue): string {
  if (isBlank(v)) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (isDate(v)) return formatDatePtBr(v);
  return formatNumberPtBr(v);
}

function formatNumberPtBr(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(n).replace('.', ',');
}

function formatDatePtBr(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** Valor como booleano. BLANK é falso; 0 é falso; texto não converte. */
export function toBoolean(v: DaxValue, onde: string): boolean {
  if (isBlank(v)) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (isDate(v)) return serialFromDate(v) !== 0;
  throw new DaxEvalError(
    `${onde}: esperava condição booleana e recebeu o texto ${JSON.stringify(v)}.`,
  );
}

/** Data a partir de valor de data OU de número de série (DAX aceita os dois). */
export function toDate(v: DaxValue, onde: string): Date {
  if (isDate(v)) return v;
  if (isBlank(v)) return dateFromSerial(0);
  if (typeof v === 'number') return dateFromSerial(v);
  throw new DaxEvalError(
    `${onde}: esperava data e recebeu ${JSON.stringify(v)}. ` +
      `Texto no formato DD/MM/YYYY não é data para o DAX — use DATEVALUE.`,
  );
}

// ---------------------------------------------------------------------------
// Comparação
// ---------------------------------------------------------------------------

/**
 * Compara dois valores DAX. Devolve -1, 0 ou 1.
 *
 * `strict` distingue `==` de `=`:
 *   - sob `=`  (strict=false) BLANK equivale a 0 e a "" — `BLANK() = 0` é VERDADE
 *   - sob `==` (strict=true)  BLANK só equivale a BLANK
 *
 * Texto compara **sem distinguir caixa**, que é o collation padrão do Power BI.
 * Isso não é conveniência nossa: `'PROTOCOLOS GERAL'[ITEM] == "Sem Informação"`
 * casa com "SEM INFORMAÇÃO" no relatório atual, e um comparador case-sensitive
 * mandaria essas linhas para o ramo errado do IF.
 *
 * Texto contra número **não compara**: erra alto, em vez de escolher uma
 * conversão e devolver ordenação inventada.
 */
export function compareValues(a: DaxValue, b: DaxValue, strict: boolean, onde: string): number {
  const aBlank = isBlank(a);
  const bBlank = isBlank(b);

  if (aBlank && bBlank) return 0;

  if (aBlank || bBlank) {
    if (strict) {
      // Sob `==` o BLANK não equivale a nada além de BLANK. Devolver != 0 basta
      // para desigualdade; a ordem relativa não é usada por `==`/`<>`.
      return aBlank ? -1 : 1;
    }
    const outro = aBlank ? b : a;
    const zero: DaxValue = typeof outro === 'string' ? '' : 0;
    return aBlank
      ? compareValues(zero, b, true, onde)
      : compareValues(a, zero, true, onde);
  }

  const aText = typeof a === 'string';
  const bText = typeof b === 'string';

  if (aText && bText) {
    const x = (a as string).toLocaleLowerCase('pt-BR');
    const y = (b as string).toLocaleLowerCase('pt-BR');
    return x < y ? -1 : x > y ? 1 : 0;
  }

  if (aText !== bText) {
    throw new DaxEvalError(
      `${onde}: comparação entre texto e número (${JSON.stringify(a)} vs ${JSON.stringify(b)}). ` +
        `DAX não converte implicitamente aqui. Se um dos lados é data em texto ` +
        `(DD/MM/YYYY), converta antes — comparar direto ordena por dia.`,
    );
  }

  const x = toNumber(a, onde);
  const y = toNumber(b, onde);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function valuesEqual(a: DaxValue, b: DaxValue, strict: boolean, onde: string): boolean {
  return compareValues(a, b, strict, onde) === 0;
}

/**
 * Chave de identidade para DISTINCTCOUNT / DISTINCT.
 *
 * Usa as mesmas regras de equivalência da comparação — texto sem caixa, data
 * pela série — para que contar distintos e comparar concordem. Se divergissem,
 * `DISTINCTCOUNT` contaria "ABC" e "abc" como dois onde o `=` diz que são um.
 */
export function identityKey(v: DaxValue): string {
  if (isBlank(v)) return 'b:';
  if (typeof v === 'string') return `s:${v.toLocaleLowerCase('pt-BR')}`;
  if (typeof v === 'boolean') return `n:${v ? 1 : 0}`;
  if (isDate(v)) return `n:${serialFromDate(v)}`;
  return `n:${v}`;
}
