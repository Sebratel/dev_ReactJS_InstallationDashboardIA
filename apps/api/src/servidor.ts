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
  ttlDaPagina,
  type EstadoDoCache,
} from './cache-resposta.ts';
import { identificaLocal, type Identidade } from './identidade.ts';
import {
  calculaPagina,
  segmentacaoDe,
  tipoDe,
  LINHAS_MAXIMO,
  LINHAS_PADRAO,
  type PaginaCalculada,
} from './calcula.ts';

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
   * Quem está pedindo. Padrão: `identificaLocal` — o usuário fixo de uma
   * instalação de uma pessoa só. É por aqui que o Permission Engine entra, e é a
   * única peça da Fase 4 que já custa alguma coisa depois: ver `identidade.ts`.
   */
  identifica?: (req: http.IncomingMessage) => Identidade;
}

export class Servidor {
  private readonly opts: Required<Omit<ServidorOptions, 'cache' | 'aoFalharCache'>>;
  private readonly model: SemanticModel;
  private readonly dashboards: DashboardSpec[];
  /** De onde saem os TTLs — `specs/_catalog/cache-policies.yaml`, já decididos. */
  private readonly registry: QueryRegistry;
  private readonly cache: CacheDeResposta;
  /** Qual adapter está ligado. Sai em `GET /api/saude` — sem isso não há como
   * saber, olhando um servidor de fora, se o Redis entrou ou se caiu no padrão. */
  private readonly tipoDeCache: string;
  /** Página → avaliador carregado. A promessa entra no mapa **antes** de resolver,
   * para que dois pedidos simultâneos da mesma página não carreguem duas vezes. */
  private readonly carregadas = new Map<string, Promise<Carregado>>();
  /** O carimbo do snapshot que `carregadas` reflete. Mudou? O mapa inteiro é lixo. */
  private carimboDasCarregadas: string | null = null;

  constructor(opts: ServidorOptions) {
    const { cache, aoFalharCache, ...resto } = opts;
    this.opts = { agora: () => new Date(), identifica: identificaLocal, ...resto };
    this.model = SemanticModel.fromSpecsDir(path.join(opts.root, 'specs'));
    this.dashboards = loadDashboards(path.join(opts.root, 'specs'));
    this.registry = QueryRegistry.fromSpecsDir(path.join(opts.root, 'specs'));
    const adapter = cache ?? new MemoryCache();
    this.tipoDeCache = adapter.constructor.name;
    this.cache = new CacheDeResposta({
      cache: adapter,
      ...(aoFalharCache ? { aoFalhar: aoFalharCache } : {}),
    });
  }

  /** O `http.Server`, sem escutar porta nenhuma — quem escuta é o `index.ts`. */
  criaHttp(): http.Server {
    return http.createServer((req, res) => {
      this.atende(req, res).catch((err: unknown) => {
        responde(res, 500, { erro: err instanceof Error ? err.message : String(err) });
      });
    });
  }

  private async atende(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      responde(res, 405, {
        erro: `Método ${req.method} não existe nesta API. A plataforma é somente ` +
          `leitura: nenhuma rota escreve em fonte nenhuma.`,
      });
      return;
    }

    // Quem está pedindo, resolvido uma vez e no começo. Hoje é sempre `local` e
    // não muda resposta nenhuma — é a costura por onde o Permission Engine entra,
    // e ela já é load-bearing num ponto: a chave do cache carrega o usuário, para
    // que nenhum recorte futuro possa ser servido para a pessoa errada.
    const quem = this.opts.identifica(req);

    const url = new URL(req.url ?? '/', 'http://localhost');
    const rota = url.pathname.replace(/\/+$/, '') || '/';

