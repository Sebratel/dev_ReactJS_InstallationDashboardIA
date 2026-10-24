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
// no máximo `maxBuscasJuntas` buscas correm ao mesmo tempo, nem que sejam de períodos
// diferentes — o SRD é compartilhado.
//
// A pasta de uma geração substituída sai depois de `gracaMs`: uma worker pode estar no
// meio da leitura dela, e a leitura é rápida (décimos de segundo), então a folga basta.

import fs from 'node:fs';
import path from 'node:path';
import type { PeriodoAoVivo } from '../../packages/ao-vivo/src/periodo.ts';
import type { DadosDoPeriodo } from '../../packages/ao-vivo/src/snapshot-do-periodo.ts';
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
}

export type DadosParaGravar = Pick<DadosDoPeriodo, 'consultas' | 'protocolos'> &
  Partial<Pick<DadosDoPeriodo, 'statusProtocoloDia'>>;

export interface OpcoesDosPeriodos {
  /** A busca no SRD (`buscaDoPeriodo`, com o contexto já montado). */
  readonly busca: (periodo: PeriodoAoVivo, agora: Date) => Promise<DadosParaGravar>;
  /** A gravação do snapshot do período (`escreveSnapshotDoPeriodo`, com as pequenas). */
  readonly grava: (dir: string, dados: DadosParaGravar, geradoEm: string) => Promise<void>;
  /** Onde as pastas moram. Esvaziada na criação: o que sobrou de outro processo não vale. */
  readonly dirBase: string;
  readonly agora?: () => Date;
  /** Padrão: 2 min. É a frescura do mês corrente. */
  readonly ttlAbertoMs?: number;
  /** Padrão: 1 h. Mês fechado quase não muda (relato atrasado, protocolo reaberto). */
  readonly ttlFechadoMs?: number;
  /** Padrão: 8 períodos guardados; o menos usado sai. */
  readonly maxPeriodos?: number;
  /** Padrão: 2 buscas ao mesmo tempo. */
  readonly maxBuscasJuntas?: number;
  /** Padrão: 2 min de folga antes de apagar a pasta de uma geração substituída. */
  readonly gracaMs?: number;
  /**
   * O pedido que chega antes da PRIMEIRA geração de um período espera a busca? Padrão:
   * sim — o mês da agenda fica pronto em ~20 s, e quem pediu recebe o ao vivo. Não, para
   * o ano (~70 s, mais que o teto do pedido): enquanto a busca corre, o pedido sai na
   * hora pelo snapshot, em vez de esperar 45 s para sair pelo mesmo snapshot.
   */
  readonly esperaAPrimeira?: boolean;
  readonly registra?: (linha: string) => void;
}

const chave = (p: PeriodoAoVivo): string => `${p.desde}..${p.ate}`;

export class PeriodosAoVivo {
  readonly #o: Required<Omit<OpcoesDosPeriodos, 'registra'>> & Pick<OpcoesDosPeriodos, 'registra'>;
  /** Período → geração atual. A ordem de inserção é a do uso: o primeiro é o que sai. */
  readonly #geracoes = new Map<string, GeracaoDoPeriodo>();
  readonly #emVoo = new Map<string, Promise<GeracaoDoPeriodo>>();
  readonly #fila: (() => void)[] = [];
  #buscando = 0;
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
      ...o,
    };
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
   * A geração do período, esperando a busca se ainda não há uma — para quem quer o
   * período pronto (o aquecimento na subida, os testes), e não para o pedido de tela.
   */
  pronto(periodo: PeriodoAoVivo): Promise<GeracaoDoPeriodo> {
    return this.#geracoes.get(chave(periodo)) ? this.obtem(periodo) : this.#renova(periodo);
  }

  /** Para `/api/saude`: o que está guardado e de quando, e quantas buscas correm. */
  estado(): {
    periodos: { periodo: string; geradoEm: string; venceEm: string; ms: number; protocolos: number }[];
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
      })),
      buscando: this.#buscando,
      naFila: this.#fila.length,
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
    await this.#vez();
    let dir: string | null = null;
    try {
      const agora = this.#o.agora();
      const t0 = Date.now();
      const dados = await this.#o.busca(periodo, agora);
      dir = fs.mkdtempSync(path.join(this.#o.dirBase, `${periodo.desde}_`));
      await this.#o.grava(dir, dados, agora.toISOString());
      const hoje = relogioDeParede(agora).toISOString().slice(0, 10);
      const g: GeracaoDoPeriodo = {
        periodo,
        dir,
        geradoEm: agora.toISOString(),
        identidade: `ao-vivo#${++this.#seq}@${agora.toISOString()}`,
        expiraEm: agora.getTime() + (periodo.ate > hoje ? this.#o.ttlAbertoMs : this.#o.ttlFechadoMs),
        ms: Date.now() - t0,
        protocolos: dados.protocolos,
      };
      const k = chave(periodo);
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
      const msg = err instanceof Error ? err.message.split('\n')[0]!.slice(0, 200) : String(err).slice(0, 200);
      this.#o.registra?.(`[ao-vivo] busca de ${chave(periodo)} no SRD falhou: ${msg}`);
      throw err;
    } finally {
      this.#libera();
    }
  }

  #descarta(dir: string): void {
    const t = setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), this.#o.gracaMs);
    t.unref?.();
  }

  #vez(): Promise<void> {
    if (this.#buscando < this.#o.maxBuscasJuntas) {
      this.#buscando++;
      return Promise.resolve();
    }
    return new Promise((ok) => this.#fila.push(ok));
  }

  #libera(): void {
    const proximo = this.#fila.shift();
    if (proximo) proximo();
    else this.#buscando--;
  }
}
