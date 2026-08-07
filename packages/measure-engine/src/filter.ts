// Contexto de filtro.
//
// A regra que dá forma a este arquivo: em DAX, filtro de `CALCULATE` **substitui**
// o filtro existente sobre a mesma coluna, em vez de somar com ele. É a diferença
// entre `CALCULATE([Total], 'T'[Ano] = 2026)` dentro de um contexto já filtrado por
// 2025 dar o total de 2026 (certo) ou dar vazio (o que uma interseção ingênua daria).
//
// Por isso cada filtro carrega **quais colunas ele restringe**: é o que permite
// saber o que substituir. Guardar só uma lista de linhas visíveis não permitiria.
//
// LIMITE DESTE MODELO, declarado. O motor real do Power BI guarda tabelas de
// filtro, não predicados por coluna. A diferença aparece em filtro que correlaciona
// colunas — `FILTER(T, T[a] > T[b])` restringe o *par*, e aqui ele é registrado
// como restringindo `a` e `b` separadamente. Para as 60 chamadas desta base os dois
// modelos coincidem; se algum dia divergirem, é aqui que se olha.

import { normalizeName } from '../../semantic-model/src/model.ts';
import type { Dataset, Row } from './dataset.ts';
import { indiceDe } from './indice.ts';
import { type Propagation, type PropagationEdge, describeEdge } from './propagation.ts';
import { BLANK, DaxEvalError, type DaxValue, identityKey, isBlank } from './value.ts';

/**
 * Resultado de expressão de tabela, no subconjunto que a base usa.
 *
 * Uma forma só para todas: `'T'` inteira, `VALUES('T'[C])`, `ALL('T'[C])`,
 * `FILTER(...)` e `TREATAS(...)` só diferem em quais colunas expõem e quais linhas
 * sobram. Unificar não é economia de código — é o que permite tratar **todo**
 * argumento de tabela do `CALCULATE` pelo mesmo caminho, incluindo `ALL`.
 */
export interface TableValue {
  readonly kind: 'table';
  /**
   * Tabela do modelo de onde as linhas vêm, ou `null` para tabela **anônima**.
   *
   * `SELECTCOLUMNS(calendar, "Prot", calendar[Protocolo])` produz colunas que não
   * existem em tabela nenhuma, e `INTERSECT` de duas dessas mistura linhas de
   * `calendar` e de `FIELD AGENDA` — não há tabela do modelo a que o resultado
   * pertença. Tabela anônima conta linha e cria contexto de linha, mas **não pode
   * virar filtro**: não há coluna de modelo para restringir.
   */
  readonly table: string | null;
  /** Colunas expostas, normalizadas. `VALUES('T'[C])` expõe só `c`. */
  readonly columns: Set<string>;
  readonly rows: Row[];
}

export function isTableValue(v: unknown): v is TableValue {
  return typeof v === 'object' && v !== null && (v as TableValue).kind === 'table';
}

export function makeTableValue(
  table: string | null,
  columns: Iterable<string>,
  rows: Row[],
): TableValue {
  return {
    kind: 'table',
    table: table === null ? null : normalizeName(table),
    columns: new Set([...columns].map(normalizeName)),
    rows,
  };
}

/** Colunas na ordem em que foram declaradas. `UNION` e `EXCEPT` casam por posição. */
export function orderedColumns(tv: TableValue): string[] {
  return [...tv.columns];
}

/** Chave de uma linha considerando só as colunas dadas. Usada para conjunto e distinção. */
export function rowKey(row: Row, columns: Iterable<string>): string {
  const partes: string[] = [];
  for (const c of columns) partes.push(identityKey(row[c] ?? (null as DaxValue)));
  return partes.join('\u0000');
}

