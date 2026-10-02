// O poller de "quase-realtime" — SELECT direto no Voalle a cada poucos segundos,
// para que a tela mostre dado mais fresco que o refresh agendado sem precisar de
// CDC/Kafka. Ver docs/DECISAO-REALTIME.md, seção "poller próprio", e ACHADOS #89.
//
// **O que ele NÃO faz.** Não escreve no snapshot em disco — isso mudaria o
// carimbo global (`carimboDoSnapshot`) e derrubaria o cache de TODAS as páginas a
// cada volta, não só a que mudou (a mesma armadilha de `docs/DEPLOY.md`, rodando
// a cada 12s em vez de ocasionalmente). O resultado fica só em memória, neste
// processo, num "delta" pequeno por tabela — não uma cópia da tabela inteira.
//
// **Como o delta fecha com o que já está em disco.** `carrega()`
// (`packages/snapshot/src/carrega.ts`) chama `mescla()` — a MESMA função que
// `incremental.ts` usa para o refresh por dia — passando as linhas do disco como
// `antigas` e o delta deste poller como `novas`. O `corte` é o instante em que
// este poller começou a vigiar aquela tabela: é a partir dali, e só dali, que o
// delta é a verdade completa (nenhuma volta é pulada sem repetir a mesma janela —
// ver `#desde` abaixo).
//
// **Por que a marca é timestamp, não dia.** `incremental.ts` trunca a marca em
// `YYYY-MM-DD` porque um refresh por hora/dia pode pagar reler o dia inteiro. Um
// poller de 12 em 12 segundos não pode: rebuscar o dia inteiro a cada volta
// custaria segundos por volta, e a volta seguinte já estaria atrasada antes de
// terminar. Por isso a configuração mora em `specs/_catalog/realtime-poll.yaml`,
// não em `incremental.yaml` — são unidades diferentes, não a mesma ideia.
//
// REGRA DE SAÍDA: nunca imprime valor de linha. Só tabela, contagem e tempo.

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { normalizeName } from '../../../packages/semantic-model/src/model.ts';
import { costura, marcaDe, type Costura } from '../../../packages/snapshot/src/incremental.ts';
import type { OverlayDeTabela } from './overlay-realtime.ts';
import type { PgPoolLike } from '../../../packages/query-engine/src/connectors-sql.ts';
import { postgresRunner } from '../../../packages/query-engine/src/connectors-sql.ts';
import type { Escalar } from '../../../packages/snapshot/src/formato.ts';

const ARQUIVO = path.join('_catalog', 'realtime-poll.yaml');

export interface ConfigDePoll {
  query: string;
  tabela: string;
  intervaloMs: number;
  margemSegundos: number;
  chave: string[];
  marca: string[];
  costura: Costura;
}

interface ArquivoRealtimePoll {
  formato?: number;
  queries?: Record<
    string,
    {
      tabela?: string;
      intervalo_ms?: number;
      margem_segundos?: number;
      chave?: string[];
      marca?: string[];
      costura?: Costura;
    }
  >;
}

/**
 * Lê `specs/_catalog/realtime-poll.yaml`. Sem o arquivo, nenhuma query é polada
 * — que é o estado seguro por padrão, igual a `incremental.yaml`.
 */
export function leConfigDePoll(specsDir: string): Map<string, ConfigDePoll> {
  const p = path.join(specsDir, ARQUIVO);
  const fora = new Map<string, ConfigDePoll>();
  if (!fs.existsSync(p)) return fora;

  const doc = (parseYaml(fs.readFileSync(p, 'utf8')) ?? {}) as ArquivoRealtimePoll;
  if (doc.formato !== undefined && doc.formato !== 1) {
    throw new Error(`${p}: formato ${doc.formato}, esperado 1.`);
  }
  for (const [query, bruto] of Object.entries(doc.queries ?? {})) {
    const falta = (['tabela', 'costura'] as const).filter((k) => !bruto[k]);
    if (falta.length) throw new Error(`${p}: ${query} não declara ${falta.join(', ')}.`);
    if (!bruto.marca?.length) throw new Error(`${p}: ${query} não declara 'marca'.`);
    if (!bruto.chave?.length) throw new Error(`${p}: ${query} não declara 'chave'.`);
    fora.set(query, {
      query,
      tabela: bruto.tabela!,
      intervaloMs: bruto.intervalo_ms ?? 12_000,
      margemSegundos: bruto.margem_segundos ?? 30,
      chave: bruto.chave,
      marca: bruto.marca,
      costura: bruto.costura!,
    });
  }
  return fora;
}

