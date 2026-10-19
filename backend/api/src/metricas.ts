// Os contadores da API — o F0 do plano de near-realtime, embutido na F1 em vez
// de gastar um ciclo só para medir.
//
// **O que isto NÃO é.** Não é um sistema de métricas: não há Prometheus, não há
// série temporal, não há rótulo por usuário. É um punhado de números em memória,
// somados no caminho quente e lidos em `GET /api/saude` — o suficiente para que
// as decisões das fases seguintes (single-flight, prioridade de fila,
// reaquecimento) saiam de medida e não de opinião.
//
// **Resumo mais histograma de baldes fixos — e por que não a amostra.** Até a
// F2 aqui só havia `n/soma/max`, com o argumento de que um percentil exigiria
// guardar a amostra inteira, e guardar amostra por pedido num processo que já
// mede a memória em GB é o tipo de instrumento que vira o problema que veio
// medir. O argumento continua valendo contra a AMOSTRA; ele não vale contra um
// histograma de baldes fixos, que custa 18 inteiros por métrica, para sempre, e
// não aloca nada por observação.
//
// A F3 precisa de percentil porque a média esconde justamente o que a fila com
// prioridade existe para consertar. Duas filas com a mesma média de 8 s são
// coisas opostas: uma em que todo clique espera 8 s, e uma em que 95% dos
// cliques passam em 20 ms e um aquecimento espera 3 min. É a segunda que dá
// certo, e só o percentil separa as duas.
//
// **O percentil daqui é o TETO DO BALDE, não a amostra.** Ele erra para cima,
// nunca para baixo — um `p95Ms: 250` quer dizer "95% ficaram abaixo de 250 ms",
// e não "o percentil 95 é exatamente 250". Para decidir se `interactive` está
// passando na frente, isso basta; para publicar SLA, não bastaria, e é por isso
// que o nome do campo é `p95Ms` e este parágrafo existe.
//
// **Por que zerável.** Um contador que só cresce desde o boot responde "quanto
// aconteceu desde sempre", que não é a pergunta de quem está medindo uma
// mudança. `zera()` existe para o teste e para o operador que quer a conta de uma
// janela — nunca é chamado sozinho pelo servidor.
//
// REGRA DE SAÍDA: nenhum nome de métrica carrega valor de linha, id de cliente ou
// identidade. Página e origem do pedido, sim; dado, nunca.

/**
 * Os tetos dos baldes, em ms.
 *
 * A escala é grosseira de propósito e cobre sete ordens de grandeza porque as
 * durações desta API cobrem sete ordens de grandeza: uma espera de fila que dá
 * certo é de 1 ms, um cálculo frio é de 10–20 s, e um aquecimento em fila cheia
 * pode passar de 2 min. Uma escala linear precisaria de milhares de baldes para
 * dizer a mesma coisa.
 */
const TETOS_MS = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 120_000, 300_000,
] as const;

/** Um resumo barato: quantas vezes, quanto no total, o pior caso e a forma. */
export interface Resumo {
  n: number;
  somaMs: number;
  maxMs: number;
  /**
   * `TETOS_MS.length + 1` contadores — o último é o transbordo (acima do maior
   * teto). Alocado uma vez por métrica, nunca por observação.
   */
  baldes: number[];
}

