// Valores da linguagem M e o valor de tabela.
//
// Duas decisões aqui carregam o resto da fase, e as duas são sobre **ordem**:
//
//   1. **`MTable` guarda ordem de coluna e ordem de linha, explicitamente.** Não é
//      zelo: `Table.Distinct` mantém a **primeira** linha da ordem corrente, e em
//      `PROTOCOLOS GERAL` a ordem que decide qual supervisor sobra vem de um
//      `Table.Sort` três passos antes, atravessando uma mesclagem
//      (ACHADOS #15 e o fato decisivo 3 de DECISAO-CAMADA-M.md). Um valor de
//      tabela sem ordem responderia a contagem certa com a linha errada — e isso
//      não aparece como erro, aparece como supervisor trocado no dashboard.
//   2. **Nome de coluna não é normalizado aqui.** M distingue caixa e preserva
//      espaço: `[DATA CRIADO]` é diferente de `[data criado]`. A normalização
//      acontece só na fronteira com o `Dataset` do avaliador de DAX
//      (`toDatasetRows`), onde ela é a regra de lá — não a de cá.
//
// A ressalva de memória, registrada e não resolvida: as linhas são materializadas
// em array. `field-agenda` tem 1,4 milhão de linhas (ACHADOS #2). Enquanto as
// tabelas do escopo desta fase não passam de dezenas de milhares, isso serve; a
// alternativa (streaming) muda a assinatura de todas as funções de tabela, e não
// vale pagar antes de precisar. Se precisar, o lugar é aqui.

/**
 * Um valor M.
 *
 * O escopo é o que o corpus usa. `MTime` e `MDuration` existem como marcas
 * próprias em vez de virarem número solto: `DateTime.Time` devolve time, e time
 * somado a número não é a mesma coisa que número somado a número.
 */
export type MValue =
  | number
  | string
  | boolean
  | Date
  | null
  | MTable
  | MList
  | MRecord
  | MFunction
  | MTime
  | MDuration
  /** Binário. `feriados` traz uma tabela inteira embutida como base64 + deflate. */
  | Uint8Array
  /** Célula de Erro. Ver `MCellError`. */
  | MCellError;

export type MList = readonly MValue[];

/**
 * Registro M: campos ordenados, nome preservado como escrito.
 *
 * **O `Map` é materializado só quando alguém precisa iterar os campos**, e isso é
 * decisão de desempenho medida, não elegância. `Table.SelectRows` e
 * `Table.AddColumn` criam um registro **por linha** só para o `each [COLUNA]` ler
 * um campo; em `protocolos-produtividade` são 65 mil linhas × 60 passos. Copiar 48
 * campos para responder um foi 24% do tempo em coletor de lixo no perfil de
 * 06/08/2026. Um registro criado por `daLinha` compartilha o `Map` da linha, que já
 * é imutável (`MRow` é `ReadonlyMap`), e não copia nada.
 */
export class MRecord {
  /** Materializado sob demanda quando o registro vem de `daLinha`. */
  private mapa: Map<string, MValue> | null;
  /** A forma do registro quando ele espelha uma linha: quem define é a tabela. */
  private readonly colunas: readonly string[] | null;
  private readonly linhaFonte: MRow | null;

  constructor(fields: Iterable<readonly [string, MValue]>);
  /**
   * Espelha uma linha, sem copiar campo. `colunas` é a **forma** — a da tabela, não
   * a do `Map` da linha: linha que não guardou uma coluna a tem como `null`, e é
   * isso que o M vê.
   */
  constructor(colunas: readonly string[], linha: MRow);
  constructor(a: Iterable<readonly [string, MValue]> | readonly string[], linha?: MRow) {
    if (linha !== undefined) {
      this.mapa = null;
      this.colunas = a as readonly string[];
      this.linhaFonte = linha;
      return;
    }
    this.mapa = new Map(a as Iterable<readonly [string, MValue]>);
    this.colunas = null;
    this.linhaFonte = null;
  }

  get fields(): ReadonlyMap<string, MValue> {
    if (this.mapa === null) {
      const m = new Map<string, MValue>();
      for (const c of this.colunas!) m.set(c, this.linhaFonte!.get(c) ?? null);
      this.mapa = m;
    }
    return this.mapa;
  }

