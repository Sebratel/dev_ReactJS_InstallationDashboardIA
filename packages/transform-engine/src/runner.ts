// Orquestrador: roda as queries M na ordem em que dependem umas das outras.
//
// Duas coisas que este arquivo resolve e que o avaliador não podia:
//
//   1. **Query cita query por nome.** `PROTOCOLOS GERAL` referencia
//      `#"GESTORES EQUIPES"` como se fosse variável. Quem sabe que aquele nome é
//      outra query é o registry, não a expressão — então a resolução é aqui, e o
//      avaliador só recebe o callback `query`. É o análogo de
//      `calculatedTableOrder` do lado do DAX.
//   2. **Ler fonte é assíncrono; avaliar M é síncrono.** A saída é buscar as
//      linhas **antes** e avaliar depois, com o dado na mão. Não é atalho: é o
//      mesmo contrato do avaliador de DAX, que recebe um `Dataset` em memória e
//      por isso roda em teste sem credencial.
//
// O que **não** está aqui: paralelismo. As queries de um mesmo nível do grafo
// poderiam buscar em paralelo, e não buscam. Antes de otimizar isso vale medir —
// `field-agenda` tem 1,4 milhão de linhas e quatro queries passam de 10s
// (ACHADOS #2 e #4), então o gargalo provavelmente não é a serialização.

import {
  MEvaluator,
  type MFunctionImpl,
  type NotaM,
  type PedidoWeb,
} from './evaluator.ts';
import { standardConstants, standardFunctions } from './functions.ts';
import { parseM, parseMLet } from './parser.ts';
import { linha, MEvalError, MTable, type MRow, type MValue } from './value.ts';

/** O que o runner precisa saber de uma query. Subconjunto do `QuerySpec`. */
export interface MQuerySpec {
  readonly id: string;
  /** Nome como o M de outra query o cita: `PROTOCOLOS GERAL`. */
  readonly name: string;
  readonly m_expression?: string;
}

/**
 * Busca as linhas da fonte de uma query. Injetado: em produção é o Query Engine
 * (que já sabe cache, timeout e read-only); em teste é uma função que devolve
 * array.
 *
 * Devolve `Row[]` — objeto por linha, como os connectors já fazem — e a ordem de
 * coluna sai das chaves da primeira linha, que é a ordem que o driver devolveu.
 */
export type FonteDeLinhas = (spec: MQuerySpec) => Promise<readonly Record<string, unknown>[]>;

/**
 * Faz um GET e devolve o corpo. Injetado, como `fonte`: em produção é o buscador
 * do query-engine (que sabe allowlist, timeout e o guard de método); em teste é
 * uma função que devolve bytes.
 */
export type BuscadorWeb = (pedido: PedidoWeb) => Promise<Uint8Array>;

/**
 * Sinal interno: a avaliação pediu uma URL que ainda não foi buscada.
 *
 * Não é erro — é a única forma de uma função síncrona pedir I/O assíncrono. O
 * laço em `avaliaComWeb` captura, busca, e reavalia. Se escapar dali é bug, e a
 * mensagem diz isso em vez de virar "falha de rede".
 */
class PrecisaBuscarWeb extends Error {
  readonly pedido: PedidoWeb;

  constructor(pedido: PedidoWeb) {
    super(`Web.Contents: ${pedido.url} ainda não foi buscada (sinal interno do runner).`);
    this.pedido = pedido;
  }
}

/**
 * Teto de buscas HTTP numa única query.
 *
 * `clima-tempo` faz 14 (7 cidades × 2 endpoints). O teto existe porque o laço é
 * de ponto-fixo: uma expressão cuja URL dependesse da resposta anterior poderia
 * pedir sem fim, e um travamento silencioso é pior que um erro que diz o número.
 */
const TETO_DE_BUSCAS_WEB = 200;

