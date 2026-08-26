// Transform Engine — executa a camada M (Power Query) que fica entre o SQL e a
// tabela que o DAX vê. Fase 2b.8.
//
// Estado: o parser existe e cobre as 23 queries escaneáveis. O avaliador e as 38
// funções (23 de tabela + 15 de valor) são o passo seguinte — ver README.

export type {
  MBinaryOp,
  MBinding,
  MCall,
  MEach,
  MField,
  MFunction,
  MIdentifier,
  MIf,
  MItem,
  MLet,
  MList,
  MLiteral,
  MNode,
  MRecord,
  MType,
  MUnary,
  Position,
} from './ast.ts';
export { parseM, parseMLet, MSyntaxError } from './parser.ts';
export { tokenize, type MToken, type MTokenKind } from './tokenizer.ts';
