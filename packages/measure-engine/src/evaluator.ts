// Avaliador de DAX.
//
// Regra que governa o arquivo inteiro: **falhar alto**. Função não suportada,
// construção não reconhecida, referência que não resolve, tipo que não combina →
// erro. Nunca um palpite.
//
// O motivo é operacional, não estético: um avaliador que devolve número errado
// em silêncio entrega esse número ao dashboard da operação com a mesma cara de
// um número certo. Um que se recusa a rodar aparece no teste.

import type { SemanticModel } from '../../semantic-model/src/model.ts';
import { normalizeName } from '../../semantic-model/src/model.ts';
import type { DaxNode } from './ast.ts';
import type { Dataset, Row } from './dataset.ts';
import {
  FilteredContext,
  type TableValue,
  isTableValue,
  makeTableValue,
  rowKey,
} from './filter.ts';
import { lookupFunction, lookupTableFunction } from './functions.ts';
import { parseDax } from './parser.ts';
import {
  BLANK,
  DaxEvalError,
  type DaxValue,
  isBlank,
  toBoolean,
  toNumber,
  toText,
  compareValues,
  identityKey,
} from './value.ts';

export { FilteredContext, type FilterContext, type TableFilter, type TableValue } from './filter.ts';

/** O que um `VAR` pode guardar: escalar ou tabela (`VAR x = FILTER(...)`). */
export type ScopeValue = DaxValue | TableValue;

export interface EvalScope {
  readonly filter: FilteredContext;
  /** contexto de linha: tabela normalizada -> linha corrente */
  readonly rows: ReadonlyMap<string, Row>;
  /** variáveis `VAR` visíveis */
  readonly vars: ReadonlyMap<string, ScopeValue>;
}

export interface EvaluatorOptions {
  model: SemanticModel;
  dataset: Dataset;
  /**
   * O "agora" do cálculo. Injetado, não `new Date()`: 25 das 121 expressões
   * chamam `TODAY()`, e teste de paridade que muda de resultado à meia-noite não
   * prova nada.
   */
  now: Date;
}

/** Partes da hierarquia automática de datas do Power BI (`[Data].[Dia]`). */
const HIERARQUIA: Record<string, (d: Date) => DaxValue> = {
  // Lidas de LocalDateTable_*.tmdl no PBIP, não deduzidas: o Power BI gera
  // exatamente estas colunas por coluna de data.
  ano: (d) => d.getUTCFullYear(),
  monthno: (d) => d.getUTCMonth() + 1,
  mês: (d) => MESES_PT[d.getUTCMonth()]!,
  mes: (d) => MESES_PT[d.getUTCMonth()]!,
  quarterno: (d) => Math.trunc((d.getUTCMonth() + 1 + 2) / 3),
  trimestre: (d) => `Trim ${Math.trunc((d.getUTCMonth() + 1 + 2) / 3)}`,
  dia: (d) => d.getUTCDate(),
};

