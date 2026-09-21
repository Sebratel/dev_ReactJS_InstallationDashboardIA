// A cadência do refresh DENTRO da API — um relógio por grupo, uma fila só.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE ISTO EXISTE (19/09/2026)
//
// A plataforma dependia de três camadas para o dado não envelhecer, e cada uma
// podia cair sozinha, sem avisar:
//
//     Agendador de Tarefas do Windows  ->  `npm start`  ->  daemon de refresh
//
// A primeira é a que doeu: ela é configuração de MÁQUINA, não do repositório.
// Enquanto ela não estivesse registrada naquele Windows específico, nada subia
// depois de um reboot — e em 16/09/2026 a plataforma passou 3h43 fora do ar com
// `refresh-status.json` marcando `falhasConsecutivas: 0` nos três grupos, porque
// aquele arquivo não distingue "não falhou" de "não rodou" (ACHADOS #129).
//
// O dashboard comercial (`COM · Gestão Comercial`) não tem nenhuma dessas três
// camadas. O agendador dele é um `setInterval` por grupo dentro do mesmo processo
// Express que serve a API, e quem supervisiona é o `restart: unless-stopped` do
// Docker. Sem daemon, sem tarefa de host, sem cron. Este módulo traz esse desenho
// para cá — com as adaptações que o nosso volume de dado exige, listadas abaixo.
//
// ─────────────────────────────────────────────────────────────────────────────
// O QUE FOI COPIADO DE LÁ
//
//   1. **Um relógio por grupo**, e não um tick global que varre todos. É a
//      diferença entre `frio` rodar a cada 30 min e `frio` rodar "no primeiro tick
//      de 15 min depois de 30 min terem passado, se o `medio` já tiver acabado".
//   2. **Fila com limite**, o `vaga()`/`liberar()` de `etl/refresh.js`. Lá o limite
//      é 3 (o pool do banco tem 5). Aqui é **1**, e não por timidez: dois
//      materializadores simultâneos fazem read-modify-write no mesmo
//      `manifesto.json` e um apaga as tabelas que o outro acabou de registrar, sem
//      erro nenhum. Ver o comentário de topo de `tools/refresh/src/tick.ts`.
//   3. **Dedup do que já está em voo.** Lá é a promessa em curso de `refreshSource`;
//      aqui é o `disparo-coalescido`.
//   4. **`timer.unref()`**, para o agendador nunca ser o motivo de o processo não
//      conseguir morrer.
//   5. **Subir mesmo se a carga inicial falhar** (`index.js` dele chama
//      `startScheduler()` no `.then` E no `.catch`). Aqui: um grupo que falha não
//      impede os outros de serem agendados, e a API serve o snapshot que já está em
//      disco enquanto isso.
//
// ─────────────────────────────────────────────────────────────────────────────
// O QUE **NÃO** FOI COPIADO, E O PORQUÊ MEDIDO
//
//   - **Ele reconstrói o modelo no próprio processo; nós disparamos um filho.**
//     O modelo comercial inteiro são ~240 mil fatos em ~60 MB, e a carga mais cara
//     dele leva ~25 s. Aqui `protocolos-geral` sozinha pede 8 GB de heap e
//     `field-agenda` leva 21 min 49 s ponta a ponta (ACHADOS #82). Materializar
//     dentro da API faria o pico da materialização e o pico da API serem o mesmo
//     pico — e a tela cairia junto com um OOM kill de carga. Ver
//     `tools/refresh/src/executa-grupo.ts`.
//   - **Ele não tem snapshot em disco; nós temos, e ele continua.** É o que faz a
//     API subir em segundos servindo dado de antes, em vez de esperar a carga
//     inteira. O filho escreve em disco, o `fs.watch` de `CarimboVigiado` percebe, e
//     o `Aquecedor` reenche as páginas — encanamento que já existia e não muda aqui.
//
// ─────────────────────────────────────────────────────────────────────────────
// O QUE ISTO CONSERTA DE VERDADE, além de tirar a tarefa do Windows
//
// O daemon pulava o disparo inteiro quando o anterior ainda rodava (`emExecucao` em
// `daemon.ts`), e pular não é falha: `estaVencido` mede idade do último SUCESSO,
// então `refresh-status.json` ficava verde enquanto a cadência real caía pela
// metade. O pior tick observado foi 601 s numa janela de 900 s (ver
// `specs/_catalog/refresh.yaml`) — a margem era de 33%.
//
// Aqui um grupo atrasado **enfileira**, não perde a vez. O único disparo descartado
// é o do grupo contra ele mesmo, que materializaria exatamente o que já está sendo
// materializado — e esse vira `disparo-coalescido` no histórico, com o grupo nomeado.
//
// REGRA DE SAÍDA: id de grupo, contagem e tempo. Nunca valor de linha.