/** Duas requisições são a mesma quando URL e headers batem. */
function chaveDoPedido(p: PedidoWeb): string {
  const hs = Object.keys(p.headers).sort().map((k) => `${k}: ${p.headers[k]}`).join('\n');
  return `GET ${p.url}\n${hs}`;
}

/**
 * Avalia uma query que pode chamar `Web.Contents`, buscando o que faltar.
 *
 * **Por que reavaliar em vez de buscar na hora.** Avaliar M é síncrono (o mesmo
 * contrato do avaliador de DAX, e o que faz o teste rodar sem credencial), então
 * uma função M não pode esperar por rede. Para `Odbc.Query` isso se resolve
 * pré-buscando: a spec diz qual é a fonte antes de a avaliação começar. Para
 * `Web.Contents` não dá — em `clima-tempo` a URL sai de `cidade{1}` e de
 * `Date.ToText(ontem)`, que só existem no meio da avaliação.
 *
 * Então: avalia; na primeira URL não vista, `ctx.web` sinaliza; o laço busca,
 * guarda, e avalia de novo do zero. Cada passada resolve uma requisição a mais e
 * o mapa só cresce, então o laço termina, e a **última** passada é a que vale —
 * ela roda inteira sem nenhuma busca pendente, com todas as respostas na mão.
 * Nenhum resultado parcial sobrevive.
 *
 * O custo é reavaliar N+1 vezes uma expressão que, nas passadas iniciais, para na
 * primeira URL nova. Medido em `clima-tempo`: 15 passadas. É barato porque a
 * reavaliação não repete I/O — só o que já está em memória.
 */
async function avaliaComWeb(
  ev: MEvaluator,
  m: string,
  respostas: Map<string, Uint8Array>,
  buscar: BuscadorWeb | undefined,
  id: string,
): Promise<{ valor: MValue; passos: Map<string, MValue> }> {
  for (let passada = 0; ; passada++) {
    try {
      return ev.avaliaQuery(m);
    } catch (err) {
      if (!(err instanceof PrecisaBuscarWeb)) throw err;
      if (!buscar) {
        throw new MEvalError(
          `A query '${id}' chama Web.Contents(${err.pedido.url}), mas o runner não recebeu ` +
            '`web`. Passe `web` em RunnerOptions para rodá-la.',
        );
      }
      if (passada >= TETO_DE_BUSCAS_WEB) {
        throw new MEvalError(
          `A query '${id}' passou de ${TETO_DE_BUSCAS_WEB} buscas HTTP numa avaliação. ` +
            'Provável URL que depende da resposta anterior, que este laço não resolve.',
        );
      }
      respostas.set(chaveDoPedido(err.pedido), await buscar(err.pedido));
    }
  }
}

export interface RunnerOptions {
  readonly specs: readonly MQuerySpec[];
  readonly fonte: FonteDeLinhas;
  /**
   * Busca HTTP para `Web.Contents`. Ausente = a query que chamar erra dizendo que
   * falta injetar — nunca devolve vazio. Só `clima-tempo` usa.
   */
  readonly web?: BuscadorWeb;
  readonly agora?: Date;
  /**
   * Culture do modelo — vem de `specs/_catalog/model.yaml` (`pt-BR`), que o
   * extrator lê do `model.tmdl`. Sem ela, todo passo que converte texto para data
   * erra alto, e é o certo: o formato não está na expressão M.
   */
  readonly culture?: string | null;
  /**
   * Queries a rodar. Ausente = todas as que têm `m_expression`. As dependências
   * entram sozinhas, mesmo fora desta lista.
   */
  readonly apenas?: readonly string[];
  /**
   * Dada uma query, o predicado que libera a comparação por inteiro numa mesclagem
   * morta. Ausente = nenhuma é liberada, e a nota diz o número que a justificaria.
   *
   * Recebe o `id` da query porque `Table.NestedJoin` só conhece nomes de coluna, e
   * duas queries podem mesclar pelas mesmas chaves com só uma tendo decisão. Quem
   * monta isto é `reconciliadorDe` sobre `specs/_catalog/juncoes.yaml`.
   */
  readonly reconcilia?: (queryId: string) => (
    esq: readonly string[],
    dir: readonly string[],
  ) => boolean;
}

