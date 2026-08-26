// Parser de M (Power Query) — descendente recursivo, um nível por precedência.
//
// A precedência segue a especificação do M, e a ordem importa em dois pontos onde
// o palpite natural erra:
//
//   1. `&` é **aditivo** (mesmo nível de `+`/`-`), não o mais fraco de todos como
//      no DAX. Em `a & b = c`, o M lê `(a & b) = c`.
//   2. `meta` é o mais **forte** dos binários, acima de `*`. Aparece uma vez na
//      base (`feriados`), e no lugar errado da tabela mudaria o parse dela.
//
// Da menor precedência para a maior:
//   or  <  and  <  is/as  <  =/<>  <  </<=/>/>=  <  +/-/&  <  */÷  <  meta  <  unário
//
// `if`, `each`, `let` e `(x) => e` não têm precedência: são expressões que só
// aparecem onde uma expressão inteira cabe, e por isso são tratadas na entrada.

import type {
  MBinaryOp,
  MBinding,
  MNode,
  Position,
} from './ast.ts';
import { MSyntaxError, tokenize, type MToken } from './tokenizer.ts';

export { MSyntaxError } from './tokenizer.ts';

export function parseM(source: string): MNode {
  const p = new Parser(tokenize(source), source);
  const node = p.expressao();
  p.exigeFim();
  return node;
}

/**
 * Atalho para quem só quer os passos do `let` de topo, que é o formato em que as
 * specs guardam as queries. Devolve `null` se a expressão não é um `let` — o que
 * é informação, não erro: `hora-atualizado` é só `DateTime.LocalNow()`.
 */
export function parseMLet(source: string): readonly MBinding[] | null {
  const node = parseM(source);
  return node.type === 'Let' ? node.bindings : null;
}

/** Níveis binários, do mais fraco ao mais forte. */
const NIVEIS: readonly (readonly MBinaryOp[])[] = [
  ['or'],
  ['and'],
  ['is', 'as'],
  ['=', '<>'],
  ['<', '<=', '>', '>='],
  ['+', '-', '&'],
  ['*', '/'],
  ['meta'],
];

class Parser {
  private i = 0;
  // Node roda TypeScript em strip-only: propriedade de parâmetro no construtor
  // (`constructor(private x)`) não é suportada. Declaração explícita.
  private readonly tokens: readonly MToken[];
  /**
   * O texto original. Serve a um caso só, mas indispensável: nome de campo com
   * espaço (`[DATA CRIADO]`) é recortado daqui em vez de remontado dos tokens,
   * para preservar exatamente o espaçamento que a fonte tem.
   */
  private readonly source: string;

  constructor(tokens: readonly MToken[], source: string) {
    this.tokens = tokens;
    this.source = source;
  }

  // ── utilidades ─────────────────────────────────────────────────────────────

  private get atual(): MToken {
    return this.tokens[this.i];
  }

  private pos(t: MToken = this.atual): Position {
    return { start: t.start, line: t.line, col: t.col };
  }

  private erro(msg: string, t: MToken = this.atual): never {
    throw new MSyntaxError(msg, t.line, t.col);
  }

  /** Consome se casar. Palavra citada (`#"and"`) nunca casa como palavra-chave. */
  private aceita(kind: MToken['kind'], value?: string): MToken | null {
    const t = this.atual;
    if (t.kind !== kind) return null;
    if (value !== undefined && t.value !== value) return null;
    this.i++;
    return t;
  }

  private exige(kind: MToken['kind'], value: string, onde: string): MToken {
    const t = this.aceita(kind, value);
    if (!t) this.erro(`Esperava \`${value}\` ${onde}, veio \`${this.descreve()}\`.`);
    return t!;
  }

  private descreve(): string {
    const t = this.atual;
    return t.kind === 'eof' ? 'fim da expressão' : t.value;
  }

  exigeFim(): void {
    if (this.atual.kind !== 'eof') {
      this.erro(`Sobrou \`${this.descreve()}\` depois do fim da expressão.`);
    }
  }

  // ── expressões ─────────────────────────────────────────────────────────────

  expressao(): MNode {
    const t = this.atual;

    if (t.kind === 'keyword') {
      if (t.value === 'let') return this.blocoLet();
      if (t.value === 'if') return this.condicional();
      if (t.value === 'each') {
        this.i++;
        return { type: 'Each', body: this.expressao(), ...this.pos(t) };
      }
    }

    // `(x) => corpo` e `(x as text) => corpo`. Precisa de espiada: `(` também
    // abre agrupamento, e `(a + b) * c` não é função nenhuma.
    if (t.kind === 'punct' && t.value === '(' && this.pareceFuncao()) {
      return this.funcao();
    }

    return this.binaria(0);
  }