import path from 'node:path';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import {
  leGrupos,
  validaGrupos,
  type GrupoDeRefresh,
} from '../../../tools/refresh/src/grupos.ts';
import { registra } from '../../../tools/refresh/src/historico.ts';
import {
  leStatus,
  escreveStatus,
  type StatusDeRefresh,
} from '../../../tools/refresh/src/status.ts';
import { estaVencido, proximoStatus } from '../../../tools/refresh/src/tick.ts';
import {
  rodaGrupoAssincrono,
  type ResultadoDeExecucao,
} from '../../../tools/refresh/src/executa-grupo.ts';

/** Por que um grupo entrou na fila — só para o log dizer algo útil. */
export type MotivoDeDisparo = 'vencido-no-arranque' | 'cadência' | 'pedido';

export interface GrupoNoEstado {
  id: string;
  intervaloMinutos: number;
  /** ISO do último sucesso conhecido, vindo de `refresh-status.json`. */
  ultimoSucesso: string | null;
  ultimaTentativa: string | null;
  /** `null` enquanto este processo não rodou o grupo nenhuma vez. */
  ok: boolean | null;
  emExecucao: boolean;
  naFila: boolean;
}

export interface EstadoDoAgendador {
  /** `false` quando desligado por configuração ou quando não há grupo nenhum. */
  ativo: boolean;
  /** Por que não está ativo. Ausente quando está. */
  motivo?: string;
  emExecucao: string | null;
  /** Há quanto tempo o grupo em execução começou. `null` quando nada roda. */
  emCursoHaMs: number | null;
  fila: string[];
  execucoes: number;
  falhas: number;
  /** Disparos descartados por o próprio grupo já estar em voo. */
  coalescidos: number;
  /**
   * Quantas vezes a máquina congelou embaixo do agendador desde o arranque.
   *
   * Aparece no `/api/saude` de propósito: é a diferença entre "a plataforma está
   * instável" e "este host dorme". Um número que sobe aqui todo dia diz que o
   * problema não tem conserto em código — tem em política de energia.
   */
  suspensoes: number;
  grupos: GrupoNoEstado[];
}

export interface OpcoesDoAgendador {
  raiz: string;
  specsDir?: string;
  snapshotDir?: string;
  memoriaMb?: number;
  /**
   * Roda UM grupo até o fim. Injetável no teste; em produção, o subprocesso.
   *
   * O `sinal` é opcional para quem injeta — um duble que o ignore continua válido —,
   * mas em produção é por ele que a suspensão mata um filho que não vai mais
   * terminar sozinho.
   */
  roda?: (grupo: GrupoDeRefresh, sinal?: AbortSignal) => Promise<ResultadoDeExecucao>;
  agora?: () => Date;
  /** Onde as linhas aparecem. Padrão: `console.log`. */
  anuncia?: (linha: string) => void;
  /**
   * Chamado depois de cada grupo concluído, com o resultado.
   *
   * **Não é por onde a API descobre que o snapshot mudou** — isso continua sendo o
   * `fs.watch` de `CarimboVigiado` mais a conferida do `Aquecedor`, que já
   * funcionavam com o daemon externo e não dependem deste módulo existir. O gancho
   * serve para teste e para quem quiser reagir sem criar outro relógio.
   */
  aoConcluirGrupo?: (id: string, resultado: ResultadoDeExecucao, duracaoMs: number) => void;
  /** Cadência do batimento que detecta suspensão. Injetável só para o teste. */
  batimentoMs?: number;
  /** Carência depois de a máquina acordar. Injetável só para o teste. */
  carenciaMs?: number;
}

/**
 * De quanto em quanto tempo o batimento confere se o relógio de parede andou mais do
 * que ele. Um minuto é barato (o temporizador é `unref`ado e não faz I/O) e fino o
 * bastante para pegar uma suspensão antes que a fila inteira encalhe.
 */