/** A identidade de uma linha pela `chave` configurada — mesma conta de `mescla()`. */
function identidade(linha: Record<string, Escalar>, chaves: readonly string[]): string {
  return chaves
    .map(normalizeName)
    .map((k) => (linha[k] === null || linha[k] === undefined ? ' ' : String(linha[k])))
    .join('');
}

/**
 * O delta de uma tabela: a última versão de cada linha tocada desde que este
 * poller começou a vigiá-la, mais a janela que ele cobre.
 *
 * Estrutura pura, sem I/O — o que faz isto testável sem banco. `PollerRealtime`
 * é a casca fina que busca de verdade e chama estas funções.
 */
export interface DeltaDeTabela {
  /** Última versão de cada linha, por chave de grupo. */
  porChave: Map<string, Record<string, Escalar>>;
  /** Desde quando este delta é a verdade completa — vira `corte` em `mescla()`. */
  inicioJanela: Date;
  /** De onde a próxima busca parte. Só avança em busca bem-sucedida. */
  desde: Date;
}

/** Cria um delta vazio, cuja janela começa agora (ou em `desde`, se dado). */
export function novoDelta(agora: Date, desde: Date = agora): DeltaDeTabela {
  return { porChave: new Map(), inicioJanela: desde, desde };
}

/**
 * Aplica uma busca ao delta: cada linha nova substitui a versão anterior da
 * mesma chave (a busca mais recente é sempre a verdade sobre aquela chave), e o
 * ponteiro de busca avança para a marca mais alta encontrada, menos a margem.
 *
 * **Nunca volta `desde` para trás.** Uma busca que não trouxe nada de novo (ou
 * cuja marca mais alta ficou abaixo da margem já aplicada) não pode atrasar a
 * próxima janela — isso reabriria uma fresta já fechada e poderia reintroduzir
 * `sumidas` que já saíram do delta antes.
 */
export function aplicaBusca(
  delta: DeltaDeTabela,
  novas: readonly Record<string, Escalar>[],
  cfg: Pick<ConfigDePoll, 'chave' | 'marca' | 'margemSegundos'>,
  agora: Date,
): DeltaDeTabela {
  const porChave = new Map(delta.porChave);
  for (const l of novas) porChave.set(identidade(l, cfg.chave), l);

  const marca = marcaDe(novas, cfg.marca);
  let desde = delta.desde;
  if (marca !== null) {
    const candidato = new Date(marca.getTime() - cfg.margemSegundos * 1000);
    if (candidato.getTime() > desde.getTime()) desde = candidato;
  }

  return { porChave, inicioJanela: delta.inicioJanela, desde };
}

/**
 * Remove do delta o que já é velho o bastante para o refresh em lote ter
 * pegado — sem isto, um processo de dias acumularia toda mudança que já
 * viu, para sempre, num mapa que só cresce.
 *
 * `tetoHoras` é generoso de propósito: o pior caso de erro é o delta ficar um
 * pouco maior por mais tempo, nunca perder uma mudança recente. `chave.` do
 * corte já resolvido: entradas com marca abaixo do corte não descrevem mais
 * "o que mudou recentemente" — descrevem "o que este processo lembra".
 */
export function podaDelta(delta: DeltaDeTabela, marcaCols: readonly string[], agora: Date, tetoHoras = 48): DeltaDeTabela {
  const corte = agora.getTime() - tetoHoras * 3600_000;
  const porChave = new Map<string, Record<string, Escalar>>();
  for (const [k, l] of delta.porChave) {
    const m = marcaDe([l], marcaCols);
    if (m === null || m.getTime() >= corte) porChave.set(k, l);
  }
  return { ...delta, porChave };
}