  private blocoLet(): MNode {
    const t = this.exige('keyword', 'let', 'no início do bloco');
    const bindings: MBinding[] = [];
    do {
      const nome = this.nomeDePasso();
      this.exige('op', '=', `depois do nome do passo '${nome.value}'`);
      bindings.push({ name: nome.value, expr: this.expressao(), ...this.pos(nome) });
    } while (this.aceita('punct', ','));
    this.exige('keyword', 'in', `fechando o \`let\` de ${bindings.length} passo(s)`);
    return { type: 'Let', bindings, body: this.expressao(), ...this.pos(t) };
  }

  /**
   * Nome de passo: `Fonte` ou `#"Tipo Alterado"`. Aceita palavra-chave citada,
   * porque `#"in"` é nome legítimo — o que não se aceita é `in` nu.
   */
  private nomeDePasso(): MToken {
    const t = this.atual;
    if (t.kind === 'ident') {
      this.i++;
      return t;
    }
    this.erro(`Esperava nome de passo, veio \`${this.descreve()}\`.`);
  }

  private condicional(): MNode {
    const t = this.exige('keyword', 'if', 'no início da condição');
    const cond = this.expressao();
    this.exige('keyword', 'then', 'depois da condição do `if`');
    const then = this.expressao();
    // Em M o `else` é obrigatório. Exigir aqui transforma um `if` truncado em
    // erro apontado, em vez de "sobrou `,`" três passos adiante.
    this.exige('keyword', 'else', 'no `if` (M não tem `if` sem `else`)');
    return { type: 'If', cond, then, otherwise: this.expressao(), ...this.pos(t) };
  }

  /** `(` seguido de lista de parâmetros e `=>`, sem consumir nada. */
  private pareceFuncao(): boolean {
    let j = this.i + 1;
    let profundidade = 1;
    while (j < this.tokens.length) {
      const t = this.tokens[j];
      if (t.kind === 'eof') return false;
      if (t.kind === 'punct' && '({['.includes(t.value)) profundidade++;
      else if (t.kind === 'punct' && ')}]'.includes(t.value)) {
        profundidade--;
        if (profundidade === 0) {
          const seguinte = this.tokens[j + 1];
          return seguinte?.kind === 'op' && seguinte.value === '=>';
        }
      }
      j++;
    }
    return false;
  }

  private funcao(): MNode {
    const t = this.exige('punct', '(', 'abrindo os parâmetros da função');
    const params: { name: string; typeName: string | null }[] = [];
    if (!this.aceita('punct', ')')) {
      do {
        this.aceita('keyword', 'optional');
        const nome = this.nomeDePasso();
        let typeName: string | null = null;
        if (this.aceita('keyword', 'as')) typeName = this.nomeDeTipo();
        params.push({ name: nome.value, typeName });
      } while (this.aceita('punct', ','));
      this.exige('punct', ')', 'fechando os parâmetros da função');
    }
    this.exige('op', '=>', 'entre os parâmetros e o corpo da função');
    return { type: 'Function', params, body: this.expressao(), ...this.pos(t) };
  }

  private binaria(nivel: number): MNode {
    if (nivel >= NIVEIS.length) return this.unaria();
    const ops = NIVEIS[nivel];
    let esq = this.binaria(nivel + 1);
    for (;;) {
      const t = this.atual;
      // `or`/`and`/`is`/`as`/`meta` são palavra; o resto é operador.
      const casa =
        (t.kind === 'op' || t.kind === 'keyword') && (ops as readonly string[]).includes(t.value);
      if (!casa) return esq;
      this.i++;
      // `as` e `is` têm tipo à direita, não expressão: `x as number`.
      const dir: MNode =
        t.value === 'as' || t.value === 'is'
          ? { type: 'Type', name: this.nomeDeTipo(), ...this.pos(t) }
          : this.binaria(nivel + 1);
      esq = { type: 'Binary', op: t.value as MBinaryOp, left: esq, right: dir, ...this.pos(t) };
    }
  }

  private unaria(): MNode {
    const t = this.atual;
    if (t.kind === 'op' && (t.value === '+' || t.value === '-')) {
      this.i++;
      return { type: 'Unary', op: t.value, operand: this.unaria(), ...this.pos(t) };
    }
    if (t.kind === 'keyword' && t.value === 'not') {
      this.i++;
      return { type: 'Unary', op: 'not', operand: this.unaria(), ...this.pos(t) };
    }
    return this.posfixo(this.primaria());
  }

