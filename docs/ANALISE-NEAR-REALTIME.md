# Análise — evolução para near real-time (08/09/2026)

> **Feita antes de escrever uma linha de implementação**, como o pedido exigiu.
> Tudo abaixo saiu de leitura do código e de medição nesta máquina; onde é
> leitura, o arquivo e a linha estão citados; onde é medição, o comando está
> junto. Nada aqui é estimativa.

## A conclusão em uma frase

**A arquitetura pedida já existe — e, em produção, ela termina num no-op.** SSE,
detecção de mudança, invalidação cirúrgica por página e versionamento do cache
pelo carimbo do snapshot estão construídos e testados. O que falta não é
adicionar SSE: é fechar oito buracos, e o primeiro deles faz o caminho inteiro
não entregar dado novo nenhum quando a piscina de workers está ativa.

---

## 1. Arquitetura atual — o fluxo real

Existem **dois** caminhos de frescor, independentes, com cadências diferentes.

### Caminho A — o snapshot em disco (15 min)

```
container `refresh` (docker-compose.prod.yml, REFRESH_INTERVAL_MINUTOS=15)
   -> tools/refresh/src/daemon.ts -> npm run snapshot
   -> escrita atômica (rename; packages/snapshot/src/escrita-atomica.ts)
   -> snapshot/  (bind mount COMPARTILHADO com o container `api`)
        |
   API: fs.watch(snapshotDir)  ->  carimboMemo = null      servidor.ts:1208
        |
   carimboAtual() = carimboDoSnapshot(manifesto, calculadas)   <- A VERSÃO JÁ EXISTE
   identidadeAtual() = `${carimbo}@${diaUTC}`                    servidor.ts:1242
        |
   chaveDaResposta({...carimbo, dia})                       cache-resposta.ts:185
   -> carimbo novo torna TODA entrada anterior inalcançável no mesmo instante
        |
   Aquecedor (5 s, INTERVALO_PADRAO_MS) compara o carimbo e, se mudou,
   reaquece as 14 páginas por HTTP contra a própria API      aquecedor.ts:136
```

### Caminho B — o poller de quase-realtime (12 s / 30 s, 7 queries)

```
PollerRealtime: SELECT ... a.modified >= :desde no Voalle    poller-realtime.ts:317
   -> delta em memória (mescla(), a mesma de incremental.ts)
   -> NUNCA escreve no disco -> NÃO mexe no carimbo (deliberado; ACHADOS #89)
        |
   aoMudar -> Servidor.aoTabelaMudar(tabela, queryId)            servidor.ts:662
        |- carregadas.delete(...)      (avaliador em memória)
        |- completos.limpaPagina(id)   (resultado inteiro por visual)
        |- cache.apagaPagina(id)       (resposta pronta: memória + Redis)
        \- emiteEvento([dashboards afetados])                    servidor.ts:642
        |
   GET /api/eventos (SSE, batimento de 25 s)                     servidor.ts:582
   nginx.conf:35 já tem proxy_buffering off + read_timeout 1h
        |
   App.tsx: new EventSource('/api/eventos')                          App.tsx:175
   -> apagaPaginaDoCache(paginasVistas, id)  -> setRevalidar(n+1)
   -> mesmo GET de sempre, sem F5
```

### O caminho de uma resposta

```
GET /api/dashboards/:id?filtro=&clicado=&visual=&de=&linhas=
   |  escopoDoCache(quem) + filtros normalizados + visuais ordenados
   |  + de/linhas + carimbo + dia UTC
   |  chaveDaResposta()                                     servidor.ts:793
   |
 HIT  -> responde (custo fixo: carimboAtual() ~ 0,57 ms)    servidor.ts:804
 MISS -> piscina.executa(...) -> worker -> carrega() + calculaPagina()
         (fallback in-process se a worker falhar)           servidor.ts:845
   |  guarda no cache com RETENCAO_PADRAO = 7 dias
```

---

## 2. O que está quebrado, medido

### B1 — CRÍTICO: o caminho realtime não entrega dado novo em produção

`worker-calculador.ts:57` chama `carrega()` **sem `overlay`**. O overlay do
poller só entra no ramo de fallback (`servidor.ts:1156`, `Servidor.carrega`).
Como `piscina.ativa` é verdadeiro em produção (`NODE_ENV=production`) — e,
medido, **também sob `npm test`**, porque o script não define `NODE_ENV=test`:

```
$ node -e "...new PiscinaWorkers({desativado: process.env.NODE_ENV==='test'})..."
NODE_ENV= undefined  ativa= true
```

…toda página real é calculada na worker. O resultado:

```
poller detecta mudança
   -> invalida as 3 camadas de cache
   -> SSE avisa o navegador
   -> navegador refaz o GET
   -> MISS -> worker -> carrega() SEM overlay -> lê só o disco
   -> MESMO NÚMERO DE ANTES
```

O usuário paga 10–20 s de recálculo para ver o dado idêntico, a cada 12 s.

**Causa raiz, e é o que dita o conserto:** `overlayRealtime()` devolve
`Map<string, (linhas) => linhas>` — **funções**. Closure não atravessa
`postMessage` (structured clone não serializa função). Os *dados* do delta
(`linhas`, `corte`, `chave`, `marca` — `OverlayDeTabela`, poller-realtime.ts:174)
atravessam sem problema. O conserto é mandar o dado e reconstruir o mesclador
dentro da worker, não mandar a função.

**Por que nenhum teste pega:** `servidorComOverlay` (servidor.test.ts:111) é
chamado **sempre** com `() => new Map()`. Não existe um só teste que empurre um
overlay não-vazio pelo caminho HTTP. `poller-realtime.test.ts` testa as funções
puras (delta, merge, poda) — que estão certas — e nunca o acoplamento.

### B2 — o cache de visual (`completos`) também é inalcançável em produção

Mesmo motivo: o `memo` só é passado no ramo sem piscina (`servidor.ts:869-905`).
Logo `CACHE_VISUAL_MB`, `TETO_PADRAO_MB` e o bloco `cache.visuais` de
`/api/saude` descrevem um cache que produção não usa — e cada clique em "próxima
janela" recalcula o visual inteiro, que é exatamente o defeito que
`cache-visual.ts` foi escrito para consertar.

### B3 — single-flight NÃO existe

