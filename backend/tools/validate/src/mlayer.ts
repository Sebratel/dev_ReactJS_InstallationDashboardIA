// Scanner da camada M (Power Query) — a camada que existe **entre** o SQL da
// query e a tabela que o DAX vê.
//
// Por que isto existe. Até a Fase 2b.5 o projeto tratava "a query" e "a tabela"
// como a mesma coisa. Não são: as 24 queries têm **327 passos M** depois do
// `Odbc.Query`, e esses passos criam coluna, renomeiam coluna e **filtram
// linha**. Duas consequências que só aparecem quando se olha:
//
//   1. Colunas que o DAX usa **não existem no SELECT**. `PROTOCOLOS GERAL` cita
//      `[HORA CRIADO]`, `[DATA ALOCAÇÃO]`, `[TÉCNICO TROCA]` — todas nascem em
//      passo M (`DateTime.Time`, mesclagem com outra query, renomeação).
//   2. `rowCount` do golden é a contagem do **SQL**, não da tabela. Em
//      `protocolos-geral` o M ainda aplica `[STATUS] <> "Cancelado"` e
//      `Table.Distinct` por `SOLICITACAO` depois disso.
//
// Isto **não é um avaliador de M**. Ele não executa nada e não sabe valores. Faz
// duas perguntas estáticas: *que nome de coluna este passo produz ou remove?* e
// *este passo pode mudar a contagem de linhas?* — a mesma relação que
// `extractRefs` tem com o parser de DAX.
//
// Princípio herdado do avaliador: **falhar alto**. Passo `Table.*` cuja função
// não está na tabela de efeitos vira erro com o nome do passo, nunca "assumo que
// não mexe em coluna". Um scanner que chuta silenciosamente diria "todas as
// colunas conferem" justamente na query que ele não entendeu.

/** Passo do `let`. */
export interface MStep {
  /** Nome do passo já sem `#"`…`"`. */
  readonly name: string;
  /** Posição no `let`, começando em 0. */
  readonly index: number;
  /** Lado direito do `=`. */
  readonly expr: string;
  /** Função no topo da expressão (`Table.AddColumn`), ou `null` se não é chamada. */
  readonly head: string | null;
}

/** Como uma coluna passou a existir. */
export type MHow =
  | 'adicionada'
  | 'renomeada'
  | 'duplicada'
  | 'dividida'
  | 'expandida'
  | 'mesclada';

export interface MColumnOrigin {
  readonly column: string;
  readonly how: MHow;
  readonly step: string;
  /** Coluna de origem, quando o passo tem uma (renomeação, divisão, duplicata). */
  readonly from: string | null;
}

/** Passo que pode mudar a quantidade de linhas — e por quê. */
export interface MRowEffect {
  readonly step: string;
  readonly func: string;
  readonly reason: string;
  /** `reduz`, `multiplica` ou `soma`. Serve para explicar a direção do desvio. */
  readonly direction: 'reduz' | 'multiplica' | 'soma';
}

export interface MScan {
  readonly steps: readonly MStep[];
  /** Colunas nascidas em M, na ordem em que aparecem. */
  readonly produced: readonly MColumnOrigin[];
  /** Colunas removidas por M (nome normalizado -> passo). */
  readonly removed: ReadonlyMap<string, string>;
  /** Passos que mexem na contagem de linhas. */
  readonly rowEffects: readonly MRowEffect[];
  /**
   * Passos cujo conjunto de colunas não é conhecível estaticamente — fonte
   * (`Odbc.Query`, `GoogleSheets.Contents`) e os que tiram nome do próprio dado
   * (`Table.PromoteHeaders`). Não é falha: é onde o golden entra como resposta.
   */
  readonly opaque: readonly MStep[];
}

export class MScanError extends Error {}

/** Mesma chave de comparação do modelo semântico. */
export function normalizeColumn(name: string): string {
  return name.trim().toLowerCase();
}

// ── varredura de texto ───────────────────────────────────────────────────────
// M tem string com escape `""`, comentário `//` e `/* */`. O SQL das queries
// vive dentro de string e contém `--`, `{`, `(` e vírgula em profusão, então
// separar argumento por vírgula sem respeitar string devolveria lixo.

interface Cut {
  readonly parts: string[];
}

