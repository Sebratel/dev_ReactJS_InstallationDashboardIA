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

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { normalizeName, SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { rotuloDeColuna } from '../../../packages/semantic-model/src/projecao.ts';
import { loadDashboards, type DashboardSpec, type FiltroSpec } from '../../../packages/widget-engine/src/spec.ts';
import { decodificaFiltros } from '../../../packages/widget-engine/src/filtro-url.ts';
import { carrega, type Carregado } from '../../../packages/snapshot/src/carrega.ts';
import { leManifesto, maisAntigo, type Manifesto } from '../../../packages/snapshot/src/manifesto.ts';
import { carimboDasCalculadas } from '../../../packages/snapshot/src/tabelas-calculadas.ts';
import { planeja } from '../../../packages/snapshot/src/plano.ts';
import { isBlank, type DaxValue } from '../../../packages/measure-engine/src/value.ts';
import {
  NIVEIS_DE_HIERARQUIA,
  projecaoDeHierarquia,
  type Evaluator,
} from '../../../packages/measure-engine/src/evaluator.ts';
import { MemoryCache } from '../../../packages/query-engine/src/cache-memory.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import type { Cache } from '../../../packages/query-engine/src/types.ts';
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
  identificaPorSessao,
  type Identidade,
  type Sessoes,
} from './identidade.ts';
import { verificaIdToken, type VerificadorDeToken } from './auth-google.ts';
import { verificaIdTokenFirebase, type BuscaCertificados } from './auth-firebase.ts';
import {
  calculaPagina,
  segmentacaoDe,
  tipoDe,
  LINHAS_MAXIMO,
  LINHAS_PADRAO,
  TERMO_MAXIMO,
  type PaginaCalculada,
} from './calcula.ts';
import { carregaLayout } from '../../../tools/layout/src/valida.ts';
import type { LayoutSpec } from '../../../tools/layout/src/schema.ts';
import { leStatus, montaStatusDeRefresh } from '../../../tools/refresh/src/status.ts';
import { PiscinaWorkers } from './piscina-workers.ts';
import { linhasDoOverlay, mescladoresDe, type OverlayDeTabela } from './overlay-realtime.ts';
import { Metricas, ORIGENS, origemDoPedido, prioridadeDe, type OrigemDoPedido } from './metricas.ts';
import { VooUnico, type Voo } from './voo-unico.ts';
import { redisAusente, type EstadoDoRedis } from './saude-do-redis.ts';
import { aplicaHeadersDeSeguranca } from './headers-seguranca.ts';
import { LimitadorDeTaxa, ipDoPedido } from './limitador-taxa.ts';


/** Quantos valores de segmentação a resposta manda por padrão. */
export const VALORES_PADRAO = 500;
/**
 * Teto duro da lista de segmentação.
 *
 * `'PROTOCOLOS GERAL'[N°PROTOCOLO]` é uma segmentação de `visao-geral` e tem 32.744
 * valores distintos — uma lista que ninguém rola e que sozinha pesa mais que a página.
 * O teto corta, e a resposta **diz** que cortou.
 */
export const VALORES_MAXIMO = 5000;

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
const JANELA_API_MS = 60_000;