/**
 * `OverlayDeTabela` e `mesclador` moram em `overlay-realtime.ts` e são
 * reexportados aqui — **uma definição só**. Eles saíram deste arquivo quando o
 * overlay passou a atravessar a fronteira da worker: quem MESCLA não pode ser
 * obrigado a importar quem BUSCA (este módulo carrega o driver do Postgres), e
 * duas cópias da mesma mesclagem divergiriam no primeiro conserto. Ver o
 * cabeçalho de `overlay-realtime.ts`.
 */
export { mesclador, type OverlayDeTabela } from './overlay-realtime.ts';

export function overlayDoDelta(
  delta: DeltaDeTabela,
  cfg: Pick<ConfigDePoll, 'chave' | 'marca'>,
): OverlayDeTabela {
  return { linhas: [...delta.porChave.values()], corte: delta.inicioJanela, chave: cfg.chave, marca: cfg.marca };
}

/**
 * Quantas chaves do delta MUDARAM de verdade entre duas voltas.
 *
 * **Por que isto precisa existir.** A janela de busca recua de
 * `margem_segundos` a cada volta, de propósito: é a folga contra relógio torto
 * que garante que nenhuma volta pule uma mudança (ver o cabeçalho). Só que a
 * margem (30 s) é MAIOR que o intervalo (12 s), então a linha mais recente
 * volta a casar com o filtro em toda volta, para sempre — e o poller anunciava
 * cada rebusca como se fosse mudança nova.
 *
 * Medido contra o Voalle em 08/09/2026, quatro voltas seguidas sem tempo entre
 * elas: `9 linha(s)`, depois `1`, `1`, `1` — a mesma linha, três vezes. No
 * container que estava no ar havia 43 h isso aparece como
 * `RETORNO PRIORITARIO: 1 linha(s) mudaram` repetido sem fim, e o efeito é o
 * cache das páginas dependentes ser derrubado a cada 12 s indefinidamente:
 * `paginasCarregadas: []` e `cache.visuais.itens: 0` depois de dois dias no ar.
 *
 * Rebuscar continua certo. Anunciar a rebusca é que não era.
 */
export function mudancasReais(antes: DeltaDeTabela, depois: DeltaDeTabela): number {
  let n = 0;
  for (const [chave, linha] of depois.porChave) {
    const anterior = antes.porChave.get(chave);
    // Comparação por conteúdo, não por identidade: a volta seguinte traz outro
    // objeto com os mesmos campos, e comparar referência acusaria mudança em
    // 100% das rebuscas — que é exatamente o defeito que esta função conserta.
    if (anterior === undefined || !mesmaLinha(anterior, linha)) n += 1;
  }
  return n;
}

/** Igualdade rasa de linha. `Escalar` inclui `Date`, que `===` nunca casa. */
function mesmaLinha(a: Record<string, Escalar>, b: Record<string, Escalar>): boolean {
  const ca = Object.keys(a);
  if (ca.length !== Object.keys(b).length) return false;
  for (const k of ca) {
    const va = a[k];
    const vb = b[k];
    if (va instanceof Date || vb instanceof Date) {
      if (!(va instanceof Date) || !(vb instanceof Date)) return false;
      if (va.getTime() !== vb.getTime()) return false;
    } else if (va !== vb) {
      return false;
    }
  }
  return true;
}

// ------------------------------------------------------------------- I/O real

export interface OpcoesDoPoller {
  specsDir: string;
  /** Criado uma vez, sob demanda — só se houver ao menos uma query configurada. */
  pool: () => Promise<PgPoolLike>;
  agora?: () => Date;
  anuncia?: (linha: string) => void;
  /**
   * Uma tabela mudou de verdade (a busca trouxe ≥1 linha). Quem chama decide o
   * que fazer — invalidar cache, avisar por SSE. Este módulo só detecta.
   */
  aoMudar?: (tabela: string, queryId: string) => void;
  /**
   * O instante de onde a vigília parte, **no relógio do banco**. Sem ele, com `agora`
   * injetado (testes), parte de `agora()`; em produção, de `LOCALTIMESTAMP`.
   */
  relogioDoBanco?: () => Promise<Date>;
}