/**
 * Converte uma tabela em filtro: a linha passa se seus valores nas colunas
 * expostas aparecem em alguma linha da tabela.
 *
 * É por aqui que `ALL('T'[C])` funciona sem tratamento especial. Ele devolve todos
 * os valores de `C`, então o filtro resultante não exclui nada — e, como filtro
 * novo **substitui** o antigo sobre `C`, o efeito é remover o filtro anterior.
 * Exatamente o que `ALL` faz no DAX.
 */
export function filterFromTable(tv: TableValue, origem: string): TableFilter {
  if (tv.table === null) {
    throw new DaxEvalError(
      `${origem}: tabela anônima não pode ser usada como filtro — as colunas dela ` +
        `(${[...tv.columns].join(', ')}) não existem em nenhuma tabela do modelo. ` +
        `Use TREATAS para apontá-la para uma coluna de destino.`,
    );
  }
  const permitidas = new Set<string>();
  for (const row of tv.rows) permitidas.add(rowKey(row, tv.columns));
  const tabela = tv.table;
  return {
    table: tabela,
    columns: new Set(tv.columns),
    origem,
    igualdade: igualdadeConstante(tv),
    keep: (row) => permitidas.has(rowKey(row, tv.columns)),
  };
}

/**
 * Uma coluna em que **todas** as linhas de `tv` têm o mesmo valor.
 *
 * É o que torna `CALCULATE(MAX('T'[x]), FILTER('T', 'T'[k] = <var>))` viável. O
 * `FILTER` já ficou rápido pelo índice, mas o `MAX` depois dele avalia num contexto
 * onde este filtro **substituiu** os anteriores sobre as mesmas colunas — então
 * `linhasVisiveis` recomeça da tabela inteira e testa `keep` linha a linha, que em
 * `FIELD AGENDA` é 1,46 milhão de `rowKey` sobre 19 colunas. Medido na reprodução
 * sintética: 38 ms por consulta, contra 0 ms dos outros dois caminhos.
 *
 * **Por que derivar uma igualdade em vez de partir das linhas de `tv`.** Partir
 * delas seria errado, e errado do jeito silencioso: este filtro derruba os filtros
 * anteriores sobre as colunas dele, então uma linha que o contexto de fora escondia
 * volta a ser visível e **passa** no `keep` se tiver os mesmos valores de alguma
 * linha de `tv`. Ela não está em `tv.rows`, e começar por ali a perderia — número
 * menor, plausível, sem aviso. É a mesma armadilha do achado #38.
 *
 * A igualdade não tem esse problema: se toda linha de `tv` tem `c = v`, então toda
 * chave em `permitidas` tem `v` na posição de `c`, e **toda** linha que passa no
 * `keep` tem `c = v` — inclusive a que estava escondida. O balde do índice contém
 * todas elas.
 *
 * `tv.rows` aqui é o resultado de um filtro, quase sempre pequeno, e a varredura é
 * abandonada no primeiro valor divergente de cada coluna.
 */
function igualdadeConstante(tv: TableValue): { coluna: string; valor: DaxValue } | undefined {
  if (tv.rows.length === 0) return undefined;
  const primeira = tv.rows[0]!;
  for (const coluna of tv.columns) {
    const valor = primeira[coluna] ?? (null as DaxValue);
    // BLANK não serve: `candidatos()` recusa procurar por BLANK (ele casa com 0 e
    // com ""), então derivá-la só gastaria a varredura abaixo à toa.
    //
    // **Isto é economia, não segurança** — e está dito porque o teste de mutação
    // confirma: tirar esta linha não derruba teste nenhum, porque o guarda de
    // `candidatos()` recusa a busca logo depois e o resultado não muda. Quem vier
    // depois não deve confundi-la com os guardas de `indice.ts`, que são regra.
    if (isBlank(valor)) continue;
    const chave = identityKey(valor);
    let constante = true;
    for (let i = 1; i < tv.rows.length; i++) {
      if (identityKey(tv.rows[i]![coluna] ?? (null as DaxValue)) !== chave) {
        constante = false;
        break;
      }
    }
    if (constante) return { coluna, valor };
  }
  return undefined;
}

