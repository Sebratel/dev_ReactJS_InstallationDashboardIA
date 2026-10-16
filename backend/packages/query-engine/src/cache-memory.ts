// Cache em memória. Usado em testes, como fallback quando o Redis cai e como a
// camada rápida da API (`CacheEmCamadas`, ou sozinho quando não há `REDIS_URL`).
//
// **O teto é opcional, e sem ele nada muda.** `backend/tools/snapshot` e
// `backend/tools/mrun` também usam esta classe, em processos que vivem o tempo de
// uma carga e morrem: lá um `Map` sem limite é o certo, e qualquer poda seria
// recálculo à toa. Sem opções o comportamento é o de sempre, byte por byte — nem a
// promoção no `get` acontece, para a ordem interna do `Map` também ser a de antes.
//
// **Por que a API precisa do teto (16/10/2026).** No processo da API este `Map`
// vivia o processo inteiro, e entrada vencida só saía num `get` da MESMA chave ou num
// `keys()`. Só que a chave da resposta carrega o carimbo do snapshot: a cada refresh
// (~15 min) todas as respostas anteriores ficam inalcançáveis — e, inalcançáveis,
// ninguém mais pede aquela chave, então ninguém as tira. Somadas às combinações
// página × filtro × janela × busca de cada usuário, a conta estimada era de 0,5 a
// 1,5 GB/dia com 10 pessoas, num contêiner de 3 GB com heap de 1.536 MB. O teto
// transforma "cresce até morrer" em "guarda o que é usado, até N bytes".
import type { Cache, Clock } from './types.ts';
import { systemClock } from './types.ts';

interface Entry {
  value: unknown;
  expiresAt: number; // epoch ms; Infinity = sem expiração
  /** Quanto esta entrada pesa no orçamento. Zero quando não há teto de bytes. */
  bytes: number;
}

export interface OpcoesDoMemoryCache {
  /**
   * Teto em bytes ESTIMADOS (ver `tamanhoDe`). Acima dele, a entrada usada há mais
   * tempo sai. Exige `tamanhoDe` — sem quem meça, não há o que comparar com o teto.
   */
  tetoBytes?: number;
  /** Teto em número de entradas. Pode ser usado junto com `tetoBytes`; vale o que estourar primeiro. */
  tetoEntradas?: number;
  /**
   * Quanto um valor ocupa, aproximadamente.
   *
   * Entra por função para este pacote não depender da API: quem mede lá é
   * `estimaBytes` (`backend/api/src/cache-visual.ts`), que conta pelo lado caro.
   * O custo da chave (texto do `Map`) é somado aqui dentro, porque a chave da
   * resposta tem ~150 caracteres e é paga por entrada, não por valor.
   */
  tamanhoDe?: (valor: unknown) => number;
}

export class MemoryCache implements Cache {
  #store = new Map<string, Entry>();
  #clock: Clock;
  #bytes = 0;
  #despejadas = 0;
  readonly #tetoBytes: number;
  readonly #tetoEntradas: number;
  readonly #tamanhoDe: ((valor: unknown) => number) | null;
  /** Há algum teto? Sem ele, `get`/`set` fazem exatamente o que faziam antes. */
  readonly #limitado: boolean;
  /**
   * O tamanho já medido de cada objeto, por identidade.
   *
   * A API grava a MESMA resposta em duas chaves (a do carimbo atual e a "última
   * pronta", `servidor.ts`), e medir duas vezes o mesmo objeto seria andar a árvore
   * inteira à toa. `WeakMap` para não segurar o objeto vivo depois que as duas chaves
   * saírem. Supõe que o valor não muda depois de guardado — e isso já era exigido,
   * porque este cache guarda referência: mutar o objeto mudaria o que o próximo
   * acerto devolve.
   */
  readonly #medidos = new WeakMap<object, number>();

