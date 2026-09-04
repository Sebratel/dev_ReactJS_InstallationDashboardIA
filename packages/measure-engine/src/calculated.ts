// Materialização das tabelas calculadas.
//
// Sete tabelas deste modelo não vêm de query nenhuma: as linhas delas são o
// resultado de uma expressão DAX (`partition = calculated` no TMDL). Enquanto
// isso não era avaliado, o dataset dos testes inventava linhas para elas — e
// inventar linha para `CALENDARIO INSTALADO`, `calendar` e `Status Protocolo Dia`
// é inventar o caminho por onde o filtro propaga (fase 2b.5).
//
// Três coisas acontecem aqui, e as duas últimas não são óbvias:
//
//  1. avaliar o DAX **como tabela**, sem a coerção 1×1 → escalar;
//  2. casar as colunas do resultado com as colunas declaradas na tabela. O DAX de
//     `CALENDARIO INSTALADO` devolve uma coluna chamada `Date`; a tabela do modelo
//     chama a mesma coluna de `DATA INSTALADO`. Quem faz a ponte é `sourceColumn`.
//     Sem ela a tabela nasce com o nome de coluna errado — o que não dá erro, dá
//     relacionamento que nunca casa;
//  3. aplicar o **tipo declarado** da coluna. Ver `aplicaTipo`: há um caso nesta
//     base em que sem isso a junção erra alto, e é o certo que erre.
//
// O que este arquivo NÃO faz: decidir a ordem por conta própria quando há ciclo.
// Ciclo entre tabelas calculadas erra alto nomeando o caminho — inventar uma
// ordem daria uma tabela vazia com cara de tabela pronta.

import { normalizeName } from '../../semantic-model/src/model.ts';
import type { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn, ModelTable } from '../../semantic-model/src/types.ts';
import { type DaxNode, walk } from './ast.ts';
import type { Row } from './dataset.ts';
import type { Evaluator } from './evaluator.ts';
import { parseDax } from './parser.ts';
import { BLANK, DaxEvalError, type DaxValue, dateFromSerial, isBlank } from './value.ts';

