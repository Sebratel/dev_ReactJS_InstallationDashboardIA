// AST do subconjunto de DAX usado pelo modelo da Sebratel.
//
// O AST é deliberadamente "burro": ele registra o que estava escrito, não o que
// aquilo significa. Quem decide se `[Data]` é medida ou coluna, se `calendar` é
// tabela ou variável, e se `ASC` é enum ou identificador, é o resolvedor — que
// conhece o modelo semântico. O parser não adivinha.
//
// Isso não é purismo: no DAX real desta base `[Data]` às vezes é coluna de uma
// tabela anônima criada por SELECTCOLUMNS, e um parser que "resolvesse" na hora
// escolheria errado em silêncio.

export type BinaryOp =
  | '||' | '&&'
  /** `==` é igualdade ESTRITA: BLANK não equivale a 0 nem a "". `=` equivale. */
  | '=' | '==' | '<>' | '<' | '<=' | '>' | '>='
  /** concatenação de texto (não confundir com `&&`) */
  | '&'
  | '+' | '-' | '*' | '/' | '^';

export type UnaryOp = '-' | '+' | 'NOT';

export interface Position {
  /** offset no texto original — para mensagem de erro */
  start: number;
  line: number;
  col: number;
}

interface Base {
  pos: Position;
}

export interface NumberNode extends Base {
  type: 'Number';
  value: number;
}

export interface StringNode extends Base {
  type: 'String';
  value: string;
}

export interface BooleanNode extends Base {
  type: 'Boolean';
  value: boolean;
}

/**
 * Argumento vazio. `RANKX(TabelaDatas, [Data], , ASC, DENSE)` é DAX real desta
 * base: o terceiro argumento foi omitido. Sem este nó, o parser precisaria
 * inventar um valor ou recusar a medida.
 */
export interface MissingNode extends Base {
  type: 'Missing';
}

/**
 * Identificador nu. Pode ser variável (`Dias_Uteis_No_Mes`), tabela sem aspas
 * (`calendar`) ou enum posicional (`ASC`, `DENSE`, `DAY`, `MINUTE`).
 * Distinguir é trabalho do resolvedor.
 */
export interface IdentifierNode extends Base {
  type: 'Identifier';
  name: string;
}

/** `'NOME DA TABELA'` — tabela citada, sem coluna depois. */
export interface TableRefNode extends Base {
  type: 'TableRef';
  name: string;
}

/** `'Tabela'[Coluna]` ou `Tabela[Coluna]`. */
export interface ColumnRefNode extends Base {
  type: 'ColumnRef';
  table: string;
  column: string;
}

/** `[Nome]` sem tabela: medida do modelo OU coluna da tabela do contexto. */
export interface NameRefNode extends Base {
  type: 'NameRef';
  name: string;
}

/**
 * `.[Parte]` depois de uma referência — hierarquia automática de datas do Power
 * BI (`'CALENDARIO INSTALADO'[DATA INSTALADO].[Dia]`).
 */
export interface HierarchyPartNode extends Base {
  type: 'HierarchyPart';
  base: DaxNode;
  part: string;
}

export interface CallNode extends Base {
  type: 'Call';
  /** Nome como estava escrito. DAX não distingue caixa; quem normaliza é o resolvedor. */
  name: string;
  args: DaxNode[];
}

export interface UnaryNode extends Base {
  type: 'Unary';
  op: UnaryOp;
  operand: DaxNode;
}

export interface BinaryNode extends Base {
  type: 'Binary';
  op: BinaryOp;
  left: DaxNode;
  right: DaxNode;
}

/** `expr IN { ... }` ou `expr IN <expressão de tabela>`. */
export interface InNode extends Base {
  type: 'In';
  value: DaxNode;
  source: DaxNode;
}

/**
 * `{ "a", "b" }` (uma coluna) ou `{ (1, "x"), (2, "y") }` (várias).
 * Cada item de `rows` é uma linha; cada item da linha, uma coluna.
 */
export interface TableConstructorNode extends Base {
  type: 'TableConstructor';
  rows: DaxNode[][];
}

export interface VarDeclaration {
  name: string;
  expr: DaxNode;
  pos: Position;
}

/** `VAR a = ... VAR b = ... RETURN <corpo>`. Pode aparecer aninhado. */
export interface VarBlockNode extends Base {
  type: 'VarBlock';
  vars: VarDeclaration[];
  body: DaxNode;
}

export type DaxNode =
  | NumberNode
  | StringNode
  | BooleanNode
  | MissingNode
  | IdentifierNode
  | TableRefNode
  | ColumnRefNode
  | NameRefNode
  | HierarchyPartNode
  | CallNode
  | UnaryNode
  | BinaryNode
  | InNode
  | TableConstructorNode
  | VarBlockNode;

/** Percorre o AST inteiro. Usado por análises (refs, funções usadas, ciclos). */
export function walk(node: DaxNode, visit: (n: DaxNode) => void): void {
  visit(node);
  switch (node.type) {
    case 'HierarchyPart':
      walk(node.base, visit);
      break;
    case 'Call':
      for (const a of node.args) walk(a, visit);
      break;
    case 'Unary':
      walk(node.operand, visit);
      break;
    case 'Binary':
      walk(node.left, visit);
      walk(node.right, visit);
      break;
    case 'In':
      walk(node.value, visit);
      walk(node.source, visit);
      break;
    case 'TableConstructor':
      for (const row of node.rows) for (const c of row) walk(c, visit);
      break;
    case 'VarBlock':
      for (const v of node.vars) walk(v.expr, visit);
      walk(node.body, visit);
      break;
    default:
      // folhas: Number, String, Boolean, Missing, Identifier, TableRef,
      // ColumnRef, NameRef — nada a descer
      break;
  }
}

/** Nomes de função presentes na expressão, em maiúsculas. */
export function functionsUsed(node: DaxNode): Set<string> {
  const out = new Set<string>();
  walk(node, (n) => {
    if (n.type === 'Call') out.add(n.name.toUpperCase());
  });
  return out;
}