/**
 * Carrega `specs/layout/*.layout.yaml` uma vez, na subida. Diretório ausente vira mapa
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

export interface ServidorOptions {
  /** Raiz do repositório — de onde saem `specs/` e o `snapshot/`. */
  root: string;
  /** Diretório do snapshot. Separado do root para o teste apontar para um temporário. */
  snapshotDir: string;
  /** Diretório dos arquivos estáticos da tela. */
  webDir: string;
  /** O relógio do cálculo. Injetado: 25 das 121 expressões chamam `TODAY()`. */
  agora?: () => Date;
  /**
   * Onde a resposta calculada é guardada. Padrão: `MemoryCache` — já serve o
   * segundo pedido do mesmo processo. `npm run api` põe o Redis aqui quando
   * `REDIS_URL` existe, e aí o cache sobrevive ao restart.
   */
  cache?: Cache;
  /** Onde a falha do cache aparece. Ela nunca derruba o pedido. */
  aoFalharCache?: (operacao: 'get' | 'set', erro: unknown) => void;
  /**
   * Quem está pedindo. Padrão: sessão real por cookie (`identidade.ts`) — sem
   * sessão válida, `null`, e `/api/*` responde 401 antes do roteamento
   * (`docs/DEPLOY.md` §2.1). Sobrescrever isto é o jeito de teste injetar uma
   * identidade sem passar pelo login de verdade; é por aqui também que o
   * Permission Engine (papéis/recorte por linha) entraria depois.
   */
  identifica?: (req: http.IncomingMessage) => Identidade | null;
  /** Client ID do OAuth do Google, para `POST /auth/google`. Vazio recusa todo
   *  token — falha fechada, não aberta, enquanto não configurado. */
  googleClientId?: string;
  /** Domínio do Google Workspace que pode logar. */
  dominioCorporativo?: string;
  /** Por quanto tempo uma sessão criada em `/auth/google` vale. */
  sessaoTtlHoras?: number;
  /** Substitui o cliente real do Google em teste — ver `auth-google.ts`. */
  verificadorGoogle?: VerificadorDeToken;
  /**
   * ID do projeto Firebase, para `POST /auth/firebase`. Vazio recusa todo
   * token — falha fechada, igual ao `googleClientId`.
   *
   * Coexiste com `googleClientId` de propósito: os dois caminhos entregam a
   * MESMA sessão (`criaSessao` com o e-mail), e quem escolhe é a configuração
   * do ambiente. Ter os dois ligados ao mesmo tempo é legítimo — é o que
   * permite migrar a tela para o Firebase sem derrubar o `tools/tela` nem
   * quem já estiver logado pelo GIS.
   */
  firebaseProjectId?: string;
  /** Substitui a busca de chaves públicas do Firebase em teste — ver `auth-firebase.ts`. */
  certificadosFirebase?: BuscaCertificados;
  /**
   * Segredo compartilhado (`.env`, `TOKEN_INTERNO`) que libera `POST
   * /auth/interno` — a única forma de uma ferramenta de linha de comando
   * (hoje: `tools/tela`, que dirige um navegador de verdade) logar sem conta
   * do Google. Vazio (padrão) desliga a rota inteira: nenhum token, nem o
   * certo, autentica — falha fechada, igual ao `googleClientId` vazio.
   */
  tokenInterno?: string;
  /**
   * Liga `Secure` no cookie de sessão e `Strict-Transport-Security` nos
   * headers de resposta (`headers-seguranca.ts`). Padrão: `false` — hoje não
   * há TLS na frente (`nginx.conf` só tem `listen 80`), e um cookie `Secure`
   * sobre HTTP puro nunca seria enviado pelo navegador, quebrando login sem
   * erro nenhum. Ligar isto sem TLS de verdade na frente troca "sem cookie
   * Secure" por "login que nunca funciona".
   */
  cookieSecure?: boolean;
  /**
   * Há um proxy reverso na frente que reescreve `X-Real-IP`? Só então esse
   * header é confiável como chave do rate limit — ver `ipDoPedido` em
   * `limitador-taxa.ts`. Padrão: `false`. Ligar sem proxy de verdade na frente
   * ABRE um bypass do rate limit (o cliente escolhe a chave forjando o
   * header); ligar atrás do `nginx.conf`, que faz `proxy_set_header X-Real-IP
   * $remote_addr`, é o certo. Mesmo par "preparado/ativado" do `cookieSecure`
   * com o TLS: ligam juntos com a infraestrutura, via `CONFIA_PROXY=1`.
   */
  confiaNoProxy?: boolean;
  /**
   * Verdadeiro em produção — hoje só diferencia o que um erro 500 expõe
   * (`atende()`): a mensagem completa vai sempre para o log, mas só sai na
   * resposta HTTP fora de produção. Entra por opção, e não lendo
   * `process.env.NODE_ENV` direto neste arquivo, pelo mesmo motivo de
   * `googleClientId`/`sessaoTtlHoras`: quem lê env é `index.ts`, e um teste
   * precisa poder afirmar os dois comportamentos sem mexer no processo.
   */
  producao?: boolean;
  /**
   * O estado do reaquecimento automático, para `GET /api/saude`.
   *
   * Entra por função, e não por valor, porque o `Aquecedor` só pode ser construído
   * **depois** do servidor — ele precisa da porta em que o servidor foi escutar.
   * Padrão: desligado, que é o que `npm run api -- --sem-aquecer` e todo teste veem.
   */
  aquecimento?: () => { ativo: boolean; pronto: boolean };
  /**
   * Teto de memória, em MB, do cache de resultado inteiro por visual. Ver
   * `cache-visual.ts`. Zero desliga — e desligar devolve o recálculo por clique de
   * "próxima", que é o defeito que ele conserta.
   */
  tetoDeVisuaisMB?: number;
  /**
   * Intervalo do batimento do SSE, em ms. Padrão 25.000 — ver
   * `Servidor.BATIMENTO_SSE_MS` para o porquê desse número.
   *
   * Existe como opção só para poder ser TESTADO: um teste que esperasse 25 s
   * pelo segundo batimento não seria escrito, e um batimento que ninguém testa
   * é um `setInterval` que se acredita estar ligado.
   */
  batimentoSseMs?: number;
  /**
   * O poller de quase-realtime (`apps/api/src/poller-realtime.ts`), consultado a
   * cada `carrega()` — nunca guardado por mais que um pedido, porque o overlay
   * muda entre pedidos e `carregadas` (abaixo) não pode congelar uma versão
   * velha dele. Padrão: nenhum overlay, comportamento idêntico a antes desta
   * peça existir.
   */
  /**
   * **Dado, não função** — mudou em 08/09/2026 (F1 do plano de near-realtime).
   * Ver `overlay-realtime.ts` para o porquê inteiro; em resumo, o `Map` de
   * mescladores não atravessa `postMessage`, e a piscina de workers é o caminho
   * de produção. Quem calcula na própria thread converte com `mescladoresDe()`;
   * a worker recebe estes objetos e reconstrói as funções do outro lado.
   */
  overlayRealtime?: () => ReadonlyMap<string, OverlayDeTabela>;
  /**
   * O estado do poller de realtime, para `GET /api/saude`. Padrão: nenhum —
   * e aí a chave `poller` não aparece, que é a verdade de todo teste e de
   * todo `npm run api` sem credencial do Voalle.
   *
   * **Por que passou a existir.** Desde 08/09/2026 o poller só anuncia linha
   * que MUDOU o delta, e não toda linha que a margem rebuscou. O efeito
   * colateral é que um poller saudável fica calado quando a fonte está quieta
   * — indistinguível, no log, de um poller morto. Mesmo modo de falha que a
   * F5 fechou no carimbo, e mesma resposta: publicar o estado.
   */
  estadoDoPoller?: () => unknown;
  /**
   * O estado do agendador de refresh que roda DENTRO deste processo
   * (`apps/api/src/agendador.ts`). Ausente quando quem agenda é outro — o daemon
   * dedicado do `docker-compose.prod.yml`, ou ninguém.
   *
   * **É a resposta direta ao #129.** `refresh` (abaixo) conta o que ACONTECEU:
   * idade por query, último sucesso por grupo. Ele não sabe dizer se existe alguém
   * encarregado de acontecer de novo — foi exatamente essa a pergunta que ficou sem
   * resposta em 16/09/2026, com os três grupos marcando `falhasConsecutivas: 0` e
   * nenhum processo vivo na máquina. `agendador.ativo` é o campo que separa "não
   * falhou" de "não roda ninguém".
   */
  estadoDoAgendador?: () => unknown;
  /**
   * Erros não tratados que a guarda de processo engoliu para manter a tela no ar.
   *
   * Sem isto, uma API que sobrevive a um erro é indistinguível de uma que nunca teve
   * nenhum — e a diferença entre as duas é exatamente o aviso que se queria ter antes
   * da próxima queda.
   */
  estadoDaGuarda?: () => unknown;
  /**
   * O estado do disjuntor da camada durável do cache.
   *
   * **Por que ele precisa aparecer.** Um Redis fora do ar já era visível em
   * `redis.status`, mas o que ele custava não era: 10 s de espera por
   * operação, em todo pedido, com a saúde dizendo `ok`. Com o disjuntor,
   * `estado: "aberto"` é a frase que faltava — «o Redis está fora do
   * caminho de propósito, e é por isso que as respostas estão vindo do
   * cálculo».
   */
  estadoDoDisjuntor?: () => unknown;
  /**
   * O estado da camada durável do cache, para `GET /api/saude`. Padrão:
   * `ausente` — que é a verdade de todo teste e de todo `npm run api` sem
   * `REDIS_URL`.
   *
   * Entra por função pelo mesmo motivo de `aquecimento`: quem sabe se o Redis
   * está de pé é o driver, que vive em `index.ts`, e o valor muda depois da
   * construção do servidor. Ver `saude-do-redis.ts` para por que isto merece
   * existir — em resumo, `adapter: "MemoryCache+RedisCache"` é o arranjo montado
   * na subida, não o estado dele agora, e uma API degradada parecia saudável.
   */
  estadoDoRedis?: () => EstadoDoRedis;
  /**
   * Reaquece as páginas que o evento do poller acabou de invalidar (F4).
   *
   * **Por que é injetado, e não escrito aqui.** Quem sabe reaquecer é o
   * `Aquecedor`: ele acerta a MESMA chave de cache que o navegador pediria
   * (corte eager do layout, filtros padrão, cabeçalho interno que classifica o
   * pedido como `warmup`). Reescrever isso aqui encheria chaves *parecidas* — e
   * o acerto nunca aconteceria, que é o defeito descrito no topo de
   * `aquecedor.ts`. Mas o `Aquecedor` só existe depois do `listen`, então entra
   * por fora, como `aquecimento` e `estadoDoRedis`.
   *
   * Padrão: não reaquece — e aí um evento do poller só invalida e avisa, que
   * é exatamente o comportamento de antes da F4. É o que todo teste vê.
   *
   * **Não segura o SSE**, e a promessa devolvida não é esperada por pedido
   * nenhum — ver `reaquecePorBaixo` para a medida que decidiu isso.
   */
  reaquece?: (paginas: readonly string[]) => Promise<void>;
  /** Instância ou opção para a piscina de worker threads. */
  piscinaWorkers?: PiscinaWorkers;
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