/** As 5 funções de fonte. `Odbc.Query` e `GoogleSheets.Contents` vêm do runner. */
const NOMES_DE_FONTE = ['Odbc.Query', 'GoogleSheets.Contents'] as const;

/**
 * Nomes de outras queries que esta expressão cita.
 *
 * Um nome conta como dependência quando **não** é passo do próprio `let`, não é
 * função ou constante conhecida, e **é** nome de query. Nome que sobra depois
 * disso é órfão, e o chamador decide o que fazer (`queryOrder` erra alto).
 */
export function queryDependencies(
  m: string,
  nomesDeQuery: ReadonlySet<string>,
): { dependencias: string[]; orfaos: string[] } {
  const passos = new Set((parseMLet(m) ?? []).map((b) => b.name));
  const conhecidos = new Set([
    ...standardFunctions().keys(),
    ...standardConstants().keys(),
    ...NOMES_DE_FONTE,
    '_',
  ]);
  const dependencias = new Set<string>();
  const orfaos = new Set<string>();

  const anda = (no: unknown, locais: ReadonlySet<string>): void => {
    if (typeof no !== 'object' || no === null) return;
    const n = no as { type?: string; name?: string; params?: { name: string }[]; bindings?: { name: string }[] };
    // Escopo local acumula: `let` aninhado e parâmetro de função declaram nome, e
    // tratá-los como query externa inventaria dependência que não existe.
    let dentro = locais;
    if (n.type === 'Let' && n.bindings) {
      dentro = new Set([...locais, ...n.bindings.map((b) => b.name)]);
    } else if (n.type === 'Function' && n.params) {
      dentro = new Set([...locais, ...n.params.map((p) => p.name)]);
    }
    if (n.type === 'Identifier' && n.name && !dentro.has(n.name) && !conhecidos.has(n.name)) {
      if (nomesDeQuery.has(n.name)) dependencias.add(n.name);
      else orfaos.add(n.name);
    }
    for (const v of Object.values(no) as unknown[]) {
      if (Array.isArray(v)) for (const x of v) anda(x, dentro);
      else anda(v, dentro);
    }
  };
  anda(parseM(m), passos);
  return { dependencias: [...dependencias].sort(), orfaos: [...orfaos].sort() };
}

/**
 * Ordem topológica das queries: dependência antes de dependente.
 *
 * Ciclo é erro que **nomeia o ciclo**, não recursão infinita. Órfão também erra:
 * um nome que não é passo, função nem query costuma ser função M não implementada
 * — e "sigo em frente" ali produziria uma tabela com coluna vazia.
 */
export function queryOrder(specs: readonly MQuerySpec[]): MQuerySpec[] {
  const comM = specs.filter((s) => s.m_expression);
  const porNome = new Map(comM.map((s) => [s.name, s]));
  const nomes = new Set(porNome.keys());

  const ordem: MQuerySpec[] = [];
  const estado = new Map<string, 'visitando' | 'pronto'>();
  const caminho: string[] = [];

  const visita = (spec: MQuerySpec): void => {
    const st = estado.get(spec.name);
    if (st === 'pronto') return;
    if (st === 'visitando') {
      const desde = caminho.indexOf(spec.name);
      throw new MEvalError(
        `Ciclo entre queries M: ${[...caminho.slice(desde), spec.name].join(' → ')}.`,
      );
    }
    estado.set(spec.name, 'visitando');
    caminho.push(spec.name);
    const { dependencias, orfaos } = queryDependencies(spec.m_expression!, nomes);
    if (orfaos.length) {
      throw new MEvalError(
        `A query '${spec.id}' cita ${orfaos.map((o) => `'${o}'`).join(', ')}, que não é passo ` +
          'dela, nem função M implementada, nem outra query. Provável função não implementada.',
      );
    }
    for (const dep of dependencias) visita(porNome.get(dep)!);
    caminho.pop();
    estado.set(spec.name, 'pronto');
    ordem.push(spec);
  };

  for (const s of comM) visita(s);
  return ordem;
}

