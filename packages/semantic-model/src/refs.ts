// Extrai as referências que uma expressão DAX faz ao modelo:
// 'Tabela'[Coluna], Tabela[Coluna], [Medida] e 'Tabela' solta.
//
// Isto NÃO é o parser de DAX — é um scanner. Ele existe porque a pergunta
// "estas 78 medidas referenciam coisas que existem?" precisa de resposta antes
// de valer a pena escrever o avaliador: uma medida que aponta para tabela
// inexistente não tem como ser reimplementada, e descobrir isso no meio da
// implementação é caro.
//
// O scanner é consciente de string e comentário porque o DAX real da base tem
// comentários com aspas dentro: `// Substitua 'SuaTabela' pelo nome real`.
// Um regex ingênuo leria 'SuaTabela' como referência a tabela.

export type DaxRef =
  /** `'Tabela'[Coluna]` ou `Tabela[Coluna]`. */
  | { kind: 'column'; table: string; column: string; hierarchyPart?: string }
  /** `[Nome]` sem tabela: pode ser medida OU coluna da tabela do contexto. */
  | { kind: 'bare'; name: string }
  /** `'Tabela'` sem `[` depois — argumento de tabela (FILTER, COUNTROWS...). */
  | { kind: 'table'; table: string }
  /** Identificador nu: pode ser tabela sem aspas (`calendar`), VAR ou função. */
  | { kind: 'word'; name: string };

/**
 * Palavras que são sintaxe do DAX, não referência ao modelo.
 *
 * Inclui os enums passados como argumento nu, que o scanner veria como
 * identificador solto: `DATEDIFF(a, b, MINUTE)` e `RANKX(t, e, , ASC, DENSE)`
 * são o DAX real da base. Os que também são nome de função (YEAR, MONTH, DAY,
 * HOUR, MINUTE, SECOND) só chegam aqui na forma nua — na forma de chamada vem
 * um `(` depois e o scanner já ignora.
 */
export const DAX_KEYWORDS = new Set([
  'var', 'return', 'in', 'not', 'and', 'or', 'true', 'false', 'blank',
  'order', 'by', 'asc', 'desc', 'start', 'at', 'define', 'measure', 'evaluate',
  // intervalos de DATEDIFF / DATEADD
  'second', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year',
  // opções de RANKX / TOPN
  'dense', 'skip', 'both', 'none',
]);

const IDENT_START = /[A-Za-z_À-ɏ]/;
const IDENT_PART = /[A-Za-z0-9_.À-ɏ°]/;

/**
 * Primeiro caractere não-branco a partir de `i`.
 *
 * Existe para o `(` de chamada de função: o DAX da base escreve
 * `SELECTEDVALUE ( calendar[Data] )` e `TRUNC ( ... )` com espaço antes do
 * parêntese. Sem pular o branco, 57 nomes de função DAX eram reportados como
 * identificador não resolvido e afogavam os 3 problemas de verdade.
 *
 * O `[` de coluna continua exigindo adjacência: `'T' [C]` não aparece na base,
 * e aceitar espaço ali abriria a porta para ler `VAR x` seguido de `[Medida]`
 * na linha seguinte como se fosse `x[Medida]`.
 */
function nextNonSpace(dax: string, i: number): string {
  let j = i;
  while (j < dax.length && /\s/.test(dax[j])) j += 1;
  return dax[j] ?? '';
}

function readQuoted(dax: string, i: number): { name: string; next: number } {
  // i aponta para a aspa simples de abertura. TMDL/DAX escapam aspa dobrando.
  let out = '';
  let j = i + 1;
  while (j < dax.length) {
    if (dax[j] === "'") {
      if (dax[j + 1] === "'") {
        out += "'";
        j += 2;
        continue;
      }
      return { name: out, next: j + 1 };
    }
    out += dax[j];
    j += 1;
  }
  // Aspa nunca fechada: devolve o que leu e para no fim.
  return { name: out, next: j };
}

function readBracket(dax: string, i: number): { name: string; next: number } | null {
  // i aponta para '['. Colchete não aceita aninhamento em DAX.
  const end = dax.indexOf(']', i + 1);
  if (end === -1) return null;
  return { name: dax.slice(i + 1, end), next: end + 1 };
}

function skipDoubleQuoted(dax: string, i: number): number {
  let j = i + 1;
  while (j < dax.length) {
    if (dax[j] === '"') {
      if (dax[j + 1] === '"') {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j += 1;
  }
  return j;
}

/**
 * Lê `[Coluna]` (e um eventual `.[Parte]` de hierarquia de datas) depois de um
 * nome de tabela. Devolve a nova posição.
 */
function readColumnAfterTable(
  dax: string,
  i: number,
  table: string,
  refs: DaxRef[],
): number {
  const col = readBracket(dax, i);
  if (!col) return i + 1;
  const ref: DaxRef = { kind: 'column', table, column: col.name };
  let next = col.next;
  // `'CALENDARIO INSTALADO'[DATA INSTALADO].[Dia]` — parte de hierarquia
  // automática de datas. Sem tratar, o `[Dia]` viraria uma medida inexistente.
  if (dax[next] === '.' && dax[next + 1] === '[') {
    const part = readBracket(dax, next + 1);
    if (part) {
      ref.hierarchyPart = part.name;
      next = part.next;
    }
  }
  refs.push(ref);
  return next;
}

export function extractRefs(dax: string): DaxRef[] {
  const refs: DaxRef[] = [];
  let i = 0;
  const n = dax.length;

  while (i < n) {
    const c = dax[i];

    // comentário de linha: -- ou //
    if ((c === '-' && dax[i + 1] === '-') || (c === '/' && dax[i + 1] === '/')) {
      while (i < n && dax[i] !== '\n') i += 1;
      continue;
    }
    // comentário de bloco
    if (c === '/' && dax[i + 1] === '*') {
      i += 2;
      while (i < n && !(dax[i] === '*' && dax[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    // literal de texto
    if (c === '"') {
      i = skipDoubleQuoted(dax, i);
      continue;
    }
    // identificador entre aspas simples: tabela
    if (c === "'") {
      const q = readQuoted(dax, i);
      i = q.next;
      if (dax[i] === '[') {
        i = readColumnAfterTable(dax, i, q.name, refs);
      } else {
        refs.push({ kind: 'table', table: q.name });
      }
      continue;
    }
    // [Algo] sem tabela antes
    if (c === '[') {
      const b = readBracket(dax, i);
      if (!b) {
        i += 1;
        continue;
      }
      refs.push({ kind: 'bare', name: b.name });
      i = b.next;
      continue;
    }
    // identificador nu
    if (IDENT_START.test(c)) {
      const start = i;
      while (i < n && IDENT_PART.test(dax[i])) i += 1;
      const word = dax.slice(start, i);
      if (dax[i] === '[') {
        // `calendar[Protocolo]` — tabela sem aspas
        i = readColumnAfterTable(dax, i, word, refs);
      } else if (nextNonSpace(dax, i) !== '(' && !DAX_KEYWORDS.has(word.toLowerCase())) {
        // Pode ser tabela sem aspas (`COUNTROWS(calendar)`) ou nome de VAR.
        // Quem resolve é o verificador, que conhece o modelo e os VARs.
        refs.push({ kind: 'word', name: word });
      }
      continue;
    }

    i += 1;
  }

  return refs;
}

/** Nomes de VAR declarados na expressão — não são referências ao modelo. */
export function declaredVars(dax: string): Set<string> {
  const vars = new Set<string>();
  for (const m of dax.matchAll(/\bVAR\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) {
    vars.add(m[1].toLowerCase());
  }
  return vars;
}
