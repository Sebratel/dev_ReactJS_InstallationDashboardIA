// A API de leitura. `node:http`, sem framework.
//
// **Por que sem Fastify, que é o que `docs/ARCHITECTURE.md` declara.** Divergência
// deliberada e registrada, não esquecimento. São cinco rotas `GET` sobre um
// snapshot em disco: não há corpo para validar, não há escrita, não há
// autenticação ainda. O repositório inteiro roda sem passo de build e com quatro
// dependências, e `node:http` mantém isso. Quando existir Permission Engine, corpo
// de requisição e WebSocket de realtime — as Fases 4 e 5 —, a conta muda e a
// decisão deve ser revista.
//
// **Somente leitura, no protocolo.** Só `GET` e `HEAD` passam; qualquer outro
// método leva 405 antes de qualquer roteamento. É a quarta camada da regra de
// somente-leitura do projeto, e a única que um cliente enxerga — as outras três
// (usuário do banco, `default_transaction_read_only`, `assertReadOnly`) ficam do
// lado do Query Engine, que esta API nem chama: ela lê snapshot.
//
// **Uma página por vez, carregada sob demanda.** Carregar `diario-instalacao`
// custa ~1,8 s (98 mil linhas de disco mais a materialização de uma tabela
// calculada). O cache é por página e não expira: o snapshot em disco não muda
// sozinho — quem o refaz é `npm run snapshot`, e aí o processo é reiniciado.
//
// **O que saiu daqui (27/09/2026, ACHADOS #158)**, sem mudar comportamento — o arquivo
// tinha 2.694 linhas: as opções em `opcoes-servidor.ts`, os utilitários de HTTP em
// `http-util.ts`, a lista de valores de segmentação em `valores-segmentacao.ts` e os
// arquivos da tela em `estatico.ts`. O que fica é o roteamento e o ciclo de vida de uma
// página (carregar, calcular, invalidar). Próximos candidatos: as rotas de `/auth/*` e
// o corpo de `/api/saude`.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { normalizeName, SemanticModel } from '../../packages/semantic-model/src/model.ts';
import { rotuloDeColuna } from '../../packages/semantic-model/src/projecao.ts';
import { loadDashboards, type DashboardSpec, type FiltroSpec } from '../../packages/widget-engine/src/spec.ts';
import { decodificaFiltros } from '../../packages/widget-engine/src/filtro-url.ts';
import { carrega, type Carregado } from '../../packages/snapshot/src/carrega.ts';
import { leManifesto, maisAntigo, type Manifesto } from '../../packages/snapshot/src/manifesto.ts';
import { carimboDasCalculadas } from '../../packages/snapshot/src/tabelas-calculadas.ts';
import { planeja } from '../../packages/snapshot/src/plano.ts';
import { calculadasAlimentadasAoVivo, recalculosAoVivo } from '../../packages/snapshot/src/nativas.ts';
import { type DaxValue } from '../../packages/measure-engine/src/value.ts';
import { MemoryCache } from '../../packages/query-engine/src/cache-memory.ts';
import { QueryRegistry } from '../../packages/query-engine/src/registry.ts';
import type { Cache } from '../../packages/query-engine/src/types.ts';
import {
  CacheDeResposta,
  carimboDoSnapshot,
  chaveDaResposta,
  chaveDoCompleto,
  diaDoCalculo,
  identidadeDoCalculo,
  retencaoDaPagina,
  type EstadoDoCache,
} from './cache-resposta.ts';
import { CarimboVigiado } from './carimbo-vigiado.ts';
import { escopoDoCache } from './escopo-cache.ts';
import { CacheDeVisual, TETO_PADRAO_MB } from './cache-visual.ts';
import {
  apagaSessaoDoPedido,
  cookieDeSessao,
  criaSessao,
  derrubaSessoesDe,
  identificaPorSessao,
  listaSessoes,
  type Identidade,
  type Sessoes,
} from './identidade.ts';
import { ErroDeAcesso, type Mudanca } from './permissoes.ts';
import { SEM_GRAVACAO, type TipoDeEvento } from './eventos-seguranca.ts';
import { verificaIdToken, type VerificadorDeToken } from './auth-google.ts';
import { verificaIdTokenFirebase, type BuscaCertificados } from './auth-firebase.ts';
import { calculaPagina, segmentacaoDe, LINHAS_MAXIMO, LINHAS_PADRAO, TERMO_MAXIMO, type PaginaCalculada } from './calcula.ts';
import { carregaLayout } from '../../tools/layout/src/valida.ts';
import type { LayoutSpec } from '../../tools/layout/src/schema.ts';
import { leStatus, montaStatusDeRefresh, resumeDegradacao, type QuerySaude } from '../../tools/refresh/src/status.ts';
import { PiscinaWorkers } from './piscina-workers.ts';
import { linhasDoOverlay, mescladoresDe, type OverlayDeTabela } from './overlay-realtime.ts';
import { Metricas, ORIGENS, origemDoPedido, prioridadeDe, type OrigemDoPedido } from './metricas.ts';
import { VooUnico, type Voo } from './voo-unico.ts';
import { redisAusente } from './saude-do-redis.ts';
import { aplicaHeadersDeSeguranca } from './headers-seguranca.ts';
import { LimitadorDeTaxa, ipDoPedido } from './limitador-taxa.ts';
import { leSpecDeSeguranca, type SpecDeSeguranca } from './spec-seguranca.ts';
import { comStatus, inteiro, leCorpo, parseJsonSeguro, responde, tokensIguais } from './http-util.ts';
import { VALORES_MAXIMO, VALORES_PADRAO, chaveDeValores, serializaValor, valoresDistintos } from './valores-segmentacao.ts';
import { serveEstatico } from './estatico.ts';
import type { ServidorOptions } from './opcoes-servidor.ts';

// Quem importava daqui continua importando daqui (testes, `index.ts`, sondas).
export type { ServidorOptions } from './opcoes-servidor.ts';
export { VALORES_MAXIMO, VALORES_PADRAO, chaveDeValores, comparaValorDeSegmentacao } from './valores-segmentacao.ts';


/**
 * Quantos datasets a thread principal guarda antes de podar o mais antigo.
 *
 * **6, o mesmo de `TETO_CACHE_POR_WORKER`**, e pelo mesmo argumento: uma thread
 * atende TODAS as páginas do menu, não uma. O número é folgado de propósito —
 * medido em 21/09/2026, depois de servir as 14 páginas uma vez, a thread
 * principal tinha **2** datasets vivos (`paginasCarregadas` em `/api/saude`),
 * porque no caminho de produção quem calcula é a piscina. Até 05/10/2026 quem
 * de fato enchia este mapa era `/api/dashboards/:id/valores`, calculada nesta
 * thread; desde então a lista também sai da piscina (`calculaValores`), e o mapa
 * só se enche quando a worker falha ou a piscina está desligada.
 *
 * Ver `guardaCarregada` para por que um teto passou a ser necessário.
 */
export const TETO_CARREGADAS = 6;

/**
 * O que `npm run api` passa em `avisoDasPaginas` (ACHADOS #175): a VISÃO PRODUTIVA
 * (`agendamento-field`) na hora; as análises detalhadas, juntas, a cada 2 min.
 * `API_REALTIME_DEMAIS_MS=0` volta tudo para "na hora".
 */
export const PADRAO_AVISO_DAS_PAGINAS = { imediatas: ['agendamento-field'], demaisACadaMs: 120_000 } as const;

/**
 * O teto de tentativas em `/auth/*` (as quatro rotas de POST), por IP, na
 * janela abaixo. É a rota que importa de verdade: `/auth/interno` compara
 * `TOKEN_INTERNO` em tempo constante (`tokensIguais`), mas nada limitava a
 * FREQUÊNCIA de tentativa antes desta peça.
 */
const LIMITE_AUTH_TENTATIVAS = 10;
/** A janela do limite acima, em ms. */
const JANELA_AUTH_MS = 5 * 60_000;
/** O teto frouxo de `/api/*`, só contra abuso grosseiro — não deve incomodar
 *  uso normal nem paginação rápida numa tabela grande. */
const LIMITE_API_POR_MINUTO = 300;
/** O balde PRÓPRIO de `origem=prefetch`, por IP, na mesma janela (ACHADOS #182). O
 *  prefetch da vizinhança (#179) manda ~40 pedidos por abertura de página: no balde de
 *  cima, cinco aberturas num minuto negavam layout, valores e SSE — o "uso normal" que
 *  o teto prometia não incomodar. Separado, o especulativo negado não custa nada a quem
 *  clica, e o teto contra abuso continua finito (300 + 600). Declarar `prefetch` só
 *  REBAIXA o pedido na fila (`origemDoPedido`), então não há o que ganhar mentindo. */
const LIMITE_PREFETCH_POR_MINUTO = 600;
/** Quanto a "última pronta" de uma pergunta vive sem ser recalculada (ACHADOS #164). */
const TTL_ULTIMA_PRONTA_S = 7 * 24 * 3600;
const JANELA_API_MS = 60_000;
/** SSE abertas ao mesmo tempo por conta (SEC-003). Um navegador em HTTP/1.1 não passa
 *  de 6 conexões por host, então 20 cobre três navegadores da mesma pessoa. */
const MAX_SSE_POR_USUARIO = 20;
/** Tabela só-do-poller → calculadas que ela alimenta (ver `nativas.ts`). */
const ALIMENTADAS_AO_VIVO = calculadasAlimentadasAoVivo();
/** Calculada → fontes do recálculo pelo tempo real (ver `nativas.ts`). */
const RECALCULOS_AO_VIVO = recalculosAoVivo();

/**
 * Carrega `backend/specs/layout/*.layout.yaml` uma vez, na subida. Diretório ausente vira mapa
 * vazio — mesmo espírito de `leManifesto`: falta de arquivo é estado, não exceção. Uma
 * página sem `.layout.yaml` simplesmente não aparece no mapa, e a rota devolve 404 com
 * o comando que resolve (`npm run layout:extrai`).
 */
function carregaLayouts(dirLayout: string): Map<string, LayoutSpec> {
  const mapa = new Map<string, LayoutSpec>();
  if (!fs.existsSync(dirLayout)) return mapa;
  for (const arquivo of fs.readdirSync(dirLayout)) {
    if (!arquivo.endsWith('.layout.yaml')) continue;
    const id = arquivo.slice(0, -'.layout.yaml'.length);
    mapa.set(id, carregaLayout(path.join(dirLayout, arquivo)));
  }
  return mapa;
}


/**
 * O padrão de `ServidorOptions.reaquece`: não reaquece nada.
 *
 * Constante nomeada, e não um `async () => {}` escrito no lugar, porque
 * `aoTabelaMudar` compara por IDENTIDADE para decidir se emite o SSE na hora ou
 * espera o reaquecimento. Um literal novo a cada construção faria a comparação
 * ser sempre falsa, e todo teste passaria a esperar por um reaquecimento que
 * não existe.
 */
const naoReaquece = (): Promise<void> => Promise.resolve();

/**
 * Quem recebe o corpo inteiro de `GET /api/saude`: sessão válida (ou o Aquecedor), ou um
 * pedido da própria máquina — o healthcheck do contêiner e o `npm start` batem em
 * `127.0.0.1`. O endereço é o do SOCKET, nunca `X-Forwarded-For`, que quem pede escreve.
 */