  get(name: string): MValue {
    // Caminho quente: o registro espelha uma linha e o campo está lá. `undefined`
    // só acontece quando a linha não guardou a coluna — aí cai no caminho exato,
    // que distingue "coluna existe e vale null" de "campo não existe".
    if (this.mapa === null) {
      const v = this.linhaFonte!.get(name);
      if (v !== undefined) return v;
    }
    if (!this.fields.has(name)) {
      throw new MEvalError(
        `Registro não tem o campo '${name}'. Campos: ${[...this.fields.keys()].join(', ') || '(nenhum)'}`,
      );
    }
    return this.fields.get(name)!;
  }

  has(name: string): boolean {
    if (this.mapa === null && this.linhaFonte!.has(name)) return true;
    return this.fields.has(name);
  }

  with(name: string, valor: MValue): MRecord {
    const m = new Map(this.fields);
    m.set(name, valor);
    return new MRecord(m);
  }
}

/** Função M: `each …` ou `(x) => …`, já fechada sobre o ambiente onde nasceu. */
export interface MFunction {
  readonly kind: 'function';
  readonly arity: number;
  readonly call: (args: readonly MValue[]) => MValue;
}

export function isFunction(v: MValue): v is MFunction {
  return typeof v === 'object' && v !== null && (v as MFunction).kind === 'function';
}

/**
 * Hora do dia, em milissegundos desde a meia-noite.
 *
 * Existe separado de `Date` porque é o que `DateTime.Time` devolve, e porque três
 * colunas do modelo são disso (`[HORA CRIADO]`, `[HORA AGENDA]`,
 * `[HR. ALOCAÇÃO]`). Na fronteira com o DAX vira `Date` sobre 1899-12-30, que é a
 * convenção do Power BI: assim `serialFromDate` devolve a fração do dia, e a hora
 * continua sendo número com formato, como o DAX espera.
 */
export class MTime {
  readonly ms: number;

  constructor(ms: number) {
    if (!Number.isFinite(ms) || ms < 0 || ms >= 86_400_000) {
      throw new MEvalError(`Hora fora do dia: ${ms}ms.`);
    }
    this.ms = ms;
  }
}

/** Duração, em milissegundos. `Duration.Days` lê daqui. */
export class MDuration {
  readonly ms: number;

  constructor(ms: number) {
    this.ms = ms;
  }
}

/** A duração como o snapshot a grava e o DAX a lê: dias, em número. Uma regra só, para o disco e o poller. */
export function duracaoEmDias(d: MDuration): number {
  return d.ms / 86_400_000;
}

export class MEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MEvalError';
  }
}

/**
 * Uma **célula de Erro**: o valor que o Power Query guarda numa célula cuja
 * conversão de tipo falhou, sem derrubar a tabela.
 *
 * Existe porque `Table.TransformColumnTypes` no Power Query é por célula, não por
 * tabela. Em `QUADRO FUNCIONAL`, `MINDSIGTH` é declarada `type number` e tem 68
 * células com texto (`"Fit 52,0"`, `"Não se aplica"`), e `RG` (`Int64.Type`) tem 16
 * (`"B057890-A"`). O relatório de hoje funciona porque as 84 caem fora do filtro
 * de gestor e nenhuma medida cita as duas colunas — o Power BI marca as células
 * como Erro e segue. Derrubar a query aqui não seria rigor, seria divergir da
 * fonte que estamos replicando (ACHADOS #24).
 *
 * **Isto não afrouxa o fail-loud, muda de onde ele grita.** A célula é inerte
 * enquanto ninguém a lê: sobreviver a um filtro, ser reordenada, ser descartada.
 * No instante em que alguém a *usa* — `[MINDSIGTH] + 1`, uma comparação, ou a
 * ida para o modelo semântico — o erro original é levantado, com coluna e linha.
 * O que nunca acontece é virar `null` ou continuar texto em silêncio, que é
 * exatamente o modo de falha do achado 1.
 */
export class MCellError {
  /** Por que a conversão falhou. É a mensagem que sobe quando alguém lê a célula. */
  readonly motivo: string;
  /** A coluna, para a mensagem dizer onde. */
  readonly coluna: string;
  /** O valor que estava lá antes. Guardado para diagnóstico, não para uso. */
  readonly original: MValue;

  constructor(motivo: string, coluna: string, original: MValue) {
    this.motivo = motivo;
    this.coluna = coluna;
    this.original = original;
  }
}

