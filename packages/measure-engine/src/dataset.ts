// Os dados sobre os quais o DAX é avaliado.
//
// Deliberadamente em memória e sem conhecer banco: o Query Engine (Fase 1) já
// sabe buscar linhas, e o avaliador não deve ganhar uma dependência de driver.
// Assim os testes de paridade rodam sem credencial — que é a regra do projeto.

import { normalizeName } from '../../semantic-model/src/model.ts';
import { DaxEvalError, type DaxValue } from './value.ts';

/** Uma linha. As chaves são nomes de coluna **normalizados** (ver `Dataset`). */
export type Row = Record<string, DaxValue>;

/**
 * O protocolo que permite a uma linha **não ser um objeto simples**.
 *
 * Uma `Row` é lida de três formas, e só uma delas sobrevive a trocar o objeto por
 * uma vista sobre armazenamento colunar:
 *
 * | forma | numa vista |
 * |---|---|
 * | `row[c]` e `c in row` | funcionam — acessor de protótipo responde aos dois |
 * | `for (const c in row)` | funciona — acessor enumerável entra no `for...in` |
 * | `Object.keys(row)` e `{...row}` | **não** — os dois só enxergam propriedade PRÓPRIA |
 *
 * As duas últimas devolveriam a linha VAZIA, sem erro nenhum: `transitionRowContext`
 * deixaria de transicionar e `ADDCOLUMNS` perderia as colunas de origem. Número
 * plausível e diferente — a classe de falha que este projeto não aceita.
 *
 * Então elas passam por `colunasDe` e `copiaLinha`, que perguntam à linha em vez de
 * assumir. Objeto simples continua respondendo `Object.keys`; quem implementa o
 * protocolo responde por si. O símbolo mora aqui, e não no pacote da vista, para a
 * dependência apontar de `snapshot` para `measure-engine`, que é o sentido que já
 * existe.
 */
export const COLUNAS_DA_LINHA = Symbol('colunasDaLinha');

/** Uma linha que sabe dizer quais colunas tem. Implementar isto é opcional. */
export interface LinhaQueSeDescreve {
  [COLUNAS_DA_LINHA](): string[];
}

/**
 * O segundo protocolo da vista: entregar o **dicionário** por trás de uma coluna
 * física, e o índice desta linha dentro dele.
 *
 * `COLUNAS_DA_LINHA` existe para a vista não MENTIR sobre si. Este existe para ela
 * poder ser mais rápida: quem vai aplicar a mesma coluna a muitas linhas pode
 * calcular uma vez por VALOR DISTINTO em vez de uma vez por linha — e no dado real
 * a diferença é de ordem de grandeza (`item` de `protocolos-produtividade` tem 1
 * valor distinto em 76.398 linhas; `cidade`, 17).
 *
 * **Devolver `null` é sempre seguro**, e é o que um objeto simples faz por omissão:
 * quem chama volta a ler valor por valor. Uma coluna calculada memoizada na linha
 * também cai aqui, porque ela não está no armazenamento.
 *
 * Os dois símbolos moram neste arquivo pelo mesmo motivo que `COLUNAS_DA_LINHA`:
 * a dependência aponta de `snapshot` para `measure-engine`, e não o contrário.
 */
export const DICIONARIO_DA_COLUNA = Symbol('dicionarioDaColuna');

/** Onde uma linha que vem de armazenamento colunar expõe o seu índice. */
export const INDICE_DA_LINHA = Symbol('indiceDaLinha');

/** Os valores distintos de uma coluna e o id de cada linha. Ver o símbolo acima. */
export interface DicionarioDeColuna {
  /** Valores distintos, indexados por id. */
  readonly valores: readonly DaxValue[];
  /** Um id por linha da TABELA, na ordem de `INDICE_DA_LINHA`. */
  readonly ids: Int32Array;
}

/** Uma linha que vem de armazenamento colunar. Implementar isto é opcional. */
export interface LinhaColunar {
  readonly [INDICE_DA_LINHA]: number;
  [DICIONARIO_DA_COLUNA](chaveColuna: string): DicionarioDeColuna | null;
}

/**
 * O dicionário da coluna por trás desta linha, ou `null` quando não há um.
 *
 * A chave tem de vir **normalizada** — é a mesma regra de
 * `temColunaFisicaPorChave`, e pelo mesmo motivo: quem pergunta isto está no
 * caminho quente e já normalizou.
 */
