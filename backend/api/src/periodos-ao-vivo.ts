// O snapshot pequeno de cada período ao vivo, gravado uma vez e reaproveitado enquanto
// vale (docs/DECISAO-AO-VIVO.md).
//
// **Por que existe.** A Agendamento Field é invalidada pelo poller a cada ~35 s em horário
// de operação (ACHADOS #175), e cada invalidação reaquece o período padrão, os três meses
// anteriores e cada valor dos seletores de até 20 valores. Se cada um desses cálculos
// fosse ao SRD, seriam consultas de 17–25 s em rajada a cada meio minuto. Aqui a busca no
// SRD acontece UMA vez por período e vale por um tempo — `ttlAbertoMs` no período que
// inclui hoje, `ttlFechadoMs` nos outros —, e os recálculos da página rodam nas workers
// sobre o snapshot pequeno já gravado, em décimos de segundo.
//
// **Vencido, ele continua servindo** o snapshot anterior enquanto o novo é buscado em
// segundo plano: depois da primeira busca de um período, ninguém espera o SRD de novo. E
// as buscas passam por uma fila com teto (`FilaDeBuscas`), nem que sejam de períodos ou
// conjuntos diferentes — o SRD é compartilhado, e cada busca tem o seu pico de memória.
//
// A pasta de uma geração substituída sai depois de `gracaMs`: uma worker pode estar no
// meio da leitura dela, e a leitura é rápida (décimos de segundo), então a folga basta.

import fs from 'node:fs';
import path from 'node:path';
import type { PeriodoAoVivo } from '../../packages/ao-vivo/src/periodo.ts';
import { relogioDeParede } from '../../packages/measure-engine/src/relogio.ts';

export interface GeracaoDoPeriodo {
  readonly periodo: PeriodoAoVivo;
  readonly dir: string;
  /** ISO de quando o SRD foi lido — a idade do dado que a tela mostra. */
  readonly geradoEm: string;
  /** Muda a cada geração: é o que faz a worker largar o conjunto da geração anterior. */
  readonly identidade: string;
  readonly expiraEm: number;
  /** Quanto a busca levou (SRD, M e gravação). */
  readonly ms: number;
  readonly protocolos: number;
  /** O pico de memória do processo que fez a busca, quando ela rodou num filho. */
  readonly picoMB?: number;
}

/**
 * A fila das buscas no SRD. Pode ser dividida entre vários `PeriodosAoVivo` — a agenda,
 * o conjunto do ano e o da janela —, e aí o teto vale para todos juntos: cada busca é um
 * processo filho com o seu pico de memória (`geracao-em-processo.ts`), e é a soma deles
 * que cabe ou não no contêiner.
 */
export class FilaDeBuscas {
  readonly #max: number;
  readonly #fila: (() => void)[] = [];
  #correndo = 0;

  constructor(max: number) {
    this.#max = Math.max(1, max);
  }

