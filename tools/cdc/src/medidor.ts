// O que um fluxo de eventos CDC diz — sem guardar o que ele carrega.
//
// **Esta é a parte testável do observador.** O `index.ts` fala com o Kafka; aqui só
// entram eventos já reduzidos ao mínimo, e sai o relatório. Separado assim porque a
// pergunta que o `DECISAO-REALTIME.md` faz — *o intervalo entre mudanças é menor que
// o tempo de rematerializar?* — é uma conta, e conta se testa sem broker nenhum.
//
// **REGRA DE ENTRADA: o payload nunca chega aqui.** Um evento Debezium carrega a
// linha inteira; `field-agenda` tem endereço de cliente e `QUADRO FUNCIONAL` tem CPF
// e RG. `EventoMinimo` não tem campo para isso, e é de propósito — assim não existe
// caminho pelo qual um dado de cliente entre no relatório, nem por engano.

import type { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';

/** O que sobra de um evento CDC depois de jogar fora tudo que é dado. */
export interface EventoMinimo {
  /** Tópico de origem, como o Kafka o nomeia. */
  topico: string;
  /** Schema da tabela-fonte, se o envelope trouxe. */
  schema: string | null;
  /** Tabela-fonte. É a chave do mapa de invalidação. */
  tabela: string;
  /** `c` criar, `u` atualizar, `d` apagar, `r` leitura do snapshot inicial. */
  op: string;
  /** Quando o banco produziu a mudança (epoch ms), ou `null` se não veio. */
  ts: number | null;
  /** Quando **nós** recebemos (epoch ms). É o relógio que sempre existe. */
  recebidoEm: number;
}

export interface ContagemDeTabela {
  tabela: string;
  schema: string | null;
  eventos: number;
  /** Contagem por operação. */
  ops: Record<string, number>;
  primeiro: number;
  ultimo: number;
  /** Ids de query que esta tabela suja. Vazio = tabela que nenhuma query usa. */
  queries: string[];
}

export interface ContagemDeQuery {
  query: string;
  /** Quantas vezes ela ficaria suja no período. */
  sujeiras: number;
  ttl: number;
  /** Intervalos entre sujeiras consecutivas, em ms. */
  intervaloMedianoMs: number | null;
  tabelas: string[];
}

export interface Relatorio {
  deMs: number;
  ateMs: number;
  duracaoMs: number;
  eventos: number;
  /** Eventos cujo envelope não deu para entender. Contados, nunca impressos. */
  ilegiveis: number;
  tabelas: ContagemDeTabela[];
  queries: ContagemDeQuery[];
  /** Tabelas que mudaram e que nenhuma query declara. */
  desconhecidas: string[];
}

/** Guarda o suficiente para o relatório, e nada além. */
export class Medidor {
  readonly #registry: QueryRegistry;
  readonly #porTabela = new Map<string, ContagemDeTabela>();
  /** query → instantes em que ela ficou suja. Limitado, para não crescer sem fim. */
  readonly #sujeirasPorQuery = new Map<string, number[]>();
  #eventos = 0;
  #ilegiveis = 0;
  #de: number | null = null;
  #ate = 0;

  /**
   * Teto de instantes guardados por query. 5.000 amostras dão mediana de sobra, e
   * um observador deixado rodando o fim de semana não pode virar vazamento de
   * memória por guardar carimbo de tempo.
   */
  static readonly AMOSTRAS_MAXIMO = 5_000;

  constructor(registry: QueryRegistry) {
    this.#registry = registry;
  }

  /** Um evento que não deu para ler. Conta, e o conteúdo morre aqui. */
  ilegivel(recebidoEm: number): void {
    this.#ilegiveis += 1;
    this.#eventos += 1;
    this.#marcaJanela(recebidoEm);
  }

  registra(e: EventoMinimo): void {
    this.#eventos += 1;
    this.#marcaJanela(e.recebidoEm);

    const chave = `${e.schema ?? ''}.${e.tabela}`;
    let t = this.#porTabela.get(chave);
    if (!t) {
      t = {
        tabela: e.tabela,
        schema: e.schema,
        eventos: 0,
        ops: {},
        primeiro: e.recebidoEm,
        ultimo: e.recebidoEm,
        queries: queriesDoEvento(this.#registry, e),
      };
      this.#porTabela.set(chave, t);
    }
    t.eventos += 1;
    t.ops[e.op] = (t.ops[e.op] ?? 0) + 1;
    t.ultimo = e.recebidoEm;

    for (const q of t.queries) {
      const lista = this.#sujeirasPorQuery.get(q) ?? [];
      // Descarta a mais antiga em vez de parar de contar: a janela desliza, e a
      // mediana passa a ser a do período recente — que é a que interessa.
      if (lista.length >= Medidor.AMOSTRAS_MAXIMO) lista.shift();
      lista.push(e.recebidoEm);
      this.#sujeirasPorQuery.set(q, lista);
    }
  }

  #marcaJanela(quando: number): void {
    if (this.#de === null) this.#de = quando;
    this.#ate = Math.max(this.#ate, quando);
  }

  relatorio(agora: number): Relatorio {
    const de = this.#de ?? agora;
    const ate = Math.max(this.#ate, de);

    const tabelas = [...this.#porTabela.values()].sort((a, b) => b.eventos - a.eventos);

    const queries: ContagemDeQuery[] = [...this.#sujeirasPorQuery.entries()]
      .map(([query, instantes]) => ({
        query,
        sujeiras: instantes.length,
        ttl: this.#registry.has(query) ? this.#registry.get(query).cache.ttl : 0,
        intervaloMedianoMs: medianaDeIntervalos(instantes),
        tabelas: tabelas.filter((t) => t.queries.includes(query)).map((t) => t.tabela),
      }))
      .sort((a, b) => b.sujeiras - a.sujeiras);

    return {
      deMs: de,
      ateMs: ate,
      duracaoMs: Math.max(0, ate - de),
      eventos: this.#eventos,
      ilegiveis: this.#ilegiveis,
      tabelas,
      queries,
      desconhecidas: tabelas.filter((t) => t.queries.length === 0).map((t) => t.tabela),
    };
  }
}

/**
 * A mediana dos intervalos entre eventos consecutivos.
 *
 * Mediana e não média: um lote de 500 alterações num segundo (uma importação, um
 * job noturno) puxaria a média para perto de zero e faria parecer que a base muda
 * o tempo todo. A mediana descreve o intervalo **típico**, que é o que decide se o
 * refresh agendado dá conta.
 *
 * `null` com menos de dois eventos — um evento não tem intervalo, e inventar um
 * seria pior que não responder.
 */
export function medianaDeIntervalos(instantes: readonly number[]): number | null {
  if (instantes.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < instantes.length; i += 1) gaps.push(instantes[i]! - instantes[i - 1]!);
  gaps.sort((a, b) => a - b);
  const meio = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[meio]! : Math.round((gaps[meio - 1]! + gaps[meio]!) / 2);
}

/**
 * As queries que a tabela de um evento suja — a mesma conta para quem só observa
 * (`Medidor`) e para quem age (`ingestor.ts`), de propósito: as duas nunca podem
 * discordar sobre o que uma mudança de tabela afeta.
 *
 * Tenta `schema.tabela` **antes** de `tabela` porque as duas formas convivem nas
 * specs: `dbVoalle` declara `assignment_incidents` (o schema `erp` fica de fora) e
 * `dbMaria` declara `db_applicattion.installation_teams`. Procurar só uma das duas
 * deixaria metade das queries fora do mapa em silêncio.
 */
export function queriesDoEvento(registry: QueryRegistry, e: EventoMinimo): string[] {
  const comSchema = e.schema ? registry.queriesForTable(`${e.schema}.${e.tabela}`) : [];
  if (comSchema.length > 0) return comSchema;
  return registry.queriesForTable(e.tabela);
}

/**
 * Lê o envelope de um evento Debezium e devolve só o que não é dado.
 *
 * Aceita as duas formas: com schema (`{schema, payload}`) e já desembrulhada. E
 * aceita `null` — a *tombstone* que o Debezium publica depois de um `delete`.
 *
 * Devolve `null` quando não dá para entender o envelope. Quem chama conta isso como
 * ilegível; o conteúdo não vai para lugar nenhum, nem para a mensagem de erro.
 */
export function leEnvelope(
  topico: string,
  valor: string | null,
  recebidoEm: number,
): EventoMinimo | null {
  const daTopologia = tabelaDoTopico(topico);

  // Tombstone: valor nulo com chave. É a lápide de um delete, e ela conta.
  if (valor === null) {
    if (!daTopologia) return null;
    return { topico, ...daTopologia, op: 'tombstone', ts: null, recebidoEm };
  }

  let cru: unknown;
  try {
    cru = JSON.parse(valor);
  } catch {
    return null;
  }
  if (cru === null || typeof cru !== 'object') return null;

  const env = cru as Record<string, unknown>;
  const payload = (env['payload'] ?? env) as Record<string, unknown>;
  const source = (payload['source'] ?? {}) as Record<string, unknown>;

  const tabela = texto(source['table']) ?? daTopologia?.tabela;
  if (!tabela) return null;

  return {
    topico,
    schema: texto(source['schema']) ?? daTopologia?.schema ?? null,
    tabela,
    op: texto(payload['op']) ?? '?',
    ts: typeof payload['ts_ms'] === 'number' ? payload['ts_ms'] : null,
    recebidoEm,
  };
}

/**
 * Schema e tabela deduzidos do nome do tópico.
 *
 * O Debezium nomeia `<prefixo>.<schema>.<tabela>`. É a rede de segurança para o
 * envelope desembrulhado por `ExtractNewRecordState`, que descarta `source` — sem
 * isto, um conector configurado assim produziria só eventos ilegíveis.
 */
export function tabelaDoTopico(topico: string): { schema: string | null; tabela: string } | null {
  const partes = topico.split('.').filter(Boolean);
  if (partes.length < 2) return null;
  return {
    tabela: partes[partes.length - 1]!,
    schema: partes.length >= 3 ? partes[partes.length - 2]! : null,
  };
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