/** Um filtro sobre uma tabela do modelo. */
export interface TableFilter {
  /** Nome da tabela, normalizado. */
  table: string;
  /**
   * Colunas que este filtro restringe, normalizadas. É a chave da substituição:
   * um filtro novo que toque qualquer uma delas derruba este.
   *
   * Vazio significa "a tabela toda" — usado por filtro cuja expressão não
   * referencia coluna nenhuma (constante), que portanto não é substituível por
   * filtro de coluna.
   */
  columns: Set<string>;
  /** Descrição para mensagem de erro. */
  origem: string;
  keep: (row: Row) => boolean;
  /**
   * Resposta pronta para `keep`, quando quem montou o filtro já sabia dela.
   *
   * Ver `Materializacao`. É otimização, nunca regra: com ela ou sem ela o
   * conjunto de linhas é o mesmo, e há teste diferencial que afirma isso.
   */
  grupo?: Materializacao;
  /**
   * Uma igualdade `coluna = valor` que este filtro **implica**, quando quem o
   * montou soube extraí-la do predicado.
   *
   * Serve de ponto de partida por índice (`indice.ts`, ACHADOS #43), e é otimização
   * como o `grupo`: com ela ou sem ela o conjunto de linhas é o mesmo, porque o
   * `keep` continua rodando por cima. O que ela promete é só isto — **toda linha
   * que passa no `keep` tem `valor` nesta coluna** —, e por isso só é preenchida a
   * partir de conjunção de topo, nunca de disjunção.
   */
  igualdade?: { coluna: string; valor: DaxValue };
}

/**
 * Um agrupamento que já varreu a tabela e sabe quais linhas caem em cada grupo.
 *
 * **Por que existe.** Um visual monta um contexto de filtro por grupo e avalia a
 * medida nele. Sem isto, cada avaliação varre a tabela inteira de novo: a matriz
 * medida no [ACHADOS](../../../docs/ACHADOS.md) #38 tem 93 × 365 = 33.945 células
 * sobre 65.563 linhas, o que dá 2,2 bilhões de visitas de linha onde o Power BI
 * faz uma varredura só. Mas quem monta os grupos **já varreu** a tabela para
 * descobrir as combinações — as linhas de cada grupo estavam na mão e eram jogadas
 * fora.
 *
 * **Por que não basta pendurar as linhas num filtro.** O DAX substitui filtro:
 * `CALCULATE(x, ALL('T'[CIDADE]))` derruba o filtro de cidade e mantém os outros.
 * Se as linhas materializadas de um grupo `(cidade, técnico)` estivessem penduradas
 * no filtro de técnico, elas sobreviveriam à remoção do de cidade — e o grupo
 * ficaria estreito demais, com um número menor e nenhum aviso.
 *
 * Por isso a materialização é do **grupo inteiro**: a mesma instância vai em todos
 * os filtros que ele põe no contexto, e só vale enquanto os `filtros` estiverem
 * todos presentes. Removeu um, o caminho rápido some e sobra a semântica exata.
 */
export interface Materializacao {
  /** Identidade do grupo. Comparada por referência — dois grupos nunca a dividem. */
  marca: object;
  /** Quantos filtros o grupo pôs no contexto, somando todas as tabelas. */
  filtros: number;
  /** Tabela cujas linhas foram materializadas, normalizada. */
  tabela: string;
  /** As linhas visíveis dessa tabela quando os `filtros` todos valem. */
  linhas: readonly Row[];
}

export interface FilterContext {
  rowsOf(table: string): Row[];
  /** Os filtros ativos. `CALCULATE` deriva um contexto novo a partir daqui. */
  readonly filters: readonly TableFilter[];
}

