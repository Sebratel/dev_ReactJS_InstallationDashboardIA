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
import { leManifesto, maisAntigo } from '../../../packages/snapshot/src/manifesto.ts';
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
import {
  calculaPagina,
  segmentacaoDe,
  tipoDe,
  LINHAS_MAXIMO,
  LINHAS_PADRAO,
  type PaginaCalculada,
} from './calcula.ts';
import { carregaLayout } from '../../../tools/layout/src/valida.ts';
import type { LayoutSpec } from '../../../tools/layout/src/schema.ts';
import { leStatus, montaStatusDeRefresh } from '../../../tools/refresh/src/status.ts';
import { PiscinaWorkers } from './piscina-workers.ts';
import { linhasDoOverlay, mescladoresDe, type OverlayDeTabela } from './overlay-realtime.ts';
import { Metricas, origemDoPedido, type OrigemDoPedido } from './metricas.ts';
import { VooUnico, type Voo } from './voo-unico.ts';
import { redisAusente, type EstadoDoRedis } from './saude-do-redis.ts';


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
   * Segredo compartilhado (`.env`, `TOKEN_INTERNO`) que libera `POST
   * /auth/interno` — a única forma de uma ferramenta de linha de comando
   * (hoje: `tools/tela`, que dirige um navegador de verdade) logar sem conta
   * do Google. Vazio (padrão) desliga a rota inteira: nenhum token, nem o
   * certo, autentica — falha fechada, igual ao `googleClientId` vazio.
   */
  tokenInterno?: string;
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
  /** Instância ou opção para a piscina de worker threads. */
  piscinaWorkers?: PiscinaWorkers;
}

export class Servidor {
  private readonly piscina: PiscinaWorkers;

  // `piscinaWorkers` entra no Omit porque o construtor a desestrutura FORA de
  // `resto` (vira `this.piscina`) — sem ela aqui, o tipo exige um padrão que
  // nunca é escrito e o compilador acusa a linha errada.
  private readonly opts: Required<
    Omit<ServidorOptions, 'cache' | 'aoFalharCache' | 'verificadorGoogle' | 'piscinaWorkers'>
  >;
  /** Substitui o `OAuth2Client` real em teste. `undefined` em produção — ver
   *  `auth-google.ts`. Fica fora de `this.opts` porque não tem um valor
   *  "padrão" que faça sentido preencher, diferente dos outros campos. */
  private readonly verificadorGoogle: VerificadorDeToken | undefined;
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

  /** `setInterval` do batimento. Só existe enquanto houver assinante. */
  private batimentoSSE: NodeJS.Timeout | null = null;
  /** Cache do carimbo em memória para evitar fs.readFileSync por pedido HTTP no hot-path. */
  private carimboMemo: string | null = null;
  private watcherSnapshot: fs.FSWatcher | null = null;