export const BATIMENTO_PADRAO_MS = 60_000;

/**
 * Quantas vezes a cadência do batimento precisa passar para chamar de suspensão.
 *
 * Três, e não um: o laço de eventos da API atrasa um temporizador em condição normal
 * — uma materialização pesada no mesmo host, o coletor de lixo, o disco. Atraso de
 * segundos é vida normal e não pode virar diagnóstico. O que foi medido em
 * 19/09/2026 não tem nada de marginal: 2h14min sem um único disparo, com três
 * temporizadores de 15, 20 e 30 min saindo juntos com 14 ms entre si ao acordar.
 * Qualquer limiar entre 2× e 50× teria acertado aquele caso; 3× é o que não erra
 * para o outro lado.
 */
export const FATOR_DE_SUSPENSAO = 3;

/**
 * Quanto o agendador espera, depois de a máquina acordar, antes de começar qualquer
 * materialização.
 *
 * **Isto é uma segunda população de falha, medida, e diferente da primeira.** Matar o
 * filho congelado resolve a carga que ATRAVESSOU o sono; não resolve a que COMEÇA
 * enquanto o host volta. Cruzando `snapshot/refresh-historico.log` com o log de
 * energia do Windows entre 18 e 21/09/2026, das 25 falhas registradas:
 *
 *   5 tinham duração absurda (2h17min, 2h24min, 3h05min, 6h16min, 10h46min)
 *     — são as que atravessaram o sono;
 *   ~8 terminaram de 1 s a 110 s depois de um evento de retomada, com duração
 *     NORMAL — `frio` 1 s depois de acordar, `medio` no MESMO segundo, `frio` 2 s,
 *     `quente` 10 s. Essas não dormiram: nasceram cedo demais, com a pilha de rede
 *     ainda subindo, e o driver do banco não tinha a quem se conectar.
 *
 * Um minuto é o que separa as duas coisas sem custar frescor que importe: o preço é
 * um atraso de 60 s uma vez por retomada, contra grupos inteiros falhando à toa.
 *
 * **O que isto NÃO cobre, e vale dizer:** cinco falhas de 20/09 (12:49 a 13:15,
 * horário local) aconteceram com a máquina acordada o tempo todo, e a causa delas
 * continua desconhecida — o histórico só guardava `saiu com código 1`. É para essas
 * que serve a cauda do `stderr` em `tools/refresh/src/executa-grupo.ts`.
 */
export const CARENCIA_APOS_RETOMADA_MS = 60_000;

/**
 * Lê `AUTO_REFRESH` e o argv, e decide se a API agenda.
 *
 * **O nome é o mesmo que `tools/subir/src/index.ts` já usava**, de propósito: quem
 * tinha `AUTO_REFRESH=false` no ambiente para não subir o daemon continua sem
 * cadência automática depois desta mudança, sem precisar descobrir uma variável
 * nova. O que mudou foi QUEM lê a variável, não o que ela significa.
 */
export function agendaNesteProcesso(
  env: NodeJS.ProcessEnv,
  argv: readonly string[],
): { agenda: true } | { agenda: false; motivo: string } {
  if (argv.includes('--sem-refresh')) {
    return { agenda: false, motivo: 'desligado por --sem-refresh' };
  }
  if (env.AUTO_REFRESH === 'false' || env.AUTO_REFRESH === '0') {
    return { agenda: false, motivo: 'desligado por AUTO_REFRESH no ambiente' };
  }
  return { agenda: true };
}

export class Agendador {
  readonly #raiz: string;
  readonly #specsDir: string;
  readonly #snapshotDir: string;
  readonly #memoriaMb: number | undefined;
  readonly #roda: (grupo: GrupoDeRefresh, sinal?: AbortSignal) => Promise<ResultadoDeExecucao>;
  readonly #agora: () => Date;
  readonly #anuncia: (linha: string) => void;
  readonly #aoConcluirGrupo: OpcoesDoAgendador['aoConcluirGrupo'];
  readonly #batimentoMs: number;
  readonly #carenciaMs: number;

