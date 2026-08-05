// As funções DAX implementadas.
//
// Cada função recebe os argumentos **como AST, não avaliados**. Isso é
// necessário, não estilo: `DATEDIFF(a, b, MINUTE)` tem um argumento que é
// palavra-chave e não valor, `IF` não pode avaliar o ramo que não vai usar, e
// `CALCULATE`/`FILTER` (passo 2) recebem expressão para avaliar noutro contexto.
//
// O que não está aqui não é suportado: `lookupFunction` devolve `undefined` e o
// avaliador erra alto dizendo o nome da função. Este arquivo é, portanto, a
// declaração honesta do escopo do avaliador.

import { walk, type DaxNode } from './ast.ts';
import type { EvalScope, Evaluator } from './evaluator.ts';
import {
  type TableFilter,
  type TableValue,
  filterFromTable,
  makeTableValue,
  rowKey,
} from './filter.ts';
import {
  BLANK,
  DaxEvalError,
  type DaxValue,
  isBlank,
  makeDate,
  toBoolean,
  toDate,
  toNumber,
  toText,
  compareValues,
  identityKey,
} from './value.ts';

export type DaxFunction = (
  args: DaxNode[],
  scope: EvalScope,
  ev: Evaluator,
  nome: string,
) => DaxValue;

// ---------------------------------------------------------------------------
// Utilidades de argumento
// ---------------------------------------------------------------------------

function exigeArgs(args: DaxNode[], min: number, max: number, nome: string): void {
  if (args.length < min || args.length > max) {
    const esperado = min === max ? `${min}` : `${min} a ${max}`;
    throw new DaxEvalError(`${nome}: esperava ${esperado} argumento(s) e recebeu ${args.length}.`);
  }
}

/** Argumento presente e não omitido (`f(a, , b)` deixa um buraco). */
function presente(args: DaxNode[], i: number): DaxNode | null {
  const n = args[i];
  if (!n || n.type === 'Missing') return null;
  return n;
}

function valor(args: DaxNode[], i: number, scope: EvalScope, ev: Evaluator, nome: string): DaxValue {
  const n = presente(args, i);
  if (!n) throw new DaxEvalError(`${nome}: argumento ${i + 1} obrigatório e ausente.`);
  return ev.evaluate(n, scope);
}

/**
 * Argumento que é palavra-chave, não valor — `MINUTE` em `DATEDIFF`, `DENSE` em
 * `RANKX`. Chega como `Identifier` porque o parser não adivinha significado.
 */
function palavraChave(args: DaxNode[], i: number, nome: string, permitidas: string[]): string {
  const n = presente(args, i);
  if (!n) throw new DaxEvalError(`${nome}: argumento ${i + 1} obrigatório e ausente.`);
  if (n.type !== 'Identifier') {
    throw new DaxEvalError(
      `${nome}: argumento ${i + 1} deveria ser palavra-chave (${permitidas.join(', ')}) ` +
        `e veio como ${n.type}.`,
    );
  }
  const k = n.name.toUpperCase();
  if (!permitidas.includes(k)) {
    throw new DaxEvalError(
      `${nome}: palavra-chave ${n.name} não suportada. Suportadas: ${permitidas.join(', ')}.`,
    );
  }
  return k;
}

// ---------------------------------------------------------------------------
// Agregação
// ---------------------------------------------------------------------------

/**
 * Agregação sobre nenhuma linha devolve **BLANK, não 0**.
 *
 * É comportamento do DAX e tem consequência visível: `[# BACKLOG] = 0` e
 * `ISBLANK([# BACKLOG])` dão respostas diferentes, e o cartão do Power BI mostra
 * vazio em vez de zero. Trocar por 0 "para ficar bonito" muda número e muda
 * ramo de IF.
 */
function agregacao(
  args: DaxNode[],
  scope: EvalScope,
  ev: Evaluator,
  nome: string,
  reduzir: (valores: DaxValue[], nome: string) => DaxValue,
): DaxValue {
  exigeArgs(args, 1, 1, nome);
  const valores = ev.valuesOfColumnRef(args[0]!, scope, nome);
  const naoVazios = valores.filter((v) => !isBlank(v));
  if (naoVazios.length === 0) return BLANK;
  return reduzir(naoVazios, nome);
}

const FUNCOES = new Map<string, DaxFunction>();

function def(nome: string, fn: DaxFunction): void {
  FUNCOES.set(nome, fn);
}

def('SUM', (a, s, ev, n) =>
  agregacao(a, s, ev, n, (vs) => vs.reduce((acc, v) => acc + toNumber(v, n), 0)),
);

def('COUNT', (a, s, ev, n) => agregacao(a, s, ev, n, (vs) => vs.length));

def('MIN', (a, s, ev, n) => minMax(a, s, ev, n, -1));
def('MAX', (a, s, ev, n) => minMax(a, s, ev, n, 1));

