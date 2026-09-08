// Os contadores da API — o F0 do plano de near-realtime, embutido na F1 em vez
// de gastar um ciclo só para medir.
//
// **O que isto NÃO é.** Não é um sistema de métricas: não há Prometheus, não há
// série temporal, não há rótulo por usuário. É um punhado de números em memória,
// somados no caminho quente e lidos em `GET /api/saude` — o suficiente para que
// as decisões das fases seguintes (single-flight, prioridade de fila,
// reaquecimento) saiam de medida e não de opinião.
//
// **Por que resumo e não histograma.** `n/soma/max` responde "quanto custa em
// média e qual foi o pior" com três números e nenhuma alocação por observação. Um
// percentil exigiria guardar a amostra inteira, e guardar amostra por pedido num
// processo que já mede a memória em GB é exatamente o tipo de instrumento que
// vira o problema que ele veio medir.
//
// **Por que zerável.** Um contador que só cresce desde o boot responde "quanto
// aconteceu desde sempre", que não é a pergunta de quem está medindo uma
// mudança. `zera()` existe para o teste e para o operador que quer a conta de uma
// janela — nunca é chamado sozinho pelo servidor.
//
// REGRA DE SAÍDA: nenhum nome de métrica carrega valor de linha, id de cliente ou
// identidade. Página e origem do pedido, sim; dado, nunca.

/** Um resumo barato: quantas vezes, quanto no total, e o pior caso. */
export interface Resumo {
  n: number;
  somaMs: number;
  maxMs: number;
}

/** O instantâneo que sai em `GET /api/saude`. */
export interface InstantaneoDeMetricas {
  contadores: Record<string, number>;
  duracoes: Record<string, { n: number; mediaMs: number; maxMs: number }>;
}

export class Metricas {
  readonly #contadores = new Map<string, number>();
  readonly #duracoes = new Map<string, Resumo>();

  /** Soma `quanto` (padrão 1) ao contador `nome`. */
  conta(nome: string, quanto = 1): void {
    this.#contadores.set(nome, (this.#contadores.get(nome) ?? 0) + quanto);
  }

  /**
   * Registra uma duração em ms. O nome é do EVENTO, não do pedido — `worker_ms`,
   * não `worker_ms_do_pedido_37`: um nome por pedido faria o mapa crescer sem
   * teto, que é o modo clássico de uma métrica virar vazamento.
   */
  observa(nome: string, ms: number): void {
    const r = this.#duracoes.get(nome);
    if (r === undefined) {
      this.#duracoes.set(nome, { n: 1, somaMs: ms, maxMs: ms });
      return;
    }
    r.n += 1;
    r.somaMs += ms;
    if (ms > r.maxMs) r.maxMs = ms;
  }

  /**
   * Guarda `valor` só se ele for o maior já visto — a "marca d'água" de um
   * número que sobe e desce (profundidade de fila, pedidos concorrentes na mesma
   * chave). Ler o valor instantâneo em `/api/saude` quase sempre pegaria zero: o
   * pico dura o tempo de um cálculo, e ninguém está olhando naquele instante.
   */
  maximo(nome: string, valor: number): void {
    if (valor > (this.#contadores.get(nome) ?? 0)) this.#contadores.set(nome, valor);
  }

  instantaneo(): InstantaneoDeMetricas {
    const contadores: Record<string, number> = {};
    for (const [k, v] of [...this.#contadores].sort()) contadores[k] = v;

    const duracoes: Record<string, { n: number; mediaMs: number; maxMs: number }> = {};
    for (const [k, r] of [...this.#duracoes].sort()) {
      duracoes[k] = {
        n: r.n,
        mediaMs: Math.round((r.somaMs / r.n) * 10) / 10,
        maxMs: Math.round(r.maxMs * 10) / 10,
      };
    }
    return { contadores, duracoes };
  }

  zera(): void {
    this.#contadores.clear();
    this.#duracoes.clear();
  }
}

/**
 * De onde veio um pedido de cálculo. **Só classifica; ainda não decide nada** — a
 * fila da piscina continua FIFO nesta fase, e é de propósito: sem o número de
 * quanto trabalho de fundo disputa a vez com o usuário, escolher uma política de
 * prioridade seria escolher pelo palpite.
 *
 * A classificação em si é barata e não pode errar para o lado inseguro: o que
 * não for reconhecido como fundo é tratado como `interactive`, porque tratar um
 * usuário como warmup é o único erro dos três que alguém sente.
 */
export type OrigemDoPedido = 'interactive' | 'prefetch' | 'warmup';

/**
 * Quem está pedindo, pelo que o pedido declara.
 *
 * `warmup` sai do cabeçalho interno do Aquecedor — o mesmo que já o autentica
 * (`segredoAquecedor` em `servidor.ts`), então não há um segundo canal para
 * manter em dia. `prefetch` sai de `?origem=prefetch`, que o navegador põe no
 * pedido de hover; qualquer outro valor, e a ausência dele, é `interactive`.
 */
export function origemDoPedido(ehAquecedor: boolean, origemNaUrl: string | null): OrigemDoPedido {
  if (ehAquecedor) return 'warmup';
  if (origemNaUrl === 'prefetch') return 'prefetch';
  return 'interactive';
}
