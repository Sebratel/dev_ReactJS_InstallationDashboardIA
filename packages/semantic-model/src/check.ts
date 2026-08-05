// Verifica se o DAX do modelo referencia coisas que existem.
//
// Motivo de existir: antes de reimplementar 78 medidas, vale saber quais delas
// são reimplementáveis. Uma medida que aponta para uma tabela que não está no
// modelo não "vai dar trabalho" — ela não tem resultado nenhum, nem hoje no
// Power BI. Descobrir isso agora custa um scanner; descobrir na Fase 2 custa
// depurar um avaliador procurando um bug que está no PBIP.
//
// LIMITAÇÃO CONHECIDA. Um `[Nome]` dentro de expressão de tabela pode se
// referir a coluna criada ali, que não existe no modelo:
//
//     VAR TabelaDatas = SELECTCOLUMNS(..., "Data", TRUNC(...[Slot Agenda]))
//     RETURN RANKX(TabelaDatas, [Data], , ASC, DENSE)
//
// Aqui `[Data]` é a coluna da tabela anônima. O verificador resolve porque
// 'FIELD AGENDA'[Data] também existe — coincidência, não acerto. Resolver de
// verdade exige escopo de tabela, o que é trabalho do parser (Fase 2b). Até
// então: `nome-nao-resolvido` pode ser falso positivo em medida que usa
// SELECTCOLUMNS/ADDCOLUMNS; ausência de erro não prova que a referência é a
// que o autor queria.

import type { SemanticModel } from './model.ts';
import { declaredVars, extractRefs, type DaxRef } from './refs.ts';

export type ProblemKind =
  | 'tabela-inexistente'
  | 'coluna-inexistente'
  | 'nome-nao-resolvido'
  | 'palavra-nao-resolvida';

export interface ModelRefProblem {
  /** Onde está o DAX: `TABELA[MEDIDA]` ou `TABELA[COLUNA] (coluna calculada)`. */
  owner: string;
  kind: ProblemKind;
  detail: string;
  /**
   * `erro` = referência a tabela/coluna/medida que não existe: a expressão não
   * pode ser avaliada. `aviso` = identificador nu que não casou com tabela nem
   * VAR; costuma ser função DAX que o scanner não reconhece, então não bloqueia.
   */
  severity: 'erro' | 'aviso';
}

function checkExpression(
  model: SemanticModel,
  owner: string,
  ownerTable: string,
  dax: string,
): ModelRefProblem[] {
  const problems: ModelRefProblem[] = [];
  const vars = declaredVars(dax);
  const seen = new Set<string>();

  const push = (kind: ProblemKind, detail: string, severity: 'erro' | 'aviso') => {
    const key = `${kind}|${detail}`;
    if (seen.has(key)) return; // a mesma referência errada repete muito no DAX
    seen.add(key);
    problems.push({ owner, kind, detail, severity });
  };

  for (const ref of extractRefs(dax) as DaxRef[]) {
    if (ref.kind === 'table') {
      if (!model.table(ref.table)) {
        push('tabela-inexistente', `'${ref.table}'`, 'erro');
      }
      continue;
    }

    if (ref.kind === 'column') {
      if (!model.table(ref.table)) {
        push('tabela-inexistente', `'${ref.table}'[${ref.column}]`, 'erro');
        continue;
      }
      if (!model.column(ref.table, ref.column)) {
        push('coluna-inexistente', `'${ref.table}'[${ref.column}]`, 'erro');
      }
      continue;
    }

    if (ref.kind === 'bare') {
      // `[Nome]` resolve para medida (o nome é global em DAX) ou para coluna da
      // própria tabela.
      if (model.measure(ref.name)) continue;
      if (model.column(ownerTable, ref.name)) continue;
      push('nome-nao-resolvido', `[${ref.name}]`, 'erro');
      continue;
    }

    // ref.kind === 'word'
    if (model.table(ref.name)) continue;
    if (vars.has(ref.name.toLowerCase())) continue;
    push('palavra-nao-resolvida', ref.name, 'aviso');
  }

  return problems;
}

/** Roda a verificação nas 78 medidas, nas colunas calculadas e nas 7 tabelas calculadas. */
export function checkModelRefs(model: SemanticModel): ModelRefProblem[] {
  const problems: ModelRefProblem[] = [];

  for (const t of model.calculatedTables) {
    // A tabela calculada não tem "tabela dona": `[Nome]` dentro dela é coluna da
    // tabela anônima que ela mesma está construindo (`ADDCOLUMNS` sobre
    // `SELECTCOLUMNS`). Passar o próprio nome como ownerTable é o mais próximo
    // do certo, e a limitação já declarada no topo deste arquivo vale aqui em
    // dobro — em `Status Protocolo Dia` os `[protocolo]`/`[Dia]` são exatamente
    // esse caso.
    problems.push(
      ...checkExpression(model, `${t.name} (tabela calculada)`, t.name, t.tableDax!),
    );
  }

  for (const m of model.measures) {
    problems.push(...checkExpression(model, `${m.table}[${m.name}]`, m.table, m.dax));
  }
  for (const { table, column } of model.calculatedColumns) {
    problems.push(
      ...checkExpression(
        model,
        `${table.name}[${column.name}] (coluna calculada)`,
        table.name,
        column.dax!,
      ),
    );
  }

  return problems;
}

/** Só os que impedem avaliação. */
export function blockingProblems(problems: ModelRefProblem[]): ModelRefProblem[] {
  return problems.filter((p) => p.severity === 'erro');
}

/** Medidas/colunas distintas afetadas por erro, para relatório. */
export function affectedOwners(problems: ModelRefProblem[]): string[] {
  return [...new Set(blockingProblems(problems).map((p) => p.owner))].sort();
}
