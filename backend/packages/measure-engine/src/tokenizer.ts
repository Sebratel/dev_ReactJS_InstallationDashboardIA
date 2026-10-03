// Tokenizer de DAX.
//
// Regras que já custaram bug em outro lugar deste projeto e por isso estão
// tratadas explicitamente:
//
// - `--` é COMENTÁRIO, não menos-menos. `//` e `/* */` também comentam.
// - `&` concatena texto; `&&` é E lógico. São precedências diferentes, então
//   não podem virar o mesmo token.
// - aspa simples delimita nome de tabela e dobra para escapar (`'O''BRIEN'`);
//   aspa dupla delimita texto e dobra do mesmo jeito (`"diz ""oi"""`).
// - colchete delimita nome de coluna/medida e aceita quase tudo dentro:
//   `[# AA MÉDIA GERAL]`, `[% EFETIVIDADE]`, `[N°PROTOCOLO]`.
//
// Toda falha carrega linha e coluna. Um avaliador que recusa a medida sem dizer
// onde é quase tão ruim quanto um que devolve número errado.

import type { Position } from './ast.ts';

export type TokenKind =
  | 'number'
  | 'string'
  /** `'NOME'` — identificador citado (tabela) */
  | 'quoted'
  /** `[NOME]` — identificador em colchete (coluna ou medida) */
  | 'bracket'
  /** identificador nu: função, variável, tabela sem aspas, enum */
  | 'ident'
  /** VAR, RETURN, IN, NOT */
  | 'keyword'
  | 'op'
  | 'punct'
  | 'eof';

export interface Token extends Position {
  kind: TokenKind;
  /** Texto do token. Para string/quoted/bracket, já sem os delimitadores e com escapes resolvidos. */
  value: string;
}

/** Palavras que mudam a estrutura da expressão, não só o valor. */
const KEYWORDS = new Set(['VAR', 'RETURN', 'IN', 'NOT']);

export class DaxSyntaxError extends Error {
  readonly line: number;
  readonly col: number;

  constructor(message: string, line: number, col: number) {
    super(`${message} (linha ${line}, coluna ${col})`);
    this.name = 'DaxSyntaxError';
    this.line = line;
    this.col = col;
  }
}

const IDENT_START = /[A-Za-z_À-ɏ]/;
const IDENT_PART = /[A-Za-z0-9_À-ɏ°]/;

/**
 * Operadores de dois caracteres — testados antes dos de um.
 *
 * `==` é igualdade ESTRITA do DAX, não um `=` repetido: sob `==` o BLANK não
 * equivale a 0 nem a `""`, enquanto sob `=` equivale. A base usa em
 * `PROTOCOLOS GERAL[CONDICAO ITEM]`. Ler como dois `=` quebra o parse.
 */
const OPS_2 = ['<>', '<=', '>=', '==', '&&', '||'];
const OPS_1 = ['+', '-', '*', '/', '^', '&', '=', '<', '>'];

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const n = source.length;

  const col = () => i - lineStart + 1;
  const fail = (msg: string): never => {
    throw new DaxSyntaxError(msg, line, col());
  };
  const push = (kind: TokenKind, value: string, start: number, startLine: number, startCol: number) => {
    tokens.push({ kind, value, start, line: startLine, col: startCol });
  };
  const advanceNewlines = (from: number, to: number) => {
    for (let k = from; k < to; k++) {
      if (source[k] === '\n') {
        line += 1;
        lineStart = k + 1;
      }
    }
  };

  while (i < n) {
    const c = source[i];

    // espaço em branco
    if (c === '\n') {
      i += 1;
      line += 1;
      lineStart = i;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
      i += 1;
      continue;
    }

    // comentários — antes dos operadores, senão `--` viraria dois menos
    if ((c === '-' && source[i + 1] === '-') || (c === '/' && source[i + 1] === '/')) {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      if (i >= n) {
        advanceNewlines(start, n);
        throw new DaxSyntaxError('comentário /* ... */ sem fechamento', line, col());
      }
      advanceNewlines(start, i);
      i += 2;
      continue;
    }

    const startLine = line;
    const startCol = col();
    const start = i;

    // número
    if (c >= '0' && c <= '9') {
      while (i < n && source[i] >= '0' && source[i] <= '9') i += 1;
      if (source[i] === '.' && source[i + 1] >= '0' && source[i + 1] <= '9') {
        i += 1;
        while (i < n && source[i] >= '0' && source[i] <= '9') i += 1;
      }
      if (source[i] === 'e' || source[i] === 'E') {
        let j = i + 1;
        if (source[j] === '+' || source[j] === '-') j += 1;
        if (source[j] >= '0' && source[j] <= '9') {
          i = j;
          while (i < n && source[i] >= '0' && source[i] <= '9') i += 1;
        }
      }
      push('number', source.slice(start, i), start, startLine, startCol);
      continue;
    }

    // texto entre aspas duplas
    if (c === '"') {
      i += 1;
      let out = '';
      for (;;) {
        if (i >= n) {
          advanceNewlines(start, n);
          throw new DaxSyntaxError('texto sem aspa dupla de fechamento', startLine, startCol);
        }
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            out += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        out += source[i];
        i += 1;
      }
      advanceNewlines(start, i);
      push('string', out, start, startLine, startCol);
      continue;
    }

    // nome de tabela entre aspas simples
    if (c === "'") {
      i += 1;
      let out = '';
      for (;;) {
        if (i >= n) {
          advanceNewlines(start, n);
          throw new DaxSyntaxError('nome sem aspa simples de fechamento', startLine, startCol);
        }
        if (source[i] === "'") {
          if (source[i + 1] === "'") {
            out += "'";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        out += source[i];
        i += 1;
      }
      advanceNewlines(start, i);
      if (out.trim() === '') {
        throw new DaxSyntaxError('nome de tabela vazio entre aspas', startLine, startCol);
      }
      push('quoted', out, start, startLine, startCol);
      continue;
    }

    // nome de coluna/medida entre colchetes
    if (c === '[') {
      const end = source.indexOf(']', i + 1);
      if (end === -1) {
        throw new DaxSyntaxError('colchete sem fechamento', startLine, startCol);
      }
      const name = source.slice(i + 1, end);
      if (name.trim() === '') {
        throw new DaxSyntaxError('nome vazio entre colchetes', startLine, startCol);
      }
      advanceNewlines(start, end);
      i = end + 1;
      push('bracket', name, start, startLine, startCol);
      continue;
    }

    // identificador nu / palavra-chave
    if (IDENT_START.test(c)) {
      while (i < n && IDENT_PART.test(source[i])) i += 1;
      const word = source.slice(start, i);
      const kind: TokenKind = KEYWORDS.has(word.toUpperCase()) ? 'keyword' : 'ident';
      push(kind, word, start, startLine, startCol);
      continue;
    }

    // operadores de dois caracteres
    const two = source.slice(i, i + 2);
    if (OPS_2.includes(two)) {
      i += 2;
      push('op', two, start, startLine, startCol);
      continue;
    }
    if (OPS_1.includes(c)) {
      i += 1;
      push('op', c, start, startLine, startCol);
      continue;
    }
    if ('(),{}.'.includes(c)) {
      i += 1;
      push('punct', c, start, startLine, startCol);
      continue;
    }

    return fail(`caractere inesperado ${JSON.stringify(c)}`);
  }

  tokens.push({ kind: 'eof', value: '', start: n, line, col: col() });
  return tokens;
}