/**
 * `MIN`/`MAX` do DAX têm duas formas: um argumento agrega uma coluna, dois
 * comparam escalares. Nenhuma expressão desta base usa a forma de dois, mas as
 * duas são DAX válido e distinguir por aridade é o que o DAX faz.
 */
function minMax(
  args: DaxNode[],
  scope: EvalScope,
  ev: Evaluator,
  nome: string,
  sinal: -1 | 1,
): DaxValue {
  if (args.length === 2) {
    const a = valor(args, 0, scope, ev, nome);
    const b = valor(args, 1, scope, ev, nome);
    if (isBlank(a)) return b;
    if (isBlank(b)) return a;
    return compareValues(a, b, false, nome) === sinal ? a : b;
  }
  return agregacao(args, scope, ev, nome, (vs) =>
    vs.reduce((melhor, v) => (compareValues(v, melhor, false, nome) === sinal ? v : melhor)),
  );
}

/**
 * `DISTINCTCOUNT` conta BLANK como **um** valor distinto (é `DISTINCTCOUNTNOBLANK`
 * que ignora), e por isso não passa pelo filtro de `agregacao`.
 *
 * SUPOSIÇÃO A CONFERIR: sobre tabela vazia devolvemos BLANK, por coerência com as
 * outras agregações. Não achamos documentação inequívoca de que o DAX faça o
 * mesmo aqui em vez de devolver 0. Está isolado neste ponto de propósito — se a
 * comparação com o Power BI mostrar 0, muda-se uma linha. Ver docs/ACHADOS.md.
 */
def('DISTINCTCOUNT', (args, scope, ev, nome) => {
  exigeArgs(args, 1, 1, nome);
  const valores = ev.valuesOfColumnRef(args[0]!, scope, nome);
  if (valores.length === 0) return BLANK;
  return new Set(valores.map(identityKey)).size;
});

/**
 * `COUNTROWS` recebe **tabela**, não coluna — e devolve BLANK (não 0) para tabela
 * vazia, que é a razão de existir tanto `COUNTROWS(x) + 0` em DAX de produção.
 */
def('COUNTROWS', (args, scope, ev, nome) => {
  exigeArgs(args, 1, 1, nome);
  const linhas = ev.evaluateTable(args[0]!, scope, nome).rows.length;
  return linhas === 0 ? BLANK : linhas;
});

// ---------------------------------------------------------------------------
// Lógica
// ---------------------------------------------------------------------------

def('IF', (args, scope, ev, nome) => {
  exigeArgs(args, 2, 3, nome);
  const cond = toBoolean(valor(args, 0, scope, ev, nome), nome);
  if (cond) return valor(args, 1, scope, ev, nome);
  const senao = presente(args, 2);
  return senao ? ev.evaluate(senao, scope) : BLANK;
});

/**
 * `SWITCH(expr, v1, r1, v2, r2, ..., [else])`.
 *
 * O padrão `SWITCH(TRUE(), cond1, r1, ...)` é o `CASE WHEN` do DAX e é o que esta
 * base usa. Cai naturalmente do algoritmo geral: compara `TRUE()` com cada
 * condição.
 */
def('SWITCH', (args, scope, ev, nome) => {
  if (args.length < 3) {
    throw new DaxEvalError(`${nome}: esperava ao menos 3 argumentos e recebeu ${args.length}.`);
  }
  const alvo = valor(args, 0, scope, ev, nome);
  let i = 1;
  for (; i + 1 < args.length; i += 2) {
    if (compareValues(alvo, ev.evaluate(args[i]!, scope), false, nome) === 0) {
      return ev.evaluate(args[i + 1]!, scope);
    }
  }
  // Sobrou um argumento ímpar no fim: é o ELSE. Sem ele, SWITCH sem casar é BLANK.
  return i < args.length ? ev.evaluate(args[i]!, scope) : BLANK;
});

def('BLANK', (args, _s, _ev, nome) => {
  exigeArgs(args, 0, 0, nome);
  return BLANK;
});

def('ISBLANK', (args, scope, ev, nome) => {
  exigeArgs(args, 1, 1, nome);
  return isBlank(valor(args, 0, scope, ev, nome));
});

def('COALESCE', (args, scope, ev, nome) => {
  if (args.length === 0) throw new DaxEvalError(`${nome}: esperava ao menos 1 argumento.`);
  for (let i = 0; i < args.length; i++) {
    const v = valor(args, i, scope, ev, nome);
    if (!isBlank(v)) return v;
  }
  return BLANK;
});

def('OR', (args, scope, ev, nome) => {
  // `OR` do DAX é binário — 2 argumentos, não N. Quem quer N usa `||`.
  exigeArgs(args, 2, 2, nome);
  return (
    toBoolean(valor(args, 0, scope, ev, nome), nome) ||
    toBoolean(valor(args, 1, scope, ev, nome), nome)
  );
});

