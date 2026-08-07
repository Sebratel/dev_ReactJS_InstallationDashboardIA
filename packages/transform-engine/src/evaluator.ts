// Avaliador de M.
//
// A forma é a mesma do avaliador de DAX: o AST é a implementação, e as funções
// vivem numa tabela injetada (`MFunctionTable`). Isso mantém este arquivo sobre
// **semântica da linguagem** — escopo, `each`, ordem dos passos — e deixa
// `functions.ts` sobre comportamento de cada função.
//
// Três coisas que a linguagem exige e que dariam errado se fossem "óbvias":
//
//   1. **Passo vê passo anterior por nome, e nomes são visíveis antes de avaliar.**
//      `let` em M é mutuamente recursivo por definição: `a = b, b = 1` é legal. Na
//      prática o Power Query gera sempre em ordem, mas resolver por nome com
//      avaliação preguiçosa custa o mesmo e não quebra no dia em que não gerar.
//   2. **Ciclo é erro nomeado, não pilha estourada.** `a = a` ou `a = b, b = a`
//      param dizendo qual é o ciclo.
//   3. **`each` fecha sobre o ambiente**, e `[Coluna]` dentro dele é campo do `_`
//      implícito. Sem isso, `Table.SelectRows(t, each [STATUS] <> "Cancelado")`
//      procuraria uma variável chamada STATUS e não acharia.

import type { MBinding, MNode } from './ast.ts';
import { parseM } from './parser.ts';
import {
  exigeSemErro,
  isCellError,
  isFunction,
  isList,
  isRecord,
  isTable,
  MDuration,
  MEvalError,
  MRecord,
  MTable,
  MTime,
  tipoDe,
  type MFunction,
  type MValue,
} from './value.ts';

/** Assinatura de uma função M implementada. */
export interface MFunctionImpl {
  /** Nome como aparece no M: `Table.AddColumn`, `Text.Upper`, `#date`. */
  readonly name: string;
  /** Quantos argumentos são obrigatórios. Excedentes opcionais são aceitos. */
  readonly minArgs: number;
  readonly maxArgs: number;
  readonly call: (args: readonly MValue[], ctx: MCallContext) => MValue;
}

/**
 * O que uma função recebe além dos argumentos.
 *
 * `agora` é injetado em vez de lido do relógio para o teste ser determinístico —
 * mesma razão pela qual o avaliador de DAX recebe `now`. `DateTime.LocalNow()`
 * aparece em duas queries, e uma delas (`hora-atualizado`) é só isso.
 */
export interface MCallContext {
  readonly agora: Date;
  /**
   * Culture do modelo (`pt-BR`), extraída do PBIP para `specs/_catalog/model.yaml`.
   *
   * É o que decide se `"01/02/2026"` é 1º de fevereiro ou 2 de janeiro. Sem ela, a
   * conversão de texto para data erra alto — de propósito: adivinhar aqui é o
   * achado 1 (ler março onde era abril), e o dado da operação não avisa.
   */
  readonly culture: string | null;
  /** Resolve outra query pelo nome, para as mesclagens entre queries. */
  readonly query: (nome: string) => MValue;
  /**
   * Devolve o corpo de uma resposta HTTP **já buscada**.
   *
   * Síncrona porque avaliar M é síncrono, e é aí que está a diferença em relação a
   * `Odbc.Query`: o runner pré-busca a fonte de uma query porque sabe qual é antes
   * de avaliar, e aqui não sabe — a URL de `clima-tempo` sai de `cidade{1}` e de
   * `Date.ToText(ontem)`, valores que só existem no meio da avaliação. Quem
   * implementa isto resolve pelo cache e, no que faltar, sinaliza para o runner
   * buscar e reavaliar (ver `PrecisaBuscarWeb` em runner.ts).
   */
  readonly web: (pedido: PedidoWeb) => Uint8Array;
}

