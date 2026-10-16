// Os tetos do que a API guarda em memória por tempo indeterminado.
//
// **O defeito (medido em 16/10/2026).** A API — contêiner de 3 GB, processo principal
// com heap de 1.536 MB — chegou ao teto de memória. Dois culpados eram `Map`s sem
// limite que só crescem com o uso:
//
//   1. o cache de respostas prontas (`MemoryCache`, na frente do Redis ou sozinho):
//      cada combinação página × filtro × janela × busca é uma entrada, e cada virada
//      de carimbo (refresh a cada ~15 min) deixa a geração anterior inalcançável mas
//      PRESA — retenção de 7 dias (`RETENCAO_PADRAO`), e entrada vencida só saía num
//      `get` da mesma chave, que ninguém mais faz. Estimativa: 0,5–1,5 GB/dia com 10
//      usuários;
//   2. `cacheValoresDistintos` (`servidor.ts`): a lista de valores de cada
//      segmentação, com carimbo e dia na chave, até 5.000 valores por lista.
//
// Nos dois casos o conserto é o mesmo: LRU com teto. O que é usado fica; o que
// sobrou de um carimbo velho sai primeiro, porque é justamente o que ninguém lê.

import { MemoryCache } from '../../packages/query-engine/src/cache-memory.ts';
import { systemClock, type Clock } from '../../packages/query-engine/src/types.ts';
import { estimaBytes } from './cache-visual.ts';

/**
 * Teto padrão da camada em memória do cache de respostas, em MB estimados.
 *
 * **De onde sai o número.** O heap do processo principal é 1.536 MB, e dele já saem
 * `CACHE_VISUAL_MB` (256 MB no `docker-compose.prod.yml`) e os datasets carregados.
 * 256 MB é ~1/6 do heap. E é MB *estimado*: `estimaBytes` conta pelo lado caro (2
 * bytes por caractere, 16 de cabeçalho por objeto) e a resposta gravada em duas
 * chaves conta duas vezes, então a memória real fica abaixo disso. Uma resposta de
 * página tem dezenas a centenas de KB, então cabem de centenas a milhares delas — o
 * suficiente para todas as páginas de todos os usuários do carimbo atual.
 *
 * **Com Redis, despejar daqui é barato.** A entrada que sai da memória continua no
 * Redis (`CacheEmCamadas` escreve nas duas camadas): o próximo pedido dela paga uma
 * ida ao Redis e um `JSON.parse`, não um recálculo. Sem Redis (o `npm run api`
 * local), despejar é recalcular — e ainda assim é melhor que a API morrer por falta
 * de memória e recalcular TUDO no arranque.
 */
export const TETO_RESPOSTA_PADRAO_MB = 256;

/**
 * Quantas listas de valores de segmentação guardar.
 *
 * Uma página tem por volta de 10 segmentações (`agendamento-field`), e são 14
 * páginas: ~140 listas por carimbo×dia. 500 cobre o carimbo atual inteiro com folga
 * e ainda guarda os vizinhos; a pior lista tem 5.000 valores (`VALORES_MAXIMO`), e a
 * típica, dezenas. Teto por CONTAGEM e não por bytes porque a lista é pequena e
 * medir cada uma custaria mais que o risco que isso cobre.
 */
export const TETO_VALORES_PADRAO = 500;

/**
 * Lê `CACHE_RESPOSTA_MB`. Ausente, ilegível ou não positivo → o padrão.
 *
 * **Zero não desliga, ao contrário de `CACHE_VISUAL_MB`.** Desligar o cache de
 * resposta faria TODO pedido recalcular a página — não é uma saída de emergência,
 * é a tela inteira lenta. E "zero = sem teto" seria o oposto do que o mesmo zero
 * quer dizer na variável vizinha: armadilha para quem configura. Por isso o valor
 * inválido não vira nenhum dos dois, vira o padrão, com um `aviso` para o log dizer
 * que o que foi escrito não valeu.
 */
export function leTetoDaResposta(bruto: string | undefined): { mb: number; aviso?: string } {
  if (bruto === undefined || bruto.trim() === '') return { mb: TETO_RESPOSTA_PADRAO_MB };
  const mb = Number(bruto);
  if (Number.isFinite(mb) && mb > 0) return { mb };
  return {
    mb: TETO_RESPOSTA_PADRAO_MB,
    aviso: `CACHE_RESPOSTA_MB=${JSON.stringify(bruto)} não é um número positivo; usando ${TETO_RESPOSTA_PADRAO_MB} MB.`,
  };
}

/**
 * A camada em memória do cache de respostas, já com teto. Usada nas DUAS montagens:
 * na frente do Redis (`index.ts`) e sozinha, quando não há Redis (`servidor.ts`).
 * Um lugar só para que as duas não divirjam no medidor nem no teto.
 */
export function memoriaDaResposta(tetoMB: number, clock: Clock = systemClock): MemoryCache {
  return new MemoryCache(clock, {
    tetoBytes: tetoMB * 1024 * 1024,
    tamanhoDe: estimaBytes,
  });
}

/**
 * Um `Map` que esquece o menos usado quando passa de `teto` entradas.
 *
 * É subclasse de `Map` de propósito: `cacheValoresDistintos` é lido com `get`,
 * gravado com `set` e podado por página com `keys()`/`delete` (`esqueceAPagina`), e
 * com a mesma interface nenhum desses pontos — nem a coalescência de
 * `valoresEmCurso`, que é outro mapa — precisa mudar.
 *
 * Não aceita entradas no construtor: o `Map` chamaria `set` antes de `#teto`
 * existir.
 */
export class MapaLru<K, V> extends Map<K, V> {
  readonly #teto: number;

  constructor(teto: number) {
    super();
    this.#teto = teto;
  }

  get(chave: K): V | undefined {
    if (!super.has(chave)) return undefined;
    const valor = super.get(chave) as V;
    // Reinsere no fim: a ordem de inserção é a ordem de uso.
    super.delete(chave);
    super.set(chave, valor);
    return valor;
  }

  set(chave: K, valor: V): this {
    super.delete(chave);
    super.set(chave, valor);
    while (this.size > this.#teto) {
      const primeira = super.keys().next();
      if (primeira.done) break;
      super.delete(primeira.value);
    }
    return this;
  }

  get teto(): number {
    return this.#teto;
  }
}
