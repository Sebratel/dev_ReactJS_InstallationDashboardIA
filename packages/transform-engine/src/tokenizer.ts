// Tokenizer de M (Power Query).
//
// As regras abaixo são as que diferem do DAX e por isso estão explícitas — trocar
// uma por "acho que é igual" produz parse que funciona em 22 queries e erra na 23ª:
//
// - **String usa `""` para escapar**, como no DAX. Mas o conteúdo aqui costuma ser
//   SQL inteiro, com `--`, `{`, `(`, vírgula e acento. Nada disso pode ser lido
//   como sintaxe M.
// - **`--` NÃO é comentário em M** (é no DAX). Comentário é `//` e `/* */`. Ler
//   `--` como comentário engoliria metade de todo `Odbc.Query` da base.
// - **`#"nome com espaço"`** é identificador citado: é assim que 100% dos nomes de
//   passo aparecem (`#"Tipo Alterado"`). E `#date`, `#datetime`, `#duration`,
//   `#datetimezone` são construtores — mesmo prefixo `#`, outra coisa.
// - **`[Coluna]` não é token único.** No DAX o colchete inteiro é o nome da
//   coluna; em M `[` abre registro *ou* acesso a campo, e o que vem dentro pode
//   ser `#"nome"` ou vários campos. Quem resolve é o parser.
// - **`=` é igualdade E atribuição.** Não existe `==` em M.
// - **`&` é concatenação** e não tem irmão `&&`: o "e" lógico é a palavra `and`.
//
// Toda falha carrega linha e coluna, pelo mesmo motivo do tokenizer de DAX: um
// engine que recusa a query sem dizer onde é quase tão ruim quanto um que devolve
// número errado.

import type { Position } from './ast.ts';

export type MTokenKind =
  | 'number'
  | 'string'
  /** identificador, já sem `#"`…`"`; inclui os pontuados (`Table.AddColumn`) */
  | 'ident'
  /** palavra que muda a estrutura: let, in, each, if, then, else, and, or, not, type… */
  | 'keyword'
  /** `#date`, `#datetime`, `#datetimezone`, `#duration`, `#time`, `#table`, `#binary` */
  | 'intrinsic'
  | 'op'
  | 'punct'
  | 'eof';

export interface MToken extends Position {
  readonly kind: MTokenKind;
  /** Texto do token; para string e identificador citado, já sem delimitador. */
  readonly value: string;
  /** Só para `ident`: veio de `#"..."`. Um nome citado nunca é palavra-chave. */
  readonly quoted?: boolean;
}

/**
 * Palavras reservadas do M que aparecem no corpus, mais as que mudariam o parse
 * se aparecessem. `try`/`otherwise` estão aqui apesar de não ocorrerem: se um dia
 * alguém editar o Power Query e usá-las, quero erro de "não implementado" no
 * avaliador, e não um `Identifier` chamado "try" atravessando tudo em silêncio.
 */
const KEYWORDS = new Set([
  'let', 'in', 'each', 'if', 'then', 'else', 'and', 'or', 'not',
  'true', 'false', 'null', 'type', 'as', 'is', 'meta',
  'try', 'otherwise', 'section', 'shared', 'nullable', 'optional',
]);

const INTRINSICS = new Set([
  '#date', '#datetime', '#datetimezone', '#duration', '#time', '#table', '#binary',
  '#infinity', '#nan', '#sections', '#shared',
]);

export class MSyntaxError extends Error {
  readonly line: number;
  readonly col: number;

  constructor(message: string, line: number, col: number) {
    super(`${message} (linha ${line}, coluna ${col})`);
    this.name = 'MSyntaxError';
    this.line = line;
    this.col = col;
  }
}

// Identificador M aceita letra acentuada: a base tem passo `#"Personalização
// Adicionada"` e coluna `ÁREA`. Sem o range acentuado, `Ç` viraria token solto.
const IDENT_START = /[A-Za-z_À-ɏ]/;
const IDENT_PART = /[A-Za-z0-9_À-ɏ°]/;

/** Dois caracteres primeiro, senão `>=` seria lido como `>` e `=`. */
const OPS_2 = ['<>', '<=', '>=', '=>'];
const OPS_1 = ['+', '-', '*', '/', '&', '=', '<', '>'];