export function saudeCompletaPara(e: { autenticado: boolean; enderecoRemoto: string | undefined }): boolean {
  if (e.autenticado) return true;
  const a = e.enderecoRemoto ?? '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

export class Servidor {
  private readonly piscina: PiscinaWorkers;

  // `piscinaWorkers` entra no Omit porque o construtor a desestrutura FORA de
  // `resto` (vira `this.piscina`) — sem ela aqui, o tipo exige um padrão que
  // nunca é escrito e o compilador acusa a linha errada.
  // Os `estadoDo*` ficam opcionais de verdade: sem eles o `/api/saude` só omite a seção.
  private readonly opts: Required<
    Omit<
      ServidorOptions,
      | 'cache'
      | 'aoFalharCache'
      | 'verificadorGoogle'
      | 'certificadosFirebase'
      | 'piscinaWorkers'
      | 'estadoDoPoller'
      | 'estadoDoAgendador'
      | 'estadoDaGuarda'
      | 'estadoDoDisjuntor'
      | 'avisoDasPaginas'
    >
  > &
    Pick<ServidorOptions, 'estadoDoPoller' | 'estadoDoAgendador' | 'estadoDaGuarda' | 'estadoDoDisjuntor' | 'avisoDasPaginas'>;
  /** Substitui o `OAuth2Client` real em teste. `undefined` em produção — ver
   *  `auth-google.ts`. Fica fora de `this.opts` porque não tem um valor
   *  "padrão" que faça sentido preencher, diferente dos outros campos. */
  private readonly verificadorGoogle: VerificadorDeToken | undefined;

  private readonly certificadosFirebase: BuscaCertificados | undefined;
  /** Sessões de login ativas, em memória — mesmo desenho de `carregadas`/
   *  `completos`: não sobrevive a um restart, e está certo (perder sessão pede
   *  login de novo, nunca serve dado de ninguém). */
  private readonly sessoes: Sessoes = new Map();
  /**
   * Segredo gerado uma vez por processo — NUNCA configurável, NUNCA escrito
   * em disco, nunca sai deste processo a não ser no cabeçalho que o próprio
   * `Aquecedor` manda de volta pra si mesmo (`index.ts`). Existe porque o
   * `Aquecedor` bate em `/api/dashboards/*` por HTTP de propósito (comentário
   * no topo de `aquecedor.ts` explica: é o único jeito de acertar a MESMA
   * chave de cache que o navegador usaria) — e essas rotas agora exigem
   * sessão. Trocar a cada boot é a defesa: nada fora deste processo em
   * execução pode ter adivinhado o valor de antemão.
   */
  private readonly segredoAquecedor = crypto.randomUUID();
  private readonly model: SemanticModel;
  private readonly dashboards: DashboardSpec[];
  /** `backend/specs/layout/*.layout.yaml`, carregado uma vez — não muda em runtime, e ler o
   *  disco por pedido não caberia nos ~10ms de resposta a quente. Página sem arquivo
   *  simplesmente não entra no mapa; ver Fase L4 de docs/PLANO-LAYOUT-V1.md §6. */
  private readonly layouts: Map<string, LayoutSpec>;
  /** De onde saem os TTLs — `backend/specs/_catalog/cache-policies.yaml`, já decididos. */
  private readonly registry: QueryRegistry;
  private readonly cache: CacheDeResposta;
  /** Qual adapter está ligado. Sai em `GET /api/saude` — sem isso não há como
   * saber, olhando um servidor de fora, se o Redis entrou ou se caiu no padrão. */
  private readonly tipoDeCache: string;
  /** Página → avaliador carregado. A promessa entra no mapa **antes** de resolver,
   * para que dois pedidos simultâneos da mesma página não carreguem duas vezes. */
  private readonly carregadas = new Map<string, Promise<Carregado>>();
  /** Cache dos valores distintos de segmentações (categorias) para eliminar buscas repetidas de disco/dataset. */
  private readonly cacheValoresDistintos = new Map<string, DaxValue[]>();
  /**
   * A lista em cálculo, por `chaveDeValores`. A tela abre uma página pedindo as
   * segmentações todas de uma vez (10 na `agendamento-field`), e o reaquecimento pede
   * as mesmas: sem isto, cada pedido igual viraria uma tarefa a mais na piscina.
   */
  private readonly valoresEmCurso = new Map<string, Promise<DaxValue[] | { erroDoPedido: string }>>();
  /** Páginas que receberam a "última pronta" e esperam o aviso da nova. Ver `pagina()`. */
  private readonly paginasComAnterior = new Set<string>();
  /** Quantas vezes `esqueceAPagina` passou por cada página. Ver o uso em `valores`. */
  private readonly geracoes = new Map<string, number>();
  /** As páginas não imediatas que mudaram desde a última rodada. Ver `aoTabelaMudar`. */
  private readonly paginasJuntadas = new Set<string>();
  /** E as tabelas que as fizeram mudar — só para a linha de log da rodada. */
  private readonly tabelasJuntadas = new Set<string>();
  private timerDasJuntadas: ReturnType<typeof setTimeout> | null = null;
  /**
   * A identidade que o dataset de CADA página reflete. Avançou? Só o daquela
   * página é lixo — ver `identidadeDaPagina` para o número que mediu por que
   * isto deixou de ser uma string só.
   */
  private readonly identidadeDasCarregadas = new Map<string, string>();
  /**
   * O resultado inteiro de cada tabela e matriz já calculada, para que a janela
   * seguinte seja um `slice`. Ver `cache-visual.ts` — e note que ele **não** é o
   * adapter de `cache`: estas entradas têm dezenas de MB e nunca vão para o Redis.
   */
  private readonly completos: CacheDeVisual;
  /**
   * Dashboard → ids das queries de que ele depende (`planeja([dash], model).queries`),
   * calculado uma vez na subida — não muda em runtime, e recalculá-lo por evento do
   * poller pagaria o fechamento de dependências de novo a cada mudança no Voalle.
   * É o mapa que `aoTabelaMudar` usa para saber quem precisa perder cache.
   */
  private readonly queriesPorDashboard = new Map<string, string[]>();
  /**
   * Dashboard → nomes normalizados das tabelas que ele carrega. Calculado uma
   * vez na subida, do MESMO `planeja([dash], model)` que produz
   * `queriesPorDashboard` — duas travessias do plano para duas perguntas sobre
   * o mesmo plano divergiriam na primeira que uma delas deixasse de refazer.
   *
   * Serve para recortar o overlay antes de ele atravessar a fronteira da
   * worker: mandar as 7 tabelas vigiadas para uma página que usa uma só é
   * serializar delta que o outro lado vai ignorar, a cada cálculo.
   */
  private readonly tabelasPorDashboard = new Map<string, Set<string>>();
  /** Dashboard → calculadas que ele carrega (normalizadas), do mesmo `planeja`. */
  private readonly calculadasPorDashboard = new Map<string, Set<string>>();
  /** Conexões `GET /api/eventos` abertas — o SSE do poller de quase-realtime. */
  private readonly assinantesSSE = new Set<http.ServerResponse>();
  private readonly sseAbertasPorUsuario = new Map<string, number>();

  /**
   * Os contadores do F0 (ver `metricas.ts`). Somados no caminho quente, lidos em
   * `GET /api/saude`. Público para o teste poder afirmar sobre eles sem passar
   * por HTTP — um contador que ninguém confere é um número que se acredita.
   */
  readonly metricas = new Metricas();

  /**
   * Quantos pedidos com a MESMA chave de cache estão calculando agora.
   *
   * **Isto ainda não funde nada** — é a medição que justifica (ou não) o
   * single-flight da fase seguinte. Hoje N pedidos iguais em MISS viram N
   * cálculos, e o SSE torna essa rajada sincronizada por construção: um evento
   * acorda todos os navegadores com aquela página aberta, e como o escopo do
   * cache é o mesmo para todos (`escopo-cache.ts`), eles disputam a mesma
   * chave. `concorrentes_mesma_chave` é a marca d'água disso.
   */
  private readonly emCalculo = new Map<string, number>();

  /**
   * O single-flight (F2). Por chave de resposta, no máximo um cálculo no ar.
   *
   * Fica no `Servidor` e não em cada pedido porque o ponto dele é justamente
   * atravessar pedidos: dois `GET` diferentes, do mesmo recorte, têm de encontrar
   * o mesmo voo. Ver `voo-unico.ts`.
   */
  private readonly vooUnico = new VooUnico();

  /** Rate limiting de `/auth/*` e de `/api/*` — ver `limitador-taxa.ts`. Usam
   *  `this.opts.agora` (e não `Date.now()` direto) pelo mesmo motivo de todo
   *  outro relógio deste arquivo: um teste precisa poder avançar o tempo sem
   *  esperar de verdade. */
  private readonly limitadorAuth: LimitadorDeTaxa;
  /** Rotas que só respondem a quem fala direto com a api, nunca pelo proxy (S3, `seguranca.yaml`). */
  private readonly rotasSoLocais: ReadonlySet<string>;
  /** `seguranca.yaml` § `sessao` (S2). */
  private readonly politicaDeSessao: SpecDeSeguranca['sessao'];
  /** O TTL que vale: o pedido pela opção, mas nunca acima da spec (S2). */
  private readonly ttlSessaoHoras: number;
  private readonly limitadorApi: LimitadorDeTaxa;
  private readonly limitadorPrefetch: LimitadorDeTaxa;

  /**
   * Intervalo do batimento do SSE, em ms. 25 s por um motivo concreto: o valor
   * tem de ficar ABAIXO do menor timeout de ociosidade no caminho, e 30 s ou
   * 60 s é o que a maioria dos intermediários usa por padrão.
   *
   * POR QUE EXISTE. `GET /api/eventos` mandava `: conectado` e depois ficava
   * MUDO até o poller achar mudança de verdade — o que pode levar horas numa
   * madrugada. Uma conexão silenciosa é indistinguível de uma conexão morta
   * para qualquer proxy no meio: o `nginx.conf` deste repositório dá
   * `proxy_read_timeout 1h`, mas o que estiver na frente dele (terminador de
   * TLS, balanceador da infraestrutura) não foi configurado por nós.
   *
   * O sintoma que isso evita é dos piores de diagnosticar: o `EventSource` do
   * navegador reconecta sozinho, então nada aparece quebrado — o realtime só
   * "às vezes não chega", e o log não registra nada.
   *
   * Comentário SSE (`:`), não `event:`: linha que o `EventSource` descarta sem
   * disparar handler nenhum. Custa 15 bytes por assinante a cada 25 s.
   */
  private static readonly BATIMENTO_SSE_MS = 25_000;


  /**
   * O reaquecimento em curso (F4), ou `null`. Um de cada vez, pelo mesmo motivo
   * que o `Aquecedor` tem o seu `#ocupado`: duas passadas simultâneas dobram o
   * pico de memória de uma máquina que já roda no limite, e a segunda só
   * recalcularia o que a primeira está calculando.
   */
  private reaquecendo: Promise<void> | null = null;
  /**
   * Páginas que um evento pediu para reaquecer ENQUANTO outro reaquecimento
   * corria. Sem isto, um evento que chega no meio seria perdido: o dado dele
   * ficaria invalidado e frio, e o próximo visitante pagaria o cálculo — que é
   * o defeito que a F4 existe para tirar.
   */
  private readonly reaquecerDepois = new Set<string>();

  /**
   * Página → instante do evento que a invalidou, enquanto ninguém pediu a
   * página ainda. É como `primeiro_get_pos_evento_*` sabe qual GET é "o
   * primeiro depois do evento" — a entrada é apagada no primeiro pedido de
   * gente, e o reaquecimento (que é `warmup`) não a consome.
   *
   * Cresce no máximo até o número de páginas declaradas, então não tem teto
   * artificial: um `Map` de 20 entradas de número não é vazamento.
   */
  private readonly eventoSemPedido = new Map<string, number>();

  /** `setInterval` do batimento. Só existe enquanto houver assinante. */
  private batimentoSSE: NodeJS.Timeout | null = null;
  /**
   * O carimbo do snapshot, com a procedência dele — ver `carimbo-vigiado.ts`.
   *
   * Substituiu um `string | null` memoizado atrás de um `fs.watch` com
   * `catch {}` vazio (B8). Construído no construtor porque `leDoDisco`
   * fecha sobre `this.opts`, que só existe depois dele.
   */
  private carimbo!: CarimboVigiado;
  /**
   * O manifesto e as tabelas calculadas por trás do carimbo GLOBAL — a mesma
   * leitura que `leDoDisco()` já faz, guardada para não reler o disco quando
   * `carimboDaPagina` precisa recalcular um hash ESCOPADO. Atualizados juntos,
   * exatamente quando `#memo` de `CarimboVigiado` é atualizado (a leitura de
   * disco só acontece ali, nunca no caminho quente do HTTP) — os dois nunca
   * divergem porque nascem da mesma chamada.
   */
  private manifestoMemo: Manifesto | null = null;
  private calculadasMemo = '';
  /** Motivos JÁ anunciados de queda para cálculo em linha — um log por motivo. */
  private readonly motivosDeFallback = new Set<string>();

  constructor(opts: ServidorOptions) {
    const { cache, aoFalharCache, verificadorGoogle, certificadosFirebase, piscinaWorkers, ...resto } = opts;
    this.piscina = piscinaWorkers ?? new PiscinaWorkers({ desativado: process.env.NODE_ENV === 'test' });
    // **A conta que a F3 precisa separar.** `worker_ms` mede a soma (espera +
    // cálculo) e não distingue "o cálculo é caro" de "o clique ficou atrás de
    // três aquecimentos" — que são problemas diferentes, com consertos
    // diferentes. Só a piscina sabe quando a tarefa saiu da fila, então a
    // separação nasce lá e é rotulada aqui: a piscina devolve um número de
    // prioridade, e quem sabe que 0 se chama `interactive` é este arquivo.
    this.piscina.medeCom(({ prioridade, esperaMs, execucaoMs }) => {
      const origem = ORIGENS[prioridade] ?? 'interactive';
      this.metricas.observa(`fila_ms_${origem}`, esperaMs);
      this.metricas.observa(`calculo_ms_${origem}`, execucaoMs);
    });
    this.verificadorGoogle = verificadorGoogle;
    this.certificadosFirebase = certificadosFirebase;

    this.opts = {
      agora: () => new Date(),
      identifica: (req) =>
        identificaPorSessao(this.sessoes, req, {
          ociosidadeMs: this.politicaDeSessao.ociosidade_minutos * 60_000,
          agora: this.opts.agora().getTime(),
          ip: ipDoPedido(req, this.opts.confiaNoProxy ?? false),
          aoTrocarIp: (usuario, de) => this.registraEventoDeSessao(req, 'sessao_ip_mudou', usuario, `ip-anterior=${de}`),
        }),
      aquecimento: () => ({ ativo: false, pronto: false }),
      tetoDeVisuaisMB: TETO_PADRAO_MB,
      googleClientId: '',
      firebaseProjectId: '',
      dominioCorporativo: 'sebratel.com.br',
      sessaoTtlHoras: Number.POSITIVE_INFINITY, // vale o da spec (S2), ver ttlSessaoHoras
      tokenInterno: '',
      cookieSecure: false,
      producao: false,
      confiaNoProxy: false,
      batimentoSseMs: Servidor.BATIMENTO_SSE_MS,
      overlayRealtime: () => new Map(),
      estadoDoRedis: redisAusente,
      // Sem reaquecimento ligado, `aoTabelaMudar` emite o SSE na mesma volta —
      // o comportamento de antes da F4, e o de todo teste que não pede outra
      // coisa. `naoReaquece` é uma constante e não `async () => {}` para que a
      // comparação por identidade em `aoTabelaMudar` funcione.
      reaquece: naoReaquece,
      eventosDeSeguranca: SEM_GRAVACAO,
      ...resto,
    };
    const specSeg = leSpecDeSeguranca(this.opts.root);
    this.rotasSoLocais = new Set(specSeg.rotas_de_maquina.porta_publica_bloqueia);
    this.politicaDeSessao = specSeg.sessao;
    // SESSAO_TTL_HORAS só encurta; ilegível (NaN, zero, negativo) vale o da spec.
    const ttlPedido = this.opts.sessaoTtlHoras;
    this.ttlSessaoHoras =
      Number.isFinite(ttlPedido) && ttlPedido > 0
        ? Math.min(ttlPedido, specSeg.sessao.ttl_horas)
        : specSeg.sessao.ttl_horas;
    this.limitadorAuth = new LimitadorDeTaxa(LIMITE_AUTH_TENTATIVAS, JANELA_AUTH_MS, () => this.opts.agora());
    this.limitadorApi = new LimitadorDeTaxa(LIMITE_API_POR_MINUTO, JANELA_API_MS, () => this.opts.agora());
    this.limitadorPrefetch = new LimitadorDeTaxa(LIMITE_PREFETCH_POR_MINUTO, JANELA_API_MS, () => this.opts.agora());
    this.completos = new CacheDeVisual({
      tetoBytes: this.opts.tetoDeVisuaisMB * 1024 * 1024,
      aoRecusar: (chave, bytes, teto) => {
        // Recusa não é falha, é orçamento — mas cala-la faria a lentidão daquele
        // visual parecer inexplicável. O `console.error` é o mesmo canal por onde
        // as outras notas do servidor saem.
        console.error(
          `[cache-visual] ${chave} não coube: ${(bytes / 1048576).toFixed(1)} MB ` +
            `contra um teto de ${(teto / 1048576).toFixed(0)} MB. ` +
            `A janela deste visual vai recalcular a cada clique.`,
        );
      },
    });
    this.model = SemanticModel.fromSpecsDir(path.join(opts.root, 'backend', 'specs'));
    this.dashboards = loadDashboards(path.join(opts.root, 'backend', 'specs'));
    this.layouts = carregaLayouts(path.join(opts.root, 'backend', 'specs', 'layout'));
    this.registry = QueryRegistry.fromSpecsDir(path.join(opts.root, 'backend', 'specs'));
    const adapter = cache ?? new MemoryCache();
    // `nome` quando o adapter tem um (`CacheEmCamadas` diz "MemoryCache+RedisCache"):
    // saber que o Redis entrou não basta, é preciso saber que ele entrou **atrás** da
    // memória e não no lugar dela.
    this.tipoDeCache = (adapter as { nome?: string }).nome ?? adapter.constructor.name;
    this.cache = new CacheDeResposta({
      cache: adapter,
      ...(aoFalharCache ? { aoFalhar: aoFalharCache } : {}),
    });
    for (const dash of this.dashboards) {
      const plano = planeja([dash], this.model);
      this.queriesPorDashboard.set(dash.id, plano.queries);
      this.tabelasPorDashboard.set(dash.id, new Set(plano.tabelas.map((t) => normalizeName(t.nome))));
      this.calculadasPorDashboard.set(dash.id, new Set(plano.calculadas.map(normalizeName)));
    }

    // O carimbo e a procedência dele (F5). Construído por último porque
    // `leDoDisco` fecha sobre `this.opts`.
    this.carimbo = new CarimboVigiado({
      leDoDisco: () => {
        // Guardado aqui, e não recalculado em `carimboDaPagina`: esta é a
        // ÚNICA leitura de disco do carimbo (memoizada por `CarimboVigiado`
        // até o próximo `esquece()`), e um hash escopado por página reusa
        // exatamente este manifesto — nunca reabre o arquivo.
        this.manifestoMemo = leManifesto(this.opts.snapshotDir);
        this.calculadasMemo = carimboDasCalculadas(this.opts.snapshotDir);
        return carimboDoSnapshot(this.manifestoMemo, this.calculadasMemo);
      },
      // `null` (e não uma exceção) quando o diretório não existe: uma API sem
      // snapshot ainda não é uma API com o observador quebrado, e tratar as
      // duas do mesmo jeito faria a saúde acusar defeito onde só falta dado.
      vigia: (aoMudar, aoMorrer) => {
        if (!fs.existsSync(this.opts.snapshotDir)) return null;
        const w = fs.watch(this.opts.snapshotDir, () => aoMudar());
        // **Sem este ouvinte o processo MORRE** quando o watch quebra em tempo
        // de execução: `fs.watch` devolve um `EventEmitter` com zero ouvintes
        // de `error`, e um `error` sem ouvinte vira exceção não tratada. Mesmo
        // defeito que o `ioredis` tinha antes da F2.1, em outro módulo.
        w.on('error', (err: unknown) => {
          w.close();
          aoMorrer(err);
        });
        return w;
      },
      agora: () => this.opts.agora(),
    });
  }

  /** O segredo desta subida, para `index.ts` repassar ao `Aquecedor` — ver o
   *  campo `segredoAquecedor` acima para o porquê de existir. */
  segredoInterno(): string {
    return this.segredoAquecedor;
  }

  /**
   * O cálculo está indo para a piscina de workers?
   *
   * Existe para o TESTE poder AFIRMAR em qual dos dois caminhos ele está. O
   * defeito que a F1 consertou vivia exatamente na diferença entre eles, e um
   * teste de overlay que rodasse sem querer no ramo de fallback passaria verde
   * sem provar nada — foi assim que o buraco sobreviveu (ver
   * `backend/api/test/overlay-worker.test.ts`).
   */
  get piscinaAtiva(): boolean {
    return this.piscina.ativa;
  }

  /** O `http.Server`, sem escutar porta nenhuma — quem escuta é o `index.ts`.
   *
   *  `maxHeaderSize` explícito (e não o padrão implícito do Node) para que um
   *  teste possa afirmar o número, em vez de confiar num padrão que muda
   *  entre versões do runtime. */
  criaHttp(): http.Server {
    return http.createServer({ maxHeaderSize: 16_384 }, (req, res) => {
      // A duração é medida AQUI, e não dentro de `pagina()`, porque aqui ela
      // cobre toda saída: 200, 404 de página inexistente, 400 de filtro
      // ilegível, 409 de snapshot faltando e a exceção que vira 500. Medir por
      // dentro exigiria uma linha em cada `return`, e a primeira esquecida
      // faria a média mentir para baixo — justamente nos casos que interessam.
      const t0 = Date.now();
      const rota = (req.url ?? '/').split('?')[0] ?? '/';
      if (rota.startsWith('/api/dashboards/')) {
        res.on('finish', () => this.metricas.observa('get_pagina_ms', Date.now() - t0));
      }
      this.atende(req, res).catch((err: unknown) => {
        this.metricas.conta('erros_500');
        // O detalhe completo (mensagem + stack) vai SEMPRE para o log, com um
        // id — é o que permite investigar de verdade. O que sai na resposta
        // HTTP é que muda: fora de produção, `err.message` ajuda a depurar
        // local (é o que todo teste hoje espera); em produção, uma exceção
        // interna pode citar caminho de arquivo, nome de coluna, ou detalhe de
        // driver — nada disso é para quem só pediu um dashboard.
        const id = crypto.randomUUID();
        const detalhe = err instanceof Error ? (err.stack ?? err.message) : String(err);
        console.error(`[erro-500] ${id}: ${detalhe}`);
        responde(
          res,
          500,
          this.opts.producao
            ? { erro: 'Erro interno.', id }
            : { erro: err instanceof Error ? err.message : String(err), id },
        );
      });
    });
  }

  destroi(): void {
    if (this.timerDasJuntadas !== null) clearTimeout(this.timerDasJuntadas);
    this.timerDasJuntadas = null;
    this.carimbo.para();
    this.desligaBatimento();
    this.piscina.destroi();
  }


  /**
   * Uma linha de log por negativa de segurança — 401, 403, 429. Até
   * 17/09/2026 (teste de intrusão ASVS V7.2) nenhuma delas registrava nada:
   * brute force de `TOKEN_INTERNO`, enumeração de sessão, varredura de CSRF e
   * saturação do rate limit passavam invisíveis, sem trilha para detecção nem
   * forense — o gap A09 do OWASP. O próprio `limitador-taxa.ts` existe para
   * conter brute force, mas o bloqueio não gerava evento.
   *
   * Imprime SÓ metadado — `status`, `ip` (a mesma chave que o limitador conta,
   * via `ipDoPedido`), `rota` e um `motivo` curto. **Nunca** corpo, token, valor
   * de header ou dado de cliente (regra do `snapshot/` em CLAUDE.md). Vai por
   * `console.warn`, canal separado do `[erro-500]` (que é `console.error`), no
   * mesmo estilo de prefixo entre colchetes do resto do arquivo.
   */
  private registraEventoSeg(req: http.IncomingMessage, status: number, motivo: string, email?: string): void {
    const ip = ipDoPedido(req, this.opts.confiaNoProxy ?? false);
    const rota = (req.url ?? '/').split('?')[0] ?? '/';
    console.warn(`[seg] status=${status} ip=${ip} metodo=${req.method ?? '?'} rota=${rota} motivo=${motivo}`);
    // E no banco (`eventos-seguranca.ts`, ACHADOS #208), onde sobrevive ao container.
    const tipo: TipoDeEvento = motivo.includes('csrf')
      ? 'csrf'
      : motivo === 'token-interno-invalido' || motivo === 'login-recusado'
        ? 'login_failed'
        : status === 429
          ? 'rate_limited'
          : status === 401
            ? 'unauthorized'
            : 'forbidden';
    this.opts.eventosDeSeguranca.registra({ tipo, status, email: email ?? null, ip, metodo: req.method ?? '?', rota, motivo });
  }

  /** O que a sessão nova guarda de quem a criou (S2): o relógio do servidor e o IP. */
  private dadosDaSessaoNova(req: http.IncomingMessage): { agora: number; ip: string } {
    return { agora: this.opts.agora().getTime(), ip: ipDoPedido(req, this.opts.confiaNoProxy ?? false) };
  }

  /** Evento de sessão (S2) — não é negativa, então não passa por `registraEventoSeg`. */
  private registraEventoDeSessao(
    req: http.IncomingMessage,
    tipo: 'sessao_ip_mudou' | 'sessao_derrubada',
    email: string,
    motivo: string,
  ): void {
    const ip = ipDoPedido(req, this.opts.confiaNoProxy ?? false);
    const rota = (req.url ?? '/').split('?')[0] ?? '/';
    console.warn(`[seg] ${tipo} ip=${ip} rota=${rota} motivo=${motivo}`);
    this.opts.eventosDeSeguranca.registra({ tipo, status: 200, email, ip, metodo: req.method ?? '?', rota, motivo: motivo.slice(0, 64) });
  }

  /** Login bem-sucedido — só no banco; no log do container ele nunca apareceu. */
  private registraLogin(req: http.IncomingMessage, email: string): void {
    this.opts.eventosDeSeguranca.registra({
      tipo: 'login_ok',
      status: 200,
      email,
      ip: ipDoPedido(req, this.opts.confiaNoProxy ?? false),
      metodo: 'POST',
      rota: (req.url ?? '/').split('?')[0] ?? '/',
    });
  }

  private async atende(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Chamado antes de qualquer roteamento — cobre 200, 401, 404, 405 e 500
    // por igual, mesmo espírito da medição de duração em `criaHttp()`.
    aplicaHeadersDeSeguranca(res, {
      cookieSecure: this.opts.cookieSecure,
      firebaseProjectId: this.opts.firebaseProjectId,
    });

    const url = new URL(req.url ?? '/', 'http://localhost');
    const rota = url.pathname.replace(/\/+$/, '') || '/';

    // Autenticação: as ÚNICAS rotas que aceitam POST, e as únicas que criam ou
    // apagam estado (sessão) em vez de servir dado calculado. Ficam ANTES de
    // qualquer outra guarda — pedir login não pode exigir já estar logado, e
    // a guarda de método abaixo é justamente o que barraria um POST.
    // S3: rota de máquina não responde a pedido que passou por proxy. O nginx escreve
    // `X-Real-IP` em todo pedido, e o cliente não consegue apagá-lo; as ferramentas que
    // usam estas rotas falam direto com 127.0.0.1:3100, sem o cabeçalho. É a segunda
    // camada: a primeira é o próprio nginx devolver 404.
    if (this.rotasSoLocais.has(rota) && req.headers['x-real-ip'] !== undefined) {
      this.registraEventoSeg(req, 404, 'rota-de-maquina-pelo-proxy');
      responde(res, 404, { erro: `Rota '${rota}' não existe.` });
      return;
    }

    if (rota.startsWith('/auth/') && req.method === 'POST') {
      // CSRF: defesa em profundidade sobre o que `SameSite=Lax`
      // (`identidade.ts`) já impede na prática. Só recusa quando `Origin` (ou,
      // na ausência dele, `Referer`) vier presente E discordar do `Host` do
      // pedido — sem nenhum dos dois (chamada servidor-a-servidor, ex.
      // `backend/tools/tela` batendo direto na API), passa: não há navegador aqui para
      // o SameSite proteger, e o segredo (senha do Google/Firebase, ou
      // TOKEN_INTERNO) é quem faz a guarda real.
      if (!this.origemPermitida(req)) {
        this.registraEventoSeg(req, 403, 'csrf-origem-divergente');
        responde(res, 403, { erro: 'Origem do pedido não corresponde ao host — recusado (proteção CSRF).' });
        return;
      }
      const decisaoDeTaxa = this.limitadorAuth.registra(ipDoPedido(req, this.opts.confiaNoProxy ?? false));
      if (!decisaoDeTaxa.permite) {
        this.registraEventoSeg(req, 429, 'rate-limit-auth');
        res.setHeader('Retry-After', String(decisaoDeTaxa.retryAposSegundos));
        responde(res, 429, { erro: 'Muitas tentativas de login. Tente novamente mais tarde.' });
        return;
      }
    }
    if (rota === '/auth/google' && req.method === 'POST') return this.autenticaGoogle(req, res);
    if (rota === '/auth/firebase' && req.method === 'POST') return this.autenticaFirebase(req, res);
    if (rota === '/auth/interno' && req.method === 'POST') return this.autenticaInterno(req, res);
    if (rota === '/auth/logout' && req.method === 'POST') return this.logout(req, res);

    // A gestão de acessos é a ÚNICA escrita fora de `/auth/*` (ACHADOS #208): grava quem
    // abre cada aba no `DB_InstallationDashboard`, só para admin/dev (`permissoes.ts`). O
    // CSRF aqui é mais estrito que o de `/auth/*`: sem `Origin`/`Referer` também recusa —
    // esta rota só tem um cliente legítimo, a tela, e a tela é um navegador.
    const ehGestaoDeAcesso = rota === '/api/admin/acessos' || rota.startsWith('/api/admin/acessos/');
    const ehGestaoDeSessao = rota === '/api/admin/sessoes' || rota.startsWith('/api/admin/sessoes/');
    if ((ehGestaoDeAcesso || ehGestaoDeSessao) && req.method === 'POST') {
      const temOrigem = typeof req.headers.origin === 'string' || typeof req.headers.referer === 'string';
      if (!temOrigem || !this.origemPermitida(req)) {
        this.registraEventoSeg(req, 403, 'csrf-gestao-de-acesso');
        responde(res, 403, { erro: 'Origem do pedido ausente ou diferente do host — recusado (proteção CSRF).' });
        return;
      }
    } else if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD, POST');
      responde(res, 405, {
        erro: `Método ${req.method} não existe nesta rota. A API é somente leitura ` +
          `— as únicas exceções são POST /auth/google, /auth/firebase, /auth/interno, /auth/logout` +
          `, /api/admin/acessos/* (gestão de acessos, só admin/dev) e /api/admin/sessoes/* (só admin).`,
      });
      return;
    }

    // O Aquecedor bate nestas mesmas rotas por HTTP, de propósito (ver o
    // comentário de `segredoAquecedor` acima) — reconhecê-lo aqui, antes do
    // cookie de sessão, é o que evita ele levar 401 de si mesmo.
    const cabecalhoAquecedor = req.headers['x-aquecedor-interno'];
    const ehAquecedor =
      typeof cabecalhoAquecedor === 'string' && cabecalhoAquecedor === this.segredoAquecedor;

    // /api/saude fica de fora da guarda de sessão: quem bate nela é o
    // healthcheck do container (docker-compose.prod.yml), que não tem como
    // logar. Mas o corpo inteiro só vai para quem está logado ou para a própria
    // máquina: ele repassa mensagens de erro cruas das fontes, e em 13/10/2026
    // publicava o IP e a porta do banco do Voalle para a rede inteira, sem login.
    if (rota === '/api/saude') {
      let autenticado = ehAquecedor;
      try {
        autenticado ||=
          this.opts.identifica(req) !== null || (!this.opts.googleClientId && !this.opts.firebaseProjectId);
      } catch {
        // Identificação quebrada não pode derrubar o healthcheck: vale como anônimo.
      }
      return this.saude(res, saudeCompletaPara({ autenticado, enderecoRemoto: req.socket.remoteAddress }));
    }

    // Quem está pedindo. `null` sem sessão válida — e é aqui, antes de
    // qualquer roteamento de `/api/*`, que isso vira 401 (docs/DEPLOY.md
    // §2.1: "um pedido sem sessão válida recebe 401 antes do roteamento").
    // A chave do cache carrega o usuário desde antes do login existir, para
    // que nenhum recorte futuro possa ser servido para a pessoa errada.
    const quem = ehAquecedor
      ? { usuario: 'aquecedor-interno', papeis: ['interno'] }
      : this.opts.identifica(req) ??
        // O bypass `dev-local` só vale quando NENHUM provedor está configurado.
        // Tem de citar os dois: com o Firebase ligado e o GIS desligado (que é o
        // arranjo normal depois de 16/09/2026), olhar só o `googleClientId`
        // voltaria a servir `/api/*` sem sessão — o defeito de 04/09 de novo,
        // por outra porta. Ver `portao-login.ts`.
        (!this.opts.googleClientId && !this.opts.firebaseProjectId
          ? { usuario: 'dev-local', papeis: ['sem-login'] }
          : null);

    if (rota.startsWith('/api/')) {
      // O Aquecedor fica isento — ele bate nestas rotas em rajada de
      // propósito (reaquecimento pós-evento, F4), e é reconhecimento pelo
      // mesmo segredo por processo que já o isenta do 401 logo abaixo.
      if (!ehAquecedor) {
        const limitador =
          url.searchParams.get('origem') === 'prefetch' ? this.limitadorPrefetch : this.limitadorApi;
        const decisaoDeTaxa = limitador.registra(ipDoPedido(req, this.opts.confiaNoProxy ?? false));
        if (!decisaoDeTaxa.permite) {
          this.registraEventoSeg(req, 429, 'rate-limit-api');
          res.setHeader('Retry-After', String(decisaoDeTaxa.retryAposSegundos));
          responde(res, 429, { erro: 'Muitas requisições. Tente novamente mais tarde.' });
          return;
        }
      }
      if (!quem) {
        this.registraEventoSeg(req, 401, 'sessao-ausente-ou-invalida');
        responde(res, 401, { erro: 'Sessão inválida ou ausente. Faça login em /auth/firebase ou /auth/google.' });
        return;
      }
      if (ehGestaoDeAcesso) return this.gestaoDeAcesso(req, res, rota, quem);
      if (ehGestaoDeSessao) return this.gestaoDeSessao(req, res, rota, quem);
      if (rota === '/api/dashboards') return this.lista(res, quem);
      if (rota === '/api/eventos') return this.eventos(req, res, quem);
      if (rota.startsWith('/api/dashboards/')) {
        // `<id>` ou `<id>/valores`. O `id` é decodificado depois do corte: há página
        // com acento, e decodificar antes faria um `%2F` no nome virar separador.
        const resto = rota.slice('/api/dashboards/'.length);
        const barra = resto.indexOf('/');
        // `decodeURIComponent` LANÇA (`URIError`) em `%` sem dois hexadecimais
        // atrás (`%ZZ`, `%`, `%c0%ae`). Sem esta guarda a exceção subia até o
        // catch de topo de `criaHttp()` e virava 500 — sujando o contador
        // `erros_500` que `/api/saude` vigia, por uma entrada que é só malformada.
        // Entrada malformada é 400 do cliente, não erro do servidor. Medido em
        // 17/09/2026 (teste de intrusão ASVS V5.1.4). É o único `decodeURIComponent`
        // no caminho do pedido — a querystring usa `URLSearchParams`, que degrada.
        let id: string;
        try {
          id = decodeURIComponent(barra === -1 ? resto : resto.slice(0, barra));
        } catch {
          responde(res, 400, { erro: 'Identificador de página com percent-encoding inválido.' });
          return;
        }
        const sub = barra === -1 ? '' : resto.slice(barra + 1);

        // O portão de aba (`permissoes.ts`), ANTES de qualquer leitura de cache: o
        // cache é compartilhado entre quem pode abrir a aba, então a pergunta "pode?"
        // tem de vir antes de "já tenho pronto?". Página inexistente segue para o 404
        // de sempre — os ids não são segredo (estão no bundle da tela).
        if (this.dashboards.some((d) => d.id === id) && !this.opts.acesso.podeVer(quem, id)) {
          this.registraEventoSeg(req, 403, 'aba-sem-acesso', quem.usuario);
          responde(res, 403, { erro: 'Você não tem acesso a esta aba. Peça a um administrador do dashboard.' });
          return;
        }

        if (sub === '') return this.pagina(res, id, url, quem);
        if (sub === 'valores') return this.valores(res, id, url, quem);
        if (sub === 'layout') return this.layoutDe(res, id);
        responde(res, 404, {
          erro: `'${sub}' não existe em /api/dashboards/${id}. As sub-rotas: valores, layout.`,
        });
        return;
      }
      responde(res, 404, { erro: `Rota '${rota}' não existe. Veja GET /api/saude.` });
      return;
    }

    // A tela (estático) é servida SEM sessão de propósito — é ela que mostra
    // o botão de login. A própria aplicação React decide o que desenhar
    // conforme as chamadas a /api/* voltarem 200 ou 401.
    serveEstatico(res, this.opts.webDir, rota);
  }

  // -------------------------------------------------------------- login

  /**
   * A guarda de CSRF das rotas `/auth/*` (ver `atende()`). `true` quando não
   * há `Origin` nem `Referer` (chamada sem navegador) OU quando o que veio
   * bate com o `Host` do próprio pedido — comparando só host:porta, nunca o
   * esquema: comparar `https://` também travaria o dia em que um
   * terminador de TLS na frente falar `https` com o navegador e `http` com
   * este processo (`X-Forwarded-Proto`, já citado em `nginx.conf`).
   */
  private origemPermitida(req: http.IncomingMessage): boolean {
    const origem = req.headers.origin;
    const referer = req.headers.referer;
    const bruta = typeof origem === 'string' ? origem : typeof referer === 'string' ? referer : null;
    if (bruta === null) return true;
    try {
      return new URL(bruta).host === req.headers.host;
    } catch {
      // Origin/Referer ilegível não é um host que bate — fecha, não abre.
      return false;
    }
  }

  private async autenticaGoogle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let corpo: unknown;
    try {
      corpo = parseJsonSeguro(await leCorpo(req));
    } catch {
      responde(res, 400, { erro: 'Corpo inválido — esperado JSON com { idToken }.' });
      return;
    }
    const idToken = (corpo as { idToken?: unknown } | null)?.idToken;
    if (typeof idToken !== 'string' || idToken === '') {
      responde(res, 400, { erro: 'Faltou "idToken" no corpo do pedido.' });
      return;
    }
    if (!this.opts.googleClientId) {
      // Falha FECHADA: sem client id configurado, nenhum token — nem um de
      // verdade do Google — consegue logar. Ver ServidorOptions.googleClientId.
      responde(res, 401, { erro: 'Login não configurado neste ambiente (GOOGLE_CLIENT_ID ausente).' });
      return;
    }
    const identidade = await verificaIdToken(idToken, {
      clientId: this.opts.googleClientId,
      dominioCorporativo: this.opts.dominioCorporativo,
      ...(this.verificadorGoogle ? { cliente: this.verificadorGoogle } : {}),
    });
    if (!identidade) {
      this.registraEventoSeg(req, 401, 'login-recusado');
      responde(res, 401, {
        erro: `Token inválido, expirado, ou fora do domínio ${this.opts.dominioCorporativo}.`,
      });
      return;
    }
    this.registraLogin(req, identidade.email);
    const token = criaSessao(this.sessoes, identidade.email, this.ttlSessaoHoras, this.dadosDaSessaoNova(req));
    res.setHeader('Set-Cookie', cookieDeSessao(token, this.ttlSessaoHoras, this.opts.cookieSecure));
    responde(res, 200, { usuario: identidade.email });
  }

  /**
   * O mesmo login, pelo Firebase Authentication — a tela usa ESTE desde
   * 16/09/2026 (decisão do Erick). O contrato de resposta é idêntico ao de
   * `/auth/google`: mesmo cookie, mesma sessão, mesmo `{ usuario }`. É o que
   * torna a troca invisível para `App.tsx` e para o cache de resposta.
   *
   * O que NÃO é idêntico é a checagem de domínio — o token do Firebase não tem
   * o claim `hd`. Leia o cabeçalho de `auth-firebase.ts` antes de supor que as
   * duas rotas oferecem a mesma garantia.
   */
  private async autenticaFirebase(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let corpo: unknown;
    try {
      corpo = parseJsonSeguro(await leCorpo(req));
    } catch {
      responde(res, 400, { erro: 'Corpo inválido — esperado JSON com { idToken }.' });
      return;
    }
    const idToken = (corpo as { idToken?: unknown } | null)?.idToken;
    if (typeof idToken !== 'string' || idToken === '') {
      responde(res, 400, { erro: 'Faltou "idToken" no corpo do pedido.' });
      return;
    }
    if (!this.opts.firebaseProjectId) {
      // Falha FECHADA, igual a `/auth/google`: sem projeto configurado, nenhum
      // token — nem um emitido de verdade pelo Firebase — cria sessão.
      responde(res, 401, { erro: 'Login não configurado neste ambiente (FIREBASE_PROJECT_ID ausente).' });
      return;
    }
    const identidade = await verificaIdTokenFirebase(idToken, {
      projectId: this.opts.firebaseProjectId,
      dominioCorporativo: this.opts.dominioCorporativo,
      ...(this.certificadosFirebase ? { certificados: this.certificadosFirebase } : {}),
    });
    if (!identidade) {
      this.registraEventoSeg(req, 401, 'login-recusado');
      responde(res, 401, {
        erro: `Token inválido, expirado, ou fora do domínio ${this.opts.dominioCorporativo}.`,
      });
      return;
    }
    this.registraLogin(req, identidade.email);
    const token = criaSessao(this.sessoes, identidade.email, this.ttlSessaoHoras, this.dadosDaSessaoNova(req));
    res.setHeader('Set-Cookie', cookieDeSessao(token, this.ttlSessaoHoras, this.opts.cookieSecure));
    responde(res, 200, { usuario: identidade.email });
  }

  /**
   * O login de uma ferramenta de linha de comando (`backend/tools/tela`, que dirige
   * um navegador de verdade — o React roda dentro dele e pede `/api/*` como
   * qualquer visitante, então precisa de sessão de verdade, não de um atalho
   * de teste). Exige `TOKEN_INTERNO` configurado E batendo — os dois vazios
   * (ambiente sem a variável) já recusa, nunca "combina porque os dois são
   * nada".
   */
  private async autenticaInterno(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let corpo: unknown;
    try {
      corpo = parseJsonSeguro(await leCorpo(req));
    } catch {
      responde(res, 400, { erro: 'Corpo inválido — esperado JSON com { token }.' });
      return;
    }
    const token = (corpo as { token?: unknown } | null)?.token;
    if (!this.opts.tokenInterno || typeof token !== 'string' || !tokensIguais(token, this.opts.tokenInterno)) {
      // A tentativa de brute force do TOKEN_INTERNO — logar o evento (nunca o
      // valor tentado). O rate limit de `/auth/*` já contém a frequência; o log
      // é o que a torna visível.
      this.registraEventoSeg(req, 401, 'token-interno-invalido');
      responde(res, 401, { erro: 'Token interno inválido, ou TOKEN_INTERNO não configurado neste ambiente.' });
      return;
    }
    const sessao = criaSessao(this.sessoes, 'ferramenta-interna', this.ttlSessaoHoras, this.dadosDaSessaoNova(req));
    res.setHeader('Set-Cookie', cookieDeSessao(sessao, this.ttlSessaoHoras, this.opts.cookieSecure));
    responde(res, 200, { usuario: 'ferramenta-interna' });
  }

  private logout(req: http.IncomingMessage, res: http.ServerResponse): void {
    apagaSessaoDoPedido(this.sessoes, req);
    res.setHeader('Set-Cookie', cookieDeSessao('', 0, this.opts.cookieSecure));
    responde(res, 200, { ok: true });
  }

  // ------------------------------------------------------------------- rotas

  private saude(res: http.ServerResponse, completa: boolean): void {
    // **A saúde CONFERE o carimbo, não só relata.** Esta rota é polida a cada
    // 30 s pelo healthcheck do container (`docker-compose.prod.yml`), então ela
    // já é um relógio existente — usá-la como segundo ponto de reconciliação
    // não acrescenta detector nenhum, e cobre o caso de o aquecimento estar
    // desligado (`--sem-aquecer`), em que a conferida do `Aquecedor` não roda.
    //
    // Custa uma leitura de manifesto numa rota de operador. O comentário do
    // `statusDeRefresh` abaixo já diz por que isso é aceitável aqui e não no
    // caminho quente.
    this.confereCarimbo();
    const manifesto = leManifesto(this.opts.snapshotDir);
    const refresh = this.statusDeRefresh() as { queries?: QuerySaude[] };
    if (!completa) {
      // O que um monitor externo precisa (está de pé? há o que avisar?) e nada que
      // descreva a infraestrutura: sem motivo, sem erro de fonte, sem nome de tabela.
      responde(res, 200, { ok: manifesto !== null, degradado: resumeDegradacao(refresh.queries ?? []).degradado });
      return;
    }
    responde(res, 200, {
      // O resumo que um monitor externo lê sem entender o resto (ACHADOS #160). Continua
      // 200 de propósito: dado parado não se conserta reiniciando a API, e um 503 aqui
      // faria o healthcheck do contêiner derrubá-la à toa.
      degradacao: resumeDegradacao(refresh.queries ?? []),
      ok: manifesto !== null,
      snapshot: manifesto === null
        ? { presente: false, dica: 'Rode: npm run snapshot -- --pagina=<id>' }
        : {
            presente: true,
            queries: manifesto.tabelas.length,
            linhas: manifesto.tabelas.reduce((a, t) => a + t.linhas, 0),
            bytes: manifesto.tabelas.reduce((a, t) => a + t.bytes, 0),
            dadoDe: maisAntigo(manifesto),
          },
      paginasCarregadas: [...this.carregadas.keys()].sort(),
      dashboards: this.dashboards.length,
      cache: {
        adapter: this.tipoDeCache,
        // **`adapter` diz o que foi MONTADO; `redis` diz o que está de pé.** Os
        // dois são necessários e nenhum substitui o outro: com o Redis fora do
        // ar, `adapter` continua dizendo "MemoryCache+RedisCache" para sempre,
        // porque é o nome do arranjo escolhido na subida. Era assim que uma API
        // degradada parecia saudável — e a única pista era o tempo de resposta
        // piorar depois de um restart. Ver `saude-do-redis.ts`.
        //
        // Isto NÃO muda o status HTTP: o healthcheck do container testa `r.ok`,
        // e um 503 aqui faria o Docker reiniciar a API em laço por causa de um
        // cache opcional — degradação prevista virando indisponibilidade real.
        redis: this.opts.estadoDoRedis(),
        ...(this.opts.estadoDoDisjuntor ? { disjuntor: this.opts.estadoDoDisjuntor() } : {}),
        // Quanto do orçamento de resultado inteiro está em uso. É o número que diz,
        // olhando de fora, se a paginação vai ser um `slice` ou um recálculo — e o
        // primeiro a olhar quando alguém disser que "a próxima página demora".
        visuais: {
          itens: this.completos.itens,
          mb: Math.round((this.completos.bytes / 1048576) * 10) / 10,
          tetoMB: Math.round(this.completos.tetoBytes / 1048576),
        },
      },
      // O sinal que denuncia vazamento ANTES do OOM, num processo com heap de
      // 10 GB (docs/DEPLOY.md §3.4) — sem isto, ninguém vê o RSS subindo entre
      // refreshes até o processo já ter morrido.
      memoria: {
        rssMB: Math.round(process.memoryUsage().rss / 1048576),
        heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1048576),
      },
      // Sem isto, `npm start` teria de **adivinhar** se a API está se aquecendo
      // sozinha — e adivinharia errado nas duas direções: esperando dez minutos por
      // um aquecedor desligado, ou disparando o seu por cima de um que está no meio.
      aquecimento: this.opts.aquecimento(),
      // O F0 do plano de near-realtime (docs/ANALISE-NEAR-REALTIME.md §7).
      // Contadores acumulados desde a subida; ver `metricas.ts` para o que cada
      // nome quer dizer e por que os picos são marca d'água, não valor
      // instantâneo. `piscina` é lido na hora — é o único que faz sentido
      // instantâneo, porque diz o que está acontecendo AGORA.
      // **Por que a API acredita que está usando ESTE snapshot** (F5, B8).
      // `snapshot` acima diz o que está em disco; isto diz em que a API
      // acredita e de onde veio essa crença. Os dois são necessários: era
      // justamente quando eles discordavam que não havia nada para olhar.
      //
      // `watch.status` diferente de `ativo` NÃO é indisponibilidade — a
      // conferida periódica continua correta, só mais lenta para notar. Por
      // isso isto não mexe no status HTTP, pela mesma razão do `redis` acima.
      carimbo: this.carimbo.estado(),
      realtime: {
        ...this.metricas.instantaneo(),
        sseAbertas: this.assinantesSSE.size,
        piscina: this.piscina.estado,
        overlayTabelas: this.opts.overlayRealtime().size,
        ...(this.opts.estadoDoPoller ? { poller: this.opts.estadoDoPoller() } : {}),
      },
      // `leStatus` nunca lança (arquivo ausente ou corrompido viram `{}`) — mas
      // `/api/saude` não pode cair por causa de um operador de refresh que nunca
      // rodou nesta máquina, então o try/catch fica aqui também, defesa em
      // profundidade. Rota de operador, não caminho quente: um `readFileSync` a
      // mais aqui não paga o mesmo preço que pagaria em `carimboAtual()`.
      refresh,
      // Separado de `refresh` de propósito: aquele descreve o dado (idade, último
      // sucesso), este descreve o RELÓGIO. Um pode estar verde com o outro morto, e
      // foi essa combinação que passou despercebida por 3h43 em 16/09/2026.
      ...(this.opts.estadoDoAgendador ? { agendador: this.opts.estadoDoAgendador() } : {}),
      ...(this.opts.estadoDaGuarda ? { guarda: this.opts.estadoDaGuarda() } : {}),
      // `ok: false` = `permissoes.yaml` inválido e só ADMIN_EMAILS entra. Sem o
      // motivo: esta rota é pública, e o erro pode citar e-mail. O motivo está no log.
      permissoes: this.opts.acesso.estado(),
    });
  }

  private statusDeRefresh(): unknown {
    try {
      const specsDir = path.join(this.opts.root, 'backend', 'specs');
      const agora = this.opts.agora ? this.opts.agora() : new Date();
      return montaStatusDeRefresh(this.opts.snapshotDir, specsDir, agora);
    } catch {
      return {};
    }
  }

  /**
   * `/api/admin/acessos` — a gestão de quem abre cada aba (`permissoes.ts`):
   *
   *   GET                                → a matriz: abas (nome, modo) × pessoas (papel, abas)
   *   POST /pessoa  { email, telas }     → as abas de uma pessoa (substitui a lista dela)
   *   POST /papel   { email, papel }     → viewer | dev | admin — só admin
   *   POST /tela    { tela, modo }       → lista | todos
   *   POST /remove  { email }            → tira a pessoa de tudo
   *
   * Quem não é admin/dev leva 403 também no GET: a matriz lista e-mails de colegas.
   * Os POST respondem com a matriz nova, já relida do banco.
   */
  private async gestaoDeAcesso(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    rota: string,
    quem: Identidade,
  ): Promise<void> {
    const acesso = this.opts.acesso;
    if (!acesso.podeGerir(quem)) {
      this.registraEventoSeg(req, 403, 'gestao-de-acesso-sem-papel', quem.usuario);
      responde(res, 403, { erro: 'Só administrador ou dev gerencia acessos.' });
      return;
    }
    const sub = rota.slice('/api/admin/acessos'.length);
    const navegaveis = this.dashboards.filter((d) => d.type !== 'Tooltip');
    const nomes = new Map(navegaveis.map((d) => [d.id, d.name] as const));
    const respondeMatriz = (): void => {
      const m = acesso.matriz();
      responde(res, 200, {
        eu: { usuario: quem.usuario, papel: acesso.papelDe(quem) },
        telas: m.telas.filter((t) => nomes.has(t.id)).map((t) => ({ ...t, nome: nomes.get(t.id) })),
        pessoas: m.pessoas.map((p) => ({ ...p, telas: p.telas.filter((t) => nomes.has(t)) })),
        pedidos: m.pedidos,
        banco: acesso.estado(),
      });
    };

    if (req.method !== 'POST') {
      if (sub !== '') {
        responde(res, 404, { erro: `'${sub}' não existe em /api/admin/acessos.` });
        return;
      }
      respondeMatriz();
      return;
    }

    let corpo: Record<string, unknown>;
    try {
      const c = parseJsonSeguro(await leCorpo(req));
      if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('corpo não é objeto');
      corpo = c as Record<string, unknown>;
    } catch {
      responde(res, 400, { erro: 'Corpo inválido — esperado um objeto JSON.' });
      return;
    }
    const texto = (v: unknown): string => (typeof v === 'string' ? v : '');
    let mudanca: Mudanca;
    if (sub === '/pessoa') {
      const telas = Array.isArray(corpo.telas) ? corpo.telas.filter((t): t is string => typeof t === 'string') : [];
      mudanca = { acao: 'telas-da-pessoa', email: texto(corpo.email), telas };
    } else if (sub === '/papel') {
      mudanca = { acao: 'papel', email: texto(corpo.email), papel: texto(corpo.papel) as 'viewer' };
    } else if (sub === '/tela') {
      mudanca = { acao: 'modo-da-tela', tela: texto(corpo.tela), modo: texto(corpo.modo) as 'lista' };
    } else if (sub === '/remove') {
      mudanca = { acao: 'remove-pessoa', email: texto(corpo.email) };
    } else if (sub === '/dispensa') {
      mudanca = { acao: 'dispensa-pedido', email: texto(corpo.email) };
    } else {
      responde(res, 404, { erro: `'${sub}' não existe. As ações: /pessoa, /papel, /tela, /remove, /dispensa.` });
      return;
    }
    try {
      await acesso.muda(quem, mudanca);
    } catch (err) {
      if (err instanceof ErroDeAcesso) {
        if (err.status === 403) this.registraEventoSeg(req, 403, 'gestao-de-acesso-recusada', quem.usuario);
        responde(res, err.status, { erro: err.message });
        return;
      }
      throw err;
    }
    // S2 (`sessao.ao_remover_pessoa: derruba_sessoes`): sem isso a pessoa removida seguia
    // logada até o vencimento. `muda` já normalizou o e-mail.
    if (mudanca.acao === 'remove-pessoa' && derrubaSessoesDe(this.sessoes, mudanca.email) > 0) {
      this.registraEventoDeSessao(req, 'sessao_derrubada', mudanca.email, `remove-pessoa por=${quem.usuario}`);
    }
    respondeMatriz();
  }

  /**
   * `/api/admin/sessoes` (S2, `seguranca.yaml` § `sessao.admin_ve_e_derruba`):
   *
   *   GET                          → as sessões vivas, sem o token
   *   POST /derruba  { email }     → derruba todas as sessões daquele e-mail
   *
   * Só admin — dev gerencia abas, não sessões de colegas.
   */
  private async gestaoDeSessao(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    rota: string,
    quem: Identidade,
  ): Promise<void> {
    if (this.opts.acesso.papelDe(quem) !== 'admin') {
      this.registraEventoSeg(req, 403, 'gestao-de-sessao-sem-papel', quem.usuario);
      responde(res, 403, { erro: 'Só administrador vê e derruba sessões.' });
      return;
    }
    const sub = rota.slice('/api/admin/sessoes'.length);
    const lista = () =>
      listaSessoes(
        this.sessoes,
        this.opts.agora().getTime(),
        this.politicaDeSessao.ociosidade_minutos * 60_000,
      );
    if (req.method !== 'POST') {
      if (sub !== '') {
        responde(res, 404, { erro: `'${sub}' não existe em /api/admin/sessoes.` });
        return;
      }
      responde(res, 200, { sessoes: lista() });
      return;
    }
    if (sub !== '/derruba') {
      responde(res, 404, { erro: `'${sub}' não existe. A ação: /derruba.` });
      return;
    }
    let email: unknown;
    try {
      email = (parseJsonSeguro(await leCorpo(req)) as { email?: unknown } | null)?.email;
    } catch {
      email = undefined;
    }
    if (typeof email !== 'string' || email.trim() === '' || email.length > 254) {
      responde(res, 400, { erro: 'Corpo inválido — esperado JSON com { email }.' });
      return;
    }
    const derrubadas = derrubaSessoesDe(this.sessoes, email);
    this.registraEventoDeSessao(req, 'sessao_derrubada', email.trim().toLowerCase(), `por=${quem.usuario}`);
    responde(res, 200, { derrubadas, sessoes: lista() });
  }

  private lista(res: http.ServerResponse, quem: Identidade): void {
    const manifesto = leManifesto(this.opts.snapshotDir);
    const emDisco = new Set(manifesto?.tabelas.map((t) => t.query) ?? []);
    const liberadas = this.dashboards.filter((d) => this.opts.acesso.podeVer(quem, d.id));
    // Entrou e não abre nenhuma aba: vira pedido na tela "Acessos" (sem esperar o banco).
    if (!liberadas.some((d) => d.type !== 'Tooltip')) this.opts.acesso.registraPedido(quem);
    responde(res, 200, {
      // A tela monta a navegação SÓ com o que vem aqui. Esconder a aba é conforto; quem
      // barra é o 403 de `atende()` — pedir a aba pela URL dá no mesmo lugar.
      eu: {
        usuario: quem.usuario,
        papel: this.opts.acesso.papelDe(quem),
        podeGerir: this.opts.acesso.podeGerir(quem),
      },
      dashboards: liberadas.map((d) => ({
        id: d.id,
        nome: d.name,
        visuais: (d.visuals ?? []).length,
        // Uma página que não tem snapshot não vai carregar; dizer isso na lista
        // poupa um erro por clique.
        pronta: this.queriesDe(d).every((q) => emDisco.has(q)),
        // Página de DICA do relatório original (`type: Tooltip`), não página
        // navegável: 550x400, um visual, e no Power BI ela só aparece ao pairar
        // sobre outro visual. São três — `l-inst`, `l-mapa`, `l-tec` — e até
        // 18/09/2026 elas vinham na navegação como se fossem tela, e o aquecedor
        // gastava três entradas do ciclo com elas.
        //
        // **O discriminador é `type`, e NÃO `visibility`.** Medido em 18/09/2026:
        // 10 das 11 páginas REAIS também são `HiddenInViewMode` — só a `capa` é
        // `AlwaysVisible`, porque o relatório original navega por botão a partir
        // da capa. Filtrar por `visibility` teria escondido a aplicação inteira
        // menos a capa.
        tooltip: d.type === 'Tooltip',
      })),
    });
  }

  /**
   * `GET /api/eventos` — o SSE do poller de quase-realtime
   * (`backend/api/src/poller-realtime.ts`). A conexão fica aberta; quem fecha é o
   * navegador (recarregou, saiu da página) — `req.on('close')` é o único jeito
   * confiável de saber disso num `node:http` cru.
   *
   * Sem corpo, sem filtro, sem paginação: um evento aqui só diz "esta página
   * pode ter dado novo", nunca traz dado — o navegador continua buscando pela
   * mesma rota de sempre (`GET /api/dashboards/:id`), só que sem esperar o
   * usuário apertar F5.
   */
  private eventos(req: http.IncomingMessage, res: http.ServerResponse, quem: Identidade): void {
    // Teto de conexões ABERTAS por pessoa (SEC-003): o rate limit conta aberturas, e uma
    // SSE vive horas. Máquina (`interno`, só com TOKEN_INTERNO) fica de fora.
    const contaNoTeto = !quem.papeis.includes('interno');
    const abertas = this.sseAbertasPorUsuario.get(quem.usuario) ?? 0;
    if (contaNoTeto && abertas >= MAX_SSE_POR_USUARIO) {
      this.registraEventoSeg(req, 429, 'sse-teto-por-usuario', quem.usuario);
      responde(res, 429, { erro: 'Conexões de atualização demais abertas para esta conta. Feche outras abas.' });
      return;
    }
    if (contaNoTeto) this.sseAbertasPorUsuario.set(quem.usuario, abertas + 1);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    // Comentário SSE (linha começando com `:`), não dado — só para o navegador
    // considerar a conexão estabelecida na hora, em vez de esperar o 1º evento
    // de verdade para sair do estado "conectando".
    res.write(': conectado\n\n');
    this.assinantesSSE.add(res);
    // A marca d'água responde "quantos usuários ficam conectados ao mesmo
    // tempo?" — a pergunta do requisito 19 que o valor instantâneo nunca
    // responde, porque quem lê `/api/saude` lê num instante qualquer.
    this.metricas.conta('sse_conexoes');
    this.metricas.maximo('sse_conexoes_simultaneas_max', this.assinantesSSE.size);
    this.ligaBatimento();
    req.on('close', () => {
      this.assinantesSSE.delete(res);
      if (contaNoTeto) {
        const restam = (this.sseAbertasPorUsuario.get(quem.usuario) ?? 1) - 1;
        if (restam > 0) this.sseAbertasPorUsuario.set(quem.usuario, restam);
        else this.sseAbertasPorUsuario.delete(quem.usuario);
      }
      this.metricas.conta('sse_desconexoes');
      // Sem assinante o temporizador não tem o que fazer. Deixá-lo rodando
      // acordaria o processo a cada 25 s para escrever em ninguém.
      if (this.assinantesSSE.size === 0) this.desligaBatimento();
    });
  }

  /**
   * Liga o batimento se ainda não estiver ligado. Idempotente de propósito:
   * `eventos()` chama a cada conexão nova, e são N assinantes num temporizador,
   * não um temporizador por assinante.
   */
  private ligaBatimento(): void {
    if (this.batimentoSSE) return;
    this.batimentoSSE = setInterval(() => {
      for (const res of this.assinantesSSE) {
        // `write` num socket já morto não lança — devolve `false` e emite
        // 'error' no stream. Quem limpa o Set é o `req.on('close')`; aqui só
        // não vale deixar a exceção subir e derrubar o temporizador dos outros.
        try {
          res.write(': batimento\n\n');
        } catch {
          /* conexão indo embora; o 'close' remove do Set */
        }
      }
    }, this.opts.batimentoSseMs);
    // Um temporizador de 25 s manteria o event loop vivo para sempre — e a
    // suíte de testes penduraria em vez de terminar.
    this.batimentoSSE.unref?.();
  }

  private desligaBatimento(): void {
    if (!this.batimentoSSE) return;
    clearInterval(this.batimentoSSE);
    this.batimentoSSE = null;
  }

  /**
   * O batimento está ligado? Existe para o teste poder afirmar que ele PARA
   * quando o último assinante sai — um `setInterval` vazado não muda resposta
   * nenhuma, então nada além disto o pegaria.
   */
  get batimentoLigado(): boolean {
    return this.batimentoSSE !== null;
  }

  /** Manda `dashboards` para toda conexão SSE aberta. Sem assinante, não faz nada. */
  private emiteEvento(dashboards: readonly string[]): void {
    this.metricas.conta('poller_invalidacoes');
    if (dashboards.length === 0 || this.assinantesSSE.size === 0) return;
    this.metricas.conta('sse_eventos_emitidos', this.assinantesSSE.size);
    const linha = `data: ${JSON.stringify({ dashboards })}\n\n`;
    for (const res of this.assinantesSSE) res.write(linha);
  }

  /**
   * O poller de quase-realtime (`backend/api/src/poller-realtime.ts`) chama isto
   * quando uma query muda de verdade. Invalida só quem depende dela, nas TRÊS
   * camadas de cache — não o carimbo global, que derrubaria o site inteiro a
   * cada poucos segundos (ver `CacheDeResposta.apagaPagina` e ACHADOS #89):
   *
   *   1. `carregadas` — o avaliador em memória; sem isto, `carrega()` devolveria
   *      o mesmo `Carregado` de antes mesmo com o overlay atualizado.
   *   2. `completos` — resultado inteiro de visual paginável.
   *   3. `cache` (resposta pronta, memória/Redis).
   *
   * Depois avisa por SSE — nessa ordem: o navegador só deve pedir de novo
   * DEPOIS que o cache já não tem a resposta velha para devolver.
   *
   * **F4: entre invalidar e avisar, entra o reaquecimento — POR BAIXO.** Até
   * aqui a cadeia era `invalida → SSE → GET → MISS → 10–20 s de cálculo`: a API
   * avisava que existe dado novo ANTES de preparar o dado novo, e a conta caía
   * em quem clicasse primeiro.
   *
   * A F4 nasceu para inverter isso (`invalida → reaquece → SSE`), e a medição
   * REPROVOU a inversão: segurar o aviso piorou o usuário já conectado em ~5×.
   * O que ficou é `invalida → SSE → reaquece em segundo plano`, e quem colhe o
   * HIT é quem chega DEPOIS (3,3 s → 0,0 s). O porquê, com os números, está em
   * `reaquecePorBaixo` — que é a única descrição correta desta ordem.
   *
   * Três coisas que ele NÃO faz, de propósito:
   *
   *  - **não reaquece o site inteiro.** Só `afetados` — as páginas que dependem
   *    da query que mudou, que são exatamente as que acabaram de perder cache.
   *    Reaquecer as outras seria recalcular o que continua válido.
   *  - **não fura fila.** O reaquecimento entra como `warmup` (quem o executa é
   *    o `Aquecedor`, com o cabeçalho interno), então qualquer clique passa na
   *    frente dele — F3. E não tenta cancelar o que já está numa worker: a F3
   *    mostrou que isso é outro problema.
   *  - **não duplica cálculo.** Se um usuário chegar no meio do reaquecimento,
   *    o single-flight funde os dois no mesmo voo — F2. `warmup` e `GET` da
   *    mesma chave viram um cálculo só.
   */
  aoTabelaMudar(tabela: string, queryId: string): void {
    this.carimbo.esquece();
    // Tabela só-do-poller: invalida quem carrega a calculada que ela alimenta, e só.
    // Pelo fechamento de queries ela não alcança página nenhuma (`alocacao-patrimonio`
    // entra na PG pelo M, e `planeja` lista só a query que vira tabela).
    const viva = normalizeName(tabela);
    const afetados = ALIMENTADAS_AO_VIVO.has(viva)
      ? [...this.calculadasPorDashboard.keys()].filter((id) => this.#alimentaDaPagina(viva, id))
      : [...this.queriesPorDashboard]
          .filter(([, queries]) => queries.includes(queryId))
          .map(([id]) => id);
    if (afetados.length === 0) return;

    // **Quem é avisado agora e quem espera a próxima rodada** (ACHADOS #175). A
    // `field-agenda` muda a cada ~35 s em horário de operação, e cada mudança
    // derrubava junto `relatorio-do-mes` (~1,5–2,5 s de cálculo) e `visao-geral`
    // (~3,5–4,5 s): o reaquecimento nunca alcançava e a API passava o dia ocupada,
    // com quem abria a VISÃO PRODUTIVA esperando na fila atrás delas. As imediatas
    // continuam como sempre; as demais juntam as mudanças e caem de uma vez, no
    // máximo a cada `demaisACadaMs` — o frescor delas troca ~35 s por ≤ 2 min, que
    // é o que o Erick definiu para as análises detalhadas (complemento da VISÃO
    // PRODUTIVA, rápidas, mas não ao segundo).
    const junta = this.opts.avisoDasPaginas;
    if (junta && junta.demaisACadaMs > 0) {
      const depois = afetados.filter((id) => !junta.imediatas.includes(id));
      for (const id of depois) this.paginasJuntadas.add(id);
      if (depois.length > 0) this.tabelasJuntadas.add(tabela);
      if (depois.length > 0 && this.timerDasJuntadas === null) {
        this.timerDasJuntadas = setTimeout(() => this.soltaJuntadas(), junta.demaisACadaMs);
        this.timerDasJuntadas.unref?.();
      }
      const agora = afetados.filter((id) => junta.imediatas.includes(id));
      if (agora.length > 0) this.invalidaEAvisa(agora, tabela);
      return;
    }
    this.invalidaEAvisa(afetados, tabela);
  }

  /** A rodada das páginas que esperaram: tudo o que mudou desde a última, de uma vez. */
  private soltaJuntadas(): void {
    this.timerDasJuntadas = null;
    const paginas = [...this.paginasJuntadas];
    const tabelas = [...this.tabelasJuntadas];
    this.paginasJuntadas.clear();
    this.tabelasJuntadas.clear();
    if (paginas.length > 0) this.invalidaEAvisa(paginas, tabelas.join(', '));
  }

  private invalidaEAvisa(afetados: readonly string[], tabela: string): void {
    const emEvento = Date.now();

    for (const dashId of afetados) {
      // O dataset, os valores das segmentações e os resultados inteiros — ver
      // `esqueceAPagina`, que é a MESMA limpeza que o avanço de identidade em
      // `carrega()` faz. Eram dois trechos, e já divergiam num item:
      // `cacheValoresDistintos` não caía aqui.
      this.esqueceAPagina(dashId);
      // E a identidade guardada junto: o dataset que ela descrevia acabou de
      // sair. Deixá-la para trás faria a próxima carga desta página gravar uma
      // entrada nova sob uma identidade que já estava no mapa — e o descarte
      // seguinte, por refresh, não aconteceria.
      this.identidadeDasCarregadas.delete(dashId);
      // A MESMA invalidação, do lado de cada worker: `cacheDeCarga`
      // (`worker-calculador.ts`) guarda o dataset por thread própria, e sem
      // isto uma worker que já tivesse esta página carregada continuaria
      // servindo o overlay velho para sempre — o F1 de novo, um nível abaixo.
      this.piscina.invalidaPagina(dashId);
      // Efeito colateral, não parte de resposta nenhuma — não há pedido para
      // atrasar esperando o Redis, e `apagaPagina` já nunca lança.
      // A "última pronta" fica: é ela que sai na hora para quem chegar antes do
      // reaquecimento terminar (ver o ramo `servido_anterior` em `pagina()`).
      void this.cache.apagaPagina(dashId, { poupaUltimaPronta: true });
      // Só o PRIMEIRO evento ainda não atendido conta: se três eventos chegarem
      // antes de alguém abrir a página, o atraso que interessa é o do mais
      // antigo, não o do último.
      if (!this.eventoSemPedido.has(dashId)) this.eventoSemPedido.set(dashId, emEvento);
    }
    console.error(`[poller] ${tabela} mudou — invalidando ${afetados.join(', ')}`);

    // **O aviso sai AGORA, e o reaquecimento corre por baixo.** Ver
    // `reaquecePorBaixo` para a medida que derrubou a ordem contrária.
    this.emiteEvento(afetados);
    if (this.opts.reaquece !== naoReaquece) void this.reaquecePorBaixo(afetados);
  }

  /**
   * Reaquece as páginas que o evento invalidou, em segundo plano.
   *
   * **Por que NÃO segura o SSE — medido, não suposto.** A F4 nasceu com a
   * ordem `invalida → reaquece → avisa`, para que o evento significasse "há
   * dado novo pronto" em vez de "descobri que algo mudou". Contra o snapshot
   * de verdade (`npm run probe:reaquecimento`, 08/09/2026), um evento de
   * `protocolos-telefonia` derruba 3 páginas e o resultado foi o inverso do
   * esperado:
   *
   *     sem reaquecimento   evento -> SSE 0,0 s + resposta 2,0 s (miss) = 2,0 s
   *     segurando o SSE     evento -> SSE 9,7 s + resposta 0,0 s (hit)  = 9,7 s
   *
   * O acerto de cache é real e não paga a espera: quem está com a página
   * aberta acaba esperando as OUTRAS páginas do lote esquentarem antes de
   * saber da dele. Avisar por página foi tentado e não resolve — alguém é
   * sempre o último do lote.
   *
   * **E não precisa segurar, porque a F2 e a F3 já cobrem o caso.** Avisado na
   * hora, o GET do usuário entra como `interactive` e o reaquecimento é
   * sequencial (uma página por vez, por causa do pico de memória): sempre
   * sobra uma das duas workers para ele. Ele paga o custo da SUA página, não
   * o do lote. E quando o reaquecimento chegar naquela página, vai encontrar
   * o cache que o próprio usuário encheu — os dois mecanismos não duplicam
   * cálculo, se completam.
   *
   * O que o reaquecimento entrega, então, é o visitante SEGUINTE: quem abrir a
   * página depois do evento a encontra pronta em vez de pagar 10–20 s.
   * `primeiro_get_pos_evento_hit` contra `_miss` é o número que diz se está
   * entregando.
   *
   * Um de cada vez, pelo mesmo motivo que o `Aquecedor` tem o seu `#ocupado`:
   * duas passadas simultâneas dobram o pico de memória de uma máquina que já
   * roda no limite, e a segunda só recalcularia o que a primeira calcula.
   */
  private reaquecePorBaixo(paginas: readonly string[]): void {
    this.metricas.conta('rewarm_pedidos');

    // Já tem um no ar: estas páginas entram na próxima rodada. Descartá-las
    // deixaria o dado delas invalidado e frio, e o próximo visitante pagando
    // o cálculo — que é justamente o que esta fase existe para tirar.
    if (this.reaquecendo !== null) {
      for (const p of paginas) this.reaquecerDepois.add(p);
      this.metricas.conta('rewarm_adiado');
      return;
    }

    const t0 = Date.now();
    const trabalho = (async () => {
      try {
        await this.opts.reaquece(paginas);
        this.metricas.conta('rewarm_sucesso');
      } catch (err) {
        // Falha aqui é degradação prevista, não incidente: sem reaquecimento,
        // o pior caso é o comportamento de antes da F4. Uma linha, não um
        // `throw` — e ninguém fica sem ser avisado, porque o aviso já saiu.
        this.metricas.conta('rewarm_falha');
        console.error(`[reaquecedor] falhou: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.metricas.observa('rewarm_ms', Date.now() - t0);
        this.metricas.conta('rewarm_paginas', paginas.length);
      }
    })();
    this.reaquecendo = trabalho;

    void trabalho.finally(() => {
      this.reaquecendo = null;
      if (this.reaquecerDepois.size === 0) return;
      const proximas = [...this.reaquecerDepois];
      this.reaquecerDepois.clear();
      this.reaquecePorBaixo(proximas);
    });
  }

  /**
   * O primeiro GET de GENTE depois de um evento acertou o cache?
   *
   * É a pergunta que julga a F4 — não "o reaquecimento rodou", mas "a página
   * estava pronta quando alguém precisou dela". E `atraso_ms` diz se o
   * reaquecimento sequer teve chance: se os usuários chegam 200 ms depois do
   * evento, nenhum reaquecimento ganha essa corrida; se chegam 30 s depois,
   * ganha sempre.
   *
   * **Só `interactive` consome a marca.** O pedido do aquecedor é, por
   * construção, o MISS que a F4 existe para pagar no lugar do usuário: contá-lo
   * faria a métrica medir o próprio remédio e responder "miss" para sempre. O
   * `prefetch` fica de fora pelo motivo vizinho — quando a F7 puser o navegador
   * a buscar por antecipação, seria ele, e não a pessoa, respondendo a esta
   * pergunta.
   */
  private marcaPrimeiroGet(dashId: string, origem: OrigemDoPedido, acertou: boolean, desde: number): void {
    if (origem !== 'interactive') return;
    const emEvento = this.eventoSemPedido.get(dashId);
    if (emEvento === undefined) return;
    this.eventoSemPedido.delete(dashId);
    this.metricas.conta(acertou ? 'primeiro_get_pos_evento_hit' : 'primeiro_get_pos_evento_miss');
    this.metricas.observa('primeiro_get_pos_evento_ms', Date.now() - desde);
    this.metricas.observa('primeiro_get_pos_evento_atraso_ms', desde - emEvento);
  }

  /**
   * A forma declarada da página — `backend/specs/layout/<id>.layout.yaml`, cru. Sem filtro, sem
   * cálculo: é por isso que esta rota não precisa do snapshot carregado nem de `quem`.
   */
  private layoutDe(res: http.ServerResponse, id: string): void {
    const dash = this.dashboards.find((d) => d.id === id);
    if (!dash) {
      responde(res, 404, {
        erro: `Página '${id}' não existe. As ${this.dashboards.length}: ` +
          this.dashboards.map((d) => d.id).join(', '),
      });
      return;
    }
    const layout = this.layouts.get(id);
    if (!layout) {
      responde(res, 404, {
        erro: `'${id}' não tem backend/specs/layout/${id}.layout.yaml — rode 'npm run layout:extrai'.`,
      });
      return;
    }
    responde(res, 200, layout);
  }

  private async pagina(
    res: http.ServerResponse,
    id: string,
    url: URL,
    quem: Identidade,
  ): Promise<void> {
    // O relógio do pedido inteiro — do começo à resposta, e não só do cálculo.
    // É o que `primeiro_get_pos_evento_ms` precisa medir: a pergunta da F4 é o
    // que a pessoa esperou, não o que a worker levou.
    const tPedido = Date.now();
    const dash = this.dashboards.find((d) => d.id === id);
    if (!dash) {
      responde(res, 404, {
        erro: `Página '${id}' não existe. As ${this.dashboards.length}: ` +
          this.dashboards.map((d) => d.id).join(', '),
      });
      return;
    }

    const de = inteiro(url.searchParams.get('de'), 0, 0, Number.MAX_SAFE_INTEGER);
    const linhas = inteiro(url.searchParams.get('linhas'), LINHAS_PADRAO, 1, LINHAS_MAXIMO);

    // `?busca=` — o campo "Filtrar…" da tabela. Normalizado AQUI, uma vez, e não a
    // cada linha comparada: `janelaDe` roda `casaComTermo` por linha do resultado
    // inteiro, e baixar a caixa do termo lá dentro seria a mesma alocação por célula
    // que `normalizeName` custou 42,9% do CPU antes de ser memoizada (ACHADOS #110).
    //
    // A normalização tem de casar com a de `casaComTermo`, que compara em minúsculas.
    // Termo só de espaços vira `undefined` — é o mesmo que não buscar, e precisa cair
    // na MESMA chave de cache da abertura sem busca.
    const buscaBruta = (url.searchParams.get('busca') ?? '').trim().toLowerCase();
    if (buscaBruta.length > TERMO_MAXIMO) {
      responde(res, 400, {
        erro: `?busca= aceita no máximo ${TERMO_MAXIMO} caracteres (veio ${buscaBruta.length}).`,
      });
      return;
    }
    const termo = buscaBruta === '' ? undefined : buscaBruta;

    // `?filtro=` — a escolha das segmentações da tela, uma por coluna. Filtro que não
    // dá para entender **derruba o pedido** com 400: aplicar os que deram certo e
    // calar os outros mostraria um número filtrado pela metade dizendo-se filtrado.
    let daTela: FiltroSpec[];
    try {
      daTela = decodificaFiltros(url.searchParams.getAll('filtro'));
    } catch (err) {
      responde(res, 400, { erro: err instanceof Error ? err.message : String(err) });
      return;
    }

    // `?clicado=` — quais colunas do recorte nasceram de CLIQUE num visual, e não de
    // seletor. É o que permite auto-excluir o filtro do visual que desenha aquela
    // coluna (o clicado DESTACA em vez de colapsar) sem fazer o mesmo com o seletor,
    // que tem de recortar tudo. Ver `filtrosDoVisual` em `calcula.ts`.
    //
    // Erra alto, pela mesma razão que `?filtro=`: um `clicado` descartado em silêncio
    // muda a leitura do gráfico sem nada dizer por quê.
    const clicados: { tabela: string; coluna: string }[] = [];
    for (const bruto of url.searchParams.getAll('clicado')) {
      let ok = false;
      try {
        const o: unknown = JSON.parse(bruto);
        const t = (o as { tabela?: unknown }).tabela;
        const c = (o as { coluna?: unknown }).coluna;
        if (typeof t === 'string' && typeof c === 'string' && t !== '' && c !== '') {
          clicados.push({ tabela: t, coluna: c });
          ok = true;
        }
      } catch {
        ok = false;
      }
      if (!ok) {
        responde(res, 400, {
          erro: `clicado '${bruto}' não é um objeto {tabela, coluna} válido.`,
        });
        return;
      }
    }

    // `?visual=<id>` (um ou mais) — o pedido de um subconjunto de visuais, não a
    // página inteira. Dois usos: o sob-demanda de sempre (uma coluna cara demais
    // para a abertura, ver `backend/specs/_catalog/projecao.yaml`) e, desde a Fase L5 (R4),
    // a abertura pedindo só o que está "acima da dobra" — o resto chega por
    // interseção conforme a pessoa rola. `getAll` é o mesmo padrão já usado por
    // `?filtro=`/`?clicado=` acima; ausente devolve `[]`, que aqui quer dizer
    // "página inteira", não "lista vazia de verdade".
    const visuaisArr = url.searchParams.getAll('visual');
    const visuaisPedidos: readonly string[] | null = visuaisArr.length > 0 ? visuaisArr : null;
    if (visuaisPedidos) {
      const idsConhecidos = new Set((dash.visuals ?? []).map((v) => v.id));
      for (const vid of visuaisPedidos) {
        if (!idsConhecidos.has(vid)) {
          responde(res, 404, { erro: `Visual '${vid}' não existe na página '${id}'.` });
          return;
        }
      }
    }

    // --------------------------------------------------------------- cache
    // Antes de `carrega`, de propósito: num acerto o pedido não abre o snapshot,
    // não materializa tabela calculada e não roda o avaliador. É esse pulo que
    // cabe nos 300 ms da regra 9 — recalcular e só economizar a serialização não
    // caberia.
    const ttl = retencaoDaPagina(this.queriesDe(dash), this.registry);
    // Por página, não pelas 25 tabelas juntas — ver `carimboDaPagina`. Um
    // refresh de uma tabela que esta página não lê deixa de invalidar o cache
    // dela.
    const carimbo = this.carimboDaPagina(dash);
    const dia = diaDoCalculo(this.opts.agora());
    // **`?recalcula=1` é de ferramenta, não de pessoa** (Erick, 05/10/2026). Ele refaz
    // a conta e regrava a resposta que TODO MUNDO lê: um clique de um usuário custaria
    // CPU de todos. A tela parou de mandá-lo; de quem não é ferramenta interna (login
    // por `/auth/interno`) ou o próprio aquecedor, ele é ignorado — e o pedido segue
    // como qualquer outro, servido do que já está pronto.
    const pediuRecalculo = url.searchParams.get('recalcula') === '1';
    const recalcula = pediuRecalculo && (quem.usuario === 'ferramenta-interna' || quem.papeis.includes('interno'));
    if (pediuRecalculo && !recalcula) this.metricas.conta('recalcula_ignorado');
    const chave = chaveDaResposta({
      escopo: escopoDoCache(quem),
      pagina: dash.id,
      filtros: daTela,
      clicados,
      visuais: visuaisPedidos,
      de,
      linhas,
      termo,
      carimbo,
      dia,
    });
    // **A última resposta pronta desta MESMA pergunta, de qualquer snapshot (ACHADOS #164).**
    // Mesma chave sem `carimbo` e sem `dia`: quando um refresh troca a identidade da
    // página, `chave` some da vista na hora — e até o reaquecimento terminar não havia o
    // que servir. Com esta, o pedido sai na hora com a versão anterior (e o `dadoDe` dela,
    // que a tela mostra) enquanto a nova é calculada em segundo plano.
    const chaveAnterior = chaveDaResposta({
      escopo: escopoDoCache(quem),
      pagina: dash.id,
      filtros: daTela,
      clicados,
      visuais: visuaisPedidos,
      de,
      linhas,
      termo,
      carimbo: '*',
      dia: '*',
    });

    // De onde veio este pedido. Desde a F3 isto DECIDE a ordem da fila da
    // piscina, e não só mede — ver `prioridadeDe` em `metricas.ts`.
    const origem: OrigemDoPedido = origemDoPedido(
      quem.usuario === 'aquecedor-interno',
      url.searchParams.get('origem'),
    );
    const prioridade = prioridadeDe(origem);
    this.metricas.conta(`pedidos_${origem}`);

    if (ttl > 0 && !recalcula) {
      const guardado = await this.cache.le<object>(chave);
      if (guardado !== undefined) {
        this.metricas.conta('cache_hits');
        // O acerto que a F4 persegue: um evento do poller invalidou esta página
        // e, quando alguém finalmente a pediu, ela já estava pronta.
        this.marcaPrimeiroGet(dash.id, origem, true, tPedido);
        responde(res, 200, { ...guardado, cache: 'hit' satisfies EstadoDoCache });
        return;
      }
      this.metricas.conta('cache_misses');
    }

    // Com `?visual=`, calcula só os pedidos: o pedido isolado existe para mostrar
    // uma tabela cara ou completar o que a rolagem revelou, não para recalcular os
    // outros 38 visuais que a página já mostrou. `.filter` preserva a ordem de
    // `dash.visuals` (a ordem do relatório), não a ordem em que os ids chegaram.

    const idsPedidos = visuaisPedidos ? new Set(visuaisPedidos) : null;
    const visuais = idsPedidos === null
      ? (dash.visuals ?? [])
      : (dash.visuals ?? []).filter((v) => idsPedidos.has(v.id));

    // O filtro da tela entra como filtro **de página**, que é o escopo de uma
    // segmentação no Power BI: ela recorta todos os visuais da página, não só um.
    // Entrando aqui, ele atravessa `traduzFiltros` no mesmo `with()` dos filtros que
    // já vinham da spec — nenhuma engine sabe que ele veio de uma URL.
    const alvo: DashboardSpec = {
      ...dash,
      visuals: visuais,
      filters: [...(dash.filters ?? []), ...daTela],
    };

    const amarrado = visuaisPedidos === null
      ? []
      : visuaisPedidos.map((vid) => this.sobDemandaDoVisual(dash, vid));
    const libera = [...new Set(amarrado.flatMap((a) => a.colunas))];
    const formaCompleta = [
      ...new Set([...amarrado.flatMap((a) => a.tabelasCompletas), ...this.tabelasCompletasDaPagina(dash)]),
    ];

    // A rajada, medida: quantos pedidos com esta MESMA chave estão em curso
    // agora. Continua sendo medido DEPOIS do single-flight, e de propósito — ele
    // não faz a rajada deixar de existir, faz ela deixar de custar. O número que
    // diz se ela parou de custar é `singleflight_coalescidos`; este diz o
    // tamanho dela.
    //
    // A baixa vai em `res.on('finish')` porque ela cobre TODA saída (200, o 409
    // de snapshot faltando, e a exceção que vira 500); um decremento escrito só
    // no caminho feliz vazaria na primeira falta de snapshot, e o instrumento
    // passaria a medir o próprio defeito.
    const concorrentes = (this.emCalculo.get(chave) ?? 0) + 1;
    this.emCalculo.set(chave, concorrentes);
    this.metricas.maximo('concorrentes_mesma_chave_max', concorrentes);
    res.on('finish', () => {
      const restam = (this.emCalculo.get(chave) ?? 1) - 1;
      if (restam <= 0) this.emCalculo.delete(chave);
      else this.emCalculo.set(chave, restam);
    });

    // ---------------------------------------------------- single-flight (F2)
    //
    // **Daqui para baixo, por chave, roda no máximo uma vez.** Quem chega com a
    // mesma chave enquanto o cálculo está no ar espera pelo MESMO resultado, em
    // vez de refazer a mesma conta numa piscina de duas workers. Medido antes
    // desta peça, 6 GET idênticos em MISS contra `diario-instalacao`: 6
    // cálculos, e os dois últimos esperaram 25,7 s por uma página de ~10 s. Ver
    // `voo-unico.ts` para o número inteiro e para por que o SSE fabrica
    // exatamente essa rajada.
    //
    // **A gravação no cache entra AQUI DENTRO**, e não depois: ela é parte do
    // cálculo, não da resposta. Fora do voo, os N que pegaram carona gravariam a
    // mesma entrada N vezes no Redis — o oposto do que esta peça existe para
    // fazer.
    // **O buraco que a F2 e a F3 abrem juntas, medido em vez de suposto.** A
    // prioridade da fila é a de quem INICIOU o voo. Se um aquecimento começou o
    // cálculo desta chave e um clique chega em seguida, o clique pega carona — e
    // herda a posição de fila do aquecimento, em vez de passar na frente. Não
    // custa um cálculo a mais (o single-flight continua fazendo o seu trabalho),
    // custa espera. A janela é estreita: só vale enquanto a tarefa ainda está
    // ENFILEIRADA, porque depois de despachada não há fila para furar.
    //
    // Promover a tarefa em voo seria possível, e é justamente o tipo de
    // mecanismo que a decisão desta fase manda NÃO escrever antes de haver
    // número. Este contador é o número.
    const emVoo = this.vooUnico.rotuloDe(chave);
    if (typeof emVoo === 'number' && emVoo > prioridade) {
      this.metricas.conta(`voo_herdou_prioridade_pior_${origem}`);
    }

    /** O cálculo da página, com a prioridade de quem o dispara. Ver `vooUnico.faz` abaixo. */
    const calcula = async (prio: number): Promise<CorpoDaPagina> => {
    let paginaCalculada: PaginaCalculada;
    let dadoDe: string | null = null;
    let omitidas: string[] = [];
    let tabelasResumo: { nome: string; linhas: number }[] = [];

    // **O overlay do poller, recortado para esta página.** Buscado UMA vez
    // por cálculo e usado nos dois ramos abaixo: buscá-lo duas vezes faria o
    // ramo da worker calcular sobre um overlay e o de fallback sobre outro,
    // colhido milissegundos depois — dois números diferentes para o mesmo
    // pedido, conforme a worker tivesse falhado ou não.
    const overlays = this.#overlayDe(dash);
    this.metricas.maximo('overlay_linhas_max', linhasDoOverlay(overlays));
    if (overlays.size > 0) this.metricas.conta('calculos_com_overlay');

    if (this.piscina.ativa) {
      this.metricas.maximo('worker_fila_max', this.piscina.estado.fila);
      // Quantas tarefas de cada classe REALMENTE chegaram à piscina. Comparado
      // com `pedidos_<origem>`, é o que responde "quanto da fila que existia
      // antes era só trabalho duplicado?": 6 pedidos iguais que viram 1
      // entrada aqui são 5 cálculos que a F2 apagou, e que a F3 não teria de
      // reordenar.
      this.metricas.conta(`fila_entradas_${origem}`);
      const tWorker = Date.now();
      try {
        const workerRes = await this.piscina.executa({
          snapshotDir: this.opts.snapshotDir,
          specsDir: path.join(this.opts.root, 'backend', 'specs'),
          dashboardSpec: alvo,
          janela: { de, linhas, termo },
          clicados,
          liberaSobDemanda: libera,
          precisaFormaCompleta: formaCompleta,
          agoraIso: this.opts.agora().toISOString(),
          // **A linha que destrava o near-realtime inteiro** (F1,
          // 08/09/2026). Sem ela a worker chamava `carrega()` sem overlay e
          // devolvia o número do disco: o poller detectava a mudança, o
          // cache invalidava, o SSE avisava, o navegador refazia o GET — e
          // recebia o mesmo de antes, depois de 10–20 s de recálculo. Nada
          // falhava; o realtime só não entregava dado novo. Ver
          // `worker-calculador.ts` e `overlay-realtime.ts`.
          ...(overlays.size > 0 ? { overlays } : {}),
          // O que faz `cacheDeCarga` (worker-calculador.ts) saber que o disco
          // mudou por baixo, do mesmo jeito que `identidadeDaPagina()` já faz
          // para `this.carregadas` aqui na thread principal — DISCO, não o
          // memo (`carimboAtual()`), pela mesma razão de F5: um `fs.watch`
          // mudo não pode deixar a worker presa ao `Carregado` de ontem.
          //
          // **Por página, e não `identidadeAtual()` (21/09/2026).** A global
          // fazia a worker descartar o dataset de TODAS as páginas a cada
          // rematerialização de QUALQUER tabela — uma a cada 1,5 min,
          // medido, e ~2 s de releitura de disco por página alcançada. Aqui
          // vai `dash` (a página inteira) e não `alvo` (recortado para os
          // `?visual=` do pedido) de propósito: quem decide a identidade é
          // de que tabelas a PÁGINA depende, que é a mesma conta que
          // `carimboDaPagina` faz para a chave da resposta. Duas contas
          // diferentes para a "mesma" identidade divergiriam.
          identidade: this.identidadeDaPagina(dash),
          // O ESCOPO de quem pediu, pelo mesmo motivo que ele entra em
          // `chaveDoCompleto` aqui na thread principal: a worker agora
          // guarda o resultado inteiro de visual paginável (ver
          // `MemoDeCompletos` em `worker-calculador.ts`), e um memo sem
          // escopo devolveria o recorte de um no lugar do do outro no dia
          // em que existir Permission Engine. Hoje `escopoDoCache` é
          // constante para todo mundo — e é exatamente por isso que o campo
          // precisa viajar: quando deixar de ser, ninguém vai lembrar de
          // vir até aqui procurar.
          escopo: escopoDoCache(quem),
        }, prio);
        // `worker_ms` continua sendo a SOMA (espera + cálculo). Ele não foi
        // substituído por `fila_ms_*`/`calculo_ms_*`: é o número que os
        // testes e as medições das fases F1 e F2 usam, e trocar o significado
        // dele tornaria aquelas comparações incomparáveis.
        this.metricas.observa('worker_ms', Date.now() - tWorker);
        this.registraCarga(dash.id, 'página', workerRes.carga);
        paginaCalculada = workerRes.pagina as PaginaCalculada;
        dadoDe = workerRes.dadoDe ?? null;
        omitidas = workerRes.omitidas ?? [];
        tabelasResumo = (workerRes.linhasPorTabela ?? []).map(([nome, n]) => ({ nome, linhas: n }));
      } catch (errWorker) {
        // **O motivo, e não só a contagem.** Este catch era cego: nem
        // capturava o erro. Medido em 08/09/2026 numa subida por
        // `npm start`, 32 de 45 voos caíram aqui — 71% dos cálculos
        // pagando o
        // dobro — e não havia uma linha em lugar nenhum dizendo por quê.
        // É o mesmo defeito que a F2.1 consertou no Redis: degradar certo
        // e não contar a ninguém.
        //
        // Uma linha por MOTIVO distinto, não por ocorrência: 32 cópias da
        // mesma mensagem soterram a primeira, que era a que importava.
        const motivo = errWorker instanceof Error ? errWorker.message : String(errWorker);
        if (!this.motivosDeFallback.has(motivo)) {
          this.motivosDeFallback.add(motivo);
          console.error(
            `[worker] caiu para cálculo em linha: ${motivo}. ` +
              `A resposta sai certa e custa o dobro. Heap por worker: ` +
              `${process.env.API_WORKER_HEAP_MB ?? '768'} MB.`,
          );
        }
        // A worker falhou: cai para o cálculo em linha. Contado porque um
        // fallback frequente é um defeito escondido — ele responde certo e
        // paga o dobro, então nada na tela denuncia que está acontecendo.
        // Desde 08/09 uma worker que MORRE também chega aqui: antes ela
        // deixava a promessa pendente para sempre, e sob single-flight isso
        // travaria a CHAVE inteira, não só um pedido (ver o handler de
        // `exit` em `piscina-workers.ts`).
        this.metricas.conta('worker_fallback');
        const carregado = await this.carrega(dash, visuaisPedidos).catch((err: unknown) => {
          throw comStatus(err, 409);
        });
        paginaCalculada = calculaPagina(alvo, carregado.ev, { de, linhas, termo }, undefined, undefined, clicados);
        dadoDe = carregado.dadoDe;
        omitidas = carregado.omitidas;
        tabelasResumo = [...carregado.linhasPorTabela].map(([nome, n]) => ({ nome, linhas: n }));
      }
    } else {
      const carregado = await this.carrega(dash, visuaisPedidos).catch((err: unknown) => {
        throw comStatus(err, 409);
      });

      const memo = {
        le: (visual: string): unknown | undefined =>
          this.completos.le(
            chaveDoCompleto({
              escopo: escopoDoCache(quem),
              pagina: dash.id,
              filtros: daTela,
              clicados,
              visual,
              carimbo,
              dia,
            }),
          ),
        guarda: (visual: string, completo: unknown): void => {
          this.completos.guarda(
            chaveDoCompleto({
              escopo: escopoDoCache(quem),
              pagina: dash.id,
              filtros: daTela,
              clicados,
              visual,
              carimbo,
              dia,
            }),
            completo,
          );
        },
      };

      paginaCalculada = calculaPagina(alvo, carregado.ev, { de, linhas, termo }, undefined, memo, clicados);
      dadoDe = carregado.dadoDe;
      omitidas = carregado.omitidas;
      tabelasResumo = [...carregado.linhasPorTabela].map(([nome, n]) => ({ nome, linhas: n }));
    }

    const corpo: CorpoDaPagina = {
      ...paginaCalculada,
      dadoDe,
      omitidas,
      // O que a tela mandou, de volta: sem isto não há como conferir, olhando
      // a resposta, se o número está filtrado pelo que a tela acha que mandou.
      filtrosDaTela: daTela.map((f) => ({
        tabela: f.entity,
        coluna: f.property,
        // O nível vai junto: sem ele não dá para distinguir, olhando a
        // resposta, um filtro pelo **ano** de uma data de um filtro pela data
        // crua — e os dois produzem números diferentes sobre a mesma coluna.
        ...(f.nivel ? { nivel: f.nivel } : {}),
        valores: f.conditions[0]?.op === 'in' ? f.conditions[0].values : [],
      })),
      tabelas: tabelasResumo,
    };

    // O corpo vai para o cache **sem** o campo `cache`: ele descreve o
    // pedido, não a resposta, e congelá-lo como `miss` faria todo acerto se
    // anunciar como falha.
    await this.cache.guarda(chave, corpo, ttl);
    // A "última pronta" aponta para o mesmo objeto (o cache em memória guarda
    // referência): a segunda chave não dobra a memória.
    await this.cache.guarda(chaveAnterior, corpo, TTL_ULTIMA_PRONTA_S);
    return corpo;
    };

    // **Nunca esperar cálculo numa pergunta já respondida antes (ACHADOS #164).** Faltou
    // a versão deste snapshot, mas existe uma anterior: ela sai AGORA, e a atual é
    // calculada em segundo plano com prioridade de fundo (a piscina deixa uma
    // worker livre para quem usa). O aquecedor não entra aqui — é ele quem prepara a
    // versão nova, e servir-lhe a velha o faria aquecer nada.
    if (ttl > 0 && !recalcula && origem !== 'warmup') {
      const anterior = await this.cache.le<object>(chaveAnterior);
      if (anterior !== undefined) {
        this.metricas.conta('servido_anterior');
        this.marcaPrimeiroGet(dash.id, origem, true, tPedido);
        responde(res, 200, { ...anterior, cache: 'anterior' satisfies EstadoDoCache });
        // `prefetch`, não `warmup`: alguém acabou de VER esta versão velha, e ela passa na
        // frente do pré-cálculo de filtros que ninguém pediu. Continua fundo (> 0), então a
        // worker reservada a quem usa segue livre.
        const fundo = prioridadeDe('prefetch');
        // **E quem viu a velha fica sabendo quando a nova sai.** Sem este aviso a tela
        // ficaria com o número de antes do evento até o PRÓXIMO evento — o tempo real
        // atrasado um ciclo inteiro. Um aviso por página, não por chave: a tela refaz
        // a página toda quando é avisada.
        this.paginasComAnterior.add(dash.id);
        void this.vooUnico.faz<CorpoDaPagina>(chave, () => calcula(fundo), fundo).then(() => {
          if (this.paginasComAnterior.delete(dash.id)) this.emiteEvento([dash.id]);
        }, () => {
          // Falhou o recálculo de fundo: o próximo pedido tenta de novo, e quem pediu
          // já foi servido.
        });
        return;
      }
    }

    let voo: Voo<CorpoDaPagina>;
    try {
      voo = await this.vooUnico.faz<CorpoDaPagina>(chave, () => calcula(prioridade), prioridade);
    } catch (err) {
      // O erro do voo chega IGUAL a todos os que esperavam por ele, inclusive a
      // quem não o disparou. É o que o requisito 9 pede ("erro libera o
      // estado"): `VooUnico` já apagou a chave quando a promessa foi rejeitada,
      // então o pedido SEGUINTE volta a poder calcular, em vez de herdar para
      // sempre a falha do anterior.
      const status = (err as { status?: number }).status ?? 500;
      responde(res, status, { erro: err instanceof Error ? err.message : String(err) });
      return;
    }

    this.metricas.conta(voo.iniciou ? 'singleflight_iniciados' : 'singleflight_coalescidos');
    // Chegou aqui, não acertou o cache — o usuário pagou o cálculo (ou esperou
    // por um em curso). É o caso que a F4 existe para tirar, e contá-lo é o que
    // impede o reaquecimento de se declarar vitorioso sozinho.
    this.marcaPrimeiroGet(dash.id, origem, false, tPedido);
    responde(res, 200, {
      ...voo.valor,
      // `coalescido` é um estado NOVO, e existe para o ganho ser visível de fora.
      // Um servidor que funde 20 pedidos em 1 e um que calcula os 20 respondem a
      // mesma coisa; sem esta palavra, só o relógio separa os dois. A tela não lê
      // este campo (conferido em `frontend/src`), então nada nela muda.
      cache: (ttl <= 0 ? 'desligado' : voo.iniciou ? 'miss' : 'coalescido') satisfies EstadoDoCache,
    });
  }


  /**
   * Os valores distintos de uma coluna — o que a segmentação da tela oferece.
   *
   * **Sai do dataset já carregado, não de uma query nova.** A coluna que a segmentação
   * recorta é, por construção, uma coluna que a página usa: ela está em memória. Ir ao
   * Postgres para relistá-la traria o universo inteiro, e não o que a página tem —
   * duas listas diferentes, e a segunda ofereceria valor que o dataset não contém.
   */
  private async valores(
    res: http.ServerResponse,
    id: string,
    url: URL,
    // Ainda não recorta nada (hoje decide só a prioridade na piscina, aquecedor
    // ou pessoa) — está aqui porque a lista de valores de uma segmentação é
    // justamente o que um RLS teria de recortar primeiro: ela mostra *quais
    // equipes existem* antes de mostrar qualquer número.
    quem: Identidade,
  ): Promise<void> {
    const dash = this.dashboards.find((d) => d.id === id);
    if (!dash) {
      responde(res, 404, { erro: `Página '${id}' não existe.` });
      return;
    }

    const tabela = url.searchParams.get('tabela');
    const coluna = url.searchParams.get('coluna');
    // `nivel` vem da própria segmentação, não da mão do usuário: a tela devolve o que
    // a API declarou. Ele entra na checagem de permissão, e não só na projeção — sem
    // isso, pedir `nivel=Dia` numa segmentação de Ano listaria 365 valores que o
    // controle nunca ofereceria.
    const nivel = url.searchParams.get('nivel');
    if (!tabela || !coluna) {
      responde(res, 400, {
        erro: `Faltou 'tabela' ou 'coluna'. Ex.: ` +
          `/api/dashboards/${id}/valores?tabela=PROTOCOLOS GERAL&coluna=EQUIPE`,
      });
      return;
    }

    // Só coluna de segmentação **desta página**. Sem esta trava a rota viraria um
    // dump de qualquer coluna do modelo — inclusive as que carregam dado de cliente.
    const permitida = (dash.visuals ?? []).some((v) => {
      const s = segmentacaoDe(v);
      if (s === undefined) return false;
      if (normalizeName(s.tabela) !== normalizeName(tabela)) return false;
      if (normalizeName(s.coluna) !== normalizeName(coluna)) return false;

      // Segmentação de HIERARQUIA (`niveis`) é o único `naoFiltra` que a rota
      // atende, e só **sem `nivel`**: são as datas cruas que a árvore Ano > Mês >
      // Dia da tela precisa para saber quais meses cada ano tem.
      //
      // Antes daqui a condição era `s.naoFiltra === undefined`, e o efeito não era
      // proteger nada: a árvore recebia 404 e abria vazia, então a única tela em que
      // a coluna de data aparece como controle desenhava "0 anos". A trava que
      // importa — a coluna tem de ser segmentação DESTA página — continua inteira, e
      // é ela que impede a rota virar dump de coluna qualquer.
      //
      // Levantado em 27/08/2026: as **seis** segmentações `naoFiltra` do modelo
      // inteiro são hierarquia de data. Não existe caso em que isto alcance coluna
      // com dado de cliente.
      if (s.niveis !== undefined) return !nivel;
      if (s.naoFiltra !== undefined) return false;

      return normalizeName(s.nivel ?? '') === normalizeName(nivel ?? '');
    });
    if (!permitida) {
      responde(res, 404, {
        erro: `'${tabela}'[${coluna}] não é a coluna de nenhuma segmentação de '${id}'. ` +
          `Esta rota lista valor de segmentação, não de coluna qualquer.`,
      });
      return;
    }

    const teto = inteiro(url.searchParams.get('teto'), VALORES_PADRAO, 1, VALORES_MAXIMO);
    // **A identidade da página entra na CHAVE, e não numa limpeza.** Esta rota
    // lê o mapa ANTES de chamar `carrega()` — e `carrega()` é o único lugar que
    // percebe a identidade avançar. Um acerto aqui portanto NUNCA passava pela
    // verificação de frescor: a lista de valores de uma segmentação ficava
    // servindo o recorte de antes do refresh, e o sintoma seria uma cidade nova
    // que entra no dado e nunca aparece no seletor.
    //
    // Isso não aparecia enquanto o descarte de `carrega()` era GLOBAL: qualquer
    // outra página que perdesse a sua entrada varria este mapa inteiro junto, e
    // o erro de ordem ficava mascarado por uma vassoura que passava a cada 1,5
    // min. Escopar o descarte por página (21/09/2026) tirava a vassoura, e sem
    // esta linha o mascaramento cairia junto.
    //
    // É o mesmo princípio de `chaveDaResposta`: o que faz o papel do frescor é
    // a chave, não um prazo nem uma varredura. Entrada velha fica INALCANÇÁVEL
    // no mesmo instante, e quem a poda é o `esqueceAPagina` que o miss seguinte
    // dispara dentro de `carrega()`.
    //
    // `carimboDaPagina` (o memo) e não `identidadeDaPagina` (o disco): é a
    // MESMA conta que a chave do cache de resposta faz, e esta rota responde em
    // 1–7 ms quente — 0,57 ms de leitura de disco por seletor aberto seria
    // pagar frescor que o memo já entrega.
    const frescorDaPagina = `${this.carimboDaPagina(dash)}@${diaDoCalculo(this.opts.agora())}`;
    const chaveValores = chaveDeValores(id, frescorDaPagina, tabela, coluna, nivel);
    let distintos = this.cacheValoresDistintos.get(chaveValores);
    if (!distintos) {
      let emCurso = this.valoresEmCurso.get(chaveValores);
      if (!emCurso) {
        const origem = origemDoPedido(quem.usuario === 'aquecedor-interno', url.searchParams.get('origem'));
        // **A geração, porque a chave não basta.** A chave carrega o carimbo do DISCO,
        // e uma mudança do tempo real não o troca: ela apaga as listas da página em
        // `esqueceAPagina`. Uma lista que estava sendo calculada sobre o overlay de
        // antes do evento voltaria depois dele e seria gravada sob a mesma chave —
        // velha, até o próximo evento. Com a geração, ela só responde a quem pediu.
        const geracao = this.geracaoDaPagina(dash.id);
        const meu = this.calculaValores(dash, tabela, coluna, nivel, prioridadeDe(origem), quem);
        emCurso = meu;
        this.valoresEmCurso.set(chaveValores, meu);
        void meu
          .then(
            (r) => {
              if (Array.isArray(r) && this.geracaoDaPagina(dash.id) === geracao) {
                this.cacheValoresDistintos.set(chaveValores, r);
              }
            },
            () => undefined,
          )
          .finally(() => {
            if (this.valoresEmCurso.get(chaveValores) === meu) this.valoresEmCurso.delete(chaveValores);
          });
      }
      let r: DaxValue[] | { erroDoPedido: string };
      try {
        r = await emCurso;
      } catch (err) {
        responde(res, 409, { erro: err instanceof Error ? err.message : String(err) });
        return;
      }
      if (!Array.isArray(r)) {
        // Nível que a projeção não conhece. 400: o pedido está errado, não o estado.
        responde(res, 400, { erro: r.erroDoPedido });
        return;
      }
      distintos = r;
    }
    responde(res, 200, {
          tabela,
          coluna,
          nivel,
          valores: distintos.slice(0, teto).map(serializaValor),
          // O corte é dito. Uma lista truncada em silêncio faria a pessoa concluir que o
          // valor que ela procura não existe na base.
          total: distintos.length,
          cortado: distintos.length > teto,
        });
      }

  // ------------------------------------------------------------------ apoio

  /**
   * O avaliador de uma página, cacheado.
   *
   * **A chave do cache inclui o que foi liberado**, e isso é o que impede a versão
   * cara de virar a versão de todo mundo: pedir `?visual=` da tabela de relatos carrega
   * um segundo dataset, com o texto livre dentro, sob outra chave. Quem abrir a página
   * depois continua recebendo a leve. Um cache por página só devolveria a última
   * carregada, e a primeira pessoa a pedir os relatos deixaria os 350 MB residentes
   * para todos os pedidos seguintes — exatamente o que a decisão evita.
   */
  /**
   * O overlay do poller RECORTADO para as tabelas desta página.
   *
   * O poller vigia 7 tabelas (`backend/specs/_catalog/realtime-poll.yaml`); uma página
   * usa de uma a três. Sem o recorte, todo cálculo serializaria os 7 deltas para
   * dentro da worker e o outro lado ignoraria a maioria — custo de
   * `postMessage` proporcional ao que o poller viu, não ao que a página lê.
   *
   * O recorte é por NOME NORMALIZADO de tabela, a mesma chave que
   * `PollerRealtime.overlays()` usa e que `carrega()` procura
   * (`normaliza(t.nome)`). Três normalizações da mesma coisa é o tipo de
   * coincidência que deixa de valer em silêncio no dia em que uma tabela ganhar
   * acento — por isso `tabelasPorDashboard` sai do MESMO plano que `carrega()`
   * vai percorrer, e não de uma lista à parte.
   */
  /**
   * Esquece o que ESTA thread guarda de UMA página: o dataset, os valores
   * distintos das segmentações dela e os resultados inteiros dos visuais.
   *
   * **Um lugar só, e é por isso que ele nasceu.** Os dois caminhos que
   * invalidam uma página tinham de derrubar exatamente a mesma coisa, e não
   * derrubavam: `aoTabelaMudar` (o poller viu a tabela mudar) limpava
   * `carregadas` e `completos` mas **não** `cacheValoresDistintos` — o que não
   * aparecia enquanto o descarte global de `carrega()` varria o mapa inteiro a
   * cada 1,5 min por tabela alheia. Escopar aquele descarte por página tirava
   * essa vassoura de baixo, e a lista de valores de uma segmentação passaria a
   * envelhecer sem prazo: cidade nova entra no dado, o seletor nunca a mostra.
   * O par `esqueceAPagina` aqui e `esqueceAPagina` na worker existe para que a
   * próxima estrutura a ser limpa tenha um lugar óbvio, e um só.
   *
   * Não mexe na piscina nem no cache de resposta de propósito: quem invalida
   * ALÉM desta thread é `aoTabelaMudar`, que sabe que o evento veio de fora.
   */
  private esqueceAPagina(dashId: string): void {
    for (const chave of [...this.carregadas.keys()]) {
      if (chave === dashId || chave.startsWith(`${dashId}\u0000`)) this.carregadas.delete(chave);
    }
    // A chave é `${id}\u0000<tabela>\u0000<coluna>\u0000<nivel>` (ver `valores`).
    for (const chave of [...this.cacheValoresDistintos.keys()]) {
      if (chave.startsWith(`${dashId}\u0000`)) this.cacheValoresDistintos.delete(chave);
    }
    // E as listas em cálculo: quem pedir depois daqui não pode pegar carona numa
    // conta feita sobre o dado de antes. Ver o comentário da geração em `valores`.
    for (const chave of [...this.valoresEmCurso.keys()]) {
      if (chave.startsWith(`${dashId}\u0000`)) this.valoresEmCurso.delete(chave);
    }
    this.geracoes.set(dashId, this.geracaoDaPagina(dashId) + 1);
    // Os resultados inteiros também. A chave deles já carrega carimbo e dia, então
    // eles nunca seriam *servidos* errados — mas ficariam ocupando o orçamento até
    // o LRU chegar neles, e o orçamento é justamente o que decide o que fica.
    this.completos.limpaPagina(dashId);
  }

  /**
   * Grava um dataset em `carregadas`, podando o mais antigo quando estoura.
   *
   * **O teto nasceu junto com o descarte por página, e é a contrapartida
   * dele.** Enquanto `carrega()` esvaziava o mapa INTEIRO a cada avanço do
   * carimbo global — uma vez a cada 1,5 min, medido —, esse descarte era
   * também o único limite de memória deste mapa: nada mais o podava. Escopar
   * por página tira a latência de cima da próxima pessoa, mas tiraria junto o
   * limite, e um mapa de `Carregado` que só cresce troca um problema de tempo
   * por um de RAM — pior, porque aparece horas depois e longe daqui.
   *
   * Poda por ordem de inserção, a mesma de `guardaNoCache`
   * (`worker-calculador.ts`) e de `TETO_PAGINAS_VISTAS`
   * (`frontend/src/utils/cachePagina.ts`): regravar reinsere no fim, então a entrada
   * mais recentemente usada nunca é a próxima a cair.
   */
  private guardaCarregada(chave: string, promessa: Promise<Carregado>): void {
    this.carregadas.delete(chave);
    this.carregadas.set(chave, promessa);
    if (this.carregadas.size > TETO_CARREGADAS) {
      const maisAntiga = this.carregadas.keys().next().value;
      if (maisAntiga !== undefined) this.carregadas.delete(maisAntiga);
    }
  }

  /**
   * Uma carga do disco dentro de uma worker — o `cacheDeCarga` errou. Contada e
   * logada com a combinação que a causou: cada combinação diferente de liberação e
   * forma completa é uma carga a mais da mesma página, e foi isso que fez o
   * reaquecimento de UMA página levar 20–30 s (ACHADOS #175).
   */
  private registraCarga(
    dashId: string,
    tipo: 'página' | 'valores',
    carga: { ms: number; libera: string[]; formaCompleta: string[]; worker: number } | undefined,
  ): void {
    if (!carga) return;
    this.metricas.conta('worker_cargas');
    this.metricas.observa('worker_carga_ms', carga.ms);
    console.error(
      `[worker ${carga.worker}] ${dashId} carregou do disco em ${carga.ms} ms (${tipo}; liberadas: ` +
        `${carga.libera.join(', ') || '—'}; forma completa: ${carga.formaCompleta.join(', ') || '—'})`,
    );
  }

  private geracaoDaPagina(dashId: string): number {
    return this.geracoes.get(dashId) ?? 0;
  }

  /**
   * Os valores de uma segmentação, calculados **numa worker** — e só na falta dela,
   * aqui.
   *
   * Até 05/10/2026 eram sempre aqui: `carrega(dash)` na thread que atende, a cada
   * mudança do tempo real (que derruba o dataset da página). Eram as 57 cargas em
   * ~23 min do ACHADOS #175, cada uma segurando o laço por centenas de ms — tempo em
   * que nem o HTML da tela saía. Na worker, a lista usa o MESMO dataset que o cálculo
   * da página (mesma `chaveDeCarga`), então reaquecer a página já deixa a lista a um
   * passo.
   *
   * **A forma completa é a que os visuais DA PÁGINA pedem, não só os filtros dela.**
   * O caminho antigo carregava sem nenhum visual amarrado e, na `agendamento-field`,
   * caía no grão reduzido da `FIELD AGENDA` (`projecao.yaml`) — onde as
   * colunas-gatilho (`ClassificacaoRelato`, `Descrição`…) não estão inteiras. Medido
   * em 05/10/2026 no snapshot real: a lista de `ClassificacaoRelato` saía com 14 de 36
   * valores e a de `Descrição` com 6 de 28, enquanto os visuais da mesma página
   * calculavam sobre a forma completa. Com overlay do tempo real, a carga reduzida
   * nem fechava (a tradução nativa de `Status Protocolo Dia` pede colunas que ela
   * omite). A união dos visuais é também o que faz a chave coincidir com a da
   * abertura da página.
   *
   * O overlay e a identidade são colhidos aqui, uma vez, pelo mesmo motivo de
   * `pagina()`: dois ramos não podem calcular sobre dois overlays diferentes.
   */
  private async calculaValores(
    dash: DashboardSpec,
    tabela: string,
    coluna: string,
    nivel: string | null,
    prioridade: number,
    quem: Identidade,
  ): Promise<DaxValue[] | { erroDoPedido: string }> {
    const overlays = this.#overlayDe(dash);
    const todos = (dash.visuals ?? []).map((v) => v.id);
    const amarrado = todos.map((vid) => this.sobDemandaDoVisual(dash, vid));
    const libera = [...new Set(amarrado.flatMap((a) => a.colunas))];
    const formaCompleta = [
      ...new Set([...amarrado.flatMap((a) => a.tabelasCompletas), ...this.tabelasCompletasDaPagina(dash)]),
    ];
    if (this.piscina.ativa) {
      try {
        const r = await this.piscina.executa(
          {
            snapshotDir: this.opts.snapshotDir,
            specsDir: path.join(this.opts.root, 'backend', 'specs'),
            dashboardSpec: dash,
            janela: { de: 0, linhas: 0 },
            clicados: [],
            liberaSobDemanda: libera,
            precisaFormaCompleta: formaCompleta,
            agoraIso: this.opts.agora().toISOString(),
            ...(overlays.size > 0 ? { overlays } : {}),
            identidade: this.identidadeDaPagina(dash),
            escopo: escopoDoCache(quem),
            valores: { tabela, coluna, nivel },
          },
          prioridade,
        );
        this.registraCarga(dash.id, 'valores', r.carga);
        if (r.erroDoPedido !== undefined) return { erroDoPedido: r.erroDoPedido };
        if (r.valores) return r.valores;
        throw new Error('a worker respondeu sem a lista de valores');
      } catch (err) {
        // O mesmo contrato do cálculo da página: cair para cá responde certo e custa
        // a thread que atende. Contado à parte, porque o número que a etapa 4 persegue
        // (`worker_fallback` = 0) é o das páginas.
        this.metricas.conta('valores_fallback');
        const motivo = err instanceof Error ? err.message : String(err);
        if (!this.motivosDeFallback.has(motivo)) {
          this.motivosDeFallback.add(motivo);
          console.error(`[worker] valores de segmentação caíram para a thread principal: ${motivo}`);
        }
      }
    }
    // Os mesmos visuais amarrados: `carrega` deriva deles a mesma liberação e a mesma
    // forma completa mandadas à worker, e os dois ramos não podem listar valores diferentes.
    const carregado = await this.carrega(dash, todos);
    try {
      return valoresDistintos(carregado.ev, tabela, coluna, nivel);
    } catch (err) {
      return { erroDoPedido: err instanceof Error ? err.message : String(err) };
    }
  }

  #overlayDe(dash: DashboardSpec): Map<string, OverlayDeTabela> {
    const todos = this.opts.overlayRealtime();
    const recorte = new Map<string, OverlayDeTabela>();
    if (todos.size === 0) return recorte;
    const daPagina = this.tabelasPorDashboard.get(dash.id);
    for (const [tabela, ov] of todos) {
      if (daPagina === undefined || daPagina.has(tabela) || this.#alimentaDaPagina(tabela, dash.id)) {
        recorte.set(tabela, ov);
      }
    }
    return recorte;
  }

  /**
   * As fontes que precisam vir inteiras porque o tempo real vai recalcular uma calculada
   * desta página. Sem isto, `?visual=` da VISÃO PRODUTIVA (que não lê a FIELD AGENDA
   * direto) carregava o grão reduzido dela, a tradução nativa recusava por falta de
   * colunas, e o visual voltava como ERRO em 3–8 s — medido em 09/10/2026 (ACHADOS #194).
   *
   * **Não depende de haver overlay agora.** A forma completa entra na chave do cache: se
   * ela variasse com o overlay, a mesma página teria duas chaves conforme o poller
   * tivesse ou não algo naquele instante, e a "última pronta" de uma não serviria a outra.
   */
  #formaCompletaDoTempoReal(dash: DashboardSpec): string[] {
    const fora = new Set<string>();
    for (const c of this.calculadasPorDashboard.get(dash.id) ?? []) {
      for (const f of RECALCULOS_AO_VIVO.get(c)?.fontes ?? []) fora.add(f);
    }
    return [...fora];
  }

  /** A tabela só-do-poller alimenta uma calculada que esta página carrega? */
  #alimentaDaPagina(tabela: string, dashId: string): boolean {
    const calculadas = this.calculadasPorDashboard.get(dashId);
    return (ALIMENTADAS_AO_VIVO.get(tabela) ?? []).some((c) => calculadas?.has(normalizeName(c)) ?? false);
  }

  private carrega(dash: DashboardSpec, visuaisPedidos: readonly string[] | null = null): Promise<Carregado> {
    // A UNIÃO das colunas sob demanda E das tabelas de grão reduzido que os visuais
    // pedidos amarram — pedir três visuais numa rolagem rápida não pode liberar três
    // vezes o mesmo texto livre, nem esquecer a coluna/tabela de um deles porque
    // outro já tinha liberado a sua. Ver `sobDemandaDoVisual` e ACHADOS #87.
    const amarrado = visuaisPedidos === null
      ? []
      : visuaisPedidos.map((vid) => this.sobDemandaDoVisual(dash, vid));
    const libera = [...new Set(amarrado.flatMap((a) => a.colunas))];
    // Filtro de PÁGINA (não de visual) vale para todo pedido a esta página,
    // liberado ou não — por isso entra incondicionalmente, e não só quando o
    // visual dono aparece em `visuaisPedidos`.
    const formaCompleta = [
      ...new Set([...amarrado.flatMap((a) => a.tabelasCompletas), ...this.tabelasCompletasDaPagina(dash)]),
    ];
    const chave = libera.length === 0 && formaCompleta.length === 0
      ? dash.id
      : `${dash.id}\u0000${libera.sort().join(',')}\u0000${formaCompleta.sort().join(',')}`;

    // **O snapshot mudou embaixo? Então o avaliador guardado é lixo.** Este mapa só
    // era limpo em erro, e a promessa do comentário do topo ("quem refaz é `npm run
    // snapshot`, e aí o processo é reiniciado") deixa de valer no dia em que o
    // aquecimento roda junto do refresh: a API serviria o dado antigo até alguém
    // lembrar de reiniciar. O carimbo é o mesmo do cache de resposta, então as duas
    // camadas enxergam a troca no mesmo instante.
    //
    // **E o dia entra junto, pelo mesmo motivo que entrou na chave da resposta.** O
    // avaliador congela o `now` que recebeu aqui embaixo (`carrega({ now })`), e
    // `TODAY()` sai dele. Um servidor que atravessa a meia-noite sem esta parte
    // continuaria servindo o `TODAY()` de ontem por tempo indeterminado — e o
    // estrago seria pior **depois** do dia entrar na chave da resposta, não antes:
    // a chave nova daria miss, o recálculo pegaria este avaliador velho, e a
    // resposta de hoje seria gravada com o ontem dentro. As duas camadas medem a
    // mesma identidade ou nenhuma das duas mede.
    // **Por página, não pelas 25 tabelas juntas** (21/09/2026). Era
    // `identidadeAtual()` — global — e o `clear()` abaixo era de tudo: um
    // refresh de tabela alheia esvaziava o dataset de toda página, e quem
    // pagava a releitura do disco era a próxima pessoa a abrir qualquer uma
    // delas. É o mesmo argumento (e a mesma conta) de `carimboDaPagina`, que a
    // chave do cache de resposta já usava desde 09/09; o dado carregado é que
    // não tinha acompanhado. Ver `identidadeDaPagina` para os números.
    const identidade = this.identidadeDaPagina(dash);
    if (this.identidadeDasCarregadas.get(dash.id) !== identidade) {
      this.esqueceAPagina(dash.id);
      this.identidadeDasCarregadas.set(dash.id, identidade);
    }

    const pronto = this.carregadas.get(chave);
    if (pronto) return pronto;
    const promessa = carrega({
      dir: this.opts.snapshotDir,
      model: this.model,
      dashboards: [dash],
      now: this.opts.agora(),
      liberaSobDemanda: libera,
      precisaFormaCompleta: formaCompleta,
      // **Armazenamento colunar.** Medido em 13/09/2026 nesta API, com `--sem-aquecer`,
      // depois de servir as 14 páginas uma vez: **RSS 5.360 MB → 3.097 MB**. Por página,
      // em processo isolado, `agendamento-field` sai de 567 para 246 MB e
      // `relatorio-do-mes` de 594 para 314. **O tempo empata** — as 14 páginas custam
      // 46,1 s em objeto e 46,4 s em colunar.
      //
      // Ferramenta em lote continua em objeto, de propósito: ela roda com
      // `--max-old-space-size`, não tem orçamento de RAM, e é ela que materializa e
      // GRAVA — escrever coluna física numa vista erra alto, e deve errar.
      //
      // A troca é provada, não estimada: `npm run bench:colunar-paridade` carrega e
      // calcula as 14 páginas nos dois caminhos e compara os 306 visuais. Zero
      // divergências. Voltar atrás é trocar este `true` por `false`.
      colunar: true,
      // `mescladoresDe` porque a opção passou a entregar DADO (ver
      // `overlay-realtime.ts`). Este é o caminho que calcula na própria thread —
      // fallback de falha da worker, e a piscina desligada em teste —, e é o
      // único lado da fronteira onde a função pode ser montada de véspera.
      overlay: mescladoresDe(this.#overlayDe(dash)),
    })
      .then((c) => {
        // Recalcular uma tabela que estava congelada custa tempo e muda o número. Um
        // servidor que atravessa a meia-noite passa a fazer isso a cada carga, e sem
        // esta linha a única pista seria "a página ficou mais lenta, não sei por quê".
        for (const r of c.recalculadas) console.error(`[snapshot] ${r}`);
        return c;
      })
      .catch((err: unknown) => {
        // Falhou: sai do cache, senão o erro fica grudado até reiniciar o processo.
        this.carregadas.delete(chave);
        throw err;
      });
    this.guardaCarregada(chave, promessa);
    return promessa;
  }

  // -------------------------------------------------------------- o carimbo
  //
  // A identidade do que está em disco AGORA: manifesto mais tabelas calculadas.
  // Uma conta só, usada pelas duas camadas de cache — duas contas separadas para
  // a "mesma" identidade divergiriam no primeiro arquivo que uma delas não
  // olhasse, e foi exatamente assim que os `calc.*.jsonl` ficaram de fora dele.
  //
  // **A HISTÓRIA DESTE MEMO, porque ela quase se repetiu.** Ler o carimbo custa
  // 0,57 ms — o maior custo fixo de um acerto de cache, mais que serializar uma
  // página de 96 KB. Memoizá-lo é tentador e foi tentado em 17/08/2026, atrás de
  // uma conferência barata: guardar o valor e só recalcular quando `mtime` e
  // tamanho do manifesto mudassem. Não funciona, e o teste provou antes de o
  // código sair daqui — reescrever o manifesto trocando só a hora de `geradoEm`
  // não muda um byte do tamanho (a data tem largura fixa), e o `mtime` desta
  // máquina tem granularidade medida de ~2,45 ms (4.000 escritas, 265 carimbos
  // distintos). Duas reescritas dentro dessa janela são indistinguíveis. O
  // comentário que sobrou daquele dia terminava assim: "0,4 ms não compra um
  // modo de desatualização silenciosa".
  //
  // **E aí o memo voltou assim mesmo**, guardado por um `fs.watch` com
  // `catch {}` vazio — comprando exatamente o modo de desatualização silenciosa
  // que aquele parágrafo proibia, por um caminho diferente. A F5 (08/09/2026)
  // não desfez o memo: ele é legítimo no caminho quente. O que ela fez foi
  // limitar a defasagem e torná-la visível, separando a leitura barata
  // (`carimboAtual`) da conferida de verdade (`confereCarimbo`), e publicando a
  // procedência em `GET /api/saude`. Ver `carimbo-vigiado.ts`.

  /**
   * O carimbo pelo caminho BARATO — memo quando há.
   *
   * É este que o caminho quente do HTTP usa, e é por isso que ele é memoizado:
   * 0,57 ms é o maior custo fixo de um acerto de cache, que inteiro tem de
   * caber em menos de 10 ms.
   *
   * **A defasagem que isto admite agora é LIMITADA**, e antes não era. Ver
   * `carimbo-vigiado.ts`: quando o `fs.watch` não entrega, quem reconcilia é
   * `confereCarimbo()`, chamada a cada volta do `Aquecedor`. Antes da F5, um
   * watch mudo deixava este memo velho por tempo indeterminado, sem log e sem
   * sintoma.
   */
  private carimboAtual(): string {
    return this.carimbo.doMemo();
  }

  /**
   * O carimbo de UMA página — só as tabelas que ela usa, não as 25 juntas.
   *
   * **Por que existe, com o número que mediu o problema.** `carimboAtual()` é
   * um hash sobre TODAS as tabelas: refresh de qualquer uma delas — 63 vezes em
   * 2h10 de processo, uma a cada ~2 min no grupo "quente" — muda o hash das 14
   * páginas de uma vez, mesmo nas que não leem a tabela que mudou. Isso é
   * exatamente o inverso do que o cache existe para fazer: cada virada joga
   * fora respostas que continuam certas, e o reaquecimento (~2,5 min para
   * requentar as 14) quase nunca termina uma passada antes da próxima virada
   * apagar tudo de novo.
   *
   * **O que NÃO muda.** `identidadeAtual()` (usada pela worker para saber se o
   * disco mudou por baixo) continua olhando o carimbo GLOBAL, e o `dia` UTC
   * (`diaDoCalculo`, na chave ao lado deste carimbo) continua sendo o mesmo
   * para as 14 páginas. `npm run snapshot`, a virada da meia-noite e o poller
   * de tempo quase real (`aoTabelaMudar`/`limpaPagina`, um mecanismo
   * inteiramente separado) continuam invalidando exatamente como sempre
   * invalidaram — nenhuma das garantias que os testes travam depende do
   * carimbo ser global.
   *
   * **Sempre a leitura barata.** `this.carimboAtual()` aquece (ou reaproveita)
   * `manifestoMemo`/`calculadasMemo` sem reler disco — a mesma leitura que já
   * acontecia, uma vez por mudança de verdade. Um `'(indeterminado)'` de
   * `queriesDe` (página cuja dependência não dá para calcular) cai para o
   * carimbo global: na dúvida, invalidar demais é seguro; invalidar de menos
   * não é.
   */
  private carimboDaPagina(dash: DashboardSpec): string {
    this.carimboAtual();
    const queries = this.queriesDe(dash);
    if (queries.includes('(indeterminado)')) return this.carimboAtual();
    return carimboDoSnapshot(this.manifestoMemo, this.calculadasMemo, queries);
  }

  /**
   * A identidade de UMA página: o carimbo das tabelas que ela lê, mais o dia.
   *
   * **O que ela é para `identidadeAtual()`, `carimboDaPagina` é para
   * `carimboAtual()`** — e existe pela mesma razão medida. `identidadeAtual()`
   * é global: qualquer tabela rematerializada muda o valor dela, e quem
   * escutava essa mudança (`Servidor.carrega()` aqui, `cacheDeCarga` dentro de
   * cada worker) jogava fora o dataset de TODAS as páginas. Amostrado na API no
   * ar em 21/09/2026, sem ninguém na tela: **4 mudanças de carimbo em 6
   * minutos**, uma a cada 1,5 min.
   *
   * O custo disso não é recalcular, é **reler o disco**. Medido nas mesmas
   * condições, `visao-geral`: 2 ms servida do cache, **219 ms** recalculada com
   * as tabelas em memória, **2250 ms** recalculada tendo de relê-las. Os ~2 s
   * de diferença eram o descarte, não o cálculo.
   *
   * **Lê o DISCO, não o memo** — é a mesma F5 de `identidadeAtual()`, e a razão
   * de `confereCarimbo()` vir antes do hash escopado: é essa chamada que
   * reabastece `manifestoMemo`/`calculadasMemo` (ver `leDoDisco` no construtor).
   * Um `fs.watch` mudo não pode deixar a worker presa ao `Carregado` de ontem,
   * e escopar por página não afrouxa isso: o que muda é QUAIS tabelas entram no
   * hash, não de onde elas são lidas.
   *
   * **O dia continua global**, de propósito: `diaDoCalculo` não depende de
   * página nenhuma, então a virada da meia-noite muda a identidade de todas de
   * uma vez — que é exatamente o que as 32 chamadas a `TODAY()` exigem.
   *
   * Página de dependência indeterminada cai no carimbo global, pelo mesmo
   * argumento de `carimboDaPagina`: na dúvida, invalidar demais é seguro.
   */
  private identidadeDaPagina(dash: DashboardSpec): string {
    const global = this.confereCarimbo();
    const queries = this.queriesDe(dash);
    const carimbo = queries.includes('(indeterminado)')
      ? global
      : carimboDoSnapshot(this.manifestoMemo, this.calculadasMemo, queries);
    return identidadeDoCalculo(carimbo, diaDoCalculo(this.opts.agora()));
  }

  /**
   * O carimbo lido do DISCO, reconciliando o memo — a segunda garantia da F5.
   *
   * **Não é um detector novo.** É a mesma chamada que o `Aquecedor` já fazia a
   * cada 5 s, que voltou a fazer o que o nome dela diz. O comentário de topo de
   * `aquecedor.ts` sempre afirmou que ele funciona "conferindo o carimbo do
   * snapshot de tempos em tempos"; com o memo no caminho, essa conferida tinha
   * virado um `return` de variável, e o `Aquecedor` ficou tão cego quanto o
   * cache quando o `fs.watch` calava.
   *
   * Custa 0,57 ms por volta de 5 s, e por cálculo de página (onde ele some ao
   * lado de 10–20 s de conta). Não entra no caminho de um acerto de cache.
   */
  private confereCarimbo(): string {
    return this.carimbo.confere();
  }

  /**
   * A identidade completa do que a API responderia agora: o dado em disco e o dia.
   *
   * **Pública porque o aquecedor precisa dela**, e precisa dela *exatamente* como as
   * duas camadas de cache a calculam. Um aquecedor que vigiasse só o carimbo dormiria
   * na virada da meia-noite — que é justamente o instante em que o cache inteiro fica
   * inalcançável de uma vez, pelas 32 chamadas a `TODAY()`. A tela do primeiro
   * expediente é a que pagaria.
   *
   * **Lê o disco, não o memo** (F5). É o que faz dela a segunda garantia contra
   * um `fs.watch` mudo — e o que devolve ao `Aquecedor` a capacidade de notar
   * um snapshot novo por conta própria.
   */
  identidadeAtual(): string {
    return identidadeDoCalculo(this.confereCarimbo(), diaDoCalculo(this.opts.agora()));
  }

  /**
   * As colunas sob demanda e as tabelas de grão reduzido que **este** visual amarra
   * — e só elas.
   *
   * Pedir um visual não libera o texto livre da base inteira, nem escala toda tabela
   * de grão reduzido do modelo: libera só o que aquele visual de fato mostra ou
   * filtra. É o que mantém o custo do pedido proporcional ao que ele entrega — o
   * mesmo raciocínio para as duas listas, por isso uma função só produz as duas.
   *
   * **Varre `fields` E `filters`.** Só `fields` ficava de fora um caso real: um
   * visual pode filtrar por uma coluna sem listá-la como campo (ex.: um card de
   * `visao-geral` que filtra por `'FIELD AGENDA'[Data]` sem citar a tabela em
   * `entities_used`). Sem isto, um filtro assim tocaria coluna/tabela sob demanda
   * sem liberá-la — a carga erraria alto em vez de resolver sozinha.
   */
  private sobDemandaDoVisual(dash: DashboardSpec, visualId: string): { colunas: string[]; tabelasCompletas: string[] } {
    const v = (dash.visuals ?? []).find((x) => x.id === visualId);
    if (!v) return { colunas: [], tabelasCompletas: [] };

    const { colunas, tabelasCompletas } = this.amarraGraoReduzido();
    const foraColunas = new Set<string>();
    const foraTabelas = new Set<string>();
    const olha = (entity: string | null, property: string | null): void => {
      if (!entity || !property) return;
      const rotulo = normalizeName(rotuloDeColuna(entity, property));
      const r = colunas.get(rotulo);
      if (r) foraColunas.add(r);
      const t = tabelasCompletas.get(rotulo);
      if (t) foraTabelas.add(t);
    };
    for (const c of v.fields ?? []) {
      if (c.kind === 'measure') continue;
      olha(c.entity, c.property);
    }
    for (const f of v.filters ?? []) olha(f.entity, f.property);

    return { colunas: [...foraColunas], tabelasCompletas: [...foraTabelas] };
  }

  /** Mapas rótulo-normalizado → (nome declarado | tabela), montados uma vez por chamada. */
  private amarraGraoReduzido(): { colunas: Map<string, string>; tabelasCompletas: Map<string, string> } {
    const colunas = new Map(
      this.model.sobDemanda.map((s) => [
        normalizeName(rotuloDeColuna(s.tabela, s.coluna)),
        rotuloDeColuna(s.tabela, s.coluna),
      ]),
    );
    const tabelasCompletas = new Map<string, string>();
    for (const g of this.model.graoReduzido) {
      for (const coluna of g.colunasGatilho) {
        tabelasCompletas.set(normalizeName(rotuloDeColuna(g.tabela, coluna)), g.tabela);
      }
    }
    return { colunas, tabelasCompletas };
  }

  /**
   * As tabelas de grão reduzido que os FILTROS DE PÁGINA (não de visual) amarram.
   *
   * Filtro de página vale para todo pedido a esta página, liberado ou não — ao
   * contrário do de visual, não faz sentido pedir para "não aplicar" um filtro de
   * página. Por isso entra incondicionalmente na chave/carga, sem depender de
   * `visuaisPedidos`.
   */
  private tabelasCompletasDaPagina(dash: DashboardSpec): string[] {
    const { tabelasCompletas } = this.amarraGraoReduzido();
    const fora = new Set<string>(this.#formaCompletaDoTempoReal(dash));
    for (const f of dash.filters ?? []) {
      if (!f.entity || !f.property) continue;
      const t = tabelasCompletas.get(normalizeName(rotuloDeColuna(f.entity, f.property)));
      if (t) fora.add(t);
    }
    return [...fora];
  }

  private queriesDe(dash: DashboardSpec): string[] {
    try {
      return planeja([dash], this.model).queries;
    } catch {
      // `planeja` erra alto em página com tabela que não tem como ser
      // materializada. Na listagem isso é "não está pronta", não uma falha: um id
      // impossível faz `pronta` dar falso em vez de derrubar a rota inteira.
      return ['(indeterminado)'];
    }
  }
}

/**
 * O corpo de `GET /api/dashboards/:id`, sem o campo `cache`.
 *
 * Existe como tipo nomeado desde o single-flight (F2): o corpo passou a ser o
 * valor que UM cálculo devolve e que N pedidos compartilham, então ele precisa
 * de um nome para atravessar `VooUnico.faz<T>`. O campo `cache` fica de fora de
 * propósito — ele descreve o PEDIDO (acertou, calculou, pegou carona), não a
 * resposta, e é o único pedaço que difere entre os N que dividem o mesmo voo.
 */
type CorpoDaPagina = PaginaCalculada & {
  dadoDe: string | null;
  omitidas: string[];
  filtrosDaTela: { tabela: string | null; coluna: string | null; nivel?: string; valores: unknown[] }[];
  tabelas: { nome: string; linhas: number }[];
};