    if (rota === '/api/saude') return this.saude(res);
    if (rota === '/api/dashboards') return this.lista(res);
    if (rota.startsWith('/api/dashboards/')) {
      // `<id>` ou `<id>/valores`. O `id` é decodificado depois do corte: há página
      // com acento, e decodificar antes faria um `%2F` no nome virar separador.
      const resto = rota.slice('/api/dashboards/'.length);
      const barra = resto.indexOf('/');
      const id = decodeURIComponent(barra === -1 ? resto : resto.slice(0, barra));
      const sub = barra === -1 ? '' : resto.slice(barra + 1);

      if (sub === '') return this.pagina(res, id, url, quem);
      if (sub === 'valores') return this.valores(res, id, url, quem);
      responde(res, 404, {
        erro: `'${sub}' não existe em /api/dashboards/${id}. As sub-rotas: valores.`,
      });
      return;
    }
    if (rota.startsWith('/api/')) {
      responde(res, 404, { erro: `Rota '${rota}' não existe. Veja GET /api/saude.` });
      return;
    }
    this.estatico(res, rota);
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
      cache: { adapter: this.tipoDeCache },
    });
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

    // `?visual=<id>` — o pedido de um visual **sob demanda**. Ver
    // `specs/_catalog/projecao.yaml`: a página abre sem as colunas caras, e este é o
    // caminho por onde elas entram, uma de cada vez e só para quem pediu.
    const soVisual = url.searchParams.get('visual');
    if (soVisual !== null && !(dash.visuals ?? []).some((v) => v.id === soVisual)) {
      responde(res, 404, {
        erro: `Visual '${soVisual}' não existe na página '${id}'.`,
      });
      return;
    }

    // --------------------------------------------------------------- cache
    // Antes de `carrega`, de propósito: num acerto o pedido não abre o snapshot,
    // não materializa tabela calculada e não roda o avaliador. É esse pulo que
    // cabe nos 300 ms da regra 9 — recalcular e só economizar a serialização não
    // caberia.
    const ttl = ttlDaPagina(this.queriesDe(dash), this.registry);
    const chave = chaveDaResposta({
      usuario: quem.usuario,
      pagina: dash.id,
      filtros: daTela,
      visual: soVisual,
      de,
      linhas,
      carimbo: this.carimboAtual(),
    });

    if (ttl > 0) {
      const guardado = await this.cache.le<object>(chave);
      if (guardado !== undefined) {
        responde(res, 200, { ...guardado, cache: 'hit' satisfies EstadoDoCache });
        return;
      }
    }

    let carregado: Carregado;
    try {
      carregado = await this.carrega(dash, soVisual);
    } catch (err) {
      // Snapshot faltando é o erro esperado, e a mensagem de `carrega` já traz o
      // comando. 409: o pedido está certo, o estado do servidor é que não está.
      // **Não vai para o cache**: guardar um 409 faria o pedido seguinte falhar por
      // TTL inteiro depois de o snapshot já existir.
      responde(res, 409, { erro: err instanceof Error ? err.message : String(err) });
      return;
    }

    // Com `?visual=`, calcula só ele: o pedido sob demanda existe para mostrar uma
    // tabela cara, não para recalcular os outros 38 visuais que a página já mostrou.
    const visuais = soVisual === null
      ? (dash.visuals ?? [])
      : (dash.visuals ?? []).filter((v) => v.id === soVisual);

    // O filtro da tela entra como filtro **de página**, que é o escopo de uma
    // segmentação no Power BI: ela recorta todos os visuais da página, não só um.
    // Entrando aqui, ele atravessa `traduzFiltros` no mesmo `with()` dos filtros que
    // já vinham da spec — nenhuma engine sabe que ele veio de uma URL.
    const alvo: DashboardSpec = {
      ...dash,
      visuals: visuais,
      filters: [...(dash.filters ?? []), ...daTela],
    };

    const pagina: PaginaCalculada = calculaPagina(alvo, carregado.ev, { de, linhas });
    const corpo = {
      ...pagina,
      dadoDe: carregado.dadoDe,
      omitidas: carregado.omitidas,
      // O que a tela mandou, de volta: sem isto não há como conferir, olhando a
      // resposta, se o número está filtrado pelo que a tela acha que mandou.
      filtrosDaTela: daTela.map((f) => ({
        tabela: f.entity,
        coluna: f.property,
        // O nível vai junto: sem ele não dá para distinguir, olhando a resposta, um
        // filtro pelo **ano** de uma data de um filtro pela data crua — e os dois
        // produzem números diferentes sobre a mesma coluna.
        ...(f.nivel ? { nivel: f.nivel } : {}),
        valores: f.conditions[0]?.op === 'in' ? f.conditions[0].values : [],
      })),
      tabelas: [...carregado.linhasPorTabela].map(([nome, n]) => ({ nome, linhas: n })),
    };

    // O corpo vai para o cache **sem** o campo `cache`: ele descreve o pedido, não a
    // resposta, e congelá-lo como `miss` faria todo acerto se anunciar como falha.
    await this.cache.guarda(chave, corpo, ttl);
    responde(res, 200, {
      ...corpo,
      cache: (ttl > 0 ? 'miss' : 'desligado') satisfies EstadoDoCache,
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
      return s !== undefined && s.naoFiltra === undefined
        && normalizeName(s.tabela) === normalizeName(tabela)
        && normalizeName(s.coluna) === normalizeName(coluna)
        && normalizeName(s.nivel ?? '') === normalizeName(nivel ?? '');
    });
    if (!permitida) {
      responde(res, 404, {
        erro: `'${tabela}'[${coluna}] não é a coluna de nenhuma segmentação de '${id}'. ` +
          `Esta rota lista valor de segmentação, não de coluna qualquer.`,
      });
      return;
    }

    let carregado: Carregado;
    try {
      carregado = await this.carrega(dash);
    } catch (err) {
      responde(res, 409, { erro: err instanceof Error ? err.message : String(err) });
      return;
    }

    const teto = inteiro(url.searchParams.get('teto'), VALORES_PADRAO, 1, VALORES_MAXIMO);
    let distintos: DaxValue[];
    try {
      distintos = valoresDistintos(carregado.ev, tabela, coluna, nivel);
    } catch (err) {
      // Nível que a projeção não conhece. 400: o pedido está errado, não o estado.
      responde(res, 400, { erro: err instanceof Error ? err.message : String(err) });
      return;
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
  private carrega(dash: DashboardSpec, soVisual: string | null = null): Promise<Carregado> {
    const libera = soVisual === null ? [] : this.sobDemandaDoVisual(dash, soVisual);
    const chave = libera.length === 0 ? dash.id : `${dash.id}\u0000${[...libera].sort().join(',')}`;

    // **O snapshot mudou embaixo? Então o avaliador guardado é lixo.** Este mapa só
    // era limpo em erro, e a promessa do comentário do topo ("quem refaz é `npm run
    // snapshot`, e aí o processo é reiniciado") deixa de valer no dia em que o
    // aquecimento roda junto do refresh: a API serviria o dado antigo até alguém
    // lembrar de reiniciar. O carimbo é o mesmo do cache de resposta, então as duas
    // camadas enxergam a troca no mesmo instante.
    const carimbo = this.carimboAtual();
    if (this.carimboDasCarregadas !== carimbo) {
      this.carregadas.clear();
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
   */
  private carimboAtual(): string {
    return carimboDoSnapshot(
      leManifesto(this.opts.snapshotDir),
      carimboDasCalculadas(this.opts.snapshotDir),
    );
  }

  /**
   * As colunas sob demanda que **este** visual amarra — e só elas.
   *
   * Pedir um visual não libera o texto livre da base inteira: libera as colunas que
   * aquele visual mostra. É o que mantém o custo do pedido proporcional ao que ele
   * entrega.
   */
  private sobDemandaDoVisual(dash: DashboardSpec, visualId: string): string[] {
    const v = (dash.visuals ?? []).find((x) => x.id === visualId);
    if (!v) return [];
    const declaradas = new Map(
      this.model.sobDemanda.map((s) => [
        normalizeName(rotuloDeColuna(s.tabela, s.coluna)),
        rotuloDeColuna(s.tabela, s.coluna),
      ]),
    );
    const fora = new Set<string>();
    for (const c of v.fields ?? []) {
      if (c.kind === 'measure' || !c.entity || !c.property) continue;
      const r = declaradas.get(normalizeName(rotuloDeColuna(c.entity, c.property)));
      if (r) fora.add(r);
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

function responde(res: http.ServerResponse, status: number, corpo: unknown): void {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(texto),
  });
  res.end(texto);
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
