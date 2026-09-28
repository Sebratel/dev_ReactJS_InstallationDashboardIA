#!/usr/bin/env node
// `npm run api` — sobe a API de leitura e a tela.
//
// Não busca nada de fonte: lê o `snapshot/` que `npm run snapshot` deixou em
// disco. Sem snapshot ela sobe do mesmo jeito e `GET /api/saude` diz o que falta —
// morrer no arranque só esconderia a mensagem.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv, loadConfig, missingFor } from '../../../packages/query-engine/src/config.ts';
import { CacheEmCamadas } from '../../../packages/query-engine/src/cache-camadas.ts';
import { MemoryCache } from '../../../packages/query-engine/src/cache-memory.ts';
import { RedisCache } from '../../../packages/query-engine/src/cache-redis.ts';
import { CacheComDisjuntor } from '../../../packages/query-engine/src/cache-disjuntor.ts';
import { createVoallePool } from '../../../packages/query-engine/src/connectors-sql.ts';
import type { Cache } from '../../../packages/query-engine/src/types.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { Agendador, agendaNesteProcesso } from './agendador.ts';
import { fechaHttp, instalaDesligamento } from './desligamento.ts';
import { instalaGuardaDeProcesso } from './guarda-de-processo.ts';
import { iniciaVigiaDeTravamento, limiteDoAmbiente, type Vigia } from './vigia-travamento.ts';
import { Aquecedor } from './aquecedor.ts';
import { PollerRealtime } from './poller-realtime.ts';
import { SaudeDoRedis, semSegredo } from './saude-do-redis.ts';
import { comoLiberar } from './porta.ts';
import { decideLogin } from './portao-login.ts';
import { Servidor } from './servidor.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(AQUI, '..', '..', '..');
applyDotEnv(ROOT);

/**
 * O Redis, se houver `REDIS_URL` — **na frente dele, sempre a memória**.
 *
 * **Sem ele a API sobe igual.** Trocar isso por uma dependência de arranque
 * transformaria uma otimização em motivo de a tela não abrir.
 *
 * **E com ele a API não fica mais lenta**, que é o que aconteceria na versão
 * anterior desta função. Ela devolvia o `RedisCache` **no lugar** do `MemoryCache`,
 * e ligar o Redis teria feito cada acerto pagar uma ida e volta de rede mais um
 * `JSON.parse` de até 172 KB, no lugar de uma leitura de `Map`. As duas camadas
 * resolvem coisas diferentes: a memória dá a latência, o Redis dá a permanência
 * (sobreviver ao restart, e ser compartilhado entre processos). Ver
 * `cache-camadas.ts`.
 *
 * O `import` é dinâmico porque `ioredis` abre conexão ao ser instanciado, e quem
 * roda sem `REDIS_URL` não deve pagar nem por carregar o driver.
 */
/**
 * O disjuntor da camada durável, para `GET /api/saude` poder dizer que ele
 * abriu. `null` sem `REDIS_URL` — que é a verdade de todo `npm run api` local.
 */
let disjuntorDoCache: CacheComDisjuntor | null = null;

