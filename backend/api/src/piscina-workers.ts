// Gerenciador de Piscina de Worker Threads para computação paralela de DAX.

import { Worker } from 'node:worker_threads';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MensagemCalculoWorker, RespostaCalculoWorker } from './worker-calculador.ts';
import { TETO_PADRAO_MB } from './cache-visual.ts';

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
  /**
   * Ritmo e teto da recriação de workers mortas. Padrão: `POLITICA_DE_RECRIACAO`.
   * Produção nunca passa isto; existe para o teste não ter de esperar segundos
   * de backoff nem dez minutos de janela.
   */
  recriacao?: Partial<PoliticaDeRecriacao>;
}

/**
 * Quando e quantas vezes a piscina repõe uma worker que morreu sozinha.
 *
 * **Por que repor (16/10/2026).** Até aqui a worker era criada só no
 * construtor: morta por estouro de heap numa página grande, ela saía da lista e
 * nunca voltava. Morrendo as duas, `ativa` virava falso e TODO cálculo passava a
 * rodar em linha, na thread principal, sem limite de concorrência nenhum — o
 * caminho mais curto para o contêiner de 3 GB estourar com vários usuários.
 * Repor devolve o teto por worker (`resourceLimits`) e a fila, que são as duas
 * coisas que seguram a memória quando há gente usando.
 *
 * **Por que com freio.** Uma worker que morre ao nascer (script quebrado,
 * `import` que falha) ou que é morta de novo pela mesma página a cada clique
 * viraria um laço de criar-carregar-morrer, cada volta pagando o custo de subir
 * uma thread e — no caso do OOM — de encher meio giga de heap antes de cair.
 * Daí o backoff exponencial (a primeira reposição sai em 1 s, a sexta espera
 * 30 s) e o teto por janela: estourado o teto, a piscina PARA de repor, grita
 * no log, e o que vale é o fallback que já existia (cálculo em linha). A janela
 * é deslizante: quando a recriação mais antiga sai dela, uma nova tentativa é
 * agendada — um pico de OOM às 10h não condena a API a rodar sem workers até o
 * próximo reinício.
 *
 * Os números: 6 recriações em 10 min são 3 por worker no pool padrão de 2 — o
 * suficiente para atravessar alguns OOM isolados de páginas pesadas, e pouco
 * para um laço passar despercebido (o log grita na 7ª morte da janela).
 */
export interface PoliticaDeRecriacao {
  /** Espera antes da 1ª reposição dentro da janela. Dobra a cada reposição seguinte. */
  esperaInicialMs: number;
  /** Teto do backoff. */
  esperaMaximaMs: number;
  /** Quantas recriações cabem em `janelaMs`. Passou disso, a reposição para. */
  tetoNaJanela: number;
  /** Janela deslizante do teto. */
  janelaMs: number;
}

export const POLITICA_DE_RECRIACAO: Readonly<PoliticaDeRecriacao> = Object.freeze({
  esperaInicialMs: 1_000,
  esperaMaximaMs: 30_000,
  tetoNaJanela: 6,
  janelaMs: 10 * 60_000,
});

/**
 * O que a piscina sabe das próprias mortes. Feito para sair em `GET /api/saude`
 * (`PiscinaWorkers.recriacao`) — sem ele, uma worker morrendo em laço só
 * aparece como "a API ficou lenta", porque o fallback em linha esconde a falha.
 */
