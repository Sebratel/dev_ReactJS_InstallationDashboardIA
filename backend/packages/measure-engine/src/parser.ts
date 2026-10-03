// Parser de DAX (precedência por Pratt) -> AST.
//
// Cobre o subconjunto que as 78 medidas e 43 colunas calculadas desta base usam.
// Não pretende ser um parser de DAX completo, e é honesto sobre isso: o que não
// reconhece vira `DaxSyntaxError` com linha e coluna, nunca um palpite.
//
// Precedência, do mais fraco ao mais forte (igual ao DAX):
//   ||  <  &&  <  = <> < <= > >= IN  <  &  <  + -  <  * /  <  ^  <  unário  <  .[Parte]
//
// `^` associa à direita; o resto, à esquerda.

import type {
  BinaryOp,
  DaxNode,
  Position,
  VarDeclaration,
} from './ast.ts';
import { DaxSyntaxError, tokenize, type Token } from './tokenizer.ts';

const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '=': 3,
  // igualdade estrita: sob `==` o BLANK não equivale a 0 nem a ""
  '==': 3,
  '<>': 3,
  '<': 3,
  '<=': 3,
  '>': 3,
  '>=': 3,
  IN: 3,
  '&': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '^': 7,
};

/** `-x` e `+x` ligam mais forte que qualquer binário: `-2^2` é `(-2)^2`, como no Excel. */
const SIGN_PRECEDENCE = 8;

/**
 * `NOT` liga mais fraco que comparação e mais forte que `&&` — a precedência do
 * DAX. Então `NOT a = b` é `NOT (a = b)`, e `NOT a && b` é `(NOT a) && b`.
 *
 * Todo `NOT` desta base vem parentizado (`NOT(ISBLANK(x))`, `NOT(x IN {...})`),
 * então nenhuma medida depende desta escolha hoje. Está aqui certo para quando
 * alguém escrever sem parênteses.
 */
const NOT_OPERAND_PRECEDENCE = 3;

class Parser {
  private readonly tokens: Token[];
  private pos = 0;

  constructor(source: string) {
    this.tokens = tokenize(source);
  }

