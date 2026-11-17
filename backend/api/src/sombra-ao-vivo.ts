// O modo sombra da fonte ao vivo (docs/DECISAO-AO-VIVO.md, fase 1).
//
// Depois que a página sai do snapshot, a MESMA pergunta (página, visuais, filtros,
// cliques, janela) é refeita ao vivo em segundo plano e as duas respostas são comparadas
// visual a visual (`comparaPaginas`). Nada daqui chega à tela — nem o resultado, nem o
// erro: é o que permite medir, por período e por visual, onde o ao vivo concorda com o
// snapshot antes de qualquer pedido depender dele.
//
// Os limites, e por quê:
//   - só período FECHADO (`ate` até hoje, no relógio do negócio): no mês corrente as
//     duas pontas divergem pela idade do snapshot, não pela regra;
//   - uma rodada por vez, e a mesma pergunta no máximo uma vez por `intervaloMs`: cada
//     rodada é ~15 s de SRD (agenda, relatos e protocolos do mês, 22–23/10/2026);
//   - desligado por padrão: `index.ts` só a cria com `AO_VIVO_SOMBRA=1`, com o contexto
//     de `contexto-ao-vivo.ts`; e página servida ao vivo (`AO_VIVO_PAGINAS`) não passa
//     por aqui — compararia o ao vivo com ele mesmo.
//
// O log diz QUAIS visuais divergem e a forma da diferença, nunca o valor (CLAUDE.md,
// regra 2).

import type { ContextoAoVivo } from '../../packages/ao-vivo/src/executor.ts';
import { decideAoVivo, type Decisao, type PeriodoAoVivo } from '../../packages/ao-vivo/src/periodo.ts';
import { buscaDoPeriodo } from '../../packages/ao-vivo/src/snapshot-do-periodo.ts';
import { relogioDeParede } from '../../packages/measure-engine/src/relogio.ts';
import type { SemanticModel } from '../../packages/semantic-model/src/model.ts';
import type { DashboardSpec, FiltroSpec } from '../../packages/widget-engine/src/spec.ts';
import type { Janela, PaginaCalculada } from './calcula.ts';
import { calculaSobrePeriodo, comparaPaginas, type Comparacao } from './pagina-ao-vivo.ts';

export interface ObservacaoDaSombra {
  readonly dash: DashboardSpec;
  readonly alvo: DashboardSpec;
  readonly daTela: readonly FiltroSpec[];
  readonly janela: Janela;
  readonly clicados: readonly { tabela: string; coluna: string }[];
  readonly agora: Date;
  /** A página que o snapshot acabou de responder. */
  readonly pagina: PaginaCalculada;
}

/** O que `observa` recebe por injeção — o `Servidor` só conhece esta forma. */
export interface ObservadorAoVivo {
  observa(o: ObservacaoDaSombra): void;
}

export interface OpcoesDaSombra {
  readonly ctx: ContextoAoVivo;
  readonly model: SemanticModel;
  /** De onde copiar as queries pequenas da página (capacidade, clima, hora). */
  readonly snapshotDir: string;
  /** Padrão: só `agendamento-field`, a única página da fase 1. */
  readonly paginas?: readonly string[];
  /** A mesma pergunta não roda de novo antes disto. Padrão: 1 h. */
  readonly intervaloMs?: number;
  readonly registra?: (linha: string) => void;
  /** O `Metricas.conta` do servidor, para `/api/saude` mostrar as rodadas. */
  readonly conta?: (nome: string, quanto: number) => void;
  readonly tmp?: string;
}

export interface RodadaDaSombra {
  readonly pagina: string;
  readonly periodo: PeriodoAoVivo;
  readonly comparacao: Comparacao;
  readonly ms: { readonly busca: number; readonly escrita: number; readonly carga: number; readonly calculo: number };
}

const UMA_HORA_MS = 3_600_000;

const s = (ms: number): string => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

export class SombraAoVivo implements ObservadorAoVivo {
  readonly #o: OpcoesDaSombra;
  readonly #paginas: ReadonlySet<string>;
  readonly #intervaloMs: number;
  /** Pergunta → quando rodou. Podado a cada observação: nunca passa do que coube na última hora. */
  readonly #rodadas = new Map<string, number>();
  #emCurso: Promise<RodadaDaSombra | null> | null = null;

  constructor(o: OpcoesDaSombra) {
    this.#o = o;
    this.#paginas = new Set(o.paginas ?? ['agendamento-field']);
    this.#intervaloMs = o.intervaloMs ?? UMA_HORA_MS;
  }

  /** A rodada em curso, ou `null`. Para o teste e para o desligamento esperarem. */
  get emCurso(): Promise<RodadaDaSombra | null> | null {
    return this.#emCurso;
  }