export function dicionarioDaColuna(row: Row, chaveColuna: string): DicionarioDeColuna | null {
  const f = (row as Partial<LinhaColunar>)[DICIONARIO_DA_COLUNA];
  return typeof f === 'function' ? f.call(row, chaveColuna) : null;
}

/**
 * O índice desta linha no armazenamento, ou `-1` quando ela não vem de um.
 *
 * `-1` e não `null` de propósito: quem chama isto está dentro do laço, e comparar
 * com um número evita o ramo de tipo. Um `-1` nunca indexa por acidente — arrays
 * tipados devolvem `undefined` nele, e o chamador sempre confere antes.
 */
export function indiceDaLinha(row: Row): number {
  const i = (row as Partial<LinhaColunar>)[INDICE_DA_LINHA];
  return typeof i === 'number' ? i : -1;
}

/**
 * As colunas presentes na linha — inclusive as calculadas já memoizadas nela.
 *
 * Substitui `Object.keys(row)`. Para um objeto simples é exatamente isso; para uma
 * vista, é o que ela declara.
 */
export function colunasDe(row: Row): string[] {
  const proprio = (row as Partial<LinhaQueSeDescreve>)[COLUNAS_DA_LINHA];
  return typeof proprio === 'function' ? proprio.call(row) : Object.keys(row);
}

/**
 * Uma cópia **independente e simples** da linha, para quem vai acrescentar colunas
 * nela (`ADDCOLUMNS`, `SELECTCOLUMNS`).
 *
 * Substitui `{ ...row }`. O resultado é sempre objeto simples, de propósito: a linha
 * nova pertence a uma tabela anônima, que não tem armazenamento colunar por trás.
 */
export function copiaLinha(row: Row): Row {
  const out: Row = {};
  for (const c of colunasDe(row)) out[c] = row[c] as DaxValue;
  return out;
}

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
    // **O molde já conferido.** Numa vista as colunas moram no PROTÓTIPO — um por
    // tabela — e a linha não tem propriedade própria enumerável (o índice é um
    // `Symbol`). Protótipo repetido significa, por construção, exatamente as mesmas
    // chaves; reconferir é enumerar 30 acessores por linha para chegar ao mesmo
    // conjunto. Medido em 14/09/2026 nas 14 páginas, `adotaTabela` era 3,5% do
    // perfil inteiro, quase todo aqui.
    //
    // O atalho é **só** para quem implementa `COLUNAS_DA_LINHA`: um objeto simples
    // tem `Object.prototype` como todos os outros e as chaves dele variam de linha
    // para linha (linha esparsa é o caso normal), então ali a conferência continua
    // linha a linha, como sempre foi.
    let moldeConferido: object | null = null;
    for (const r of rows) {
      if (COLUNAS_DA_LINHA in r) {
        const molde = Object.getPrototypeOf(r) as object;
        if (molde === moldeConferido) continue;
        moldeConferido = molde;
      }
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
    return this.temColunaFisicaPorChave(normalizeName(table), normalizeName(column));
  }

  /**
   * O mesmo que `hasPhysicalColumn`, para quem **já** normalizou as duas chaves.
   *
   * Existe por medição, não por gosto. `columnValue` é o laço mais quente do
   * avaliador, e até 13/09/2026 ele normalizava o nome da coluna uma vez para si e
   * outra dentro de `hasPhysicalColumn`, mais o da tabela — **três normalizações**
   * por célula lida. No perfil de `instalacao-reincidente` isso somava 3,8 s dos
   * 10,2 s da página, depois de `normalizeName` já estar memoizada.
   *
   * **A chave tem de vir normalizada, e isto não confere.** Conferir custaria
   * exatamente a normalização que o método existe para evitar. Passar uma chave
   * crua aqui não dá erro: dá `false`, e `columnValue` trataria a coluna física
   * como calculada — ou erraria dizendo que ela não existe no modelo. Por isso o
   * método é o caminho da exceção e `hasPhysicalColumn` continua sendo a porta
   * normal, com os nomes como vierem.
   */
  temColunaFisicaPorChave(chaveTabela: string, chaveColuna: string): boolean {
    return this.tables.get(chaveTabela)?.physical.has(chaveColuna) ?? false;
  }

  get tableNames(): string[] {
    return [...this.tables.values()].map((t) => t.name);
  }
}