/** Uma duração como ela sai em `GET /api/saude`. */
export interface DuracaoPublicada {
  n: number;
  mediaMs: number;
  maxMs: number;
  /** Teto do balde em que o percentil cai. Erra para cima, nunca para baixo. */
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

/** O instantâneo que sai em `GET /api/saude`. */
export interface InstantaneoDeMetricas {
  contadores: Record<string, number>;
  duracoes: Record<string, DuracaoPublicada>;
}

/** Em que balde uma duração cai. Varredura linear: 17 comparações, sem alocar. */
function balde(ms: number): number {
  for (let i = 0; i < TETOS_MS.length; i++) {
    if (ms <= TETOS_MS[i]!) return i;
  }
  return TETOS_MS.length;
}

/**
 * O teto do balde em que o percentil `p` cai.
 *
 * Transbordo devolve `maxMs`: dizer `Infinity` seria inútil, e dizer 300.000
 * seria mentira para baixo — justamente o erro que esta escala não pode cometer.
 */
function percentil(r: Resumo, p: number): number {
  if (r.n === 0) return 0;
  const max = Math.round(r.maxMs * 10) / 10;
  const alvo = Math.ceil((p / 100) * r.n);
  let acumulado = 0;
  for (let i = 0; i < r.baldes.length; i++) {
    acumulado += r.baldes[i]!;
    if (acumulado >= alvo) {
      // **O teto do balde, limitado pela maior observação real.** Sem o limite, a
      // primeira medição desta sonda saiu com `p95: 10000` e `max: 7467` — um
      // percentil maior que o máximo, que lê como instrumento quebrado e faz
      // desconfiar da tabela inteira. O limite continua sendo um teto honesto do
      // percentil verdadeiro: nenhuma observação passou de `max`, por definição.
      return i < TETOS_MS.length ? Math.min(TETOS_MS[i]!, max) : max;
    }
  }
  return max;
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
    let r = this.#duracoes.get(nome);
    if (r === undefined) {
      r = { n: 0, somaMs: 0, maxMs: 0, baldes: new Array<number>(TETOS_MS.length + 1).fill(0) };
      this.#duracoes.set(nome, r);
    }
    r.n += 1;
    r.somaMs += ms;
    if (ms > r.maxMs) r.maxMs = ms;
    r.baldes[balde(ms)]! += 1;
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

    const duracoes: Record<string, DuracaoPublicada> = {};
    for (const [k, r] of [...this.#duracoes].sort()) {
      duracoes[k] = {
        n: r.n,
        mediaMs: Math.round((r.somaMs / r.n) * 10) / 10,
        maxMs: Math.round(r.maxMs * 10) / 10,
        p50Ms: percentil(r, 50),
        p95Ms: percentil(r, 95),
        p99Ms: percentil(r, 99),
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
 * De onde veio um pedido de cálculo. Desde a F3 isto **decide** a ordem da fila
 * da piscina (`prioridadeDe`), e não só mede.
 *
 * A classificação é barata e não pode errar para o lado inseguro: o que não for
 * reconhecido como fundo é tratado como `interactive`, porque tratar um usuário
 * como warmup é o único erro dos três que alguém sente.
 */
export type OrigemDoPedido = 'interactive' | 'prefetch' | 'warmup' | 'export';

/** As classes, da mais urgente para a menos. Sem faixas intermediárias. */
export const ORIGENS: readonly OrigemDoPedido[] = ['interactive', 'prefetch', 'warmup', 'export'];

/**
 * A ordem da fila: menor número passa na frente.
 *
 * Três classes, sem peso, sem envelhecimento, sem cota. É deliberado — a decisão
 * com o Erick em 08/09/2026 foi **prioridade pura primeiro, medir, e só então
 * discutir fairness**. Inanição de `warmup` é um risco real, e a resposta a ele
 * é `fila_ms_warmup` no `p95`, não um mecanismo escrito antes de haver o número.
 */
export function prioridadeDe(origem: OrigemDoPedido): number {
  return ORIGENS.indexOf(origem);
}

/**
 * Quem está pedindo, pelo que o pedido declara.
 *
 * **A regra: um pedido pode REBAIXAR a si mesmo, nunca se promover.** `warmup`
 * sai do cabeçalho interno do Aquecedor — o mesmo que já o autentica
 * (`segredoAquecedor` em `servidor.ts`), então não há um segundo canal para
 * manter em dia. Fora dele, `?origem=` só é aceito para descer:
 * `prefetch` (o que o navegador põe no pedido de hover) e `warmup` (uma carga de
 * fundo qualquer, como a sonda `probe:prioridade-fila`). Qualquer outro valor, e
 * a ausência dele, é `interactive`.
 *
 * Aceitar rebaixamento auto-declarado é seguro porque o pior que um cliente
 * consegue fazer com ele é atrasar a si mesmo. A promoção é que teria de ser
 * defendida — e ela não existe: `interactive` já é o padrão de quem não declara
 * nada, então não há o que ganhar mentindo.
 */
export function origemDoPedido(ehAquecedor: boolean, origemNaUrl: string | null): OrigemDoPedido {
  if (ehAquecedor) return 'warmup';
  if (origemNaUrl === 'prefetch' || origemNaUrl === 'warmup' || origemNaUrl === 'export')
    return origemNaUrl;
  return 'interactive';
}