/** Resultado de uma query executada. */
export interface QueryExecutada {
  readonly id: string;
  readonly name: string;
  readonly tabela: MTable;
  /** Valor de cada passo, para comparar passo a passo com o Power Query. */
  readonly passos: Map<string, MValue>;
  /**
   * O que a avaliação fez e precisa ser dito — hoje, junção que não casou nada.
   *
   * Vazio é o normal. Quem materializa **tem** de imprimir o que vier aqui: a razão
   * de existir é que uma mescla morta devolvia 87.805 nulos calada.
   */
  readonly notas: readonly NotaM[];
}

/**
 * Roda as queries pedidas, com dependências, em ordem topológica.
 *
 * As linhas da fonte são buscadas **antes** de avaliar cada query, e as funções de
 * fonte devolvem a tabela já buscada. Por isso `Odbc.Query(dsn, sql)` ignora seus
 * argumentos aqui: o SQL que vale é o da spec, que é o mesmo texto e é o que o
 * Query Engine já sabe executar com cache e read-only. Duplicar a extração do SQL
 * de dentro do M daria duas fontes de verdade para a mesma coisa.
 */
export async function runQueries(opts: RunnerOptions): Promise<Map<string, QueryExecutada>> {
  const ordem = queryOrder(opts.specs);
  const pedidas = opts.apenas ? new Set(opts.apenas) : null;
  const nomes = new Set(ordem.map((s) => s.name));

  /** Quais precisam rodar: as pedidas mais o fechamento das dependências. */
  const necessarias = new Set<string>();
  if (pedidas) {
    const porId = new Map(ordem.map((s) => [s.id, s]));
    const porNome = new Map(ordem.map((s) => [s.name, s]));
    const marca = (spec: MQuerySpec): void => {
      if (necessarias.has(spec.name)) return;
      necessarias.add(spec.name);
      for (const dep of queryDependencies(spec.m_expression!, nomes).dependencias) {
        marca(porNome.get(dep)!);
      }
    };
    for (const id of pedidas) {
      const spec = porId.get(id);
      if (!spec) throw new MEvalError(`Query '${id}' não está nas specs, ou não tem m_expression.`);
      marca(spec);
    }
  }

  const prontas = new Map<string, QueryExecutada>();
  const porNomeProntas = new Map<string, MTable>();

  for (const spec of ordem) {
    if (pedidas && !necessarias.has(spec.name)) continue;

    const linhasDaFonte = await opts.fonte(spec);
    const tabelaDaFonte = deLinhas(linhasDaFonte);

    const funcoes = new Map(standardFunctions());
    for (const nome of NOMES_DE_FONTE) {
      const impl: MFunctionImpl = {
        name: nome,
        minArgs: 0,
        maxArgs: 4,
        call: () => tabelaDaFonte,
      };
      funcoes.set(nome, impl);
    }

    // Respostas HTTP desta query. Vive fora do avaliador porque precisa
    // SOBREVIVER às reavaliações do laço de ponto-fixo — é ele que faz a passada
    // seguinte ir mais longe que a anterior.
    const respostasWeb = new Map<string, Uint8Array>();

    // Fora do avaliador pela mesma razão que `respostasWeb`: o laço de ponto-fixo
    // reavalia a expressão inteira, e uma nota por passada viraria três notas iguais.
    // O `Map` por texto é o que faz a última passada valer, e não a soma delas.
    const notas = new Map<string, NotaM>();

    const ev = new MEvaluator({
      functions: funcoes,
      constants: standardConstants(),
      agora: opts.agora,
      culture: opts.culture,
      web: (pedido) => {
        const bytes = respostasWeb.get(chaveDoPedido(pedido));
        if (bytes === undefined) throw new PrecisaBuscarWeb(pedido);
        return bytes;
      },
      nota: (n) => notas.set(`${n.fn} ${n.assunto}`, n),
      reconcilia: opts.reconcilia?.(spec.id),
      nota: (n) => notas.set(`${n.fn} ${n.assunto}`, n),
      reconcilia: opts.reconcilia?.(spec.id),
      query: (nome) => {
        const t = porNomeProntas.get(nome);
        if (!t) {
          throw new MEvalError(
            `A query '${spec.id}' cita '${nome}', que não foi executada antes dela. ` +
              'Isso é falha de ordenação do runner, não da expressão.',
          );
        }
        return t;
      },
    });

    const { valor, passos } = await avaliaComWeb(
      ev,
      spec.m_expression!,
      respostasWeb,
      opts.web,
      spec.id,
    );
    if (!(valor instanceof MTable)) {
      throw new MEvalError(
        `A query '${spec.id}' devolveu algo que não é tabela. Toda query do modelo vira tabela.`,
      );
    }
    prontas.set(spec.id, {
      id: spec.id,
      name: spec.name,
      tabela: valor,
      passos,
      notas: [...notas.values()],
    });
    porNomeProntas.set(spec.name, valor);
  }

  return prontas;
}