/**
 * `:desde` como o banco o lê: hora de parede, sem fuso.
 *
 * **O defeito que isto corrige, medido em 02/10/2026 (ACHADOS #168).** As colunas
 * vigiadas são `timestamp` SEM fuso, e o driver as devolve como hora local do processo.
 * `toISOString()` mandava a hora em UTC com `Z`, e o Postgres, convertendo para
 * `timestamp`, **ignora** o `Z`: no container (UTC), a vigília partia de "12:45" quando
 * no banco eram 09:45 — três horas no futuro. Resultado: 824 voltas, 0 linhas, por três
 * horas depois de cada subida da API, sem erro nenhum.
 *
 * Os getters LOCAIS fazem a ida e a volta exatas em qualquer fuso: o driver leu
 * `09:45` como 09:45 locais, e esta função devolve `09:45`.
 */
export function paraParametroLocal(d: Date): string {
  const n = (v: number, t = 2) => String(v).padStart(t, '0');
  return (
    `${d.getFullYear()}-${n(d.getMonth() + 1)}-${n(d.getDate())} ` +
    `${n(d.getHours())}:${n(d.getMinutes())}:${n(d.getSeconds())}.${n(d.getMilliseconds(), 3)}`
  );
}

/**
 * Vigia todas as queries de `realtime-poll.yaml`, uma a uma, cada uma no seu
 * próprio intervalo — mesmo molde de `Aquecedor` (`setInterval` + `unref` +
 * guarda contra sobreposição), replicado por query porque cada uma tem sua
 * própria cadência e seu próprio estado de delta.
 */
export class PollerRealtime {
  readonly #configs: Map<string, ConfigDePoll>;
  readonly #opts: Required<Omit<OpcoesDoPoller, 'specsDir' | 'pool' | 'relogioDoBanco'>> &
    Pick<OpcoesDoPoller, 'pool' | 'relogioDoBanco'>;
  readonly #deltas = new Map<string, DeltaDeTabela>();
  /** Queries cuja vigília já partiu do relógio do banco — ver `#semeia`. */
  readonly #semeadas = new Set<string>();
  readonly #timers = new Map<string, ReturnType<typeof setInterval>>();
  readonly #ocupado = new Set<string>();
  readonly #specsDir: string;
  #pool: PgPoolLike | null = null;
  #poolPromise: Promise<PgPoolLike> | null = null;
  #voltas = 0;
  #mudancas = 0;
  #rebuscas = 0;
  #erros = 0;
  #ultimaVolta: Date | null = null;
  #ultimaMudanca: Date | null = null;
  #ultimoErro: string | null = null;