async function cacheDaEnv(saude: SaudeDoRedis): Promise<Cache | undefined> {
  const url = process.env.REDIS_URL;
  if (!url) return undefined;
  try {
    const { Redis } = await import('ioredis');
    // `lazyConnect`: a conexão sai na primeira operação, não no arranque. Um Redis
    // fora do ar vira miss em `CacheDeResposta`, e não uma exceção aqui.
    // **Os tempos, e por que eles são estes.** O padrão do ioredis para
    // `connectTimeout` é 10 s. Com o Redis inalcançável, TODA operação de cache
    // de TODO pedido pagava esse tempo antes de virar miss — medido em
    // 08/09/2026 no caminho real, trocar um filtro passava de 1,6 s para
    // 13–20 s, com /api/saude respondendo `ok` o tempo inteiro. A API degradava
    // certo e degradava de um jeito que torna o produto inutilizável.
    //
    // Um cache de leitura que demora mais que o recálculo não é cache: 300 ms é
    // mais do que qualquer acerto legítimo precisa (os medidos ficam abaixo de
    // 10 ms) e menos do que qualquer usuário aceita esperar por nada.
    //
    // `enableOfflineQueue: false` fecha a última porta: sem ele o driver ENFILEIRA
    // comandos enquanto está desconectado, e o pedido espera na fila em vez de
    // falhar na hora.
    const cliente = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 500,
      commandTimeout: 300,
      enableOfflineQueue: false,
    });
    // **E este ouvinte é o que faz a promessa acima ser verdade.** Sem ele, o
    // `ioredis` emite `'error'` num `EventEmitter` sem ouvinte, e o Node
    // transforma isso em exceção não tratada: o processo MORRE. Não é hipótese —
    // aconteceu nesta máquina em 08/09/2026, com o Redis do compose de pé mas
    // com a porta inalcançável:
    //
    //     [ioredis] Unhandled error event: AggregateError [ECONNREFUSED]
    //     (e a API, que tinha subido e respondido, parou de responder)
    //
    // Todo o resto do caminho já degrada certo — `CacheEmCamadas.aoFalhar`, o
    // `try/catch` de `CacheDeResposta`, a memória na frente do Redis. Quem
    // derrubava era o evento solto do driver, antes de qualquer um deles.
    //
    // Com single-flight (F2) o estrago de um crash cresce: o processo leva
    // consigo os N pedidos que dividiam cada voo, não um.
    //
    // O log sai só na TRANSIÇÃO. Um Redis inalcançável emite `'error'` a cada
    // tentativa de reconexão do driver — em segundos isso vira centenas de
    // linhas idênticas, e a linha que importava (a primeira) fica soterrada. A
    // contagem inteira continua visível em `GET /api/saude`, que é onde ela
    // responde algo que o log não responde: se está caído agora, ou piscando.
    cliente.on('error', (err: unknown) => {
      if (saude.falhou('conexão', err)) {
        console.error(
          `[cache] Redis indisponível (a memória continua servindo): ` +
            `${semSegredo(err instanceof Error ? err.message : String(err))}`,
        );
      }
    });
    cliente.on('ready', () => {
      if (saude.conectou()) console.log('[cache] Redis conectado.');
    });
    // **Abre a conexão AGORA, e não na primeira operação.** Medido em 16/09/2026
    // contra um Redis saudável (servidor RESP de mentira, as opções exatas daqui):
    // com `lazyConnect` sozinho as TRÊS primeiras operações falham com
    // *"Stream isn't writeable and enableOfflineQueue options is false"*, porque
    // `lazyConnect` apenas INICIA a conexão na primeira operação e
    // `enableOfflineQueue: false` recusa todo comando enquanto o status é
    // `connecting`. Da quarta em diante funciona.
    //
    // Três é exatamente `LIMITE_PADRAO` do disjuntor. Ou seja, sem esta linha um
    // Redis **em pleno funcionamento** abria o disjuntor por 10 s a cada arranque
    // da API e imprimia "Redis desligado do caminho por 10s após 3 falhas
    // seguidas" — acusando um serviço que estava bom, e deixando `/api/saude`
    // relatar degradação que não existia. Um alarme que dispara sozinho todo boot
    // é pior que nenhum: ensina a ignorá-lo.
    //
    // O `catch` vazio não engole diagnóstico: um Redis fora do ar emite `'error'`
    // no ouvinte acima, que é quem loga e alimenta `/api/saude`. Aqui o `catch`
    // existe só para a rejeição não virar exceção não tratada — e a promessa não
    // é esperada de propósito: o arranque da API não deve depender do Redis.
    void cliente.connect().catch(() => {});
    // **O disjuntor entre a camada durável e o driver.** Os tempos apertados
    // acima reduzem o custo de UMA operação contra um Redis fora do ar; o
    // disjuntor tira o custo REPETIDO. Depois de 3 falhas seguidas ele para de
    // tocar no Redis por 10 s e devolve miss na hora, e então deixa uma sondar.
    // Sem ele, 300 ms de espera vezes as operações de cada pedido continuariam
    // aparecendo como lentidão sem causa visível.
    disjuntorDoCache = new CacheComDisjuntor(new RedisCache(cliente));
    return new CacheEmCamadas({
      rapida: new MemoryCache(),
      duravel: disjuntorDoCache,
      // O outro caminho de falha, e ele não é redundante com o `'error'` acima:
      // um Redis que ACEITA conexão e recusa comando (memória cheia, `AUTH`
      // errado, timeout de comando) não emite `'error'` nenhum no cliente — e do
      // ponto de vista de quem esperava cache é a mesma falha.
      aoFalhar: (op, err) => {
        if (saude.falhou(op, err)) {
          console.error(
            `[cache] Redis falhou em ${op} (a memória continua servindo): ` +
              `${semSegredo(err instanceof Error ? err.message : String(err))}`,
          );
        }
      },
    });
  } catch (err) {
    // `REDIS_URL` posta e driver que não carrega é degradação também, e tem de
    // aparecer na saúde — senão o operador vê `status: "ausente"` e conclui que
    // esqueceram de configurar, quando na verdade a configuração está lá.
    saude.falhou('driver', err);
    console.error(
      `[cache] REDIS_URL existe mas o driver não subiu (seguindo em memória): ` +
        `${semSegredo(err instanceof Error ? err.message : String(err))}`,
    );
    return undefined;
  }
}

