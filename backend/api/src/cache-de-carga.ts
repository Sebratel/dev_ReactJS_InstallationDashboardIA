// O cache de datasets de UMA worker (`cacheDeCarga` em `worker-calculador.ts`), com a
// ordem de soltar e carregar que a memória do container exige.
//
// **O defeito que isto conserta, medido em 16/10/2026.** Depois de cada refresh (a cada
// 15–30 min) o container subia +1 GB em ~45 s. Um dos três mecanismos era a ORDEM da
// poda: `guardaNoCache` só tirava a entrada mais antiga DEPOIS de a carga nova já ter
// começado. Durante a carga a worker segurava o dataset vivo, o que estava montando e o
// descartado esperando o coletor — três datasets de 250 MB–1 GB, parte em `Int32Array`
// FORA do heap, onde o teto de 512 MB da worker (`maxOldGenerationSizeMb`) não alcança.
// E como ninguém chamava o coletor nas workers, o descartado ficava até o V8 decidir por
// conta própria — e o V8 decide pelo heap, que nessa conta é a parte pequena.
//
// Agora: (1) poda ANTES de carregar, para a carga nova caber no teto junto com o que
// fica; (2) o coletor roda logo depois de um descarte, antes da carga, para a memória do
// descartado voltar antes de a do novo ser pedida; (3) nunca descarta um dataset que um
// cálculo em curso está lendo (ver `#emUso`).
//
// **Por que um módulo à parte, e não mais três funções soltas na worker.** A worker só
// roda dentro de uma `Worker` com snapshot em disco, e "nunca três vivos" é uma afirmação
// sobre ORDEM (o que estava no mapa no instante em que a carga começou), que só se testa
// direito com uma carga de mentira. Aqui ela é um parâmetro; ver
// `test/cache-de-carga.test.ts`.

export interface OpcoesDoCacheDeCarga {
  /** Quantos datasets ficam guardados ao mesmo tempo. Ver `TETO_CACHE_POR_WORKER`. */
  teto: number;
  /**
   * Chamada depois de um descarte, quando nenhum cálculo está lendo dataset nenhum —
   * na worker, o `gc()` do V8 (ver `coletorDaWorker`). Ausente = não coleta, que é o
   * comportamento de antes: o descartado sai quando o V8 quiser.
   */
  coleta?: () => void;
}

/** O que `usa` devolve: a promessa do dataset e a obrigação de soltá-la. */
export interface UsoDoDataset<T> {
  promessa: Promise<T>;
  /** `true` quando ESTE pedido iniciou a carga (o cache errou). */
  nova: boolean;
  /**
   * Avisa que o cálculo terminou de ler o dataset. **Tem de ser chamada exatamente uma
   * vez**, num `finally`: enquanto não for, o dataset não é podado pelo teto e o coletor
   * adiado não roda. Chamar de novo não faz nada.
   */
  solta: () => void;
}

export class CacheDeCarga<T> {
  readonly #teto: number;
  readonly #coleta: (() => void) | null;
  /** Ordem de inserção = ordem de poda; regravar reinsere no fim. */
  readonly #entradas = new Map<string, Promise<T>>();
  /**
   * Quantos cálculos em curso estão lendo cada dataset — pela PROMESSA, não pela chave.
   *
   * **Por que a promessa.** Uma invalidação (`esquece`) tira a chave do mapa mesmo com o
   * dataset em uso — é o certo: ninguém mais pode pegar carona num dado velho —, e o
   * pedido seguinte pode gravar uma promessa NOVA sob a MESMA chave. Contando por chave,
   * soltar o uso da velha baixaria a contagem da nova.
   *
   * **Por que não podar o que está em uso.** Tirar do mapa não solta a memória — o
   * cálculo em curso ainda segura a referência —, mas faz o PRÓXIMO pedido da mesma
   * página carregar outra cópia enquanto a primeira ainda está viva: exatamente os três
   * datasets que esta peça existe para evitar.
   */
  readonly #emUso = new Map<Promise<T>, number>();
  /** Houve descarte desde a última coleta? O coletor só roda quando há o que colher. */
  #coletaPendente = false;

  constructor(opts: OpcoesDoCacheDeCarga) {
    this.#teto = Math.max(1, opts.teto);
    this.#coleta = opts.coleta ?? null;
  }

  /** Quantos datasets o mapa guarda (a medida `datasets` da saúde). */
  get tamanho(): number {
    return this.#entradas.size;
  }