  #grupos = new Map<string, GrupoDeRefresh>();
  #timers: NodeJS.Timeout[] = [];
  #fila: string[] = [];
  #emExecucao: string | null = null;
  #comecouEm = 0;
  #ativo = false;
  #motivo: string | undefined;
  #execucoes = 0;
  #falhas = 0;
  #coalescidos = 0;
  #suspensoes = 0;
  #status: StatusDeRefresh = {};
  /** O batimento, separado dos relógios de grupo porque `para()` mata os dois. */
  #batimento: NodeJS.Timeout | null = null;
  #ultimoBatimento = 0;
  /** Por onde a suspensão mata o filho em voo. `null` quando nada roda. */
  #aborto: AbortController | null = null;
  /** Marcado pela suspensão, lido e zerado por `#executa` na volta. */
  #interrompidaPorSuspensao = false;
  /** Instante antes do qual nada começa — a carência da retomada. `0` = liberado. */
  #liberadoEm = 0;
  #destravaCarencia: NodeJS.Timeout | null = null;

  constructor(opts: OpcoesDoAgendador) {
    this.#raiz = opts.raiz;
    this.#specsDir = opts.specsDir ?? path.join(opts.raiz, 'specs');
    this.#snapshotDir = opts.snapshotDir ?? path.join(opts.raiz, DIRETORIO_PADRAO);
    this.#memoriaMb = opts.memoriaMb;
    this.#roda =
      opts.roda ??
      ((g, sinal) =>
        rodaGrupoAssincrono(this.#raiz, g, {
          ...(this.#memoriaMb !== undefined ? { memoriaMb: this.#memoriaMb } : {}),
          ...(sinal ? { sinal } : {}),
        }));
    this.#agora = opts.agora ?? (() => new Date());
    this.#anuncia = opts.anuncia ?? ((l) => console.log(l));
    this.#aoConcluirGrupo = opts.aoConcluirGrupo;
    this.#batimentoMs = opts.batimentoMs ?? BATIMENTO_PADRAO_MS;
    this.#carenciaMs = opts.carenciaMs ?? CARENCIA_APOS_RETOMADA_MS;
  }

  /**
   * Lê o catálogo, valida e liga um relógio por grupo. Os grupos já vencidos entram
   * na fila na hora — é o `refreshAll()` da subida, com a diferença de que
   * `estaVencido` o torna barato: reiniciar a API dois minutos depois de um ciclo
   * bem-sucedido não materializa nada.
   *
   * **Nunca lança.** Um catálogo quebrado desliga a cadência e diz por quê; derrubar
   * a API por causa disso trocaria dado velho por tela nenhuma, e a tela é o produto.
   */
  inicia(): void {
    if (this.#ativo) return;
    try {
      this.#grupos = leGrupos(this.#specsDir);
    } catch (err) {
      this.#recusa(`specs/_catalog/refresh.yaml não pôde ser lido: ${mensagem(err)}`);
      return;
    }
    if (this.#grupos.size === 0) {
      this.#recusa('nenhum grupo declarado em specs/_catalog/refresh.yaml');
      return;
    }

    // **A validação roda uma vez, aqui, e recusa fechado.** O daemon a repetia a cada
    // tick porque o processo dele nascia e morria junto do tick; este vive tanto
    // quanto a API. Uma query com nome errado no catálogo faria TODO ciclo falhar —
    // é melhor dizer isso no arranque, uma vez, do que a cada 15 min para sempre.
    try {
      const registry = QueryRegistry.fromSpecsDir(this.#specsDir);
      const problemas = validaGrupos(this.#grupos, new Set(registry.queries.keys()));
      if (problemas.length > 0) {
        this.#recusa(`specs/_catalog/refresh.yaml com problemas: ${problemas.join('; ')}`);
        return;
      }
    } catch (err) {
      this.#recusa(`o Query Registry não pôde ser lido: ${mensagem(err)}`);
      return;
    }

    this.#status = leStatus(this.#snapshotDir);
    this.#ativo = true;
    this.#motivo = undefined;

    registra(this.#snapshotDir, {
      evento: 'agendador-arranque',
      quando: this.#agora().toISOString(),
      pid: process.pid,
      grupos: [...this.#grupos.values()].map((g) => ({
        id: g.id,
        intervaloMinutos: g.intervaloMinutos,
      })),
    });

    this.#anuncia(
      `[refresh] agendador no processo da API — ${this.#grupos.size} grupo(s), ` +
        'sem daemon e sem tarefa de host.',
    );

