// A fila de rematerialização do Change Ingestor — a peça que decide QUANDO rodar
// `npm run snapshot --query=`, não COMO.
//
// **Por que isto existe separado do consumer Kafka.** `ingestor.ts` fala com o
// broker; aqui só entra "esta query sujou" e sai "rode isto agora". A separação é a
// mesma de `medidor.ts`/`index.ts`: a parte com regra de negócio é testável sem
// broker nenhum.
//
// **As duas regras que valem dinheiro real, e por quê:**
//
// 1. **Nunca duas rematerializações ao mesmo tempo.** É a lição do `ACHADOS.md` §7:
//    dois `npm run paginas` de 8 GB brigando pela mesma máquina já custou uma manhã
//    inteira de medição perdida. Aqui o mesmo risco existe entre um Kafka barulhento
//    e uma rematerialização lenta — sem esta trava, cada evento tentaria abrir o seu
//    próprio processo pesado.
// 2. **Debounce, não uma rodada por evento.** Um `UPDATE` em lote no Voalle publica
//    uma mensagem por linha. Rematerializar a cada uma seria rematerializar 1.000
//    vezes o que uma vez já resolve. O debounce espera a rajada esfriar antes de
//    agir — e se uma rodada já está em andamento quando mais sujeira chega, ela
//    **não** é descartada: vira a próxima rodada, assim que a atual terminar.

/** O que a fila precisa para rodar uma rematerialização — injetado, nunca `spawn` direto aqui. */
export interface RodadorDeSnapshot {
  (queries: readonly string[]): Promise<{ ok: boolean; erro?: string }>;
}

export interface FilaOptions {
  /** Roda a rematerialização de fato. Em produção: spawna `npm run snapshot`. */
  roda: RodadorDeSnapshot;
  /** Silêncio exigido depois da última sujeira antes de rodar, em ms. */
  debounceMs: number;
  /** Injetável para teste: por padrão, `globalThis.setTimeout`. */
  agendador?: (fn: () => void, ms: number) => { cancelar: () => void };
  /** Chamado a cada rodada concluída — sucesso ou falha. Opcional, para log/teste. */
  aoConcluir?: (queries: readonly string[], resultado: { ok: boolean; erro?: string }) => void;
}

function agendadorPadrao(fn: () => void, ms: number): { cancelar: () => void } {
  const id = setTimeout(fn, ms);
  return { cancelar: () => clearTimeout(id) };
}

/**
 * Acumula queries sujas e roda `roda()` uma vez por rajada — nunca duas ao mesmo
 * tempo, nunca perdendo o que chegou durante uma rodada em andamento.
 */
export class FilaDeRematerializacao {
  readonly #roda: RodadorDeSnapshot;
  readonly #debounceMs: number;
  readonly #agendador: (fn: () => void, ms: number) => { cancelar: () => void };
  readonly #aoConcluir: FilaOptions['aoConcluir'];

  #sujas = new Set<string>();
  #rodando = false;
  #timer: { cancelar: () => void } | null = null;

  constructor(opts: FilaOptions) {
    this.#roda = opts.roda;
    this.#debounceMs = opts.debounceMs;
    this.#agendador = opts.agendador ?? agendadorPadrao;
    this.#aoConcluir = opts.aoConcluir;
  }

  /** `true` enquanto uma rematerialização está de fato rodando. */
  get rodando(): boolean {
    return this.#rodando;
  }

  /** As queries acumuladas e ainda não disparadas. */
  get pendentes(): readonly string[] {
    return [...this.#sujas].sort();
  }

  /**
   * Marca uma query como suja e (re)agenda a rodada.
   *
   * Chamar de novo antes do debounce vencer **adia** a rodada — é o que faz uma
   * rajada de 1.000 eventos em 2 s virar uma rodada só, não mil.
   */
  marcaSuja(query: string): void {
    this.#sujas.add(query);
    this.#reagenda();
  }

  #reagenda(): void {
    this.#timer?.cancelar();
    this.#timer = this.#agendador(() => {
      this.#timer = null;
      void this.#tentaRodar();
    }, this.#debounceMs);
  }

  async #tentaRodar(): Promise<void> {
    // Já tem uma rodando: não abre uma segunda. O que está em `#sujas` agora fica
    // esperando — quando a atual terminar, `#tentaRodar` roda de novo (mais embaixo)
    // e pega o que se acumulou nesse meio-tempo.
    if (this.#rodando || this.#sujas.size === 0) return;

    const ids = [...this.#sujas].sort();
    this.#sujas.clear();
    this.#rodando = true;

    // `roda()` é código de fora (em produção, um `spawn`) chamado de um laço que
    // ninguém aguarda (`void this.#tentaRodar()`). Uma rejeição que escapasse daqui
    // viraria unhandled rejection e derrubaria o processo inteiro — trocando "uma
    // rematerialização falhou" por "o ingestor parou de consumir Kafka até alguém
    // reiniciar". Por isso o `catch` é aqui dentro, não no chamador.
    let resultado: { ok: boolean; erro?: string };
    try {
      resultado = await this.#roda(ids);
    } catch (err) {
      resultado = { ok: false, erro: err instanceof Error ? err.message : String(err) };
    }

    this.#aoConcluir?.(ids, resultado);
    this.#rodando = false;
    // Sujeira chegou enquanto esta rodada rodava? Ela não passou por `marcaSuja` de
    // novo — o timer daquela chamada já disparou e morreu. Reagenda direto, sem
    // esperar debounce: já esperou o tempo da rodada inteira.
    if (this.#sujas.size > 0) void this.#tentaRodar();
  }
}
