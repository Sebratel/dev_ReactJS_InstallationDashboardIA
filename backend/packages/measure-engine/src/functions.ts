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

import { normalizeName } from '../../semantic-model/src/model.ts';
import { walk, type DaxNode } from './ast.ts';
import { copiaLinha, type Row } from './dataset.ts';
import type { EvalScope, Evaluator } from './evaluator.ts';
import { igualdadeIndexavel, indiceDe, MINIMO_PARA_INDEXAR } from './indice.ts';
import {
  type TableFilter,
  type TableValue,
  filterFromTable,
  makeTableValue,
  orderedColumns,
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
  // O rótulo leva a **coluna** para dentro do erro do redutor. `SUM: esperava
  // número e recebeu o texto "1"` não diz onde procurar; `SUM('PROTOCOLOS
  // GERAL'[CONTAGEM])` diz — e num modelo de 298 colunas essa diferença é a
  // diferença entre um erro acionável e uma caça.
  return reduzir(naoVazios, rotuloDaAgregacao(nome, args[0]!));
}

function rotuloDaAgregacao(nome: string, ref: DaxNode): string {
  return ref.type === 'ColumnRef' ? `${nome}('${ref.table}'[${ref.column}])` : nome;
}

const FUNCOES = new Map<string, DaxFunction>();

function def(nome: string, fn: DaxFunction): void {
  FUNCOES.set(nome, fn);
}

def('SUM', (a, s, ev, n) =>
  agregacao(a, s, ev, n, (vs, onde) => vs.reduce<number>((acc, v) => acc + toNumber(v, onde), 0)),
);

def('COUNT', (a, s, ev, n) => agregacao(a, s, ev, n, (vs) => vs.length));

/**
 * `COUNTA` conta os não-vazios de **qualquer** tipo, e é o que o Widget Engine
 * chama para a agregação `count_non_null` (`Function: 5`) dos campos de visual.
 *
 * Não é redundante com o `COUNT` acima por acidente de implementação: no DAX,
 * `COUNT` conta só número e data, e `COUNTA` conta texto também. O `COUNT` daqui
 * é permissivo (conta qualquer não-vazio), o que é seguro para as expressões desta
 * base — todas as chamadas de `COUNT` no DAX do modelo são sobre coluna numérica.
 * Registrar `COUNTA` separado é o que deixa a intenção do chamador explícita em
 * vez de depender dessa permissividade.
 */
def('COUNTA', (a, s, ev, n) => agregacao(a, s, ev, n, (vs) => vs.length));

/**
 * `AVERAGE`. Média dos não-vazios — vazio **não** conta como zero no denominador,
 * e é aí que ela difere de `SUM/COUNTROWS`.
 */
def('AVERAGE', (a, s, ev, n) =>
  agregacao(a, s, ev, n, (vs, onde) => vs.reduce<number>((acc, v) => acc + toNumber(v, onde), 0) / vs.length),
);

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
 *
 * **Descarta a hora**, como o DAX. Não é detalhe: a coluna `'FIELD
 * AGENDA'[Data]` é `DATEVALUE('FIELD AGENDA'[Slot Agenda])`, e `Slot Agenda` é
 * `dateTime` com hora ("General Date"). O `RANKX` de `[RankDataProtocolo]`
 * compara esse valor com uma lista feita de `TRUNC('FIELD AGENDA'[Slot Agenda])`,
 * que não tem hora. Mantendo a hora, nada casaria e o rank sairia BLANK.
 */
