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
// (`backend/packages/snapshot/src/carrega.ts`) chama `mescla()` — a MESMA função que
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
// terminar. Por isso a configuração mora em `backend/specs/_catalog/realtime-poll.yaml`,
// não em `incremental.yaml` — são unidades diferentes, não a mesma ideia.
//
// REGRA DE SAÍDA: nunca imprime valor de linha. Só tabela, contagem e tempo.

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { normalizeName } from '../../packages/semantic-model/src/model.ts';
import { costura, marcaDe, type Costura } from '../../packages/snapshot/src/incremental.ts';
import type { OverlayDeTabela } from './overlay-realtime.ts';
import type { PgPoolLike } from '../../packages/query-engine/src/connectors-sql.ts';
import { postgresRunner } from '../../packages/query-engine/src/connectors-sql.ts';
import type { Escalar } from '../../packages/snapshot/src/formato.ts';
import { SemanticModel } from '../../packages/semantic-model/src/model.ts';
import { materializaColunas, materializaColunasPorGrao } from '../../packages/snapshot/src/colunas-calculadas.ts';
import { GRAO_REDUZIDO_DE } from '../../packages/snapshot/src/grao-reduzido.ts';
import { DIRETORIO_PADRAO, leManifesto } from '../../packages/snapshot/src/manifesto.ts';
import { montaBuscaPorIds } from './busca-por-ids.ts';
import { comoDuracao } from '../../packages/transform-engine/src/runner.ts';
import { duracaoEmDias } from '../../packages/transform-engine/src/value.ts';

const ARQUIVO = path.join('_catalog', 'realtime-poll.yaml');
/** Nome da sentinela em `/api/saude` → `porQuery` (não é query do catálogo). */
export const SENTINELA = 'sentinela';

export interface ConfigDePoll {
  query: string;
  tabela: string;
  intervaloMs: number;
  margemSegundos: number;
  chave: string[];
  marca: string[];
  /** Modo de um passo: o `sql:` da spec costurado com `:desde`. */
  costura?: Costura;
  /**
   * Modo de dois passos (ACHADOS #166): `alvos` é uma SQL com `:desde` que devolve os
   * `id` que mudaram — barata —, e `buscaPorIds` busca só esses, com a view recortada
   * por dentro (`busca-por-ids.ts`). Existe porque a costura da FIELD AGENDA custa
   * 11–12 s por volta qualquer que seja a janela.
   */
  alvos?: string;
  buscaPorIds?: { view: string };
  /**
   * Calcula as colunas calculadas da tabela sobre as linhas buscadas, como o snapshot
   * faz. Só vale quando toda coluna calculada depende da própria linha ou das linhas
   * da mesma CHAVE — o poller traz a chave inteira, e um RANKX sobre a tabela toda
   * daria outro número. Na FIELD AGENDA, o `RankDataProtocolo` filtra pelo protocolo.
   */
  colunasCalculadas?: boolean;
  /**
   * A volta só roda quando a sentinela viu uma tarefa NOVA neste escopo (PLANO-MESTRE B.1b).
   * Só para costura cujo único `:desde` é `a.modified` — aí "nenhuma tarefa do escopo com
   * `modified` novo" quer dizer "a busca voltaria vazia ou repetida".
   */
  sentinela?: EscopoDaSentinela;
}

/** Quais tarefas mudadas acordam uma query: por tipo de protocolo OU por tipo de tarefa. */
export interface EscopoDaSentinela {
  /** `incident_types.id` do filtro da costura. */
  tipos: string[];
  /** `assignments.assignment_type` do filtro da costura (`RAUX`). */
  tiposDeTarefa: string[];
}

/**
 * A consulta-sentinela: uma varredura de `assignments` por volta, no lugar de uma por
 * query vigiada. `assignments` (7,3 GB) não tem índice em `modified`, e cada costura por
 * `a.modified` pagava essa varredura sozinha — a cada 12 s, mudasse algo ou não.
 */
export interface ConfigDaSentinela {
  intervaloMs: number;
  margemSegundos: number;
  /** Uma query vigiada roda pelo menos a cada tanto, viu a sentinela algo ou não. */
  tetoSemRodarMs: number;
  /** Devolve `id`, `modified`, `tipo_de_tarefa` e `tipos` (array) com `:desde`. */
  sql: string;
}

interface ArquivoRealtimePoll {
  formato?: number;
  sentinela?: { intervalo_ms?: number; margem_segundos?: number; teto_sem_rodar_ms?: number; sql?: string };
  queries?: Record<
    string,
    {
      tabela?: string;
      intervalo_ms?: number;
      margem_segundos?: number;
      chave?: string[];
      marca?: string[];
      costura?: Costura;
      alvos?: string;
      busca_por_ids?: { view?: string };
      colunas_calculadas?: boolean;
      sentinela?: { tipos?: string[]; tipos_de_tarefa?: string[] };
    }
  >;
}

function leArquivo(specsDir: string): { caminho: string; doc: ArquivoRealtimePoll } | null {
  const caminho = path.join(specsDir, ARQUIVO);
  if (!fs.existsSync(caminho)) return null;
  const doc = (parseYaml(fs.readFileSync(caminho, 'utf8')) ?? {}) as ArquivoRealtimePoll;
  if (doc.formato !== undefined && doc.formato !== 1) {
    throw new Error(`${caminho}: formato ${doc.formato}, esperado 1.`);
  }
  return { caminho, doc };
}

