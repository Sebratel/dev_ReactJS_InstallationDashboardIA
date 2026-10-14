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

export function isBlank(v: DaxValue): v is null {
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
 * Texto também compara **sem os espaços do fim**, como o VertiPaq: no motor do Power BI
 * "X" e "X " são o mesmo valor. A fonte traz espaço no fim em dezenas de colunas — o
 * tipo "TEC - Instalação de Roteador Adicional " vem assim do Voalle, e o filtro do
 * relatório, escrito sem o espaço, esvaziava as tabelas de ponto adicional da
 * premiação. Espaço do INÍCIO continua contando, como lá.
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
    const x = textoComparavel(a as string);
    const y = textoComparavel(b as string);
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

/** Forma de comparar texto: sem caixa e sem os espaços do fim — ver `compareValues`. */
function textoComparavel(s: string): string {
  return s.replace(/ +$/, '').toLocaleLowerCase('pt-BR');
}

export function valuesEqual(a: DaxValue, b: DaxValue, strict: boolean, onde: string): boolean {
  return compareValues(a, b, strict, onde) === 0;
}

/**
 * Chave de identidade para DISTINCTCOUNT / DISTINCT — memoizada por tipo.
 *
 * Usa as mesmas regras de equivalência da comparação — texto sem caixa, data
 * pela série — para que contar distintos e comparar concordem. Se divergissem,
 * `DISTINCTCOUNT` contaria "ABC" e "abc" como dois onde o `=` diz que são um.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUE HÁ UM CACHE AQUI, E POR QUE ELE É POR TIPO
 *
 * Medido em 13/09/2026, instrumentando esta função nas 14 páginas reais:
 *
 * ```
 * chamadas .............. 118.941.152     texto 58,7%, data 20,9%, branco 19,5%
 * valores DISTINTOS .....     644.219
 * acerto de um cache ....      99,46%
 * ```
 *
 * Cada chamada alocava uma string nova — 118 milhões delas —, e no texto ainda
 * passava por `toLocaleLowerCase`, que é sensível a locale e bem mais caro que um
 * `toLowerCase`. Era 4,8% do tempo de CPU da plataforma, mais a parte do coletor de
 * lixo que esse lixo todo paga.
 *
 * **Um `Map` só, chaveado pelo valor, estaria ERRADO para data.** Chave de `Map` é
 * SameValueZero, que para objeto é identidade de REFERÊNCIA: duas `Date` do mesmo
 * instante são chaves diferentes. No caminho colunar isso quase funcionaria por
 * acidente — o dicionário guarda uma instância por valor distinto —, mas no caminho
 * de objetos cada linha tem a sua, e o cache cresceria uma entrada por LINHA sem
 * nunca acertar. Um cache que vira vazamento só no caminho que não estou medindo é
 * exatamente o tipo de defeito que este projeto recusa. Por isso a data entra
 * chaveada por `getTime()`, que é número.
 *
 * **E por que há um teto.** Diferente de `normalizeName`, o argumento aqui é VALOR
 * DE LINHA — o domínio cresce com o dado, não com o catálogo. O teto é o que separa
 * "cache" de "vazamento": passando dele a função continua **correta**, só volta a
 * calcular.
 *
 * **O custo de memória, MEDIDO e não estimado** (13/09/2026, as 14 páginas num
 * processo, heap com os caches menos heap depois de esvaziá-los):
 *
 * ```
 * 644.219 entradas .......... 77,2 MB
 *   as strings guardadas .... 29,9 MB
 *   escrituração do Map ..... 47,3 MB   <- é aqui que a memória vai
 * ```
 *
 * O peso está no `Map`, não no tamanho das strings — por isso NÃO adianta cachear só
 * valor curto: cortar tudo acima de 64 caracteres pouparia 17 MB dos 77 e perderia
 * 94 mil entradas. O custo escala com a CARDINALIDADE, e é ela que o teto limita.
 *
 * 1.000.000 é ~1,5x os 644 mil distintos observados; no teto a conta acima dá ~120
 * MB. É uma fração dos 2,2 GB que o armazenamento colunar liberou, e é uma troca
 * escolhida de olho aberto — não um efeito colateral.
 *
 * **Booleano e nulo não entram** — `b:`, `n:0` e `n:1` são três literais que o V8
 * já internou. Cachear custaria mais que devolver.
 * ───────────────────────────────────────────────────────────────────────────
 */
const CHAVE_TEXTO = new Map<string, string>();
const CHAVE_NUMERO = new Map<number, string>();
/** Chaveado por `getTime()`, não pela `Date` — ver a nota acima. */
const CHAVE_DATA = new Map<number, string>();
const TETO_DE_CHAVES = 1_000_000;

/**
 * As chaves de identidade de um dicionário de coluna, calculadas UMA VEZ por
 * coluna e compartilhadas por todos os leitores dela.
 *
 * **Sem o compartilhamento o ganho vira estouro de memória, e foi o que
 * aconteceu.** A primeira versão guardava o array dentro do fecho do leitor, e
 * `filtrosDaChave` monta um filtro por COMBINAÇÃO do eixo: numa coluna de alta
 * cardinalidade isso são `combinações x distintos` strings vivas ao mesmo tempo. A
 * paridade das 14 páginas morreu com `heap out of memory` em 8 GB na quarta página
 * (14/09/2026) — e o pior é que acima do TETO_DE_CHAVES cada leitor alocava strings
 * NOVAS, então nem a memoização acima segurava.
 *
 * A chave do `WeakMap` é o array de valores distintos, que é estável enquanto a
 * coluna existir e é trocado por `TabelaColunar.mapeia` — quem converte o tipo da
 * coluna ganha um array novo e, com ele, chaves novas. Fraco para a tabela poder
 * ser descarregada.
 *
 * **Isto NÃO tem teto**, ao contrário do cache acima, e de propósito: o domínio
 * aqui é o dos valores distintos de UMA coluna, que já está materializada em
 * memória. Guardar a chave de cada um custa menos que o dicionário que os guarda.
 */
const CHAVES_DO_DICIONARIO = new WeakMap<readonly DaxValue[], string[]>();

export function chavesDoDicionario(valores: readonly DaxValue[]): string[] {
  const pronto = CHAVES_DO_DICIONARIO.get(valores);
  if (pronto) return pronto;
  const out = new Array<string>(valores.length);
  for (let i = 0; i < valores.length; i++) out[i] = identityKey(valores[i] as DaxValue);
  CHAVES_DO_DICIONARIO.set(valores, out);
  return out;
}

export function identityKey(v: DaxValue): string {
  if (isBlank(v)) return 'b:';

  if (typeof v === 'string') {
    const memo = CHAVE_TEXTO.get(v);
    if (memo !== undefined) return memo;
    const out = `s:${textoComparavel(v)}`;
    if (CHAVE_TEXTO.size < TETO_DE_CHAVES) CHAVE_TEXTO.set(v, out);
    return out;
  }

  if (typeof v === 'boolean') return v ? 'n:1' : 'n:0';

  if (isDate(v)) {
    const t = v.getTime();
    const memo = CHAVE_DATA.get(t);
    if (memo !== undefined) return memo;
    const out = `n:${serialFromDate(v)}`;
    if (CHAVE_DATA.size < TETO_DE_CHAVES) CHAVE_DATA.set(t, out);
    return out;
  }

  const memo = CHAVE_NUMERO.get(v);
  if (memo !== undefined) return memo;
  const out = `n:${v}`;
  if (CHAVE_NUMERO.size < TETO_DE_CHAVES) CHAVE_NUMERO.set(v, out);
  return out;
}
