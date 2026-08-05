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

import type { DaxNode } from './ast.ts';
import type { EvalScope, Evaluator } from './evaluator.ts';
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
  const n = args[0]!;
  const tabela =
    n.type === 'TableRef' ? n.name : n.type === 'Identifier' && ev.model.table(n.name) ? n.name : null;
  if (tabela === null) {
    throw new DaxEvalError(
      `${nome}: esperava tabela do modelo e recebeu ${n.type}` +
        (n.type === 'Identifier' ? ` (${n.name})` : '') +
        `. Expressão de tabela (FILTER, VALUES, VAR de tabela) chega nos passos 2 e 6.`,
    );
  }
  const linhas = ev.filterRows(scope, tabela).length;
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

/** Nomes implementados. O teste de escopo compara isto com o que a base usa. */
export function implementedFunctions(): string[] {
  return [...FUNCOES.keys()].sort();
}