// ---------------------------------------------------------------------------
// Matemática
// ---------------------------------------------------------------------------

/**
 * `DIVIDE(n, d, [alt])` — divisão protegida. Denominador 0 **ou BLANK** devolve
 * `alt`, que por omissão é BLANK. É a diferença deliberada em relação a `/`, que
 * devolve infinito.
 */
def('DIVIDE', (args, scope, ev, nome) => {
  exigeArgs(args, 2, 3, nome);
  const num = valor(args, 0, scope, ev, nome);
  const den = valor(args, 1, scope, ev, nome);
  if (isBlank(den) || toNumber(den, nome) === 0) {
    const alt = presente(args, 2);
    return alt ? ev.evaluate(alt, scope) : BLANK;
  }
  return toNumber(num, nome) / toNumber(den, nome);
});

/**
 * `ROUND` do DAX arredonda **meio para longe do zero**: ROUND(-2,5; 0) é -3.
 * `Math.round` do JS daria -2 (arredonda para +infinito). É a classe de erro que
 * aparece como "um centavo de diferença" e ninguém rastreia.
 */
def('ROUND', (args, scope, ev, nome) => {
  exigeArgs(args, 2, 2, nome);
  const n = toNumber(valor(args, 0, scope, ev, nome), nome);
  const d = Math.trunc(toNumber(valor(args, 1, scope, ev, nome), nome));
  const f = 10 ** d;
  return (Math.sign(n) * Math.round(Math.abs(n) * f)) / f;
});

/** `INT` arredonda para baixo (piso): INT(-2,5) é -3. Não confundir com TRUNC. */
def('INT', (args, scope, ev, nome) => {
  exigeArgs(args, 1, 1, nome);
  return Math.floor(toNumber(valor(args, 0, scope, ev, nome), nome));
});

/** `TRUNC` corta em direção ao zero: TRUNC(-2,5) é -2. Difere de INT nos negativos. */
def('TRUNC', (args, scope, ev, nome) => {
  exigeArgs(args, 1, 2, nome);
  const n = toNumber(valor(args, 0, scope, ev, nome), nome);
  const d = presente(args, 1) ? Math.trunc(toNumber(valor(args, 1, scope, ev, nome), nome)) : 0;
  const f = 10 ** d;
  return Math.trunc(n * f) / f;
});

/**
 * `MOD` do DAX devolve resto com o **sinal do divisor** (como o Excel):
 * MOD(-3; 2) é 1, não -1 como faria o `%` do JS.
 */
def('MOD', (args, scope, ev, nome) => {
  exigeArgs(args, 2, 2, nome);
  const a = toNumber(valor(args, 0, scope, ev, nome), nome);
  const b = toNumber(valor(args, 1, scope, ev, nome), nome);
  if (b === 0) throw new DaxEvalError(`${nome}: divisor zero.`);
  return a - b * Math.floor(a / b);
});

/** `QUOTIENT` é a parte inteira da divisão, truncando em direção ao zero. */
def('QUOTIENT', (args, scope, ev, nome) => {
  exigeArgs(args, 2, 2, nome);
  const a = toNumber(valor(args, 0, scope, ev, nome), nome);
  const b = toNumber(valor(args, 1, scope, ev, nome), nome);
  if (b === 0) throw new DaxEvalError(`${nome}: divisor zero.`);
  return Math.trunc(a / b);
});

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

def('LOWER', (args, scope, ev, nome) => {
  exigeArgs(args, 1, 1, nome);
  return toText(valor(args, 0, scope, ev, nome)).toLocaleLowerCase('pt-BR');
});

/**
 * `CONCATENATE(a, b)` é binário — 2 argumentos, não N. Quem quer N usa `&`.
 *
 * Só aparece em `'CALENDARIO AGENDAMENTO'[Semana Do Mes Texto]`, que era uma das
 * seis colunas que o extrator perdia; por isso esta função não constava do
 * inventário do avaliador até agora.
 */
def('CONCATENATE', (args, scope, ev, nome) => {
  exigeArgs(args, 2, 2, nome);
  return toText(valor(args, 0, scope, ev, nome)) + toText(valor(args, 1, scope, ev, nome));
});

/** `SUBSTITUTE` é **sensível à caixa** (ao contrário da comparação) e troca todas. */
def('SUBSTITUTE', (args, scope, ev, nome) => {
  exigeArgs(args, 3, 3, nome);
  const texto = toText(valor(args, 0, scope, ev, nome));
  const de = toText(valor(args, 1, scope, ev, nome));
  const para = toText(valor(args, 2, scope, ev, nome));
  if (de === '') return texto;
  return texto.split(de).join(para);
});