const saudeRedis = new SaudeDoRedis();
const cache = await cacheDaEnv(saudeRedis);
const porta = Number.parseInt(process.env.PORT ?? '3100', 10);

/**
 * O portão de login FALHA FECHADO. A regra e o porquê estão em
 * `portao-login.ts` — inclusive o defeito medido que a criou (04/09/2026: a
 * stack de produção subia com `GOOGLE_CLIENT_ID` vazia e respondia 200 para
 * `/api/dashboards/*` sem sessão nenhuma, servindo CLIENTE e TELEFONE).
 */
const decisao = decideLogin(process.env, process.argv);
if (decisao.tipo === 'recusa') {
  console.error(decisao.mensagem);
  process.exit(1);
}
const semLogin = decisao.semLogin;

/**
 * Teto do cache de resultado inteiro por visual, em MB. `CACHE_VISUAL_MB=0` desliga.
 *
 * Existe como saída de emergência, não como afinação: numa máquina apertada é melhor
 * a paginação recalcular do que a API morrer sem memória. Ver `cache-visual.ts`.
 */
const tetoDeVisuaisMB = process.env.CACHE_VISUAL_MB
  ? Number.parseInt(process.env.CACHE_VISUAL_MB, 10)
  : undefined;

/**
 * O aquecedor só nasce depois do `listen` — ele precisa da porta. Até lá a saúde
 * responde "desligado", que é a verdade naquele instante.
 */
let aquecedor: Aquecedor | null = null;

/**
 * Declarado aqui em cima, e não junto do `aquecedor.inicia()` lá embaixo,
 * porque o `Servidor` precisa saber disto **no construtor**: com o aquecimento
 * desligado não há quem reaqueça, e passar um `reaquece` que não reaquece só
 * encheria a saúde de `rewarm_pedidos` que nunca viram página quente.
 */
const semAquecer = process.argv.includes('--sem-aquecer') || process.env.SEM_AQUECER === '1';

/**
 * Quem dá cadência ao snapshot a partir de 19/09/2026: **esta API, no próprio
 * processo** (`agendador.ts`).
 *
 * Antes eram três camadas empilhadas — tarefa do Agendador de Tarefas do Windows ->
 * `npm start` -> daemon num processo à parte — e a primeira é configuração de
 * MÁQUINA, não do repositório: enquanto ela não estivesse registrada naquele Windows,
 * um reboot deixava tudo parado sem nada acender (ACHADOS #129).
 *
 * `AUTO_REFRESH=false` / `--sem-refresh` desliga, e é o que o `docker-compose.prod.yml`
 * usa no serviço `api`: lá quem materializa é o container `refresh`, com `mem_limit`
 * próprio, porque um pico de 8 GB de materialização dentro do teto de 6 GB da API
 * seria OOM kill da tela. Dois agendadores ao mesmo tempo NÃO podem existir: os dois
 * escreveriam o mesmo `manifesto.json`.
 */