  vez(): Promise<void> {
    if (this.#correndo < this.#max) {
      this.#correndo++;
      return Promise.resolve();
    }
    return new Promise((ok) => this.#fila.push(ok));
  }

  libera(): void {
    const proximo = this.#fila.shift();
    if (proximo) proximo();
    else this.#correndo--;
  }

  get correndo(): number {
    return this.#correndo;
  }

  get naFila(): number {
    return this.#fila.length;
  }
}

export interface OpcoesDosPeriodos {
  /**
   * Busca o período no SRD e grava o snapshot dele em `dir` (`geraConjunto`, aqui ou num
   * processo filho). Devolve quantos protocolos vieram, para a saúde.
   */
  readonly gera: (periodo: PeriodoAoVivo, dir: string, agora: Date) => Promise<{ protocolos: number; picoMB?: number }>;
  /** Onde as pastas moram. Esvaziada na criação: o que sobrou de outro processo não vale. */
  readonly dirBase: string;
  readonly agora?: () => Date;
  /** Padrão: 2 min. É a frescura do mês corrente. */
  readonly ttlAbertoMs?: number;
  /** Padrão: 1 h. Mês fechado quase não muda (relato atrasado, protocolo reaberto). */
  readonly ttlFechadoMs?: number;
  /** Padrão: 8 períodos guardados; o menos usado sai. */
  readonly maxPeriodos?: number;
  /** Padrão: 2 buscas ao mesmo tempo. Ignorado quando `fila` vem de fora. */
  readonly maxBuscasJuntas?: number;
  /** A fila dividida com outros períodos ao vivo. Padrão: uma só deste, com `maxBuscasJuntas`. */
  readonly fila?: FilaDeBuscas;
  /** Padrão: 2 min de folga antes de apagar a pasta de uma geração substituída. */
  readonly gracaMs?: number;
  /**
   * O pedido que chega antes da PRIMEIRA geração de um período espera a busca? Padrão:
   * sim — o mês da agenda fica pronto em ~20 s, e quem pediu recebe o ao vivo. Não, para
   * o ano (~70 s, mais que o teto do pedido): enquanto a busca corre, o pedido sai na
   * hora pelo snapshot, em vez de esperar 45 s para sair pelo mesmo snapshot.
   */
  readonly esperaAPrimeira?: boolean;
  /** Padrão: 1 min. Quanto `marca` espera, depois de uma busca que falhou, para pedir outra. */
  readonly esperaAposFalhaMs?: number;
  readonly registra?: (linha: string) => void;
}

const chave = (p: PeriodoAoVivo): string => `${p.desde}..${p.ate}`;

export class PeriodosAoVivo {
  readonly #o: Required<Omit<OpcoesDosPeriodos, 'registra' | 'fila'>> & Pick<OpcoesDosPeriodos, 'registra'>;
  /** Período → geração atual. A ordem de inserção é a do uso: o primeiro é o que sai. */
  readonly #geracoes = new Map<string, GeracaoDoPeriodo>();
  readonly #emVoo = new Map<string, Promise<GeracaoDoPeriodo>>();
  /** Período → quando a última busca dele falhou (só até a próxima dar certo). */
  readonly #falhouEm = new Map<string, number>();
  readonly #fila: FilaDeBuscas;
  #seq = 0;

  constructor(o: OpcoesDosPeriodos) {
    this.#o = {
      agora: () => new Date(),
      ttlAbertoMs: 120_000,
      ttlFechadoMs: 3_600_000,
      maxPeriodos: 8,
      maxBuscasJuntas: 2,
      gracaMs: 120_000,
      esperaAPrimeira: true,
      esperaAposFalhaMs: 60_000,
      ...o,
    };
    this.#fila = o.fila ?? new FilaDeBuscas(this.#o.maxBuscasJuntas);
    fs.rmSync(o.dirBase, { recursive: true, force: true });
    fs.mkdirSync(o.dirBase, { recursive: true });
  }

  /**
   * O snapshot do período: o que vale; o vencido, já pedindo o novo por baixo; ou, na
   * primeira vez, o que a busca trouxer. Erra só quando não há geração nenhuma e a busca
   * falha — quem chama cai para o snapshot de hoje.
   */
  obtem(periodo: PeriodoAoVivo): Promise<GeracaoDoPeriodo> {
    const k = chave(periodo);
    const g = this.#geracoes.get(k);
    if (!g && !this.#o.esperaAPrimeira) {
      // Começa a busca (ou deixa a que já corre) e não espera por ela.
      this.#renova(periodo).catch(() => undefined);
      return Promise.reject(new Error(`a primeira busca de ${k} no SRD ainda corre`));
    }
    if (!g) return this.#renova(periodo);
    this.#geracoes.delete(k);
    this.#geracoes.set(k, g);
    if (this.#o.agora().getTime() >= g.expiraEm) {
      // A falha já virou linha de log dentro de `#busca`; a geração vencida segue servindo.
      this.#renova(periodo).catch(() => undefined);
    }
    return Promise.resolve(g);
  }