export class FilteredContext implements FilterContext {
  readonly filters: readonly TableFilter[];
  private readonly dataset: Dataset;
  private readonly propagation: Propagation;
  /**
   * Linhas visíveis, por tabela **e por conjunto de relacionamentos já
   * atravessados** — ver `linhasVisiveis`. Contexto é imutável, o cache não
   * invalida.
   */
  private readonly cache = new Map<string, Row[]>();

  constructor(
    dataset: Dataset,
    propagation: Propagation,
    filters: readonly TableFilter[] = [],
  ) {
    this.dataset = dataset;
    this.propagation = propagation;
    this.filters = filters;
  }

  static unfiltered(dataset: Dataset, propagation: Propagation): FilteredContext {
    return new FilteredContext(dataset, propagation, []);
  }

  rowsOf(table: string): Row[] {
    return this.linhasVisiveis(normalizeName(table), [], new Set());
  }

  /**
   * As linhas visíveis de uma tabela: os filtros postos nela, mais os que chegam
   * por relacionamento.
   *
   * A propagação é **recursiva de propósito**, e não por elegância: nesta base o
   * filtro anda dois saltos de verdade — `calendar` restringe
   * `Status Protocolo Dia`, que restringe `FIELD AGENDA`. Restringir só com os
   * vizinhos diretos deixaria o segundo salto de fora.
   *
   * Duas regras de parada, e elas dizem coisas diferentes:
   *
   *  - **relacionamento já atravessado → pula.** É a regra do DAX: o filtro não
   *    volta pelo caminho que veio. Sem ela, todo `bothDirections` (são três aqui)
   *    seria laço na hora, porque A→B e B→A são o *mesmo* relacionamento.
   *  - **tabela já no caminho por relacionamento *diferente* → erro alto.** Aí é
   *    caminho ambíguo, o que o Power BI recusa na hora de criar o modelo. Se
   *    aparecer, o certo é não inventar um número.
   *
   * E uma regra que não é parada, é semântica: se a tabela de origem **não está
   * restringida** (vê todas as suas linhas), ela não restringe ninguém. Sem
   * isso, propagar viraria INNER JOIN e sumiria com as linhas do lado "many" que
   * não casam — que no Power BI continuam visíveis enquanto o lado "one" está
   * livre. É também o que faz `ALL('T'[C])` continuar funcionando: ele devolve
   * tudo, logo não restringe, logo não propaga.
   */
  private linhasVisiveis(
    key: string,
    caminho: string[],
    relsNoCaminho: Set<string>,
  ): Row[] {
    const ck = relsNoCaminho.size === 0
      ? key
      : `${key}|${[...relsNoCaminho].sort().join(',')}`;
    const cacheado = this.cache.get(ck);
    if (cacheado) return cacheado;

    const aplicaveis = this.filters.filter((f) => f.table === key);
    const todas = this.dataset.rows(key);
    // Ponto de partida: as linhas já materializadas do menor grupo válido, quando
    // existe um. É o caminho rápido do achado #38, e é só um ponto de partida — os
    // outros filtros continuam sendo aplicados por cima, um a um.
    const pronto = this.partidaMaterializada(key);
    // Sem filtro e sem materialização, devolve o próprio array: copiar a tabela
    // inteira à toa é o caso mais comum de todos.
    let visiveis: Row[];
    if (pronto === null) {
      // Sem materialização de grupo, ainda pode haver partida por índice: um
      // filtro `'T'[c] = v` diz quais linhas *podem* passar, e o `keep` de todos
      // os filtros roda por cima do mesmo jeito (ACHADOS #43).
      const porIndice = this.partidaIndexada(aplicaveis, todas);
      const base = porIndice ?? todas;
      visiveis = aplicaveis.length === 0
        ? base
        : (base as Row[]).filter((row) => aplicaveis.every((f) => f.keep(row)));
    } else {
      // Os filtros do grupo escolhido já estão refletidos em `linhas` — pular o
      // `keep` deles é o grosso da economia, porque num agrupamento de 31 chaves
      // são 31 predicados por linha.
      const outros = aplicaveis.filter((f) => f.grupo !== pronto);
      visiveis = outros.length === 0
        ? [...pronto.linhas]
        : pronto.linhas.filter((row) => outros.every((f) => f.keep(row)));
    }

    caminho.push(key);
    try {
      for (const aresta of this.propagation.incoming(key)) {
        if (relsNoCaminho.has(aresta.relationship)) continue;
        if (caminho.includes(aresta.source)) {
          throw new DaxEvalError(
            `Caminho de filtro ambíguo: ${describeEdge(aresta)} fecha um ciclo ` +
              `passando por ${caminho.map((t) => `'${t}'`).join(' -> ')}. ` +
              `Dois caminhos distintos entre as mesmas tabelas dão respostas ` +
              `diferentes, e o Power BI recusa esse modelo. Confira ` +
              `specs/_catalog/relationships.yaml.`,
          );
        }
        // Tabela fora do dataset não tem filtro nenhum, logo não restringe.
        // Acontece em teste que carrega um subconjunto do modelo.
        if (!this.dataset.hasTable(aresta.source)) continue;

        relsNoCaminho.add(aresta.relationship);
        let fonte: Row[];
        try {
          fonte = this.linhasVisiveis(aresta.source, caminho, relsNoCaminho);
        } finally {
          relsNoCaminho.delete(aresta.relationship);
        }

        if (fonte.length === this.dataset.rows(aresta.source).length) continue;
        visiveis = this.restringe(visiveis, fonte, aresta);
      }
    } finally {
      caminho.pop();
    }

    this.cache.set(ck, visiveis);
    return visiveis;
  }

