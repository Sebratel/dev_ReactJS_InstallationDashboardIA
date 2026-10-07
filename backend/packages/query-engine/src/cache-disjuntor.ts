// O disjuntor do cache durável — parar de bater num Redis que não responde.
//
// **O defeito que ele conserta, medido em 08/09/2026.** Com o Redis
// inalcançável, a API continuava correta: cada operação falhava e a memória
// servia (`CacheDeResposta` já engolia o erro). Só que "falhar" custava o
// `connectTimeout` do ioredis — 10 s por padrão — e isso acontecia em TODA
// operação de cache, de TODO pedido. Medido no caminho real, trocar um filtro:
//
//   Redis inalcançável .... 13.000–20.500 ms
//   sem Redis no caminho ...  1.554–1.769 ms
//
// Onze segundos por pedido, e nada acusava: `/api/saude` respondia `ok`, o
// cálculo media 1.865 ms, a fila media 0. A API degradava CERTO e degradava de
// um jeito que torna o produto inutilizável — que é uma forma de mentir que a
// F2.1 não tinha coberto, porque ela olhou para correção e não para tempo.
//
// **O que este invólucro faz.** Conta falhas seguidas. Passou do limite, ele
// ABRE: as operações seguintes devolvem "não tenho" na hora, sem tocar no
// Redis, até a janela passar. Aí deixa UMA passar para sondar; se ela responder,
// fecha e tudo volta ao normal.
//
// **Por que devolver miss é seguro.** Este é um cache de leitura, não uma fonte:
// um miss custa recálculo, nunca número errado. E `set` virar não-operação com o
// circuito aberto é melhor do que a alternativa — gravar é o que mais paga o
// timeout, e a memória (a outra camada) continua guardando.
//
// REGRA DE SAÍDA: nunca imprime chave nem valor. Só contagem, estado e tempo.

import type { Cache } from './types.ts';

export type EstadoDoDisjuntor = 'fechado' | 'aberto';

export interface EstadoDoCacheDurável {
  estado: EstadoDoDisjuntor;
  /** Falhas seguidas até agora. Zera a cada sucesso. */
  falhasSeguidas: number;
  /** Quantas vezes o circuito abriu desde a subida. */
  aberturas: number;
  /** Operações que nem chegaram ao Redis porque o circuito estava aberto. */
  desviadas: number;
  /** Quando ele reabre para sondar. `null` com o circuito fechado. */
  sondaEm: string | null;
  ultimoErro: string | null;
}

export interface OpcoesDoDisjuntor {
  /** Falhas seguidas que abrem o circuito. Padrão 3. */
  limite?: number;
  /** Quanto tempo fica aberto antes de sondar. Padrão 10 s. */
  janelaMs?: number;
  agora?: () => number;
  /** Onde as linhas aparecem. Padrão: `console.error`. */
  anuncia?: (linha: string) => void;
}

export const LIMITE_PADRAO = 3;
export const JANELA_PADRAO_MS = 10_000;

export class CacheComDisjuntor implements Cache {
  readonly #dentro: Cache;
  readonly #limite: number;
  readonly #janelaMs: number;
  readonly #agora: () => number;
  readonly #anuncia: (linha: string) => void;

  #falhas = 0;
  #aberturas = 0;
  #desviadas = 0;
  #abertoAte = 0;
  #ultimoErro: string | null = null;

  constructor(dentro: Cache, opts: OpcoesDoDisjuntor = {}) {
    this.#dentro = dentro;
    this.#limite = opts.limite ?? LIMITE_PADRAO;
    this.#janelaMs = opts.janelaMs ?? JANELA_PADRAO_MS;
    this.#agora = opts.agora ?? (() => Date.now());
    this.#anuncia = opts.anuncia ?? ((l) => console.error(l));
  }

  /** `true` quando a operação deve ser desviada sem tocar no Redis. */
  #aberto(): boolean {
    if (this.#abertoAte === 0) return false;
    if (this.#agora() >= this.#abertoAte) {
      // A janela passou: deixa UMA operação sondar. O circuito só fecha de
      // verdade se ela responder — ver `#sucesso`.
      this.#abertoAte = 0;
      return false;
    }
    this.#desviadas += 1;
    return true;
  }

  #sucesso(): void {
    if (this.#falhas > 0) {
      this.#anuncia(
        `[cache] o Redis voltou a responder (${this.#falhas} falha(s) seguidas antes disto). ` +
          `As respostas duráveis voltam a valer.`,
      );
    }
    this.#falhas = 0;
    this.#abertoAte = 0;
  }

  #falha(err: unknown): void {
    this.#falhas += 1;
    this.#ultimoErro = err instanceof Error ? err.message : String(err);
    if (this.#falhas >= this.#limite && this.#abertoAte === 0) {
      this.#abertoAte = this.#agora() + this.#janelaMs;
      this.#aberturas += 1;
      // Uma linha por QUEDA, não por falha nem por abertura: o Redis fora do ar
      // reabre o circuito a cada sonda, e com uma linha por abertura foram 2.280
      // linhas iguais num dia de Redis parado (07/10/2026). A volta é anunciada em
      // `#sucesso`, com a contagem; o que houve entre as duas está em `/api/saude`.
      if (this.#falhas === this.#limite) this.#anuncia(
        `[cache] Redis desligado do caminho por ${(this.#janelaMs / 1000).toFixed(0)}s ` +
          `após ${this.#falhas} falhas seguidas (${this.#ultimoErro}). ` +
          `A memória continua servindo; o que se ganha é parar de pagar o tempo de espera por pedido.`,
      );
    }
  }

  async #tenta<T>(op: () => Promise<T>, seAberto: T): Promise<T> {
    if (this.#aberto()) return seAberto;
    try {
      const r = await op();
      this.#sucesso();
      return r;
    } catch (err) {
      this.#falha(err);
      throw err;
    }
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.#tenta(() => this.#dentro.get<T>(key), undefined);
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds: number): Promise<void> {
    return this.#tenta(() => this.#dentro.set(key, value, ttlSeconds), undefined);
  }

  async del(key: string): Promise<void> {
    return this.#tenta(() => this.#dentro.del(key), undefined);
  }

  async delMany(keys: string[]): Promise<number> {
    return this.#tenta(() => this.#dentro.delMany(keys), 0);
  }

  async keys(prefix: string): Promise<string[]> {
    return this.#tenta(() => this.#dentro.keys(prefix), []);
  }

  estado(): EstadoDoCacheDurável {
    const aberto = this.#abertoAte !== 0 && this.#agora() < this.#abertoAte;
    return {
      estado: aberto ? 'aberto' : 'fechado',
      falhasSeguidas: this.#falhas,
      aberturas: this.#aberturas,
      desviadas: this.#desviadas,
      sondaEm: aberto ? new Date(this.#abertoAte).toISOString() : null,
      ultimoErro: this.#ultimoErro,
    };
  }
}