/**
 * A rede de segurança do processo, instalada ANTES de qualquer coisa que possa
 * lançar — inclusive antes do `listen`.
 *
 * **Ela fecha um buraco medido.** O `snapshot/refresh-historico.log` registrou em
 * 18/09/2026 `api-morreu, codigo: 1, depois de 1125 s no ar`: código 1 em Node é
 * exceção não tratada, e era tudo que ficava — nem a mensagem, nem a pilha. A
 * operação ficou sem painel e não houve como dizer por quê.
 *
 * Desde que a cadência do refresh passou a viver DENTRO deste processo
 * (`agendador.ts`), o custo de uma exceção solta subiu: antes ela derrubava um daemon
 * separado, hoje derruba a tela. Ver o cabeçalho de `guarda-de-processo.ts` para por
 * que esta API sobrevive a um erro solto em vez de sair, e por que ela AINDA sai numa
 * rajada.
 */
const estadoDaGuarda = instalaGuardaDeProcesso({ snapshotDir: path.join(ROOT, DIRETORIO_PADRAO) });

const decisaoDoRefresh = agendaNesteProcesso(process.env, process.argv);

/** Igual ao `aquecedor`: só nasce depois do `listen`, e a saúde diz a verdade até lá. */
let agendador: Agendador | null = null;

/**
 * O poller de quase-realtime (`poller-realtime.ts`, ACHADOS #89/#90) — igual ao
 * aquecedor, referenciado por fora ANTES de existir: `Servidor` precisa de
 * `overlayRealtime` no construtor, e o poller precisa do `servidor` (para
 * `aoTabelaMudar`) depois de construído. O `let` mais o fechamento abaixo
 * resolvem a mesma dependência circular que `aquecedor`/`carimbo` já resolvem.
 */
let poller: PollerRealtime | null = null;

const servidor = new Servidor({
  root: ROOT,
  snapshotDir: path.join(ROOT, DIRETORIO_PADRAO),
  webDir: path.resolve(AQUI, '..', 'web'),
  aquecimento: () => ({ ativo: aquecedor !== null, pronto: aquecedor?.pronto ?? false }),
  // `overlays()` (DADO), não `mescladores()` (função): é isto que atravessa o
  // `postMessage` até a worker, que é o caminho de produção. Ver
  // `apps/api/src/overlay-realtime.ts` — trocar de volta faz o near-realtime
  // voltar a detectar, invalidar, avisar e servir o número velho.
  overlayRealtime: () => poller?.overlays() ?? new Map(),
  ...(cache ? { cache } : {}),
  // Ligado sempre que existe `REDIS_URL`, mesmo quando `cache` saiu `undefined`
  // — é justamente esse o caso em que a saúde precisa dizer "configurado e
  // quebrado" em vez de "ausente". Sem `REDIS_URL`, o padrão do `Servidor` já
  // responde `ausente`, que é a verdade.
  ...(process.env.REDIS_URL ? { estadoDoRedis: () => saudeRedis.estado() } : {}),
  estadoDoPoller: () => poller?.estado() ?? null,
  // Sempre passado, mesmo desligado — "não há agendador neste processo, e o motivo é
  // este" é justamente a frase que faltava em 16/09/2026.
  estadoDoAgendador: () =>
    agendador?.estado() ?? {
      ativo: false,
      motivo: decisaoDoRefresh.agenda ? 'ainda não iniciou (a API não terminou de subir)' : decisaoDoRefresh.motivo,
    },
  estadoDoDisjuntor: () => disjuntorDoCache?.estado() ?? null,
  // "De pé" e "de pé tendo engolido 7 erros não tratados" são estados diferentes, e o
  // segundo precisa aparecer ANTES de virar o terceiro.
  estadoDaGuarda,
  // **O reaquecimento pós-evento (F4).** O `Servidor` invalida e sabe QUAIS
  // páginas caíram; o `Aquecedor` sabe COMO enchê-las de volta acertando a
  // mesma chave que o navegador pede. O fechamento resolve a mesma ordem
  // invertida de `overlayRealtime`: o aquecedor só existe depois do `listen`.
  //
  // Sem aquecimento não se passa a opção, e aí o `Servidor` volta ao
  // comportamento de antes da F4 (invalida e avisa na hora) em vez de esperar
  // por um reaquecimento que ninguém vai fazer.
  ...(semAquecer
    ? {}
    : {
        reaquece: async (paginas: readonly string[]): Promise<void> => {
          await aquecedor?.reaquece(paginas);
        },
      }),
  ...(tetoDeVisuaisMB !== undefined && Number.isFinite(tetoDeVisuaisMB)
    ? { tetoDeVisuaisMB }
    : {}),
  ...(process.env.GOOGLE_CLIENT_ID ? { googleClientId: process.env.GOOGLE_CLIENT_ID } : {}),
  ...(process.env.FIREBASE_PROJECT_ID ? { firebaseProjectId: process.env.FIREBASE_PROJECT_ID } : {}),
  ...(process.env.DOMINIO_CORPORATIVO ? { dominioCorporativo: process.env.DOMINIO_CORPORATIVO } : {}),
  ...(process.env.SESSAO_TTL_HORAS
    ? { sessaoTtlHoras: Number.parseFloat(process.env.SESSAO_TTL_HORAS) }
    : {}),
  ...(process.env.TOKEN_INTERNO ? { tokenInterno: process.env.TOKEN_INTERNO } : {}),
  ...(process.env.NODE_ENV === 'production' ? { producao: true } : {}),
  // Preparado, não ativado: liga o cookie `Secure` e o header HSTS só quando
  // COOKIE_SECURE=1 estiver no ambiente — que só deve acontecer junto com o
  // bloco `listen 443 ssl` do nginx.conf existindo de verdade. Ver
  // `identidade.ts` e `headers-seguranca.ts`.
  ...(process.env.COOKIE_SECURE === '1' ? { cookieSecure: true } : {}),
  // Confia no `X-Real-IP` (chave do rate limit) só quando há proxy reverso na
  // frente reescrevendo o header — senão ele é forjável e o limite é
  // contornável. Liga junto com o Nginx; ver `limitador-taxa.ts`.
  ...(process.env.CONFIA_PROXY === '1' ? { confiaNoProxy: true } : {}),
});