export class Servidor {
  private readonly piscina: PiscinaWorkers;

  // `piscinaWorkers` entra no Omit porque o construtor a desestrutura FORA de
  // `resto` (vira `this.piscina`) — sem ela aqui, o tipo exige um padrão que
  // nunca é escrito e o compilador acusa a linha errada.
  private readonly opts: Required<
    Omit<
      ServidorOptions,
      'cache' | 'aoFalharCache' | 'verificadorGoogle' | 'certificadosFirebase' | 'piscinaWorkers'
    >
  >;
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
  /** `specs/layout/*.layout.yaml`, carregado uma vez — não muda em runtime, e ler o
   *  disco por pedido não caberia nos ~10ms de resposta a quente. Página sem arquivo
   *  simplesmente não entra no mapa; ver Fase L4 de docs/PLANO-LAYOUT-V1.md §6. */
  private readonly layouts: Map<string, LayoutSpec>;
  /** De onde saem os TTLs — `specs/_catalog/cache-policies.yaml`, já decididos. */
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
  /** O carimbo do snapshot que `carregadas` reflete. Mudou? O mapa inteiro é lixo. */
  private carimboDasCarregadas: string | null = null;
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
  /** Conexões `GET /api/eventos` abertas — o SSE do poller de quase-realtime. */
  private readonly assinantesSSE = new Set<http.ServerResponse>();

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
  private readonly limitadorApi: LimitadorDeTaxa;

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
      identifica: (req) => identificaPorSessao(this.sessoes, req),
      aquecimento: () => ({ ativo: false, pronto: false }),
      tetoDeVisuaisMB: TETO_PADRAO_MB,
      googleClientId: '',
      firebaseProjectId: '',
      dominioCorporativo: 'sebratel.com.br',
      sessaoTtlHoras: 12,
      tokenInterno: '',
      cookieSecure: false,
      producao: false,
      batimentoSseMs: Servidor.BATIMENTO_SSE_MS,
      overlayRealtime: () => new Map(),
      estadoDoRedis: redisAusente,
      // Sem reaquecimento ligado, `aoTabelaMudar` emite o SSE na mesma volta —
      // o comportamento de antes da F4, e o de todo teste que não pede outra
      // coisa. `naoReaquece` é uma constante e não `async () => {}` para que a
      // comparação por identidade em `aoTabelaMudar` funcione.
      reaquece: naoReaquece,
      ...resto,
    };
    this.limitadorAuth = new LimitadorDeTaxa(LIMITE_AUTH_TENTATIVAS, JANELA_AUTH_MS, () => this.opts.agora());
    this.limitadorApi = new LimitadorDeTaxa(LIMITE_API_POR_MINUTO, JANELA_API_MS, () => this.opts.agora());
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
    this.model = SemanticModel.fromSpecsDir(path.join(opts.root, 'specs'));
    this.dashboards = loadDashboards(path.join(opts.root, 'specs'));
    this.layouts = carregaLayouts(path.join(opts.root, 'specs', 'layout'));
    this.registry = QueryRegistry.fromSpecsDir(path.join(opts.root, 'specs'));
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
   * `apps/api/test/overlay-worker.test.ts`).
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
  private registraEventoSeg(req: http.IncomingMessage, status: number, motivo: string): void {
    const ip = ipDoPedido(req, this.opts.confiaNoProxy ?? false);
    const rota = (req.url ?? '/').split('?')[0] ?? '/';
    console.warn(`[seg] status=${status} ip=${ip} metodo=${req.method ?? '?'} rota=${rota} motivo=${motivo}`);
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
    if (rota.startsWith('/auth/') && req.method === 'POST') {
      // CSRF: defesa em profundidade sobre o que `SameSite=Lax`
      // (`identidade.ts`) já impede na prática. Só recusa quando `Origin` (ou,
      // na ausência dele, `Referer`) vier presente E discordar do `Host` do
      // pedido — sem nenhum dos dois (chamada servidor-a-servidor, ex.
      // `tools/tela` batendo direto na API), passa: não há navegador aqui para
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

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD, POST');
      responde(res, 405, {
        erro: `Método ${req.method} não existe nesta rota. A API é somente leitura ` +
          `— as únicas exceções são POST /auth/google, /auth/firebase, /auth/interno e /auth/logout.`,
      });
      return;
    }

    // /api/saude fica de fora da guarda de sessão: quem bate nela é o
    // healthcheck do container (docker-compose.prod.yml), que não tem como
    // logar — e ela não expõe dado de cliente, só metadado operacional.
    if (rota === '/api/saude') return this.saude(res);

    // O Aquecedor bate nestas mesmas rotas por HTTP, de propósito (ver o
    // comentário de `segredoAquecedor` acima) — reconhecê-lo aqui, antes do
    // cookie de sessão, é o que evita ele levar 401 de si mesmo.
    const cabecalhoAquecedor = req.headers['x-aquecedor-interno'];
    const ehAquecedor =
      typeof cabecalhoAquecedor === 'string' && cabecalhoAquecedor === this.segredoAquecedor;

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
          ? { usuario: 'dev-local', papeis: ['autenticado'] }
          : null);

    if (rota.startsWith('/api/')) {
      // O Aquecedor fica isento — ele bate nestas rotas em rajada de
      // propósito (reaquecimento pós-evento, F4), e é reconhecimento pelo
      // mesmo segredo por processo que já o isenta do 401 logo abaixo.
      if (!ehAquecedor) {
        const decisaoDeTaxa = this.limitadorApi.registra(ipDoPedido(req, this.opts.confiaNoProxy ?? false));
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
      if (rota === '/api/dashboards') return this.lista(res);
      if (rota === '/api/eventos') return this.eventos(req, res);
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
    this.estatico(res, rota);
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
      responde(res, 401, {
        erro: `Token inválido, expirado, ou fora do domínio ${this.opts.dominioCorporativo}.`,
      });
      return;
    }
    const token = criaSessao(this.sessoes, identidade.email, this.opts.sessaoTtlHoras);
    res.setHeader('Set-Cookie', cookieDeSessao(token, this.opts.sessaoTtlHoras, this.opts.cookieSecure));
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
      responde(res, 401, {
        erro: `Token inválido, expirado, ou fora do domínio ${this.opts.dominioCorporativo}.`,
      });
      return;
    }
    const token = criaSessao(this.sessoes, identidade.email, this.opts.sessaoTtlHoras);
    res.setHeader('Set-Cookie', cookieDeSessao(token, this.opts.sessaoTtlHoras, this.opts.cookieSecure));
    responde(res, 200, { usuario: identidade.email });
  }

  /**
   * O login de uma ferramenta de linha de comando (`tools/tela`, que dirige
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
    const sessao = criaSessao(this.sessoes, 'ferramenta-interna', this.opts.sessaoTtlHoras);
    res.setHeader('Set-Cookie', cookieDeSessao(sessao, this.opts.sessaoTtlHoras, this.opts.cookieSecure));
    responde(res, 200, { usuario: 'ferramenta-interna' });
  }

  private logout(req: http.IncomingMessage, res: http.ServerResponse): void {
    apagaSessaoDoPedido(this.sessoes, req);
    res.setHeader('Set-Cookie', cookieDeSessao('', 0, this.opts.cookieSecure));
    responde(res, 200, { ok: true });
  }

  // ------------------------------------------------------------------- rotas

  private saude(res: http.ServerResponse): void {
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
    responde(res, 200, {
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
      refresh: this.statusDeRefresh(),
      // Separado de `refresh` de propósito: aquele descreve o dado (idade, último
      // sucesso), este descreve o RELÓGIO. Um pode estar verde com o outro morto, e
      // foi essa combinação que passou despercebida por 3h43 em 16/09/2026.
      ...(this.opts.estadoDoAgendador ? { agendador: this.opts.estadoDoAgendador() } : {}),
      ...(this.opts.estadoDaGuarda ? { guarda: this.opts.estadoDaGuarda() } : {}),
    });
  }

  private statusDeRefresh(): unknown {
    try {
      const specsDir = path.join(this.opts.root, 'specs');
      const agora = this.opts.agora ? this.opts.agora() : new Date();
      return montaStatusDeRefresh(this.opts.snapshotDir, specsDir, agora);
    } catch {
      return {};
    }
  }

  private lista(res: http.ServerResponse): void {
    const manifesto = leManifesto(this.opts.snapshotDir);
    const emDisco = new Set(manifesto?.tabelas.map((t) => t.query) ?? []);
    responde(res, 200, {
      dashboards: this.dashboards.map((d) => ({
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
   * (`apps/api/src/poller-realtime.ts`). A conexão fica aberta; quem fecha é o
   * navegador (recarregou, saiu da página) — `req.on('close')` é o único jeito
   * confiável de saber disso num `node:http` cru.
   *
   * Sem corpo, sem filtro, sem paginação: um evento aqui só diz "esta página
   * pode ter dado novo", nunca traz dado — o navegador continua buscando pela
   * mesma rota de sempre (`GET /api/dashboards/:id`), só que sem esperar o
   * usuário apertar F5.
   */
  private eventos(req: http.IncomingMessage, res: http.ServerResponse): void {
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
   * O poller de quase-realtime (`apps/api/src/poller-realtime.ts`) chama isto
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
    const afetados = [...this.queriesPorDashboard]

      .filter(([, queries]) => queries.includes(queryId))
      .map(([id]) => id);
    if (afetados.length === 0) return;

    const emEvento = Date.now();

    for (const dashId of afetados) {
      for (const chave of [...this.carregadas.keys()]) {
        if (chave === dashId || chave.startsWith(`${dashId}\u0000`)) this.carregadas.delete(chave);
      }
      // A MESMA invalidação, do lado de cada worker: `cacheDeCarga`
      // (`worker-calculador.ts`) guarda o dataset por thread própria, e sem
      // isto uma worker que já tivesse esta página carregada continuaria
      // servindo o overlay velho para sempre — o F1 de novo, um nível abaixo.
      this.piscina.invalidaPagina(dashId);
      this.completos.limpaPagina(dashId);
      // Efeito colateral, não parte de resposta nenhuma — não há pedido para
      // atrasar esperando o Redis, e `apagaPagina` já nunca lança.
      void this.cache.apagaPagina(dashId);
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
   * A forma declarada da página — `specs/layout/<id>.layout.yaml`, cru. Sem filtro, sem
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
        erro: `'${id}' não tem specs/layout/${id}.layout.yaml — rode 'npm run layout:extrai'.`,
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
    // para a abertura, ver `specs/_catalog/projecao.yaml`) e, desde a Fase L5 (R4),
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
    const recalcula = url.searchParams.get('recalcula') === '1';
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

    let voo: Voo<CorpoDaPagina>;
    try {
      voo = await this.vooUnico.faz<CorpoDaPagina>(chave, async () => {
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
              specsDir: path.join(this.opts.root, 'specs'),
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
              // mudou por baixo, do mesmo jeito que `identidadeAtual()` já faz
              // para `this.carregadas` aqui na thread principal — DISCO, não o
              // memo (`carimboAtual()`), pela mesma razão de F5: um `fs.watch`
              // mudo não pode deixar a worker presa ao `Carregado` de ontem.
              identidade: this.identidadeAtual(),
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
            }, prioridade);
            // `worker_ms` continua sendo a SOMA (espera + cálculo). Ele não foi
            // substituído por `fila_ms_*`/`calculo_ms_*`: é o número que os
            // testes e as medições das fases F1 e F2 usam, e trocar o significado
            // dele tornaria aquelas comparações incomparáveis.
            this.metricas.observa('worker_ms', Date.now() - tWorker);
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
        return corpo;
      }, prioridade);
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
      // este campo (conferido em `apps/web/src`), então nada nela muda.
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
    // Ainda não recorta nada — está aqui porque a lista de valores de uma
    // segmentação é justamente o que um RLS teria de recortar primeiro: ela mostra
    // *quais equipes existem* antes de mostrar qualquer número.
    _quem: Identidade,
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
    const chaveValores = `${id}\u0000${normalizeName(tabela)}\u0000${normalizeName(coluna)}\u0000${normalizeName(nivel ?? '')}`;
    let distintos = this.cacheValoresDistintos.get(chaveValores);
    if (!distintos) {
      let carregado: Carregado;
      try {
        carregado = await this.carrega(dash);
      } catch (err) {
        responde(res, 409, { erro: err instanceof Error ? err.message : String(err) });
        return;
      }
      try {
        distintos = valoresDistintos(carregado.ev, tabela, coluna, nivel);
        this.cacheValoresDistintos.set(chaveValores, distintos);
      } catch (err) {
        // Nível que a projeção não conhece. 400: o pedido está errado, não o estado.
        responde(res, 400, { erro: err instanceof Error ? err.message : String(err) });
        return;
      }
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

  /**
   * Os arquivos da tela.
   *
   * **Duas telas convivem, e a ordem entre elas é a decisão.** `dist/` é o build do
   * `apps/web` (React); `index.html` na raiz é a tela de uma página só que existiu
   * antes dele. Quando o build existe, ele é a tela — `npm run api` sozinho serve a
   * aplicação, sem Vite e sem segunda porta. A antiga continua alcançável em
   * `/legado`, porque apagá-la junto com a migração jogaria fora a única referência
   * com que comparar a nova.
   */
  private estatico(res: http.ServerResponse, rota: string): void {
    if (rota === '/legado') return this.arquivo(res, this.opts.webDir, 'index.html');

    const dist = path.join(this.opts.webDir, 'dist');
    const temBuild = fs.existsSync(path.join(dist, 'index.html'));
    const arquivo = rota === '/' ? 'index.html' : rota.slice(1);
    return this.arquivo(res, temBuild ? dist : this.opts.webDir, arquivo);
  }



  private arquivo(res: http.ServerResponse, base: string, arquivo: string): void {
    // Só o que está dentro da base: `..` no caminho sairia do diretório.
    const alvo = path.resolve(base, arquivo);
    if (!alvo.startsWith(path.resolve(base))) {
      responde(res, 403, { erro: 'caminho fora do diretório de arquivos estáticos' });
      return;
    }
    if (!fs.existsSync(alvo) || !fs.statSync(alvo).isFile()) {
      responde(res, 404, { erro: `arquivo '${arquivo}' não existe` });
      return;
    }
    res.writeHead(200, {
      'content-type': TIPOS[path.extname(alvo)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(fs.readFileSync(alvo));
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
   * O poller vigia 7 tabelas (`specs/_catalog/realtime-poll.yaml`); uma página
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
  #overlayDe(dash: DashboardSpec): Map<string, OverlayDeTabela> {
    const todos = this.opts.overlayRealtime();
    const recorte = new Map<string, OverlayDeTabela>();
    if (todos.size === 0) return recorte;
    const daPagina = this.tabelasPorDashboard.get(dash.id);
    for (const [tabela, ov] of todos) {
      if (daPagina === undefined || daPagina.has(tabela)) recorte.set(tabela, ov);
    }
    return recorte;
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
    const carimbo = this.identidadeAtual();
    if (this.carimboDasCarregadas !== carimbo) {
      this.carregadas.clear();
      this.cacheValoresDistintos.clear();
      // Os resultados inteiros também. A chave deles já carrega carimbo e dia, então
      // eles nunca seriam *servidos* errados — mas ficariam ocupando o orçamento até
      // o LRU chegar neles, e o orçamento é justamente o que decide o que fica.
      this.completos.limpa();
      this.carimboDasCarregadas = carimbo;
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
    this.carregadas.set(chave, promessa);
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
    const fora = new Set<string>();
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

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

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

/**
 * Marca um erro com o status HTTP que ele deve virar, preservando a mensagem.
 *
 * Nasceu com o single-flight: o cálculo saiu de dentro de `pagina()` e foi para
 * dentro de um voo compartilhado, e lá **não existe `res`** — responder 409 na
 * hora serviria um dos N pedidos e deixaria os outros pendurados. O erro tem de
 * voltar carregando o status, para que cada um responda o seu.
 *
 * As mensagens da API dizem o que fazer (o comando de snapshot que falta, o
 * formato do filtro que não decodificou); trocá-las por "HTTP 409" jogaria fora
 * justamente a parte útil, então a mensagem original é mantida intacta.
 */
function comStatus(err: unknown, status: number): Error {
  const e = err instanceof Error ? err : new Error(String(err));
  return Object.assign(e, { status });
}

function responde(res: http.ServerResponse, status: number, corpo: unknown): void {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(texto),
  });
  res.end(texto);
}

/** Compara dois segredos em tempo constante — `TOKEN_INTERNO` não é o tipo de
 *  coisa que se compara com `===` e torce para ninguém medir microssegundos. */
function tokensIguais(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * `JSON.parse` que descarta `__proto__`, `constructor` e `prototype` de
 * QUALQUER nível do objeto, via `reviver`.
 *
 * `JSON.parse` puro já não seta o protótipo de verdade a partir de
 * `{"__proto__": ...}` no texto — a especificação usa `CreateDataProperty`, não
 * o setter mágico de atribuição normal — então o resultado de hoje (só
 * `corpo.idToken`/`corpo.token` são lidos, nunca espalhados/mesclados em outro
 * objeto) já não é explorável. Esta função é a trava para o dia em que algum
 * código futuro fizer `Object.assign(alvo, corpo)` ou equivalente e essa
 * garantia deixar de valer sem ninguém perceber.
 */
function parseJsonSeguro(texto: string): unknown {
  return JSON.parse(texto, (chave, valor) => {
    if (chave === '__proto__' || chave === 'constructor' || chave === 'prototype') return undefined;
    return valor;
  });
}

/**
 * Lê o corpo de um pedido até `limiteBytes` (padrão 8 KB — um ID token do
 * Google tem ~1-2 KB; a folga é generosa sem abrir a porta para um corpo
 * gigante segurar memória). Único lugar da API que lê corpo — todo o resto é
 * `GET`/`HEAD` sem corpo nenhum.
 */
function leCorpo(req: http.IncomingMessage, limiteBytes = 8192): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    let excedeu = false;
    const partes: Buffer[] = [];
    // **`req.destroy()` aqui era o bug**: destruir o `IncomingMessage` destrói
    // o SOCKET (é a mesma conexão TCP), e a resposta 400 que `autenticaGoogle`
    // (e as outras duas) tentam mandar em seguida nunca sai — o cliente vê
    // `ECONNRESET`, não 400. A correção é rejeitar sem destruir e DRENAR o
    // resto do corpo (ignorado, nunca empilhado em `partes`, então sem custo
    // de memória) — quando `end` chegar, o socket segue saudável para a
    // resposta e, em keep-alive, para o próximo pedido também.
    req.on('data', (c: Buffer) => {
      if (excedeu) return;
      total += c.length;
      if (total > limiteBytes) {
        excedeu = true;
        reject(new Error('corpo do pedido excede o limite'));
        return;
      }
      partes.push(c);
    });
    req.on('end', () => {
      if (!excedeu) resolve(Buffer.concat(partes).toString('utf8'));
    });
    req.on('error', reject);
  });
}

/**
 * Os valores distintos de uma coluna do dataset, ordenados.
 *
 * BLANK entra na lista como `null`, e de propósito: numa coluna com vazio, "vazio" é
 * um valor que o usuário precisa poder marcar. Omiti-lo faria a soma das partes não
 * fechar com o total, sem nada na tela explicando a diferença — a pergunta #6b do
 * `PERGUNTAS-NEGOCIO.md` é exatamente essa discussão no card `CLIENTES`.
 */
function valoresDistintos(
  ev: Evaluator,
  tabela: string,
  coluna: string,
  nivel: string | null = null,
): DaxValue[] {
  // Com nível, a lista é a dos valores **do nível**: 3 anos em vez de 1.095 datas.
  // A projeção é a mesma de `filtro.ts` e do eixo de gráfico — se esta lista e o
  // predicado usassem tabelas de meses diferentes, o usuário marcaria "março" e o
  // filtro não acharia nada.
  const projeta = nivel ? projecaoDeHierarquia(nivel) : null;
  if (nivel && !projeta) {
    throw new Error(
      `Nível de hierarquia não suportado: '${tabela}'[${coluna}].[${nivel}]. ` +
        `Suportados: ${NIVEIS_DE_HIERARQUIA.join(', ')}.`,
    );
  }

  const vistos = new Map<string, DaxValue>();
  for (const row of ev.dataset.rows(tabela)) {
    const cru = ev.columnValue(tabela, coluna, row);
    // BLANK não é projetado: o vazio viraria o ano de 1970 e apareceria na lista
    // como um ano de verdade.
    const v = projeta && !isBlank(cru) && cru instanceof Date ? projeta(cru) : cru;
    // Data como chave precisa ser o instante, não o objeto: dois `Date` do mesmo
    // milissegundo são chaves diferentes num `Set`, e a lista viria com repetido.
    const chave = isBlank(v) ? '\u0000blank' : v instanceof Date ? `d${v.getTime()}` : `${typeof v}:${String(v)}`;
    if (!vistos.has(chave)) vistos.set(chave, v);
  }

  return [...vistos.values()].sort(comparaValorDeSegmentacao);
}

/**
 * A ordem em que um seletor oferece seus valores.
 *
 * **Data e número saem do MAIOR para o menor, e isso é um recorte, não estética.**
 * A lista é truncada em `teto` antes de chegar à tela; crescente, o corte jogava
 * fora exatamente a metade que interessa. Medido em 08/09/2026:
 * `CALENDARIO INSTALADO`[DATA INSTALADO] tem 713 datas distintas, a tela recebia
 * 500 e a árvore de período terminava em JUNHO/2026 — enquanto a mesma página
 * abre filtrada em AGOSTO. O mês que a tela pedia por padrão não existia na lista
 * que ela oferecia, e por fora isso é «nenhum filtro funciona».
 *
 * Texto continua em A–Z: em nome de pessoa ou de equipe é alfabético que se
 * procura, e não há «mais recente» que privilegiar.
 *
 * Função separada e exportada porque é uma DECISÃO, e decisão precisa de teste —
 * quando ela morava dentro do `sort()`, a suíte inteira passava verde com a ordem
 * trocada.
 */
export function comparaValorDeSegmentacao(a: DaxValue, b: DaxValue): number {
  // BLANK por último: é o valor menos informativo, e no topo empurraria a lista
  // inteira para baixo em toda coluna que tenha um vazio.
  if (isBlank(a)) return isBlank(b) ? 0 : 1;
  if (isBlank(b)) return -1;
  if (a instanceof Date && b instanceof Date) return b.getTime() - a.getTime();
  if (typeof a === 'number' && typeof b === 'number') return b - a;
  return String(a).localeCompare(String(b), 'pt-BR');
}

/** Um valor de segmentação com o tipo junto — a tela formata pelo tipo, não pelo formato. */
function serializaValor(v: DaxValue): { valor: unknown; tipo: ReturnType<typeof tipoDe> } {
  return {
    valor: isBlank(v) ? null : v instanceof Date ? v.toISOString() : v,
    tipo: tipoDe(v),
  };
}

/** Inteiro de query string, com piso e teto. Valor inválido cai no padrão. */
function inteiro(bruto: string | null, padrao: number, min: number, max: number): number {
  if (bruto === null) return padrao;
  const n = Number.parseInt(bruto, 10);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, n));
}