  /**
   * Síncrona, e nunca lança: quem chama está no meio de responder um pedido, e a
   * sombra não pode atrasá-lo nem derrubá-lo.
   */
  observa(obs: ObservacaoDaSombra): void {
    try {
      if (!this.#paginas.has(obs.dash.id)) return;
      const d = decideAoVivo(obs.dash, obs.daTela, this.#o.model);
      if ('porque' in d) {
        this.#conta('sombra_fora_do_ao_vivo');
        return;
      }
      const hoje = relogioDeParede(obs.agora).toISOString().slice(0, 10);
      if (d.periodo.ate > hoje) {
        this.#conta('sombra_periodo_aberto');
        return;
      }
      if (this.#emCurso) {
        this.#conta('sombra_ocupada');
        return;
      }
      const agora = obs.agora.getTime();
      for (const [k, quando] of this.#rodadas) if (agora - quando >= this.#intervaloMs) this.#rodadas.delete(k);
      const chave = JSON.stringify([
        obs.dash.id,
        (obs.alvo.visuals ?? []).map((v) => v.id),
        obs.daTela.map((f) => [f.entity, f.property, f.nivel ?? null, f.conditions]),
        obs.clicados,
        [obs.janela.de, obs.janela.linhas, obs.janela.termo ?? null],
      ]);
      if (this.#rodadas.has(chave)) {
        this.#conta('sombra_repetida');
        return;
      }
      this.#rodadas.set(chave, agora);
      this.#emCurso = this.#roda(obs, d).finally(() => {
        this.#emCurso = null;
      });
    } catch (err) {
      this.#falhou(obs.dash.id, err);
    }
  }

  async #roda(obs: ObservacaoDaSombra, d: Exclude<Decisao, { porque: string }>): Promise<RodadaDaSombra | null> {
    const { periodo, fora } = d;
    try {
      this.#conta('sombra_rodadas');
      const dados = await buscaDoPeriodo(this.#o.ctx, periodo, obs.agora);
      const vivo = await calculaSobrePeriodo({
        model: this.#o.model,
        dash: obs.dash,
        alvo: obs.alvo,
        fora,
        ...(d.formaCompleta ? { formaCompleta: d.formaCompleta } : {}),
        janela: obs.janela,
        clicados: obs.clicados,
        agora: obs.agora,
        dados,
        pequenasDe: this.#o.snapshotDir,
        ...(this.#o.tmp ? { tmp: this.#o.tmp } : {}),
      });
      const comparacao = comparaPaginas(obs.pagina, vivo.pagina, fora);
      this.#conta('sombra_visuais_iguais', comparacao.iguais);
      this.#conta('sombra_visuais_so_ordem', comparacao.soOrdem.length);
      this.#conta('sombra_visuais_diferentes', comparacao.diferentes.length);
      const rodada: RodadaDaSombra = {
        pagina: obs.dash.id,
        periodo,
        comparacao,
        ms: { busca: dados.ms.total, ...vivo.ms },
      };
      const diferentes = comparacao.diferentes.map((x) => `${x.titulo ?? x.id} (${x.porque})`).join('; ');
      this.#registra(
        `[ao-vivo] sombra ${obs.dash.id} [${periodo.desde}, ${periodo.ate}): ` +
          `${comparacao.iguais} de ${comparacao.comparados} visuais iguais` +
          `${comparacao.soOrdem.length ? `, ${comparacao.soOrdem.length} só na ordem de linhas empatadas` : ''}` +
          `, ${comparacao.fora} fora do ao vivo` +
          `${diferentes ? ` — diferentes: ${diferentes}` : ''}. ` +
          `Busca ${s(dados.ms.total)} (agenda ${s(dados.ms.agenda)}, ` +
          `protocolos ${s(dados.ms.protocolos)}; ${dados.protocolos} protocolo(s)), escrita ${s(vivo.ms.escrita)}, ` +
          `carga ${s(vivo.ms.carga)}, cálculo ${s(vivo.ms.calculo)}`,
      );
      return rodada;
    } catch (err) {
      this.#falhou(obs.dash.id, err);
      return null;
    }
  }

  #falhou(pagina: string, err: unknown): void {
    this.#conta('sombra_erro');
    // A mensagem de erro do banco ou do motor pode citar o SQL, não o dado; o nome da
    // classe e a primeira linha bastam para achar a causa no código.
    const msg = err instanceof Error ? `${err.name}: ${err.message.split('\n')[0]!.slice(0, 200)}` : String(err).slice(0, 200);
    this.#registra(`[ao-vivo] sombra ${pagina} falhou (a resposta da tela não muda): ${msg}`);
  }

  #conta(nome: string, quanto = 1): void {
    try {
      this.#o.conta?.(nome, quanto);
    } catch {
      // Contador que falha não é motivo para a sombra falhar.
    }
  }

  #registra(linha: string): void {
    (this.#o.registra ?? console.log)(linha);
  }
}
