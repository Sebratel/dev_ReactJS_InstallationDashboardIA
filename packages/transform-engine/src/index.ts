// Transform Engine — executa a camada M (Power Query) que fica entre o SQL e a
// tabela que o DAX vê. Fase 2b.8.
//
// Estado: parser + avaliador + primeira tranche de funções. O que falta está no
// README e no teste de cobertura contra o corpus.

export type {
  MBinaryOp,
  MBinding,
  MCall,
  MEach,
  MField,
  MFunctionExpr,
  MIdentifier,
  MIf,
  MItem,
  MLet,
  MListExpr,
  MLiteral,
  MNode,
  MRecordExpr,
  MType,
  MUnary,
  Position,
} from './ast.ts';
export { parseM, parseMLet, MSyntaxError } from './parser.ts';
export { tokenize, type MToken, type MTokenKind } from './tokenizer.ts';
export {
  MEvaluator,
  igual,
  type MCallContext,
  type MEvaluatorOptions,
  type MFunctionImpl,
  type MFunctionTable,
  type NotaM,
} from './evaluator.ts';
export {
  implementedMFunctions,
  MTipoIncompativel,
  standardConstants,
  standardFunctions,
} from './functions.ts';
export {
  exigeSemErro,
  isCellError,
  isList,
  isRecord,
  isTable,
  linha,
  MCellError,
  MDuration,
  MEvalError,
  MRecord,
  MTable,
  MTime,
  tabela,
  tipoDe,
  toDatasetRows,
  type MRow,
  type MValue,
  type ScalarOut,
} from './value.ts';
export {
  deLinhas,
  queryDependencies,
  queryOrder,
  runQueries,
  usaFonteExterna,
  type FonteDeLinhas,
  type MQuerySpec,
  type QueryExecutada,
  type RunnerOptions,
} from './runner.ts';
export {
  fonteDoEngine,
  FonteError,
  type ExecutorDeQuery,
  type FonteDoEngineOptions,
} from './fonte.ts';