/**
 * Sem credencial do Voalle, não há o que poll(e)ar — mesma degradação do Redis
 * acima: a API sobe igual, só sem esta peça. `PollerRealtime.ativo` cobre o
 * outro lado (nenhuma query em `realtime-poll.yaml`), então as duas faltas
 * levam ao mesmo "não inicia", sem duplicar a checagem.
 */
const semPoller = process.argv.includes('--sem-poller') || process.env.SEM_POLLER === '1';
if (!semPoller && missingFor('voalle').length === 0) {
  poller = new PollerRealtime({
    specsDir: path.join(ROOT, 'specs'),
    pool: () => createVoallePool(loadConfig().voalle),
    aoMudar: (tabela, queryId) => servidor.aoTabelaMudar(tabela, queryId),
  });
}

const http = servidor.criaHttp();

/**
 * `EADDRINUSE` não pode sair como stack trace.
 *
 * A guarda do `tools/subir` roda ANTES de subir, e não alcança quem chega por outro
 * caminho: `npm run api`, um script, ou um `npm start` que perdeu a corrida entre a
 * checagem e o `listen`. Nesses casos o Node emitia `Unhandled 'error' event` com 12
 * linhas de pilha e nenhuma palavra sobre o que fazer — e a saída era procurar o PID à
 * mão, toda vez. Aqui a mensagem é a mesma do `tools/subir`, do mesmo módulo, porque
 * duas cópias do mesmo texto divergem no primeiro conserto.
 */
http.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(comoLiberar(porta));
  process.exit(1);
});

/** Só no contêiner (`VIGIA_TRAVAMENTO_S` no compose) — ver `vigia-travamento.ts`. */
const limiteDoVigiaMs = limiteDoAmbiente();
let vigia: Vigia | null = null;

// SIGTERM do `docker stop` / Ctrl+C: sai em ordem em vez de ser morta no meio. O vigia
// para primeiro — um desligamento lento não é travamento.
instalaDesligamento({
  passos: [
    { nome: 'vigia', fn: () => vigia?.para() },
    { nome: 'agendador', fn: () => agendador?.para() },
    { nome: 'poller', fn: () => poller?.para() },
    { nome: 'aquecedor', fn: () => aquecedor?.para() },
    { nome: 'http', fn: () => fechaHttp(http) },
    { nome: 'servidor', fn: () => servidor.destroi() },
  ],
});