export function isCellError(v: MValue): v is MCellError {
  return v instanceof MCellError;
}

/**
 * Levanta o erro guardado se `v` for célula de Erro; devolve `v` intacto se não.
 *
 * É o ponto único onde a célula deixa de ser inerte. `onde` diz o que a estava
 * lendo, porque a pergunta seguinte de quem vê o erro é sempre "qual passo".
 */
export function exigeSemErro(v: MValue, onde: string): MValue {
  if (v instanceof MCellError) {
    throw new MEvalError(`${onde}: ${v.motivo}`);
  }
  return v;
}

/** Uma linha: nome de coluna (como escrito) → valor. */
export type MRow = ReadonlyMap<string, MValue>;

/**
 * Tabela M: colunas ordenadas e linhas ordenadas.
 *
 * As linhas são `Map` e não objeto simples por um motivo prático: nome de coluna
 * da base tem espaço, acento e `#` (`[HR. ALOCAÇÃO]`), e `Map` não confunde nada
 * disso com propriedade de protótipo — `row["constructor"]` num objeto simples
 * devolveria função em vez de `undefined`.
 */
export class MTable {
  readonly columns: readonly string[];
  readonly rows: readonly MRow[];

  constructor(columns: readonly string[], rows: readonly MRow[]) {
    const vistas = new Set<string>();
    for (const c of columns) {
      if (vistas.has(c)) {
        throw new MEvalError(`Tabela com coluna duplicada: '${c}'.`);
      }
      vistas.add(c);
    }
    this.columns = columns;
    this.rows = rows;
  }

  get rowCount(): number {
    return this.rows.length;
  }

  hasColumn(name: string): boolean {
    return this.columns.includes(name);
  }

  /**
   * Erra alto quando a coluna não existe, listando as que existem.
   *
   * É a mensagem que aparece no dia em que alguém renomeia coluna na fonte, e é
   * por isso que ela lista as disponíveis: o mesmo erro sem a lista manda a
   * pessoa abrir o Power BI para descobrir o nome novo.
   */
  exigeColuna(name: string, onde: string): void {
    if (!this.hasColumn(name)) {
      throw new MEvalError(
        `${onde}: a tabela não tem a coluna '${name}'. Colunas: ${this.columns.join(', ')}`,
      );
    }
  }

  /** Nova tabela com as mesmas colunas e outras linhas. */
  comLinhas(rows: readonly MRow[]): MTable {
    return new MTable(this.columns, rows);
  }
}

export function isTable(v: MValue): v is MTable {
  return v instanceof MTable;
}

export function isRecord(v: MValue): v is MRecord {
  return v instanceof MRecord;
}

export function isList(v: MValue): v is MList {
  return Array.isArray(v);
}

/** Constrói uma linha a partir de pares, na ordem dada. */
export function linha(pares: Iterable<readonly [string, MValue]>): MRow {
  return new Map(pares);
}

/**
 * Linha a partir das colunas e de um provedor de valor — **sem alocar par
 * intermediário**.
 *
 * Existe por medição. O idioma natural, `linha(t.columns.map((c) => [c, r.get(c)]))`,
 * cria um array de N arrays de dois elementos por linha, e o `Map` os descarta
 * imediatamente: em `protocolos-produtividade` são 65 mil linhas × 48 colunas × 60
 * passos de lixo puro, e o perfil de 06/08/2026 mediu 24% do tempo em coletor de
 * lixo. Aqui o valor vai direto para o `Map`.
 *
 * A ordem de inserção segue `columns`, que é a ordem de coluna da tabela — e ordem
 * de coluna é parte da semântica de M, não detalhe (ver o topo deste arquivo).
 */
export function linhaPor(
  columns: readonly string[],
  valor: (coluna: string, i: number) => MValue,
): MRow {
  const m = new Map<string, MValue>();
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i]!;
    m.set(c, valor(c, i));
  }
  return m;
}

/** Tabela a partir de registros, com a ordem de coluna dada explicitamente. */
export function tabela(columns: readonly string[], linhas: readonly MRow[]): MTable {
  return new MTable(columns, linhas);
}

// ---------------------------------------------------------------------------
// Descrição de tipo, para mensagem de erro
// ---------------------------------------------------------------------------