def('DATEVALUE', (args, scope, ev, nome) => {
  exigeArgs(args, 1, 1, nome);
  const v = valor(args, 0, scope, ev, nome);
  if (isBlank(v)) return BLANK;
  if (v instanceof Date) return makeDate(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  const texto = toText(v).trim();

  const ptBr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(texto);
  if (ptBr) return makeDate(+ptBr[3]!, +ptBr[2]!, +ptBr[1]!);

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (iso) return makeDate(+iso[1]!, +iso[2]!, +iso[3]!);

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

  // A mesma igualdade indexável do `FILTER` (ACHADOS #43), aqui pelo outro
  // caminho: `CALCULATE(x, 'T'[c] = <var>)` também varre a tabela por chamada, e
  // em `Status Protocolo Dia` são 2 das 7 varreduras por linha. O valor é avaliado
  // agora, uma vez, no escopo do filtro — `keep` continua sendo a verdade, e o
  // índice só diz por onde começar.
  let igualdade: TableFilter['igualdade'];
  const alvo = igualdadeIndexavel(node, table);
  if (alvo) {
    try {
      igualdade = { coluna: alvo.coluna, valor: ev.evaluate(alvo.valor, escopoDoFiltro) };
    } catch {
      // `Identifier` que não era variável. Sem atalho; o `keep` responde.
    }
  }

  return {
    table,
    columns,
    origem: `${nome}: filtro booleano`,
    igualdade,
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
  const pred = args[1]!;
  // Candidatos pelo índice quando o predicado traz uma igualdade indexável; a
  // tabela inteira quando não traz. Nos dois casos o predicado abaixo é o mesmo e
  // roda inteiro — o índice só encurta a lista (ACHADOS #43).
  const candidatos = candidatosPorIndice(origem, pred, scope, ev, nome) ?? origem.rows;
  const rows = candidatos.filter((row) =>
    toBoolean(ev.evaluate(pred, ev.scopeWithTableRow(scope, origem, row)), nome),
  );
  return makeTableValue(origem.table, origem.columns, [...rows]);
});

/**
 * As linhas de `origem` que podem satisfazer `pred`, ou `null` para "varra tudo".
 *
 * O ganho do achado #43 vem daqui, e a segurança vem de o resultado ser sempre um
 * **superconjunto**: quem chama aplica o predicado inteiro por cima, então este
 * atalho não pode mudar resposta — só pode encurtar a lista. Cada `null` abaixo é
 * uma situação em que encurtar seria arriscado, e a resposta é não encurtar.
 */
function candidatosPorIndice(
  origem: TableValue,
  pred: DaxNode,
  scope: EvalScope,
  ev: Evaluator,
  nome: string,
): readonly Row[] | null {
  // Tabela anônima não tem coluna de modelo, e `SELECTCOLUMNS` pode ter renomeado
  // tudo: o nome no predicado não fala das linhas que estão aqui.
  if (origem.table === null) return null;
  if (origem.rows.length < MINIMO_PARA_INDEXAR) return null;

  const alvo = igualdadeIndexavel(pred, origem.table);
  if (!alvo || !origem.columns.has(alvo.coluna)) return null;

  const indice = indiceDe(origem.rows, alvo.coluna);
  if (!indice) return null;

  // O valor é avaliado **sem** a linha varrida, que é o que torna uma avaliação só
  // suficiente para todas elas. `avaliavelForaDaLinha` já garantiu que ele não
  // depende da linha; o `try` é para o `Identifier` que não era variável (nome de
  // tabela, enum): ali a avaliação erra, e a resposta certa é varrer, não propagar
  // um erro que o caminho exato não daria.
  let valor: DaxValue;
  try {
    valor = ev.evaluate(alvo.valor, scope);
  } catch {
    return null;
  }
  return indice.candidatos(valor);
}

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

/**
 * `DISTINCT` aceita coluna **ou** tabela — a base usa as duas formas, e a de
 * tabela é a que fecha `DISTINCT(SELECTCOLUMNS(...))`.
 */
defTable('DISTINCT', (args, scope, ev, nome) => {
  exigeArgs(args, 1, 1, nome);
  const n = args[0]!;
  if (n.type === 'ColumnRef') return distintosDaColuna(n, scope, ev, nome);

  const origem = ev.evaluateTable(n, scope, nome);
  const colunas = orderedColumns(origem);
  const vistas = new Set<string>();
  const rows = origem.rows.filter((r) => {
    const k = rowKey(r, colunas);
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
  return makeTableValue(origem.table, colunas, rows);
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

  // O leitor entra no par, e não o nome: o laço abaixo varre a tabela INTEIRA por
  // um conjunto de colunas fixo, então normalizar por célula era pagar o mesmo
  // nome uma vez por linha. Ver `Evaluator.leitorDeColuna`.
  const pares: { ler: (row: Row) => DaxValue; valor: DaxValue }[] = [];
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
    pares.push({
      ler: ev.leitorDeColuna(resultado.table, col.column),
      valor: valor(args, i + 1, scope, ev, nome),
    });
  }

  const encontrados = new Map<string, DaxValue>();
  const lerResultado = ev.leitorDeColuna(resultado.table, resultado.column);
  for (const row of ev.dataset.rows(resultado.table)) {
    let casa = true;
    for (const p of pares) {
      if (compareValues(p.ler(row), p.valor, false, nome) !== 0) {
        casa = false;
        break;
      }
    }
    if (!casa) continue;
    const v = lerResultado(row);
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
  let soma = 0;
  let n = 0;
  for (const row of tabela.rows) {
    const v = ev.evaluate(args[1]!, ev.scopeWithTableRow(scope, tabela, row));
    if (isBlank(v)) continue;
    soma += toNumber(v, nome);
    n++;
  }
  return n === 0 ? BLANK : soma / n;
});

// ---------------------------------------------------------------------------
// Time intelligence
// ---------------------------------------------------------------------------

/**
 * As funções de data devolvem **tabela** de datas, não escalar — é assim no DAX, e
 * é o que faz `CALCULATE(SUM(...), DATESBETWEEN(...))` funcionar pelo mesmo
 * mecanismo de substituição de filtro de coluna que já existe.
 *
 * Todas trabalham sobre a coluna de data recebida, filtrando os valores dela que
 * caem no intervalo. Não geram datas que não existam na coluna: um calendário com
 * buracos continua com buracos, como no Power BI.
 */
function datasDaColuna(
  n: DaxNode,
  scope: EvalScope,
  ev: Evaluator,
  nome: string,
): { ref: Extract<DaxNode, { type: 'ColumnRef' }>; datas: Date[] } {
  if (n.type !== 'ColumnRef') {
    throw new DaxEvalError(`${nome}: esperava coluna de data e recebeu ${n.type}.`);
  }
  const datas: Date[] = [];
  for (const v of ev.valuesOfColumnRef(n, scope, nome)) {
    if (isBlank(v)) continue;
    datas.push(toDate(v, nome));
  }
  return { ref: n, datas };
}

function tabelaDeDatas(
  ref: Extract<DaxNode, { type: 'ColumnRef' }>,
  datas: Date[],
): TableValue {
  const chave = ref.column.toLowerCase();
  const vistas = new Set<number>();
  const rows = [];
  for (const d of datas) {
    if (vistas.has(d.getTime())) continue;
    vistas.add(d.getTime());
    rows.push({ [chave]: d });
  }
  return makeTableValue(ref.table, [chave], rows);
}

/** `DATESBETWEEN(coluna, inicio, fim)` — inclusivo nos dois extremos, como no DAX. */
defTable('DATESBETWEEN', (args, scope, ev, nome) => {
  exigeArgs(args, 3, 3, nome);
  const { ref, datas } = datasDaColuna(args[0]!, scope, ev, nome);
  const ini = valor(args, 1, scope, ev, nome);
  const fim = valor(args, 2, scope, ev, nome);
  // BLANK num extremo abre aquele lado, como no DAX.
  const de = isBlank(ini) ? -Infinity : toDate(ini, nome).getTime();
  const ate = isBlank(fim) ? Infinity : toDate(fim, nome).getTime();
  return tabelaDeDatas(ref, datas.filter((d) => d.getTime() >= de && d.getTime() <= ate));
});

/**
 * `DATESMTD(coluna)` — do primeiro dia do mês até a **última data visível no
 * contexto**, não até hoje. Usar `TODAY()` aqui daria outro número em qualquer
 * contexto filtrado para um mês passado.
 */
defTable('DATESMTD', (args, scope, ev, nome) => {
  exigeArgs(args, 1, 1, nome);
  const { ref, datas } = datasDaColuna(args[0]!, scope, ev, nome);
  if (datas.length === 0) return tabelaDeDatas(ref, []);
  const ultima = datas.reduce((a, b) => (b.getTime() > a.getTime() ? b : a));
  const inicio = Date.UTC(ultima.getUTCFullYear(), ultima.getUTCMonth(), 1);
  return tabelaDeDatas(
    ref,
    datas.filter((d) => d.getTime() >= inicio && d.getTime() <= ultima.getTime()),
  );
});

/** Extremo do mês da última/primeira data visível. Devolve tabela de uma linha. */
function extremoDoMes(qual: 'inicio' | 'fim'): TableFunction {
  return (args, scope, ev, nome) => {
    exigeArgs(args, 1, 1, nome);
    const { ref, datas } = datasDaColuna(args[0]!, scope, ev, nome);
    if (datas.length === 0) return tabelaDeDatas(ref, []);
    // O DAX toma o mês da ÚLTIMA data do contexto nos dois casos.
    const ultima = datas.reduce((a, b) => (b.getTime() > a.getTime() ? b : a));
    const y = ultima.getUTCFullYear();
    const m = ultima.getUTCMonth();
    const d = qual === 'inicio' ? new Date(Date.UTC(y, m, 1)) : new Date(Date.UTC(y, m + 1, 0));
    return tabelaDeDatas(ref, [d]);
  };
}

defTable('STARTOFMONTH', extremoDoMes('inicio'));
defTable('ENDOFMONTH', extremoDoMes('fim'));

// ---------------------------------------------------------------------------
// Conjuntos e tabelas derivadas
// ---------------------------------------------------------------------------

/**
 * `SELECTCOLUMNS(tabela, "Nome", expr, ...)` — tabela **anônima** com colunas
 * calculadas linha a linha.
 *
 * Anônima porque as colunas não existem em tabela nenhuma do modelo: por isso o
 * resultado conta linha e cria contexto de linha, mas não pode virar filtro sem
 * `TREATAS`. Ver `TableValue.table`.
 */
defTable('SELECTCOLUMNS', (args, scope, ev, nome) => {
  if (args.length < 3 || (args.length - 1) % 2 !== 0) {
    throw new DaxEvalError(
      `${nome}: esperava tabela + pares ("Nome", expressão); recebeu ${args.length} argumentos.`,
    );
  }
  const origem = ev.evaluateTable(args[0]!, scope, nome);

  const nomes: string[] = [];
  for (let i = 1; i < args.length; i += 2) {
    const rotulo = args[i]!;
    if (rotulo.type !== 'String') {
      throw new DaxEvalError(`${nome}: o nome da coluna ${i} tem de ser texto literal.`);
    }
    nomes.push(rotulo.value.toLowerCase());
  }

  const rows = origem.rows.map((row) => {
    const escopo = ev.scopeWithTableRow(scope, origem, row);
    const nova: Row = {};
    for (let i = 1, k = 0; i < args.length; i += 2, k++) {
      nova[nomes[k]!] = ev.evaluate(args[i + 1]!, escopo);
    }
    return nova;
  });

  return makeTableValue(null, nomes, rows);
});

/**
 * `ADDCOLUMNS(tabela, "Nome", expr, ...)` — a tabela de origem com colunas novas,
 * calculadas no contexto de linha de cada linha dela.
 *
 * Diferença que importa em relação a `SELECTCOLUMNS`: as colunas originais
 * **continuam ali**. É o que faz `Status Protocolo Dia` ter `protocolo`, `Dia` e
 * `Status`, e não só `Status`.
 *
 * As colunas novas são avaliadas sobre a linha de origem, não sobre a linha em
 * construção: em DAX uma coluna acrescentada não vê as outras acrescentadas no
 * mesmo `ADDCOLUMNS`.
 *
 * RECUSA tabela de origem **nomeada**, e não é falta de vontade. Em DAX as colunas
 * acrescentadas não têm linhagem — a tabela resultante filtra pelas colunas da
 * origem e ignora as novas. `TableValue` não sabe dizer "estas colunas têm
 * linhagem e aquelas não" (ver `TableValue.columns`), então usar o resultado como
 * filtro restringiria por uma coluna que não existe na tabela de destino: todo
 * `keep` daria falso e o filtro zeraria a medida sem erro. A única chamada desta
 * base é sobre tabela anônima (`DISTINCT(SELECTCOLUMNS(...))`), então nada é
 * perdido — e o dia em que aparecer uma sobre tabela nomeada, é aqui que se olha.
 */
defTable('ADDCOLUMNS', (args, scope, ev, nome) => {
  if (args.length < 3 || (args.length - 1) % 2 !== 0) {
    throw new DaxEvalError(
      `${nome}: esperava tabela + pares ("Nome", expressão); recebeu ${args.length} argumentos.`,
    );
  }
  const origem = ev.evaluateTable(args[0]!, scope, nome);
  if (origem.table !== null) {
    throw new DaxEvalError(
      `${nome}: origem é a tabela nomeada '${origem.table}', e coluna acrescentada não tem ` +
        `linhagem em DAX. O modelo de filtro daqui não distingue as duas coisas, e usar ` +
        `o resultado como filtro zeraria a medida em silêncio. Ver o comentário em functions.ts.`,
    );
  }

  const nomes: string[] = [];
  for (let i = 1; i < args.length; i += 2) {
    const rotulo = args[i]!;
    if (rotulo.type !== 'String') {
      throw new DaxEvalError(`${nome}: o nome da coluna ${i} tem de ser texto literal.`);
    }
    const chave = rotulo.value.toLowerCase();
    if (origem.columns.has(chave) || nomes.includes(chave)) {
      throw new DaxEvalError(
        `${nome}: a coluna ${JSON.stringify(rotulo.value)} já existe na origem. ` +
          `Sobrescrever calado mudaria o valor de uma coluna que alguém já usa.`,
      );
    }
    nomes.push(chave);
  }

  const rows = origem.rows.map((row) => {
    const escopo = ev.scopeWithTableRow(scope, origem, row);
    // `copiaLinha`, e não `{ ...row }`: espalhar só copia propriedade PRÓPRIA, e
    // numa vista colunar as colunas moram no protótipo — a linha nova sairia com as
    // colunas acrescentadas e NENHUMA da origem.
    //
    // Hoje isto é defensivo, e vale dizer: a guarda de linhagem acima recusa origem
    // NOMEADA, então `origem.rows` é sempre de tabela anônima — objeto simples. A
    // vista só chegaria aqui se um dia a guarda caísse, e é exatamente o dia em que
    // um `{ ...row }` falharia calado.
    const nova: Row = copiaLinha(row);
    for (let i = 1, k = 0; i < args.length; i += 2, k++) {
      nova[nomes[k]!] = ev.evaluate(args[i + 1]!, escopo);
    }
    return nova;
  });

  return makeTableValue(origem.table, [...origem.columns, ...nomes], rows);
});

/**
 * `CALENDAR(inicio, fim)` — a única função do avaliador que **gera** linhas.
 *
 * Todas as outras funções de data filtram valores que já existem numa coluna (ver
 * `datasDaColuna`). Esta cria um dia por linha entre os dois extremos, inclusive,
 * e é de onde vêm as linhas de três das sete tabelas calculadas. A coluna do
 * resultado se chama `Date` — é o nome que o DAX dá, e é por ele que
 * `sourceColumn: "[Date]"` casa na materialização.
 *
 * BLANK num extremo **erra alto**, e aqui há um desvio deliberado do Power BI. Lá
 * BLANK vale 0, que é 30/12/1899, e `CALENDAR(BLANK(), DATE(2026,12,31))` produz
 * uns 46 mil dias sem reclamar de nada. Ninguém percebe 46 mil linhas numa tabela
 * de datas, mas toda média que divide por dia útil muda. `CALENDARIO INSTALADO`
 * começa em `MIN('PROTOCOLOS GERAL'[DATA INSTALAÇÃO])`: o dia em que essa coluna
 * vier vazia, é melhor a materialização parar do que o dashboard dividir por 46 mil.
 *
 * Trunca a hora dos dois extremos, como o DAX: a fonte pode ser `dateTime` e um
 * resto de hora deslocaria todos os dias gerados.
 */
defTable('CALENDAR', (args, scope, ev, nome) => {
  exigeArgs(args, 2, 2, nome);
  const ini = valor(args, 0, scope, ev, nome);
  const fim = valor(args, 1, scope, ev, nome);
  if (isBlank(ini) || isBlank(fim)) {
    throw new DaxEvalError(
      `${nome}: extremo ${isBlank(ini) ? 'inicial' : 'final'} veio BLANK. O Power BI trataria ` +
        `como 30/12/1899 e geraria dezenas de milhares de dias; aqui isso para, porque ` +
        `um calendário grande demais não aparece como erro, aparece como média errada.`,
    );
  }
  const de = soDia(toDate(ini, nome));
  const ate = soDia(toDate(fim, nome));
  if (de > ate) {
    throw new DaxEvalError(
      `${nome}: início ${toText(new Date(de))} é depois do fim ${toText(new Date(ate))}. ` +
        `Em DAX isso é erro, não tabela vazia.`,
    );
  }
  const rows: Row[] = [];
  for (let t = de; t <= ate; t += 86_400_000) rows.push({ [COLUNA_CALENDAR]: new Date(t) });
  return makeTableValue(null, [COLUNA_CALENDAR], rows);
});

/** O nome que o DAX dá à coluna de `CALENDAR`. Casa com `sourceColumn: "[Date]"`. */
const COLUNA_CALENDAR = 'date';

/** Meia-noite UTC do dia, em milissegundos. Datas do modelo são meia-noite UTC. */
function soDia(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Casa duas tabelas por **posição** de coluna, como o DAX faz em UNION/EXCEPT/INTERSECT. */
function alinhar(
  a: TableValue,
  b: TableValue,
  nome: string,
): { colunas: string[]; chaveA: (r: Row) => string; chaveB: (r: Row) => string } {
  const colunas = orderedColumns(a);
  const colunasB = orderedColumns(b);
  if (colunas.length !== colunasB.length) {
    throw new DaxEvalError(
      `${nome}: tabelas com ${colunas.length} e ${colunasB.length} colunas. ` +
        `O DAX casa por posição e exige o mesmo número.`,
    );
  }
  return {
    colunas,
    chaveA: (r) => rowKey(r, colunas),
    chaveB: (r) => rowKey(r, colunasB),
  };
}

/** Renomeia as colunas de `b` para os nomes de `a`, casando por posição. */
function reetiquetar(a: TableValue, b: TableValue): Row[] {
  const ca = orderedColumns(a);
  const cb = orderedColumns(b);
  return b.rows.map((r) => {
    const out: Row = {};
    ca.forEach((nomeA, i) => {
      out[nomeA] = r[cb[i]!] ?? BLANK;
    });
    return out;
  });
}

/** `INTERSECT(a, b)` — linhas de `a` que também estão em `b`. Preserva duplicatas de `a`. */
defTable('INTERSECT', (args, scope, ev, nome) => {
  exigeArgs(args, 2, 2, nome);
  const a = ev.evaluateTable(args[0]!, scope, nome);
  const b = ev.evaluateTable(args[1]!, scope, nome);
  const { colunas, chaveA, chaveB } = alinhar(a, b, nome);
  const emB = new Set(b.rows.map(chaveB));
  return makeTableValue(a.table, colunas, a.rows.filter((r) => emB.has(chaveA(r))));
});

/** `EXCEPT(a, b)` — linhas de `a` que não estão em `b`. */
defTable('EXCEPT', (args, scope, ev, nome) => {
  exigeArgs(args, 2, 2, nome);
  const a = ev.evaluateTable(args[0]!, scope, nome);
  const b = ev.evaluateTable(args[1]!, scope, nome);
  const { colunas, chaveA, chaveB } = alinhar(a, b, nome);
  const emB = new Set(b.rows.map(chaveB));
  return makeTableValue(a.table, colunas, a.rows.filter((r) => !emB.has(chaveA(r))));
});

/**
 * `UNION(a, b)` — concatena. **Mantém duplicatas**, como no DAX; quem quer
 * distintos escreve `DISTINCT(UNION(...))`. Remover aqui mudaria a contagem.
 */
defTable('UNION', (args, scope, ev, nome) => {
  exigeArgs(args, 2, 2, nome);
  const a = ev.evaluateTable(args[0]!, scope, nome);
  const b = ev.evaluateTable(args[1]!, scope, nome);
  const { colunas } = alinhar(a, b, nome);
  // Resultado é anônimo quando as origens são de tabelas diferentes: não há uma
  // tabela do modelo a que a união pertença.
  const mesmaOrigem = a.table !== null && a.table === b.table;
  return makeTableValue(mesmaOrigem ? a.table : null, colunas, [
    ...a.rows,
    ...reetiquetar(a, b),
  ]);
});

/**
 * `RANKX(tabela, expressão, [valor], [ordem], [empates])`.
 *
 * `ordem` é `ASC` ou `DESC` (padrão do DAX: **DESC**). `empates` é `DENSE` ou
 * `SKIP` (padrão: `SKIP`). Com `valor` omitido, ranqueia a própria `expressão`
 * avaliada **fora** da iteração — é o caso da base.
 */
def('RANKX', (args, scope, ev, nome) => {
  exigeArgs(args, 2, 5, nome);
  const tabela = ev.evaluateTable(args[0]!, scope, nome);
  const expr = args[1]!;

  const lista: DaxValue[] = [];
  for (const row of tabela.rows) {
    const v = ev.evaluate(expr, ev.scopeWithTableRow(scope, tabela, row));
    if (!isBlank(v)) lista.push(v);
  }

  const alvoNode = presente(args, 2);
  const alvo = alvoNode ? ev.evaluate(alvoNode, scope) : ev.evaluate(expr, scope);
  if (isBlank(alvo)) return BLANK;

  const ordem = presente(args, 3) ? palavraChave(args, 3, nome, ['ASC', 'DESC']) : 'DESC';
  const empates = presente(args, 4) ? palavraChave(args, 4, nome, ['DENSE', 'SKIP']) : 'SKIP';

  // "Melhor" é menor em ASC e maior em DESC. O posto é quantos vêm antes, + 1 —
  // e a diferença entre SKIP e DENSE é contar valores repetidos ou distintos.
  const sinalMelhor = ordem === 'ASC' ? -1 : 1;
  const melhores = lista.filter((v) => compareValues(v, alvo, false, nome) === sinalMelhor);
  return empates === 'DENSE'
    ? new Set(melhores.map(identityKey)).size + 1
    : melhores.length + 1;
});

/**
 * `ISINSCOPE('T'[C])` — a coluna está entre as que a **visualização** está
 * agrupando?
 *
 * A resposta não existe no avaliador sozinho: é propriedade do visual, não do
 * modelo nem do contexto de filtro. Ela chega por `EvalScope.agrupamento`, que o
 * Widget Engine preenche uma vez por célula (`Evaluator.scopeWithGrouping`).
 *
 * **`undefined` continua errando alto, e a distinção é o ponto.** Conjunto vazio
 * significa "o visual não agrupa por nada" — o total, onde a resposta é `FALSE`.
 * `undefined` significa "não há visual", e aí não há resposta: devolver `FALSE`
 * faria `[Faixa 1 Premiação Total]` calcular em toda célula em vez de só no total,
 * que é o contrário do que o comentário no DAX dela pede. Ver ACHADOS.md #12.
 */
def('ISINSCOPE', (args, scope, ev, nome) => {
  exigeArgs(args, 1, 1, nome);
  const ref = args[0]!;
  if (ref.type !== 'ColumnRef') {
    throw new DaxEvalError(
      `${nome}: o argumento tem de ser uma coluna ('Tabela'[Coluna]), e veio '${ref.type}'. ` +
        `Só coluna pode ser eixo de visual.`,
    );
  }
  if (scope.agrupamento === undefined) {
    throw new DaxEvalError(
      `${nome}: depende do agrupamento da visualização, e este cálculo não veio de um. ` +
        `Quem informa é o Widget Engine (Evaluator.scopeWithGrouping). Ver docs/ACHADOS.md #12.`,
    );
  }
  // Erra alto se a coluna não existe: `ISINSCOPE` de coluna inexistente é sempre
  // FALSE, e um FALSE por erro de digitação some dentro de um IF sem deixar rastro.
  if (!ev.model.column(ref.table, ref.column)) {
    throw new DaxEvalError(`${nome}: a coluna '${ref.table}'[${ref.column}] não existe no modelo.`);
  }
  return scope.agrupamento.has(`${normalizeName(ref.table)}[${normalizeName(ref.column)}]`);
});

// ---------------------------------------------------------------------------

/** Nomes implementados. O teste de escopo compara isto com o que a base usa. */
export function implementedFunctions(): string[] {
  return [...new Set([...FUNCOES.keys(), ...TABELAS.keys()])].sort();
}

export function lookupTableFunction(nome: string): TableFunction | undefined {
  return TABELAS.get(nome.toUpperCase());
}