function splitTopLevel(src: string, sep: string): Cut {
  const parts: string[] = [];
  let depth = 0;
  let inicio = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      i = skipString(src, i);
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const fim = src.indexOf('*/', i + 2);
      i = fim < 0 ? src.length : fim + 1;
      continue;
    }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (depth === 0 && c === sep) {
      parts.push(src.slice(inicio, i));
      inicio = i + 1;
    }
  }
  parts.push(src.slice(inicio));
  return { parts };
}

/** Recebe o índice da abertura `"`; devolve o índice do fechamento. */
function skipString(src: string, abre: number): number {
  let i = abre + 1;
  while (i < src.length) {
    if (src[i] === '"') {
      if (src[i + 1] === '"') { i += 2; continue; } // escape `""`
      return i;
    }
    i++;
  }
  throw new MScanError('String M não fechada.');
}

/** Índice do `=` de atribuição de passo (depth 0, não `=>`, `<=`, `>=`, `<>`). */
function assignIndex(src: string): number {
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') { i = skipString(src, i); continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (depth === 0 && c === '=') {
      const antes = src[i - 1];
      const depois = src[i + 1];
      if (antes === '<' || antes === '>' || depois === '=' || depois === '>') continue;
      return i;
    }
  }
  return -1;
}

function unquoteName(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('#"') && t.endsWith('"')) return t.slice(2, -1).replaceAll('""', '"');
  return t;
}

function mString(arg: string): string | null {
  const t = arg.trim();
  if (!t.startsWith('"')) return null;
  const fim = skipString(t, 0);
  if (fim !== t.length - 1) return null; // não é uma string pura
  return t.slice(1, -1).replaceAll('""', '"');
}

/** Todas as strings literais de um argumento, em ordem. */
function allStrings(arg: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < arg.length; i++) {
    if (arg[i] !== '"') continue;
    const fim = skipString(arg, i);
    out.push(arg.slice(i + 1, fim).replaceAll('""', '"'));
    i = fim;
  }
  return out;
}

/** Pares `{"de","para"}` de uma lista de renomeação. */
function renamePairs(arg: string): { from: string; to: string }[] {
  const lista = arg.trim();
  const inner = lista.startsWith('{') ? lista.slice(1, -1) : lista;
  const out: { from: string; to: string }[] = [];
  for (const item of splitTopLevel(inner, ',').parts) {
    const t = item.trim();
    if (!t.startsWith('{')) continue;
    const nomes = allStrings(t);
    if (nomes.length >= 2) out.push({ from: nomes[0], to: nomes[1] });
  }
  // `{{"a","b"}}` cai no laço acima; `{"a","b"}` (par solto) não.
  if (out.length === 0) {
    const nomes = allStrings(lista);
    if (nomes.length === 2) out.push({ from: nomes[0], to: nomes[1] });
  }
  return out;
}

/** Argumentos de topo da chamada no head. */
function headArgs(expr: string): string[] {
  const abre = expr.indexOf('(');
  if (abre < 0) return [];
  const fim = expr.lastIndexOf(')');
  if (fim <= abre) throw new MScanError(`Chamada M sem fechamento: ${expr.slice(0, 60)}…`);
  return splitTopLevel(expr.slice(abre + 1, fim), ',').parts;
}

function headFunction(expr: string): string | null {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\(/.exec(expr);
  return m ? m[1] : null;
}

// ── passos ───────────────────────────────────────────────────────────────────

export function parseMSteps(m: string): MStep[] {
  const iLet = m.indexOf('let');
  if (iLet < 0) return [];
  // O `in` final: último `in` em profundidade 0. Buscar de trás é suficiente
  // aqui e evita casar com `in` dentro de nome de passo ou de string.
  const corpo = m.slice(iLet + 3);
  const linhas = splitTopLevel(corpo, ',').parts;
  const steps: MStep[] = [];
  for (const bruto of linhas) {
    let texto = bruto;
    const iIn = indexOfTopLevelWord(texto, 'in');
    if (iIn >= 0) texto = texto.slice(0, iIn);
    const eq = assignIndex(texto);
    if (eq < 0) continue;
    const name = unquoteName(texto.slice(0, eq));
    const expr = texto.slice(eq + 1).trim();
    if (!name || !expr) continue;
    // `let` aninhado (passo que define função com `=>`) não é escaneável assim:
    // o corte por vírgula de topo achata os passos internos e eles seriam
    // atribuídos à tabela de fora. Errar alto é o certo — ver `clima-tempo`,
    // cujo `BuscarHistorico` monta uma tabela por cidade dentro de um `let`.
    if (indexOfTopLevelWord(expr, 'let') >= 0) {
      throw new MScanError(
        `Passo '${name}' tem um 'let' aninhado (função M). O scanner é estático e `
          + 'não desce em função — a query precisa ser lida à mão.',
      );
    }
    steps.push({ name, index: steps.length, expr, head: headFunction(expr) });
  }
  return steps;
}

/** Palavra-chave em profundidade 0 e fora de string. */
function indexOfTopLevelWord(src: string, word: string): number {
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') { i = skipString(src, i); continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (
      depth === 0 && src.startsWith(word, i)
      && !/[A-Za-z0-9_.]/.test(src[i - 1] ?? ' ')
      && !/[A-Za-z0-9_.]/.test(src[i + word.length] ?? ' ')
    ) return i;
  }
  return -1;
}