/**
 * `CONTAINSSTRING` **não** distingue caixa (a versão estrita é
 * `CONTAINSSTRINGEXACT`) e aceita curingas `*` e `?` no DAX.
 *
 * Curinga não está implementado, e por isso erra alto quando aparece: nenhuma das
 * 26 chamadas desta base usa curinga (verificado), e tratar `*` como literal
 * devolveria `FALSE` calado justamente onde o Power BI acharia.
 */
def('CONTAINSSTRING', (args, scope, ev, nome) => {
  exigeArgs(args, 2, 2, nome);
  const onde = toText(valor(args, 0, scope, ev, nome)).toLocaleLowerCase('pt-BR');
  const que = toText(valor(args, 1, scope, ev, nome));
  if (que.includes('*') || que.includes('?')) {
    throw new DaxEvalError(
      `${nome}: curinga (* ou ?) não implementado, e ${JSON.stringify(que)} tem um.`,
    );
  }
  return onde.includes(que.toLocaleLowerCase('pt-BR'));
});

const DIAS_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/**
 * `FORMAT(valor, formato)` — só os dois formatos que esta base usa.
 *
 * `"dddd"` devolve o dia da semana **em português**, e isso não é detalhe: a
 * coluna `'CALENDARIO INSTALADO'[DIA_SEMANA]` é `FORMAT(data, "dddd")` e o
 * `SWITCH` do `[PESO]` compara com `"domingo"`. Se sair "Sunday", nenhum domingo
 * casa e todo domingo passa a valer 1 dia útil — número errado, zero erro.
 * A cultura vem do modelo: `culture: pt-BR` em model.tmdl.
 */
def('FORMAT', (args, scope, ev, nome) => {
  exigeArgs(args, 2, 3, nome);
  const v = valor(args, 0, scope, ev, nome);
  const fmt = toText(valor(args, 1, scope, ev, nome));
  if (fmt === 'dddd') return DIAS_PT[toDate(v, nome).getUTCDay()]!;
  if (fmt === '0') return String(Math.round(toNumber(v, nome)));
  throw new DaxEvalError(
    `${nome}: formato ${JSON.stringify(fmt)} não implementado. ` +
      `Implementados: "dddd" e "0" — os únicos usados na base.`,
  );
});

// ---------------------------------------------------------------------------
// Data e hora
// ---------------------------------------------------------------------------

def('TODAY', (args, _s, ev, nome) => {
  exigeArgs(args, 0, 0, nome);
  return makeDate(ev.now.getUTCFullYear(), ev.now.getUTCMonth() + 1, ev.now.getUTCDate());
});

def('NOW', (args, _s, ev, nome) => {
  exigeArgs(args, 0, 0, nome);
  return new Date(ev.now.getTime());
});

def('DATE', (args, scope, ev, nome) => {
  exigeArgs(args, 3, 3, nome);
  return makeDate(
    Math.trunc(toNumber(valor(args, 0, scope, ev, nome), nome)),
    Math.trunc(toNumber(valor(args, 1, scope, ev, nome), nome)),
    Math.trunc(toNumber(valor(args, 2, scope, ev, nome), nome)),
  );
});

/** Componente de data. BLANK entra, BLANK sai — sem virar 30/12/1899. */
function componenteData(nome: string, extrair: (d: Date) => number): DaxFunction {
  return (args, scope, ev) => {
    exigeArgs(args, 1, 1, nome);
    const v = valor(args, 0, scope, ev, nome);
    if (isBlank(v)) return BLANK;
    return extrair(toDate(v, nome));
  };
}

def('YEAR', componenteData('YEAR', (d) => d.getUTCFullYear()));
def('MONTH', componenteData('MONTH', (d) => d.getUTCMonth() + 1));
def('DAY', componenteData('DAY', (d) => d.getUTCDate()));
def('HOUR', componenteData('HOUR', (d) => d.getUTCHours()));

/**
 * `WEEKDAY(data, [tipo])`. Toda chamada desta base usa tipo 2 (1=segunda ...
 * 7=domingo), que é o que a regra de dias úteis assume.
 */
def('WEEKDAY', (args, scope, ev, nome) => {
  exigeArgs(args, 1, 2, nome);
  const v = valor(args, 0, scope, ev, nome);
  if (isBlank(v)) return BLANK;
  const dow = toDate(v, nome).getUTCDay(); // 0=domingo
  const tipo = presente(args, 1) ? Math.trunc(toNumber(valor(args, 1, scope, ev, nome), nome)) : 1;
  switch (tipo) {
    case 1:
      return dow + 1; // 1=domingo .. 7=sábado
    case 2:
      return ((dow + 6) % 7) + 1; // 1=segunda .. 7=domingo
    case 3:
      return (dow + 6) % 7; // 0=segunda .. 6=domingo
    default:
      throw new DaxEvalError(`${nome}: tipo de retorno ${tipo} não suportado (1, 2 ou 3).`);
  }
});