/**
 * Um GET. É tudo que `Web.Contents` sabe pedir, e é de propósito: a plataforma
 * nunca escreve na fonte, e um verbo configurável aqui seria a quarta camada do
 * guard read-only virando opcional.
 */
export interface PedidoWeb {
  /** URL absoluta final, já com `RelativePath` e `Query` aplicados. */
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export type MFunctionTable = ReadonlyMap<string, MFunctionImpl>;

export interface MEvaluatorOptions {
  readonly functions: MFunctionTable;
  /**
   * Constantes de enumeração e de tipo (`Order.Ascending`, `Int64.Type`). Ausentes
   * = qualquer enum vira "nome não encontrado", que é o certo: enum inventado não
   * pode virar string qualquer e mudar comportamento em silêncio.
   */
  readonly constants?: ReadonlyMap<string, MValue>;
  readonly agora?: Date;
  /** Culture do modelo. Ausente = conversão de texto para data erra alto. */
  readonly culture?: string | null;
  /**
   * Resolve uma query citada por nome. `PROTOCOLOS GERAL` referencia
   * `#"GESTORES EQUIPES"` como se fosse variável, e é assim que a mesclagem entre
   * queries chega aqui. Ausente = citar outra query é erro que nomeia a query.
   */
  readonly query?: (nome: string) => MValue;
  /**
   * Resolve um GET já buscado. Ausente = `Web.Contents` é erro que diz que ninguém
   * injetou fonte web — nunca uma resposta vazia. Uma tabela de clima vazia passa
   * por "não choveu", que é exatamente o número plausível e errado.
   */
  readonly web?: (pedido: PedidoWeb) => Uint8Array;
}

/** Ambiente de nomes: escopo aninhado com resolução preguiçosa. */
class Escopo {
  private readonly pais: Escopo | null;
  private readonly valores = new Map<string, MValue>();
  private readonly pendentes = new Map<string, MNode>();
  private readonly emCurso = new Set<string>();
  private readonly avalia: (no: MNode, escopo: Escopo) => MValue;

  constructor(
    pais: Escopo | null,
    avalia: (no: MNode, escopo: Escopo) => MValue,
  ) {
    this.pais = pais;
    this.avalia = avalia;
  }

  declara(nome: string, expr: MNode): void {
    this.pendentes.set(nome, expr);
  }

  fixa(nome: string, valor: MValue): void {
    this.valores.set(nome, valor);
  }

  tem(nome: string): boolean {
    return this.valores.has(nome) || this.pendentes.has(nome) || (this.pais?.tem(nome) ?? false);
  }

  resolve(nome: string): MValue {
    if (this.valores.has(nome)) return this.valores.get(nome)!;
    const expr = this.pendentes.get(nome);
    if (expr) {
      if (this.emCurso.has(nome)) {
        throw new MEvalError(
          `Ciclo entre passos do \`let\`: '${nome}' depende de si mesmo ` +
            `(cadeia em curso: ${[...this.emCurso].join(' → ')} → ${nome}).`,
        );
      }
      this.emCurso.add(nome);
      try {
        const v = this.avalia(expr, this);
        this.valores.set(nome, v);
        this.pendentes.delete(nome);
        return v;
      } finally {
        this.emCurso.delete(nome);
      }
    }
    if (this.pais) return this.pais.resolve(nome);
    throw new MEvalError(`Nome não encontrado em M: '${nome}'.`);
  }
}

export class MEvaluator {
  private readonly functions: MFunctionTable;
  private readonly constants: ReadonlyMap<string, MValue>;
  private readonly ctx: MCallContext;