// ── efeitos ──────────────────────────────────────────────────────────────────

/**
 * Funções `Table.*` que **não** mexem em nome de coluna nem em contagem de
 * linha. Estar nesta lista é uma afirmação, não um default: é o que permite
 * errar alto no resto.
 */
const NEUTRAS = new Set([
  'Table.ReplaceValue',        // troca valor
  'Table.TransformColumns',    // troca valor/tipo de coluna existente
  'Table.TransformColumnTypes',
  'Table.ReorderColumns',      // só ordem
  'Table.Sort',                // só ordem
  'Table.Buffer',
]);

/**
 * Mexem em linha e **nunca** em nome de coluna. `Table.Group` de propósito não
 * está aqui: ele muda as duas coisas, e cair no `default` (erro alto) é melhor
 * que ser classificado como "só linha" no dia em que alguém o usar.
 */
const SO_LINHA = new Set([
  'Table.SelectRows',
  'Table.Distinct',
  'Table.Skip',
  'Table.RemoveRows',
  'Table.FirstN',
  'Table.Range',
]);

/** Fonte ou passo cujo conjunto de colunas vem do dado, não do texto. */
const OPACAS = new Set([
  'Table.PromoteHeaders',
  'Table.FromRows',
  'Table.FromList',
  'Table.FromRecords',
  'Table.Combine',
]);

const ROW_EFFECTS: Record<string, { reason: string; direction: MRowEffect['direction'] }> = {
  'Table.SelectRows': { reason: 'filtra linhas por condição', direction: 'reduz' },
  'Table.Distinct': { reason: 'remove duplicatas', direction: 'reduz' },
  'Table.Skip': { reason: 'descarta as primeiras linhas', direction: 'reduz' },
  'Table.RemoveRows': { reason: 'descarta linhas por posição', direction: 'reduz' },
  'Table.FirstN': { reason: 'mantém só as primeiras linhas', direction: 'reduz' },
  'Table.Range': { reason: 'recorta um intervalo de linhas', direction: 'reduz' },
  'Table.ExpandTableColumn': {
    reason: 'expande a coluna da mesclagem — uma linha por par casado',
    direction: 'multiplica',
  },
  'Table.Combine': { reason: 'concatena tabelas', direction: 'soma' },
  'Table.Group': { reason: 'agrupa linhas', direction: 'reduz' },
};

/** Junções que descartam linha do lado esquerdo. `LeftOuter` não descarta. */
const JOINS_QUE_REDUZEM = /JoinKind\.(Inner|RightOuter|RightAnti|LeftAnti|FullOuter)/;