/** O bloco `sentinela:` de `realtime-poll.yaml`, ou `null` sem ele. */
export function leConfigDaSentinela(specsDir: string): ConfigDaSentinela | null {
  const lido = leArquivo(specsDir);
  const s = lido?.doc.sentinela;
  if (!lido || !s) return null;
  if (!s.sql?.includes(':desde')) throw new Error(`${lido.caminho}: a sentinela precisa de 'sql' com :desde.`);
  return {
    intervaloMs: s.intervalo_ms ?? 12_000,
    margemSegundos: s.margem_segundos ?? 30,
    tetoSemRodarMs: s.teto_sem_rodar_ms ?? 300_000,
    sql: s.sql,
  };
}

/** Uma linha da sentinela cai no escopo de uma query? */
export function escopoCasa(
  escopo: EscopoDaSentinela,
  linha: { tipos: readonly string[]; tipoDeTarefa: string | null },
): boolean {
  return (
    linha.tipos.some((t) => escopo.tipos.includes(t)) ||
    (linha.tipoDeTarefa !== null && escopo.tiposDeTarefa.includes(linha.tipoDeTarefa))
  );
}

/** `tipos` como o driver entrega um `text[]` — array, ou o literal `{a,b}` se vier cru. */
function tiposDaLinha(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined).map(String);
  if (typeof v === 'string') return v.replace(/^\{|\}$/g, '').split(',').filter(Boolean);
  return [];
}

/**
 * Lê `backend/specs/_catalog/realtime-poll.yaml`. Sem o arquivo, nenhuma query é polada
 * — que é o estado seguro por padrão, igual a `incremental.yaml`.
 */
