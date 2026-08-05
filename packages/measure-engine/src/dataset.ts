// Os dados sobre os quais o DAX é avaliado.
//
// Deliberadamente em memória e sem conhecer banco: o Query Engine (Fase 1) já
// sabe buscar linhas, e o avaliador não deve ganhar uma dependência de driver.
// Assim os testes de paridade rodam sem credencial — que é a regra do projeto.

import { normalizeName } from '../../semantic-model/src/model.ts';
import { DaxEvalError, type DaxValue } from './value.ts';

/** Uma linha. As chaves são nomes de coluna **normalizados** (ver `Dataset`). */
export type Row = Record<string, DaxValue>;

interface TableData {
  /** nome como foi registrado, para mensagem de erro */
  readonly name: string;
  readonly rows: Row[];
  /** colunas que vieram nos dados (as calculadas não estão aqui) */
  readonly physical: Set<string>;
}

export class Dataset {
  private readonly tables = new Map<string, TableData>();

  /**
   * Registra uma tabela. As chaves das linhas são normalizadas na entrada, e as
   * linhas são **copiadas**: o avaliador memoriza coluna calculada escrevendo na
   * própria linha, e não deve mexer no objeto de quem chamou.
   *
   * Memorizar na linha é correto, não atalho: coluna calculada depende só da sua
   * linha, e no Power BI ela é materializada no refresh — o mesmo contrato.
   */
  addTable(name: string, rows: readonly Row[]): void {
    const key = normalizeName(name);
    if (this.tables.has(key)) {
      throw new DaxEvalError(`Tabela já registrada no dataset: ${name}`);
    }
    const physical = new Set<string>();
    const copiadas: Row[] = rows.map((r) => {
      const out: Row = {};
      for (const [col, valor] of Object.entries(r)) {
        const ck = normalizeName(col);
        physical.add(ck);
        out[ck] = valor;
      }
      return out;
    });
    this.tables.set(key, { name, rows: copiadas, physical });
  }

  hasTable(name: string): boolean {
    return this.tables.has(normalizeName(name));
  }

  /** Linhas físicas da tabela. Erra alto se a tabela não foi carregada. */
  rows(name: string): Row[] {
    const t = this.tables.get(normalizeName(name));
    if (!t) {
      throw new DaxEvalError(
        `Tabela '${name}' não está no dataset. ` +
          `Carregadas: ${[...this.tables.values()].map((x) => x.name).join(', ') || '(nenhuma)'}`,
      );
    }
    return t.rows;
  }

  /** A coluna veio nos dados? (`false` para coluna calculada e para inexistente.) */
  hasPhysicalColumn(table: string, column: string): boolean {
    return this.tables.get(normalizeName(table))?.physical.has(normalizeName(column)) ?? false;
  }

  get tableNames(): string[] {
    return [...this.tables.values()].map((t) => t.name);
  }
}
