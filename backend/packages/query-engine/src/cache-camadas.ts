// Cache em duas camadas: memória na frente, Redis atrás.
//
// **Por que isto existe, e o que ele conserta.** Até 17/08/2026 a escolha era
// *exclusiva*: `backend/api/src/index.ts` usava `RedisCache` **em vez de** `MemoryCache`
// quando `REDIS_URL` existia. Ligar o Redis, portanto, teria deixado a API mais
// **lenta** — cada acerto passaria a pagar uma ida e volta de rede mais um
// `JSON.parse` de até 172 KB, no lugar de uma leitura de `Map` que hoje custa
// microssegundos. Uma peça de infraestrutura que piora o número que ela deveria
// melhorar é pior que a ausência dela, porque ninguém procura ali.
//
// As duas camadas resolvem coisas diferentes, e é por isso que são duas:
//
//   - a **memória** dá a latência: o acerto não sai do processo;
//   - o **Redis** dá a permanência: o cache sobrevive ao restart e é compartilhado
//     entre processos. Sem ele, reiniciar a API joga fora o trabalho todo e o
//     aquecimento de arranque tem de refazer os ~2,5 min.
//
// **Escrever nas duas, ler da mais rápida primeiro.** Um acerto no Redis é promovido
// para a memória, então a segunda visita à mesma página depois de um restart já é
// local.
//
// **A camada durável nunca derruba o pedido.** Redis fora do ar vira miss na leitura
// e silêncio na escrita — a memória continua servindo. É a mesma degradação que
// `CacheDeResposta` já garante uma camada acima, repetida aqui porque esta classe
// também é usada pelo Query Engine, que não passa por lá.

import type { Cache } from './types.ts';

export interface OpcoesEmCamadas {
  /** A camada de latência. Normalmente `MemoryCache`. */
  rapida: Cache;
  /** A camada de permanência. Normalmente `RedisCache`. */
  duravel: Cache;
  /**
   * Onde a falha da camada durável aparece. Ela nunca propaga.
   *
   * Padrão: silêncio. Quem monta as camadas na API passa o `console.error` — mas o
   * Query Engine tem o seu próprio caminho de log, e um padrão barulhento aqui
   * imprimiria a mesma falha duas vezes.
   */
  aoFalhar?: (operacao: string, erro: unknown) => void;
}

export class CacheEmCamadas implements Cache {
  readonly #rapida: Cache;
  readonly #duravel: Cache;
  readonly #aoFalhar: (operacao: string, erro: unknown) => void;

  constructor(opts: OpcoesEmCamadas) {
    this.#rapida = opts.rapida;
    this.#duravel = opts.duravel;
    this.#aoFalhar = opts.aoFalhar ?? ((): void => {});
  }

  /** Como as duas camadas aparecem em `GET /api/saude`. */
  get nome(): string {
    return `${this.#rapida.constructor.name}+${this.#duravel.constructor.name}`;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const local = await this.#rapida.get<T>(key);
    if (local !== undefined) return local;

    const remoto = await this.#tenta('get', () => this.#duravel.get<T>(key));
    if (remoto === undefined) return undefined;

    // Promove: a próxima leitura desta chave não sai do processo. O TTL da promoção
    // é o padrão da camada rápida — a durável continua sendo a dona do prazo.
    await this.#rapida.set(key, remoto, TTL_DA_PROMOCAO);
    return remoto;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    await this.#rapida.set(key, value, ttlSeconds);
    await this.#tenta('set', () => this.#duravel.set(key, value, ttlSeconds));
  }

  async del(key: string): Promise<void> {
    await this.#rapida.del(key);
    await this.#tenta('del', () => this.#duravel.del(key));
  }

  async delMany(keys: string[]): Promise<number> {
    // O número que vale é o da camada durável: é ela que sabe o que existe entre
    // processos. A memória local só conhece o que este processo tocou.
    const local = await this.#rapida.delMany(keys);
    const remoto = await this.#tenta('delMany', () => this.#duravel.delMany(keys));
    return remoto ?? local;
  }

  async keys(prefix: string): Promise<string[]> {
    const local = await this.#rapida.keys(prefix);
    const remoto = await this.#tenta('keys', () => this.#duravel.keys(prefix));
    if (remoto === undefined) return local;
    return [...new Set([...local, ...remoto])].sort();
  }

  /** Roda na camada durável engolindo a falha. `undefined` = não deu. */
  async #tenta<T>(operacao: string, f: () => Promise<T>): Promise<T | undefined> {
    try {
      return await f();
    } catch (err) {
      this.#aoFalhar(operacao, err);
      return undefined;
    }
  }
}

/**
 * Por quanto tempo uma entrada promovida do Redis fica na memória.
 *
 * Um dia. Não é prazo de validade — a chave já carrega carimbo e dia, então uma
 * entrada só é alcançável enquanto for verdadeira (ver `cache-resposta.ts`). É só um
 * teto para o processo não acumular para sempre o que leu de fora.
 */
const TTL_DA_PROMOCAO = 24 * 60 * 60;