  /**
   * A menor materialização **válida** para esta tabela, ou `null`.
   *
   * Válida quer dizer: todos os filtros que o grupo pôs no contexto continuam
   * nele. É essa conferência que torna o caminho rápido seguro sob substituição —
   * `ALL('T'[CIDADE])` derruba um dos filtros do grupo, a contagem não fecha, e o
   * cálculo volta a ser o predicado exato. Ver `Materializacao`.
   *
   * A **menor** porque uma célula de matriz tem duas: a do eixo de linha e a do
   * eixo de coluna, as duas sobre a âncora. Começar pela menor e conferir a outra
   * por `keep` custa o tamanho do menor lado, não o da tabela.
   */
  /**
   * O menor conjunto de candidatos que os filtros de igualdade permitem, ou `null`
   * para "comece pela tabela inteira".
   *
   * Só encurta a lista: `keep` de **todos** os filtros continua rodando por cima,
   * então isto não pode mudar resposta. E como cada `igualdade` é implicada pelo
   * seu filtro, nenhuma linha que passaria fica de fora.
   *
   * O menor entre os disponíveis porque dois filtros de igualdade sobre a mesma
   * tabela dão dois baldes, e começar pelo menor é o que faz o custo ser o do
   * balde, não o da tabela.
   */
  private partidaIndexada(
    aplicaveis: readonly TableFilter[],
    todas: readonly Row[],
  ): readonly Row[] | null {
    let melhor: readonly Row[] | null = null;
    for (const f of aplicaveis) {
      if (!f.igualdade) continue;
      const indice = indiceDe(todas, f.igualdade.coluna);
      if (!indice) return null;
      const candidatos = indice.candidatos(f.igualdade.valor);
      if (candidatos === null) continue;
      if (melhor === null || candidatos.length < melhor.length) melhor = candidatos;
    }
    return melhor;
  }

  private partidaMaterializada(key: string): Materializacao | null {
    let escolhida: Materializacao | null = null;
    let presentes: Map<object, number> | null = null;

    for (const f of this.filters) {
      const g = f.grupo;
      if (!g || g.tabela !== key) continue;
      if (escolhida !== null && g.linhas.length >= escolhida.linhas.length) continue;
      if (presentes === null) {
        presentes = new Map();
        for (const outro of this.filters) {
          if (!outro.grupo) continue;
          presentes.set(outro.grupo.marca, (presentes.get(outro.grupo.marca) ?? 0) + 1);
        }
      }
      if (presentes.get(g.marca) === g.filtros) escolhida = g;
    }
    return escolhida;
  }