export interface EstadoDaRecriacao {
  /** Quantas workers a piscina tenta manter vivas. */
  alvo: number;
  /** Mortes inesperadas desde que a piscina subiu (encerramento não conta). */
  mortes: number;
  /** Workers repostas com sucesso desde que a piscina subiu. */
  workersRecriadas: number;
  /** A última morte inesperada, ou `null` se nenhuma worker morreu. */
  ultimaMorte: { em: string; motivo: string } | null;
  /**
   * `true` quando o teto da janela foi atingido e a reposição está parada até a
   * recriação mais antiga sair da janela. Enquanto isso, quem calcula o que
   * faltar é a thread principal.
   */
  suspensa: boolean;
  /** Quando a próxima reposição vai rodar (ISO), ou `null` se nada agendado. */
  proximaReposicaoEm: string | null;
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
): { tamanhoPool: number; heapPorWorkerMB: number; tetoDeVisuaisPorWorkerMB: number } {
  const inteiroPositivo = (bruto: string | undefined): number | undefined => {
    if (bruto === undefined || bruto.trim() === '') return undefined;
    const n = Number.parseInt(bruto, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const tamanhoPool = Math.max(
    1,
    Math.min(inteiroPositivo(env.API_WORKERS) ?? PADRAO_TAMANHO_POOL, cpus),
  );

  // **O orçamento de `CacheDeVisual` é UM só, repartido entre as workers — não
  // um por worker.** `CACHE_VISUAL_MB` sempre significou "quanto esta API pode
  // gastar guardando resultado inteiro de visual paginável"; o cálculo mudou de
  // thread, o orçamento não. Dividir mantém o teto total em `CACHE_VISUAL_MB`
  // (512 MB no padrão) com qualquer `API_WORKERS`, em vez de multiplicá-lo pelo
  // nº de workers — que é como um ajuste de concorrência viraria, calado, um
  // ajuste de memória.
  //
  // **`0` continua sendo o desligado do operador** (`CACHE_VISUAL_MB=0`, ver
  // `index.ts`), e por isso a leitura NÃO passa por `inteiroPositivo`: lá o zero
  // cai no padrão, que é o certo para "quantas workers", e o oposto do certo
  // para "quanto posso guardar".
  //
  // O `bruto ? … : NaN` é a mesma forma de `index.ts` de propósito — dois jeitos
  // de ler a MESMA variável de ambiente é um lugar a mais por onde a thread
  // principal e as workers podem discordar sobre o orçamento. A única diferença
  // é o piso em zero: um teto negativo não é orçamento nenhum, e faria
  // `CacheDeVisual` recusar toda entrada gritando no log a cada visual.
  const bruto = env.CACHE_VISUAL_MB;
  const pedidoMB = bruto ? Number.parseInt(bruto, 10) : Number.NaN;
  const tetoTotalMB = Number.isFinite(pedidoMB) ? Math.max(0, pedidoMB) : TETO_PADRAO_MB;

  return {
    tamanhoPool,
    heapPorWorkerMB: inteiroPositivo(env.API_WORKER_HEAP_MB) ?? PADRAO_HEAP_POR_WORKER_MB,
    tetoDeVisuaisPorWorkerMB: Math.floor(tetoTotalMB / tamanhoPool),
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
    return this.saiAte(this.#filas.length - 1);
  }

  /** Como `sai`, mas só de classes até `classeMax` — as de fundo ficam esperando. */
  saiAte(classeMax: number): T | undefined {
    for (let i = 0; i <= Math.min(classeMax, this.#filas.length - 1); i++) {
      const fila = this.#filas[i]!;
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

  // --- Recriação (ver `PoliticaDeRecriacao`) -------------------------------
  /**
   * O que `criaWorker()` repete a cada worker. Guardado no construtor porque a
   * worker reposta tem de nascer com o MESMO teto de heap e o MESMO orçamento
   * de visuais da que morreu — recalcular na reposição (relendo o ambiente)
   * abriria a porta para as duas discordarem.
   */
  private receita: {
    script: string;
    execArgv: string[];
    heapPorWorkerMB: number;
    tetoDeVisuaisMB: number;
  } | null = null;
  /** Quantas workers a piscina tenta manter vivas — o `tamanhoPool` resolvido. */
  private alvo = 0;
  private readonly politica: PoliticaDeRecriacao;
  /**
   * Ligada em `destroi()`. Sem ela, o `'exit'` que o próprio `terminate()`
   * provoca poderia ser lido como morte inesperada e a piscina se recriaria
   * durante o encerramento da API — segurando o processo e brigando com o
   * shutdown.
   */
  private encerrada = false;
  /** Instantes (ms) das recriações ainda dentro da janela — é o que o teto conta. */
  private readonly recriacoesRecentes: number[] = [];
  private temporizadorDeReposicao: NodeJS.Timeout | null = null;
  private reposicaoEm = 0;
  private suspensa = false;
  private mortes = 0;
  private workersRecriadas = 0;
  private ultimaMorte: { em: string; motivo: string } | null = null;

  constructor(opts: OpcoesPiscina = {}) {
    this.desativado = opts.desativado ?? false;
    this.politica = { ...POLITICA_DE_RECRIACAO, ...opts.recriacao };

    if (this.desativado) return;

    const padrao = configuracaoDaPiscina();
    const numWorkers = opts.tamanhoPool ?? padrao.tamanhoPool;
    const heapPorWorkerMB = opts.heapPorWorkerMB ?? padrao.heapPorWorkerMB;
    // Refeito sobre o pool de VERDADE: `opts.tamanhoPool` (que só teste passa)
    // mudaria o nº de workers sem mudar o divisor, e o orçamento total deixaria
    // de ser o que `configuracaoDaPiscina` promete.
    const tetoDeVisuaisPorWorkerMB = Math.floor(
      (padrao.tetoDeVisuaisPorWorkerMB * padrao.tamanhoPool) / numWorkers,
    );
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

    this.receita = {
      script: workerScript,
      execArgv: execArgvValidos,
      heapPorWorkerMB,
      tetoDeVisuaisMB: tetoDeVisuaisPorWorkerMB,
    };
    this.alvo = numWorkers;

    for (let i = 0; i < numWorkers; i++) {
      try {
        this.criaWorker();
      } catch (err) {
        console.error('[piscina-workers] Não foi possível criar worker thread:', err);
      }
    }
  }

  /**
   * Sobe UMA worker com a receita da piscina e a põe na lista de livres. Lança
   * se `new Worker` lançar — quem chama decide o que isso significa (no
   * construtor é log e segue; na reposição, conta como tentativa e volta para o
   * freio).
   */
  private criaWorker(): void {
    const r = this.receita!;
    const w = new Worker(r.script, {
      execArgv: r.execArgv,
      resourceLimits: { maxOldGenerationSizeMb: r.heapPorWorkerMB },
      // O orçamento do `CacheDeVisual` desta worker. Vai por `workerData` e
      // não por `process.env` porque quem reparte é a piscina, que é a
      // única que sabe quantas workers existem: lendo `CACHE_VISUAL_MB`
      // cada worker sozinha, todas pegariam o total e o teto viraria
      // `CACHE_VISUAL_MB × nº de workers` — o mesmo erro de multiplicar
      // orçamento que `PADRAO_HEAP_POR_WORKER_MB` documenta acima.
      workerData: { tetoDeVisuaisMB: r.tetoDeVisuaisMB },
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
    //
    // No estouro de heap o Node emite `'error'` com `code:
    // 'ERR_WORKER_OUT_OF_MEMORY'` e DEPOIS `'exit'`. Quem chega primeiro tira a
    // worker da lista e registra a morte; o segundo já não a acha e não faz
    // nada — por isso o motivo guardado é o do `'error'`, o que tem o código.
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
    //
    // Qualquer `'exit'` fora de `destroi()` é inesperado, inclusive o código 0:
    // `worker-calculador.ts` não tem caminho nenhum que encerre a thread, então
    // uma saída "limpa" ali também é uma worker a menos na piscina.
    w.on('exit', (codigo) => {
      this.removeWorker(
        w,
        new Error(`worker de cálculo terminou com código ${codigo} antes de responder`),
      );
    });

    this.workers.push(w);
    this.livres.push(w);
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
   * Mortes e reposições de worker, para `GET /api/saude`. Getter separado de
   * `estado` de propósito: `estado` é lido a cada enfileiramento
   * (`worker_fila_max`) e não tem por que montar data e motivo toda vez.
   */
  get recriacao(): EstadoDaRecriacao {
    return {
      alvo: this.alvo,
      mortes: this.mortes,
      workersRecriadas: this.workersRecriadas,
      ultimaMorte: this.ultimaMorte,
      suspensa: this.suspensa,
      proximaReposicaoEm:
        this.temporizadorDeReposicao === null ? null : new Date(this.reposicaoEm).toISOString(),
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

  /**
   * `.pop()`, não `.shift()` — a MESMA lista de livres, na ordem inversa, e a troca
   * é o que faz `cacheDeCarga` (`worker-calculador.ts`) valer alguma coisa na
   * prática.
   *
   * Cada worker guarda o dataset carregado NA SUA PRÓPRIA memória — pedidos
   * seguidos só reaproveitam se caírem NA MESMA worker. Com `.shift()` (FIFO) a
   * lista de livres é um rodízio: a worker que acabou de atender vai para o FIM
   * da fila e só volta a ser escolhida depois de todas as outras — com 2
   * workers, isso é ALTERNAR a cada pedido, e uma sessão clicando em técnicos
   * diferentes nunca acerta a mesma worker duas vezes seguidas.
   *
   * Com `.pop()` (LIFO), a worker que acabou de atender é a PRIMEIRA candidata
   * ao próximo pedido — e como um pedido só demora enquanto ela está ocupada, é
   * exatamente enquanto ela está ocupada que um pedido CONCORRENTE (outro
   * usuário) forçosamente cai na outra: a distribuição entre usuários
   * simultâneos continua correta, só que agora por NECESSIDADE (só há uma
   * livre) em vez de por rodízio. Uma sessão sozinha, clicando em sequência
   * (o caso comum), acerta a mesma worker sempre.
   */
  private processaFila(): void {
    while (this.livres.length > 0) {
      // **Uma worker fica sempre para quem está usando (28/09/2026, ACHADOS #163).**
      // A prioridade sozinha ordena só o que ESPERA: um cálculo de fundo já despachado
      // não é interrompido, e com as duas workers ocupadas por aquecimento/pré-cálculo
      // um clique esperava um cálculo inteiro (até 17,6 s medidos). Fundo (prefetch,
      // warmup) usa no máximo `workers - 1`; a última livre só pega pedido interativo.
      // Com uma worker só não há reserva — senão o fundo nunca rodaria.
      const deFundo = [...this.pendentesPorWorker.values()].filter((t) => t.prioridade > 0).length;
      const fundoPode = this.workers.length <= 1 || deFundo < this.workers.length - 1;
      const tarefa = fundoPode ? this.tarefas.sai() : this.tarefas.saiAte(0);
      if (tarefa === undefined) return;
      const worker = this.livres.pop()!;
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
    // Só a PRIMEIRA notícia da morte conta (no OOM chegam `'error'` e `'exit'`),
    // e nada conta depois de `destroi()`.
    const morteNova = idx !== -1 && motivo !== undefined && !this.encerrada;

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
    //
    // Continua valendo com a recriação: entre a morte e a reposição (o backoff)
    // não há worker nenhuma, e segurar a fila esperando uma worker que pode nem
    // vir (teto atingido, ou a nova morrendo ao nascer) seria trocar resposta
    // lenta por resposta nenhuma.
    if (motivo && this.workers.length === 0 && this.tarefas.tamanho > 0) {
      for (const t of this.tarefas.drena()) {
        this.mede(t);
        t.reject(motivo);
      }
    }

    if (morteNova) {
      const codigo = (motivo as NodeJS.ErrnoException).code;
      this.mortes++;
      this.ultimaMorte = {
        em: new Date().toISOString(),
        motivo: codigo ? `${codigo}: ${motivo.message}` : motivo.message,
      };
      console.warn(
        `[piscina-workers] worker morreu (${this.ultimaMorte.motivo}); ` +
          `${this.workers.length}/${this.alvo} vivas.`,
      );
      // **A tarefa da worker morta NÃO é reenviada para a nova.** Ela já foi
      // rejeitada acima e segue para o cálculo em linha; reenviar seria dar à
      // worker recém-nascida justamente a página que pode ter matado a
      // anterior — e o laço de mortes passaria a ser automático.
      this.agendaReposicao();
    }
  }

  /**
   * Agenda a reposição das workers que faltam, respeitando o freio.
   *
   * Um temporizador só para a piscina inteira: duas mortes durante o mesmo
   * backoff são repostas pela mesma volta de `repoe()`, que preenche até o
   * `alvo`. O temporizador é `unref()` — uma reposição pendente não pode,
   * sozinha, segurar o processo vivo.
   */
  private agendaReposicao(): void {
    if (this.encerrada || this.temporizadorDeReposicao !== null) return;
    if (this.workers.length >= this.alvo) return;

    const agora = Date.now();
    const recentes = this.podaRecentes(agora);
    let espera: number;
    if (recentes >= this.politica.tetoNaJanela) {
      // Teto atingido: para de repor e grita. Volta a tentar só quando a
      // recriação mais antiga sair da janela. Com teto 0 não há recriação
      // nenhuma na conta para sair dela — a reposição fica desligada de vez.
      const maisAntiga = this.recriacoesRecentes[0];
      espera =
        maisAntiga === undefined
          ? Number.POSITIVE_INFINITY
          : Math.max(0, maisAntiga + this.politica.janelaMs - agora);
      if (!this.suspensa) {
        this.suspensa = true;
        console.error(
          `[piscina-workers] REPOSIÇÃO DE WORKERS SUSPENSA: ${recentes} recriações em ` +
            `${Math.round(this.politica.janelaMs / 1000)} s (teto ${this.politica.tetoNaJanela}). ` +
            `Última morte: ${this.ultimaMorte?.motivo ?? 'desconhecida'}. ` +
            `${this.workers.length}/${this.alvo} workers vivas; sem worker, o cálculo roda na ` +
            `thread principal ${
              Number.isFinite(espera)
                ? `até ${new Date(agora + espera).toISOString()}`
                : 'até a API reiniciar'
            }. Worker morrendo em laço é página maior que o heap da worker ` +
            `(API_WORKER_HEAP_MB) ou script quebrado.`,
        );
      }
      if (!Number.isFinite(espera)) return;
    } else {
      espera = Math.min(
        this.politica.esperaInicialMs * 2 ** recentes,
        this.politica.esperaMaximaMs,
      );
    }

    this.reposicaoEm = agora + espera;
    this.temporizadorDeReposicao = setTimeout(() => this.repoe(), espera);
    this.temporizadorDeReposicao.unref();
  }

  /** Tira da conta as recriações que já saíram da janela; devolve quantas sobraram. */
  private podaRecentes(agora: number): number {
    const limite = agora - this.politica.janelaMs;
    while (this.recriacoesRecentes.length > 0 && this.recriacoesRecentes[0]! <= limite) {
      this.recriacoesRecentes.shift();
    }
    return this.recriacoesRecentes.length;
  }

  /**
   * Sobe as workers que faltam até o `alvo`, uma a uma, cada uma contando no
   * teto. A nova nasce vazia — sem dataset carregado, sem `CacheDeVisual` —, e
   * por isso nenhuma invalidação (`invalidaPagina`) anterior precisa ser
   * reenviada a ela: não há o que invalidar. As que vierem depois a alcançam,
   * porque ela já está em `this.workers`.
   */
  private repoe(): void {
    this.temporizadorDeReposicao = null;
    if (this.encerrada) return;

    while (this.workers.length < this.alvo) {
      if (this.podaRecentes(Date.now()) >= this.politica.tetoNaJanela) {
        this.agendaReposicao();
        return;
      }
      // Conta ANTES de criar: um `new Worker` que lança também é uma volta do
      // laço, e é justamente o caso que não pode girar sem freio.
      this.recriacoesRecentes.push(Date.now());
      try {
        this.criaWorker();
      } catch (err) {
        console.error('[piscina-workers] Falha ao repor worker thread:', err);
        this.agendaReposicao();
        return;
      }
      this.workersRecriadas++;
    }

    this.suspensa = false;
    console.warn(`[piscina-workers] piscina reposta: ${this.workers.length}/${this.alvo} workers.`);
    this.processaFila();
  }

  /**
   * Manda TODAS as workers (ocupadas ou livres) esquecer o dataset que guardam
   * de uma página — a metade "por poller" da invalidação de `cacheDeCarga`
   * (`worker-calculador.ts`); ver `Servidor.aoTabelaMudar`, que chama isto no
   * mesmo instante em que já derruba `this.carregadas` para a mesma página.
   *
   * Mensagem solta (`postMessage` direto, fora de `executa()`/da fila de
   * tarefas): não é um cálculo, ninguém espera `idReq` nem resposta nenhuma —
   * é o mesmo motivo de `MensagemDeInvalidacao` não ter `idReq`.
   */
  invalidaPagina(dashboardId: string): void {
    for (const w of this.workers) w.postMessage({ tipo: 'invalida', dashboardId });
  }

  destroi(): void {
    // Primeiro a trava, depois o `terminate()`: os `'exit'` que ele provoca
    // chegam depois e não podem ser lidos como morte a repor.
    this.encerrada = true;
    if (this.temporizadorDeReposicao !== null) {
      clearTimeout(this.temporizadorDeReposicao);
      this.temporizadorDeReposicao = null;
    }
    for (const w of this.workers) {
      void w.terminate();
    }
    this.workers.length = 0;
    this.livres.length = 0;
    this.pendentesPorWorker.clear();
    this.tarefas.drena();
  }
}