export function tipoDe(v: MValue): string {
  if (v === null) return 'null';
  if (v instanceof MCellError) return 'célula de erro';
  if (v instanceof MTable) return 'table';
  if (v instanceof MRecord) return 'record';
  if (v instanceof MTime) return 'time';
  if (v instanceof MDuration) return 'duration';
  if (v instanceof Uint8Array) return 'binary';
  if (v instanceof Date) return 'datetime';
  if (Array.isArray(v)) return 'list';
  if (isFunction(v)) return 'function';
  return typeof v; // number | string | boolean
}

// ---------------------------------------------------------------------------
// Fronteira com o avaliador de DAX
// ---------------------------------------------------------------------------

/** Valor escalar aceito pelo `Dataset` do avaliador de DAX. */
export type ScalarOut = number | string | boolean | Date | null;

const EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * Converte a tabela M para as linhas que `Dataset.addTable` espera.
 *
 * Duas conversões acontecem aqui, e só aqui:
 *
 * - **`MTime` vira `Date` sobre 1899-12-30.** É a convenção do Power BI: hora é
 *   fração de dia sobre a mesma época que o número de série de data usa. Assim
 *   `serialFromDate` de `08:30` dá `0,354…`, e a hora segue sendo número com
 *   formato do lado do DAX.
 * - **Nome de coluna é normalizado** (o `Dataset` normaliza de novo, mas fazer
 *   aqui deixa a colisão visível **antes**: duas colunas M que só diferem em
 *   caixa viram a mesma chave lá, e silenciosamente uma sobrescreve a outra).
 *
 * O que **não** é convertido: lista, registro, tabela e função dentro de célula.
 * Isso é erro, e erro certo — uma coluna de mesclagem não expandida chegando ao
 * DAX apareceria como célula estranha em vez de como passo M esquecido.
 */
export function toDatasetRows(
  t: MTable,
  onde: string,
): { columns: string[]; rows: Record<string, ScalarOut>[] } {
  const normal = t.columns.map((c) => c.trim().toLowerCase());
  const vistas = new Map<string, string>();
  for (let i = 0; i < normal.length; i++) {
    const anterior = vistas.get(normal[i]);
    if (anterior !== undefined) {
      throw new MEvalError(
        `${onde}: as colunas '${anterior}' e '${t.columns[i]}' viram a mesma chave ` +
          `('${normal[i]}') no modelo semântico. Uma sobrescreveria a outra em silêncio.`,
      );
    }
    vistas.set(normal[i], t.columns[i]);
  }

  const rows = t.rows.map((r, iLinha) => {
    const out: Record<string, ScalarOut> = {};
    for (let i = 0; i < t.columns.length; i++) {
      out[normal[i]] = escalar(r.get(t.columns[i]) ?? null, t.columns[i], iLinha, onde);
    }
    return out;
  });
  return { columns: normal, rows };
}

function escalar(v: MValue, coluna: string, iLinha: number, onde: string): ScalarOut {
  if (v === null) return null;
  // Célula de Erro que chega até aqui é erro de verdade: o modelo semântico não
  // tem como representá-la, e virar `null` seria inventar dado. No corpus de hoje
  // isto não acontece (as 84 células ruins de QUADRO FUNCIONAL caem fora do
  // filtro) — se um dia acontecer, é decisão de negócio, não de engine.
  if (v instanceof MCellError) {
    throw new MEvalError(
      `${onde}: a coluna '${coluna}' tem célula de Erro na linha ${iLinha + 1} e o passo de ` +
        `tipo a produziu de propósito (${v.motivo}). O modelo semântico não aceita ` +
        'célula de Erro: trate na camada M (Table.RemoveRowsWithErrors, ' +
        'Table.ReplaceErrorValues) como o Power Query exigiria.',
    );
  }
  if (v instanceof MTime) return new Date(EPOCH_MS + v.ms);
  if (v instanceof MDuration) return duracaoEmDias(v);
  if (v instanceof Uint8Array) {
    throw new MEvalError(
      `${onde}: a coluna '${coluna}' tem binário na linha ${iLinha + 1}. Binário é passo ` +
        'intermediário (base64 → deflate → JSON), não valor de coluna.',
    );
  }
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  throw new MEvalError(
    `${onde}: a coluna '${coluna}' tem ${tipoDe(v)} na linha ${iLinha + 1}, e o modelo ` +
      'semântico só aceita escalar. Provável mesclagem sem `Table.ExpandTableColumn`.',
  );
}
