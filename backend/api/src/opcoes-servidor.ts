// As opções do `Servidor` — o contrato de `new Servidor({...})`, separado de
// `servidor.ts` em 27/09/2026 (ACHADOS #158) para o arquivo principal caber na cabeça.
// Só tipos: nada aqui executa.

import type http from 'node:http';
import type { Cache } from '../../packages/query-engine/src/types.ts';
import type { Identidade } from './identidade.ts';
import type { AcessoDasTelas } from './permissoes.ts';
import type { GravadorDeEventos } from './eventos-seguranca.ts';
import type { VerificadorDeToken } from './auth-google.ts';
import type { BuscaCertificados } from './auth-firebase.ts';
import type { PiscinaWorkers } from './piscina-workers.ts';
import type { OverlayDeTabela } from './overlay-realtime.ts';
import type { EstadoDoRedis } from './saude-do-redis.ts';
import type { UsoDasTelas } from './uso-das-telas.ts';

export interface ServidorOptions {
  /** Raiz do repositório — de onde saem `backend/specs/` e o `snapshot/`. */
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
  /**
   * Quem abre cada aba (`permissoes.ts`). **Obrigatória e sem padrão**, de propósito:
   * um padrão "libera tudo" seria esquecido num ponto de construção e reabriria todas
   * as abas sem erro nenhum; um padrão "nega tudo" quebraria em silêncio do outro
   * lado. Quem constrói o `Servidor` decide, e o compilador cobra.
   */
  acesso: AcessoDasTelas;
  /** Onde os eventos de segurança são gravados (`eventos-seguranca.ts`). Padrão: em lugar
   *  nenhum — só a linha `[seg]` do log, como antes de 13/10/2026. */
  eventosDeSeguranca?: GravadorDeEventos;
  /** Agregado leve de aberturas de aba e sua leitura administrativa. */
  usoDasTelas?: UsoDasTelas;
  /** Client ID do OAuth do Google, para `POST /auth/google`. Vazio recusa todo
   *  token — falha fechada, não aberta, enquanto não configurado. */
  googleClientId?: string;
  /** Domínio do Google Workspace que pode logar. */
  dominioCorporativo?: string;
  /** Por quanto tempo uma sessão criada em `/auth/google` vale. */
  sessaoTtlHoras?: number;
  /** Só teste: troca `filtros.modo` de `seguranca.yaml` (S5). Produção usa a spec. */
  modoDosFiltros?: 'observar' | 'bloquear';
  /** Substitui o cliente real do Google em teste — ver `auth-google.ts`. */
  verificadorGoogle?: VerificadorDeToken;
  /**
   * ID do projeto Firebase, para `POST /auth/firebase`. Vazio recusa todo
   * token — falha fechada, igual ao `googleClientId`.
   *
   * Coexiste com `googleClientId` de propósito: os dois caminhos entregam a
   * MESMA sessão (`criaSessao` com o e-mail), e quem escolhe é a configuração
   * do ambiente. Ter os dois ligados ao mesmo tempo é legítimo — é o que
   * permite migrar a tela para o Firebase sem derrubar o `backend/tools/tela` nem
   * quem já estiver logado pelo GIS.
   */
  firebaseProjectId?: string;
  /** Substitui a busca de chaves públicas do Firebase em teste — ver `auth-firebase.ts`. */
  certificadosFirebase?: BuscaCertificados;
  /**
   * Segredo compartilhado (`.env`, `TOKEN_INTERNO`) que libera `POST
   * /auth/interno` — a única forma de uma ferramenta de linha de comando
   * (hoje: `backend/tools/tela`, que dirige um navegador de verdade) logar sem conta
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
   * Teto, em MB estimados, do `MemoryCache` padrão de respostas — o que o servidor
   * monta quando `cache` não vem. Padrão `TETO_RESPOSTA_PADRAO_MB`; ver
   * `memoria-limitada.ts` para o defeito que ele fecha. Não vale para um `cache`
   * passado de fora: quem monta aquele (`index.ts`, com Redis) põe o teto lá.
   */
  tetoDoCacheDeRespostaMB?: number;
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
   * O poller de quase-realtime (`backend/api/src/poller-realtime.ts`), consultado a
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
   * Quais páginas o tempo real avisa NA HORA e de quanto em quanto as outras
   * recebem as mudanças juntas (ACHADOS #175). Ausente, ou `demaisACadaMs` ≤ 0:
   * toda página afetada é invalidada e avisada a cada mudança, o comportamento de
   * antes de 05/10/2026. `npm run api` passa `PADRAO_AVISO_DAS_PAGINAS`.
   */
  avisoDasPaginas?: { imediatas: readonly string[]; demaisACadaMs: number };
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
   * (`backend/api/src/agendador.ts`). Ausente quando quem agenda é outro — o daemon
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