export function scanM(m: string): MScan {
  const steps = parseMSteps(m);
  const produced: MColumnOrigin[] = [];
  const removed = new Map<string, string>();
  const rowEffects: MRowEffect[] = [];
  const opaque: MStep[] = [];

  for (const step of steps) {
    const fn = step.head;

    // Passo que não é chamada de função (alias, literal, `each`) não produz nome.
    if (!fn) continue;

    // Passo que não é de tabela: fonte externa (`Odbc.Query`), escalar
    // (`DateTime.LocalNow` na query `hora-atualizado`), lista. Nenhum nome de
    // coluna sai do texto — quem responde é o golden.
    if (!fn.startsWith('Table.')) {
      if (step.index === 0 || /^(Odbc|Sql|MySQL|GoogleSheets|Web|Json|Csv|Excel)\./.test(fn)) {
        opaque.push(step);
      }
      continue;
    }

    const efeito = ROW_EFFECTS[fn];
    if (efeito) rowEffects.push({ step: step.name, func: fn, ...efeito });

    if (OPACAS.has(fn)) {
      opaque.push(step);
      continue;
    }
    if (NEUTRAS.has(fn) || SO_LINHA.has(fn)) continue;

    const args = headArgs(step.expr);
    switch (fn) {
      case 'Table.AddColumn': {
        const nome = mString(args[1] ?? '');
        if (nome === null) throw new MScanError(`${step.name}: Table.AddColumn sem nome literal.`);
        produced.push({ column: nome, how: 'adicionada', step: step.name, from: null });
        break;
      }
      case 'Table.RenameColumns': {
        const pares = renamePairs(args[1] ?? '');
        if (pares.length === 0) {
          throw new MScanError(`${step.name}: Table.RenameColumns sem par de nomes.`);
        }
        for (const p of pares) {
          produced.push({ column: p.to, how: 'renomeada', step: step.name, from: p.from });
          removed.set(normalizeColumn(p.from), step.name);
        }
        break;
      }
      case 'Table.DuplicateColumn': {
        const de = mString(args[1] ?? '');
        const nome = mString(args[2] ?? '');
        if (nome === null) {
          throw new MScanError(`${step.name}: Table.DuplicateColumn sem nome literal.`);
        }
        produced.push({ column: nome, how: 'duplicada', step: step.name, from: de });
        break;
      }
      case 'Table.SplitColumn': {
        const de = mString(args[1] ?? '');
        const nomes = allStrings(args[3] ?? '');
        if (nomes.length === 0) {
          throw new MScanError(`${step.name}: Table.SplitColumn sem nomes de destino.`);
        }
        for (const n of nomes) {
          produced.push({ column: n, how: 'dividida', step: step.name, from: de });
        }
        if (de) removed.set(normalizeColumn(de), step.name);
        break;
      }
      case 'Table.NestedJoin': {
        // Cria uma coluna que **contém uma tabela**; ela só vira colunas de
        // verdade no `Table.ExpandTableColumn`. O nome entra igual porque é
        // coluna do modelo se alguém esquecer de expandir.
        const nome = mString(args[4] ?? '');
        if (nome === null) throw new MScanError(`${step.name}: Table.NestedJoin sem nome literal.`);
        produced.push({ column: nome, how: 'mesclada', step: step.name, from: null });
        if (JOINS_QUE_REDUZEM.test(step.expr)) {
          rowEffects.push({
            step: step.name,
            func: fn,
            reason: 'junção que descarta linhas sem par',
            direction: 'reduz',
          });
        }
        break;
      }
      case 'Table.ExpandTableColumn': {
        const de = mString(args[1] ?? '');
        // Assinatura: (tabela, coluna, nomesDeOrigem, nomesNovos?)
        const novos = allStrings(args[3] ?? args[2] ?? '');
        if (novos.length === 0) {
          throw new MScanError(`${step.name}: Table.ExpandTableColumn sem colunas.`);
        }
        for (const n of novos) {
          produced.push({ column: n, how: 'expandida', step: step.name, from: de });
        }
        if (de) removed.set(normalizeColumn(de), step.name);
        break;
      }
      case 'Table.RemoveColumns': {
        for (const n of allStrings(args[1] ?? '')) removed.set(normalizeColumn(n), step.name);
        break;
      }
      case 'Table.SelectColumns': {
        // Projeção: o que não está na lista sai. Registrar o que sai exigiria
        // conhecer o conjunto anterior, que pode ser opaco — então registra-se
        // apenas que houve projeção, via passo opaco.
        opaque.push(step);
        break;
      }
      default:
        throw new MScanError(
          `Passo M não reconhecido: '${step.name}' usa ${fn}. `
            + 'Acrescente o efeito em backend/tools/validate/src/mlayer.ts — '
            + 'assumir que não mexe em coluna esconderia o erro.',
        );
    }
  }

  return { steps, produced, removed, rowEffects, opaque };
}

/** A coluna nasce em M? Devolve a origem mais recente. */
export function originOf(scan: MScan, column: string): MColumnOrigin | null {
  const key = normalizeColumn(column);
  for (let i = scan.produced.length - 1; i >= 0; i--) {
    if (normalizeColumn(scan.produced[i].column) === key) return scan.produced[i];
  }
  return null;
}

/**
 * O `rowCount` do golden (contagem do SQL) é comparável com a contagem de linhas
 * da tabela no Power BI? Só quando nenhum passo M mexe em linha.
 */
export function rowCountComparable(scan: MScan): boolean {
  return scan.rowEffects.length === 0;
}