    const agora = this.#agora();
    this.#ultimoBatimento = agora.getTime();
    const bat = setInterval(
      () => this.#semDerrubar('batimento', () => this.#confereBatimento()),
      this.#batimentoMs,
    );
    bat.unref?.();
    this.#batimento = bat;

    for (const grupo of this.#grupos.values()) {
      const t = setInterval(
        () => this.#semDerrubar(`relógio de ${grupo.id}`, () => this.#enfileira(grupo.id, 'cadência')),
        grupo.intervaloMinutos * 60_000,
      );
      // Sem isto o agendador segura o processo vivo sozinho, e um `Ctrl+C` ou um
      // `SIGTERM` de container passaria a esperar o próximo relógio.
      t.unref?.();
      this.#timers.push(t);

      const vencido = estaVencido(this.#status[grupo.id], grupo.intervaloMinutos, agora);
      this.#anuncia(
        `[refresh]   ${grupo.id.padEnd(8)} a cada ${String(grupo.intervaloMinutos).padStart(3)} min` +
          `${vencido ? '  (vencido — entra na fila agora)' : ''}`,
      );
      if (vencido) this.#enfileira(grupo.id, 'vencido-no-arranque');
    }
  }

  /** Põe um grupo na fila fora da cadência — o que `POST /api/refresh` faria. */
  pede(id: string): boolean {
    if (!this.#ativo || !this.#grupos.has(id)) return false;
    this.#enfileira(id, 'pedido');
    return true;
  }

  para(): void {
    for (const t of this.#timers) clearInterval(t);
    this.#timers = [];
    if (this.#batimento !== null) clearInterval(this.#batimento);
    this.#batimento = null;
    if (this.#destravaCarencia !== null) clearTimeout(this.#destravaCarencia);
    this.#destravaCarencia = null;
    this.#liberadoEm = 0;
    this.#fila = [];
    this.#ativo = false;
  }

  estado(): EstadoDoAgendador {
    return {
      ativo: this.#ativo,
      ...(this.#motivo !== undefined ? { motivo: this.#motivo } : {}),
      emExecucao: this.#emExecucao,
      emCursoHaMs: this.#emExecucao === null ? null : this.#agora().getTime() - this.#comecouEm,
      fila: [...this.#fila],
      execucoes: this.#execucoes,
      falhas: this.#falhas,
      coalescidos: this.#coalescidos,
      suspensoes: this.#suspensoes,
      grupos: [...this.#grupos.values()].map((g) => {
        const s = this.#status[g.id];
        return {
          id: g.id,
          intervaloMinutos: g.intervaloMinutos,
          ultimoSucesso: s?.ultimoSucesso ?? null,
          ultimaTentativa: s?.ultimaTentativa ?? null,
          ok: s ? s.ok : null,
          emExecucao: this.#emExecucao === g.id,
          naFila: this.#fila.includes(g.id),
        };
      }),
    };
  }

  /**
   * Roda algo de dentro de um temporizador sem deixar que ele derrube a API.
   *
   * **Um `throw` dentro de `setInterval` não tem quem o pegue**: não há pilha de
   * chamador, então vira `uncaughtException` e o Node morre. Desde que a cadência
   * passou a viver DENTRO do processo da API (e não num daemon separado), isso deixou
   * de ser "o refresh parou" e virou "a tela saiu do ar". A guarda de processo
   * (`guarda-de-processo.ts`) é a rede embaixo desta; esta aqui é para o erro nunca
   * chegar lá, e para dizer qual relógio o produziu.
   */
  #semDerrubar(oQue: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.#anuncia(`[refresh] erro em '${oQue}', a cadência continua: ${mensagem(err)}`);
    }
  }

  #recusa(motivo: string): void {
    this.#ativo = false;
    this.#motivo = motivo;
    this.#anuncia(
      `[refresh] agendador DESLIGADO: ${motivo}.\n` +
        '[refresh] a API continua servindo o snapshot em disco, que daqui em diante envelhece.',
    );
  }

  /**
   * O batimento. Ele não faz trabalho nenhum: só confere se o relógio de parede andou
   * mais do que ele próprio deveria ter deixado andar.
   *
   * **Por que um temporizador é um detector de suspensão confiável, e uma comparação
   * de relógios não seria.** A tentação é comparar um relógio monotônico com o de
   * parede; na Espera S0 do Windows o contador de ticks continua andando, e a
   * comparação não acusaria nada. O que o modo faz é congelar o PROCESSO — então o
   * sintoma direto, e o único que não depende de detalhe de plataforma, é o
   * temporizador não ter disparado na hora. Foi esse o sintoma observado em
   * 19/09/2026: três relógios de grupo saíram juntos, com 14 ms entre si, depois de
   * 2h14min de silêncio.
   */
  #confereBatimento(): void {
    if (!this.#ativo) return;
    const agora = this.#agora().getTime();
    const decorrido = agora - this.#ultimoBatimento;
    this.#ultimoBatimento = agora;
    if (decorrido < this.#batimentoMs * FATOR_DE_SUSPENSAO) return;

    this.#suspensoes += 1;
    const grupoEmVoo = this.#emExecucao;
    registra(this.#snapshotDir, {
      evento: 'maquina-suspensa',
      quando: new Date(agora).toISOString(),
      paradaMs: decorrido,
      grupoEmVoo,
    });
    this.#anuncia(
      `[refresh] a máquina ficou ${(decorrido / 60_000).toFixed(0)} min congelada ` +
        `(suspensão do sistema operacional)` +
        `${grupoEmVoo ? ` — '${grupoEmVoo}' estava materializando e vai ser refeito` : ''}.`,
    );

    // A carência vale mesmo sem nada em voo: o próximo relógio de grupo pode bater
    // dois segundos depois de acordar — e, ao acordar, TODOS batem de uma vez.
    this.#liberadoEm = agora + this.#carenciaMs;
    if (this.#destravaCarencia !== null) clearTimeout(this.#destravaCarencia);
    const destrava = setTimeout(() => {
      this.#semDerrubar('fim da carência', () => {
        this.#liberadoEm = 0;
        this.#destravaCarencia = null;
        this.#bombeia();
      });
    }, this.#carenciaMs);
    destrava.unref?.();
    this.#destravaCarencia = destrava;

    if (grupoEmVoo === null) return;
    // As conexões do filho com o banco morreram durante o sono; ele só descobriria
    // isso na próxima leitura, e até lá segura a fila. Matar agora é o que devolve
    // `quente` e `frio` à cadência — em 19/09/2026 eles esperaram 2h17min atrás de um
    // filho que já estava morto por dentro.
    this.#interrompidaPorSuspensao = true;
    this.#aborto?.abort('máquina suspensa');
  }

  /**
   * O portão da fila. Um grupo que já está rodando ou já espera não entra de novo:
   * a segunda cópia materializaria exatamente o mesmo, e enfileirá-la só empurraria
   * os outros grupos para trás.
   */
  #enfileira(id: string, motivo: MotivoDeDisparo): void {
    if (!this.#ativo) return;
    if (this.#emExecucao === id || this.#fila.includes(id)) {
      this.#coalescidos += 1;
      const emCursoHaMs = this.#emExecucao === id ? this.#agora().getTime() - this.#comecouEm : 0;
      this.#anuncia(
        `[refresh] '${id}' disparou (${motivo}) mas já estava em voo — descartado. ` +
          `Se isto repete, o intervalo do grupo é menor que o custo dele.`,
      );
      registra(this.#snapshotDir, {
        evento: 'disparo-coalescido',
        quando: this.#agora().toISOString(),
        grupo: id,
        emCursoHaMs,
      });
      return;
    }
    this.#fila.push(id);
    this.#bombeia();
  }

  /** Um de cada vez, sempre — ver o item 2 do cabeçalho (read-modify-write do manifesto). */
  #bombeia(): void {
    if (!this.#ativo || this.#emExecucao !== null) return;
    // Nada começa enquanto a máquina está voltando: o filho nasceria sem rede e
    // falharia em duração normal, que é a segunda população de falha medida entre 18
    // e 21/09/2026 (ver `CARENCIA_APOS_RETOMADA_MS`). A fila não se perde — ela
    // espera, e `#destravaCarencia` a bombeia quando a carência vence.
    if (this.#liberadoEm > 0 && this.#agora().getTime() < this.#liberadoEm) return;
    this.#liberadoEm = 0;
    const id = this.#fila.shift();
    if (id === undefined) return;
    this.#emExecucao = id;
    this.#comecouEm = this.#agora().getTime();
    const aborto = new AbortController();
    this.#aborto = aborto;
    void this.#executa(id, aborto.signal).finally(() => {
      this.#emExecucao = null;
      this.#aborto = null;
      this.#bombeia();
    });
  }

  async #executa(id: string, sinal?: AbortSignal): Promise<void> {
    const grupo = this.#grupos.get(id);
    if (!grupo) return;
    const inicio = this.#agora();
    let resultado: ResultadoDeExecucao;
    try {
      resultado = await this.#roda(grupo, sinal);
    } catch (err) {
      // `rodaGrupoAssincrono` promete não rejeitar, mas `roda` é injetável — e um
      // agendador que morre porque a dependência dele lançou seria o mesmo defeito
      // de sempre, só que mais caro: leva a API junto.
      resultado = { ok: false, erro: mensagem(err) };
    }
    const fim = this.#agora();
    const duracaoMs = fim.getTime() - inicio.getTime();

    // **Uma carga que a máquina congelou não é uma carga que falhou**, e a diferença
    // muda o que o operador vê e o que ele faz a respeito. Em 19/09/2026 esta mesma
    // execução virou "cargas falharam: alocacao-patrimonio, apuracao-premiacao, ..."
    // com onze nomes — e nenhuma das onze tinha problema: o host suspendeu 28 s
    // depois do começo e o exit 1 foi o driver relatando conexão morta.
    //
    // Sai daqui sem tocar em `#status`: `falhasConsecutivas` não sobe, o
    // `refresh-status.json` não fica vermelho, e o grupo volta para a FRENTE da fila.
    // O que continua de pé é o alarme que importa — `estaVencido` mede idade do
    // último SUCESSO, então dormir três dias continua acendendo "vencida", com razão.
    const interrompida = this.#interrompidaPorSuspensao;
    this.#interrompidaPorSuspensao = false;
    if (interrompida && !resultado.ok) {
      registra(this.#snapshotDir, {
        evento: 'carga-interrompida',
        quando: fim.toISOString(),
        grupo: id,
        duracaoMs,
        motivo: 'máquina suspensa',
      });
      this.#anuncia(
        `[refresh] ${id}: interrompida pela suspensão da máquina depois de ` +
          `${(duracaoMs / 60_000).toFixed(0)} min — não conta como falha, vai ser refeita agora.`,
      );
      // Na FRENTE: este grupo perdeu a vez inteira, enquanto quem está atrás dele
      // apenas esperou. `#enfileira` não serve aqui — ela põe no fim e coalesce.
      if (this.#ativo && !this.#fila.includes(id)) this.#fila.unshift(id);
      return;
    }

    this.#execucoes += 1;
    if (!resultado.ok) this.#falhas += 1;

    registra(this.#snapshotDir, {
      evento: 'grupo',
      quando: fim.toISOString(),
      grupo: id,
      ok: resultado.ok,
      duracaoMs,
      ...(resultado.erro ? { erro: resultado.erro } : {}),
    });

    this.#status = {
      ...this.#status,
      [id]: proximoStatus(this.#status[id], fim, resultado, duracaoMs),
    };
    try {
      await escreveStatus(this.#snapshotDir, this.#status);
    } catch (err) {
      // Mesma regra de `historico.ts`: observabilidade não interrompe trabalho. O
      // status em memória continua certo, e o próximo grupo tenta gravar de novo.
      this.#anuncia(`[refresh] não consegui gravar refresh-status.json: ${mensagem(err)}`);
    }

    this.#anuncia(
      `[refresh] ${id}: ${resultado.ok ? 'OK' : 'FALHOU'} em ` +
        `${(duracaoMs / 1000).toFixed(1)}s${resultado.erro ? ` (${resultado.erro})` : ''}` +
        `${this.#fila.length > 0 ? ` — na fila: ${this.#fila.join(', ')}` : ''}`,
    );

    try {
      this.#aoConcluirGrupo?.(id, resultado, duracaoMs);
    } catch {
      // Gancho de terceiro não derruba a cadência.
    }
  }
}

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
