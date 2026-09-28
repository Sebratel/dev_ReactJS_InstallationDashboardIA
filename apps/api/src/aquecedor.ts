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

import { codificaFiltro, filtrosRecentes } from '../../../packages/widget-engine/src/index.ts';
import { N_FAIXAS_EAGER, idsIniciais, idsRestantes } from '../../../tools/layout/src/corte-eager.ts';
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
  /** O corte eager. Padrão: `N_FAIXAS_EAGER` (todas). Os testes do mecanismo passam 4. */
  nFaixasEager?: number;
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
  readonly #nFaixasEager: number;
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
    this.#nFaixasEager = opts.nFaixasEager ?? N_FAIXAS_EAGER;
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

  /**
   * Reaquece exatamente estas páginas — o reaquecimento pós-evento da F4.
   *
   * **Por que passa por aqui e não por um caminho novo.** O `Servidor` sabe
   * QUAIS páginas perderam cache; só este módulo sabe COMO enchê-lo de novo
   * acertando a mesma chave que o navegador pediria (corte eager do layout,
   * filtros padrão, valores das segmentações). Um reaquecimento escrito do lado
   * do servidor encheria chaves parecidas e o acerto nunca aconteceria — é o
   * defeito que o comentário no topo deste arquivo descreve.
   *
   * **A diferença para `passada`:** esta não mexe em `#aquecido`. O carimbo do
   * disco não mudou — o que mudou foi o overlay do poller —, então declarar um
   * carimbo como aquecido aqui faria o laço de arranque pular o aquecimento que
   * ele devia fazer.
   *
   * Se uma passada completa já estiver correndo, desiste: ela vai aquecer estas
   * páginas de qualquer jeito, e insistir só dobraria o pico de memória.
   *
   * Não lança — falha vira linha, como todo o resto deste módulo.
   */
  async reaquece(paginas: readonly string[]): Promise<PaginaAquecida[]> {
    if (this.#ocupado || paginas.length === 0) return [];
    this.#ocupado = true;
    const t0 = this.#agora();
    const feitas: PaginaAquecida[] = [];
    try {
      for (const id of paginas) {
        // Sequencial pelo mesmo motivo de `passada`: a API é um processo só.
        feitas.push(await this.#aquece(id));
      }
      const ms = this.#agora() - t0;
      const erros = feitas.filter((p) => p.status !== 200).length;
      this.#anuncia(
        `[reaquecedor] ${feitas.length} página(s) quentes em ${(ms / 1000).toFixed(1)}s` +
          (erros > 0 ? `, ${erros} com erro` : ''),
      );
      return feitas;
    } finally {
      this.#ocupado = false;
    }
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

  /**
   * As páginas que a API declara. Vazio se ela não responder — a próxima volta tenta.
   *
   * **Sem as de dica.** `l-inst`, `l-mapa` e `l-tec` são `type: Tooltip` no relatório
   * original: 550x400, um visual, exibidas ao pairar sobre outro visual e nunca
   * abertas por navegação. Aquecê-las gastava três das catorze entradas do ciclo
   * para encher um cache que ninguém consultava. Continuam calculáveis por
   * `/api/dashboards/l-inst` — o que muda é só quem o ciclo visita sozinho.
   */
  async #lista(): Promise<string[]> {
    try {
      const r = await this.#buscar(`${this.#base}/api/dashboards`);
      if (!r.ok) return [];
      const j = (await r.json()) as { dashboards?: { id: string; tooltip?: boolean }[] };
      return (j.dashboards ?? []).filter((d) => d.tooltip !== true).map((d) => d.id);
    } catch (err) {
      this.#anuncia(`[aquecedor] não consegui listar as páginas: ${mensagem(err)}`);
      return [];
    }
  }

  /**
   * O layout partido em dois: os ids que a abertura real pede eager e os que só
   * entram na rolagem (`idsRestantes`). `null` se não deu para saber.
   *
   * Nunca lança: uma falha aqui cai de volta para a URL sem `?visual=` em
   * `#aquece`, não derruba o laço de aquecimento inteiro.
   */
  async #idsDoLayout(pagina: string): Promise<{ eager: string[]; restantes: string[] } | null> {
    try {
      const r = await this.#buscar(
        `${this.#base}/api/dashboards/${encodeURIComponent(pagina)}/layout`,
      );
      if (!r.ok) return null;
      const layout = (await r.json()) as LayoutSpec;
      return {
        eager: idsIniciais(layout, this.#nFaixasEager),
        restantes: idsRestantes(layout, this.#nFaixasEager),
      };
    } catch {
      return null;
    }
  }

  async #aquece(pagina: string): Promise<PaginaAquecida> {
    const t0 = this.#agora();
    try {
      const layoutInfo = await this.#idsDoLayout(pagina);
      const idsEager = layoutInfo?.eager;
      const url =
        idsEager && idsEager.length > 0
          ? `${this.#base}/api/dashboards/${encodeURIComponent(pagina)}?` +
            idsEager.map((id) => `visual=${encodeURIComponent(id)}`).join('&')
          : `${this.#base}/api/dashboards/${encodeURIComponent(pagina)}`;
      const r = await this.#buscar(url);
      if (r.status === 200) {
        const body = (await r.json()) as {
          visuais?: {
            segmentacao?: {
              tabela: string;
              coluna: string;
              nivel?: string;
              naoFiltra?: string;
              niveis?: string[];
            };
          }[];
        };
        const segmentacoes = (body.visuais ?? [])
          .map((v) => v.segmentacao)
          .filter((s): s is NonNullable<typeof s> => Boolean(s));

        for (const s of segmentacoes) {
          if (s.naoFiltra && !s.niveis) continue;
          let params = `tabela=${encodeURIComponent(s.tabela)}&coluna=${encodeURIComponent(s.coluna)}`;
          if (s.nivel && !s.niveis) {
            params += `&nivel=${encodeURIComponent(s.nivel)}`;
          }
          try {
            const rVal = await this.#buscar(
              `${this.#base}/api/dashboards/${encodeURIComponent(pagina)}/valores?${params}`,
            );
            await rVal.arrayBuffer();
          } catch {
            // Ignora falha de aquecimento em seletor individual
          }
        }
      } else {
        await r.arrayBuffer();
      }

      // Se a página tem layout eager e filtros padrão (mês fechado ou ano corrente),
      // aquece também a chave com filtros, que é exatamente a que o navegador pede.
      // **O padrão E os períodos anteriores.** Antes daqui só o recorte de
      // abertura era adiantado, e trocar de mês — a interação mais comum do
      // relatório — caía sempre na primeira vez: ~1,6 s, contra 2–3 ms quando
      // a mesma combinação já foi pedida. Ver `filtrosRecentes`.
      if (idsEager && idsEager.length > 0) {
        for (const filtros of filtrosRecentes(pagina)) {
          const qFiltros = filtros.map((f) => `filtro=${encodeURIComponent(codificaFiltro(f))}`).join('&');
          const urlFiltrada = url.includes('?') ? `${url}&${qFiltros}` : `${url}?${qFiltros}`;
          try {
            const rFiltrada = await this.#buscar(urlFiltrada);
            await rFiltrada.arrayBuffer();
          } catch {
            // Ignora falha em filtro secundário: o recorte de abertura já foi
            // aquecido acima, e um mês anterior que falhe custa a primeira
            // visita, não a página.
          }
        }
      }

      // **Abaixo da dobra: o mesmo GET que a rolagem vai fazer, um por visual.**
      // `VisualNaDobra.tsx` pede cada um SOZINHO quando ele chega perto da
      // viewport, nunca em lote — então a chave a encher é a singular, e são
      // tantas requisições quantos forem os visuais. Pedir os seis de uma vez
      // encheria a chave `[a,b,c,d,e,f]` (`ChaveDeResposta.visuais`), que ninguém lê.
      //
      // **E com os filtros com que a página abre.** `filtros` também entra na
      // chave. A primeira versão disto pedia `?visual=X` e mais nada: em
      // `relatorio-do-mes` (2 visuais de sobra) e `premiacao-instalacao` (1)
      // acertava, porque elas abrem sem filtro — e em `agendamento-field`, a única
      // com peso aqui (6 de sobra, 10 faixas, a página que motivou o corte eager
      // inteiro no ACHADOS #94), acertava ZERO: ela abre travada no mês corrente, e
      // a rolagem pede `?filtro=<mês>&visual=X`. Medido em 15/09/2026.
      //
      // **Só o recorte de ABERTURA, e não os meses anteriores.** O eager adianta
      // `filtrosRecentes` inteiro porque trocar de mês é a interação do dia a dia e
      // o topo da página é barato. Aqui cada item é um visual pesado: cobrir os três
      // meses de `agendamento-field` seriam 18 cálculos por passada, para atender
      // quem troca de mês E rola até o fim. Quem esta linha existe para poupar é o
      // primeiro visitante depois de um refresh.
      const restantes = layoutInfo?.restantes ?? [];
      if (restantes.length > 0) {
        const abertura = filtrosRecentes(pagina)[0] ?? [];
        const qFiltros = abertura
          .map((f) => `filtro=${encodeURIComponent(codificaFiltro(f))}`)
          .join('&');
        for (const id of restantes) {
          const alvo =
            `${this.#base}/api/dashboards/${encodeURIComponent(pagina)}` +
            `?visual=${encodeURIComponent(id)}${qFiltros ? `&${qFiltros}` : ''}`;
          try {
            const rRestante = await this.#buscar(alvo);
            await rRestante.arrayBuffer();
          } catch {
            // Mesma degradação do filtro secundário: um visual abaixo da dobra que
            // falhe custa a primeira rolagem até ele, não a página.
          }
        }
      }

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