  constructor(opts: MEvaluatorOptions) {
    this.functions = opts.functions;
    this.constants = opts.constants ?? new Map();
    this.ctx = {
      agora: opts.agora ?? new Date(),
      culture: opts.culture ?? null,
      query:
        opts.query ??
        ((nome) => {
          throw new MEvalError(
            `A expressão cita '${nome}', que não é passo deste \`let\` nem função conhecida. ` +
              'Se é outra query, o avaliador precisa receber `query` para resolvê-la.',
          );
        }),
      web:
        opts.web ??
        ((pedido) => {
          throw new MEvalError(
            `A expressão chamou Web.Contents(${pedido.url}), mas o avaliador não recebeu ` +
              '`web`. Quem roda a expressão precisa injetar a busca HTTP.',
          );
        }),
    };
  }

  /** Avalia uma expressão M crua. */
  avaliaTexto(source: string): MValue {
    return this.avalia(parseM(source), this.raiz());
  }

  /**
   * Avalia uma query e devolve a tabela final, junto com o valor de cada passo.
   *
   * Devolver os passos não é luxo: é o que permite comparar passo a passo com o
   * Power Query quando um número divergir — que é o trabalho da fase 2b.9.
   */
  avaliaQuery(source: string): { valor: MValue; passos: Map<string, MValue> } {
    const no = parseM(source);
    const escopo = this.raiz();
    if (no.type !== 'Let') {
      return { valor: this.avalia(no, escopo), passos: new Map() };
    }
    for (const b of no.bindings) escopo.declara(b.name, b.expr);
    const valor = this.avalia(no.body, escopo);
    const passos = new Map<string, MValue>();
    for (const b of no.bindings) passos.set(b.name, escopo.resolve(b.name));
    return { valor, passos };
  }

  /** Igual a `avaliaQuery`, mas exige que o resultado seja tabela. */
  avaliaTabela(source: string, onde = 'a query'): MTable {
    const { valor } = this.avaliaQuery(source);
    if (!isTable(valor)) {
      throw new MEvalError(`${onde} devolveu ${tipoDe(valor)}, não uma tabela.`);
    }
    return valor;
  }

  private raiz(): Escopo {
    return new Escopo(null, (no, escopo) => this.avalia(no, escopo));
  }

  // ── expressões ──────────────────────────────────────────────────────────────

  private avalia(no: MNode, escopo: Escopo): MValue {
    switch (no.type) {
      case 'Literal':
        return no.value;

      case 'Identifier':
        return this.identificador(no.name, escopo);

      case 'Let': {
        const dentro = new Escopo(escopo, (n, e) => this.avalia(n, e));
        for (const b of no.bindings) dentro.declara(b.name, b.expr);
        return this.avalia(no.body, dentro);
      }

      case 'Each':
        // `each` é função de um argumento cujo parâmetro é `_`. O corpo enxerga o
        // escopo de onde nasceu — daí o fechamento em vez de reavaliar a partir
        // da raiz.
        return this.funcaoDe(1, (args) => {
          const dentro = new Escopo(escopo, (n, e) => this.avalia(n, e));
          dentro.fixa('_', args[0] ?? null);
          return this.avalia(no.body, dentro);
        });

      case 'Function':
        return this.funcaoDe(no.params.length, (args) => {
          const dentro = new Escopo(escopo, (n, e) => this.avalia(n, e));
          no.params.forEach((p, i) => dentro.fixa(p.name, args[i] ?? null));
          return this.avalia(no.body, dentro);
        });

      case 'If': {
        const cond = this.avalia(no.cond, escopo);
        if (typeof cond !== 'boolean') {
          // M não tem verdade "parecida": `if 1 then` é erro lá também. Aceitar
          // aqui inventaria linha filtrada onde o Power Query recusa a query.
          throw new MEvalError(
            `A condição do \`if\` deu ${tipoDe(cond)}, e M exige logical (true/false).`,
          );
        }
        return this.avalia(cond ? no.then : no.otherwise, escopo);
      }

      case 'Unary':
        return this.unario(no.op, this.avalia(no.operand, escopo));

      case 'Binary':
        return this.binario(no, escopo);

      case 'List':
        return no.items.map((i) => this.avalia(i, escopo));

      case 'Record':
        return new MRecord(no.fields.map((f) => [f.name, this.avalia(f.expr, escopo)] as const));

      case 'Field': {
        // `[Coluna]` solto: campo do `_` implícito. É o caso dominante — 103
        // ocorrências no corpus, quase todas dentro de `each`.
        const alvo = no.target ? this.avalia(no.target, escopo) : escopo.resolve('_');
        return this.campo(alvo, no.field, no.optional);
      }

      case 'Item':
        return this.item(this.avalia(no.target, escopo), this.avalia(no.selector, escopo), no.optional);

      case 'Call':
        return this.chamada(no.callee, no.args, escopo);

      case 'Type':
        // Tipo é valor de primeira classe em M, e chega como argumento de
        // `TransformColumnTypes`. Aqui viaja como texto: quem interpreta é a
        // função, que é onde a conversão de valor acontece de verdade.
        //
        // Exceção deliberada: `type table [A = …, B = …]` avalia para a **lista
        // dos nomes**, porque o único lugar do corpus que recebe tipo de tabela é
        // `Table.FromRows`, e o que ele precisa dali são os nomes de coluna. Um
        // objeto de tipo completo seria mais fiel e não teria consumidor.
        return no.fields ? [...no.fields] : `type ${no.name}`;

      default: {
        const _exaustivo: never = no;
        throw new MEvalError(`Nó M não tratado: ${JSON.stringify(_exaustivo)}`);
      }
    }
  }