  /** As chaves guardadas, da mais antiga para a mais nova. */
  chaves(): string[] {
    return [...this.#entradas.keys()];
  }

  /** Quantos cálculos estão lendo dataset agora. */
  get emUso(): number {
    let n = 0;
    for (const c of this.#emUso.values()) n += c;
    return n;
  }

  /**
   * O dataset desta chave — o guardado, ou um novo, carregado por `carrega`.
   *
   * **A ordem no erro do cache é a correção inteira:** primeiro abre espaço (poda até
   * `teto - 1`), depois coleta o que foi descartado, e SÓ ENTÃO chama `carrega`. A ordem
   * antiga (carrega, grava, poda) segurava o descartado durante toda a carga.
   */
  usa(chave: string, carrega: () => Promise<T>): UsoDoDataset<T> {
    let promessa = this.#entradas.get(chave);
    let nova = false;
    if (!promessa) {
      this.#podaAte(this.#teto - 1);
      this.#coletaSeLivre();
      promessa = carrega();
      nova = true;
      this.#entradas.set(chave, promessa);
      const esta = promessa;
      // Falhou? Não fica preso — a próxima mensagem tenta carregar de novo, em vez de
      // repetir o mesmo erro (ou um erro de disco já sanado) para sempre. Só apaga se a
      // chave ainda for DESTA promessa: uma invalidação no meio pode já ter posto outra.
      esta.catch(() => {
        if (this.#entradas.get(chave) === esta) this.#entradas.delete(chave);
      });
    }
    const p = promessa;
    this.#emUso.set(p, (this.#emUso.get(p) ?? 0) + 1);
    let solto = false;
    return {
      promessa: p,
      nova,
      solta: () => {
        if (solto) return;
        solto = true;
        const resta = (this.#emUso.get(p) ?? 1) - 1;
        if (resta > 0) this.#emUso.set(p, resta);
        else this.#emUso.delete(p);
        // O que não pôde ser podado por estar em uso sai agora, e o que foi descartado
        // durante o cálculo (uma invalidação no meio) é colhido agora.
        this.#podaAte(this.#teto);
        this.#coletaSeLivre();
      },
    };
  }

  /**
   * Tira do cache toda chave que `cai` aceitar — a invalidação (o poller viu a tabela
   * mudar, o refresh trocou a identidade da página). Tira MESMO se estiver em uso: o dado
   * ficou velho e ninguém mais pode pegar carona nele. A memória dele só volta quando o
   * cálculo em curso soltar; aí o coletor roda (ver `solta`).
   *
   * Devolve quantas entradas saíram.
   */
  esquece(cai: (chave: string) => boolean): number {
    let n = 0;
    for (const chave of [...this.#entradas.keys()]) {
      if (!cai(chave)) continue;
      this.#entradas.delete(chave);
      n += 1;
    }
    if (n > 0) {
      this.#coletaPendente = true;
      this.#coletaSeLivre();
    }
    return n;
  }

  /** Poda a mais antiga que ninguém está lendo, até sobrarem `limite` entradas. */
  #podaAte(limite: number): void {
    for (const [chave, p] of this.#entradas) {
      if (this.#entradas.size <= limite) break;
      if (this.#emUso.has(p)) continue;
      this.#entradas.delete(chave);
      this.#coletaPendente = true;
    }
  }

  /**
   * Roda o coletor se houve descarte E nenhum cálculo está lendo dataset.
   *
   * **Por que esperar ninguém estar lendo.** O `gc()` é síncrono e para esta worker
   * inteira; no meio de um cálculo ele só atrasaria a resposta e, pior, não colheria o
   * dataset que o próprio cálculo ainda segura. Na worker, que faz uma tarefa por vez,
   * "ninguém lendo" é o intervalo entre duas tarefas — ou o instante antes da carga.
   *
   * **Por que não a cada pedido.** Um `gc()` completo custa dezenas de ms; um pedido que
   * acerta o cache custa menos que isso. Só um descarte paga a coleta.
   */
  #coletaSeLivre(): void {
    if (!this.#coletaPendente || this.#emUso.size > 0 || this.#coleta === null) return;
    this.#coletaPendente = false;
    this.#coleta();
  }
}

/**
 * O `gc()` desta thread, se o processo foi iniciado com `--expose-gc` — ou `null`.
 *
 * **Não dá para ligar a flag só na worker.** `new Worker(..., { execArgv: ['--expose-gc'] })`
 * lança `ERR_WORKER_INVALID_EXEC_ARGV` (Node 24, medido em 16/10/2026): opção do V8 não é
 * aceita por worker. Mas as flags do V8 valem para o PROCESSO, e o contexto da worker já
 * nasce com `globalThis.gc` quando o processo foi iniciado com `--expose-gc` — que é o
 * `CMD` do `Dockerfile`. Medido no mesmo dia, worker com 400 MB em `Int32Array` soltos:
 * sem `gc()` continuavam 400 MB em `arrayBuffers`; com ele, 0, em 3 ms.
 *
 * Sem a flag (`npm start`, teste) devolve `null` e nada muda: o descartado sai quando o
 * V8 quiser, como antes. Ligar a flag por dentro (`v8.setFlagsFromString`) foi
 * descartado de propósito: a documentação do Node diz que mudar flag com a VM rodando
 * tem comportamento indefinido, e a flag mudaria para o processo inteiro.
 */
export function coletorDaWorker(): (() => void) | null {
  const gc = (globalThis as { gc?: () => void }).gc;
  return typeof gc === 'function' ? () => gc() : null;
}
