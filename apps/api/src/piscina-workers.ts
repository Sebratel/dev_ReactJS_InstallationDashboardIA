// Gerenciador de Piscina de Worker Threads para computação paralela de DAX.

import { Worker } from 'node:worker_threads';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MensagemCalculoWorker, RespostaCalculoWorker } from './worker-calculador.ts';

export interface OpcoesPiscina {
  /** Quantas workers manter na piscina. Padrão: `configuracaoDaPiscina`. */
  tamanhoPool?: number;
  /** Teto de heap velho por worker, em MB. Padrão: `configuracaoDaPiscina`. */
  heapPorWorkerMB?: number;
  /** Forçar desativação (fallback síncrono para testes unitários). */
  desativado?: boolean;
  /**
   * Qual script as workers rodam. Padrão: `worker-calculador.ts`, ao lado deste
   * arquivo — produção nunca passa isto.
   *
   * **Existe porque o ciclo de vida não é testável sem ele.** O que precisa de
   * guarda aqui é o que acontece quando uma worker MORRE com tarefa em curso
   * (`exit`/`error`), e com o calculador de verdade isso só é reproduzível
   * matando o processo no meio de um cálculo de 10–20 s sobre um snapshot real
   * — que nenhum teste de unidade vai fazer. Com este ponto de entrada, o teste
   * sobe uma worker de duas linhas que morre na primeira mensagem, e a
   * afirmação passa a ser sobre a piscina, não sobre o cálculo.
   */
  scriptDaWorker?: string;
}

/**
 * O teto de heap de uma worker thread NÃO é limitado pelo
 * `--max-old-space-size` do processo pai: cada worker carrega o seu próprio
 * `resourceLimits`. Com o padrão anterior — 4 workers fixas em 8192 MB, sob um
 * pai de 10240 MB no Dockerfile — o processo estava autorizado a pedir **42 GB**
 * numa máquina de 16. Não era um vazamento; era uma licença.
 *
 * Estes dois números são o contrato de memória da API, e a razão de estarem
 * aqui (e não espalhados em `new Worker`) é que `mem_limit` do compose precisa
 * ser derivado deles. Ver `docs/PLANO-DUPLA.md` A1.
 */
/**
 * 768 MB por worker, e o número saiu de bisseção, não de gosto.
 *
 * `npm run probe:memoria-api` sobe a API com o par (workers, heap), pede as 10
 * páginas do menu uma a uma e anota o que quebra. Medido em 04/09/2026, com o
 * pai em 3072 MB:
 *
 *     2w × 512 MB .... 10/10 páginas, RSS pico 3528 MB
 *     2w × 1024 MB ... 10/10 páginas, RSS pico 3622 MB
 *     2w × 1536 MB ... 10/10 páginas, RSS pico 3467 MB
 *     2w × 2048 MB ... 10/10 páginas, RSS pico 3137 MB
 *
 * O achado que isto derruba: **o teto da worker não era o que consumia a
 * memória.** Com 512 MB por worker (16× menos que os 8192 de antes) o RSS quase
 * não se move — porque o que domina é o heap do PROCESSO PAI, não a piscina. Os
 * "6,6 GB de heap de worker" do achado anterior eram heap AUTORIZADO e não
 * coletado, não heap necessário.
 *
 * 512 MB já serve; 768 é isso com 50% de folga para uma página futura mais
 * pesada. Não vale subir mais: acima de 512 o ganho medido é zero e o custo é
 * autorizar RAM que o host do Portainer não tem para dar.
 */
export const PADRAO_HEAP_POR_WORKER_MB = 768;

/**
 * 2 workers, não `min(4, cpus)`.
 *
 * 4 workers numa máquina de 16 vCPU autorizavam 4 × 8192 = 32 GB. A piscina
 * existe porque página fria custa 10–20 s e com uma thread só nada mais é
 * servido nesse tempo — 2 já dá concorrência de duas páginas frias ao mesmo
 * tempo, que é o caso real de dois usuários abrindo telas diferentes. Subir
 * para 4 multiplica o heap autorizado por 2 para atender um terceiro
 * simultâneo que ninguém mediu existir.
 *
 * Quem opera muda com `API_WORKERS` sem tocar código — mas tem de mexer no
 * `mem_limit` no mesmo commit, e o teste `piscina-workers.test.ts` falha se
 * esquecer.
 */
export const PADRAO_TAMANHO_POOL = 2;

