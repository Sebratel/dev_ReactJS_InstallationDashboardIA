// O reaquecimento automático — o que mantém o backend sempre com a resposta pronta.
//
// **O problema que ele resolve, com os números.** Depois que o TTL virou prazo de
// guarda (ver `cache-resposta.ts`), a resposta pronta só deixa de valer em dois
// momentos: quando o snapshot é refeito e quando o dia vira. Isso tirou o recálculo
// de 36 s que acontecia a cada minuto — mas não tirou o **primeiro** de cada ciclo.
// Sem ninguém para reaquecer, a conta continua caindo no colo de quem abrir a página
// primeiro: 8 a 36 s por página, e ~2 min em `agendamento-field`.
//
// Quem paga isso hoje é uma pessoa esperando na frente da tela. A ideia aqui é
// simples: o servidor sabe **antes** dela que o dado mudou, então que ele pague.
//
// **Como ele sabe que mudou.** Conferindo o carimbo do snapshot de tempos em tempos.
// Conferir por relógio seria errado no caminho de uma resposta — lá a exatidão é
// obrigatória e o carimbo é recalculado a cada pedido. Aqui não: este laço não decide
// o que responder, só decide *quando adiantar trabalho*. Chegar alguns segundos
// atrasado não produz número errado nenhum; produz, no pior caso, um visitante que
// pagou o recálculo que este laço ia pagar por ele. É a diferença entre um relógio na
// decisão e um relógio na antecipação.
//
// **Por HTTP contra si mesmo, e não chamando o cálculo por dentro.** O cache é
// endereçado pela chave exata do pedido — usuário, filtros, visual, janela, carimbo,
// dia. Reaquecer por um caminho paralelo encheria chaves *parecidas* com as que a tela
// pede, e o acerto nunca aconteceria. Fazendo o mesmo GET que o navegador faz, é
// impossível encher a chave errada.
//
// REGRA DE SAÍDA: nunca imprime valor de linha. Só nome de página, tempo e contagem.
//
// **Por que busca `/layout` antes de aquecer.** Fase L5, R4: o navegador nunca pede a
// página inteira — sempre lista um subconjunto explícito de visuais (`idsIniciais`, o
// corte acima da dobra). Aquecer `/api/dashboards/:id` sem `?visual=` enche a chave de
// cache `'*'` (`ChaveDeResposta`), que o navegador NUNCA pede depois de R4 — este laço
// continuaria se anunciando "quente" sem nunca acertar a chave que a tela realmente
// pede. Qualquer falha ao buscar o layout cai de volta para a URL antiga: aquecer a
// chave errada é melhor do que não aquecer nenhuma.

import { idsIniciais } from '../../../tools/layout/src/corte-eager.ts';
import type { LayoutSpec } from '../../../tools/layout/src/schema.ts';

/** O intervalo padrão entre duas conferidas do carimbo. */
export const INTERVALO_PADRAO_MS = 5_000;

export interface PaginaAquecida {
  pagina: string;
  ms: number;
  /** `null` quando o pedido falhou por rede ou status inesperado. */
  status: number | null;
  erro?: string;
}

export interface Passada {
  /** O carimbo que esta passada aqueceu. */
  carimbo: string;
  paginas: PaginaAquecida[];
  ms: number;
  /** true quando o carimbo mudou no meio: o que foi aquecido já nasceu velho. */
  obsoleta: boolean;
}

export interface OpcoesDoAquecedor {
  /** Ex.: `http://127.0.0.1:3100`. Sem barra no fim. */
  base: string;
  /**
   * A identidade do que está em disco. É a mesma conta do `Servidor` — passada por
   * fora para que este módulo não precise conhecer nem snapshot nem manifesto.
   */
  carimbo: () => string;
  buscar?: typeof fetch;
  agora?: () => number;
  intervaloMs?: number;
  /** Onde as linhas aparecem. Padrão: `console.error`, que não suja a saída de dados. */
  anuncia?: (linha: string) => void;
}

export class Aquecedor {
  readonly #base: string;
  readonly #carimbo: () => string;
  readonly #buscar: typeof fetch;
  readonly #agora: () => number;
  readonly #intervaloMs: number;
  readonly #anuncia: (linha: string) => void;

