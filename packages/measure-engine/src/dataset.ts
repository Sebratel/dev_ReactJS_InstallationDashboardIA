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
  /**
   * Colunas que existem no arquivo e foram **deixadas de fora de propósito** — a
   * projeção de `docs/DECISAO-DESEMPENHO.md`.
   *
   * Guardar isto não muda cálculo nenhum: muda a **mensagem** de quem pedir uma
   * delas. "não veio nos dados, o dataset do teste está incompleto" manda a próxima
   * pessoa procurar no lugar errado; "foi omitida pela projeção, e é por isto" manda
   * ela para a linha que decide. É a diferença entre um erro que ensina e um que
   * atrapalha, e é o que torna a projeção uma coisa segura de ligar.
   */
  readonly omitidas: Set<string>;
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
    this.tables.set(key, { name, rows: copiadas, physical, omitidas: new Set() });
  }

  /**
   * Registra a tabela **adotando** as linhas: sem cópia, e escrevendo nelas.
   *
   * `addTable` copia porque memorizar coluna calculada mexe no objeto de quem
   * chamou, e ninguém espera isso. Aqui é exatamente o contrário: a materialização
   * do snapshot **quer** que o valor caia nas linhas que ela vai gravar, e a cópia
   * é o problema. `field-agenda` tem 1,46 milhão de linhas com ~30 colunas; copiá-la
   * significa manter duas tabelas inteiras vivas no pico de um processo que já
   * carrega a camada M da mesma tabela. É gigabyte, não margem.
   *
   * **O preço da adoção é a chave já vir normalizada**, e isso é conferido aqui em
   * vez de assumido. Uma chave fora do padrão não daria erro no avaliador: ele
   * procuraria a coluna, não acharia, e devolveria BLANK — a coluna inteira viraria
   * zero calado no arquivo. A conferência varre **todas** as linhas, e é barata
   * porque cada chave distinta só é normalizada uma vez; as repetições são busca em
   * `Set` sobre a mesma string.
   */
  adotaTabela(name: string, rows: Row[], omitidas: Iterable<string> = []): void {
    const key = normalizeName(name);
    if (this.tables.has(key)) {
      throw new DaxEvalError(`Tabela já registrada no dataset: ${name}`);
    }
    const physical = new Set<string>();
    for (const r of rows) {
      for (const col in r) {
        if (physical.has(col)) continue;
        if (normalizeName(col) !== col) {
          throw new DaxEvalError(
            `adotaTabela('${name}'): a chave '${col}' não está normalizada ` +
              `(esperado '${normalizeName(col)}'). Adotar exige chave já normalizada — ` +
              `sem isso o avaliador não acharia a coluna e devolveria BLANK, calado. ` +
              `Use addTable se as linhas vêm de fora do pipeline.`,
          );
        }
        physical.add(col);
      }
    }
    this.tables.set(key, {
      name,
      rows,
      physical,
      omitidas: new Set([...omitidas].map(normalizeName)),
    });
  }

  hasTable(name: string): boolean {
    return this.tables.has(normalizeName(name));
  }

  /** A coluna existe no arquivo e ficou de fora da carga de propósito? */
  omitida(table: string, column: string): boolean {
    return this.tables.get(normalizeName(table))?.omitidas.has(normalizeName(column)) ?? false;
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