export function tokenize(source: string): MToken[] {
  const tokens: MToken[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const n = source.length;

  const col = (): number => i - lineStart + 1;
  const fail = (msg: string): never => {
    throw new MSyntaxError(msg, line, col());
  };
  const push = (kind: MTokenKind, value: string, p: Position, quoted?: boolean): void => {
    tokens.push(quoted === undefined ? { kind, value, ...p } : { kind, value, quoted, ...p });
  };
  const here = (): Position => ({ start: i, line, col: col() });

  while (i < n) {
    const c = source[i];

    // ── espaço ─────────────────────────────────────────────────────────────
    if (c === '\n') {
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }

    // ── comentário: `//` e `/* */`, nunca `--` ─────────────────────────────
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const inicio = here();
      i += 2;
      for (;;) {
        if (i >= n) {
          throw new MSyntaxError('Comentário /* */ não fechado.', inicio.line, inicio.col);
        }
        if (source[i] === '*' && source[i + 1] === '/') {
          i += 2;
          break;
        }
        if (source[i] === '\n') {
          line++;
          lineStart = i + 1;
        }
        i++;
      }
      continue;
    }

    // ── string ─────────────────────────────────────────────────────────────
    if (c === '"') {
      const p = here();
      const { texto, fim } = leString(source, i, p);
      i = fim;
      push('string', texto, p);
      continue;
    }

    // ── `#"nome citado"`, `#date(...)`, `#table(...)` ──────────────────────
    if (c === '#') {
      const p = here();
      if (source[i + 1] === '"') {
        const { texto, fim } = leString(source, i + 1, p);
        i = fim;
        // Nome citado é sempre identificador, mesmo escrito `#"let"`.
        push('ident', texto, p, true);
        continue;
      }
      let j = i + 1;
      while (j < n && IDENT_PART.test(source[j])) j++;
      const palavra = source.slice(i, j);
      if (!INTRINSICS.has(palavra)) {
        fail(`\`${palavra}\` não é construtor M conhecido (esperado #date, #datetime, #table…).`);
      }
      i = j;
      push('intrinsic', palavra, p);
      continue;
    }

    // ── número ─────────────────────────────────────────────────────────────
    // M aceita `1.5`, `1e3` e hexadecimal `0x1F`. Nenhum sinal aqui: `-1` é
    // unário sobre `1`, e tratar o sinal no número quebraria `a-1`.
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const p = here();
      let j = i;
      if (c === '0' && (source[i + 1] === 'x' || source[i + 1] === 'X')) {
        j = i + 2;
        while (j < n && /[0-9a-fA-F]/.test(source[j])) j++;
      } else {
        while (j < n && /[0-9]/.test(source[j])) j++;
        if (source[j] === '.' && /[0-9]/.test(source[j + 1] ?? '')) {
          j++;
          while (j < n && /[0-9]/.test(source[j])) j++;
        }
        if (source[j] === 'e' || source[j] === 'E') {
          let k = j + 1;
          if (source[k] === '+' || source[k] === '-') k++;
          if (/[0-9]/.test(source[k] ?? '')) {
            j = k;
            while (j < n && /[0-9]/.test(source[j])) j++;
          }
        }
      }
      const texto = source.slice(i, j);
      i = j;
      push('number', texto, p);
      continue;
    }

    // ── identificador ou palavra-chave ─────────────────────────────────────
    if (IDENT_START.test(c)) {
      const p = here();
      let j = i;
      // Nome pontuado é um token só: `Table.AddColumn`, `Int64.Type`,
      // `JoinKind.LeftOuter`. Separar em `Table` `.` `AddColumn` obrigaria o
      // parser a remontar, e `Int64.Type` não é acesso a campo de nada.
      for (;;) {
        while (j < n && IDENT_PART.test(source[j])) j++;
        if (source[j] === '.' && IDENT_START.test(source[j + 1] ?? '')) {
          j++;
          continue;
        }
        break;
      }
      const palavra = source.slice(i, j);
      i = j;
      push(KEYWORDS.has(palavra) ? 'keyword' : 'ident', palavra, p);
      continue;
    }

    // ── operador ───────────────────────────────────────────────────────────
    const dois = source.slice(i, i + 2);
    if (OPS_2.includes(dois)) {
      const p = here();
      i += 2;
      push('op', dois, p);
      continue;
    }
    if (OPS_1.includes(c)) {
      const p = here();
      i++;
      push('op', c, p);
      continue;
    }
    if ('(),{}[]?'.includes(c)) {
      const p = here();
      i++;
      push('punct', c, p);
      continue;
    }
    // `..` não aparece no corpus; se aparecer, o erro diz o quê e onde.
    if (c === '.') fail('`.` solto — faixa `..` não é suportada.');

    fail(`Caractere inesperado \`${c}\`.`);
  }

  tokens.push({ kind: 'eof', value: '', start: n, line, col: col() });
  return tokens;
}

/**
 * Lê a string que abre em `abre`. Devolve o conteúdo já com `""` resolvido e o
 * índice logo após a aspa final.
 *
 * Não conta linha aqui: o chamador não precisa, porque nenhuma string da base
 * termina antes de uma quebra que importe para posição — e o SQL multilinha
 * dentro dela deslocaria a contagem sem ganho nenhum. O `start` do token já
 * aponta o começo.
 */
function leString(src: string, abre: number, p: Position): { texto: string; fim: number } {
  let i = abre + 1;
  let out = '';
  while (i < src.length) {
    if (src[i] === '"') {
      if (src[i + 1] === '"') {
        out += '"';
        i += 2;
        continue;
      }
      return { texto: out, fim: i + 1 };
    }
    out += src[i];
    i++;
  }
  throw new MSyntaxError('String não fechada.', p.line, p.col);
}