  /**
   * Identificador nu. Ordem: passo/variável primeiro, função depois, query por
   * último.
   *
   * A ordem importa. Se uma query se chamasse `Text`, o passo local ainda venceria
   * — que é o que o M faz. E função só é procurada quando não há nome no escopo,
   * porque `Table.AddColumn` como *valor* (sem chamar) não aparece na base.
   */
  private identificador(nome: string, escopo: Escopo): MValue {
    if (escopo.tem(nome)) return escopo.resolve(nome);
    // Constante antes de função: `Date.Type` é constante e `Date.From` é função,
    // e nenhum nome é os dois — mas a ordem deixa isso explícito.
    if (this.constants.has(nome)) return this.constants.get(nome)!;
    const f = this.functions.get(nome);
    if (f) {
      return this.funcaoDe(f.maxArgs, (args) => {
        this.confereAridade(f, args.length);
        return f.call(args, this.ctx);
      });
    }
    return this.ctx.query(nome);
  }

  private funcaoDe(arity: number, call: (args: readonly MValue[]) => MValue): MFunction {
    return { kind: 'function', arity, call };
  }

  private confereAridade(f: MFunctionImpl, n: number): void {
    if (n < f.minArgs || n > f.maxArgs) {
      const esperado =
        f.minArgs === f.maxArgs ? `${f.minArgs}` : `de ${f.minArgs} a ${f.maxArgs}`;
      throw new MEvalError(`${f.name} espera ${esperado} argumento(s), recebeu ${n}.`);
    }
  }

  private chamada(callee: MNode, args: readonly MNode[], escopo: Escopo): MValue {
    // Caminho direto para função conhecida: evita empacotar num MFunction só para
    // desempacotar, e deixa o erro de aridade citar o nome real.
    if (callee.type === 'Identifier' && !escopo.tem(callee.name) && !this.constants.has(callee.name)) {
      const f = this.functions.get(callee.name);
      if (f) {
        this.confereAridade(f, args.length);
        return f.call(args.map((a) => this.avalia(a, escopo)), this.ctx);
      }
      // Nome desconhecido chamado como função: erro que diz o nome. É o que
      // acontece quando alguém mexe no Power Query e usa função não implementada.
      if (!this.temQuery(callee.name)) {
        throw new MEvalError(
          `Função M não implementada: '${callee.name}'. ` +
            'O engine não adivinha o que ela faz — implemente em functions.ts.',
        );
      }
    }
    const alvo = this.avalia(callee, escopo);
    if (!isFunction(alvo)) {
      throw new MEvalError(`Tentou chamar ${tipoDe(alvo)} como função.`);
    }
    return alvo.call(args.map((a) => this.avalia(a, escopo)));
  }