/**
 * `Row[]` do connector para `MTable`.
 *
 * A ordem de coluna vem das chaves da **primeira** linha — a ordem que o driver
 * devolveu, que é a ordem do `SELECT`. Linha seguinte com chave que a primeira não
 * tinha é erro: significaria colunas variando entre linhas, e o M supõe tabela
 * retangular. Silenciar isso perderia coluna sem avisar.
 */
export function deLinhas(rows: readonly Record<string, unknown>[]): MTable {
  if (rows.length === 0) return new MTable([], []);
  const colunas = Object.keys(rows[0]);
  const conhecidas = new Set(colunas);
  const linhas: MRow[] = rows.map((r, i) => {
    for (const k of Object.keys(r)) {
      if (!conhecidas.has(k)) {
        throw new MEvalError(
          `A linha ${i + 1} da fonte tem a coluna '${k}', que a primeira linha não tinha. ` +
            'A tabela não é retangular.',
        );
      }
    }
    return linha(colunas.map((c) => [c, comoM(r[c])] as const));
  });
  return new MTable(colunas, linhas);
}

/** Valor do driver para valor M. */
function comoM(v: unknown): MValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') {
    // `COUNT(*)` do Postgres chega como bigint. Number perde precisão acima de
    // 2^53; nenhuma contagem desta base chega perto, mas o erro é melhor que a
    // perda silenciosa.
    if (v > Number.MAX_SAFE_INTEGER || v < Number.MIN_SAFE_INTEGER) {
      throw new MEvalError(`Valor bigint ${v} não cabe em número sem perder precisão.`);
    }
    return Number(v);
  }
  if (v instanceof Uint8Array) return v;
  // Valor que já é de M passa direto. O caso real é a **tabela de navegação** do
  // Google Sheets: o connector devolve uma linha por aba, com a tabela de dados
  // dentro da coluna `Data`, e o M navega com
  // `Fonte{[name="X", ItemKind="Table"]}[Data]`. Recusar aqui obrigaria o
  // connector a achatar isso e o M deixaria de encontrar a aba.
  if (v instanceof MTable || v instanceof MRecord || v instanceof MTime || v instanceof MDuration) {
    return v;
  }
  if (Array.isArray(v)) return v.map(comoM);
  throw new MEvalError(
    `A fonte devolveu um valor de tipo ${typeof v} que o engine de M não sabe representar.`,
  );
}