  /**
   * Sufixos que se encadeiam: chamada, campo e item.
   *
   * A cadeia é real na base e é o que lê a aba de uma planilha:
   * `Fonte{[name="QUADRO FUNCIONAL",ItemKind="Table"]}[Data]` — item por registro,
   * e depois campo. Parar depois do primeiro sufixo perderia o `[Data]`.
   */
  private posfixo(alvo: MNode): MNode {
    let no = alvo;
    for (;;) {
      const t = this.atual;
      if (t.kind === 'punct' && t.value === '(') {
        this.i++;
        const args: MNode[] = [];
        if (!this.aceita('punct', ')')) {
          do {
            args.push(this.expressao());
          } while (this.aceita('punct', ','));
          this.exige('punct', ')', 'fechando os argumentos da chamada');
        }
        no = { type: 'Call', callee: no, args, ...this.pos(t) };
        continue;
      }
      if (t.kind === 'punct' && t.value === '[') {
        // Depois de uma expressão, `[` é sempre acesso a campo — registro literal
        // só aparece onde se espera um valor novo, e isso é `primaria`.
        this.i++;
        const nome = this.nomeDeCampo();
        this.exige('punct', ']', `fechando o acesso ao campo '${nome}'`);
        no = { type: 'Field', target: no, field: nome, optional: this.optional(), ...this.pos(t) };
        continue;
      }
      if (t.kind === 'punct' && t.value === '{') {
        this.i++;
        const seletor = this.expressao();
        this.exige('punct', '}', 'fechando o acesso a item');
        no = { type: 'Item', target: no, selector: seletor, optional: this.optional(), ...this.pos(t) };
        continue;
      }
      return no;
    }
  }

  private optional(): boolean {
    return this.aceita('punct', '?') !== null;
  }

  private primaria(): MNode {
    const t = this.atual;

    if (t.kind === 'number') {
      this.i++;
      const n = t.value.startsWith('0x') || t.value.startsWith('0X')
        ? Number.parseInt(t.value, 16)
        : Number(t.value);
      if (!Number.isFinite(n)) this.erro(`Número ilegível: \`${t.value}\`.`, t);
      return { type: 'Literal', value: n, ...this.pos(t) };
    }

    if (t.kind === 'string') {
      this.i++;
      return { type: 'Literal', value: t.value, ...this.pos(t) };
    }

    if (t.kind === 'ident') {
      this.i++;
      return { type: 'Identifier', name: t.value, ...this.pos(t) };
    }

    // `#date(2026,1,1)` e irmãos: construtor, tratado como chamada para o
    // avaliador não precisar de um caminho separado.
    if (t.kind === 'intrinsic') {
      this.i++;
      return { type: 'Identifier', name: t.value, ...this.pos(t) };
    }

    if (t.kind === 'keyword') {
      if (t.value === 'true' || t.value === 'false') {
        this.i++;
        return { type: 'Literal', value: t.value === 'true', ...this.pos(t) };
      }
      if (t.value === 'null') {
        this.i++;
        return { type: 'Literal', value: null, ...this.pos(t) };
      }
      if (t.value === 'type') {
        this.i++;
        return { type: 'Type', name: this.nomeDeTipo(), ...this.pos(t) };
      }
      // `let`/`if`/`each` aqui dentro são legítimos: `Table.AddColumn(t, "c", each
      // if [a] then 1 else 2)`. Voltam para a entrada.
      if (t.value === 'let' || t.value === 'if' || t.value === 'each') return this.expressao();
    }

    if (t.kind === 'punct') {
      if (t.value === '(') {
        this.i++;
        const dentro = this.expressao();
        this.exige('punct', ')', 'fechando o agrupamento');
        return dentro;
      }
      if (t.value === '{') return this.lista();
      if (t.value === '[') return this.registroOuCampoImplicito();
    }

    this.erro(`Esperava um valor, veio \`${this.descreve()}\`.`);
  }

  private lista(): MNode {
    const t = this.exige('punct', '{', 'abrindo a lista');
    const items: MNode[] = [];
    if (!this.aceita('punct', '}')) {
      do {
        items.push(this.expressao());
      } while (this.aceita('punct', ','));
      this.exige('punct', '}', 'fechando a lista');
    }
    return { type: 'List', items, ...this.pos(t) };
  }

  /**
   * `[` no lugar de um valor é registro (`[PromoteAllScalars=true]`) **ou** campo
   * do `_` implícito (`each [GESTOR] = "x"`). A diferença é o que vem depois do
   * nome: `=` faz registro, `]` faz campo.
   *
   * Distinguir isto errado é a diferença entre ler `each [A] = "x"` como
   * "compara a coluna A com x" e como "constrói um registro com campo A". O
   * primeiro filtra linha; o segundo devolveria um registro sempre verdadeiro e
   * `Table.SelectRows` não filtraria nada — sem erro nenhum.
   */
  private registroOuCampoImplicito(): MNode {
    const t = this.exige('punct', '[', 'abrindo registro ou campo');

    if (this.aceita('punct', ']')) {
      return { type: 'Record', fields: [], ...this.pos(t) };
    }

    const primeiro = this.nomeDeCampo();

    if (this.aceita('punct', ']')) {
      return {
        type: 'Field',
        target: null,
        field: primeiro,
        optional: this.optional(),
        ...this.pos(t),
      };
    }

    this.exige('op', '=', `no campo '${primeiro}' do registro`);
    const fields: { name: string; expr: MNode }[] = [
      { name: primeiro, expr: this.expressao() },
    ];
    while (this.aceita('punct', ',')) {
      const nome = this.nomeDeCampo();
      this.exige('op', '=', `no campo '${nome}' do registro`);
      fields.push({ name: nome, expr: this.expressao() });
    }
    this.exige('punct', ']', 'fechando o registro');
    return { type: 'Record', fields, ...this.pos(t) };
  }