  /** Mantém as linhas cujo valor de junção aparece na origem. */
  private restringe(
    alvo: readonly Row[],
    fonte: readonly Row[],
    aresta: PropagationEdge,
  ): Row[] {
    const permitidos = new Set<string>();
    let amostraFonte: DaxValue = BLANK;
    for (const row of fonte) {
      const v = this.propagation.joinValue(aresta.sourceTable, aresta.sourceColumn, row);
      if (isBlank(amostraFonte)) amostraFonte = v;
      permitidos.add(identityKey(v));
    }

    const saida: Row[] = [];
    let amostraAlvo: DaxValue = BLANK;
    for (const row of alvo) {
      const v = this.propagation.joinValue(aresta.targetTable, aresta.targetColumn, row);
      if (isBlank(amostraAlvo)) amostraAlvo = v;
      if (permitidos.has(identityKey(v))) saida.push(row);
    }

    // Espécies diferentes nas duas pontas da junção não casam NUNCA, e o
    // resultado seria zero com cara de filtro apertado. É a armadilha das
    // colunas que chegam como texto `DD/MM/YYYY` em vez de data — a mesma que
    // gerou o achado 1 falso. Erra alto depois de contar, para que a mensagem
    // possa dizer o que veio de cada lado.
    const eFonte = especie(amostraFonte);
    const eAlvo = especie(amostraAlvo);
    if (eFonte && eAlvo && eFonte !== eAlvo) {
      throw new DaxEvalError(
        `Junção ${describeEdge(aresta)} compara ${eFonte} com ${eAlvo}: nunca casa, ` +
          `e o resultado sairia vazio como se fosse filtro. Um dos dois lados está ` +
          `chegando no tipo errado dos dados.`,
      );
    }

    return saida;
  }

  /**
   * Contexto novo com filtros adicionados, aplicando a substituição do DAX: filtro
   * novo derruba o antigo que toque qualquer coluna em comum.
   *
   * Note que os filtros novos entre si **não** se substituem — dentro de um mesmo
   * `CALCULATE` todos os argumentos de filtro valem juntos, e é assim que
   * `CALCULATE(x, 'T'[a] = 1, 'T'[a] = 2)` dá vazio no Power BI.
   */
  with(novos: readonly TableFilter[]): FilteredContext {
    const sobreviventes = this.filters.filter(
      (antigo) => !novos.some((n) => conflita(antigo, n)),
    );
    return new FilteredContext(this.dataset, this.propagation, [...sobreviventes, ...novos]);
  }

  /** Contexto novo sem os filtros que `ALL`/`ALLEXCEPT` remove. */
  without(predicado: (f: TableFilter) => boolean): FilteredContext {
    return new FilteredContext(
      this.dataset,
      this.propagation,
      this.filters.filter((f) => !predicado(f)),
    );
  }
}

/** Espécie de um valor, para detectar junção que compara coisas incomparáveis. */
function especie(v: DaxValue): string | null {
  if (isBlank(v)) return null;
  if (v instanceof Date) return 'data';
  return typeof v === 'number' ? 'número' : typeof v === 'boolean' ? 'booleano' : 'texto';
}

function conflita(a: TableFilter, b: TableFilter): boolean {
  if (a.table !== b.table) return false;
  // Filtro de tabela inteira (sem coluna identificada) conflita com qualquer
  // outro da mesma tabela: não há como saber o que ele restringe, e manter os
  // dois seria estreitar o contexto onde o DAX substituiria.
  if (a.columns.size === 0 || b.columns.size === 0) return true;
  for (const c of b.columns) if (a.columns.has(c)) return true;
  return false;
}
