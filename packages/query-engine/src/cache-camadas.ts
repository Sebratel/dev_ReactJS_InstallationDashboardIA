// Cache em duas camadas: memória na frente, Redis atrás.
//
// **Por que isto existe, e o que ele conserta.** Até 17/08/2026 a escolha era
// *exclusiva*: `apps/api/src/index.ts` usava `RedisCache` **em vez de** `MemoryCache`
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
//
// **E nunca o atrasa — que é coisa diferente, e faltava.** Até 24/08/2026 a promessa
// acima era só sobre o *resultado*: a falha era engolida, mas o pedido esperava por
// ela. Medido nesta máquina, com `REDIS_URL=redis://localhost:6379/0` no `.env` e
// nada escutando nessa porta: **cada miss de cache custava 15 a 20 segundos** — o
// `ioredis` reconectando no `get`, e de novo no `set`, antes de desistir. A tela
// mostrava o carregamento; o log dizia "a memória continua servindo"; e ninguém que
// está olhando um dashboard lê o log do servidor. Degradação silenciosa, que é
// exatamente a classe de erro que este projeto não aceita.
//
// Duas peças consertam isso, e as duas são de **tempo**, não de resultado:
//
//   - **teto por chamada** (`tempoLimiteMs`): a camada durável tem um orçamento. Se
//     estourar, é miss — o `await` não fica pendurado no timeout de rede de outra
//     biblioteca;
//   - **disjuntor** (`pausaMs`): depois de uma falha, ela é **pulada** por um tempo.
//     Sem isto o teto seria cobrado a cada chamada, e um Redis fora do ar somaria
//     dois tetos por pedido para sempre.
//
// O disjuntor fecha sozinho no primeiro sucesso depois da pausa. Não há religar
// manual: um Redis que voltou não deve depender de alguém lembrar dele.

import type { Cache } from './types.ts';

/** Teto padrão, por chamada, da camada durável. */
export const TEMPO_LIMITE_PADRAO_MS = 750;

/**
 * Quanto tempo a camada durável fica de fora depois de uma falha.
 *
 * Cinco segundos: curto o bastante para um Redis que voltou entrar em serviço sem
 * ninguém reiniciar nada, longo o bastante para que um Redis morto não cobre o teto
 * de tempo em cada pedido.
 */
export const PAUSA_PADRAO_MS = 5_000;

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
  /** Teto de tempo, por chamada, da camada durável. Ver `TEMPO_LIMITE_PADRAO_MS`. */
  tempoLimiteMs?: number;
  /** Quanto a camada durável fica de fora depois de falhar. Ver `PAUSA_PADRAO_MS`. */
  pausaMs?: number;
  /** O relógio. Injetado para o teste do disjuntor não esperar em tempo real. */
  agora?: () => number;
}

export class CacheEmCamadas implements Cache {
  readonly #rapida: Cache;
  readonly #duravel: Cache;
  readonly #aoFalhar: (operacao: string, erro: unknown) => void;
  readonly #tempoLimiteMs: number;
  readonly #pausaMs: number;
  readonly #agora: () => number;
  /** Até quando a camada durável está de fora. 0 = em serviço. */
  #pausadaAte = 0;

  constructor(opts: OpcoesEmCamadas) {
    this.#rapida = opts.rapida;
    this.#duravel = opts.duravel;
    this.#aoFalhar = opts.aoFalhar ?? ((): void => {});
    this.#tempoLimiteMs = opts.tempoLimiteMs ?? TEMPO_LIMITE_PADRAO_MS;
    this.#pausaMs = opts.pausaMs ?? PAUSA_PADRAO_MS;
    this.#agora = opts.agora ?? ((): number => Date.now());
  }

  /**
   * A camada durável está de fora agora?
   *
   * Sai em `GET /api/saude` pelo `nome` — um Redis configurado e pausado precisa ser
   * distinguível de um Redis configurado e servindo, senão a única pista de que ele
   * está fora é a linha de log que já passou.
   */
  get pausada(): boolean {
    return this.#agora() < this.#pausadaAte;
  }

  /**
   * Como as duas camadas aparecem em `GET /api/saude`.
   *
   * Com a durável de fora, o nome diz isso. Um Redis pausado que se anunciasse como
   * `MemoryCache+RedisCache` faria a saúde afirmar uma permanência que não existe —
   * e é justamente quando alguém está investigando lentidão que essa linha é lida.
   */
  get nome(): string {
    const durvel = `${this.#duravel.constructor.name}${this.pausada ? ' (pausado)' : ''}`;
    return `${this.#rapida.constructor.name}+${durvel}`;
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

  /**
   * Roda na camada durável engolindo a falha **e o tempo**. `undefined` = não deu.
   *
   * A promessa que estourou o teto continua correndo por baixo, e isso é de propósito:
   * abortá-la exigiria que todo adapter soubesse cancelar, e o que se ganharia é uma
   * escrita a menos num Redis lento. Ela não vira rejeição não tratada — o
   * `Promise.race` já pendurou um tratador nela, e ele continua valendo depois de a
   * corrida ter sido decidida.
   */
  async #tenta<T>(operacao: string, f: () => Promise<T>): Promise<T | undefined> {
    if (this.pausada) return undefined;

    let estouro: ReturnType<typeof setTimeout> | undefined;
    const teto = new Promise<typeof MARCA_DO_TETO>((resolve) => {
      estouro = setTimeout(() => resolve(MARCA_DO_TETO), this.#tempoLimiteMs);
      // `unref`: um teto pendente não é motivo para o processo continuar vivo.
      (estouro as { unref?: () => void }).unref?.();
    });

    try {
      const r = await Promise.race([f(), teto]);
      if (r === MARCA_DO_TETO) {
        this.#desliga(
          operacao,
          new Error(`a camada durável passou de ${this.#tempoLimiteMs} ms e foi tratada como miss.`),
        );
        return undefined;
      }
      // Deu certo: o disjuntor fecha. Um Redis que voltou não espera ninguém religá-lo.
      this.#pausadaAte = 0;
      return r as T;
    } catch (err) {
      this.#desliga(operacao, err);
      return undefined;
    } finally {
      if (estouro !== undefined) clearTimeout(estouro);
    }
  }

  /**
   * Põe a camada durável de fora pela pausa e anuncia a falha.
   *
   * **Anunciar sempre não vira enxurrada**, e é o disjuntor que garante isso: só se
   * chega aqui saindo de `#tenta`, e `#tenta` desiste antes quando a pausa está
   * aberta. O log fica limitado a uma linha por pausa sem nenhuma regra de supressão
   * — e regra de supressão de log é como uma falha some da vista.
   */
  #desliga(operacao: string, err: unknown): void {
    this.#pausadaAte = this.#agora() + this.#pausaMs;
    this.#aoFalhar(operacao, err);
  }
}

/** Sentinela do teto de tempo. Objeto próprio para não colidir com valor guardado. */
const MARCA_DO_TETO = Symbol('teto');

/**
 * Por quanto tempo uma entrada promovida do Redis fica na memória.
 *
 * Um dia. Não é prazo de validade — a chave já carrega carimbo e dia, então uma
 * entrada só é alcançável enquanto for verdadeira (ver `cache-resposta.ts`). É só um
 * teto para o processo não acumular para sempre o que leu de fora.
 */
const TTL_DA_PROMOCAO = 24 * 60 * 60;
