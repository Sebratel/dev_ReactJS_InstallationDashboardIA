// Índice de igualdade por coluna — o caminho rápido de `'T'[c] = valor`.

import type { DaxNode } from './ast.ts';
import type { Row } from './dataset.ts';
import { normalizeName } from '../../semantic-model/src/model.ts';
import { identityKey, isBlank, isDate, type DaxValue } from './value.ts';

export type ClasseDeValor = 'texto' | 'numero' | 'branco';

export function classeDe(v: DaxValue): ClasseDeValor {
  if (isBlank(v)) return 'branco';
  if (typeof v === 'string') return 'texto';
  if (typeof v === 'number' || typeof v === 'boolean' || isDate(v)) return 'numero';
  return 'texto';
}

export const MINIMO_PARA_INDEXAR = 1_000;

export interface IgualdadeIndexavel {
  column: string;
  value: DaxNode;
}

export function igualdadeIndexavel(node: DaxNode, tabela: string): IgualdadeIndexavel | null {
  if (node.type !== 'Binary' || node.op !== '=') return null;
  const left = node.left;
  const right = node.right;
  if (left.type === 'ColumnRef' && normalizeName(left.table) === normalizeName(tabela)) {
    return { column: left.column, value: right };
  }
  if (right.type === 'ColumnRef' && normalizeName(right.table) === normalizeName(tabela)) {
    return { column: right.column, value: left };
  }
  return null;
}

export class IndiceDeIgualdade {
  private readonly baldes: Map<string, Row[]>;
  private readonly classes: Set<ClasseDeValor>;
  private readonly completo: boolean;

  constructor(rows: readonly Row[], coluna: string) {
    this.baldes = new Map();
    this.classes = new Set();
    let completo = true;
    for (const row of rows) {
      if (!(coluna in row)) {
        completo = false;
        break;
      }
      const v = row[coluna] ?? null;
      this.classes.add(classeDe(v));
      const k = identityKey(v);
      const balde = this.baldes.get(k);
      if (balde) balde.push(row);
      else this.baldes.set(k, [row]);
    }
    this.completo = completo;
    if (!completo) this.baldes.clear();
  }

  get distintos(): number {
    return this.baldes.size;
  }

  candidatos(valor: DaxValue): readonly Row[] | null {
    if (!this.completo) return null;

    const classe = classeDe(valor);
    if (classe === 'branco') return null;
    if (valor === 0 || valor === '') return null;

    const outra: ClasseDeValor = classe === 'texto' ? 'numero' : 'texto';
    if (this.classes.has(outra)) return null;

    return this.baldes.get(identityKey(valor)) ?? [];
  }
}

const cache = new WeakMap<readonly Row[], Map<string, IndiceDeIgualdade>>();

export function indiceDe(rows: readonly Row[], coluna: string): IndiceDeIgualdade | null {
  if (rows.length < MINIMO_PARA_INDEXAR) return null;
  let porColuna = cache.get(rows);
  if (!porColuna) {
    porColuna = new Map();
    cache.set(rows, porColuna);
  }
  let ind = porColuna.get(coluna);
  if (!ind) {
    ind = new IndiceDeIgualdade(rows, coluna);
    porColuna.set(coluna, ind);
  }
  return ind;
}