  /**
   * Nome dentro de `[...]` — um *generalized identifier* do M, que é mais
   * permissivo que identificador comum em dois pontos que a base usa de verdade:
   *
   *   - **pode conter espaço sem aspas**: `[DATA CRIADO]`, `[CAPACIDADE MANHÃ]`,
   *     `[HR. ALOCAÇÃO]`. Exigir `#"..."` aqui recusaria 5 das 24 queries — foi
   *     assim que este parser falhou na primeira rodada contra o corpus.
   *   - **pode ser palavra-chave ou começar com dígito**: a base tem `[TIME]`, e
   *     `type`/`and` seriam palavra-chave em qualquer outra posição.
   *
   * O nome é recortado do texto original, não remontado dos tokens, para o
   * espaçamento sair idêntico ao da fonte — é o nome que vai casar com coluna do
   * modelo depois, e `"DATA  CRIADO"` com dois espaços não é `"DATA CRIADO"`.
   *
   * Só não atravessa quebra de linha: um `]` esquecido faria o nome engolir o
   * passo seguinte inteiro, e o erro apareceria longe da causa.
   */
  private nomeDeCampo(): string {
    const t = this.atual;

    if (t.kind === 'ident' && t.quoted) {
      this.i++;
      return t.value; // `#"..."` já é o nome completo
    }

    if (t.kind !== 'ident' && t.kind !== 'keyword' && t.kind !== 'number') {
      if (t.kind === 'string') {
        // `["x"]` não é M válido; dizer isso é melhor que "esperava nome".
        this.erro('Nome de campo não usa aspas duplas; use `[Nome]` ou `[#"Nome"]`.', t);
      }
      this.erro(`Esperava nome de campo, veio \`${this.descreve()}\`.`, t);
    }

    const inicio = t.start;
    let fim = t.start + t.value.length;
    this.i++;
    for (;;) {
      const prox = this.atual;
      const juntavel = prox.kind === 'ident' || prox.kind === 'keyword' || prox.kind === 'number';
      if (!juntavel || (prox.kind === 'ident' && prox.quoted)) break;
      // Entre as partes só pode haver espaço/tab. Vírgula, `=` ou `]` param aqui,
      // e é isso que separa `[A B]` de `[A] and [B]`.
      if (!/^[ \t]+$/.test(this.source.slice(fim, prox.start))) break;
      fim = prox.start + prox.value.length;
      this.i++;
    }
    return this.source.slice(inicio, fim);
  }

  /**
   * Tipo depois de `type`, `as` ou `is`: `text`, `number`, `nullable text`,
   * `table`, `any`. O nome fica cru — quem interpreta é o avaliador.
   */
  private nomeDeTipo(): string {
    let nome = '';
    if (this.aceita('keyword', 'nullable')) nome = 'nullable ';
    const t = this.atual;
    if (t.kind === 'ident' || t.kind === 'keyword') {
      this.i++;
      nome += t.value;
      // `type table [A = text, B = number]` — o detalhe do registro de campos não
      // muda nada para nós (quem tipa coluna é `TransformColumnTypes`), então é
      // consumido e descartado, em vez de virar erro de sintaxe.
      if (this.atual.kind === 'punct' && this.atual.value === '[') this.pulaBalanceado('[', ']');
      if (this.atual.kind === 'punct' && this.atual.value === '{') this.pulaBalanceado('{', '}');
      return nome;
    }
    this.erro(`Esperava nome de tipo, veio \`${this.descreve()}\`.`, t);
  }

  private pulaBalanceado(abre: string, fecha: string): void {
    this.exige('punct', abre, 'abrindo o detalhe do tipo');
    let profundidade = 1;
    while (profundidade > 0) {
      const t = this.atual;
      if (t.kind === 'eof') this.erro(`\`${abre}\` do tipo não foi fechado.`);
      if (t.kind === 'punct' && t.value === abre) profundidade++;
      if (t.kind === 'punct' && t.value === fecha) profundidade--;
      this.i++;
    }
  }
}