  // ------------------------------------------------------------- utilitários
  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    const t = this.peek();
    if (t.kind !== 'eof') this.pos += 1;
    return t;
  }

  private at(kind: Token['kind'], value?: string): boolean {
    const t = this.peek();
    if (t.kind !== kind) return false;
    if (value === undefined) return true;
    return kind === 'keyword' || kind === 'ident'
      ? t.value.toUpperCase() === value.toUpperCase()
      : t.value === value;
  }

  private expect(kind: Token['kind'], value?: string): Token {
    if (!this.at(kind, value)) {
      const t = this.peek();
      const esperado = value ?? kind;
      const achado = t.kind === 'eof' ? 'fim da expressão' : JSON.stringify(t.value);
      throw new DaxSyntaxError(`esperava ${esperado} e achei ${achado}`, t.line, t.col);
    }
    return this.next();
  }

  private posOf(t: Token): Position {
    return { start: t.start, line: t.line, col: t.col };
  }

  private fail(t: Token, msg: string): never {
    throw new DaxSyntaxError(msg, t.line, t.col);
  }

  // ------------------------------------------------------------- ponto de entrada
  parseProgram(): DaxNode {
    if (this.peek().kind === 'eof') {
      const t = this.peek();
      throw new DaxSyntaxError('expressão vazia', t.line, t.col);
    }
    const node = this.parseExpression(0);
    const rest = this.peek();
    if (rest.kind !== 'eof') {
      this.fail(rest, `sobrou ${JSON.stringify(rest.value)} depois do fim da expressão`);
    }
    return node;
  }

  // ------------------------------------------------------------- expressões
  private parseExpression(minPrecedence: number): DaxNode {
    // VAR/RETURN pode abrir uma expressão em qualquer posição, inclusive dentro
    // de argumento de função — é DAX válido e a base usa.
    if (this.at('keyword', 'VAR')) return this.parseVarBlock();

    let left = this.parseUnary();

    for (;;) {
      const t = this.peek();
      let op: string | null = null;
      if (t.kind === 'op' && PRECEDENCE[t.value] !== undefined) op = t.value;
      else if (t.kind === 'keyword' && t.value.toUpperCase() === 'IN') op = 'IN';
      if (op === null) break;

      const precedence = PRECEDENCE[op];
      if (precedence < minPrecedence) break;

      this.next();

      if (op === 'IN') {
        const source = this.parseExpression(precedence + 1);
        left = { type: 'In', value: left, source, pos: this.posOf(t) };
        continue;
      }

      // `^` associa à direita: 2^3^2 = 2^(3^2)
      const nextMin = op === '^' ? precedence : precedence + 1;
      const right = this.parseExpression(nextMin);
      left = { type: 'Binary', op: op as BinaryOp, left, right, pos: this.posOf(t) };
    }

    return left;
  }

  private parseVarBlock(): DaxNode {
    const first = this.peek();
    const vars: VarDeclaration[] = [];

    while (this.at('keyword', 'VAR')) {
      const varTok = this.next();
      const nameTok = this.peek();
      // Nome de variável é identificador nu. `VAR RETURN = 1` não existe.
      if (nameTok.kind !== 'ident') {
        this.fail(nameTok, `esperava nome de variável depois de VAR e achei ${JSON.stringify(nameTok.value)}`);
      }
      this.next();
      this.expect('op', '=');
      const expr = this.parseExpression(0);
      vars.push({ name: nameTok.value, expr, pos: this.posOf(varTok) });
    }

    if (!this.at('keyword', 'RETURN')) {
      const t = this.peek();
      this.fail(
        t,
        `bloco VAR sem RETURN — achei ${t.kind === 'eof' ? 'fim da expressão' : JSON.stringify(t.value)}`,
      );
    }
    this.next();
    const body = this.parseExpression(0);
    return { type: 'VarBlock', vars, body, pos: this.posOf(first) };
  }

  private parseUnary(): DaxNode {
    const t = this.peek();
    if (t.kind === 'op' && (t.value === '-' || t.value === '+')) {
      this.next();
      const operand = this.parseExpression(SIGN_PRECEDENCE);
      return { type: 'Unary', op: t.value, operand, pos: this.posOf(t) };
    }
    if (t.kind === 'keyword' && t.value.toUpperCase() === 'NOT') {
      this.next();
      // `NOT(x)` e `NOT x` caem no mesmo nó: no primeiro caso o operando é
      // apenas uma expressão entre parênteses.
      const operand = this.parseExpression(NOT_OPERAND_PRECEDENCE);
      return { type: 'Unary', op: 'NOT', operand, pos: this.posOf(t) };
    }
    return this.parsePostfix();
  }

  /** `.[Parte]` — hierarquia de datas. Encadeável. */
  private parsePostfix(): DaxNode {
    let node = this.parsePrimary();
    while (this.at('punct', '.') && this.peek(1).kind === 'bracket') {
      const dot = this.next();
      const part = this.next();
      node = { type: 'HierarchyPart', base: node, part: part.value, pos: this.posOf(dot) };
    }
    return node;
  }

  private parsePrimary(): DaxNode {
    const t = this.peek();

    switch (t.kind) {
      case 'number': {
        this.next();
        const value = Number(t.value);
        if (!Number.isFinite(value)) this.fail(t, `número inválido ${JSON.stringify(t.value)}`);
        return { type: 'Number', value, pos: this.posOf(t) };
      }

      case 'string':
        this.next();
        return { type: 'String', value: t.value, pos: this.posOf(t) };

      case 'quoted': {
        // `'Tabela'[Coluna]` ou `'Tabela'` sozinha
        this.next();
        if (this.peek().kind === 'bracket') {
          const col = this.next();
          return { type: 'ColumnRef', table: t.value, column: col.value, pos: this.posOf(t) };
        }
        return { type: 'TableRef', name: t.value, pos: this.posOf(t) };
      }

      case 'bracket':
        this.next();
        return { type: 'NameRef', name: t.value, pos: this.posOf(t) };

      case 'ident': {
        this.next();
        const upper = t.value.toUpperCase();
        // chamada de função — o DAX da base escreve `TRUNC ( x )` com espaço
        if (this.at('punct', '(')) {
          const args = this.parseArguments();
          if (upper === 'TRUE' || upper === 'FALSE') {
            if (args.length !== 0) {
              this.fail(t, `${upper}() não recebe argumento`);
            }
            return { type: 'Boolean', value: upper === 'TRUE', pos: this.posOf(t) };
          }
          return { type: 'Call', name: t.value, args, pos: this.posOf(t) };
        }
        // `Tabela[Coluna]` sem aspas
        if (this.peek().kind === 'bracket') {
          const col = this.next();
          return { type: 'ColumnRef', table: t.value, column: col.value, pos: this.posOf(t) };
        }
        if (upper === 'TRUE' || upper === 'FALSE') {
          return { type: 'Boolean', value: upper === 'TRUE', pos: this.posOf(t) };
        }
        return { type: 'Identifier', name: t.value, pos: this.posOf(t) };
      }

      case 'punct': {
        if (t.value === '(') {
          this.next();
          const inner = this.parseExpression(0);
          this.expect('punct', ')');
          return inner;
        }
        if (t.value === '{') return this.parseTableConstructor();
        return this.fail(t, `não esperava ${JSON.stringify(t.value)} aqui`);
      }

      case 'keyword':
        return this.fail(
          t,
          `${t.value.toUpperCase()} não pode começar uma expressão`,
        );

      case 'eof':
        return this.fail(t, 'expressão terminou antes do esperado');

      default:
        return this.fail(t, `não esperava ${JSON.stringify(t.value)} aqui`);
    }
  }

  /** Lista de argumentos, aceitando posição vazia: `RANKX(t, e, , ASC, DENSE)`. */
  private parseArguments(): DaxNode[] {
    this.expect('punct', '(');
    const args: DaxNode[] = [];
    if (this.at('punct', ')')) {
      this.next();
      return args;
    }
    for (;;) {
      if (this.at('punct', ',') || this.at('punct', ')')) {
        // argumento omitido
        const t = this.peek();
        args.push({ type: 'Missing', pos: this.posOf(t) });
      } else {
        args.push(this.parseExpression(0));
      }
      if (this.at('punct', ',')) {
        this.next();
        continue;
      }
      this.expect('punct', ')');
      break;
    }
    return args;
  }

  private parseTableConstructor(): DaxNode {
    const open = this.expect('punct', '{');
    const rows: DaxNode[][] = [];
    if (this.at('punct', '}')) {
      this.next();
      return { type: 'TableConstructor', rows, pos: this.posOf(open) };
    }
    for (;;) {
      if (this.at('punct', '(')) {
        // linha de várias colunas: `(1, "x")`
        this.next();
        const row: DaxNode[] = [];
        for (;;) {
          row.push(this.parseExpression(0));
          if (this.at('punct', ',')) {
            this.next();
            continue;
          }
          this.expect('punct', ')');
          break;
        }
        rows.push(row);
      } else {
        rows.push([this.parseExpression(0)]);
      }
      if (this.at('punct', ',')) {
        this.next();
        // `{ "a", "b", }` — vírgula sobrando antes do fecho
        if (this.at('punct', '}')) break;
        continue;
      }
      break;
    }
    this.expect('punct', '}');
    return { type: 'TableConstructor', rows, pos: this.posOf(open) };
  }
}

/** Faz o parse de uma expressão DAX. Estoura `DaxSyntaxError` com linha/coluna. */
export function parseDax(source: string): DaxNode {
  return new Parser(source).parseProgram();
}

export { DaxSyntaxError } from './tokenizer.ts';