`docs/DECISAO-DESEMPENHO.md:177` afirma que `emVoo` existe ("dois pedidos com a
mesma chave de cache esperam o mesmo cálculo"). Verificado:

```
$ grep -rn "emVoo" --include=*.ts .                          -> nada
$ git log --oneline -S"emVoo" -- apps/api/src/servidor.ts    -> nenhum commit
```

Nunca existiu no código versionado. Hoje, N pedidos com a mesma chave em MISS =
N cálculos, com 2 workers e páginas de 10–20 s.

**E o SSE agrava isso.** Um evento acorda ao mesmo tempo *todos* os navegadores
com aquela página aberta; como `escopo` é o mesmo para todos (escopo-cache.ts,
ACHADOS #102), eles disputam **a mesma chave** — a rajada é sincronizada por
construção. É o requisito 9 escrito pelo próprio desenho do sistema.

### B4 — a fila da piscina é FIFO pura, sem prioridade

`PiscinaWorkers.tarefas` é array + `shift()` (piscina-workers.ts:200). O clique
do usuário entra atrás do que já estiver na fila. Entram nessa mesma fila:

* o **Aquecedor** — 14 páginas, sequencial, 8–36 s cada, até ~2 min em
  `agendamento-field` (aquecedor.ts:158);
* o **pré-carregamento do navegador** — 13 páginas por aba aberta
  (App.tsx:213-243). Sequencial *por navegador*: com N usuários abrindo a
  aplicação, são N sequências concorrentes.

### B5 — a invalidação do poller não reaquece nada

`aoTabelaMudar` apaga o cache das páginas afetadas. O `Aquecedor` só age quando
o **carimbo** muda (aquecedor.ts:143) — e o poller, de propósito, não mexe no
carimbo. Resultado: depois de cada evento do poller, o primeiro usuário paga o
cálculo frio inteiro. Potencialmente a cada 12 s.

### B6 — o evento SSE não carrega versão

`emiteEvento` manda `data: {"dashboards":[...]}` e nada mais (servidor.ts:644).
Sem versão não há como ignorar duplicata, descartar evento antigo, nem verificar
o requisito 18. Não há `id:`, então `Last-Event-ID` não tem o que reproduzir.

### B7 — o navegador sincroniza com relógio, e baixa as 14 páginas na abertura

`App.tsx:217` `setTimeout(..., 800)` e `App.tsx:234` `setTimeout(..., 300)` são
exatamente o mecanismo que o requisito 13 proíbe — e o laço que eles guardam
baixa **as 13 páginas restantes** assim que a aplicação abre (requisito 12).
O prefetch por hover (App.tsx:367, 60 ms de intenção) está certo e fica.

### B8 — `carimboMemo` depende de um `fs.watch` que falha em silêncio

`carimboMemo` só é limpo em dois lugares: o `fs.watch` (servidor.ts:1208, dentro
de um `try/catch {}` silencioso) e `aoTabelaMudar` (servidor.ts:663). Se o watch
não disparar — bind mount entre containers, plataforma sem inotify — e o poller
estiver quieto ou desligado (`--sem-poller`, ou sem credencial do Voalle), a API
serve o snapshot antigo **indefinidamente, sem log**. Hoje o poller mascara isso
a cada 12 s, por acidente.

Isso contradiz o comentário de `carimboAtual` (servidor.ts:1183-1204), que
explica em detalhe por que memoizar o carimbo é perigoso — e o código memoiza
mesmo assim, atrás de um watch mais frágil que o `mtime` que aquele comentário
rejeitou.

### B9 — observabilidade

`/api/saude` já traz memória (RSS/heap), cache de visual, aquecimento e status
do refresh. **Não** traz: conexões SSE abertas, eventos emitidos, hit/miss do
cache de resposta, profundidade da fila de workers, latência/erro do Redis.

---

## 3. Decisões — inclusive onde eu divirjo do pedido

### D1. NÃO introduzir Redis Pub/Sub agora

* **Por quê.** Uma instância de API. O fan-out já é in-process
  (`assinantesSSE`, servidor.ts:271) e já é testado (3 testes de SSE).
* **Alternativa considerada.** Publicar em `snapshot_updated` e assinar no
  próprio processo, como o pedido descreve.
* **Impacto de fazer.** `ioredis` exige uma **segunda conexão** em modo
  subscriber (uma conexão em SUBSCRIBE não aceita mais comandos), mais um modo
  de falha novo: hoje Redis fora do ar é *miss de cache* (degradação já
  desenhada, index.ts:44-69); com Pub/Sub no caminho, passaria a ser *perda de
  notificação* — pior, porque é silenciosa.
* **Ganho medido.** Zero. Não há segundo processo que precise notificar: o
  container `refresh` comunica-se pelo disco, e o carimbo do disco já é a
  verdade que as duas pontas leem.
* **Como medir se eu estiver errado.** No dia em que houver mais de uma réplica,
  ou em que um segundo processo precise avisar a API de algo que não está no
  disco. Deixo o desenho escrito (§8) — é uma peça de ~40 linhas, não uma
  reescrita.

### D2. NÃO criar um poll de "versão" a cada 15 s

Já existem **dois** detectores de mudança. Um terceiro cria a segunda fonte da
verdade que o próprio requisito 3 proíbe.

| detector | o que vigia | cadência | onde |
|---|---|---|---|
| `fs.watch` + `Aquecedor` | carimbo do snapshot em disco | 5 s | aquecedor.ts:43 |
| `PollerRealtime` | `a.modified` no Voalle | 12 s (5 queries) / 30 s (2) | realtime-poll.yaml |

O que falta é **publicar no evento a versão que já é calculada**, não detectá-la
de novo. O intervalo fica parametrizável (`AQUECEDOR_INTERVALO_MS`;
`intervalo_ms` por query já é), mas os 15 s do pedido são mais lentos que os 12 s
que o repositório já pratica — adotá-los seria uma regressão.

### D3. A prioridade vai na piscina, não em mais workers

2 workers ficam (o contrato de memória do compose depende disso, e
`piscina-workers.test.ts` falha se alguém mexer). O que muda é a **ordem** da
fila: `interactive > prefetch > warmup`, com a origem declarada pelo pedido.

### D4. O overlay atravessa a worker como DADO, não como função

É a única forma que o `structured clone` permite. O mesclador é reconstruído do
outro lado com `mesclador(overlay)` — a mesma função pura que já existe
(poller-realtime.ts:199), sem duplicar semântica.

---

## 4. Pontos de integração — arquivos e funções a tocar

| # | arquivo | o quê |
|---|---|---|
| B1 | `apps/api/src/poller-realtime.ts` | expor `overlays(): Map<string, OverlayDeTabela>` (dados) além de `mescladores()` (funções) |
| B1 | `apps/api/src/servidor.ts` | `ServidorOptions.overlayRealtime` passa a dar dados; `pagina()` os manda na mensagem da worker |
| B1 | `apps/api/src/worker-calculador.ts` | `MensagemCalculoWorker.overlays`; reconstruir `mesclador()` e passar a `carrega()` |
| B1 | `apps/api/src/index.ts` | ligar `poller.overlays()` no lugar de `poller.mescladores()` |
| B2 | `apps/api/src/worker-calculador.ts` + `servidor.ts` | memo de visual: chave calculada no pai, resultado devolvido pela worker |
| B3 | `apps/api/src/servidor.ts` (novo `voo-unico.ts`) | mapa `chave -> Promise`, com limpeza em sucesso/erro/timeout |
| B4 | `apps/api/src/piscina-workers.ts` | fila com prioridade; `executa(msg, {prioridade})` |
| B4 | `apps/api/src/servidor.ts` | classificar origem: `x-aquecedor-interno` -> warmup; `?origem=prefetch` -> prefetch; resto -> interactive |
| B4 | `apps/web/src/App.tsx` / `api.ts` | marcar o prefetch por hover como `prefetch` |
| B5 | `apps/api/src/servidor.ts` | depois de `aoTabelaMudar`, agendar reaquecimento em prioridade `warmup` só das páginas afetadas |
| B6 | `apps/api/src/servidor.ts` | `emiteEvento` passa a mandar `id:` + `{versao, dashboards, atualizadoEm}` |
| B6 | `apps/web/src/App.tsx` | comparar versão, ignorar antiga/duplicada, preservar filtros |
| B7 | `apps/web/src/App.tsx` | remover os dois `setTimeout`; `requestIdleCallback` + páginas mais acessadas |
| B8 | `apps/api/src/servidor.ts` | o `catch {}` do watcher passa a ser estado visível em `/api/saude` |
| B9 | `apps/api/src/servidor.ts` (novo `metricas.ts`) | contadores; expostos em `/api/saude` |

**Não tocar:** `packages/query-engine`, `packages/measure-engine`,
`packages/widget-engine`, `packages/snapshot` (exceto ler `carrega`),
`identidade.ts`, `auth-google.ts`, `portao-login.ts`, `cache-resposta.ts`
(a chave está certa), `nginx.conf` (o SSE já está configurado).

---

## 4-A. F1 — FEITA em 08/09/2026

O overlay atravessa a fronteira da worker. `PollerRealtime.overlays()` produz o
overlay em **dado** (`OverlayDeTabela`: linhas, corte, chave, marca — tudo
clonável por estrutura), `Servidor` o recorta para as tabelas da página e o
manda no `postMessage`, e `worker-calculador.ts` reconstrói o mesclador do outro
lado com a MESMA `mesclador()` que o processo principal usa
(`apps/api/src/overlay-realtime.ts`).

**O F0 foi embutido nela**, como instrumentação, e não como fase que bloqueasse a
correção: `apps/api/src/metricas.ts`, exposto em `GET /api/saude` sob `realtime`.

### O que mudou de verdade

| | antes | depois |
|---|---|---|
| overlay chega à worker | não (`carrega()` sem `overlay`) | sim |
| teste que empurra overlay não-vazio pelo HTTP | **nenhum** | 4 |
| `PollerRealtime.mescladores()` | montava o `Map` de funções | removido — só o teste o chamava |

Os três testes de overlay em `apps/api/test/overlay-worker.test.ts` ficam
**vermelhos** com a linha da correção retirada e verdes com ela — verificado
retirando-a de propósito. Suíte inteira: **1682/1682**.

### A linha de base, medida na API de verdade (08/09/2026)

Máquina local, `snapshot/` real, 2 workers, poller e aquecedor desligados.

```
capa, fria ......................  841 ms   (worker  181 ms)
capa, quente ....................    2 ms   HIT
```

**A rajada que o SSE provoca**, 6 pedidos idênticos e simultâneos em MISS
(`?recalcula=1`) contra `diario-instalacao`:

```
req1..req4 ..... 15,5 s
req5, req6 ..... 25,7 s
worker_ms ...... média 10,3 s, pico 17,5 s
concorrentes_mesma_chave_max ... 4
calculos_duplicados ............ 4
worker_fila_max ................ 3
```

**Seis pedidos pela mesma resposta pagaram seis cálculos**, e os dois últimos
esperaram 25,7 s por uma página que custa ~10 s a frio. É o número que o
requisito 9 pedia e que o repositório não tinha: com single-flight, os seis
saem de um cálculo só, e o pior caso cai de 25,7 s para o custo de um cálculo.
É por isso que o single-flight é a fase seguinte, e não uma otimização
posterior — o SSE **cria** essa rajada por construção, sincronizando todos os
navegadores que estão com a página aberta na mesma chave.

### O que a F1 NÃO fez

**`completos` (B2) continua inalcançável em produção.** Ela não entrou junto por
uma razão de custo, não por esquecimento: o `memo` é síncrono e o "completo" de
um visual tem dezenas de MB (`cache-visual.ts` diz isso explicitamente). Mandá-lo
para dentro da worker e de volta a cada clique de paginação seria serializar
dezenas de MB por janela — pior que o recálculo que ele evita. O caminho que
parece certo é outro: o pai guarda o completo e **serve a janela seguinte sem
worker nenhuma**, porque recortar não precisa de avaliador. É uma decisão com
medida própria, e fica na fase dela.

---

## 4-B. F2 — FEITA em 08/09/2026

Single-flight por chave de resposta: `apps/api/src/voo-unico.ts`, encaixado em
`pagina()` exatamente no ponto MISS → cálculo. A chave é a MESMA do cache
(`chaveDaResposta`), e é isso que dá de graça duas garantias que seriam
trabalhosas de manter à mão: recortes diferentes nunca se fundem (filtros,
visuais, janela e clicados já estão na chave) e um snapshot novo é uma chave
nova, que não alcança o voo iniciado sobre o dado velho (requisito 18).

A **gravação no cache entrou para dentro do voo**: ela é parte do cálculo, não
da resposta. Fora dele, os N que pegaram carona gravariam a mesma entrada N
vezes no Redis.

### Antes e depois, medidos na API real

Mesma máquina, mesmo `snapshot/`, mesma página (`diario-instalacao`), 2 workers,
6 GET idênticos e simultâneos em MISS (`?recalcula=1`):

| | antes (F1) | depois (F2) |
|---|---|---|
| cálculos para 6 pedidos | **6** | **1** |
| pior espera | **25,7 s** | **10,1 s** |
| espera dos 6 | 15,5 s / 15,5 s / 15,5 s / 15,5 s / 25,7 s / 25,7 s | os seis juntos, em 10,1 s |
| `worker_ms` | média 10,3 s, pico 17,5 s | 1 execução por rodada |
| estado na resposta | 6 × `miss` | 1 × `miss` + 5 × `coalescido` |

Em duas rodadas seguidas: `singleflight_iniciados: 2`,
`singleflight_coalescidos: 10`, e `concorrentes_mesma_chave_max: 6` — **a rajada
continua existindo; ela parou de custar.** São números diferentes de propósito.

> **Ressalva honesta sobre a comparação:** a medição "antes" rodou com o Redis
> no ar e a "depois" com ele fora (ver abaixo). Como os dois lados usaram
> `?recalcula=1`, que pula a leitura do cache, isso não muda a conta que
> interessa — número de cálculos. O efeito colateral é que a coluna "depois"
> ainda paga uma escrita de cache que falha, ou seja, ela está levemente
> pessimista, não otimista.

### Dois defeitos vizinhos, que o single-flight AGRAVARIA

Os dois são anteriores a esta fase e foram corrigidos junto, porque em ambos o
estrago cresce quando N pedidos passam a depender de um cálculo só.

**1. Worker que morre deixava a promessa pendente para sempre.** Medido:
`terminate()` numa worker com tarefa pendente e, 2 s depois, a promessa
continuava `PENDENTE`. `w.on('exit')` só tirava a worker das listas, sem
rejeitar. Antes, isso pendurava um pedido; sob single-flight, penduraria a
**chave inteira** — todo pedido seguinte àquela chave entraria no voo que nunca
resolve, até o carimbo mudar. Agora `exit` rejeita a tarefa (e, se não sobrou
worker nenhuma, também as que estavam na fila), o que faz o pedido cair no
cálculo em linha, que é a degradação que já existia e já era testada.

**2. A API MORRIA quando o Redis ficava inalcançável.** Não é hipótese: durante
esta sessão o Redis do compose continuou "Up" mas a porta parou de aceitar
conexão, e a API caiu com

```
[ioredis] Unhandled error event: AggregateError [ECONNREFUSED]
```

O driver emite `'error'` num `EventEmitter`; sem ouvinte, o Node transforma isso
em exceção não tratada e o processo morre. Todo o resto do caminho já degradava
certo — `CacheEmCamadas.aoFalhar`, o `try/catch` de `CacheDeResposta`, a memória
na frente do Redis — e `index.ts` gasta 25 linhas prometendo exatamente essa
degradação. Quem derrubava era o evento solto do driver, antes de qualquer uma
delas. Com o ouvinte, a mesma situação virou log e `GET /api/saude` respondendo
200 — ver §4-C para o que ainda faltava depois disso.

### Testes

* `apps/api/test/voo-unico.test.ts` — a mecânica: convergência, chaves distintas,
  limpeza em sucesso, em rejeição e em `throw` síncrono, e a conferência de
  identidade que impede um voo terminado de apagar o registro de um voo novo.
* `apps/api/test/single-flight.test.ts` — ponta a ponta: 6 GET → 1 cálculo; 20
  clientes acordados por `aoTabelaMudar` → 1 cálculo; recortes diferentes não se
  fundem; carimbo novo não reaproveita voo; 409 chega a todos e libera a chave.

Os quatro testes de rajada ficam **vermelhos** com o single-flight desligado —
verificado desligando-o. Suíte inteira: **1697/1697**.

---

## 4-C. F2.1 — os dois hardenings, FEITA em 08/09/2026

Ordem revista com o Erick: antes de pôr mais pressão na fila (F3), fechar os dois
pontos de falha que a F2 revelou. Os consertos em si já tinham entrado no commit
da F2. O que faltava era o que os torna duráveis — **teste que fica vermelho
quando o conserto some**, e **estado visível de fora**.

### 1. Ciclo de vida da worker: agora com teste

O conserto estava verificado por sonda manual, e sonda não fica vermelha quando
alguém apaga o handler. O que faltava era exercitar a corrente inteira:

```
worker exit/error -> rejeita a tarefa -> o voo resolve pelo cálculo em linha
                                      -> a chave sai do Map
                                      -> o pedido seguinte é HIT
```

Uma nota sobre essa corrente, porque ela não é a que o desenho previa: o voo
**não** rejeita quando a worker morre. `pagina()` pega a rejeição e cai no
cálculo em linha, que é a degradação que já existia e já era testada — mais
devagar, e respondendo. O voo só rejeita quando o próprio fallback falha (é o
caso do 409 sem snapshot, já coberto na F2). Nos dois casos a chave é liberada,
que é a garantia que importa.

Testar isso exigiu um ponto de entrada novo, `OpcoesPiscina.scriptDaWorker`. A
razão: em produção a worker morre por estouro do heap de 768 MB no meio de um
cálculo de 10–20 s sobre um snapshot real, e nenhum teste de unidade vai
reproduzir isso. Com o parâmetro, o teste sobe uma worker de duas linhas que
morre na primeira mensagem, e a afirmação passa a ser sobre a piscina.

* `apps/api/test/piscina-ciclo-de-vida.test.ts` — a tarefa da worker morta
  rejeita; a **fila** também é drenada quando não sobra worker; a piscina se
  declara inativa; e um controle com uma worker que responde, para que os três
  primeiros não passem numa piscina que rejeita tudo.
* `apps/api/test/single-flight.test.ts` — o mesmo visto de fora, com o
  single-flight no meio: 5 pedidos coalescidos, a worker morre, os 5 recebem
  200, houve **um** `worker_fallback` (não um por pedido) e o pedido seguinte é
  `hit`.

Os dois primeiros ficam **vermelhos** com o handler de `exit` de volta à forma
antiga — verificado. E ficam vermelhos com **mensagem**, não com a suíte
pendurada: todo `await` que depende do conserto está sob prazo.

### 2. Redis: a saúde parou de mentir

O ouvinte de `'error'` da F2 impedia a morte do processo. Faltava a metade
silenciosa do mesmo problema: com o Redis no chão, `GET /api/saude` continuava
respondendo `adapter: "MemoryCache+RedisCache"` — o nome do arranjo montado na
subida, não o estado dele agora. Uma API degradada parecia saudável, e a única
pista era o tempo de resposta piorar depois de um restart.

`apps/api/src/saude-do-redis.ts` publica isso em `cache.redis`:

```json
{ "status": "degradado", "falhas": 57, "desde": "...",
  "ultimoErro": "Reached the max retries per request limit (which is 1).",
  "ultimaOperacao": "set" }
```

Três decisões que valem registro:

* **`falhas` não zera quando o Redis volta.** É o número que distingue "caiu uma
  vez às 3h" de "está piscando". Um `status: "ok"` com 4.000 falhas é uma conexão
  instável, e o instantâneo sozinho nunca contaria isso.
* **O log sai só na transição; a contagem fica na saúde.** Um Redis inalcançável
  emite `'error'` a cada tentativa de reconexão — em segundos são centenas de
  linhas idênticas, e a primeira (a que interessa) fica soterrada.
* **Degradado continua respondendo 200.** O healthcheck do
  `docker-compose.prod.yml` testa `r.ok`; um 503 aqui faria o Docker reiniciar a
  API em laço por causa de um cache **opcional** — degradação prevista virando
  indisponibilidade real. `saude-do-redis.test.ts` guarda isso.

E a senha não vaza: `/api/saude` fica fora da guarda de sessão de propósito (é o
healthcheck que bate nela), então `semSegredo()` corta qualquer
`redis://usuario:senha@` antes de o texto sair. `ECONNREFUSED host:porta` passa
inteiro — o operador precisa do host para diagnosticar.

### O ciclo inteiro, medido contra um Redis de verdade

Suíte verde não prova que o processo sobe. O `redis-1` do compose não publica a
porta 6379 para o host, então a medição usou um container temporário com porta
publicada, e uma API real (`snapshot/` real, `--sem-aquecer --sem-poller`):

| momento | `cache.redis` | página |
|---|---|---|
| subida, antes de tocar o cache | `ocioso`, 0 falhas | — |
| 1º GET, Redis fora do ar | `degradado`, 9 falhas, `ECONNREFUSED`, op `conexão` | 200 em 0,53 s |
| Redis sobe no mesmo endereço | `ok`, **51 falhas preservadas** | — |
| Redis é derrubado de novo | `degradado`, 57 falhas, op **`set`** | 200 em 4,6 s |

Duas leituras que só apareceram por rodar:

1. **A volta funciona sozinha.** O processo estava no ar havia uma hora contra
   uma porta que recusava conexão; quando o Redis apareceu, o `'ready'` do driver
   levou a saúde de volta para `ok`. Sem isso, o campo ficaria `degradado` para
   sempre depois da primeira queda — o mesmo endpoint mentiroso, na direção
   oposta.
2. **As duas vias de detecção são necessárias.** A última linha da tabela chegou
   pelo `aoFalhar` de `CacheEmCamadas` (op `set`), não pelo `'error'` do driver:
   um Redis que aceita conexão e recusa comando não emite `'error'` nenhum, e do
   ponto de vista de quem esperava cache é a mesma falha.

O log inteiro dessa hora, para 57 falhas e uma recuperação, tem **três linhas**:

```
[cache] Redis indisponível (a memória continua servindo): connect ECONNREFUSED 127.0.0.1:6399
[cache] Redis conectado.
[cache] Redis indisponível (a memória continua servindo): connect ECONNREFUSED 127.0.0.1:6399
```

### Um defeito de tipo, achado de lambuja

`w.on('error', (err) => this.removeWorker(w, err))` passava `unknown` onde se
esperava `Error`. Nunca apareceu porque o Node **remove** os tipos sem
verificá-los — não há build. Consequência prática: uma worker que morresse por
algo que não fosse um `Error` produziria `[object Object]` como motivo, e o
motivo real da morte se perderia.

Suíte inteira: **1711/1711**.

---

## 5. Plano — etapas pequenas e reversíveis

| fase | entrega | reversão | como provo que funcionou |
|---|---|---|---|
> **Ordem revista com o Erick em 08/09/2026.** O F0 virou instrumentação dentro
> da F1 em vez de fase própria — o diagnóstico já era forte o bastante para
> justificar a intervenção. E o reaquecimento subiu de posição, mas continua
> DEPOIS da F1: reaquecer antes dela seria esquentar o resultado errado.

| fase | entrega | reversão | como provo que funcionou |
|---|---|---|---|
| **F1** ✅ | **overlay atravessa a worker** (B1) + contadores do F0 | 1 commit | 4 testes que ficam vermelhos sem a linha da correção |
| **F2** ✅ | single-flight (B3) | 1 commit | os 6 pedidos medidos viraram 1 cálculo; 25,7 s → 10,1 s |
| **F2.1** ✅ | ciclo de vida da worker + saúde do Redis (§4-C) | 1 commit | 2 testes vermelhos sem o handler de `exit`; ciclo `ocioso→degradado→ok→degradado` medido contra Redis real |
| **F3** | fila com prioridade (B4) | 1 commit; sem rótulo tudo vira `interactive` = FIFO de hoje | interactive na frente de warmup, com fila cheia |
| **F4** | reaquecimento pós-evento do poller (B5) | 1 commit | primeiro GET depois do evento é HIT |
| **F5** | `carimboMemo`/watchdog visível (B8) | 1 commit | `/api/saude` diz se o `fs.watch` pegou |
| **F6** | versão no evento SSE (B6) + navegador (requisito 7) | 1 commit; navegador antigo ignora campo novo | evento antigo/duplicado ignorado; filtros preservados |
| **F7** | navegador: matar os `setTimeout`, prefetch por intenção (B7); `completos` (B2) | 1 commit cada | abertura deixa de baixar 13 páginas |
| **F8** | observabilidade completa (B9) + testes (requisito 21) | 1 commit | `/api/saude` responde as 9 perguntas do requisito 19 |

Cada fase compila, passa `npm test` e é útil sozinha. F1 é a que destrava o
resto: sem ela, tudo o mais otimiza a entrega de um dado que não mudou.

---

## 6. Riscos

| risco | onde | mitigação |
|---|---|---|
| **Memória** — o delta cruza a fronteira da worker a cada cálculo | F1 | o delta é pequeno por construção (`podaDelta`, teto de 48 h); medir o tamanho serializado e registrar. Se crescer, mandar só as tabelas que a página usa |
| **Correção** — o overlay passa a MUDAR números que hoje não mudam | F1 | é o objetivo, mas é mudança de número: comparar a página antes/depois no mesmo carimbo, e conferir contra a fonte |
| **Concorrência** — single-flight que não limpa vira travamento permanente | F3 | limpeza em `finally` + timeout; teste para erro, timeout e cancelamento |
| **Prioridade** — inanição do warmup | F4 | teto de espera: warmup que espera demais sobe de faixa |
| **StrictMode** — efeito duplo abre 2 `EventSource` | F5 | o efeito atual já fecha no cleanup (App.tsx:196); teste de montagem dupla |
| **Redis** — indisponível | todas | nada muda: o fan-out é in-process e o cache já degrada para memória (index.ts:52) |
| **Sem Redis + restart** | F6 | cache frio; o Aquecedor já cobre isso no arranque |
| **Deploy** | F1–F8 | contrato de memória do compose intacto (2 workers × 768 MB); nenhuma env nova obrigatória |
| **Autenticação** | F5 | `/api/eventos` já está atrás da guarda de sessão (servidor.ts:396-402); o evento não ganha dado, só a versão |
| **Cache stampede pós-evento** | F3+F6 | é exatamente o par que resolve: single-flight funde a rajada, reaquecimento a antecipa |

---

## 7. O que medir em F0, antes de mudar qualquer coisa

1. Tamanho serializado do delta por tabela (`overlayDoDelta().linhas`).
2. Custo de um MISS por página, com e sem worker.
3. Quantos pedidos concorrentes com a mesma chave acontecem de verdade
   (contador na chave, 1 h de operação).
4. Profundidade da fila da piscina, por origem.
5. Quantas páginas o pré-carregamento do navegador baixa e quantas são usadas.
6. Se `fs.watch` dispara mesmo no bind mount do compose (B8) — a mais barata
   e a que pode estar servindo dado velho hoje.

---

## 8. Se um dia houver mais de uma réplica

O único estado que não é derivável do disco é o conjunto `assinantesSSE`. Com N
réplicas, o poller passaria a rodar em uma só (lock no Redis com `SET NX PX`), e
`aoTabelaMudar` publicaria em `snapshot_updated`; cada réplica assinaria uma vez
(uma conexão `ioredis` dedicada, em modo subscriber) e faria o fan-out local que
já faz hoje. O carimbo do snapshot continua sendo a versão — ele vem do disco
compartilhado, e é igual para todas. É a peça descrita em D1, e ela não muda
nada do que está sendo construído aqui.