/** O que a materialização de uma tabela produziu. */
export interface MaterializedTable {
  /** Nome da tabela como está no modelo. */
  readonly table: string;
  readonly rowCount: number;
  /** Coluna declarada ← coluna do resultado do DAX, ambas normalizadas. */
  readonly columnMap: ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------------------
// Dependência e ordem
// ---------------------------------------------------------------------------

/**
 * As tabelas calculadas de que o DAX desta tabela depende.
 *
 * Segue **coluna calculada adentro**, e não por completude: o DAX de
 * `CALENDARIO INSTALADO` começa em `MIN('PROTOCOLOS GERAL'[DATA INSTALAÇÃO])`, e
 * `[DATA INSTALAÇÃO]` é ela própria uma coluna calculada, com DAX que referencia
 * outras tabelas. Olhar só as referências diretas veria `PROTOCOLOS GERAL` e
 * pararia ali.
 *
 * Devolve só as que são calculadas: as que vêm de query já estão no dataset antes
 * de qualquer materialização começar.
 */
export function calculatedTableDependencies(model: SemanticModel, t: ModelTable): string[] {
  if (!t.tableDax) {
    throw new DaxEvalError(`Tabela '${t.name}' não é calculada — não tem table_dax.`);
  }
  const calculadas = new Set(model.calculatedTables.map((x) => normalizeName(x.name)));
  const tabelas = new Set<string>();
  const colunasVistas = new Set<string>();

  const visitar = (dax: string): void => {
    const pendentes: ModelColumn[] = [];
    walk(parseCached(dax), (n) => {
      if (n.type === 'TableRef') tabelas.add(normalizeName(n.name));
      // Nome sem aspas e sem colchete: `COUNTROWS(D)` é `Identifier`, não
      // `TableRef` — o parser não adivinha se é tabela, VAR ou palavra-chave. Quem
      // decide é o modelo, do mesmo jeito que `evaluateTable` decide.
      if (n.type === 'Identifier' && model.table(n.name)) tabelas.add(normalizeName(n.name));
      if (n.type !== 'ColumnRef') return;
      tabelas.add(normalizeName(n.table));
      const chave = `${normalizeName(n.table)}[${normalizeName(n.column)}]`;
      if (colunasVistas.has(chave)) return;
      colunasVistas.add(chave);
      const col = model.column(n.table, n.column);
      if (col?.calculated && col.dax) pendentes.push(col);
    });
    for (const col of pendentes) visitar(col.dax!);
  };
  visitar(t.tableDax);

  tabelas.delete(normalizeName(t.name)); // auto-referência é tratada na ordenação
  return [...tabelas].filter((x) => calculadas.has(x)).sort();
}

/** Cache de AST local: a ordenação relê o mesmo DAX de coluna várias vezes. */
const astCache = new Map<string, DaxNode>();
function parseCached(dax: string): DaxNode {
  let ast = astCache.get(dax);
  if (!ast) {
    ast = parseDax(dax);
    astCache.set(dax, ast);
  }
  return ast;
}

/**
 * A ordem em que as 7 podem ser materializadas: dependência antes de dependente.
 *
 * **Nesta base o grafo é plano** — as 7 dependem só de tabelas que vêm de query,
 * nenhuma depende de outra calculada (medido, não suposto). Então hoje qualquer
 * ordem funcionaria, e a ordenação existe pelo que ela recusa: um ciclo, que sem
 * esta função apareceria como "tabela não está no dataset" no meio de uma
 * avaliação, longe da causa.
 */
export function calculatedTableOrder(model: SemanticModel): ModelTable[] {
  const porNome = new Map(model.calculatedTables.map((t) => [normalizeName(t.name), t]));
  const prontas: ModelTable[] = [];
  const feitas = new Set<string>();
  const noCaminho: string[] = [];

  const visitar = (chave: string): void => {
    if (feitas.has(chave)) return;
    const t = porNome.get(chave)!;
    if (noCaminho.includes(chave)) {
      throw new DaxEvalError(
        `Ciclo entre tabelas calculadas: ${[...noCaminho, chave].map((k) => `'${k}'`).join(' -> ')}. ` +
          `Nenhuma delas pode ser materializada primeiro. Confira o table_dax das ` +
          `specs em specs/_catalog/tables/.`,
      );
    }
    noCaminho.push(chave);
    try {
      for (const dep of calculatedTableDependencies(model, t)) visitar(dep);
    } finally {
      noCaminho.pop();
    }
    feitas.add(chave);
    prontas.push(t);
  };

  // Ordem de entrada estável: o modelo lê as specs em ordem de arquivo.
  for (const chave of porNome.keys()) visitar(chave);
  return prontas;
}

// ---------------------------------------------------------------------------
// Materialização
// ---------------------------------------------------------------------------

/**
 * Materializa as 7 na ordem de dependência, acrescentando cada uma ao dataset do
 * avaliador. Depois disto, `'CALENDARIO INSTALADO'` é uma tabela como qualquer
 * outra — `TableValue.table` nomeado, e portanto usável como filtro.
 */
export function materializeCalculatedTables(ev: Evaluator): MaterializedTable[] {
  return calculatedTableOrder(ev.model).map((t) => materializeCalculatedTable(ev, t));
}

export function materializeCalculatedTable(ev: Evaluator, t: ModelTable): MaterializedTable {
  if (!t.tableDax) {
    throw new DaxEvalError(`Tabela '${t.name}' não é calculada — não tem table_dax.`);
  }
  if (ev.dataset.hasTable(t.name)) {
    throw new DaxEvalError(
      `Tabela calculada '${t.name}' já está no dataset. Materializar duas vezes ` +
        `esconderia qual das duas versões as medidas estão usando.`,
    );
  }

  const onde = `tabela calculada '${t.name}'`;
  const tv = ev.evaluateTable(ev.ast(t.tableDax), ev.rootScope(), onde);
  const fisicas = t.columns.filter((c) => !c.calculated);
  const columnMap = casaColunas(t, fisicas, tv.columns, onde);

  const rows: Row[] = tv.rows.map((origem) => {
    const row: Row = {};
    for (const c of fisicas) {
      const de = columnMap.get(normalizeName(c.name))!;
      row[c.name] = aplicaTipo(c, origem[de] ?? BLANK, t.name);
    }
    return row;
  });

  ev.dataset.addTable(t.name, rows);
  return { table: t.name, rowCount: rows.length, columnMap };
}

/**
 * Coluna declarada ← coluna do resultado, exigindo **bijeção**.
 *
 * As duas metades da exigência pegam erros diferentes:
 *
 *  - coluna declarada sem par no resultado → o DAX mudou ou a spec está errada, e
 *    a tabela nasceria com a coluna toda em branco;
 *  - coluna do resultado que ninguém reclama → o extrator perdeu uma coluna. Foi
 *    exatamente o que aconteceu com as 7 tabelas inteiras na fase anterior, e
 *    aceitar em silêncio é como aquilo passou meses invisível.
 */
function casaColunas(
  t: ModelTable,
  fisicas: readonly ModelColumn[],
  doResultado: ReadonlySet<string>,
  onde: string,
): Map<string, string> {
  const mapa = new Map<string, string>();
  const usadas = new Set<string>();

  for (const c of fisicas) {
    if (!c.sourceColumn) {
      throw new DaxEvalError(
        `${onde}: a coluna '${c.name}' não é calculada e não tem sourceColumn — ` +
          `não há como saber de qual coluna do resultado ela vem.`,
      );
    }
    const de = chaveDeOrigem(c.sourceColumn);
    if (!doResultado.has(de)) {
      throw new DaxEvalError(
        `${onde}: a coluna '${c.name}' vem de '${c.sourceColumn}', e o DAX da tabela ` +
          `não devolve nenhuma coluna '${de}'. Devolve: ${[...doResultado].join(', ')}.`,
      );
    }
    mapa.set(normalizeName(c.name), de);
    usadas.add(de);
  }

  const sobrando = [...doResultado].filter((x) => !usadas.has(x));
  if (sobrando.length > 0) {
    throw new DaxEvalError(
      `${onde}: o DAX devolve a(s) coluna(s) ${sobrando.join(', ')} que a tabela '${t.name}' ` +
        `não declara. Ou o TMDL tem coluna que o extrator perdeu, ou o DAX mudou.`,
    );
  }
  return mapa;
}

/**
 * `sourceColumn` → chave da coluna no resultado do DAX.
 *
 * Duas formas aparecem nas specs, e as duas dizem a mesma coisa: `[Date]` (coluna
 * derivada, como as de `CALENDAR` e `ADDCOLUMNS`) e
 * `PROTOCOLOS GERAL[EQUIPES TEMPORARIAS]` (coluna que veio de uma tabela do
 * modelo, como em `DISTINCT`). O que interessa é o nome dentro dos colchetes: é
 * assim que `TableValue` nomeia coluna.
 */
function chaveDeOrigem(sourceColumn: string): string {
  const m = /\[([^\]]*)\]\s*$/.exec(sourceColumn);
  return normalizeName(m ? m[1]! : sourceColumn);
}