  /** O carimbo que já foi aquecido. `null` = nada foi aquecido ainda. */
  #aquecido: string | null = null;
  /** Guarda contra duas passadas ao mesmo tempo. Ver `passada`. */
  #ocupado = false;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: OpcoesDoAquecedor) {
    this.#base = opts.base.replace(/\/$/, '');
    this.#carimbo = opts.carimbo;
    this.#buscar = opts.buscar ?? fetch;
    this.#agora = opts.agora ?? (() => Date.now());
    this.#intervaloMs = opts.intervaloMs ?? INTERVALO_PADRAO_MS;
    this.#anuncia = opts.anuncia ?? ((l) => console.error(l));
  }

  /**
   * Começa a vigiar. A primeira passada sai na hora — é o aquecimento de arranque,
   * que é o que impede um restart de devolver a tela branca de dois minutos.
   */
  inicia(): void {
    if (this.#timer !== null) return;
    void this.tenta();
    this.#timer = setInterval(() => void this.tenta(), this.#intervaloMs);
    // `unref`: este laço não é motivo para o processo continuar vivo. Sem isto, um
    // `npm run api` que devia encerrar ficaria pendurado num temporizador de fundo.
    this.#timer.unref?.();
  }

  para(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * Já existe uma passada completa e ainda válida?
   *
   * Sai em `GET /api/saude` para que `npm start` possa **esperar** este aquecimento
   * em vez de disparar o seu por cima. Dois aquecimentos ao mesmo tempo calculariam
   * as mesmas páginas em duplicata, disputando a CPU de um processo só.
   */
  get pronto(): boolean {
    return this.#aquecido !== null;
  }

  /**
   * Uma conferida: aquece **se** o carimbo mudou. Devolve `null` quando não havia
   * nada a fazer.
   *
   * Exposta para o teste não depender de temporizador — a alternativa seria um teste
   * que espera 5 s para afirmar uma coisa que acontece em 5 ms.
   */
  async tenta(): Promise<Passada | null> {
    // Duas passadas ao mesmo tempo dobrariam o pico de memória de uma máquina que
    // já roda no limite, e a segunda só recalcularia o que a primeira está
    // calculando. O carimbo novo não se perde: quem está aquecendo confere de novo
    // no fim, em `passada`.
    if (this.#ocupado) return null;
    const carimbo = this.#carimbo();
    if (carimbo === this.#aquecido) return null;
    return await this.passada(carimbo);
  }

  /** Aquece todas as páginas para este carimbo. Não lança: falha vira linha. */
  async passada(carimbo: string): Promise<Passada> {
    this.#ocupado = true;
    const t0 = this.#agora();
    const paginas: PaginaAquecida[] = [];
    try {
      const primeira = this.#aquecido === null;
      this.#anuncia(
        `[aquecedor] ${primeira ? 'arranque' : 'o snapshot mudou'} — aquecendo as páginas…`,
      );

      for (const id of await this.#lista()) {
        // Sequencial de propósito: a API é um processo só, e duas páginas ao mesmo
        // tempo dobram o pico de memória numa máquina de 16 GB.
        paginas.push(await this.#aquece(id));
      }

      // **O carimbo pode ter mudado no meio.** Um refresh que termina durante o
      // aquecimento deixaria tudo o que acabou de ser calculado inalcançável, e o
      // aquecedor iria dormir achando que fez o serviço. Não marcar como aquecido é
      // o que faz a próxima conferida recomeçar.
      const agora = this.#carimbo();
      const obsoleta = agora !== carimbo;
      this.#aquecido = obsoleta ? null : carimbo;

      const ms = this.#agora() - t0;
      const erros = paginas.filter((p) => p.status !== 200).length;
      this.#anuncia(
        obsoleta
          ? `[aquecedor] o snapshot mudou durante o aquecimento — refazendo na próxima volta`
          : `[aquecedor] ${paginas.length} páginas quentes em ${(ms / 1000).toFixed(1)}s` +
              (erros > 0 ? `, ${erros} com erro` : ''),
      );
      return { carimbo, paginas, ms, obsoleta };
    } finally {
      this.#ocupado = false;
    }
  }

  /** As páginas que a API declara. Vazio se ela não responder — a próxima volta tenta. */
  async #lista(): Promise<string[]> {
    try {
      const r = await this.#buscar(`${this.#base}/api/dashboards`);
      if (!r.ok) return [];
      const j = (await r.json()) as { dashboards?: { id: string }[] };
      return (j.dashboards ?? []).map((d) => d.id);
    } catch (err) {
      this.#anuncia(`[aquecedor] não consegui listar as páginas: ${mensagem(err)}`);
      return [];
    }
  }

  /**
   * Os ids que a abertura real vai pedir eager, ou `null` se não deu para saber. Nunca
   * lança: uma falha aqui cai de volta para a URL sem `?visual=` em `#aquece`, não
   * derruba o laço de aquecimento inteiro.
   */
  async #idsEager(pagina: string): Promise<string[] | null> {
    try {
      const r = await this.#buscar(
        `${this.#base}/api/dashboards/${encodeURIComponent(pagina)}/layout`,
      );
      if (!r.ok) return null;
      const layout = (await r.json()) as LayoutSpec;
      return idsIniciais(layout);
    } catch {
      return null;
    }
  }

  async #aquece(pagina: string): Promise<PaginaAquecida> {
    const t0 = this.#agora();
    try {
      const idsEager = await this.#idsEager(pagina);
      const url =
        idsEager && idsEager.length > 0
          ? `${this.#base}/api/dashboards/${encodeURIComponent(pagina)}?` +
            idsEager.map((id) => `visual=${encodeURIComponent(id)}`).join('&')
          : `${this.#base}/api/dashboards/${encodeURIComponent(pagina)}`;
      const r = await this.#buscar(url);
      // O corpo precisa ser drenado: sem isto o socket fica com resposta pendurada e
      // o `fetch` seguinte espera por ele.
      await r.arrayBuffer();
      const ms = this.#agora() - t0;
      if (r.status !== 200) {
        this.#anuncia(`[aquecedor]   ${pagina}: HTTP ${r.status} em ${(ms / 1000).toFixed(1)}s`);
      }
      return { pagina, ms, status: r.status };
    } catch (err) {
      const ms = this.#agora() - t0;
      this.#anuncia(`[aquecedor]   ${pagina}: ${mensagem(err)}`);
      return { pagina, ms, status: null, erro: mensagem(err) };
    }
  }
}

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