  /**
   * A geração que um pedido deste período vai encontrar, para a chave do cache de
   * respostas (`servidor.ts`). Sem ela a chave só via o snapshot de hoje: a resposta que
   * saiu pelo snapshot antes da primeira geração — e a de uma geração já substituída —
   * seguia servida até o snapshot mudar, que no grupo médio leva horas.
   *
   * Vencida ou ausente, já pede a busca por baixo: um acerto no cache não chega a
   * `obtem`, e sem isto o período só se renovaria quando a chave mudasse por outro
   * motivo. Depois de uma busca que falhou, espera `esperaAposFalhaMs` antes de tentar de
   * novo — com o SRD fora, cada pedido seria uma busca.
   *
   * Sem `:` (`apagaPagina` acha a página por `:id:` na chave), e com o instante da busca:
   * o Redis atravessa reinícios, e um número de sequência repetiria.
   */
  marca(periodo: PeriodoAoVivo): string {
    const k = chave(periodo);
    const g = this.#geracoes.get(k);
    const agora = this.#o.agora().getTime();
    const falhou = this.#falhouEm.get(k);
    const vencida = !g || agora >= g.expiraEm;
    if (vencida && !(falhou !== undefined && agora - falhou < this.#o.esperaAposFalhaMs)) {
      this.#renova(periodo).catch(() => undefined);
    }
    return g ? g.identidade.replace(/:/g, '') : 'ao-vivo-pendente';
  }

  /**
   * A geração do período, esperando a busca se ainda não há uma — para quem quer o
   * período pronto (o aquecimento na subida, os testes), e não para o pedido de tela.
   */
  pronto(periodo: PeriodoAoVivo): Promise<GeracaoDoPeriodo> {
    return this.#geracoes.get(chave(periodo)) ? this.obtem(periodo) : this.#renova(periodo);
  }

  /** Para `/api/saude`: o que está guardado e de quando, e quantas buscas correm. */
  estado(): {
    periodos: { periodo: string; geradoEm: string; venceEm: string; ms: number; protocolos: number; picoMB?: number }[];
    buscando: number;
    naFila: number;
  } {
    return {
      periodos: [...this.#geracoes.values()].map((g) => ({
        periodo: chave(g.periodo),
        geradoEm: g.geradoEm,
        venceEm: new Date(g.expiraEm).toISOString(),
        ms: g.ms,
        protocolos: g.protocolos,
        ...(g.picoMB !== undefined ? { picoMB: g.picoMB } : {}),
      })),
      buscando: this.#fila.correndo,
      naFila: this.#fila.naFila,
    };
  }

  #renova(periodo: PeriodoAoVivo): Promise<GeracaoDoPeriodo> {
    const k = chave(periodo);
    const voo = this.#emVoo.get(k);
    if (voo) return voo;
    const p = this.#busca(periodo).finally(() => this.#emVoo.delete(k));
    this.#emVoo.set(k, p);
    return p;
  }

  async #busca(periodo: PeriodoAoVivo): Promise<GeracaoDoPeriodo> {
    await this.#fila.vez();
    let dir: string | null = null;
    try {
      const agora = this.#o.agora();
      const t0 = Date.now();
      dir = fs.mkdtempSync(path.join(this.#o.dirBase, `${periodo.desde}_`));
      const { protocolos, picoMB } = await this.#o.gera(periodo, dir, agora);
      const hoje = relogioDeParede(agora).toISOString().slice(0, 10);
      const g: GeracaoDoPeriodo = {
        periodo,
        dir,
        geradoEm: agora.toISOString(),
        identidade: `ao-vivo#${++this.#seq}@${agora.toISOString()}`,
        expiraEm: agora.getTime() + (periodo.ate > hoje ? this.#o.ttlAbertoMs : this.#o.ttlFechadoMs),
        ms: Date.now() - t0,
        protocolos,
        ...(picoMB !== undefined ? { picoMB } : {}),
      };
      const k = chave(periodo);
      this.#falhouEm.delete(k);
      const anterior = this.#geracoes.get(k);
      this.#geracoes.delete(k);
      this.#geracoes.set(k, g);
      if (anterior) this.#descarta(anterior.dir);
      while (this.#geracoes.size > this.#o.maxPeriodos) {
        const [velha, gv] = this.#geracoes.entries().next().value as [string, GeracaoDoPeriodo];
        this.#geracoes.delete(velha);
        this.#descarta(gv.dir);
      }
      return g;
    } catch (err) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
      this.#falhouEm.set(chave(periodo), this.#o.agora().getTime());
      const msg = err instanceof Error ? err.message.split('\n')[0]!.slice(0, 200) : String(err).slice(0, 200);
      this.#o.registra?.(`[ao-vivo] busca de ${chave(periodo)} no SRD falhou: ${msg}`);
      throw err;
    } finally {
      this.#fila.libera();
    }
  }

  #descarta(dir: string): void {
    const t = setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), this.#o.gracaMs);
    t.unref?.();
  }
}
