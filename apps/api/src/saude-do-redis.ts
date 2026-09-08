// O estado da camada durável do cache, para `GET /api/saude`.
//
// **O contrato que isto torna verificável.** O repositório promete, em três
// lugares diferentes (`index.ts`, `cache-camadas.ts`, `cache-resposta.ts`), que
// Redis fora do ar é *degradação* — vira miss, a memória continua servindo, a
// API continua respondendo. Até 08/09/2026 essa promessa era falsa de um jeito
// espetacular: o `ioredis` emitia `'error'` num `EventEmitter` sem ouvinte e o
// Node matava o processo.
//
//     [ioredis] Unhandled error event: AggregateError [ECONNREFUSED]
//
// O ouvinte consertou a morte. Mas restava a metade silenciosa do mesmo
// problema: com o Redis fora, `GET /api/saude` continuava respondendo
// `adapter: "MemoryCache+RedisCache"` — o nome do arranjo montado na subida, não
// o estado dele agora. Uma API degradada parecia saudável, e a única maneira de
// descobrir era notar que os tempos tinham piorado depois de um restart.
//
// **Por que "degradado" não pode derrubar o healthcheck.** O
// `docker-compose.prod.yml` testa `fetch(...).then(r => r.ok ? 0 : 1)` — o
// status HTTP. Se um Redis inacessível virasse 503 aqui, o Docker reiniciaria a
// API em laço por causa de um cache OPCIONAL, transformando uma degradação
// prevista numa indisponibilidade real. A saúde continua 200; quem lê é que
// enxerga a diferença. `saude-do-redis.test.ts` guarda isso.

/**
 * - `ausente`: não há `REDIS_URL`. Só memória, e está certo assim.
 * - `ocioso`: configurado e ainda sem conexão. É o normal logo depois da
 *   subida, porque `lazyConnect` só abre a conexão na primeira operação.
 * - `ok`: conectado, sem falha desde então.
 * - `degradado`: falhou. A memória continua servindo.
 */
export type StatusDoRedis = 'ausente' | 'ocioso' | 'ok' | 'degradado';

export interface EstadoDoRedis {
  status: StatusDoRedis;
  /**
   * Falhas acumuladas desde a subida — **não** zera quando o Redis volta.
   *
   * É o número que distingue "caiu uma vez às 3h" de "está piscando": um
   * `status: "ok"` com 4.000 falhas é uma conexão instável, e o instantâneo
   * sozinho nunca contaria isso.
   */
  falhas: number;
  /** Desde quando está neste status. */
  desde?: string;
  /** A última falha, em texto. Sem credencial — ver `semSegredo()`. */
  ultimoErro?: string;
  /** Em que operação ela apareceu: `conexão`, `get`, `set`, `del`, `keys`… */
  ultimaOperacao?: string;
}

/**
 * Tira do texto qualquer `redis://usuario:senha@host` antes de ele sair pela
 * saúde.
 *
 * `/api/saude` fica **fora** da guarda de sessão de propósito (é o healthcheck
 * do container que bate nela), então tudo que sai por aqui é público para quem
 * alcança a porta. As mensagens do `ioredis` normalmente trazem só
 * `ECONNREFUSED host:porta`, mas as de autenticação e as de configuração podem
 * ecoar a URL inteira — e a URL inteira tem a senha.
 */
export function semSegredo(texto: string): string {
  return texto.replace(/(redis(?:s)?:\/\/)[^@\s/]*@/gi, '$1***@');
}

export class SaudeDoRedis {
  #status: StatusDoRedis = 'ocioso';
  #falhas = 0;
  #desde: Date;
  #ultimoErro: string | undefined;
  #ultimaOperacao: string | undefined;
  readonly #agora: () => Date;

  constructor(agora: () => Date = () => new Date()) {
    this.#agora = agora;
    this.#desde = agora();
  }

  /**
   * O `'ready'` do driver. Devolve `true` se isto foi uma MUDANÇA de estado —
   * é o que permite a `index.ts` logar "voltou" sem repetir a linha a cada
   * reconexão bem-sucedida de um Redis que está piscando.
   */
  conectou(): boolean {
    if (this.#status === 'ok') return false;
    this.#status = 'ok';
    this.#desde = this.#agora();
    return true;
  }

  /**
   * Uma falha da camada durável. Chega por dois caminhos, e os dois importam:
   * o `'error'` do driver (a conexão) e o `aoFalhar` de `CacheEmCamadas` (a
   * operação). Só o primeiro seria pouco — um Redis que aceita conexão e recusa
   * comando não emite `'error'` nenhum, e é uma falha igual do ponto de vista
   * de quem esperava cache.
   */
  falhou(operacao: string, erro: unknown): boolean {
    this.#falhas++;
    this.#ultimoErro = semSegredo(erro instanceof Error ? erro.message : String(erro));
    this.#ultimaOperacao = operacao;
    if (this.#status === 'degradado') return false;
    this.#status = 'degradado';
    this.#desde = this.#agora();
    return true;
  }

  estado(): EstadoDoRedis {
    return {
      status: this.#status,
      falhas: this.#falhas,
      desde: this.#desde.toISOString(),
      ...(this.#ultimoErro !== undefined ? { ultimoErro: this.#ultimoErro } : {}),
      ...(this.#ultimaOperacao !== undefined ? { ultimaOperacao: this.#ultimaOperacao } : {}),
    };
  }
}

/**
 * O que a saúde diz quando não há `REDIS_URL` nenhuma.
 *
 * É uma função e não uma constante porque o objeto sai no corpo de um JSON: uma
 * constante compartilhada convidaria alguém a mutá-la um dia, e a mutação
 * valeria para todas as respostas seguintes.
 */
export function redisAusente(): EstadoDoRedis {
  return { status: 'ausente', falhas: 0 };
}