def('TIME', (args, scope, ev, nome) => {
  exigeArgs(args, 3, 3, nome);
  const h = toNumber(valor(args, 0, scope, ev, nome), nome);
  const m = toNumber(valor(args, 1, scope, ev, nome), nome);
  const s = toNumber(valor(args, 2, scope, ev, nome), nome);
  // Hora em DAX é a parte fracionária do número de série da data.
  return (h * 3600 + m * 60 + s) / 86400;
});

/** `EOMONTH(inicio, meses)` — último dia do mês, deslocado por `meses`. */
def('EOMONTH', (args, scope, ev, nome) => {
  exigeArgs(args, 2, 2, nome);
  const d = toDate(valor(args, 0, scope, ev, nome), nome);
  const meses = Math.trunc(toNumber(valor(args, 1, scope, ev, nome), nome));
  // Dia 0 do mês seguinte é o último dia do mês desejado.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses + 1, 0));
});

/**
 * `DATEVALUE(texto)` — converte texto em data usando a cultura do modelo.
 *
 * Aceita `DD/MM/YYYY` (pt-BR) e `YYYY-MM-DD` (ISO), com hora opcional. Recusa o
 * resto em vez de deixar o `Date` do JS palpitar: `new Date("03/04/2026")` lê
 * **março**, e nesta base essa data é 3 de abril. Foi essa classe de erro que
 * produziu o achado falso dos feriados.
 */