  private temQuery(nome: string): boolean {
    try {
      this.ctx.query(nome);
      return true;
    } catch {
      return false;
    }
  }

  private campo(alvo: MValue, nome: string, opcional: boolean): MValue {
    if (isRecord(alvo)) {
      if (!alvo.has(nome)) return opcional ? null : alvo.get(nome); // `get` erra com a lista
      // Ler célula de Erro num `each [Coluna]` propaga o erro, como em M. É aqui
      // que a célula deixa de ser inerte: 103 acessos a campo no corpus passam por
      // este ponto, e nenhum deles pode receber uma no lugar de um valor.
      return exigeSemErro(alvo.get(nome), `acesso ao campo '${nome}'`);
    }
    if (isTable(alvo)) {
      // `tabela[Coluna]` em M é a **lista** dos valores daquela coluna.
      if (!alvo.hasColumn(nome)) {
        if (opcional) return null;
        alvo.exigeColuna(nome, 'acesso a campo');
      }
      return alvo.rows.map((r) => r.get(nome) ?? null);
    }
    if (alvo === null) return opcional ? null : this.erroCampoEmNulo(nome);
    throw new MEvalError(`Acesso ao campo '${nome}' em ${tipoDe(alvo)}, que não tem campo.`);
  }

  private erroCampoEmNulo(nome: string): never {
    throw new MEvalError(
      `Acesso ao campo '${nome}' em null. Em M isto é erro; use '[${nome}]?' se ausência ` +
        'for esperada.',
    );
  }

  /**
   * `lista{n}` por posição, `tabela{[chave=valor]}` por casamento de campos.
   *
   * A forma por registro é como se lê a aba de uma planilha:
   * `Fonte{[name="QUADRO FUNCIONAL",ItemKind="Table"]}`. Ela **exige exatamente
   * uma** linha casando: zero é erro (aba renomeada) e mais de uma é ambiguidade.
   * Devolver a primeira em silêncio seria escolher por sorteio.
   */
  private item(alvo: MValue, seletor: MValue, opcional: boolean): MValue {
    if (isList(alvo)) {
      if (typeof seletor !== 'number') {
        throw new MEvalError(`Índice de lista deve ser número, veio ${tipoDe(seletor)}.`);
      }
      if (seletor < 0 || seletor >= alvo.length) {
        if (opcional) return null;
        throw new MEvalError(`Índice ${seletor} fora da lista de ${alvo.length} item(ns).`);
      }
      return alvo[seletor];
    }

    if (isTable(alvo)) {
      if (typeof seletor === 'number') {
        if (seletor < 0 || seletor >= alvo.rowCount) {
          if (opcional) return null;
          throw new MEvalError(`Linha ${seletor} fora da tabela de ${alvo.rowCount} linha(s).`);
        }
        return new MRecord(alvo.columns.map((c) => [c, alvo.rows[seletor].get(c) ?? null] as const));
      }
      if (isRecord(seletor)) {
        const casam = alvo.rows.filter((r) =>
          [...seletor.fields].every(([k, v]) => igual(r.get(k) ?? null, v)),
        );
        const criterio = [...seletor.fields].map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
        if (casam.length === 0) {
          if (opcional) return null;
          throw new MEvalError(`Nenhuma linha casa com {${criterio}}.`);
        }
        if (casam.length > 1) {
          throw new MEvalError(
            `${casam.length} linhas casam com {${criterio}}, e M exige exatamente uma. ` +
              'Escolher a primeira seria escolher por sorteio.',
          );
        }
        return new MRecord(alvo.columns.map((c) => [c, casam[0].get(c) ?? null] as const));
      }
    }

    throw new MEvalError(`Acesso a item em ${tipoDe(alvo)} com seletor ${tipoDe(seletor)}.`);
  }