/**
 * Resolve o par (nº de workers, heap por worker) a partir do ambiente.
 *
 * Função pura de propósito: é ela que o teste exercita, para que o teto nunca
 * volte a ser um literal escondido dentro do laço que cria as workers.
 */
export function configuracaoDaPiscina(
  env: Record<string, string | undefined> = process.env,
  cpus: number = os.cpus().length,
): { tamanhoPool: number; heapPorWorkerMB: number } {
  const inteiroPositivo = (bruto: string | undefined): number | undefined => {
    if (bruto === undefined || bruto.trim() === '') return undefined;
    const n = Number.parseInt(bruto, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  return {
    tamanhoPool: Math.max(
      1,
      Math.min(inteiroPositivo(env.API_WORKERS) ?? PADRAO_TAMANHO_POOL, cpus),
    ),
    heapPorWorkerMB: inteiroPositivo(env.API_WORKER_HEAP_MB) ?? PADRAO_HEAP_POR_WORKER_MB,
  };
}

interface TarefaPendente {
  msg: MensagemCalculoWorker;
  resolve: (res: RespostaCalculoWorker) => void;
  reject: (erro: Error) => void;
  /** Menor passa na frente. Ver `prioridadeDe` em `metricas.ts`. */
  prioridade: number;
  /** Quando entrou na fila — o começo de `esperaMs`. */
  enfileiradaEm: number;
  /** Quando foi despachada para a worker — o fim de `esperaMs`. */
  despachadaEm: number;
}

/** O que `medeCom()` recebe quando uma tarefa termina (bem ou mal). */
export interface MedidaDaTarefa {
  prioridade: number;
  /** Da entrada na fila ao `postMessage`. É o número que a F3 existe para baixar. */
  esperaMs: number;
  /** Do `postMessage` à resposta da worker. Não muda com prioridade nenhuma. */
  execucaoMs: number;
}

/**
 * Uma fila por classe de prioridade, FIFO dentro de cada uma.
 *
 * **Três arrays e não um array ordenado**, porque a ordenação por inserção num
 * array único é O(n) por tarefa e — pior — é fácil de escrever de um jeito que
 * perde o FIFO dentro da classe. Com uma fila por classe, o desempate por ordem
 * de chegada é a própria estrutura, não uma comparação que alguém pode trocar.
 *
 * Ela é exportada para poder ser testada sem subir worker nenhuma: a política de
 * ordenação é a coisa que a F3 entrega, e ela não pode depender de um teste que
 * precisa de duas threads e um snapshot para rodar.
 */
/** `interactive`, `prefetch`, `warmup` — ver `ORIGENS` em `metricas.ts`. */
export const CLASSES_DE_PRIORIDADE = 3;

export class FilaDePrioridade<T extends { prioridade: number }> {
  readonly #filas: T[][];

  constructor(classes: number) {
    this.#filas = Array.from({ length: classes }, () => []);
  }

  /** Fora da faixa cai na classe menos urgente — nunca na mais. */
  entra(item: T): void {
    const i = Math.min(Math.max(item.prioridade, 0), this.#filas.length - 1);
    this.#filas[i]!.push(item);
  }

  /** O próximo a rodar: a classe mais urgente que tiver alguém, e o mais antigo dela. */
  sai(): T | undefined {
    for (const fila of this.#filas) {
      if (fila.length > 0) return fila.shift();
    }
    return undefined;
  }

  get tamanho(): number {
    let n = 0;
    for (const fila of this.#filas) n += fila.length;
    return n;
  }

  /** Quantos esperam em cada classe. Sai em `GET /api/saude`. */
  porClasse(): number[] {
    return this.#filas.map((f) => f.length);
  }

  /** Esvazia e devolve tudo, da classe mais urgente para a menos. */
  drena(): T[] {
    const todos: T[] = [];
    for (const fila of this.#filas) todos.push(...fila.splice(0, fila.length));
    return todos;
  }
}

export class PiscinaWorkers {
  private readonly workers: Worker[] = [];
  private readonly livres: Worker[] = [];
  private readonly tarefas = new FilaDePrioridade<TarefaPendente>(CLASSES_DE_PRIORIDADE);
  private readonly pendentesPorWorker = new Map<Worker, TarefaPendente>();
  private readonly desativado: boolean;
  private contadorReq = 0;
  /** Ver `medeCom()`. Padrão: ninguém medindo, custo zero. */
  private medidor: ((m: MedidaDaTarefa) => void) | null = null;

  constructor(opts: OpcoesPiscina = {}) {
    this.desativado = opts.desativado ?? false;

    if (this.desativado) return;

    const padrao = configuracaoDaPiscina();
    const numWorkers = opts.tamanhoPool ?? padrao.tamanhoPool;
    const heapPorWorkerMB = opts.heapPorWorkerMB ?? padrao.heapPorWorkerMB;
    const workerScript =
      opts.scriptDaWorker ??
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'worker-calculador.ts');

    const ALLOWED_FLAGS = [
      '--import',
      '--loader',
      '--experimental-',
      '--no-warnings',
      '--preserve-symlinks',
      '--conditions',
    ];
    const execArgvValidos = process.execArgv.filter((arg) =>
      ALLOWED_FLAGS.some((prefix) => arg.startsWith(prefix)),
    );

    for (let i = 0; i < numWorkers; i++) {
      try {
        const w = new Worker(workerScript, {
          execArgv: execArgvValidos,
          resourceLimits: { maxOldGenerationSizeMb: heapPorWorkerMB },
        });



        w.on('message', (res: RespostaCalculoWorker) => {
          const tarefa = this.pendentesPorWorker.get(w);
          if (tarefa) {
            this.pendentesPorWorker.delete(w);
            this.livres.push(w);
            this.mede(tarefa);
            if (res.ok) {
              tarefa.resolve(res);
            } else {
              tarefa.reject(new Error(res.erro ?? 'Erro desconhecido na worker thread.'));
            }
            this.processaFila();
          }
        });

        // `err` chega como `unknown` — o `'error'` de um `EventEmitter` não é
        // tipado como `Error`, e quem emite pode emitir qualquer coisa. Sem a
        // normalização, `String(err)` viraria "[object Object]" na resposta ao
        // pedido, e o motivo real da morte da worker se perderia.
        w.on('error', (err: unknown) => {
          this.removeWorker(w, err instanceof Error ? err : new Error(String(err)));
        });

        // **A morte de uma worker TEM de rejeitar a tarefa dela.** Até
        // 08/09/2026 este handler só a tirava das listas: a promessa do pedido
        // ficava PENDENTE para sempre (medido — 2 s depois de `terminate()`, a
        // promessa continuava pendente). Antes disso o estrago era um pedido
        // pendurado; com o single-flight (F2) passaria a ser a CHAVE inteira
        // travada, porque todo pedido seguinte àquela chave entraria no voo que
        // nunca resolve. Rejeitar faz o `catch` de `pagina()` cair no cálculo em
        // linha, que é a degradação que já existe e já é testada.
        w.on('exit', (codigo) => {
          this.removeWorker(
            w,
            new Error(`worker de cálculo terminou com código ${codigo} antes de responder`),
          );
        });

        this.workers.push(w);
        this.livres.push(w);
      } catch (err) {
        console.error('[piscina-workers] Não foi possível criar worker thread:', err);
      }
    }
  }

  get ativa(): boolean {
    return !this.desativado && this.workers.length > 0;
  }

  /**
   * Quanto trabalho está esperando e quanto está em curso.
   *
   * Existe para o F0 da evolução de near-realtime: sem este número não há como
   * responder "o worker pool está saturado?" nem "o usuário está atrás de uma
   * fila de warmup?" — e a fase seguinte (fila com prioridade) seria escolhida
   * pelo palpite. `Servidor` amostra `fila` no instante em que ENFILEIRA, porque
   * ler de fora, em `GET /api/saude`, quase sempre pegaria zero: a fila só existe
   * enquanto há cálculo em curso, e ninguém está olhando naquele instante.
   *
   * `porClasse` é o que a F3 acrescentou: uma fila de 6 diz muito pouco, e
   * `[0, 1, 5]` diz que nenhum usuário está esperando.
   */
  get estado(): { fila: number; ocupados: number; workers: number; porClasse: number[] } {
    return {
      fila: this.tarefas.tamanho,
      ocupados: this.pendentesPorWorker.size,
      workers: this.workers.length,
      porClasse: this.tarefas.porClasse(),
    };
  }

  /**
   * Quem recebe a espera e a execução de cada tarefa que termina.
   *
   * É um método e não uma opção de construtor porque `Servidor` também aceita
   * uma piscina pronta por fora (`ServidorOptions.piscinaWorkers`, usada em
   * teste e em sonda) — e uma piscina injetada tem de ser medida igual, senão os
   * números que a F3 produz só existem no caminho que ninguém exercita.
   *
   * A piscina não conhece `Metricas` de propósito: ela devolve prioridade e
   * milissegundos, e quem sabe que a prioridade 0 se chama `interactive` é o
   * `Servidor`.
   */
  medeCom(f: (m: MedidaDaTarefa) => void): void {
    this.medidor = f;
  }

  /**
   * Enfileira um cálculo. `prioridade` menor passa na frente; sem ela, tudo entra
   * como 0 (`interactive`) — que é exatamente o FIFO de antes da F3, e é por isso
   * que nenhum chamador antigo precisou mudar.
   */
  executa(
    msg: Omit<MensagemCalculoWorker, 'idReq'>,
    prioridade = 0,
  ): Promise<RespostaCalculoWorker> {
    if (!this.ativa) {
      return Promise.reject(new Error('Piscina de workers desativada ou indisponível.'));
    }

    return new Promise<RespostaCalculoWorker>((resolve, reject) => {
      const idReq = `req-${++this.contadorReq}-${Date.now()}`;
      const tarefa: TarefaPendente = {
        msg: { ...msg, idReq },
        resolve,
        reject,
        prioridade,
        enfileiradaEm: Date.now(),
        despachadaEm: 0,
      };
      this.tarefas.entra(tarefa);
      this.processaFila();
    });
  }

  private processaFila(): void {
    while (this.livres.length > 0) {
      const tarefa = this.tarefas.sai();
      if (tarefa === undefined) return;
      const worker = this.livres.shift()!;
      tarefa.despachadaEm = Date.now();
      this.pendentesPorWorker.set(worker, tarefa);
      worker.postMessage(tarefa.msg);
    }
  }

  /**
   * Fecha a medição de uma tarefa. Chamado tanto no sucesso quanto na morte da
   * worker — uma tarefa que só é medida quando dá certo produz uma espera média
   * que melhora justamente quando o sistema piora.
   */
  private mede(tarefa: TarefaPendente): void {
    if (this.medidor === null) return;
    const agora = Date.now();
    // Tarefa morta na fila (a worker morreu antes de despachá-la) nunca chegou a
    // executar: a espera é tudo, e a execução é zero. Fingir uma execução aqui
    // inflaria `calculo_ms` com tempo que nenhuma worker gastou.
    const despachadaEm = tarefa.despachadaEm === 0 ? agora : tarefa.despachadaEm;
    this.medidor({
      prioridade: tarefa.prioridade,
      esperaMs: despachadaEm - tarefa.enfileiradaEm,
      execucaoMs: agora - despachadaEm,
    });
  }

  /**
   * Tira a worker das listas e **rejeita o que ela estava fazendo**.
   *
   * `motivo` é o que vai para quem esperava. Sem ele (o caso de `destroi()`,
   * onde o processo está indo embora de qualquer jeito) nada é rejeitado.
   */
  private removeWorker(w: Worker, motivo?: Error): void {
    const idx = this.workers.indexOf(w);
    if (idx !== -1) this.workers.splice(idx, 1);

    const idxLivre = this.livres.indexOf(w);
    if (idxLivre !== -1) this.livres.splice(idxLivre, 1);

    const tarefa = this.pendentesPorWorker.get(w);
    this.pendentesPorWorker.delete(w);
    if (tarefa && motivo) {
      this.mede(tarefa);
      tarefa.reject(motivo);
    }

    // **Sem worker nenhuma, a fila também não pode ficar pendurada.** Ela só
    // avança em `processaFila`, que é chamada quando uma worker termina — se
    // todas morreram, ninguém mais a chama, e cada tarefa enfileirada seria uma
    // promessa que nunca resolve. Rejeitar manda cada uma para o cálculo em
    // linha, que continua respondendo (mais devagar) em vez de não responder.
    if (motivo && this.workers.length === 0 && this.tarefas.tamanho > 0) {
      for (const t of this.tarefas.drena()) {
        this.mede(t);
        t.reject(motivo);
      }
    }
  }

  destroi(): void {
    for (const w of this.workers) {
      void w.terminate();
    }
    this.workers.length = 0;
    this.livres.length = 0;
    this.pendentesPorWorker.clear();
    this.tarefas.drena();
  }
}