/**
 * Aplica o tipo declarado da coluna ao valor que o DAX devolveu.
 *
 * Existe por um caso concreto e load-bearing. `Status Protocolo Dia[Dia]` é
 * `TRUNC('FIELD AGENDA'[Slot Agenda])`, e `TRUNC` em DAX devolve **número** — o
 * número de série da data. Essa coluna se liga a `calendar[Data]`, que é
 * `DATEVALUE(...)` e portanto **data**. Sem converter, a junção compara número
 * com data: nunca casa, e o guarda de espécie em `FilteredContext.restringe` erra
 * alto. No Power BI não erra porque a coluna é declarada `dateTime` e o valor é
 * armazenado como data — é essa declaração que replicamos aqui.
 *
 * Só este caso é convertido. Texto onde se declarou data erra alto: seria a mesma
 * classe de erro que gerou o achado 1 falso, e converter na surdina é como um
 * `DD/MM/YYYY` viraria março em vez de abril.
 */
export function aplicaTipo(c: ModelColumn, v: DaxValue, tabela: string): DaxValue {
  if (isBlank(v)) return v;

  if (c.type === 'dateTime') {
    if (typeof v === 'number') return dateFromSerial(v);
    if (typeof v === 'string') {
      const m = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(v);
      if (m) {
        const h = Number(m[1]);
        const min = Number(m[2]);
        const s = Number(m[3]);
        const ms = m[4] ? Number(m[4].slice(0, 3).padEnd(3, '0')) : 0;
        if (h >= 0 && h < 24 && min >= 0 && min < 60 && s >= 0 && s < 60) {
          return new Date(Date.UTC(1899, 11, 30, h, min, s, ms));
        }
      }
      throw new DaxEvalError(
        `'${tabela}'[${c.name}] é declarada dateTime e o DAX devolveu o texto ` +
          `${JSON.stringify(v)}. DAX não converte texto para data implicitamente — ` +
          `use DATEVALUE na expressão da tabela.`,
      );
    }
    return v;
  }

  if (TIPOS_NUMERICOS.has(c.type ?? '') && typeof v === 'string') {
    if (!LITERAL_NUMERICO.test(v)) {
      throw new DaxEvalError(
        `'${tabela}'[${c.name}] é declarada ${c.type} e o DAX devolveu o texto ` +
          `${JSON.stringify(v)}, que não é um literal numérico. ` +
          `Nada é convertido aqui: "1.234,56" e "1,234.56" são o mesmo texto com ` +
          `duas leituras, e escolher uma daria um número mil vezes errado sem avisar.`,
      );
    }
    return Number(v);
  }

  return v;
}

const TIPOS_NUMERICOS = new Set(['int64', 'double', 'decimal']);

/**
 * Literal numérico **sem ambiguidade**: só dígitos, com sinal e ponto decimal
 * opcionais. Nada de separador de milhar, nada de vírgula, nada de espaço.
 *
 * A restrição é o ponto inteiro da regra. Numa base `pt-BR`, `"1.234"` é mil
 * duzentos e trinta e quatro para o usuário e um vírgula duzentos e trinta e quatro
 * para o `Number()` do JavaScript. Aceitar só o que tem uma leitura única é o que
 * separa honrar o tipo declarado de adivinhar formato.
 */
const LITERAL_NUMERICO = /^-?\d+(\.\d+)?$/;