  constructor(opts: ServidorOptions) {
    const { cache, aoFalharCache, verificadorGoogle, piscinaWorkers, ...resto } = opts;
    this.piscina = piscinaWorkers ?? new PiscinaWorkers({ desativado: process.env.NODE_ENV === 'test' });
    this.verificadorGoogle = verificadorGoogle;

    this.opts = {
      agora: () => new Date(),
      identifica: (req) => identificaPorSessao(this.sessoes, req),
      aquecimento: () => ({ ativo: false, pronto: false }),
      tetoDeVisuaisMB: TETO_PADRAO_MB,
      googleClientId: '',
      dominioCorporativo: 'sebratel.com.br',
      sessaoTtlHoras: 12,
      tokenInterno: '',
      batimentoSseMs: Servidor.BATIMENTO_SSE_MS,
      overlayRealtime: () => new Map(),
      estadoDoRedis: redisAusente,
      ...resto,
    };
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

  /** O `http.Server`, sem escutar porta nenhuma — quem escuta é o `index.ts`. */
  criaHttp(): http.Server {
    return http.createServer((req, res) => {
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
        responde(res, 500, { erro: err instanceof Error ? err.message : String(err) });
      });
    });
  }

  destroi(): void {
    if (this.watcherSnapshot) {
      this.watcherSnapshot.close();
      this.watcherSnapshot = null;
    }
    this.desligaBatimento();
    this.piscina.destroi();
  }


  private async atende(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const rota = url.pathname.replace(/\/+$/, '') || '/';

    // Autenticação: as ÚNICAS rotas que aceitam POST, e as únicas que criam ou
    // apagam estado (sessão) em vez de servir dado calculado. Ficam ANTES de
    // qualquer outra guarda — pedir login não pode exigir já estar logado, e
    // a guarda de método abaixo é justamente o que barraria um POST.
    if (rota === '/auth/google' && req.method === 'POST') return this.autenticaGoogle(req, res);
    if (rota === '/auth/interno' && req.method === 'POST') return this.autenticaInterno(req, res);
    if (rota === '/auth/logout' && req.method === 'POST') return this.logout(req, res);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD, POST');
      responde(res, 405, {
        erro: `Método ${req.method} não existe nesta rota. A API é somente leitura ` +
          `— as únicas exceções são POST /auth/google, /auth/interno e /auth/logout.`,
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
        (!this.opts.googleClientId
          ? { usuario: 'dev-local', papeis: ['autenticado'] }
          : null);

    if (rota.startsWith('/api/')) {
      if (!quem) {
        responde(res, 401, { erro: 'Sessão inválida ou ausente. Faça login em /auth/google.' });
        return;
      }
      if (rota === '/api/dashboards') return this.lista(res);
      if (rota === '/api/eventos') return this.eventos(req, res);
      if (rota.startsWith('/api/dashboards/')) {
        // `<id>` ou `<id>/valores`. O `id` é decodificado depois do corte: há página
        // com acento, e decodificar antes faria um `%2F` no nome virar separador.
        const resto = rota.slice('/api/dashboards/'.length);
        const barra = resto.indexOf('/');
        const id = decodeURIComponent(barra === -1 ? resto : resto.slice(0, barra));
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

  private async autenticaGoogle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let corpo: unknown;
    try {
      corpo = JSON.parse(await leCorpo(req));
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
    res.setHeader('Set-Cookie', cookieDeSessao(token, this.opts.sessaoTtlHoras));
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
      corpo = JSON.parse(await leCorpo(req));
    } catch {
      responde(res, 400, { erro: 'Corpo inválido — esperado JSON com { token }.' });
      return;
    }
    const token = (corpo as { token?: unknown } | null)?.token;
    if (!this.opts.tokenInterno || typeof token !== 'string' || !tokensIguais(token, this.opts.tokenInterno)) {
      responde(res, 401, { erro: 'Token interno inválido, ou TOKEN_INTERNO não configurado neste ambiente.' });
      return;
    }
    const sessao = criaSessao(this.sessoes, 'ferramenta-interna', this.opts.sessaoTtlHoras);
    res.setHeader('Set-Cookie', cookieDeSessao(sessao, this.opts.sessaoTtlHoras));
    responde(res, 200, { usuario: 'ferramenta-interna' });
  }

  private logout(req: http.IncomingMessage, res: http.ServerResponse): void {
    apagaSessaoDoPedido(this.sessoes, req);
    res.setHeader('Set-Cookie', cookieDeSessao('', 0));
    responde(res, 200, { ok: true });
  }

  // ------------------------------------------------------------------- rotas

  private saude(res: http.ServerResponse): void {
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
      realtime: {
        ...this.metricas.instantaneo(),
        sseAbertas: this.assinantesSSE.size,
        piscina: this.piscina.estado,
        overlayTabelas: this.opts.overlayRealtime().size,
      },
      // `leStatus` nunca lança (arquivo ausente ou corrompido viram `{}`) — mas
      // `/api/saude` não pode cair por causa de um operador de refresh que nunca
      // rodou nesta máquina, então o try/catch fica aqui também, defesa em
      // profundidade. Rota de operador, não caminho quente: um `readFileSync` a
      // mais aqui não paga o mesmo preço que pagaria em `carimboAtual()`.
      refresh: this.statusDeRefresh(),
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
   */
  aoTabelaMudar(tabela: string, queryId: string): void {
    this.carimboMemo = null;
    const afetados = [...this.queriesPorDashboard]

      .filter(([, queries]) => queries.includes(queryId))
      .map(([id]) => id);
    if (afetados.length === 0) return;

    for (const dashId of afetados) {
      for (const chave of [...this.carregadas.keys()]) {
        if (chave === dashId || chave.startsWith(`${dashId}\u0000`)) this.carregadas.delete(chave);
      }
      this.completos.limpaPagina(dashId);
      // Efeito colateral, não parte de resposta nenhuma — não há pedido para
      // atrasar esperando o Redis, e `apagaPagina` já nunca lança.
      void this.cache.apagaPagina(dashId);
    }
    console.error(`[poller] ${tabela} mudou — invalidando ${afetados.join(', ')}`);
    this.emiteEvento(afetados);
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
    const carimbo = this.carimboAtual();
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
      carimbo,
      dia,
    });

    // De onde veio este pedido. Ainda NÃO muda prioridade nenhuma — a fila da
    // piscina continua FIFO nesta fase. Serve para medir quanto do trabalho é de
    // fundo antes de escolher a política que vai reordená-la (`metricas.ts`).
    const origem: OrigemDoPedido = origemDoPedido(
      quem.usuario === 'aquecedor-interno',
      url.searchParams.get('origem'),
    );
    this.metricas.conta(`pedidos_${origem}`);

    if (ttl > 0 && !recalcula) {
      const guardado = await this.cache.le<object>(chave);
      if (guardado !== undefined) {
        this.metricas.conta('cache_hits');
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
          const tWorker = Date.now();
          try {
            const workerRes = await this.piscina.executa({
              snapshotDir: this.opts.snapshotDir,
              specsDir: path.join(this.opts.root, 'specs'),
              dashboardSpec: alvo,
              janela: { de, linhas },
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
            });
            this.metricas.observa('worker_ms', Date.now() - tWorker);
            paginaCalculada = workerRes.pagina as PaginaCalculada;
            dadoDe = workerRes.dadoDe ?? null;
            omitidas = workerRes.omitidas ?? [];
            tabelasResumo = (workerRes.linhasPorTabela ?? []).map(([nome, n]) => ({ nome, linhas: n }));
          } catch {
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
            paginaCalculada = calculaPagina(alvo, carregado.ev, { de, linhas }, undefined, undefined, clicados);
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

          paginaCalculada = calculaPagina(alvo, carregado.ev, { de, linhas }, undefined, memo, clicados);
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
      });
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

  /**
   * A identidade do que está em disco **agora**: manifesto mais tabelas calculadas.
   *
   * Uma função só, usada pelas duas camadas de cache. Duas contas separadas para a
   * "mesma" identidade divergiriam no primeiro arquivo que uma delas não olhasse — e
   * foi exatamente assim que os `calc.*.jsonl` ficaram de fora do carimbo.
   *
   * **Isto custa 0,57 ms por pedido e fica assim.** É o maior custo fixo de um
   * acerto de cache — mais que serializar uma página de 96 KB —, quase todo em
   * `leManifesto` (ler o arquivo e fazer `JSON.parse`). A tentação de memoizá-lo
   * atrás de uma conferência barata é óbvia, e foi tentada em 17/08/2026: guardar o
   * carimbo e só recalculá-lo quando `mtime` e tamanho do manifesto mudassem.
   *
   * **Não funciona, e o teste provou antes de o código sair daqui.** Reescrever o
   * manifesto trocando só a hora de `geradoEm` não muda um byte do tamanho — a data
   * tem largura fixa —, então sobra o `mtime` para separar as duas versões. E o
   * `mtime` desta máquina tem granularidade medida de **~2,45 ms** (4.000 escritas,
   * 265 carimbos de tempo distintos): duas reescritas dentro dessa janela são
   * indistinguíveis. O memo devolveria o carimbo velho, a chave da resposta apontaria
   * para a resposta anterior ao refresh, e a tela mostraria o número de antes sem
   * nada dizendo que era de antes.
   *
   * 0,4 ms não compra um modo de desatualização silenciosa. A economia equivalente
   * está no corpo pré-serializado do cache, que não custa exatidão nenhuma.
   */
  private iniciaWatcherSnapshot(): void {
    if (this.watcherSnapshot) return;
    if (fs.existsSync(this.opts.snapshotDir)) {
      try {
        this.watcherSnapshot = fs.watch(this.opts.snapshotDir, () => {
          this.carimboMemo = null;
        });
        this.watcherSnapshot.unref();
      } catch {
        // Fallback silencioso se fs.watch não for suportado
      }
    }
  }


  private carimboAtual(): string {
    this.iniciaWatcherSnapshot();
    if (this.carimboMemo !== null) return this.carimboMemo;

    const val = carimboDoSnapshot(
      leManifesto(this.opts.snapshotDir),
      carimboDasCalculadas(this.opts.snapshotDir),
    );
    this.carimboMemo = val;
    return val;
  }


  /**
   * A identidade completa do que a API responderia agora: o dado em disco e o dia.
   *
   * **Pública porque o aquecedor precisa dela**, e precisa dela *exatamente* como as
   * duas camadas de cache a calculam. Um aquecedor que vigiasse só o carimbo dormiria
   * na virada da meia-noite — que é justamente o instante em que o cache inteiro fica
   * inalcançável de uma vez, pelas 32 chamadas a `TODAY()`. A tela do primeiro
   * expediente é a que pagaria.
   */
  identidadeAtual(): string {
    return identidadeDoCalculo(this.carimboAtual(), diaDoCalculo(this.opts.agora()));
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
 * Lê o corpo de um pedido até `limiteBytes` (padrão 8 KB — um ID token do
 * Google tem ~1-2 KB; a folga é generosa sem abrir a porta para um corpo
 * gigante segurar memória). Único lugar da API que lê corpo — todo o resto é
 * `GET`/`HEAD` sem corpo nenhum.
 */
function leCorpo(req: http.IncomingMessage, limiteBytes = 8192): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const partes: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > limiteBytes) {
        req.destroy();
        reject(new Error('corpo do pedido excede o limite'));
        return;
      }
      partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
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

  return [...vistos.values()].sort((a, b) => {
    // BLANK por último: é o valor menos informativo, e no topo empurraria a lista
    // inteira para baixo em toda coluna que tenha um vazio.
    if (isBlank(a)) return isBlank(b) ? 0 : 1;
    if (isBlank(b)) return -1;
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), 'pt-BR');
  });
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