const MESES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export class Evaluator {
  readonly model: SemanticModel;
  readonly dataset: Dataset;
  readonly now: Date;

  /** AST por expressão, para não reparsear a cada linha. */
  private readonly astCache = new Map<string, DaxNode>();
  /** Pilha de medidas em avaliação — detecta ciclo. */
  private readonly measureStack: string[] = [];
  /** Pilha de colunas calculadas em avaliação — detecta ciclo. */
  private readonly columnStack: string[] = [];

  constructor(opts: EvaluatorOptions) {
    this.model = opts.model;
    this.dataset = opts.dataset;
    this.now = opts.now;
  }

  // -------------------------------------------------------------------------
  // API pública
  // -------------------------------------------------------------------------

  /** Avalia uma medida do modelo pelo nome, sem filtro nenhum (o "total geral"). */
  measure(name: string): DaxValue {
    return this.measureInScope(name, this.rootScope());
  }

  /** Avalia uma expressão DAX solta. Usado por teste e pelo futuro Query Engine. */
  evaluateExpression(dax: string, scope: EvalScope = this.rootScope()): DaxValue {
    return this.evaluate(this.ast(dax), scope);
  }

  /** Todos os valores de uma coluna no contexto de filtro corrente. */
  columnValues(table: string, column: string): DaxValue[] {
    return this.filterRows(this.rootScope(), table).map((r) =>
      this.columnValue(table, column, r),
    );
  }

  rootScope(): EvalScope {
    return {
      filter: FilteredContext.unfiltered(this.dataset),
      rows: new Map(),
      vars: new Map(),
    };
  }

  /** Escopo com uma linha da tabela em contexto — como no cálculo de coluna calculada. */
  scopeWithRow(base: EvalScope, table: string, row: Row): EvalScope {
    const rows = new Map(base.rows);
    rows.set(normalizeName(table), row);
    return { filter: base.filter, rows, vars: base.vars };
  }

  scopeWithVars(base: EvalScope, vars: ReadonlyMap<string, ScopeValue>): EvalScope {
    return { filter: base.filter, rows: base.rows, vars };
  }

  /** Escopo com outro contexto de filtro e **sem** contexto de linha (ver `CALCULATE`). */
  scopeWithFilter(base: EvalScope, filter: FilteredContext): EvalScope {
    return { filter, rows: new Map(), vars: base.vars };
  }

  ast(dax: string): DaxNode {
    let node = this.astCache.get(dax);
    if (!node) {
      node = parseDax(dax);
      this.astCache.set(dax, node);
    }
    return node;
  }

  filterRows(scope: EvalScope, table: string): Row[] {
    return scope.filter.rowsOf(table);
  }

  // -------------------------------------------------------------------------
  // Colunas
  // -------------------------------------------------------------------------

  /**
   * Valor de uma coluna numa linha. Se a coluna é calculada, avalia o DAX dela
   * naquela linha e **memoriza na própria linha** — é o que o Power BI faz no
   * refresh, e sem isso cada `SUM('CALENDARIO CRIADO'[PESO])` reavaliaria a
   * regra de dias úteis uma vez por linha, por medida.
   */
  columnValue(table: string, column: string, row: Row): DaxValue {
    const ck = normalizeName(column);
    if (this.dataset.hasPhysicalColumn(table, column) || ck in row) {
      return row[ck] ?? BLANK;
    }

    const col = this.model.column(table, column);
    if (!col) {
      throw new DaxEvalError(`Coluna não existe no modelo: '${table}'[${column}]`);
    }
    if (!col.calculated || !col.dax) {
      throw new DaxEvalError(
        `Coluna '${table}'[${column}] existe no modelo mas não veio nos dados ` +
          `e não é calculada — o dataset do teste está incompleto.`,
      );
    }

    const key = `${normalizeName(table)}[${ck}]`;
    if (this.columnStack.includes(key)) {
      throw new DaxEvalError(
        `Ciclo entre colunas calculadas: ${[...this.columnStack, key].join(' -> ')}`,
      );
    }
    this.columnStack.push(key);
    try {
      const valor = this.evaluate(
        this.ast(col.dax),
        this.scopeWithRow(this.rootScope(), table, row),
      );
      row[ck] = valor;
      return valor;
    } finally {
      this.columnStack.pop();
    }
  }

  /**
   * Os valores que uma referência de coluna produz no contexto corrente —
   * inclusive `[Data].[Dia]`, a hierarquia automática de datas.
   *
   * Agregação em DAX exige referência de coluna, não expressão qualquer: é por
   * isso que isto recusa outros nós em vez de tentar avaliar linha a linha.
   */
  valuesOfColumnRef(node: DaxNode, scope: EvalScope, onde: string): DaxValue[] {
    if (node.type === 'ColumnRef') {
      return this.filterRows(scope, node.table).map((r) =>
        this.columnValue(node.table, node.column, r),
      );
    }

    if (node.type === 'HierarchyPart') {
      if (node.base.type !== 'ColumnRef') {
        throw new DaxEvalError(`${onde}: hierarquia .[${node.part}] sobre algo que não é coluna.`);
      }
      const derivar = HIERARQUIA[normalizeName(node.part)];
      if (!derivar) {
        throw new DaxEvalError(
          `${onde}: parte de hierarquia de datas não suportada: .[${node.part}]. ` +
            `Suportadas: ${Object.keys(HIERARQUIA).join(', ')}.`,
        );
      }
      const base = node.base;
      return this.filterRows(scope, base.table).map((r) => {
        const v = this.columnValue(base.table, base.column, r);
        if (isBlank(v)) return BLANK;
        if (!(v instanceof Date)) {
          throw new DaxEvalError(
            `${onde}: .[${node.part}] exige coluna de data, e '${base.table}'[${base.column}] ` +
              `trouxe ${JSON.stringify(v)}.`,
          );
        }
        return derivar(v);
      });
    }

    throw new DaxEvalError(
      `${onde}: esperava referência de coluna e recebeu nó ${node.type}.`,
    );
  }

  // -------------------------------------------------------------------------
  // Tabelas
  // -------------------------------------------------------------------------

  /** O nó devolve tabela (e não escalar)? Decide como avaliar um `VAR`. */
  isTableExpression(node: DaxNode, scope: EvalScope): boolean {
    if (node.type === 'TableRef') return true;
    if (node.type === 'Call') return lookupTableFunction(node.name) !== undefined;
    if (node.type === 'Identifier') {
      const v = scope.vars.get(normalizeName(node.name));
      if (v !== undefined) return isTableValue(v);
      return this.model.table(node.name) !== null;
    }
    return false;
  }

  /**
   * Avalia expressão de tabela. Erra alto para qualquer forma fora do subconjunto
   * implementado — é o que impede um `FILTER` mal entendido de virar um conjunto de
   * linhas plausível e errado.
   */
  evaluateTable(node: DaxNode, scope: EvalScope, onde: string): TableValue {
    if (node.type === 'TableRef') return this.tableOf(node.name, scope);

    if (node.type === 'Identifier') {
      const v = scope.vars.get(normalizeName(node.name));
      if (v !== undefined) {
        if (isTableValue(v)) return v;
        throw new DaxEvalError(`${onde}: a variável ${node.name} guarda valor escalar, não tabela.`);
      }
      if (this.model.table(node.name)) return this.tableOf(node.name, scope);
      throw new DaxEvalError(`${onde}: ${node.name} não é tabela do modelo nem VAR em escopo.`);
    }

    if (node.type === 'Call') {
      const fn = lookupTableFunction(node.name);
      if (fn) return fn(node.args, scope, this, node.name.toUpperCase());
      throw new DaxEvalError(
        `${onde}: ${node.name.toUpperCase()} não devolve tabela ` +
          `(linha ${node.pos.line}, coluna ${node.pos.col}).`,
      );
    }

    throw new DaxEvalError(`${onde}: esperava expressão de tabela e recebeu nó ${node.type}.`);
  }

  /** A tabela do modelo como está no contexto de filtro corrente. */
  tableOf(name: string, scope: EvalScope): TableValue {
    const t = this.model.table(name);
    if (!t) throw new DaxEvalError(`Tabela não existe no modelo: '${name}'`);
    return makeTableValue(t.name, t.columns.map((c) => c.name), this.filterRows(scope, t.name));
  }

  /** Escalar ou tabela, conforme a forma do nó. Usado por `VAR`. */
  evaluateAny(node: DaxNode, scope: EvalScope): ScopeValue {
    return this.isTableExpression(node, scope)
      ? this.evaluateTable(node, scope, 'VAR')
      : this.evaluate(node, scope);
  }

  /** Liga as variáveis de um `VAR ... RETURN`. Escopo lexical acumulativo. */
  private bindVars(
    node: Extract<DaxNode, { type: 'VarBlock' }>,
    scope: EvalScope,
  ): Map<string, ScopeValue> {
    const vars = new Map(scope.vars);
    for (const v of node.vars) {
      vars.set(normalizeName(v.name), this.evaluateAny(v.expr, this.scopeWithVars(scope, vars)));
    }
    return vars;
  }

  /**
   * Transição de contexto: o contexto de linha vira contexto de filtro.
   *
   * É o que `CALCULATE` faz ao ser chamado dentro de um iterador ou de uma coluna
   * calculada, e o que faz `AVERAGEX(VALUES('T'[C]), CALCULATE([Medida]))` calcular
   * a medida **por valor de C** em vez de repetir o total geral.
   *
   * Filtra por **todas** as colunas presentes na linha, como o DAX faz — e não por
   * uma chave, que o modelo pode não ter.
   */
  transitionRowContext(scope: EvalScope): FilteredContext {
    let ctx = scope.filter;
    for (const [tabela, row] of scope.rows) {
      const columns = new Set(Object.keys(row));
      if (columns.size === 0) continue;
      const alvo = rowKey(row, columns);
      ctx = ctx.with([
        {
          table: tabela,
          columns,
          origem: `transição de contexto de linha em '${tabela}'`,
          keep: (r) => rowKey(r, columns) === alvo,
        },
      ]);
    }
    return ctx;
  }

  // -------------------------------------------------------------------------
  // Avaliação
  // -------------------------------------------------------------------------

  evaluate(node: DaxNode, scope: EvalScope): DaxValue {
    switch (node.type) {
      case 'Number':
      case 'String':
      case 'Boolean':
        return node.value;

      case 'Missing':
        // Argumento omitido só tem sentido para quem sabe o default dele. Se
        // chegou até aqui, alguma função deixou passar sem tratar.
        throw new DaxEvalError(
          `Argumento omitido usado como valor (linha ${node.pos.line}, coluna ${node.pos.col}).`,
        );

      case 'ColumnRef':
        return this.columnInRow(node.table, node.column, scope, node);

      case 'NameRef':
        return this.resolveNameRef(node.name, scope);

      case 'Identifier':
        return this.resolveIdentifier(node.name, scope);

      case 'HierarchyPart': {
        const valores = this.valuesOfColumnRef(node, scope, `.[${node.part}]`);
        // Em contexto de linha a hierarquia devolve o valor da linha corrente.
        if (node.base.type === 'ColumnRef') {
          const row = scope.rows.get(normalizeName(node.base.table));
          if (row) {
            const v = this.columnValue(node.base.table, node.base.column, row);
            if (isBlank(v)) return BLANK;
            const derivar = HIERARQUIA[normalizeName(node.part)]!;
            return derivar(v as Date);
          }
        }
        return this.unicoValor(valores, `.[${node.part}]`);
      }

      case 'TableRef':
        throw new DaxEvalError(
          `Tabela '${node.name}' usada onde se espera valor escalar (linha ${node.pos.line}).`,
        );

      case 'Unary':
        return this.evalUnary(node, scope);

      case 'Binary':
        return this.evalBinary(node, scope);

      case 'In':
        return this.evalIn(node, scope);

      case 'TableConstructor':
        throw new DaxEvalError(
          `Construtor de tabela { ... } fora de um IN (linha ${node.pos.line}).`,
        );

      case 'VarBlock':
        return this.evaluate(node.body, this.scopeWithVars(scope, this.bindVars(node, scope)));

      case 'Call': {
        const fn = lookupFunction(node.name);
        if (!fn) {
          throw new DaxEvalError(
            `Função DAX não implementada: ${node.name.toUpperCase()} ` +
              `(linha ${node.pos.line}, coluna ${node.pos.col}).`,
          );
        }
        return fn(node.args, scope, this, node.name.toUpperCase());
      }
    }
  }

  /**
   * `'Tabela'[Coluna]` fora de contexto de linha.
   *
   * Em DAX isso só é válido se a coluna tem **um** valor no contexto de filtro;
   * com mais de um o Power BI erra. Replicamos: devolver o primeiro seria
   * escolher um número entre vários sem avisar.
   */
  private columnInRow(table: string, column: string, scope: EvalScope, node: DaxNode): DaxValue {
    const row = scope.rows.get(normalizeName(table));
    if (row) return this.columnValue(table, column, row);
    return this.unicoValor(
      this.valuesOfColumnRef(node, scope, `'${table}'[${column}]`),
      `'${table}'[${column}]`,
    );
  }

  private unicoValor(valores: DaxValue[], onde: string): DaxValue {
    if (valores.length === 0) return BLANK;
    const distintos = new Set(valores.map(identityKey));
    if (distintos.size > 1) {
      throw new DaxEvalError(
        `${onde}: usada como escalar mas tem ${distintos.size} valores distintos no contexto. ` +
          `Em DAX isso exige agregação explícita (SUM, MAX, SELECTEDVALUE...).`,
      );
    }
    return valores[0]!;
  }

  /**
   * `[Nome]` sem tabela. Pode ser coluna da tabela em contexto de linha ou
   * medida do modelo — nesta ordem, que é a do DAX.
   *
   * LIMITAÇÃO REGISTRADA: `[Nome]` também pode ser coluna de tabela anônima
   * criada por `SELECTCOLUMNS` (`RANKX(TabelaDatas, [Data], ...)`). Isso chega
   * com as funções de tabela, no passo 6. Até lá, se o nome casar com coluna ou
   * medida do modelo, resolve — possivelmente para a coisa errada.
   */
  private resolveNameRef(name: string, scope: EvalScope): DaxValue {
    for (const [tabela, row] of scope.rows) {
      if (this.model.column(tabela, name)) return this.columnValue(tabela, name, row);
    }
    if (this.model.measure(name)) return this.measureInScope(name, scope);
    throw new DaxEvalError(
      `[${name}] não resolve: não é medida do modelo nem coluna de tabela em contexto de linha.`,
    );
  }

  private resolveIdentifier(name: string, scope: EvalScope): DaxValue {
    const key = normalizeName(name);
    if (scope.vars.has(key)) {
      const v = scope.vars.get(key)!;
      if (isTableValue(v)) {
        throw new DaxEvalError(
          `A variável ${name} guarda uma tabela e está sendo usada como valor escalar.`,
        );
      }
      return v;
    }
    if (this.model.table(name)) {
      throw new DaxEvalError(`Tabela ${name} usada onde se espera valor escalar.`);
    }
    throw new DaxEvalError(
      `Identificador não resolve: ${name}. Não é VAR em escopo nem tabela do modelo. ` +
        `Se é palavra-chave de função (ASC, DENSE, DAY...), a função que a recebe não a tratou.`,
    );
  }

  /**
   * Avalia uma medida **no contexto corrente**, com a transição de contexto que o
   * DAX aplica: referência a medida vem embrulhada num `CALCULATE` implícito.
   *
   * Consequência prática, e é ela que faz a regra valer a pena: dentro de
   * `AVERAGEX(VALUES('T'[C]), [Medida])` a medida é calculada **por valor de C**.
   * Sem a transição, ela devolveria o total geral em toda linha e a média sairia
   * igual ao total — errado de um jeito que parece plausível.
   */
  measureInScope(name: string, scope: EvalScope): DaxValue {
    const m = this.model.measure(name);
    if (!m) throw new DaxEvalError(`Medida não existe no modelo: [${name}]`);

    const key = normalizeName(name);
    if (this.measureStack.includes(key)) {
      throw new DaxEvalError(
        `Ciclo entre medidas: ${[...this.measureStack, key].map((k) => `[${k}]`).join(' -> ')}`,
      );
    }
    this.measureStack.push(key);
    try {
      return this.evaluate(
        this.ast(m.dax),
        this.scopeWithFilter(scope, this.transitionRowContext(scope)),
      );
    } finally {
      this.measureStack.pop();
    }
  }

  private evalUnary(node: Extract<DaxNode, { type: 'Unary' }>, scope: EvalScope): DaxValue {
    const onde = `operador unário ${node.op} (linha ${node.pos.line})`;
    if (node.op === 'NOT') return !toBoolean(this.evaluate(node.operand, scope), onde);
    const n = toNumber(this.evaluate(node.operand, scope), onde);
    return node.op === '-' ? -n : n;
  }

  private evalBinary(node: Extract<DaxNode, { type: 'Binary' }>, scope: EvalScope): DaxValue {
    const onde = `operador ${node.op} (linha ${node.pos.line})`;

    // `&&` e `||` curto-circuitam: o lado direito não é avaliado se o esquerdo
    // já decide. Importa além de desempenho — o lado direito pode errar alto.
    if (node.op === '&&') {
      return toBoolean(this.evaluate(node.left, scope), onde)
        ? toBoolean(this.evaluate(node.right, scope), onde)
        : false;
    }
    if (node.op === '||') {
      return toBoolean(this.evaluate(node.left, scope), onde)
        ? true
        : toBoolean(this.evaluate(node.right, scope), onde);
    }

    const a = this.evaluate(node.left, scope);
    const b = this.evaluate(node.right, scope);

    switch (node.op) {
      case '&':
        return toText(a) + toText(b);

      // `=` trata BLANK como 0/""; `==` é estrito. Ver compareValues.
      case '=':
        return compareValues(a, b, false, onde) === 0;
      case '==':
        return compareValues(a, b, true, onde) === 0;
      case '<>':
        return compareValues(a, b, false, onde) !== 0;
      case '<':
        return compareValues(a, b, false, onde) < 0;
      case '<=':
        return compareValues(a, b, false, onde) <= 0;
      case '>':
        return compareValues(a, b, false, onde) > 0;
      case '>=':
        return compareValues(a, b, false, onde) >= 0;

      case '+':
        return toNumber(a, onde) + toNumber(b, onde);
      case '-':
        return toNumber(a, onde) - toNumber(b, onde);
      case '*':
        return toNumber(a, onde) * toNumber(b, onde);
      case '/':
        // Divisão por zero no operador `/` dá infinito no DAX — quem quer BLANK
        // usa DIVIDE. Não "consertamos" aqui: são funções diferentes de propósito.
        return toNumber(a, onde) / toNumber(b, onde);
      case '^':
        return toNumber(a, onde) ** toNumber(b, onde);
    }
  }

  private evalIn(node: Extract<DaxNode, { type: 'In' }>, scope: EvalScope): DaxValue {
    const onde = `IN (linha ${node.pos.line})`;
    const alvo = this.evaluate(node.value, scope);

    if (node.source.type === 'TableConstructor') {
      for (const linha of node.source.rows) {
        if (linha.length !== 1) {
          throw new DaxEvalError(`${onde}: construtor com ${linha.length} colunas; suportado 1.`);
        }
        if (compareValues(alvo, this.evaluate(linha[0]!, scope), false, onde) === 0) return true;
      }
      return false;
    }

    // `expr IN <tabela>` — a tabela tem de ter uma coluna só, como no DAX.
    const tabela = this.evaluateTable(node.source, scope, onde);
    if (tabela.columns.size !== 1) {
      throw new DaxEvalError(
        `${onde}: a tabela à direita tem ${tabela.columns.size} colunas; IN escalar exige 1.`,
      );
    }
    const coluna = [...tabela.columns][0]!;
    for (const row of tabela.rows) {
      if (compareValues(alvo, row[coluna] ?? BLANK, false, onde) === 0) return true;
    }
    return false;
  }
}