  constructor(opts: OpcoesDoPoller) {
    this.#specsDir = opts.specsDir;
    this.#configs = leConfigDePoll(opts.specsDir);
    this.#opts = {
      pool: opts.pool,
      agora: opts.agora ?? (() => new Date()),
      anuncia: opts.anuncia ?? ((l) => console.error(l)),
      aoMudar: opts.aoMudar ?? ((): void => {}),
      relogioDoBanco: opts.relogioDoBanco ?? (opts.agora ? async () => opts.agora!() : undefined),
    };
  }

  /**
   * Na primeira volta de cada query, refaz o delta partindo do relógio do BANCO.
   *
   * `inicia()` semeia com `agora()`, o relógio deste processo — que, além do fuso
   * (`paraParametroLocal`), pode estar adiantado em relação ao do banco. Partir do
   * relógio do banco é o único ponto de partida que não pula nem inventa janela.
   */
  async #semeia(cfg: ConfigDePoll, run: ReturnType<typeof postgresRunner>): Promise<void> {
    if (this.#semeadas.has(cfg.query)) return;
    const agoraNoBanco = this.#opts.relogioDoBanco
      ? await this.#opts.relogioDoBanco()
      : ((await run('SELECT LOCALTIMESTAMP AS agora'))[0] as { agora: Date }).agora;
    this.#deltas.set(cfg.query, novoDelta(agoraNoBanco));
    this.#semeadas.add(cfg.query);
  }

  /** Nenhuma query configurada? Não há o que iniciar — chamador pode pular. */
  get ativo(): boolean {
    return this.#configs.size > 0;
  }

  inicia(): void {
    for (const cfg of this.#configs.values()) {
      if (this.#timers.has(cfg.query)) continue;
      const agora = this.#opts.agora();
      this.#deltas.set(cfg.query, novoDelta(agora));
      void this.#tenta(cfg);
      const t = setInterval(() => void this.#tenta(cfg), cfg.intervaloMs);
      t.unref?.();
      this.#timers.set(cfg.query, t);
    }
  }

  para(): void {
    for (const t of this.#timers.values()) clearInterval(t);
    this.#timers.clear();
  }

  /**
   * Uma volta manual, sem esperar o temporizador — para o teste não depender de
   * `setInterval` de verdade. Mesmo papel de `Aquecedor.tenta()`.
   */
  async tentaAgora(queryId: string): Promise<void> {
    const cfg = this.#configs.get(queryId);
    if (!cfg) throw new Error(`realtime-poll.yaml não declara a query '${queryId}'.`);
    if (!this.#deltas.has(queryId)) this.#deltas.set(queryId, novoDelta(this.#opts.agora()));
    await this.#tenta(cfg);
  }

  /** O overlay atual de uma tabela, ou `undefined` se ninguém a poll(e)a. */
  overlay(tabela: string): OverlayDeTabela | undefined {
    for (const cfg of this.#configs.values()) {
      if (normalizeName(cfg.tabela) !== normalizeName(tabela)) continue;
      const d = this.#deltas.get(cfg.query);
      return d ? overlayDoDelta(d, cfg) : undefined;
    }
    return undefined;
  }

  /**
   * Os overlays de todas as tabelas vigiadas, **em dado** — uma entrada por
   * tabela com delta não-vazio, pronta para atravessar `postMessage`.
   *
   * Tabela cujo delta ainda não viu nenhuma mudança fica de fora de propósito:
   * mesclar um delta vazio contra o disco é trabalho para devolver exatamente o
   * que já estava lá, e `carrega()` já pula direto para "sem overlay" quando a
   * tabela não está no `Map`. É também o que mantém pequeno o que viaja para a
   * worker no caso comum (nenhuma tabela mudou desde o último refresh).
   *
   * **Esta é a única forma que este módulo produz.** Antes de a piscina de
   * workers existir havia também um `mescladores()`, que montava aqui o `Map` de
   * FUNÇÕES que `carrega()` quer. Ele saiu quando o overlay passou a atravessar
   * a fronteira da worker: com produção consumindo só a forma em dado, o outro
   * método virou código que só o teste chamava — e um teste que exercita um
   * caminho que ninguém usa passa verde sem guardar nada. Quem precisa das
   * funções converte na hora, com `mescladoresDe()` (`overlay-realtime.ts`).
   */
  overlays(): Map<string, OverlayDeTabela> {
    const out = new Map<string, OverlayDeTabela>();
    for (const cfg of this.#configs.values()) {
      const d = this.#deltas.get(cfg.query);
      if (!d || d.porChave.size === 0) continue;
      out.set(normalizeName(cfg.tabela), overlayDoDelta(d, cfg));
    }
    return out;
  }

  /**
   * O que este poller está fazendo — para `GET /api/saude`.
   *
   * **Por que ele precisa se declarar.** Depois do conserto acima, um poller
   * saudável fica CALADO quando a fonte está quieta — e calado é exatamente
   * como um poller morto se parece no log. É o mesmo modo de falha que a F5
   * fechou no carimbo: sem estado publicado, «nenhum evento» e «nada
   * detectando» são indistinguíveis.
   *
   * `voltas` subindo com `mudancas` em zero é a fonte quieta. `voltas` parado
   * é o poller parado, e aí `ultimoErro` diz por quê.
   */
  estado(): {
    queries: number;
    voltas: number;
    mudancas: number;
    rebuscasSemMudanca: number;
    erros: number;
    ultimaVolta: string | null;
    ultimaMudanca: string | null;
    ultimoErro: string | null;
  } {
    return {
      queries: this.#configs.size,
      voltas: this.#voltas,
      mudancas: this.#mudancas,
      rebuscasSemMudanca: this.#rebuscas,
      erros: this.#erros,
      ultimaVolta: this.#ultimaVolta?.toISOString() ?? null,
      ultimaMudanca: this.#ultimaMudanca?.toISOString() ?? null,
      ultimoErro: this.#ultimoErro,
    };
  }

  async #getPool(): Promise<PgPoolLike> {
    if (this.#pool) return this.#pool;
    this.#poolPromise ??= this.#opts.pool().then((p) => {
      this.#pool = p;
      return p;
    });
    return this.#poolPromise;
  }

  async #tenta(cfg: ConfigDePoll): Promise<void> {
    if (this.#ocupado.has(cfg.query)) return;
    this.#ocupado.add(cfg.query);
    const t0 = Date.now();
    try {
      if (!this.#deltas.has(cfg.query)) return; // não deveria acontecer — inicia() sempre semeia antes do 1º tenta()

      const pool = await this.#getPool();
      const run = postgresRunner(pool);
      await this.#semeia(cfg, run);
      const delta = this.#deltas.get(cfg.query)!;
      const politica = {
        query: cfg.query,
        parametro: 'desde',
        piso: '1970-01-01',
        marca: cfg.marca,
        chave: cfg.chave,
        margemDias: 0,
        idadeMaximaDias: Number.MAX_SAFE_INTEGER,
        costura: [cfg.costura],
      };
      // `costura()` já valida a âncora — erra alto se o SQL da spec mudou embaixo
      // desta config, em vez de poluir silenciosamente com a query inteira.
      const sql = costura(this.#sqlDe(cfg), politica);

      const linhasRaw = await run(sql, { desde: paraParametroLocal(delta.desde) });
      const linhas = linhasRaw.map((l) => normalizaChaves(l as Record<string, Escalar>));

      const agora = this.#opts.agora();
      const atualizado = podaDelta(aplicaBusca(delta, linhas, cfg, agora), cfg.marca, agora);
      this.#deltas.set(cfg.query, atualizado);

      const ms = Date.now() - t0;
      const mudaram = mudancasReais(delta, atualizado);
      this.#voltas += 1;
      this.#ultimaVolta = agora;
      if (mudaram > 0) {
        this.#mudancas += 1;
        this.#ultimaMudanca = agora;
        this.#opts.anuncia(`[poller] ${cfg.tabela}: ${mudaram} linha(s) mudaram (${ms} ms)`);
        this.#opts.aoMudar(cfg.tabela, cfg.query);
      } else if (linhas.length > 0) {
        // A busca trouxe linha, mas nenhuma mudou o delta: é a margem
        // rebuscando a mesma janela, como ela deve. Não é evento, e anunciar
        // seria invalidar cache (e, desde a F4, RECALCULAR página) a cada 12 s
        // para produzir exatamente o número que já estava lá.
        this.#rebuscas += 1;
      }
    } catch (err) {
      const ms = Date.now() - t0;
      this.#erros += 1;
      this.#ultimoErro = err instanceof Error ? err.message : String(err);
      this.#opts.anuncia(
        `[poller] ${cfg.tabela}: ${err instanceof Error ? err.message : String(err)} (${ms} ms) — tenta de novo na próxima volta`,
      );
    } finally {
      this.#ocupado.delete(cfg.query);
    }
  }

  #sqlCache = new Map<string, string>();
  /** O `sql:` original da spec — lido uma vez, não a cada volta. */
  #sqlDe(cfg: ConfigDePoll): string {
    const cache = this.#sqlCache.get(cfg.query);
    if (cache) return cache;
    const arq = path.join(this.#specsDir, '_catalog', 'queries', `${cfg.query}.spec.yaml`);
    const spec = parseYaml(fs.readFileSync(arq, 'utf8')) as { sql?: string };
    if (!spec.sql) throw new Error(`${arq}: sem campo 'sql:' — nada para o poller rodar.`);
    this.#sqlCache.set(cfg.query, spec.sql);
    return spec.sql;
  }
}

function normalizaChaves(linha: Record<string, Escalar>): Record<string, Escalar> {
  const out: Record<string, Escalar> = {};
  for (const [k, v] of Object.entries(linha)) out[normalizeName(k)] = v;
  return out;
}