http.listen(porta, () => {
  // Depois do `listen`, não antes: a carga inicial do snapshot pode segurar o laço por
  // bem mais que o limite, e isso é subir, não travar.
  if (limiteDoVigiaMs !== null) {
    vigia = iniciaVigiaDeTravamento({ limiteMs: limiteDoVigiaMs, snapshotDir: path.join(ROOT, DIRETORIO_PADRAO) });
  }
  console.log(`\nAnalytics Platform — API de leitura`);
  console.log(`  tela  http://localhost:${porta}/`);
  console.log(`  saúde http://localhost:${porta}/api/saude`);
  console.log(`\n  Somente GET (e POST /auth/*). Nenhuma rota escreve em fonte nenhuma.`);
  console.log(`  Os dados vêm do snapshot em disco, não das fontes.`);
  // A linha diz qual dos dois estados POSSÍVEIS está valendo. O terceiro — sem
  // credencial e sem declaração — não chega aqui: o processo já morreu acima.
  console.log(
    `  Login: ${semLogin
      ? 'DESLIGADO por SEM_LOGIN=1/--sem-login — TODO pedido é servido sem sessão'
      : `${process.env.FIREBASE_PROJECT_ID
          ? `Firebase (projeto ${process.env.FIREBASE_PROJECT_ID})`
          : 'Google Identity Services'}, domínio ${process.env.DOMINIO_CORPORATIVO ?? 'sebratel.com.br'}`}`,
  );
  console.log(
    `  Cache da resposta: ${cache ? 'memória + Redis (REDIS_URL)' : 'memória'}`,
  );
  console.log(`  Reaquecimento: ${semAquecer ? 'desligado (--sem-aquecer)' : 'automático'}`);
  console.log(
    `  Vigia de travamento: ${limiteDoVigiaMs === null ? 'desligado (sem VIGIA_TRAVAMENTO_S)' : `ligado, ${limiteDoVigiaMs / 1000} s`}`,
  );
  console.log(
    `  Paginação: ${tetoDeVisuaisMB === 0 ? 'sem cache de visual (CACHE_VISUAL_MB=0) — cada janela recalcula' : 'janela sai do resultado já calculado'}`,
  );
  console.log(
    `  Realtime: ${poller?.ativo ? 'poller ligado (specs/_catalog/realtime-poll.yaml)' : semPoller ? 'desligado (--sem-poller)' : 'desligado — sem credencial do Voalle ou nenhuma query configurada'}\n`,
  );

  if (poller?.ativo) poller.inicia();

  if (!semAquecer) {
    // `127.0.0.1` e não `localhost`: em máquina com IPv6 o `localhost` pode resolver
    // para `::1` primeiro e gastar uma tentativa recusada por pedido.
    aquecedor = new Aquecedor({
      base: `http://127.0.0.1:${porta}`,
      carimbo: () => servidor.identidadeAtual(),
      // O login gate (`/api/*` exige sessão) bloquearia o próprio Aquecedor,
      // que bate nessas rotas por HTTP de propósito (ver comentário de
      // `segredoAquecedor` em servidor.ts). Este cabeçalho é o reconhecimento
      // — gerado uma vez por processo, nunca configurável, nunca visto fora
      // deste ir-e-vir local.
      buscar: (url, init) =>
        fetch(url, { ...init, headers: { ...init?.headers, 'x-aquecedor-interno': servidor.segredoInterno() } }),
      // Filtros de poucos valores pré-calculados (ACHADOS #163): `AQUECE_FILTROS_ATE=0` desliga.
      ...(process.env.AQUECE_FILTROS_ATE !== undefined && Number.isFinite(Number(process.env.AQUECE_FILTROS_ATE))
        ? { filtrosAte: Number(process.env.AQUECE_FILTROS_ATE) }
        : {}),
    });
    aquecedor.inicia();
  }

  // Por último de propósito: o agendador pode enfileirar um grupo vencido na hora, e
  // um grupo é um subprocesso de materialização. Subir o aquecedor antes garante que a
  // tela já esteja quente quando isso começar a disputar CPU e banda.
  if (decisaoDoRefresh.agenda) {
    agendador = new Agendador({ raiz: ROOT });
    agendador.inicia();
  } else {
    console.log(`  Refresh: ${decisaoDoRefresh.motivo} — o snapshot em disco envelhece sem ninguém atualizar.`);
  }
});