def('DATEVALUE', (args, scope, ev, nome) => {
  exigeArgs(args, 1, 1, nome);
  const v = valor(args, 0, scope, ev, nome);
  if (isBlank(v)) return BLANK;
  if (v instanceof Date) return v;
  const texto = toText(v).trim();

  const ptBr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(texto);
  if (ptBr) {
    const [, d, m, y, hh, mm, ss] = ptBr;
    return new Date(
      Date.UTC(+y!, +m! - 1, +d!, hh ? +hh : 0, mm ? +mm : 0, ss ? +ss : 0),
    );
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(texto);
  if (iso) {
    const [, y, m, d, hh, mm, ss] = iso;
    return new Date(
      Date.UTC(+y!, +m! - 1, +d!, hh ? +hh : 0, mm ? +mm : 0, ss ? +ss : 0),
    );
  }

  throw new DaxEvalError(
    `${nome}: não reconheço ${JSON.stringify(texto)} como data. ` +
      `Aceito DD/MM/YYYY (pt-BR) e YYYY-MM-DD, com hora opcional.`,
  );
});

/**
 * `DATEDIFF(inicio, fim, intervalo)`.
 *
 * Só `DAY` e `MINUTE` — os únicos que a base usa (verificado nas 7 chamadas).
 *
 * O DAX conta **fronteiras cruzadas** do intervalo pedido, não a duração
 * dividida: de 23:59:59 a 00:00:01 o resultado em MINUTE é 1, embora tenham
 * passado 2 segundos. Daí o `trunc` de cada lado em vez de dividir a diferença.
 *
 * MONTH e YEAR não estão implementados por analogia justamente porque não têm
 * divisor fixo em segundos — implementá-los assim daria número plausível e errado.
 */
const DIVISOR_INTERVALO: Record<string, number> = {
  DAY: 86400,
  MINUTE: 60,
};

def('DATEDIFF', (args, scope, ev, nome) => {
  exigeArgs(args, 3, 3, nome);
  const a = valor(args, 0, scope, ev, nome);
  const b = valor(args, 1, scope, ev, nome);
  if (isBlank(a) || isBlank(b)) return BLANK;
  const intervalo = palavraChave(args, 2, nome, Object.keys(DIVISOR_INTERVALO));
  const ini = toDate(a, nome).getTime() / 1000;
  const fim = toDate(b, nome).getTime() / 1000;
  const div = DIVISOR_INTERVALO[intervalo]!;
  return Math.trunc(fim / div) - Math.trunc(ini / div);
});

// ---------------------------------------------------------------------------

export function lookupFunction(nome: string): DaxFunction | undefined {
  return FUNCOES.get(nome.toUpperCase());
}

// ---------------------------------------------------------------------------
// Contexto de filtro
// ---------------------------------------------------------------------------

/** Funções que devolvem tabela. Registro separado: o avaliador chama por outro caminho. */
export type TableFunction = (
  args: DaxNode[],
  scope: EvalScope,
  ev: Evaluator,
  nome: string,
) => TableValue;

const TABELAS = new Map<string, TableFunction>();

function defTable(nome: string, fn: TableFunction): void {
  TABELAS.set(nome, fn);
}

/**
 * As colunas que uma expressão booleana de filtro restringe, e de qual tabela.
 *
 * Um filtro booleano do `CALCULATE` tem de referenciar colunas de **uma só**
 * tabela — é regra do DAX, e recusar aqui é melhor que escolher uma das tabelas.
 * O DAX real escreve tanto `'T'[C] = "x"` quanto `YEAR('T'[C]) = YEAR(TODAY())`;
 * as duas formas têm a coluna embrulhada em função, então é o AST que responde
 * quais colunas estão em jogo, não o formato da expressão.
 */
function colunasDoFiltro(node: DaxNode, nome: string): { table: string; columns: Set<string> } {
  const porTabela = new Map<string, Set<string>>();
  walk(node, (n) => {
    if (n.type !== 'ColumnRef') return;
    const t = n.table.toLowerCase();
    if (!porTabela.has(t)) porTabela.set(t, new Set());
    porTabela.get(t)!.add(n.column.toLowerCase());
  });

  if (porTabela.size === 0) {
    throw new DaxEvalError(
      `${nome}: filtro booleano sem referência a coluna nenhuma. ` +
        `Em DAX o filtro precisa dizer qual coluna restringe.`,
    );
  }
  if (porTabela.size > 1) {
    throw new DaxEvalError(
      `${nome}: filtro booleano referencia colunas de ${porTabela.size} tabelas ` +
        `(${[...porTabela.keys()].join(', ')}). DAX exige uma só.`,
    );
  }
  const [table, columns] = [...porTabela.entries()][0]!;
  return { table, columns };
}

/**
 * Converte um argumento de filtro do `CALCULATE` em `TableFilter`.
 *
 * Dois casos, e só dois: expressão booleana ou expressão de tabela. Qualquer
 * outra coisa erra alto.
 */
function filtroDe(node: DaxNode, scope: EvalScope, ev: Evaluator, nome: string): TableFilter {
  if (ev.isTableExpression(node, scope)) {
    return filterFromTable(ev.evaluateTable(node, scope, nome), `${nome}: expressão de tabela`);
  }

  const { table, columns } = colunasDoFiltro(node, nome);
  const modelo = ev.model.table(table);
  if (!modelo) throw new DaxEvalError(`${nome}: tabela '${table}' não existe no modelo.`);

  // O filtro booleano é avaliado sobre a tabela SEM os filtros que ele próprio
  // substitui — é o que faz CALCULATE([x], 'T'[Ano] = 2026) devolver 2026 mesmo
  // dentro de um contexto já filtrado em 2025, em vez de vazio.
  const semConflito = scope.filter.without(
    (f) => f.table === table && (f.columns.size === 0 || [...columns].some((c) => f.columns.has(c))),
  );
  const escopoDoFiltro: EvalScope = { filter: semConflito, rows: new Map(), vars: scope.vars };

  return {
    table,
    columns,
    origem: `${nome}: filtro booleano`,
    keep: (row) =>
      toBoolean(ev.evaluate(node, ev.scopeWithRow(escopoDoFiltro, modelo.name, row)), nome),
  };
}

/**
 * `CALCULATE(expr, filtro1, filtro2, ...)`.
 *
 * Duas coisas acontecem, e as duas importam:
 *
 * 1. Os filtros **substituem** os filtros existentes sobre as mesmas colunas, em
 *    vez de somar. Ver `FilteredContext.with`.
 * 2. O contexto de linha vira contexto de filtro (transição de contexto) e é
 *    apagado. É por isso que `CALCULATE` com um único argumento não é inútil: numa
 *    coluna calculada ou dentro de um iterador, ele muda o resultado. A base tem 5
 *    chamadas de um argumento só.
 */
def('CALCULATE', (args, scope, ev, nome) => {
  if (args.length === 0) throw new DaxEvalError(`${nome}: esperava ao menos 1 argumento.`);
  return ev.evaluate(args[0]!, contextoDeCalculate(args, scope, ev, nome));
});

function contextoDeCalculate(
  args: DaxNode[],
  scope: EvalScope,
  ev: Evaluator,
  nome: string,
): EvalScope {
  const transicionado = ev.scopeWithFilter(scope, ev.transitionRowContext(scope));
  const novos = args.slice(1).map((a) => filtroDe(a, scope, ev, nome));
  return ev.scopeWithFilter(transicionado, transicionado.filter.with(novos));
}

/** `CALCULATETABLE` é o `CALCULATE` que devolve tabela. Mesma semântica de filtro. */
defTable('CALCULATETABLE', (args, scope, ev, nome) => {
  if (args.length === 0) throw new DaxEvalError(`${nome}: esperava ao menos 1 argumento.`);
  return ev.evaluateTable(args[0]!, contextoDeCalculate(args, scope, ev, nome), nome);
});

/**
 * `FILTER(tabela, condição)` — itera a tabela **no contexto corrente** e mantém as
 * linhas em que a condição é verdadeira. Diferente do filtro booleano de
 * `CALCULATE`, não substitui nada: soma ao que já havia.
 */
defTable('FILTER', (args, scope, ev, nome) => {
  exigeArgs(args, 2, 2, nome);
  const origem = ev.evaluateTable(args[0]!, scope, nome);
  const modelo = ev.model.table(origem.table);
  const rotulo = modelo?.name ?? origem.table;
  const rows = origem.rows.filter((row) =>
    toBoolean(ev.evaluate(args[1]!, ev.scopeWithRow(scope, rotulo, row)), nome),
  );
  return makeTableValue(origem.table, origem.columns, rows);
});

/**
 * `ALL('T'[C])` — todos os valores de `C`, ignorando o contexto de filtro.
 *
 * Não há tratamento especial de "remover filtro": como argumento de `CALCULATE`
 * ele vira um filtro que aceita todo valor de `C`, e substituir o filtro anterior
 * por "aceita tudo" **é** remover o filtro. Ver `filterFromTable`.
 */
defTable('ALL', (args, scope, ev, nome) => {
  exigeArgs(args, 1, 1, nome);
  const n = args[0]!;
  if (n.type === 'ColumnRef') {
    const semFiltro: EvalScope = {
      filter: scope.filter.without((f) => f.table === n.table.toLowerCase()),
      rows: new Map(),
      vars: scope.vars,
    };
    return distintosDaColuna(n, semFiltro, ev, nome);
  }
  if (n.type === 'TableRef' || n.type === 'Identifier') {
    const t = ev.model.table(n.type === 'TableRef' ? n.name : n.name);
    if (!t) throw new DaxEvalError(`${nome}: '${n.name}' não é tabela do modelo.`);
    return makeTableValue(t.name, t.columns.map((c) => c.name), ev.dataset.rows(t.name));
  }
  throw new DaxEvalError(`${nome}: esperava coluna ou tabela e recebeu nó ${n.type}.`);
});

/** Linhas de uma coluna, distintas, como tabela de uma coluna. */
function distintosDaColuna(
  n: Extract<DaxNode, { type: 'ColumnRef' }>,
  scope: EvalScope,
  ev: Evaluator,
  nome: string,
): TableValue {
  const chave = n.column.toLowerCase();
  const vistas = new Set<string>();
  const rows = [];
  for (const v of ev.valuesOfColumnRef(n, scope, nome)) {
    const row = { [chave]: v };
    const k = rowKey(row, [chave]);
    if (vistas.has(k)) continue;
    vistas.add(k);
    rows.push(row);
  }
  return makeTableValue(n.table, [chave], rows);
}

/**
 * `VALUES('T'[C])` e `DISTINCT('T'[C])` — valores distintos de `C` no contexto.
 *
 * A diferença entre as duas no DAX é o "blank extra" que `VALUES` acrescenta
 * quando há violação de integridade referencial num relacionamento. Sem
 * relacionamentos avaliados ainda (passo seguinte), as duas coincidem — e isso
 * fica registrado aqui em vez de virar surpresa depois.
 */
defTable('VALUES', (args, scope, ev, nome) => {
  exigeArgs(args, 1, 1, nome);
  const n = args[0]!;
  if (n.type !== 'ColumnRef') {
    throw new DaxEvalError(`${nome}: só há suporte para VALUES de coluna; recebeu ${n.type}.`);
  }
  return distintosDaColuna(n, scope, ev, nome);
});

defTable('DISTINCT', (args, scope, ev, nome) => {
  exigeArgs(args, 1, 1, nome);
  const n = args[0]!;
  if (n.type !== 'ColumnRef') {
    throw new DaxEvalError(`${nome}: só há suporte para DISTINCT de coluna; recebeu ${n.type}.`);
  }
  return distintosDaColuna(n, scope, ev, nome);
});

/**
 * `TREATAS(tabela, 'Destino'[Coluna])` — usa os valores de uma tabela como filtro
 * de outra coluna, sem relacionamento entre elas.
 *
 * A base usa isso para cruzar `FIELD AGENDA` com `PROTOCOLOS GERAL` por número de
 * protocolo. O resultado é a mesma lista de valores, apontada para a coluna de
 * destino — daí ser só uma troca de rótulo.
 */
defTable('TREATAS', (args, scope, ev, nome) => {
  exigeArgs(args, 2, 2, nome);
  const origem = ev.evaluateTable(args[0]!, scope, nome);
  const destino = args[1]!;
  if (destino.type !== 'ColumnRef') {
    throw new DaxEvalError(`${nome}: o destino tem de ser uma coluna; recebeu ${destino.type}.`);
  }
  if (origem.columns.size !== 1) {
    throw new DaxEvalError(
      `${nome}: a tabela de origem tem ${origem.columns.size} colunas; para uma coluna de ` +
        `destino é preciso exatamente 1.`,
    );
  }
  const de = [...origem.columns][0]!;
  const para = destino.column.toLowerCase();
  return makeTableValue(
    destino.table,
    [para],
    origem.rows.map((r) => ({ [para]: r[de] ?? BLANK })),
  );
});

/**
 * `SELECTEDVALUE('T'[C], [alternativo])` — o valor de `C` se o contexto deixou
 * exatamente um; senão o alternativo (BLANK por omissão).
 *
 * Devolver o primeiro valor quando há vários seria o erro clássico: o número sai
 * plausível e depende da ordem das linhas.
 */
def('SELECTEDVALUE', (args, scope, ev, nome) => {
  exigeArgs(args, 1, 2, nome);
  const n = args[0]!;
  if (n.type !== 'ColumnRef') {
    throw new DaxEvalError(`${nome}: esperava coluna e recebeu ${n.type}.`);
  }
  const distintos = distintosDaColuna(n, scope, ev, nome);
  if (distintos.rows.length === 1) {
    return distintos.rows[0]![n.column.toLowerCase()] ?? BLANK;
  }
  const alt = presente(args, 1);
  return alt ? ev.evaluate(alt, scope) : BLANK;
});

/**
 * `LOOKUPVALUE('R'[Result], 'B'[Busca], <valor>, ...)` — procura a linha em que
 * `Busca = valor` e devolve `Result`.
 *
 * BLANK quando não acha; **erro** quando acha valores de resultado diferentes. O
 * DAX também erra nesse caso, e é o comportamento certo: `CALENDARIO
 * INSTALADO[PESO]` usa esta função para saber se a data é feriado, e devolver
 * silenciosamente um dos resultados mudaria o peso do dia.
 *
 * Ignora o contexto de filtro, como no DAX — a busca é sobre a tabela toda.
 */
def('LOOKUPVALUE', (args, scope, ev, nome) => {
  if (args.length < 3 || args.length % 2 === 0) {
    throw new DaxEvalError(
      `${nome}: esperava resultado + pares (coluna, valor); recebeu ${args.length} argumentos.`,
    );
  }
  const resultado = args[0]!;
  if (resultado.type !== 'ColumnRef') {
    throw new DaxEvalError(`${nome}: o primeiro argumento tem de ser coluna; veio ${resultado.type}.`);
  }

  const pares: { coluna: string; valor: DaxValue }[] = [];
  for (let i = 1; i < args.length; i += 2) {
    const col = args[i]!;
    if (col.type !== 'ColumnRef') {
      throw new DaxEvalError(`${nome}: argumento ${i + 1} tem de ser coluna; veio ${col.type}.`);
    }
    if (col.table.toLowerCase() !== resultado.table.toLowerCase()) {
      throw new DaxEvalError(
        `${nome}: a coluna de busca é de '${col.table}' e o resultado de ` +
          `'${resultado.table}'. LOOKUPVALUE procura numa tabela só.`,
      );
    }
    pares.push({ coluna: col.column, valor: valor(args, i + 1, scope, ev, nome) });
  }

  const encontrados = new Map<string, DaxValue>();
  for (const row of ev.dataset.rows(resultado.table)) {
    let casa = true;
    for (const p of pares) {
      if (compareValues(ev.columnValue(resultado.table, p.coluna, row), p.valor, false, nome) !== 0) {
        casa = false;
        break;
      }
    }
    if (!casa) continue;
    const v = ev.columnValue(resultado.table, resultado.column, row);
    encontrados.set(identityKey(v), v);
  }

  if (encontrados.size === 0) return BLANK;
  if (encontrados.size > 1) {
    throw new DaxEvalError(
      `${nome}: a busca casou ${encontrados.size} valores diferentes de ` +
        `'${resultado.table}'[${resultado.column}]. Em DAX isso é erro, não "escolhe um".`,
    );
  }
  return [...encontrados.values()][0]!;
});

/**
 * `AVERAGEX(tabela, expressão)` — média da expressão avaliada linha a linha.
 *
 * Média de nada é BLANK, e linha cuja expressão dá BLANK **não entra na média** —
 * não conta como zero. Contar BLANK como zero derrubaria a média sem erro nenhum.
 */
def('AVERAGEX', (args, scope, ev, nome) => {
  exigeArgs(args, 2, 2, nome);
  const tabela = ev.evaluateTable(args[0]!, scope, nome);
  const rotulo = ev.model.table(tabela.table)?.name ?? tabela.table;
  let soma = 0;
  let n = 0;
  for (const row of tabela.rows) {
    const v = ev.evaluate(args[1]!, ev.scopeWithRow(scope, rotulo, row));
    if (isBlank(v)) continue;
    soma += toNumber(v, nome);
    n++;
  }
  return n === 0 ? BLANK : soma / n;
});

// ---------------------------------------------------------------------------

/** Nomes implementados. O teste de escopo compara isto com o que a base usa. */
export function implementedFunctions(): string[] {
  return [...new Set([...FUNCOES.keys(), ...TABELAS.keys()])].sort();
}

export function lookupTableFunction(nome: string): TableFunction | undefined {
  return TABELAS.get(nome.toUpperCase());
}
