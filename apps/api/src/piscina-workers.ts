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
}

export class PiscinaWorkers {
  private readonly workers: Worker[] = [];
  private readonly livres: Worker[] = [];
  private readonly tarefas: TarefaPendente[] = [];
  private readonly pendentesPorWorker = new Map<Worker, TarefaPendente>();
  private readonly desativado: boolean;
  private contadorReq = 0;

  constructor(opts: OpcoesPiscina = {}) {
    this.desativado = opts.desativado ?? false;

    if (this.desativado) return;

    const padrao = configuracaoDaPiscina();
    const numWorkers = opts.tamanhoPool ?? padrao.tamanhoPool;
    const heapPorWorkerMB = opts.heapPorWorkerMB ?? padrao.heapPorWorkerMB;
    const workerScript = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      'worker-calculador.ts',
    );

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
            if (res.ok) {
              tarefa.resolve(res);
            } else {
              tarefa.reject(new Error(res.erro ?? 'Erro desconhecido na worker thread.'));
            }
            this.processaFila();
          }
        });

        w.on('error', (err) => {
          this.removeWorker(w, err);
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
   */
  get estado(): { fila: number; ocupados: number; workers: number } {
    return {
      fila: this.tarefas.length,
      ocupados: this.pendentesPorWorker.size,
      workers: this.workers.length,
    };
  }

  executa(msg: Omit<MensagemCalculoWorker, 'idReq'>): Promise<RespostaCalculoWorker> {
    if (!this.ativa) {
      return Promise.reject(new Error('Piscina de workers desativada ou indisponível.'));
    }

    return new Promise<RespostaCalculoWorker>((resolve, reject) => {
      const idReq = `req-${++this.contadorReq}-${Date.now()}`;
      const tarefa: TarefaPendente = {
        msg: { ...msg, idReq },
        resolve,
        reject,
      };
      this.tarefas.push(tarefa);
      this.processaFila();
    });
  }

  private processaFila(): void {
    while (this.tarefas.length > 0 && this.livres.length > 0) {
      const tarefa = this.tarefas.shift()!;
      const worker = this.livres.shift()!;
      this.pendentesPorWorker.set(worker, tarefa);
      worker.postMessage(tarefa.msg);
    }
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
    if (tarefa && motivo) tarefa.reject(motivo);

    // **Sem worker nenhuma, a fila também não pode ficar pendurada.** Ela só
    // avança em `processaFila`, que é chamada quando uma worker termina — se
    // todas morreram, ninguém mais a chama, e cada tarefa enfileirada seria uma
    // promessa que nunca resolve. Rejeitar manda cada uma para o cálculo em
    // linha, que continua respondendo (mais devagar) em vez de não responder.
    if (motivo && this.workers.length === 0 && this.tarefas.length > 0) {
      const presas = this.tarefas.splice(0, this.tarefas.length);
      for (const t of presas) t.reject(motivo);
    }
  }

  destroi(): void {
    for (const w of this.workers) {
      void w.terminate();
    }
    this.workers.length = 0;
    this.livres.length = 0;
    this.pendentesPorWorker.clear();
    this.tarefas.length = 0;
  }
}