  private unario(op: '+' | '-' | 'not', v: MValue): MValue {
    if (op === 'not') {
      if (typeof v !== 'boolean') {
        throw new MEvalError(`\`not\` exige logical, veio ${tipoDe(v)}.`);
      }
      return !v;
    }
    if (v === null) return null;
    if (typeof v !== 'number') {
      throw new MEvalError(`\`${op}\` unário exige número, veio ${tipoDe(v)}.`);
    }
    return op === '-' ? -v : v;
  }

  private binario(no: Extract<MNode, { type: 'Binary' }>, escopo: Escopo): MValue {
    // `and`/`or` curto-circuitam: `[a] <> null and [a] > 5` depende disso para
    // não comparar null com número.
    if (no.op === 'and' || no.op === 'or') {
      const esq = this.avalia(no.left, escopo);
      if (typeof esq !== 'boolean') {
        throw new MEvalError(`\`${no.op}\` exige logical à esquerda, veio ${tipoDe(esq)}.`);
      }
      if (no.op === 'and' && !esq) return false;
      if (no.op === 'or' && esq) return true;
      const dir = this.avalia(no.right, escopo);
      if (typeof dir !== 'boolean') {
        throw new MEvalError(`\`${no.op}\` exige logical à direita, veio ${tipoDe(dir)}.`);
      }
      return dir;
    }

    if (no.op === 'as' || no.op === 'is' || no.op === 'meta') {
      throw new MEvalError(
        `\`${no.op}\` não está implementado. Aparece só em clima-tempo e feriados, ` +
          'que estão fora do escopo desta fase.',
      );
    }

    const a = this.avalia(no.left, escopo);
    const b = this.avalia(no.right, escopo);

    if (no.op === '=') return igual(a, b);
    if (no.op === '<>') return !igual(a, b);

    if (no.op === '&') return this.concatena(a, b);

    // Comparação e aritmética com null dão null em M — não 0, e não erro.
    if (a === null || b === null) return null;

    if (no.op === '<' || no.op === '<=' || no.op === '>' || no.op === '>=') {
      return compara(a, b, no.op);
    }
    return aritmetica(a, b, no.op);
  }

