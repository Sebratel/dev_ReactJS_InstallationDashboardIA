// AST da linguagem M (Power Query).
//
// O campo discriminante é `type`, igual ao AST de DAX — não `kind`. Já custou bug
// no avaliador de medidas; aqui nasce igual de propósito.
//
// O escopo dos nós não é a linguagem M inteira: é o que as 24 queries do PBIP
// realmente usam, medido com strings e comentários removidos (o SQL vive dentro
// de string e contém `AS`, `IS`, `--` em profusão — contar sem descontar isso
// inventa sintaxe que não existe). O que **não** aparece no corpus e portanto não
// tem nó aqui: `try/otherwise`, faixa `..`, recursão `@f`, `is`.
//
// `Function`, `As` e `Meta` aparecem em exatamente duas queries — `clima-tempo` e
// `feriados` — e existem no parser porque parsear é barato. Quem recusa é o
// avaliador, com o nome da query: recusar no parser esconderia a informação de
// que o texto está bem formado e só a semântica falta.

export interface Position {
  /** Índice absoluto no texto original. */
  readonly start: number;
  readonly line: number;
  readonly col: number;
}

export type MNode =
  | MLet
  | MEach
  | MFunction
  | MIf
  | MBinary
  | MUnary
  | MCall
  | MField
  | MItem
  | MIdentifier
  | MLiteral
  | MList
  | MRecord
  | MType;

/** `let nome = expr, ... in corpo` */
export interface MLet extends Position {
  readonly type: 'Let';
  readonly bindings: readonly MBinding[];
  readonly body: MNode;
}

export interface MBinding extends Position {
  /** Nome do passo, já sem `#"`…`"` e com `""` resolvido. */
  readonly name: string;
  readonly expr: MNode;
}

/**
 * `each corpo` — função de um argumento cujo parâmetro é implícito.
 *
 * Dentro do corpo, `[Coluna]` é campo de `_`, e `_` também pode ser escrito. São
 * 65 ocorrências em 14 queries: é a forma dominante de lambda na base.
 */
export interface MEach extends Position {
  readonly type: 'Each';
  readonly body: MNode;
}

/** `(x, y) => corpo`, com anotação de tipo opcional em cada parâmetro. */
export interface MFunction extends Position {
  readonly type: 'Function';
  readonly params: readonly { readonly name: string; readonly typeName: string | null }[];
  readonly body: MNode;
}

export interface MIf extends Position {
  readonly type: 'If';
  readonly cond: MNode;
  readonly then: MNode;
  /** M **exige** `else`: não há `if` sem alternativa. */
  readonly otherwise: MNode;
}

/**
 * Operadores binários, na precedência do M (da menor para a maior):
 * `or` < `and` < `is`/`as` < `=`/`<>` < `<`/`<=`/`>`/`>=` < `+`/`-`/`&` < `*`/`/` < `meta`.
 *
 * Duas diferenças em relação ao DAX que precisam estar certas ou o número muda:
 * `&` é **aditivo** em M (mesmo nível de `+`), e a igualdade é `=`, não `==`.
 */
export interface MBinary extends Position {
  readonly type: 'Binary';
  readonly op: MBinaryOp;
  readonly left: MNode;
  readonly right: MNode;
}

export type MBinaryOp =
  | 'or' | 'and'
  | '=' | '<>' | '<' | '<=' | '>' | '>='
  | '+' | '-' | '&' | '*' | '/'
  | 'as' | 'is' | 'meta';

export interface MUnary extends Position {
  readonly type: 'Unary';
  readonly op: '+' | '-' | 'not';
  readonly operand: MNode;
}

export interface MCall extends Position {
  readonly type: 'Call';
  readonly callee: MNode;
  readonly args: readonly MNode[];
}

/**
 * Acesso a campo: `[Coluna]` (de `_`), `registro[Campo]`, `x[Campo]?`.
 *
 * `optional` é o `?` do M, que devolve null em vez de erro quando o campo não
 * existe. A distinção importa: sem `?`, campo ausente é erro, e é justamente o
 * erro que a camada M dá quando alguém renomeia coluna na fonte.
 */
export interface MField extends Position {
  readonly type: 'Field';
  /** `null` quando é `[Coluna]` solto — o alvo é o `_` implícito. */
  readonly target: MNode | null;
  readonly field: string;
  readonly optional: boolean;
}

/** Acesso a item: `lista{0}`, `tabela{[name="X"]}`, `x{0}?`. */
export interface MItem extends Position {
  readonly type: 'Item';
  readonly target: MNode;
  readonly selector: MNode;
  readonly optional: boolean;
}

export interface MIdentifier extends Position {
  readonly type: 'Identifier';
  /** Já sem `#"`…`"`. Pode conter ponto (`Table.AddColumn`, `Int64.Type`). */
  readonly name: string;
}

export interface MLiteral extends Position {
  readonly type: 'Literal';
  readonly value: number | string | boolean | null;
}

export interface MList extends Position {
  readonly type: 'List';
  readonly items: readonly MNode[];
}

export interface MRecord extends Position {
  readonly type: 'Record';
  readonly fields: readonly { readonly name: string; readonly expr: MNode }[];
}

/**
 * `type text`, `type number`, `type any`, `type nullable text`, `type table [...]`.
 *
 * O nome fica cru de propósito. Quem decide o que "text" significa é o avaliador,
 * junto com `Int64.Type` (que é um `Identifier`, não isto) — e a conversão de tipo
 * é o lugar onde a camada M muda valor de verdade, não só nome.
 */
export interface MType extends Position {
  readonly type: 'Type';
  readonly name: string;
}