  constructor(clock: Clock = systemClock, opcoes: OpcoesDoMemoryCache = {}) {
    this.#clock = clock;
    this.#tetoBytes = opcoes.tetoBytes ?? Number.POSITIVE_INFINITY;
    this.#tetoEntradas = opcoes.tetoEntradas ?? Number.POSITIVE_INFINITY;
    this.#tamanhoDe = opcoes.tamanhoDe ?? null;
    // Erra alto: um teto de bytes sem medidor seria um teto que nunca dispara, e
    // isso só apareceria como a memória crescendo de novo, semanas depois.
    if (opcoes.tetoBytes !== undefined && this.#tamanhoDe === null) {
      throw new Error('MemoryCache: `tetoBytes` exige `tamanhoDe` (quem mede o valor).');
    }
    this.#limitado =
      Number.isFinite(this.#tetoBytes) || Number.isFinite(this.#tetoEntradas);
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.#store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.#clock.now()) {
      this.#remove(key, entry);
      return undefined;
    }
    if (this.#limitado) {
      // Reinsere no fim: a ordem de inserção do `Map` É a ordem de uso, e quem sai
      // na poda é sempre o primeiro. Sem isto seria FIFO — a página mais aberta do
      // dia sairia só por ter entrado cedo. Mesmo truque de `CacheDeVisual`.
      this.#store.delete(key);
      this.#store.set(key, entry);
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return; // ttl 0 = não cacheia
    const expiresAt = this.#clock.now() + ttlSeconds * 1000;
    if (!this.#limitado) {
      this.#store.set(key, { value, expiresAt, bytes: 0 });
      return;
    }

    // **Duas chaves, um objeto, contado duas vezes.** A resposta e a "última
    // pronta" apontam para o mesmo valor, e cada uma entra no orçamento com o
    // tamanho inteiro. É conservador de propósito: o teto dispara antes da memória
    // real chegar lá, nunca depois. E deixa de ser exagero quando o valor vem do
    // Redis (`CacheEmCamadas` promove um objeto novo por chave).
    const bytes = this.#tamanhoDe ? 16 + key.length * 2 + this.#mede(value) : 0;

    const anterior = this.#store.get(key);
    if (anterior) this.#remove(key, anterior);

    // Maior que o teto inteiro nunca cabe: guardá-la esvaziaria o cache para ela
    // mesma sair no próximo `set`. Não guardar é só um miss a mais; a chave antiga
    // já saiu acima, para não sobrar um valor desatualizado no lugar.
    if (bytes > this.#tetoBytes) return;

    this.#store.set(key, { value, expiresAt, bytes });
    this.#bytes += bytes;
    this.#poda(key);
  }

  async del(key: string): Promise<void> {
    const entry = this.#store.get(key);
    if (entry) this.#remove(key, entry);
  }

  async delMany(keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      const entry = this.#store.get(k);
      if (!entry) continue;
      this.#remove(k, entry);
      n++;
    }
    return n;
  }

  async keys(prefix: string): Promise<string[]> {
    const now = this.#clock.now();
    const out: string[] = [];
    for (const [k, entry] of this.#store) {
      if (entry.expiresAt <= now) {
        this.#remove(k, entry);
        continue;
      }
      if (k.startsWith(prefix)) out.push(k);
    }
    return out.sort();
  }

  /** Só para testes/observabilidade. */
  get size(): number {
    return this.#store.size;
  }

  /** Bytes estimados guardados agora. Zero sem teto de bytes. */
  get bytes(): number {
    return this.#bytes;
  }

  /** Quantas entradas VÁLIDAS já saíram por falta de espaço (vencida não conta). */
  get despejadas(): number {
    return this.#despejadas;
  }

  #remove(key: string, entry: Entry): void {
    this.#store.delete(key);
    this.#bytes -= entry.bytes;
  }

  #mede(valor: unknown): number {
    const medidor = this.#tamanhoDe!;
    if (typeof valor !== 'object' || valor === null) return medidor(valor);
    const ja = this.#medidos.get(valor);
    if (ja !== undefined) return ja;
    const n = medidor(valor);
    this.#medidos.set(valor, n);
    return n;
  }

  /**
   * Tira entradas até caber, poupando `nova` (a que acabou de entrar).
   *
   * **Primeiro as vencidas, depois a menos usada.** Uma entrada vencida não serve a
   * ninguém e ocupa o mesmo espaço; despejar uma válida enquanto houver vencida
   * seria trocar um acerto possível por lixo. A varredura das vencidas é O(n), mas
   * só roda quando o teto estourou — e n aqui é da ordem de centenas a poucos
   * milhares de respostas, nada perto do cálculo que cada uma delas evita.
   */
  #poda(nova: string): void {
    if (!this.#estourou()) return;
    const agora = this.#clock.now();
    for (const [k, entry] of this.#store) {
      if (k !== nova && entry.expiresAt <= agora) this.#remove(k, entry);
    }
    for (const [k, entry] of this.#store) {
      if (!this.#estourou()) break;
      // Nunca despeja o que acabou de entrar: ela já foi recusada acima se não
      // cabia sozinha, então aqui sempre há outra para sair antes dela.
      if (k === nova) continue;
      this.#remove(k, entry);
      this.#despejadas++;
    }
  }

  #estourou(): boolean {
    return this.#bytes > this.#tetoBytes || this.#store.size > this.#tetoEntradas;
  }
}