  /**
   * `&` concatena texto, lista e registro — três coisas diferentes com o mesmo
   * operador. Número com `&` é erro em M (é `Text.From` que converte), e deixar
   * passar produziria `"12"` onde o Power Query recusa a query.
   */
  private concatena(a: MValue, b: MValue): MValue {
    if (typeof a === 'string' && typeof b === 'string') return a + b;
    if (isList(a) && isList(b)) return [...a, ...b];
    if (isRecord(a) && isRecord(b)) {
      const m = new Map(a.fields);
      for (const [k, v] of b.fields) m.set(k, v);
      return new MRecord(m);
    }
    if (a === null || b === null) return null;
    throw new MEvalError(
      `\`&\` não combina ${tipoDe(a)} com ${tipoDe(b)}. Em M, \`&\` é texto+texto, ` +
        'lista+lista ou registro+registro — para número use Text.From.',
    );
  }
}

// ── comparação e aritmética ───────────────────────────────────────────────────

/** Milissegundos comparáveis de um valor temporal, ou `null` se não é temporal. */
function tempoMs(v: MValue): number | null {
  if (v instanceof Date) return v.getTime();
  if (v instanceof MTime) return v.ms;
  if (v instanceof MDuration) return v.ms;
  return null;
}

/**
 * Igualdade M.
 *
 * `null = null` é **true** em M (diferente do SQL, onde é unknown). Data compara
 * por instante, não por identidade de objeto — sem isso, duas datas iguais vindas
 * de passos diferentes seriam diferentes e toda mesclagem por data falharia.
 */
export function igual(a: MValue, b: MValue): boolean {
  // Célula de Erro comparada não é "diferente": em M a comparação **propaga** o
  // erro. Este é o único ponto do engine onde ela passaria calada — `false` daqui
  // faria uma linha ser filtrada fora sem ninguém saber por quê.
  if (isCellError(a)) exigeSemErro(a, 'comparação de igualdade');
  if (isCellError(b)) exigeSemErro(b, 'comparação de igualdade');
  if (a === null || b === null) return a === b;
  const ta = tempoMs(a);
  const tb = tempoMs(b);
  if (ta !== null || tb !== null) {
    // Não compara time com datetime: são espécies diferentes, e o Power Query
    // recusa. Mesmo espírito do guarda de espécie do avaliador de DAX.
    if (ta === null || tb === null || tipoDe(a) !== tipoDe(b)) return false;
    return ta === tb;
  }
  if (isList(a) && isList(b)) {
    return a.length === b.length && a.every((x, i) => igual(x, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    if (a.fields.size !== b.fields.size) return false;
    for (const [k, v] of a.fields) {
      if (!b.has(k) || !igual(v, b.get(k))) return false;
    }
    return true;
  }
  return a === b;
}

function compara(a: MValue, b: MValue, op: '<' | '<=' | '>' | '>='): boolean {
  // Sem isto o erro ainda subiria (célula de Erro não é número nem texto), mas
  // dizendo `entre célula de erro e number` em vez do motivo real. Quem lê quer
  // saber que valor a planilha tinha.
  exigeSemErro(a, `comparação \`${op}\``);
  exigeSemErro(b, `comparação \`${op}\``);
  const ta = tempoMs(a);
  const tb = tempoMs(b);
  let x: number | string;
  let y: number | string;
  if (ta !== null && tb !== null) {
    if (tipoDe(a) !== tipoDe(b)) {
      throw new MEvalError(`Comparação entre ${tipoDe(a)} e ${tipoDe(b)}.`);
    }
    x = ta;
    y = tb;
  } else if (typeof a === 'number' && typeof b === 'number') {
    x = a;
    y = b;
  } else if (typeof a === 'string' && typeof b === 'string') {
    x = a;
    y = b;
  } else {
    throw new MEvalError(`Comparação \`${op}\` entre ${tipoDe(a)} e ${tipoDe(b)}.`);
  }
  switch (op) {
    case '<': return x < y;
    case '<=': return x <= y;
    case '>': return x > y;
    default: return x >= y;
  }
}

function aritmetica(a: MValue, b: MValue, op: '+' | '-' | '*' | '/'): MValue {
  exigeSemErro(a, `operação \`${op}\``);
  exigeSemErro(b, `operação \`${op}\``);
  // Data ± duração dá data; data − data dá duração. É o que `Duration.Days` usa.
  if (a instanceof Date && b instanceof MDuration) {
    if (op !== '+' && op !== '-') {
      throw new MEvalError(`\`${op}\` entre datetime e duration não existe em M.`);
    }
    return new Date(a.getTime() + (op === '+' ? b.ms : -b.ms));
  }
  if (a instanceof Date && b instanceof Date) {
    if (op !== '-') {
      throw new MEvalError(`\`${op}\` entre duas datas não existe em M; só a subtração.`);
    }
    return new MDuration(a.getTime() - b.getTime());
  }
  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new MEvalError(`\`${op}\` entre ${tipoDe(a)} e ${tipoDe(b)}.`);
  }
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    default:
      // Divisão por zero em M dá erro, não infinito. O DAX devolve BLANK via
      // DIVIDE; aqui é a semântica de M que vale.
      if (b === 0) throw new MEvalError('Divisão por zero em M.');
      return a / b;
  }
}

export { type MBinding };