export function leConfigDePoll(specsDir: string): Map<string, ConfigDePoll> {
  const fora = new Map<string, ConfigDePoll>();
  const lido = leArquivo(specsDir);
  if (!lido) return fora;
  const { caminho: p, doc } = lido;
  for (const [query, bruto] of Object.entries(doc.queries ?? {})) {
    if (!bruto.tabela) throw new Error(`${p}: ${query} não declara tabela.`);
    const doisPassos = bruto.alvos !== undefined || bruto.busca_por_ids !== undefined;
    if (doisPassos && !(bruto.alvos && bruto.busca_por_ids?.view)) {
      throw new Error(`${p}: ${query} em dois passos precisa de 'alvos' E 'busca_por_ids.view'.`);
    }
    if (!doisPassos && !bruto.costura) throw new Error(`${p}: ${query} não declara costura.`);
    if (!bruto.marca?.length) throw new Error(`${p}: ${query} não declara 'marca'.`);
    if (!bruto.chave?.length) throw new Error(`${p}: ${query} não declara 'chave'.`);
    if (bruto.sentinela) {
      if (doisPassos) throw new Error(`${p}: ${query} em dois passos não usa a sentinela.`);
      if (!doc.sentinela) throw new Error(`${p}: ${query} usa a sentinela, mas o arquivo não declara 'sentinela:'.`);
      if (!bruto.sentinela.tipos?.length && !bruto.sentinela.tipos_de_tarefa?.length) {
        throw new Error(`${p}: ${query} declara sentinela sem 'tipos' nem 'tipos_de_tarefa'.`);
      }
    }
    fora.set(query, {
      query,
      tabela: bruto.tabela!,
      intervaloMs: bruto.intervalo_ms ?? 12_000,
      margemSegundos: bruto.margem_segundos ?? 30,
      chave: bruto.chave,
      marca: bruto.marca,
      ...(doisPassos
        ? { alvos: bruto.alvos!, buscaPorIds: { view: bruto.busca_por_ids!.view! } }
        : { costura: bruto.costura! }),
      ...(bruto.colunas_calculadas ? { colunasCalculadas: true } : {}),
      ...(bruto.sentinela
        ? {
            sentinela: {
              tipos: (bruto.sentinela.tipos ?? []).map(String),
              tiposDeTarefa: (bruto.sentinela.tipos_de_tarefa ?? []).map(String),
            },
          }
        : {}),
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
  /**
   * A última versão de cada GRUPO de linhas, por chave. Um grupo, e não uma linha: na
   * FIELD AGENDA a chave é o protocolo e o grão é slot × relato — dezenas de linhas
   * por chave, que a fonte entrega juntas e `mescla()` substitui juntas. Para as
   * tabelas de uma linha por chave, o grupo tem uma linha só e nada muda.
   */
  porChave: Map<string, Record<string, Escalar>[]>;
  /**
   * Quando cada grupo foi buscado, em ms. A poda usa isto quando existe: a marca da
   * linha diz quando o DADO nasceu, não quando ele MUDOU — troca de status de um
   * protocolo de três dias atrás não mexe em nenhuma coluna de data.
   */
  vistoEm?: Map<string, number>;
  /** Desde quando este delta é a verdade completa — vira `corte` em `mescla()`. */
  inicioJanela: Date;
  /** De onde a próxima busca parte. Só avança em busca bem-sucedida. */
  desde: Date;
}

/** Cria um delta vazio, cuja janela começa agora (ou em `desde`, se dado). */
export function novoDelta(agora: Date, desde: Date = agora): DeltaDeTabela {
  return { porChave: new Map(), vistoEm: new Map(), inicioJanela: desde, desde };
}

/** As linhas de uma busca, agrupadas pela chave — na ordem em que chegaram. */
function agrupa(
  novas: readonly Record<string, Escalar>[],
  chave: readonly string[],
): Map<string, Record<string, Escalar>[]> {
  const grupos = new Map<string, Record<string, Escalar>[]>();
  for (const l of novas) {
    const k = identidade(l, chave);
    const g = grupos.get(k);
    if (g) g.push(l);
    else grupos.set(k, [l]);
  }
  return grupos;
}

/**
 * Aplica uma busca ao delta: cada grupo novo substitui o grupo anterior da mesma
 * chave (a busca mais recente é sempre a verdade sobre aquela chave), e o ponteiro de
 * busca avança para a marca mais alta encontrada, menos a margem.
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
  const vistoEm = new Map(delta.vistoEm ?? []);
  for (const [k, g] of agrupa(novas, cfg.chave)) {
    porChave.set(k, g);
    vistoEm.set(k, agora.getTime());
  }

  const marca = marcaDe(novas, cfg.marca);
  let desde = delta.desde;
  if (marca !== null) {
    const candidato = new Date(marca.getTime() - cfg.margemSegundos * 1000);
    if (candidato.getTime() > desde.getTime()) desde = candidato;
  }

  return { porChave, vistoEm, inicioJanela: delta.inicioJanela, desde };
}

/**
 * Remove do delta o que já é velho o bastante para o refresh em lote ter
 * pegado — sem isto, um processo de dias acumularia toda mudança que já
 * viu, para sempre, num mapa que só cresce.
 *
 * `tetoHoras` é generoso de propósito: o pior caso de erro é o delta ficar um
 * pouco maior por mais tempo, nunca perder uma mudança recente.
 *
 * `cobertoAte` (ms): o disco já contém toda mudança anterior a este instante — a
 * carga em lote da tabela começou depois dela. Grupo VISTO antes disso está no
 * arquivo e sai do delta; é o que impede o overlay da FIELD AGENDA de crescer o dia
 * inteiro (cada grupo custa recálculo e cópia para a worker a cada página).
 */
export function podaDelta(
  delta: DeltaDeTabela,
  marcaCols: readonly string[],
  agora: Date,
  tetoHoras = 48,
  cobertoAte: number | null = null,
): DeltaDeTabela {
  const corte = agora.getTime() - tetoHoras * 3600_000;
  const porChave = new Map<string, Record<string, Escalar>[]>();
  const vistoEm = new Map<string, number>();
  for (const [k, g] of delta.porChave) {
    const visto = delta.vistoEm?.get(k);
    if (visto !== undefined && cobertoAte !== null && visto < cobertoAte) continue;
    const m = visto ?? marcaDe(g, marcaCols)?.getTime() ?? null;
    if (m === null || m >= corte) {
      porChave.set(k, g);
      if (visto !== undefined) vistoEm.set(k, visto);
    }
  }
  return { ...delta, porChave, vistoEm };
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
  return { linhas: [...delta.porChave.values()].flat(), corte: delta.inicioJanela, chave: cfg.chave, marca: cfg.marca };
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
  for (const [chave, grupo] of depois.porChave) {
    const anterior = antes.porChave.get(chave);
    // Comparação por conteúdo, não por identidade: a volta seguinte traz outro
    // objeto com os mesmos campos, e comparar referência acusaria mudança em
    // 100% das rebuscas — que é exatamente o defeito que esta função conserta.
    if (anterior === undefined || !mesmoGrupo(anterior, grupo)) n += 1;
  }
  return n;
}

/**
 * A marca mais nova entre as chaves que MUDARAM nesta volta: a hora do fato mais recente
 * que o poller acabou de perceber. Base de `atrasoDoFato`.
 */
export function marcaMaisNovaDasMudancas(
  antes: DeltaDeTabela,
  depois: DeltaDeTabela,
  marcaCols: readonly string[],
): Date | null {
  let mais: Date | null = null;
  for (const [chave, grupo] of depois.porChave) {
    const anterior = antes.porChave.get(chave);
    if (anterior !== undefined && mesmoGrupo(anterior, grupo)) continue;
    const m = marcaDe(grupo, marcaCols);
    if (m && (!mais || m.getTime() > mais.getTime())) mais = m;
  }
  return mais;
}

/**
 * Mesmo grupo = mesmas linhas, em qualquer ordem. A fonte não promete ordem entre
 * duas buscas (a SQL da FIELD AGENDA ordena por data de criação, com empate dentro do
 * protocolo), e acusar mudança por reordenação derrubaria o cache à toa.
 */
function mesmoGrupo(a: readonly Record<string, Escalar>[], b: readonly Record<string, Escalar>[]): boolean {
  if (a.length !== b.length) return false;
  const usadas = new Array<boolean>(a.length).fill(false);
  for (const lb of b) {
    const i = a.findIndex((la, j) => !usadas[j] && mesmaLinha(la, lb));
    if (i === -1) return false;
    usadas[i] = true;
  }
  return true;
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
  /**
   * Até quando o disco já contém toda mudança da query (ms, instante real) — de onde a
   * PRIMEIRA busca parte. Sem ele, lê o `geradoEm` do manifesto (`#cobertoAte`).
   */
  cobertoAte?: (query: string) => number | null;
}

/**
 * Quanto a primeira busca recua, no máximo, atrás do disco. Cobre o snapshot da
 * madrugada mais um dia inteiro; disco mais velho que isso é carga quebrada, e reler
 * dias numa volta só pesaria mais que o buraco que fecharia.
 */
export const RECUO_MAXIMO_MS = 26 * 3600_000;

/**
 * Nenhuma volta passa disto no banco: o pool do poller tem `statement_timeout` de 30 s, e uma
 * volta são no máximo duas consultas mais a conexão. Acima, o processo parou — em 09/10/2026
 * o notebook da stack suspendeu 92 min por bateria, e a volta em curso entrou como 5.503.926 ms
 * de "banco" em cada query de 12 s: `/api/saude` dizia 140 min/h com o banco em ~30.
 */
export const TETO_DE_VOLTA_NO_BANCO_MS = 120_000;

/**
 * `:desde` como o banco o lê: hora de parede, sem fuso.
 *
 * **A convenção é a de `parseSemFuso` (`connectors-sql.ts`):** o pool lê
 * `timestamp` sem fuso com os dígitos em UTC — "09:45 no banco" vira `09:45Z`. A volta
 * tem de ser a mesma: os dígitos UTC, SEM o `Z`. Com o `Z`, o Postgres ignoraria o
 * fuso de qualquer jeito; tirá-lo só deixa explícito que é hora de parede.
 *
 * **O defeito de 02/10/2026 (ACHADOS #168) não era este formato:** era o PONTO DE
 * PARTIDA. A vigília partia de `agora()`, o instante real do processo — 12:45Z quando
 * no banco eram 09:45 —, e nessa convenção isso é "12:45 de parede", três horas no
 * futuro. Daí `#semeia` partir do relógio do banco.
 */
export function paraParametroSemFuso(d: Date): string {
  return d.toISOString().slice(0, 23).replace('T', ' ');
}

/**
 * Quanto uma query vigiada custa ao banco — para `GET /api/saude`.
 *
 * **Por que existe (PLANO-CARGA B.1, 02/10/2026).** Com o snapshot de madrugada, o
 * poller vira a carga principal do dia, e ninguém sabia quanto ele pesa: 6.266 voltas
 * em ~7 h, quando os intervalos dariam ~13.000. A diferença são voltas PULADAS — a
 * anterior ainda rodando quando o temporizador disparou —, e uma volta mais longa que o
 * intervalo é uma consulta que nunca sai do banco. `bancoMs` é só o tempo de consulta;
 * as colunas calculadas da busca em dois passos rodam aqui, não lá.
 */
export interface MedidaDaQuery {
  query: string;
  intervaloMs: number;
  voltas: number;
  puladas: number;
  /** Voltas que nem foram ao banco: a sentinela não viu tarefa nova no escopo (B.1b). */
  dispensadas: number;
  erros: number;
  bancoMsMedio: number;
  bancoMsMax: number;
  ultimoBancoMs: number | null;
  /** Tempo de consulta somado, por hora de vigília — a unidade da meta da Fase B. */
  bancoMsPorHora: number;
  /** Voltas que passaram de `TETO_DE_VOLTA_NO_BANCO_MS`: o processo parou, não o banco. */
  suspensas: number;
  /**
   * Do fato no Voalle até o poller perceber (ms): a marca mais nova das chaves que mudaram,
   * contra o relógio do banco na volta. Só fatos da última hora: mudança de status não mexe
   * em coluna de data (#166), e uma marca de dias atrás mediria a idade do protocolo, não o
   * atraso. Meta da VISÃO PRODUTIVA: do fato à tela ≤ 30 s (`PLANO-CARREGAMENTO.md` §0).
   */
  atrasoDoFato: { n: number; medianoMs: number | null; maxMs: number | null };
}

interface Acumulado {
  voltas: number;
  puladas: number;
  dispensadas: number;
  erros: number;
  suspensas: number;
  bancoMs: number;
  bancoMsMax: number;
  ultimoBancoMs: number | null;
  /** Os últimos atrasos do fato (ms), para a mediana; janela curta de propósito. */
  atrasos: number[];
  atrasoMax: number;
  atrasoN: number;
}

/**
 * Vigia todas as queries de `realtime-poll.yaml`, uma a uma, cada uma no seu
 * próprio intervalo — mesmo molde de `Aquecedor` (`setInterval` + `unref` +
 * guarda contra sobreposição), replicado por query porque cada uma tem sua
 * própria cadência e seu próprio estado de delta.
 */
export class PollerRealtime {
  readonly #configs: Map<string, ConfigDePoll>;
  readonly #opts: Required<Omit<OpcoesDoPoller, 'specsDir' | 'pool' | 'relogioDoBanco' | 'cobertoAte'>> &
    Pick<OpcoesDoPoller, 'pool' | 'relogioDoBanco' | 'cobertoAte'>;
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
  readonly #medidas = new Map<string, Acumulado>();
  /** Desde quando há vigília — o denominador de `bancoMsPorHora`. */
  #vigiaDesde: Date | null = null;
  /** Relógio do banco − relógio do processo, arredondado a 15 min (o fuso de `parseSemFuso`). */
  #fusoMs = 0;

  // ── Sentinela (B.1b) ──────────────────────────────────────────────────────────
  // Regra: uma query com `sentinela:` roda quando (a) nunca rodou, (b) a última volta
  // dela falhou, (c) a sentinela viu uma tarefa nova no escopo DEPOIS que a última volta
  // dela começou, (d) passou o teto, ou (e) a sentinela não está em dia. Todo caso de
  // dúvida roda — o pior caso é o custo de antes, nunca dado perdido.
  readonly #sentinela: ConfigDaSentinela | null;
  /** Queries que a sentinela mandou rodar (ou que nunca rodaram, ou falharam). */
  readonly #pendentes = new Set<string>();
  /** Quando a última volta de cada query começou (relógio do processo, ms). */
  readonly #inicioDaVolta = new Map<string, number>();
  /** A versão (`modified`) de cada tarefa já vista na janela — só tarefa NOVA acorda. */
  readonly #vistas = new Map<string, number>();
  #sentinelaDesde: Date | null = null;
  /** Último sucesso da sentinela (relógio do processo, ms). */
  #sentinelaOkEm: number | null = null;
  #timerDaSentinela: ReturnType<typeof setInterval> | null = null;

  constructor(opts: OpcoesDoPoller) {
    this.#specsDir = opts.specsDir;
    this.#configs = leConfigDePoll(opts.specsDir);
    this.#sentinela = leConfigDaSentinela(opts.specsDir);
    for (const cfg of this.#configs.values()) if (cfg.sentinela) this.#pendentes.add(cfg.query);
    this.#opts = {
      pool: opts.pool,
      agora: opts.agora ?? (() => new Date()),
      anuncia: opts.anuncia ?? ((l) => console.error(l)),
      aoMudar: opts.aoMudar ?? ((): void => {}),
      relogioDoBanco: opts.relogioDoBanco ?? (opts.agora ? async () => opts.agora!() : undefined),
      cobertoAte: opts.cobertoAte,
    };
  }

  /**
   * Na primeira volta de cada query, refaz o delta partindo do relógio do BANCO.
   *
   * `inicia()` semeia com `agora()`, o relógio deste processo — que, além do fuso
   * (`paraParametroLocal`), pode estar adiantado em relação ao do banco. Partir do
   * relógio do banco é o único ponto de partida que não pula nem inventa janela.
   *
   * **A busca parte do DISCO, não da subida (02/10/2026).** Partindo de agora, toda
   * mudança entre a última carga e a subida da API ficava de fora até a carga seguinte.
   * Com o refresh de 15–30 min ninguém via; com o snapshot só de madrugada, uma API
   * reiniciada às 14h mostraria as tabelas do poller como às 03h. Por isso `desde`
   * recua até `cobertoAte` (no máximo `RECUO_MAXIMO_MS`) e a primeira volta traz tudo
   * o que mudou desde a carga.
   *
   * **`inicioJanela` (o `corte` de `mescla()`) continua sendo agora.** `mescla()` apaga
   * do disco a linha com marca ≥ `corte` que não veio no delta (as `sumidas`). Recuar o
   * corte junto pediria que a busca devolvesse TODA linha com marca na janela, e a
   * busca em dois passos só devolve quem mudou. Assim, o que mudou entra substituindo
   * pela chave; o que sumiu antes da subida segue até a próxima carga, como antes.
   */
  async #semeia(cfg: ConfigDePoll, run: ReturnType<typeof postgresRunner>): Promise<void> {
    if (this.#semeadas.has(cfg.query)) return;
    const relogio = await this.#relogio(run);
    this.#fusoMs = Math.round((relogio.getTime() - this.#opts.agora().getTime()) / 900_000) * 900_000;
    this.#deltas.set(cfg.query, { ...novoDelta(relogio), desde: this.#partida(cfg, relogio) });
    this.#semeadas.add(cfg.query);
  }

  /** De onde a primeira busca parte, na convenção do banco (`parseSemFuso`). */
  #partida(cfg: ConfigDePoll, relogio: Date): Date {
    const coberto = this.#opts.cobertoAte ? this.#opts.cobertoAte(cfg.query) : this.#cobertoAte(cfg);
    if (coberto === null) return relogio;
    // `geradoEm` é instante real; o banco fala hora de parede com os dígitos em UTC. A
    // diferença entre os dois relógios é o fuso do banco, arredondado a 15 min para
    // não carregar a latência da pergunta.
    const fuso = Math.round((relogio.getTime() - this.#opts.agora().getTime()) / 900_000) * 900_000;
    const emParede = Math.max(coberto + fuso, relogio.getTime() - RECUO_MAXIMO_MS);
    return emParede < relogio.getTime() ? new Date(emParede) : relogio;
  }

  /** O relógio do banco, no mesmo jeito que o driver entrega `timestamp` sem fuso. */
  async #relogio(run: ReturnType<typeof postgresRunner>): Promise<Date> {
    return this.#opts.relogioDoBanco
      ? this.#opts.relogioDoBanco()
      : ((await run('SELECT LOCALTIMESTAMP AS agora'))[0] as { agora: Date }).agora;
  }

  #buscas = new Map<string, string>();
  /** A SQL da busca por ids — a definição da view é lida do banco uma vez por processo. */
  async #buscaDe(cfg: ConfigDePoll, run: ReturnType<typeof postgresRunner>): Promise<string> {
    const pronta = this.#buscas.get(cfg.query);
    if (pronta) return pronta;
    const view = cfg.buscaPorIds!.view;
    const r = await run('SELECT pg_get_viewdef(CAST(:view AS regclass), true) AS definicao', { view });
    const def = (r[0] as { definicao?: string } | undefined)?.definicao;
    if (!def) throw new Error(`a view '${view}' não existe no banco.`);
    const sql = montaBuscaPorIds(this.#sqlDe(cfg), view, def);
    this.#buscas.set(cfg.query, sql);
    return sql;
  }

  #modelo: SemanticModel | null = null;
  /** Colunas calculadas sobre as linhas buscadas — ver `ConfigDePoll.colunasCalculadas`. */
  #calculaColunas(cfg: ConfigDePoll, linhas: Record<string, Escalar>[], agora: Date): Record<string, Escalar>[] {
    if (linhas.length === 0) return linhas;
    this.#modelo ??= SemanticModel.fromSpecsDir(this.#specsDir);
    const t = this.#modelo.table(cfg.tabela);
    if (!t) throw new Error(`a tabela '${cfg.tabela}' não está no modelo.`);
    // A mesma sequência do snapshot (`backend/tools/snapshot/src/index.ts`): primeiro as do
    // grão reduzido, por representante — o RANKX por protocolo sobre cada linha
    // duplicada pelos relatos custava 7,5 s para 2.283 linhas na thread principal da
    // API (medido 02/10) —, depois o resto, que já encontra aquelas memoizadas.
    const grao = GRAO_REDUZIDO_DE.get(cfg.query);
    if (grao) {
      materializaColunasPorGrao(t, this.#modelo, linhas, agora, grao.chave, new Set(grao.colunas.map(normalizeName)));
    }
    materializaColunas(t, this.#modelo, linhas, agora);
    // `materializaColunas` grava também sob o nome de EXIBIÇÃO (é o que o arquivo usa);
    // o `Dataset` só aceita chave normalizada (`adotaTabela` erra alto com outra).
    return linhas.map(normalizaChaves);
  }

  /**
   * Até quando o disco já contém toda mudança da tabela: o `geradoEm` da última carga
   * dela no manifesto, menos 10 min (a carga completa leva ~5 min, e a mudança só está
   * no arquivo se for anterior ao INÍCIO da consulta). `null` sem manifesto.
   */
  #cobertoAte(cfg: ConfigDePoll): number | null {
    try {
      // `backend/specs/` -> raiz do repositório, onde fica o `snapshot/`.
      const m = leManifesto(path.join(this.#specsDir, '..', '..', DIRETORIO_PADRAO));
      const e = m?.tabelas.find((x) => x.query === cfg.query);
      return e ? Date.parse(e.geradoEm) - 10 * 60_000 : null;
    } catch {
      return null;
    }
  }

  /**
   * Uma volta em dois passos: quem mudou (barato), e só esses, inteiros.
   *
   * `desde` avança pelo RELÓGIO DO BANCO lido antes de perguntar, e não pela marca das
   * linhas: a marca não registra troca de status (ACHADOS #166), e uma solicitação que
   * só mudou de status nunca empurraria `desde` para a frente.
   */
  async #buscaEmDoisPassos(
    cfg: ConfigDePoll,
    run: ReturnType<typeof postgresRunner>,
    delta: DeltaDeTabela,
  ): Promise<{ linhas: Record<string, Escalar>[]; desde: Date; passos: string }> {
    const t0 = Date.now();
    const relogio = await this.#relogio(run);
    const alvos = await run(cfg.alvos!, { desde: paraParametroSemFuso(delta.desde) });
    const msAlvos = Date.now() - t0;
    const ids = [...new Set(alvos.map((r) => (r as { id?: unknown }).id).filter((v) => v !== null && v !== undefined))];
    const linhas: Record<string, Escalar>[] = [];
    if (ids.length > 0) {
      const sql = await this.#buscaDe(cfg, run);
      // Em lotes: depois de uma queda, a primeira volta pode trazer milhares de ids, e
      // 400 já custam 2,6 s (medido 02/10).
      for (let i = 0; i < ids.length; i += 500) {
        const r = await run(sql, { ids: ids.slice(i, i + 500) });
        for (const l of r) linhas.push(normalizaChaves(l as Record<string, Escalar>));
      }
    }
    const passos = `alvos ${msAlvos} ms, ${ids.length} id(s); busca ${Date.now() - t0 - msAlvos} ms`;
    return { linhas, desde: new Date(relogio.getTime() - cfg.margemSegundos * 1000), passos };
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
    if (this.#temSentinela && !this.#timerDaSentinela) {
      void this.#tentaSentinela();
      this.#timerDaSentinela = setInterval(() => void this.#tentaSentinela(), this.#sentinela!.intervaloMs);
      this.#timerDaSentinela.unref?.();
    }
  }

  para(): void {
    for (const t of this.#timers.values()) clearInterval(t);
    this.#timers.clear();
    if (this.#timerDaSentinela) clearInterval(this.#timerDaSentinela);
    this.#timerDaSentinela = null;
  }

  /** Há sentinela declarada E alguma query que a usa — senão ela seria varredura à toa. */
  get #temSentinela(): boolean {
    return this.#sentinela !== null && [...this.#configs.values()].some((c) => c.sentinela);
  }

  /** Uma volta da sentinela sem esperar o temporizador — para o teste. */
  async tentaSentinelaAgora(): Promise<void> {
    await this.#tentaSentinela();
  }

  /**
   * A sentinela está em dia: teve sucesso há no máximo três intervalos. Fora disso as
   * queries vigiadas voltam a rodar no próprio intervalo, como antes dela existir.
   */
  #sentinelaEmDia(): boolean {
    return (
      this.#sentinelaOkEm !== null && Date.now() - this.#sentinelaOkEm <= 3 * this.#sentinela!.intervaloMs
    );
  }

  /** A volta desta query pode ser dispensada sem ir ao banco? */
  #dispensa(cfg: ConfigDePoll): boolean {
    if (!cfg.sentinela || !this.#temSentinela) return false;
    if (this.#pendentes.has(cfg.query) || !this.#sentinelaEmDia()) return false;
    const inicio = this.#inicioDaVolta.get(cfg.query);
    return inicio !== undefined && Date.now() - inicio < this.#sentinela!.tetoSemRodarMs;
  }

  async #tentaSentinela(): Promise<void> {
    const s = this.#sentinela!;
    if (this.#ocupado.has(SENTINELA)) {
      this.#medida(SENTINELA).puladas += 1;
      return;
    }
    this.#ocupado.add(SENTINELA);
    this.#vigiaDesde ??= this.#opts.agora();
    let tb = 0;
    try {
      const run = postgresRunner(await this.#getPool());
      this.#sentinelaDesde ??= new Date((await this.#relogio(run)).getTime() - s.margemSegundos * 1000);
      tb = Date.now();
      const linhas = await run(s.sql, { desde: paraParametroSemFuso(this.#sentinelaDesde) });
      const fim = Date.now();
      this.#registraBanco(SENTINELA, fim - tb);
      tb = 0;

      // Voltando de falha (ou na primeira vez): o que mudou ANTES desta janela ninguém viu.
      // Toda vigiada roda uma vez a partir daqui, e daí em diante a sentinela responde.
      const estavaEmDia = this.#sentinelaEmDia();
      let marca = this.#sentinelaDesde.getTime() + s.margemSegundos * 1000;
      const acordar = new Set<string>();
      for (const l of linhas) {
        const id = String(l.id);
        const mod = l.modified instanceof Date ? l.modified.getTime() : Date.parse(String(l.modified));
        if (!Number.isFinite(mod)) continue;
        marca = Math.max(marca, mod);
        if (this.#vistas.get(id) === mod) continue;
        this.#vistas.set(id, mod);
        const linha = { tipos: tiposDaLinha(l.tipos), tipoDeTarefa: l.tipo_de_tarefa == null ? null : String(l.tipo_de_tarefa) };
        for (const cfg of this.#configs.values()) {
          if (cfg.sentinela && escopoCasa(cfg.sentinela, linha)) acordar.add(cfg.query);
        }
      }
      for (const cfg of this.#configs.values()) {
        if (!cfg.sentinela) continue;
        // Volta que começou antes desta resposta pode não ter visto a tarefa: roda de novo.
        const inicio = this.#inicioDaVolta.get(cfg.query) ?? -Infinity;
        if ((acordar.has(cfg.query) || !estavaEmDia) && inicio < fim) this.#pendentes.add(cfg.query);
      }
      this.#sentinelaDesde = new Date(marca - s.margemSegundos * 1000);
      for (const [id, mod] of this.#vistas) if (mod < this.#sentinelaDesde.getTime()) this.#vistas.delete(id);
      this.#sentinelaOkEm = Date.now();
      const m = this.#medida(SENTINELA);
      m.voltas += 1;

      // Quem tem pendência e já cumpriu o próprio intervalo roda agora, sem esperar o
      // temporizador: o atraso do fato fica no intervalo da sentinela, não na soma dos dois.
      for (const cfg of this.#configs.values()) {
        if (!this.#pendentes.has(cfg.query) || this.#ocupado.has(cfg.query)) continue;
        const inicio = this.#inicioDaVolta.get(cfg.query);
        if (inicio === undefined || Date.now() - inicio >= cfg.intervaloMs) void this.#tenta(cfg);
      }
    } catch (err) {
      if (tb) this.#registraBanco(SENTINELA, Date.now() - tb);
      this.#medida(SENTINELA).erros += 1;
      this.#ultimoErro = err instanceof Error ? err.message : String(err);
      this.#opts.anuncia(
        `[poller] sentinela: ${err instanceof Error ? err.message : String(err)} — as vigiadas rodam no próprio intervalo até ela voltar`,
      );
    } finally {
      this.#ocupado.delete(SENTINELA);
    }
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
    /** Minutos de consulta no banco por hora de vigília, somadas as queries. */
    bancoMinPorHora: number;
    porQuery: MedidaDaQuery[];
  } {
    const horas = this.#vigiaDesde
      ? Math.max((this.#opts.agora().getTime() - this.#vigiaDesde.getTime()) / 3_600_000, 1 / 60)
      : null;
    const vigiadas = [...this.#configs.values()].map((c) => ({ query: c.query, intervaloMs: c.intervaloMs }));
    if (this.#temSentinela) vigiadas.push({ query: SENTINELA, intervaloMs: this.#sentinela!.intervaloMs });
    const porQuery: MedidaDaQuery[] = vigiadas.map((cfg) => {
      const m = this.#medidas.get(cfg.query);
      const consultas = m ? m.voltas + m.erros : 0;
      return {
        query: cfg.query,
        intervaloMs: cfg.intervaloMs,
        voltas: m?.voltas ?? 0,
        puladas: m?.puladas ?? 0,
        dispensadas: m?.dispensadas ?? 0,
        erros: m?.erros ?? 0,
        bancoMsMedio: m && consultas > 0 ? Math.round(m.bancoMs / consultas) : 0,
        bancoMsMax: m?.bancoMsMax ?? 0,
        ultimoBancoMs: m?.ultimoBancoMs ?? null,
        bancoMsPorHora: m && horas ? Math.round(m.bancoMs / horas) : 0,
        suspensas: m?.suspensas ?? 0,
        atrasoDoFato: {
          n: m?.atrasoN ?? 0,
          medianoMs: m && m.atrasos.length ? [...m.atrasos].sort((a, b) => a - b)[Math.floor(m.atrasos.length / 2)]! : null,
          maxMs: m && m.atrasoN ? m.atrasoMax : null,
        },
      };
    });
    const totalPorHora = porQuery.reduce((s, q) => s + q.bancoMsPorHora, 0);
    return {
      bancoMinPorHora: Math.round(totalPorHora / 6_000) / 10,
      porQuery,
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

  #medida(query: string): Acumulado {
    let m = this.#medidas.get(query);
    if (!m) {
      m = { voltas: 0, puladas: 0, dispensadas: 0, erros: 0, suspensas: 0, bancoMs: 0, bancoMsMax: 0, ultimoBancoMs: null, atrasos: [], atrasoMax: 0, atrasoN: 0 };
      this.#medidas.set(query, m);
    }
    return m;
  }

  #registraBanco(query: string, ms: number): void {
    const m = this.#medida(query);
    if (ms > TETO_DE_VOLTA_NO_BANCO_MS) {
      m.suspensas += 1;
      return;
    }
    m.bancoMs += ms;
    m.bancoMsMax = Math.max(m.bancoMsMax, ms);
    m.ultimoBancoMs = ms;
  }

  async #tenta(cfg: ConfigDePoll): Promise<void> {
    if (this.#ocupado.has(cfg.query)) {
      this.#medida(cfg.query).puladas += 1;
      return;
    }
    if (this.#dispensa(cfg)) {
      this.#medida(cfg.query).dispensadas += 1;
      return;
    }
    this.#ocupado.add(cfg.query);
    this.#vigiaDesde ??= this.#opts.agora();
    const t0 = Date.now();
    let tb = 0;
    try {
      if (!this.#deltas.has(cfg.query)) return; // não deveria acontecer — inicia() sempre semeia antes do 1º tenta()

      const pool = await this.#getPool();
      const run = postgresRunner(pool);
      await this.#semeia(cfg, run);
      const delta = this.#deltas.get(cfg.query)!;
      // Marcado ANTES da consulta: tarefa que a sentinela vir depois disto pode não ter
      // entrado nesta busca, e a sentinela a devolve para a fila (`#tentaSentinela`).
      this.#inicioDaVolta.set(cfg.query, Date.now());
      this.#pendentes.delete(cfg.query);

      if (cfg.alvos) {
        tb = Date.now();
        const busca = await this.#buscaEmDoisPassos(cfg, run, delta);
        this.#registraBanco(cfg.query, Date.now() - tb);
        tb = 0;
        const agora = this.#opts.agora();
        const tc = Date.now();
        const linhas = cfg.colunasCalculadas ? this.#calculaColunas(cfg, busca.linhas, agora) : busca.linhas;
        const passos = `${busca.passos}; colunas ${Date.now() - tc} ms`;
        let atualizado = aplicaBusca(delta, linhas, cfg, agora);
        if (busca.desde.getTime() > atualizado.desde.getTime()) atualizado = { ...atualizado, desde: busca.desde };
        atualizado = podaDelta(atualizado, cfg.marca, agora, 48, this.#cobertoAte(cfg));
        this.#concluiVolta(cfg, delta, atualizado, linhas.length, agora, t0, passos);
        return;
      }

      const politica = {
        query: cfg.query,
        parametro: 'desde',
        piso: '1970-01-01',
        marca: cfg.marca,
        chave: cfg.chave,
        margemDias: 0,
        idadeMaximaDias: Number.MAX_SAFE_INTEGER,
        costura: [cfg.costura!],
      };
      // `costura()` já valida a âncora — erra alto se o SQL da spec mudou embaixo
      // desta config, em vez de poluir silenciosamente com a query inteira.
      const sql = costura(this.#sqlDe(cfg), politica);

      tb = Date.now();
      const linhasRaw = await run(sql, { desde: paraParametroSemFuso(delta.desde) });
      this.#registraBanco(cfg.query, Date.now() - tb);
      tb = 0;
      const linhas = linhasRaw.map((l) => normalizaChaves(l as Record<string, Escalar>));

      const agora = this.#opts.agora();
      const atualizado = podaDelta(aplicaBusca(delta, linhas, cfg, agora), cfg.marca, agora);
      this.#concluiVolta(cfg, delta, atualizado, linhas.length, agora, t0);
    } catch (err) {
      const ms = Date.now() - t0;
      // A consulta que falhou também ocupou o banco até falhar.
      if (tb) this.#registraBanco(cfg.query, Date.now() - tb);
      // Volta que falhou não viu nada: a próxima roda, viu a sentinela algo ou não.
      if (cfg.sentinela) this.#pendentes.add(cfg.query);
      this.#medida(cfg.query).erros += 1;
      this.#erros += 1;
      this.#ultimoErro = err instanceof Error ? err.message : String(err);
      this.#opts.anuncia(
        `[poller] ${cfg.tabela}: ${err instanceof Error ? err.message : String(err)} (${ms} ms) — tenta de novo na próxima volta`,
      );
    } finally {
      this.#ocupado.delete(cfg.query);
    }
  }

  /** Grava o delta da volta e anuncia — só o que MUDOU de verdade (`mudancasReais`). */
  #concluiVolta(
    cfg: ConfigDePoll,
    antes: DeltaDeTabela,
    atualizado: DeltaDeTabela,
    buscadas: number,
    agora: Date,
    t0: number,
    passos?: string,
  ): void {
    this.#deltas.set(cfg.query, atualizado);
    const ms = Date.now() - t0;
    const mudaram = mudancasReais(antes, atualizado);
    this.#voltas += 1;
    const med = this.#medida(cfg.query);
    med.voltas += 1;
    if (mudaram > 0) {
      const marca = marcaMaisNovaDasMudancas(antes, atualizado, cfg.marca);
      const atraso = marca ? agora.getTime() + this.#fusoMs - marca.getTime() : null;
      if (atraso !== null && atraso >= 0 && atraso <= 3_600_000) {
        med.atrasos.push(atraso);
        if (med.atrasos.length > 50) med.atrasos.shift();
        med.atrasoMax = Math.max(med.atrasoMax, atraso);
        med.atrasoN += 1;
      }
    }
    this.#ultimaVolta = agora;
    if (mudaram > 0) {
      this.#mudancas += 1;
      this.#ultimaMudanca = agora;
      this.#opts.anuncia(`[poller] ${cfg.tabela}: ${mudaram} chave(s) mudaram (${ms} ms${passos ? `: ${passos}` : ''})`);
      this.#opts.aoMudar(cfg.tabela, cfg.query);
    } else if (buscadas > 0) {
      // A busca trouxe linha, mas nenhuma mudou o delta: é a margem
      // rebuscando a mesma janela, como ela deve. Não é evento, e anunciar
      // seria invalidar cache (e, desde a F4, RECALCULAR página) a cada 12 s
      // para produzir exatamente o número que já estava lá.
      this.#rebuscas += 1;
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

/**
 * Nomes normalizados e `interval` em dias — o mesmo valor que a carga em lote grava.
 *
 * O `pg` entrega `interval` como `PostgresInterval`, um objeto novo a cada leitura. Sem
 * converter, `mesmaLinha` (`!==`) via toda rebusca de `retorno-prioritario` e
 * `reincidencia` como mudança — a "fantasma" do PLANO-MESTRE R.0, que derrubava o cache de
 * quatro páginas a cada 12 s — e o overlay mesclava objeto onde o disco tem número.
 */
function normalizaChaves(linha: Record<string, Escalar>): Record<string, Escalar> {
  const out: Record<string, Escalar> = {};
  for (const [k, v] of Object.entries(linha)) {
    const duracao = comoDuracao(v);
    out[normalizeName(k)] = duracao ? duracaoEmDias(duracao) : v;
  }
  return out;
}
