# Deploy — plano de entrega para produção

> ## ⚠️ ESTE DOCUMENTO ESTÁ DESATUALIZADO — leia [PLANO-DUPLA.md](PLANO-DUPLA.md) §0 primeiro
>
> **Conferido no código em 04/09/2026.** Ele erra na direção mais perigosa: lista
> como *"não existe"* três coisas que **já estão commitadas**, e trabalhar por esta
> tabela é gastar dias reabrindo bloqueio fechado.
>
> | o que este documento diz | o que o código diz |
> |---|---|
> | §0/§2.1 "não existe login. A API serve todo número a todo pedido" | **existe e é testado** — Google SSO, 401 antes do roteamento (`apps/api/src/auth-google.ts`, `servidor.test.ts:782`) |
> | §0/§3 "não existe nenhum `Dockerfile`", "nenhum arquivo de Nginx", "nada nesta seção existe" | **existem** — `Dockerfile`, `docker-compose.prod.yml`, `nginx.conf` (commit `7642fab`) |
> | §0/§2.1 "as páginas que expõem dado pessoal" | **nenhuma das 14 specs de dashboard usa `QUADRO FUNCIONAL`** (onde estão CPF/RG). O dado está em `snapshot/`, não na tela |
> | §4/§7 "1357 testes verdes" | **2020** (17/09/2026; 1895 em 15/09, 1666 em 04/09) — o corpo foi corrigido em 17/09 |
> | §0 "SSE perdido com a árvore de 21/08" | **existe** — `EventSource('/api/eventos')` em `apps/web/src/App.tsx:153` |
>
> **Fechados em 04/09/2026, e o documento também erra ao mantê-los abertos:**
>
> | o que este documento trata como aberto | o que foi medido |
> |---|---|
> | "a piscina de workers autoriza 4 × 8 GB" | **4.608 MB autorizados** (pai 3.072 + 2 × 768), `mem_limit: 6g`, ACHADOS #98 |
> | "três queries têm defeito de carga" | expostas em `/api/saude` → `refresh.queries[]` com idade e estado, e a tela avisa (A2/A6, commits `c193490` / `58ac4b9`) |
> | "a stack nunca subiu" | subiu: **10/10 páginas pelo proxy na porta 80**, pico 4.356 MB de 6.144, `OOMKilled=false`, ACHADOS #99 e PLANO-DUPLA §A7 |
>
> **O que continua verdadeiro:** o refresh **não está agendado no host** (a linha do
> crontab está pronta, mas editar crontab de produção é ordem do Erick), a paridade
> não está fechada, não há TLS, e não existe usuário de banco somente-leitura de
> produção — hoje as credenciais do `.env` são as de desenvolvimento. Esses estão na
> fila em [PLANO-DUPLA.md](PLANO-DUPLA.md) §3 e §6.
>
> **E uma armadilha nova, que este documento ainda não descreve:** `env_file:`
> **sobrescreve o `ENV` da imagem**. O `Dockerfile` declara
> `ENV NODE_ENV=production` e, com `env_file: .env`, medimos `NODE_ENV=development`
> **dentro** do container. Por isso `docker-compose.prod.yml` passa `NODE_ENV` no
> bloco `environment:`, que vence os dois. Ver ACHADOS #99 §2.
>
> Não apaguei as seções erradas: a §3 tem o desenho da imagem e as armadilhas de
> `.env` (porta 3000 × 3100) que continuam valendo, e a §7 é uma boa lista de dia de
> deploy. Leia-as como projeto, não como estado.

> **Escrito em 21/08/2026, corrigido em 27/08/2026.** Este documento tem uma regra só: **separar o que está
> pronto do que parece pronto.** Ele não repete o histórico (isso é o `README.md`) nem
> o estado detalhado de cada camada (isso é o `CONTINUACAO.md`). Ele responde
> *"podemos publicar isto amanhã, e se não, o que falta exatamente?"*.
>
> A resposta curta: **o cálculo está pronto, a infraestrutura não existe, e dois
> bloqueios não são de infraestrutura** — não há login, e o `snapshot/` tem CPF, RG e
> endereço de cliente. Publicar sem resolver o §2.1 não é um deploy apertado; é um
> incidente de dado pessoal.

---

## 0. Painel de prontidão

> **Leia a data de cada linha, não o cabeçalho.** Esta tabela nasceu em 27/08/2026 e
> foi sendo corrigida linha a linha desde então — a data está dentro da célula. Em
> 17/09/2026 caíram as duas últimas que ainda diziam "não existe" sobre coisa
> commitada: **autenticação** e **proxy reverso**.

| frente | estado (a data está em cada linha) | bloqueia deploy? |
|---|---|---|
| Motor DAX + Widget Engine | 14 páginas, **117 de 117 visuais calculam**, 0 erros | não |
| Testes | **2020 verdes**, 0 falhando, nenhum precisa de credencial nem de build — medido em 17/09/2026 (eram 1357 em 27/08, 1666 em 04/09, 1895 em 15/09) | não |
| Cache + pré-aquecimento | resposta a quente medida em **2,9–6,2 ms**; `npm start` aquece as 14 páginas sem filtro (o pré-aquecimento por Ano/Mês foi perdido, §4) | não |
| Tela React | 14 páginas navegáveis, filtros na URL. **Sem SSE e sem store de filtros** — perdidos com a árvore de 21/08 (§4) | não |
| **Paridade com o Power BI** | **não fechada** — 42 cards em jogo, **18 batem**, 7 divergências reais na fila (§2.4) | **sim, para "substituir"** |
| **Autenticação** | **existe** desde o commit `eb69069`: Google SSO restrito a `sebratel.com.br` (`apps/api/src/auth-google.ts`), com portão de 401 antes do roteamento — o teste *"sem cookie de sessão, `/api/*` leva 401 antes de qualquer rota"*, em `apps/api/test/servidor.test.ts`, é o que o prova. Esta linha dizia "não existe" até 17/09/2026, contradizendo o próprio aviso no topo deste arquivo. **O que continua aberto é a §2.1: origem da identidade e o dado pessoal que a API serve** | não — mas ver §2.1 |
| **Refresh do dado** | `tools/refresh/` existe e é **100% automático** (06/09/2026): serviço `refresh` embutido no `docker-compose.prod.yml` rodando `daemon.ts` a cada 15 min, sem depender de crontab do host | **pronto** |
| **Snapshot diário completo** | (10/09/2026) serviço `snapshot-diario` embutido no `docker-compose.prod.yml`: cron **dentro do container** (`docker/cron/`), às 3h, materializando **24 das 25 queries** do catálogo. A de fora é `protocolos-produtividade`, e **o motivo original caiu**: até 17/09/2026 esta linha dizia "não materializa em nenhum modo hoje, #81", o que deixou de valer em **13/09/2026** — ela materializa ponta a ponta (**162 s**; o `manifesto.json` a traz com **77.452 linhas × 51 colunas**, carga de 16/09) e entrou no grupo `frio` de `specs/_catalog/refresh.yaml`. A ausência dela na lista do cron é hoje uma **decisão pendente, não um impedimento técnico** (~3 min a mais na madrugada) — `docker/cron/crontab-snapshot-diario` já traz esse aviso no comentário, e era este documento que não tinha sido alinhado. Ver §2.2 abaixo | **pronto — com uma decisão em aberto** |
| Containerização | **existe** (16/09/2026): `Dockerfile` na raiz, `docker-compose.prod.yml` com `api`/`redis`/`proxy` e `docker-compose.local.yml` como sobreposição de desenvolvimento | **pronto** |
| Proxy reverso | **existe** desde o commit `7642fab`: `nginx.conf` na raiz, montado como `/etc/nginx/conf.d/default.conf` no serviço `proxy` do `docker-compose.prod.yml` (`nginx:1.27-alpine`, porta 80). Traz `/`, `/api/` com `proxy_read_timeout 90s` (o padrão de 60 s cortava `agendamento-field` a frio), `/api/eventos` com as quatro linhas de SSE e `/auth/`. Até 17/09/2026 esta linha dizia "não existe" — errado desde então | **pronto** |
| TLS | **não existe** — o `nginx.conf` só tem `listen 80`, e a publicação da porta 443 está comentada no compose. O que falta é o **certificado**, decisão de infraestrutura e não do repositório (§3.3) | sim |
| Processo supervisionado | **mudou em 19/09/2026, e o bloqueio caiu pela metade.** A cadência do refresh deixou de depender do Agendador de Tarefas do Windows: ela é um relógio por grupo dentro do processo da API (`apps/api/src/agendador.ts`), e em produção quem supervisiona é o `restart: unless-stopped` do `docker-compose.prod.yml`, que já existe. **O que sobra:** no host, fora do Docker, nada reergue a API se o processo morrer — `npm start` não a ressuscita, de propósito (a morte mais comum dela é outra instância tomando a porta 3100). A resposta para isso é subir pelo compose, não registrar tarefa de host. Ver §2.2 | **não, se subir por Docker**; sim, se rodar `npm start` a seco |
| CDC contra o Voalle real | validado só contra a stack descartável de `docker/cdc/` | não — está fora do deploy (§5) |

**Em uma frase, e ela mudou em 17/09/2026:** os artefatos de infraestrutura **estão
escritos** — imagem, compose, proxy e agendamento existem em commit. O que falta são
**decisões e um certificado**: a origem da identidade e o que fazer com dado pessoal na
tela (§2.1), o TLS (§3.3), registrar a tarefa do Agendador nesta máquina (§2.3) e
decidir se `protocolos-produtividade` entra no cron diário (§2.2). Nada do que falta é
cálculo — e, dos cinco, só o primeiro não é um comando de alguém.

> A frase anterior dizia *"faltam três decisões e quatro artefatos de infraestrutura
> que ainda não têm uma linha escrita"*. Os quatro artefatos foram escritos entre
> 04/09 e 16/09; esta linha só não tinha sido refeita.

---

## 1. O que está pronto, com o número que prova

Cada linha aqui tem um comando que reproduz a afirmação. Linha sem comando não entra.

| afirmação | como conferir |
|---|---|
| 2020 testes verdes, sem credencial e sem build (17/09/2026) | `npm test` |
| as 14 páginas calculam, 117 visuais, 0 erros | `npm run paginas -- --pagina=<uma>` |
| a API responde a quente em milissegundos, e diz qual adapter de cache está ligado | `curl localhost:3100/api/saude` |
| a tela sobe compilada, aquecida, e reprova se algum visual falhar | `npm start` |
| a plataforma nunca escreve na fonte — quatro camadas independentes | `npm run doctor` |
| o snapshot guarda o tipo de cada coluna (data não vira texto) | `npm run snapshot:confere` |

O que **não** está nesta tabela — porque não tem número — não é entrega: é intenção.
Em particular, "interface idêntica ou superior ao Power BI" não está medido em lugar
nenhum e não deve aparecer em nota de release.

---

## 2. Os bloqueios que não são infraestrutura

Estes três vêm antes de qualquer Dockerfile, porque nenhum deles se resolve com
configuração. Comprar servidor não os move.

### 2.1 O login existe; o que não está decidido é a origem da identidade

> **Esta seção se chamava "Não existe login, e o dado é pessoal" e abria dizendo que a
> API não autentica ninguém. Isso caiu no commit `eb69069` e só foi corrigido aqui em
> 17/09/2026.** O critério de saída que ela mesma define — *"um pedido sem sessão válida
> recebe 401 antes do roteamento, com teste que falha se a trava for removida"* — **está
> cumprido**: o teste é *"sem cookie de sessão, /api/\* leva 401 antes de qualquer
> rota"*, em `apps/api/test/servidor.test.ts`. O que segue continua verdadeiro, e é o
> motivo de esta seção não ser fechada: a **origem** da identidade ainda é decisão de
> produto, e o dado que a API serve continua sendo pessoal.

Hoje a entrada é Google SSO restrito ao domínio `sebratel.com.br`
(`apps/api/src/auth-google.ts`), com sessão em cookie e portão de 401 antes do
roteamento. A costura de autorização existe (`apps/api/src/identidade.ts`, e a chave do
cache já carrega o usuário para que nenhum recorte futuro seja servido para a pessoa
errada) e há **formato de decisão** (`specs/_catalog/permissoes.yaml`) — o que falta é a
decisão de **quem** é a fonte da identidade (SSO do HUBBI ou usuário local) e, com ela,
o leitor de permissões.

**Autenticar não é autorizar, e é por isso que a seção fica aberta.** Hoje qualquer
pessoa com e-mail `@sebratel.com.br` que entre vê **tudo**, porque não há leitor de
permissões — e o que a API serve inclui:

- endereço de cliente, em `field-agenda`;
- **CPF e RG**, em `QUADRO FUNCIONAL`;
- **39 MB** de dado operacional consolidado, em `snapshot/` — 1.418.935 linhas nas 23
  tabelas do `manifesto.json`, gravadas em 30 arquivos `.jsonl.gz` (as 23 mais 7
  calculadas, com prefixo `calc.`). (Este documento dizia **371 MB**, de 26/08/2026, até
  17/09/2026; a medição e a causa estão na §3.1.)

- **Quem destrava:** decisão de produto sobre a origem da identidade — SSO do HUBBI ou
  usuário local. Enquanto ela não vier, não há o que implementar sem chutar. **Este é o
  único item desta seção que ainda depende de decisão humana.**
- ~~**Critério de saída:** um pedido sem sessão válida recebe **401** antes do
  roteamento, com teste que falha se a trava for removida — a mesma disciplina dos
  405.~~ **CUMPRIDO** em `eb69069`; o teste que falha se a trava sair está em
  `apps/api/test/servidor.test.ts`.
- **Critério de saída que resta:** nenhum usuário autenticado alcança página com dado
  pessoal que o papel dele não autorize — e isso exige o leitor de
  `specs/_catalog/permissoes.yaml`, hoje em `ESTADO: DESENHO` (há teste que reprova se
  o estado mudar sem `apps/api/src/escopo-cache.ts` mudar junto).
- **Mitigação aceitável para um piloto interno** (não é o deploy final): publicar
  **apenas na rede interna**, atrás do SSO que já existe no HUBBI, com a URL não
  divulgada e as páginas que expõem dado pessoal fora do menu. Isso é um piloto de
  alcance reduzido, e precisa ser dito com essas palavras a quem aprovar.

### 2.2 O refresh é automático, e desde 19/09/2026 ele mora dentro da API

> **MUDANÇA DE ESTRATÉGIA — 19/09/2026. Leia isto antes do resto da seção, porque
> o resto foi escrito para a arquitetura anterior.**
>
> A cadência dependia de uma corrente de três elos, e cada um caía sozinho e em
> silêncio:
>
> ```
> Agendador de Tarefas do Windows  ->  npm start  ->  daemon (processo à parte)
> ```
>
> O primeiro elo é configuração de MÁQUINA, não do repositório. Enquanto ele não
> estivesse registrado naquele Windows, um reboot deixava tudo parado — e foi
> exatamente isso em 16/09/2026 (§2.3).
>
> **Os três elos viraram um.** O agendador agora é um relógio por grupo dentro do
> processo da API (`apps/api/src/agendador.ts`), e quem supervisiona é o
> `restart: unless-stopped` do Docker. É o desenho do dashboard comercial
> `COM · Gestão Comercial`, adaptado ao nosso volume de dado — o cabeçalho daquele
> arquivo lista item a item o que foi copiado e o que não foi, com o motivo medido.
>
> O que mudou na prática:
>
> | antes | agora |
> |---|---|
> | `npm start` subia um segundo processo (`daemon.ts`) | `npm start` sobe só a API; ela mesma agenda |
> | um tick global de 15 min varria os três grupos | um relógio POR GRUPO, na cadência declarada de cada um |
> | grupo lento fazia os outros PERDEREM a vez (`ciclo-pulado`), sem nada ficar vermelho | grupo atrasado ESPERA a fila; só o disparo do grupo contra ele mesmo é descartado, e vira `disparo-coalescido` no histórico |
> | `refresh-status.json` não distinguia "não falhou" de "não rodou" | `GET /api/saude` traz o bloco `agendador`, com `ativo` e o motivo de estar desligado |
> | a tarefa do Windows era pré-requisito para a cadência existir | a tarefa do Windows **não é mais necessária para o refresh** |
>
> **Produção continua com o container `refresh` separado, e isso é deliberado.** O
> serviço `api` do `docker-compose.prod.yml` ganhou `AUTO_REFRESH: false`, porque o
> `mem_limit` dele é 6g (dimensionado com `npm run probe:memoria-api`, RSS de pico
> 3137–3622 MB) e uma materialização dispara um filho com
> `--max-old-space-size=8192` — `protocolos-geral` já precisou de 12 GB. Esse filho
> nasceria dentro do cgroup da API e o OOM killer levaria a tela junto com a carga.
>
> **Dois agendadores NÃO podem coexistir**: os dois fariam read-modify-write no
> mesmo `manifesto.json` e um apagaria as tabelas que o outro acabou de registrar,
> sem erro nenhum. Se um dia a API passar a agendar em produção, o serviço
> `refresh` tem de sair do compose na mesma alteração.
>
> **E isto aconteceu na estação de trabalho, não em produção (ACHADOS #148).** A
> stack de compose, subida para teste em 09/09, voltava sozinha a cada boot do Docker
> Desktop (`restart: unless-stopped`) com a imagem de 09/09, e escreveu no mesmo
> `snapshot/` do `npm start` em 15, 16 e 22/09 — com specs velhas e formato 1. Quem
> sobe a stack de container nesta máquina tem de derrubá-la (`docker compose -f
> docker-compose.prod.yml down`) antes de voltar ao `npm start`.
>
> O daemon (`tools/refresh/src/daemon.ts`) **continua existindo e continua**
> **correto** — é ele que o container de produção roda, e `--historico` continua
> sendo o relatório de operador dos dois agendadores.


> **Esta seção abria com *"hoje o refresh é uma pessoa digitando `npm run snapshot`"* até
> 17/09/2026**, e o próprio corpo dela desmentia isso em três lugares. A abertura é de
> 21/08; o daemon é de 06/09. Quem lesse só o primeiro parágrafo reabria um item
> fechado.

**O que existe hoje, e roda sem ninguém digitar nada:**

- **O daemon de refresh** (`tools/refresh/`) executa o que venceu em
  `specs/_catalog/refresh.yaml`, em série, e grava `snapshot/refresh-status.json` depois
  de cada grupo. Em produção ele é um serviço do `docker-compose.prod.yml`, de 15 em 15
  minutos; em desenvolvimento, `npm start` o sobe em background junto com a API, **sem
  flag nenhuma** desde 16/09/2026. Os três grupos declarados hoje são `quente`,
  `medio` e `frio`.
- **Ele tem histórico** (`tools/refresh/src/historico.ts`, 16/09/2026):
  `snapshot/refresh-historico.log`, uma linha por evento (`arranque`, `grupo`,
  `erro-de-ciclo`), lida com `node tools/refresh/src/daemon.ts --historico`. Existe
  porque o `refresh-status.json` guarda **só a última tentativa por grupo** — uma falha
  às 03:00 que o tick das 03:15 conserta não deixava rastro nenhum.
- **Ele ressuscita se morrer** (`tools/subir/src/supervisao.ts`): espera crescente
  5s→15s→45s→2min→5min, só conta como tentativa a morte com menos de um minuto de vida,
  e **no teto desiste em voz alta** com o comando de diagnóstico — respawn sem limite
  esconderia um `.env` quebrado para sempre.
- **O catálogo inteiro é rematerializado às 3h** pelo serviço `snapshot-diario`, com
  cron dentro do container (`docker/cron/`) — é ele que corrige alteração retroativa que
  a cadência de minutos não vê.

**O que ainda falta, e é honestamente o buraco desta seção:** quem ressuscita o daemon é
o próprio `npm start`; se **ELE** morrer, ou se a máquina reiniciar, não há nada.
`tools/subir/agenda-no-windows.ps1` registra a plataforma no Agendador de Tarefas do
Windows (tarefa `Analytics Sebratel - plataforma`, gatilho "ao fazer logon" por padrão),
mas **ela não está registrada nesta máquina** — conferido em 17/09/2026 com
`Get-ScheduledTask`, que não a encontra. Registrar exige PowerShell como Administrador,
e por isso é **pendência do Erick**, não de um agente. É essa falta que produziu o
incidente da §2.3.

> **Correção em 22/09/2026:** a tarefa **está registrada** (`Get-ScheduledTask` a
> mostra, estado `Ready`; foi provada ponta a ponta no #138, que também derrubou a
> exigência de Administrador). O buraco que sobra é outro: o gatilho é "ao fazer
> logon", então uma API que morre com a sessão aberta não volta até o próximo logon —
> foram seis horas em 22/09 (ACHADOS #149).

O restante desta seção é o histórico de como se chegou aqui, e cada armadilha continua
valendo para quem for mexer na cadência.

- **O que já existe:** `GET /api/saude` responde de quando é o que está em disco, e o
  carimbo do snapshot entra na chave do cache — rematerializar invalida sozinho.
- **O menor caminho que fecha o item:** uma tarefa agendada (Agendador de Tarefas do
  Windows, ou `cron` no host Linux) rodando `npm run snapshot -- --todas --refazer
  --memoria=8192` na janela de menor uso, seguida de `npm run snapshot:calculadas`.
  **Sem `--refazer`, `--todas` pula toda query que já tem arquivo** e o refresh não
  acontece; e rematerializar as queries sem refazer as calculadas deixa congelado velho
  em disco.
- **Critério de saída:** duas execuções consecutivas sem intervenção humana, e a data
  do `/api/saude` avançando sozinha entre elas.
- **Armadilha registrada:** rematerializar troca o carimbo e derruba **todo** o cache
  de resposta. Não agende a janela sobre o horário de uma apresentação.
- **Até 02/09/2026, esta sequência quebrava sempre na segunda metade.** `--todas
  --refazer` (as *queries*) rodava, mas `npm run snapshot:calculadas` (o encadeamento
  automático que o congela) tinha `SyntaxError` e `ReferenceError` desde 26/08 — ver
  `ACHADOS.md` #78 e §4.2 abaixo. Uma tarefa agendada configurada antes do conserto
  teria rodado a etapa 1 e falhado
  calada na 2 — o `/api/saude` continuaria respondendo, com o congelado cada vez mais
  velho. Consertado e verificado ao vivo.
- **O Refresh Manager existe** (`ACHADOS.md` #84): `tools/refresh/` roda um tick —
  o que está vencido em `specs/_catalog/refresh.yaml`, em série, grava
  `snapshot/refresh-status.json` depois de cada grupo, e `GET /api/saude` expõe o
  bloco `refresh`. `npm run refresh -- --plano` mostra o que rodaria sem tocar nada.
  **O agendamento é 100% automático de fábrica** (06/09/2026):
  - Em produção (Docker Compose / Portainer): o `docker-compose.prod.yml` já traz
    o serviço `refresh` embutido executando `tools/refresh/src/daemon.ts` a cada
    15 minutos com `mem_limit: 8g` e o volume `${SNAPSHOT_DIR_HOST:-./snapshot}`
    compartilhado com a API. Subir a stack já sobe o agendador ativo.
  - No desenvolvimento: `npm start` já sobe o daemon em background lado a lado com a
    API — **sem flag nenhuma, desde 16/09/2026**. Para rodar isolado:
    `npm run refresh:daemon`. Para NÃO subir: `npm start -- --sem-refresh`, ou
    `AUTO_REFRESH=false`/`0` no ambiente.

    **E se o daemon morrer, o `npm start` o ressuscita** (16/09/2026). Antes, a morte
    dele rendia uma linha de `console.error` e mais nada: a API seguia servindo, a tela
    seguia abrindo, e o dado parava no tempo sem nada mudar de cor. Foi observado ao
    vivo em 16/09 — a stack fora do ar, último tick às 10:25, três horas e quarenta e
    três minutos depois os três grupos apareciam vencidos sem que nada tivesse avisado
    ninguém. A regra está em `tools/subir/src/supervisao.ts`: espera crescente
    (5s→15s→45s→2min→5min), só conta como tentativa a morte que acontece com menos de
    um minuto de vida, e no teto ele **desiste em voz alta** com o comando de
    diagnóstico — respawn sem limite esconderia um `.env` quebrado para sempre.

    **Isto não substitui um supervisor de verdade.** O que ressuscita o daemon é o
    próprio `npm start`; se ELE morrer, ou se a máquina reiniciar, não há nada. O
    docstring de `tools/refresh/src/index.ts` já previa exatamente isso ao recusar o
    modelo de daemon 24/7 — *"o Windows não tem PM2/systemd hoje; viraria um processo
    que ninguém reinicia sozinho"*. Falta a linha de cima: uma entrada no Agendador de
    Tarefas do Windows com gatilho "ao iniciar o sistema".

    **O que ficou escrito, e onde.** `snapshot/refresh-status.json` guarda só a ÚLTIMA
    tentativa por grupo — uma falha às 03:00 que o tick das 03:15 consertou zera
    `falhasConsecutivas`, apaga o `erro` e não deixa rastro nenhum. Desde 16/09 há
    também `snapshot/refresh-historico.log`, uma linha por evento (`arranque`,
    `grupo`, `erro-de-ciclo`), aparado por tamanho e nunca capaz de derrubar um tick.
    Leia com:

    ```bash
    node tools/refresh/src/daemon.ts --historico
    ```

    Ele é seguro de rodar com o daemon vivo — lê e sai, sem subir agendador nenhum.

    Até 16/09/2026 isto exigia `--com-refresh`, e essa exigência é que quebrou na
    prática o "100% automático de fábrica" acima: o `npm start` no ar naquele dia
    tinha sido lançado sem a flag, nada materializava desde as 02:57, e o card
    "HORA MAIS RECENTE" marcava 5h36 de idade num grupo declarado de 15 min. Não
    havia nada no Agendador de Tarefas do Windows para suprir a falta — o gatilho
    externo que `tools/refresh/src/index.ts` pressupõe nunca foi criado na máquina
    do Erick. O padrão inverteu por isso: cadência que depende de alguém lembrar de
    uma flag não é cadência. `--com-refresh` continua aceito e virou no-op, para
    não quebrar quem seguiu a instrução antiga.
  - O script externo de cron (`tools/refresh/cron.sh`, ACHADOS #91) continua disponível
    como opção caso um ambiente sem container necessite de crontab no host Linux, mas
    NÃO é mais requisito para rodar a stack de produção. **O primeiro
  tick real já valeu a pena antes de ser agendado**: achou duas queries que não
  podiam estar num grupo de 15 minutos — `field-agenda` custa 21min49s de verdade,
  não os 22,0s documentados (#82), e `protocolos-geral` crasha por uma dependência
  de npm que falta, `mysql2` (#83). As duas saíram de `refresh.yaml` até serem
  resolvidas; os grupos que sobraram (~11s e ~24s medidos ao vivo) são seguros
  para a cadência declarada.
- **Snapshot diário COMPLETO, separado da cadência de minutos (10/09/2026).** O
  `refresh.yaml` acima só cobre uma fatia (`quente`/`medio`/`frio`); o resto do
  catálogo (o que hoje só roda manual com `npm run snapshot -- --todas`) ficava
  sem cadência nenhuma, e a carga incremental dos grupos rápidos não corrige
  alteração retroativa. Serviço novo `snapshot-diario` no
  `docker-compose.prod.yml`: cron **dentro do container**
  (`docker/cron/crontab-snapshot-diario`, estágio `cron` do `Dockerfile`, `FROM
  runtime` — não duplica o build), às 3h, `--query=` com a lista explícita do
  catálogo **menos** `protocolos-produtividade` (mesma trava de
  `tools/refresh/src/grupos.ts`/`QUERY_BLOQUEADA`, replicada aqui porque
  `--query=` não tem exclusão embutida).
  - **`protocolos-geral` NÃO está mais bloqueada — a nota do #83 acima (linha
    165) está desatualizada.** `mysql2` já está instalado (`package.json` e
    `node_modules`); o achado mais recente em `ACHADOS.md` ("O snapshot em
    disco precisou de mais memória que o padrão") mostra a query rodando com
    sucesso — 93.580 linhas, 63 colunas — desde que o processo tenha
    `--memoria=12288` (12 GB; o padrão de 8192 do daemon de refresh estoura o
    heap). O job diário usa 12288 só para ela; as outras ~23 precisam de bem
    menos, e cada query roda no seu próprio subprocesso
    (`tools/snapshot/src/index.ts`, `rodaEmSubprocesso`) — uma falha não
    derruba as demais.
  - **Cron não herda o ambiente do container.** `env_file:` só define
    `DB_VOALLE_*`/`DB_MARIA_*` para o processo principal; um job de
    `/etc/cron.d/` roda como filho do daemon `cron`, com ambiente próprio e
    vazio. `docker/cron/entrypoint.sh` grava o ambiente do container em
    `/repo/.env.cron` na subida (aspas simples, escapando `'` interno — testado
    com senha contendo `#`, `$` e `'` de verdade) e o job faz `. /repo/.env.cron`
    antes de rodar.
  - **`mem_limit: 14g`** — 12 GB de heap para `protocolos-geral` mais ~2 GB de
    folga (processo pai, buffers do `.jsonl.gz`, o que não é heap). Presume
    servidor com RAM de sobra além do que `api`/`redis`/`refresh` já reservam
    (14,5 GB); **não é a mesma máquina de ~15,7 GB** citada em
    `docs/DECISOES-DAS-SESSOES.md`
    §3.5 — confirme antes de subir se o host do Portainer mudar.
  - **A cadência de segundos ("near-realtime") já existe e não precisou de
    nada novo:** `specs/_catalog/realtime-poll.yaml` +
    `apps/api/src/poller-realtime.ts`, ligado sozinho quando a API sobe,
    fazendo `SELECT` direto no Voalle a cada 12-30s para 7 queries, só em
    memória (nunca grava no snapshot em disco, nunca paga o recongelamento das
    calculadas). O snapshot diário e o refresh de minutos cobrem o resto do
    catálogo; o poller já cobre o que precisa de segundos.
- **E a escrita em si não era segura rodar com a API no ar — também consertado.**
  `ACHADOS.md` #79 / §4.3: no Windows, renomear o arquivo novo por cima do antigo
  falhava **sempre** (medido: 100%) enquanto um pedido de página tinha aquele `.jsonl`
  aberto para leitura. Com retentativa (`packages/snapshot/src/escrita-atomica.ts`),
  100% de sucesso contra leituras de até 25 ms — mas **sem dado real** de quanto tempo
  uma leitura leva sob carga real, nem do antivírus do servidor de deploy (Sonda 2 do
  plano de atomicidade, ainda pendente por exigir a máquina de produção).
- **A carga incremental foi ligada ao materializador de verdade** (`ACHADOS.md` #80)
  — `--incremental` decide, costura o SQL, busca só a janela e mescla com o que já
  está em disco, em vez de só imprimir um relatório que nunca correspondia à busca
  real.
  - **A única query com política (`protocolos-produtividade`) NÃO está mais bloqueada
    — corrigido aqui em 17/09/2026.** Este parágrafo dizia *"não materializa em nenhum
    modo hoje"* (`ACHADOS.md` #81: SQL e M calculando as mesmas três colunas, e o
    full-fetch passando do teto de 600 s), e isso deixou de valer em **13/09/2026**:
    ela materializa ponta a ponta em **162 s** e entrou no grupo `frio` de
    `specs/_catalog/refresh.yaml`, com cadência de 30 min. O `manifesto.json` a traz
    com **77.452 linhas × 51 colunas**. A trava de `tools/refresh/src/grupos.ts` virou
    `QUERIES_BLOQUEADAS`, um `Set` **vazio**, de pé só para a próxima query que provar
    não materializar.
  - O que continua verdadeiro é bem menor: ela segue **fora da lista do cron diário**
    (`docker/cron/crontab-snapshot-diario`, 24 das 25 queries do catálogo), e isso é
    hoje **decisão pendente, não impedimento técnico** — acrescentá-la custa ~3 min a
    mais na madrugada. O comentário daquele crontab já avisa; era este documento que
    não tinha sido alinhado.

### 2.3 Nada sobe a plataforma depois de um reboot — e isso já derrubou tudo

Em 16/09/2026, às 14:04, **não havia processo nenhum da plataforma na máquina**. O
último tick era das 10:25: três horas e quarenta e três minutos de dado parado. Nada
avisou, e `refresh-status.json` marcava `falhasConsecutivas: 0` nos três grupos — ele não
distingue "não falhou" de "não rodou". Ver `ACHADOS.md` #129.

A supervisão de `tools/subir/src/supervisao.ts` (§2.2 acima) fecha a queda do daemon,
não esta: quem ressuscita o daemon é o próprio `npm start`, e o que faltava era alguém
acima dele.

- **O que já existe:** `tools/subir/agenda-no-windows.ps1`, o análogo Windows de
  `tools/refresh/cron.sh` um nível acima — lá se agenda um *tick*, aqui a *stack*.

  ```powershell
  # o que ele faria, sem privilégio nenhum e sem tocar no Agendador
  powershell -ExecutionPolicy Bypass -File tools/subir/agenda-no-windows.ps1 -Simular

  # registrar (PowerShell como Administrador)
  powershell -ExecutionPolicy Bypass -File tools/subir/agenda-no-windows.ps1

  # desfazer
  powershell -ExecutionPolicy Bypass -File tools/subir/agenda-no-windows.ps1 -Remover
  ```

- **O gatilho padrão é "ao fazer logon", não "ao iniciar o sistema"**, e é decisão, não
  descuido: `npm start` precisa do `.env` do repositório e de
  `~/.secrets/powerbi-token.json`, que são do perfil do usuário — uma tarefa como SYSTEM
  não os enxerga; e "ao iniciar o sistema" com a identidade do usuário exige senha
  guardada no Agendador ou `-LogonType S4U`, que roda sem console na sessão 0. Para uma
  máquina que fica ligada sem ninguém logado, `-AoIniciarOSistema` registra a variante
  S4U — e aí o `snapshot/npm-start.log` passa a ser a única janela para o que aconteceu.
- **Subir duas vezes não é risco:** `tools/subir/src/porta.ts` já decide entre derrubar
  quem ocupa a porta e parar, e a tarefa é registrada com `MultipleInstances IgnoreNew`
  como segunda camada.
- **Critério de saída:** a máquina reinicia, ninguém digita nada, e a idade em
  `GET /api/saude` volta a cair sozinha.
- **Em produção de verdade isto não se usa:** `docker-compose.prod.yml` já traz `api`,
  `refresh` e `snapshot-diario` como serviços, e política de reinício de container
  resolve boot e queda sem Agendador nenhum. O script é para a estação de trabalho onde
  a plataforma roda hoje.

### 2.4 A paridade não está fechada

**REFEITO EM 18/09/2026, contra o relatório confirmado.** Este parágrafo dizia: *"42
em jogo: 18 batem, 18 diferem (…) a fila real são 7 divergências, a primeira sendo
`TOTAL INSTALADOS` de `manutencao-inicial`, 34% maior do nosso lado"*. Aquele card
**bate hoje** (95.679 contra 95.686): os 34% eram a janela bloqueada de
`PROTOCOLOS GERAL`, não defeito. Varrendo as 11 páginas pelo HTTP de verdade:

```
49 batem · 18 diferem · 0 ausentes · 0 erros
```

E as 18 que diferem têm todas causa escrita — **nenhuma sem explicação**:

| quantas | o que é |
|---|---|
| 11 | `Hora mais recente` — carimbo de refresh de cada lado, instantes diferentes |
| 4 | `FIELD AGENDA`, bloqueada: 1.739.231 linhas lá contra 41.584 aqui |
| 2 | `Primeiro Classificacao` — previsão do tempo, atualiza sozinha |
| 1 | `# MEDIA INSTALADO BACKLOG` — `MIN([DATA INSTALAÇÃO])` difere em 16 dias |

O que destravou isso foi **confirmar contra qual relatório se estava medindo** (ver
ACHADOS #141): seis tabelas ganharam janela provada, onde antes havia zero. Dois
defeitos nossos apareceram no caminho e foram corrigidos — um espaço no fim de
`TIPO DE PROTOCOLO` e o comparador de datas que comparava texto com objeto.

Isto **continua não bastando** para a frase "substitui o Power BI": três tabelas
seguem bloqueadas (`FIELD AGENDA`, `REINCIDÊNCIA`, `INSTALAÇÕES REINCIDENTES`) e 20
cards ficam sem gabarito automático por dependerem delas. O caminho e os critérios
estão em `CONTINUACAO.md` §9.1 — não os duplico aqui de propósito.

---

## 3. O que falta de infraestrutura

Nada nesta seção existe no repositório hoje. É trabalho a fazer, não configuração a
ajustar.

### 3.1 Imagem da aplicação

Não há `Dockerfile`. Três particularidades deste repositório mudam o desenho da imagem:

- **Não há passo de build no backend.** O Node 22+ executa TypeScript direto; a imagem
  não precisa de `tsc` para a API. O **frontend** sim: `npm run web:build` roda
  `tsc --noEmit` e o Vite.
- **A API precisa de heap grande.** `npm run api` sobe com
  `--max-old-space-size=10240` e `--expose-gc` porque ela mantém tabelas carregadas em
  memória. Uma imagem sem esse flag, ou um container com limite de memória menor que
  isso, morre com OOM **sob carga** — não no arranque, que é o pior momento para
  descobrir.
- **O `snapshot/` não vai dentro da imagem.** São **39 MB** de dado de cliente, e ele
  muda a cada refresh: é **volume**, e um volume que precisa de backup e de política de
  retenção como qualquer base com dado pessoal. **O que obriga a tratá-lo assim é o dado
  pessoal, não o tamanho** — por isso a conclusão desta linha não muda com o número.

  > **De onde vinha o "371 MB", corrigido em 17/09/2026.** O número entrou com a
  > primeira versão deste arquivo (`0aae15c`, 26/08/2026) e nunca foi revisto. Medido
  > agora: `du -sb snapshot/` = **40.342.840 bytes (39 MB)**, e a soma dos `bytes` do
  > `manifesto.json` dá 38,3 MB — erro de ~9,5×.
  >
  > **O que o derrubou:** `0296cae` (04/09/2026), *"grava .jsonl.gz — 723,9 MB de
  > snapshot viram 50,3 MB"*. O snapshot passou a ser gravado comprimido. Descomprimido,
  > o catálogo de hoje ainda soma **172 MB** (`gzip -l` somado), contra 39 MB em disco.
  > Depois vieram `1f55b22` (formato 2 em disco, uma linha por coluna) e `949591d`,
  > ambos de 15/09, que mexem na forma e na leitura.
  >
  > **O que NÃO se sabe:** de onde saiu exatamente o 371. Não bate com os 723,9 MB
  > pré-gzip do `0296cae` nem com os 172 MB descomprimidos de hoje, e o commit que o
  > introduziu não traz medição nenhuma. Pode ter sido uma materialização parcial do
  > catálogo (era 26/08, antes de várias queries entrarem) ou pode nunca ter sido
  > medido. **Fica registrado como não achado, em vez de receber causa inventada.**
  >
  > **Ao dimensionar volume de produção:** 39 MB é o dado de UM dia. Quem guardar
  > histórico multiplica por retenção — e o que se paga em disco é o comprimido.

- **Critério de saída:** `docker run` da imagem responde `/api/saude` com o mesmo JSON
  que a execução local, apontando para um volume de snapshot montado de fora.

### 3.2 `docker-compose` de produção

⚠ **Não existe mais `docker-compose.yml` na raiz.** Até 16/09/2026 este parágrafo
dizia que ele subia *Redis e Kafka* e servia de infra local — e o arquivo não está no
repositório; nenhum compose declara Kafka. A descrição sobreviveu ao arquivo, e o
estrago é concreto: é ela que faz alguém apontar `REDIS_URL` para
`redis://localhost:6379` num `.env` de desenvolvimento, onde nada escuta. O sintoma
é o log `[cache] Redis desligado do caminho por 10s após 3 falhas seguidas` a cada
pedido, com a memória servindo por baixo.

**Onde o Redis existe hoje:** só em `docker-compose.prod.yml`, como serviço `redis`,
alcançável pelo nome `redis` dentro da rede do compose (`REDIS_URL` é montada lá, com
`REDIS_PASSWORD`). Rodando **fora** do compose (`npm run api`, `npm start`) não há
Redis nenhum: deixe `REDIS_URL` comentada e o cache é o de memória, que é o padrão
documentado no §3.5.

Para desenvolvimento há `docker-compose.local.yml`, que é **sobreposição** e não
stack própria — ele só rebaixa `NODE_ENV` e liga `SEM_LOGIN`, e se usa com os dois
`-f` (o cabeçalho do arquivo traz os comandos).

O de produção tem três serviços: `api`, `redis` e `proxy`. **A tela não é um serviço:**
a API já serve o build estático na raiz. Um container de Nginx servindo o React *e*
outro servindo a API é peça a mais sem problema que resolva — o proxy entra pelo TLS
(§3.3), não por causa do estático.

- **Critério de saída:** `docker compose -f docker-compose.prod.yml up -d` sobe tudo, e
  matar o container da API o traz de volta sozinho pelo healthcheck.

#### 3.2.1 Rodar a stack de produção na sua máquina — e por que ela recusa subir

Se `docker compose -f docker-compose.prod.yml up` morrer com
`[login] RECUSANDO SUBIR`, **não é defeito: é a guarda.** O `.env` de
desenvolvimento tem `GOOGLE_CLIENT_ID` vazia, e uma API sem credencial serve
CLIENTE, TELEFONE e endereço a quem alcançar a URL — foi o que ela fez, de fato, na
primeira subida desta stack (ACHADOS #99).

Use a sobreposição, que declara as duas coisas de uma vez:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml up -d --build
API_PORT_HOST=3101 docker compose -f docker-compose.prod.yml -f docker-compose.local.yml up -d
```

O que ela faz: `SEM_LOGIN=1` (sim, quero servir sem autenticação) **e**
`NODE_ENV=development` (e não, isto não é produção). A guarda **recusa** as duas
combinadas com `NODE_ENV=production`, de propósito, para que ninguém desligue o
login *fingindo* estar em produção — ver `apps/api/src/portao-login.ts`.

**Não** transforme a sobreposição em atalho para produção. Em produção o caminho é
preencher `FIREBASE_PROJECT_ID` (ou `GOOGLE_CLIENT_ID`) e `DOMINIO_CORPORATIVO`, e aí
a guarda sai da frente sozinha.

Para conferir que a guarda continua viva, suba **sem** a sobreposição: o container
tem de morrer com saída 1.

> **Desde 16/09/2026 este `.env` TEM `FIREBASE_PROJECT_ID` preenchida**, e é isso que
> torna o parágrafo acima menos frequente do que era: a stack de produção sobe nesta
> máquina sem sobreposição nenhuma, porque agora existe credencial de verdade. O
> teste que prova que a guarda continua fechando é
> `apps/api/test/portao-login.test.ts`, "produção com as DUAS credenciais vazias".

#### 3.2.2 O login, hoje: Firebase Authentication

A tela entra por **Firebase Authentication**, provedor Google, restrito ao
`DOMINIO_CORPORATIVO` (decisão do Erick, 16/09/2026). Antes era Google Identity
Services puro; as duas rotas continuam de pé, e qual delas a tela usa é decisão de
configuração, não de código:

| rota | ligada por | quem usa |
|---|---|---|
| `POST /auth/firebase` | `FIREBASE_PROJECT_ID` + as quatro `VITE_FIREBASE_*` | a tela |
| `POST /auth/google` | `GOOGLE_CLIENT_ID` + `VITE_GOOGLE_CLIENT_ID` | ambiente que não migrou |
| `POST /auth/interno` | `TOKEN_INTERNO` | `npm run tela` (navegador de verdade, sem conta) |

As três emitem a **mesma** sessão — cookie `HttpOnly`, TTL de `SESSAO_TTL_HORAS` — e
`App.tsx` não sabe qual foi usada. Cada uma falha **fechada**: sem a variável que a
liga, nenhum token cria sessão, nem um legítimo.

**A diferença de garantia que o Firebase trouxe, e que precisa estar num documento e
não só num comentário.** O token do Google Identity traz o claim `hd` (hosted domain),
assinado pelo Google e impossível de forjar; **o token do Firebase não traz**. A
checagem de domínio passou a ser feita sobre o e-mail, exigindo três coisas juntas
(`sign_in_provider === 'google.com'`, `email_verified === true`, e o domínio depois do
último `@` **igual**, não sufixo). O que fecha a diferença por completo é uma
*blocking function* `beforeSignIn` no console do Firebase recusando `hd` diferente —
exige plano Blaze, e **ainda não está ligada**. Ver o cabeçalho de
`apps/api/src/auth-firebase.ts`.

**Duas coisas a conferir no console do Firebase antes de publicar:**

1. *Authentication → Sign-in method*: só **Google** habilitado. Deixar e-mail/senha
   ligado não derruba a checagem acima (ela exige `google.com`), mas cria contas no
   projeto que nunca vão logar — ruído que confunde quem for auditar.
2. *Authentication → Settings → Authorized domains*: o domínio onde a tela é
   publicada. Faltando ele, o login falha com `auth/unauthorized-domain` — a tela já
   traduz esse código para uma frase que diz onde mexer.

### 3.3 Proxy reverso e TLS

> **Esta seção abria com "não existe arquivo de Nginx no repositório" até 17/09/2026.**
> Existe desde o commit `7642fab`, e a §0 chegou a listar as duas coisas ao mesmo tempo.
> O texto abaixo descreve o que está commitado; **só o TLS continua faltando.**

`nginx.conf` está na raiz e entra no container pelo serviço `proxy` do
`docker-compose.prod.yml` (`nginx:1.27-alpine`, montado somente-leitura como
`/etc/nginx/conf.d/default.conf`, publicando a porta 80 e subindo depois do
`healthcheck` da API). O que ele já resolve, cada item pela razão que o pôs lá:

- **`/` e `/api/` vão para `http://api:3100`** — a API serve a tela (build estático) e o
  JSON na mesma porta; não há container de tela separado (§3.2).
- **`proxy_read_timeout 90s` em `/api/`** — o padrão de 60 s do Nginx cortava
  `agendamento-field` na abertura fria (~1 min de cálculo) e devolvia 504 exatamente na
  página mais lenta do relatório. Medido, não estimado.
- **`/api/eventos` tem bloco próprio, com as quatro linhas de SSE** —
  `proxy_http_version 1.1`, `proxy_set_header Connection ''`, `proxy_buffering off` e
  `chunked_transfer_encoding off`, mais `proxy_read_timeout 1h` para o teto de 90 s não
  matar o stream a cada 90 s e pôr o navegador em laço de reconexão. Sem elas, o proxy
  segura o `text/event-stream` no buffer e **nenhum evento chega, sem erro e sem log**.
  Aqui isto não é hipótese: o SSE existe dos dois lados (`GET /api/eventos` em
  `apps/api/src/servidor.ts`, `new EventSource('/api/eventos')` em
  `apps/web/src/App.tsx:153`).
- **`/auth/` tem bloco próprio** — as duas únicas rotas que escrevem estado (sessão) em
  vez de servir dado calculado, de propósito fora de `/api/`.

**O que falta é só o certificado.** O arquivo serve HTTP puro; o `listen 443 ssl` entra
quando existir certificado — Let's Encrypt se o host for alcançável de fora, o da
Sebratel para rede interna. A publicação da porta 443 já está no compose, comentada.
Isto é decisão de infraestrutura, não do repositório.

- **Critério de saída:** as 14 páginas abrem pelo endereço real com TLS, incluindo a
  mais lenta a frio, e nenhum pedido volta 504.

### 3.4 Supervisão e observabilidade

- reinício automático: healthcheck do compose contra `GET /api/saude`, ou PM2/systemd se
  o deploy não for containerizado. **Uma das duas coisas, não as duas.**
- **Falta o que raspar.** `GET /api/saude` responde o que há em disco, de quando e qual
  adapter de cache está ligado — mas **não** a memória do processo. Um `memoria` com
  `rssMB`/`heapUsedMB` existiu na árvore perdida (§4) e é o primeiro acréscimo a fazer:
  o sinal que importa não é "está no ar", é o RSS subindo entre refreshes, que é como um
  vazamento aparece antes do OOM num processo de 10 GB de heap.
- **Log:** hoje a saída é `console`. Nenhuma ferramenta imprime valor de linha, e essa
  disciplina é o que permite colar log em ticket. **Mantenha ao encaminhar log para
  qualquer coletor.**

### 3.5 `.env` de produção — e um pé de ouvido já plantado

- `.env.example` traz `PORT=3000`; o código, sem `PORT`, usa **3100**. Um `.env` de
  produção copiado do exemplo com um Nginx apontado para 3100 dá "502 sem motivo".
  Conferir os dois no mesmo minuto.
- `REDIS_URL` está **comentada** no exemplo. Sem ela o cache é o de memória — funciona,
  e perde tudo a cada reinício, o que num container que reinicia é um frio por reinício.
  `GET /api/saude` diz qual adapter está ligado; é lá que se confere, não no `.env`.
- credenciais do Voalle e do MariaDB de produção: **usuário sem permissão de escrita**.
  É a camada 1 das quatro do read-only, e a única que o repositório não garante sozinho.
- as variáveis de **broker** do Kafka (as que o compose interpola) não são lidas pelo
  Node. Se o deploy não sobe Kafka, elas não precisam existir.

---

## 4. O risco que já se materializou duas vezes: trabalho fora do git

**Em 26 e 27/08 a árvore de trabalho foi apagada duas vezes**, e o que não estava
commitado sumiu — a causa não foi um comando deste repositório; outro agente/IDE desfez
trabalho solto ([RECUPERACAO-27-08](RECUPERACAO-27-08.md)). **Tudo que estava commitado
sobreviveu, sem exceção.** O que se perdeu:

- a passada de densidade do front-end de 26/08 (reconstituível: as fontes estão no
  scratchpad da sessão, e servem de especificação, não de patch para reaplicar às cegas);
- **~5.600 linhas de documentação de decisões** — o `ACHADOS.md` sozinho carregava os
  achados #1 a #76, a memória numerada que o resto dos documentos referencia;
- e o pacote de 21/08 que **este documento chegou a descrever como pronto**: SSE,
  `useFilterStore`, o ramo de data ISO no `filtro-url.ts` e o pré-aquecimento por
  Ano/Mês. Nada disso está no repositório.

Duas consequências para o deploy, e a segunda é a que importa:

1. **A versão anterior deste plano listava seis riscos em código que não existe.** Eles
   ficam registrados onde pertencem — os defeitos do SSE em `ARCHITECTURE.md` §6.2, os
   do aquecedor no §6.1 —, para quem reconstruir não reencontrá-los do zero. Não são
   mais itens de deploy.
2. **A regra que passa a valer:** só se documenta, empacota ou promete o que está
   **commitado**. Empacotar imagem a partir de árvore suja é a forma garantida de gerar
   um artefato que ninguém consegue reproduzir — e, aqui, já foi a forma de perder o
   trabalho duas vezes.

**Estado em 27/08/2026, quando esta seção foi escrita:** árvore limpa, `main` == `staging` == `origin/main` ==
`origin/staging`, **1357 testes verdes**. Não há mais nada em risco fora do git.

- **Critério de saída desta seção:** nenhum documento afirma comportamento que não
  esteja num commit, e cada fase de trabalho termina com commit em `staging` antes de ir
  para `main`.

### 4.1 A discrepância de testes — **ENCERRADA em 17/09/2026**, e não por investigação

Esta seção ficou listada como discrepância aberta por vinte dias. **Não a investigue:
ela não tem mais objeto.** A redação original era esta, e a aritmética dela não vale
mais em nenhum termo:

> A árvore pré-reset de 26/08 marcava **1438 testes com 4 falhando**; hoje são **1357 com
> 0**. Os 87 arquivos `*.test.ts` existem e o glob do `npm test` alcança todos — então os
> ~81 de diferença foram acrescentados **dentro de arquivos existentes** e se perderam com
> a árvore. Enquanto não forem identificados, "suíte verde" mede menos do que media.

**O que a derrubou:** a suíte não parou nos 1357 de 27/08/2026. Medido com `npm test` em
17/09/2026: **2020 testes, 2020 verdes, 0 falhando**, em **153** arquivos `*.test.ts` —
contra os 87 de então. Ela passou os **1438** pré-reset em algum ponto entre 27/08 e
04/09 (naquele dia eram **1627** de manhã, no levantamento do `PLANO-DUPLA.md` §0, e
**1666** à noite, em `4a41a47`; 1895 em 15/09) e hoje é **40% maior que a árvore que se
temia ter perdido**.

Os "~81 testes perdidos" deixaram, portanto, de ser buraco a tapar: qualquer cobertura
que tenha ido embora com a árvore de 26/08 foi reescrita com folga por trabalho
posterior, e contar totais já não a isola. A lição útil migrou inteira para o §4.2
abaixo: **o que protege de perda não é o total da suíte — é haver teste tocando aquele
código.** Foi exatamente por isso que `tools/snapshot/` pôde ficar 7 dias quebrado
debaixo de uma suíte verde.

### 4.2 Uma restauração pode corrigir com corrupção — e isso não aparece como perda

O §4 documenta trabalho que **sumiu** (árvore apagada, nada commitado). Em 02/09/2026
apareceu a variante mais perigosa do mesmo risco: um commit de restauração
(`0aae15c`, 26/08) que ficou **presente e errado** — colou blocos de código por cima de
si mesmos em `tools/snapshot/src/index.ts` e `calculadas.ts`, e no meio da colagem
apagou funcionalidade que já existia (`--todas`, `--parcial=`, e as validações dos
dois). O resultado crashava em qualquer execução real — mas passou **7 dias** sem
ninguém notar, porque `tools/snapshot/` nunca teve pasta `test/`: nenhum teste da suíte
verde tocava aquele código. Detalhe completo em `ACHADOS.md` #78; consertado e
verificado ao vivo contra o Voalle real, commit `39e4ce6` em `staging`.

A diferença para o §4 importa: lá, "suíte verde" continuava sendo prova válida — o que
faltava era commitar. Aqui, a suíte estava verde **com o bug presente**, porque o glob
de `npm test` não alcançava a pasta. **"N testes verdes" só prova o que os testes
efetivamente exercitam** — não é uma garantia geral sobre o repositório inteiro, e um
diretório sem pasta `test/` é um ponto cego, não uma ausência neutra.

- **Critério de saída desta seção:** cada diretório de `tools/` que grava em disco ou é
  encadeado por outro (como `calculadas.ts` é por `index.ts`) tem pelo menos um teste
  que falha se o módulo não carregar — o nível mais barato de proteção, e o que faltava
  aqui. Os quatro diretórios sem pasta `test/` (`auth`, `bench`, `paginas`, `probe`)
  continuam sem, por dependerem de banco/rede real — não é a mesma lacuna.

### 4.3 A escrita do snapshot não era atômica — e no Windows a falha é de vez, não de vez em quando

Achado separado do §4.2 (ali era corrupção por restauração ruim; aqui é uma corrida
que sempre existiu na escrita), registrado em `ACHADOS.md` #79. Medido em 02/09/2026
com uma sonda local: renomear `<arquivo>.parcial` por cima de `<arquivo>` no
Windows/NTFS falha com `EPERM` **100% das vezes** enquanto outro processo tem
`<arquivo>` aberto para leitura — não é o "caso raro" que o plano de atomicidade
original supunha antes de medir. Com retentativa e espera crescente (25 ms a 800 ms),
100% de sucesso contra leituras de 5–25 ms.

`packages/snapshot/src/formato.ts` (`escreve()`) e `packages/snapshot/src/
manifesto.ts` (`escreveManifesto`) ficaram atômicos por dentro — todo call-site ganha
de graça, sem precisar de um segundo helper que alguém teria de lembrar de chamar. O
manifesto também ganhou `fsync` antes do rename (arquivo pequeno, custo desprezível,
fecha a janela de queda de energia). Verificado ao vivo: `--pagina=capa --refazer`
contra o Voalle real, incluindo o modo isolado por coluna de `Status Protocolo Dia`.

**Não fechado:**
- **Sonda 2 do plano de atomicidade** — 30 min no servidor de deploy real, sob o
  antivírus de verdade, não a máquina de desenvolvimento. As esperas acima (25–800 ms)
  não têm dado real de leitura de um `.jsonl` de 60 MB sob carga nem de quanto tempo o
  Defender pode segurar um handle.
- **Sonda 4** — ACL entre a conta do Agendador de Tarefas (§2.2) e a conta da API,
  também só verificável no host real.
- Sob carga alta e contínua, é teoricamente possível que um leitor novo sempre abra o
  arquivo antes do anterior fechar, esgotando as 6 tentativas (~1,575 s de orçamento) —
  não medido; o caso medido foi um leitor por vez.
- A "saída barata" do §2.2 (publicar queries e calculadas juntas, só depois do
  congelamento) e a geração-com-ponteiro completa continuam não implementadas — isto
  fecha a janela de **arquivo**, não a de **conjunto** (`confereIdadeDaCalculada`
  ainda pode recusar página com 409 durante um refresh em andamento).

- **Critério de saída desta seção:** Sonda 2 e Sonda 4 rodadas no servidor de deploy
  real, sem falha de rename nem 5xx na API durante 30 min de refresh concorrente com
  tráfego — hoje só a versão local (Sonda 1) foi medida.

## 5. O que **não** vai neste deploy, de propósito

- **Kafka, Debezium e CDC contra o Voalle real.** O ingestor está validado contra a
  stack descartável de `docker/cdc/`, e o gatilho para ligá-lo em produção é um número
  medido (`DECISAO-REALTIME.md`), não a disponibilidade do Kafka no Portainer. O
  refresh agendado do §2.2 resolve o frescor do dado sem nenhuma dessas peças.
- **Realtime na tela.** Não existe (§4), e `DECISAO-REALTIME.md` decidiu não construir
  enquanto o gatilho medido não aparecer. Sem ele, quem abriu a página antes do refresh
  vê o dado antigo até recarregar — o que é aceitável num painel cujo dado é
  materializado uma vez por dia, e precisa ser dito a quem for usar.
- **Chart SDK.** Os 16 gráficos calculam; a tela desenha barra em HTML. Escolher uma
  biblioteca sob pressão de deploy é decidir por uma peça que tem dono
  (`CONTINUACAO.md` §9.2).
- **IA e Export.** Não têm critério de saída, e não deveriam ter antes do login.

---

## 6. Ordem de entrega

Três ondas. A ordem não é preferência: cada onda remove um bloqueio da seguinte.

### Onda 1 — fechar o que está na mão (não depende de ninguém de fora)

1. **Restaurar a memória do projeto** — o `ACHADOS.md` de hoje tem 217 linhas onde tinha
   5.808, e os achados #1 a #76 são referenciados por todos os outros documentos. O
   plano de fusão (nunca sobrescrita) está em
   [RECUPERACAO-27-08](RECUPERACAO-27-08.md) §4, Fase 0. É o item mais barato e o de
   maior alcance: sem ele, metade das referências deste repositório aponta para o vazio.
2. ✅ **Altura dos gráficos** (27/08): medido, 5.564 → 5.133 px em `agendamento-field` e
   1.727 → 1.343 px em `visao-geral`, sem `v-auto` e sem rolagem horizontal. O que sobra
   é a densidade ([RECUPERACAO-27-08](RECUPERACAO-27-08.md) §3.2), que é trabalho de
   régua e medição, não de deploy.
3. Escrever o `Dockerfile` da API (com o heap), o `docker-compose.prod.yml` e o
   `nginx.conf`.
4. `npm test` verde e **commit em `staging`** ao fim de cada item — nada fica solto na
   árvore entre etapas. Foi trabalho solto que se perdeu duas vezes (§4).

- **Critério de saída da onda:** a stack sobe por compose numa máquina que não é a do
  Erick, com o snapshot montado como volume, e as 14 páginas abrem.

### Onda 2 — o que depende de decisão de outra pessoa

5. **Identidade** (§2.1): de onde vem a sessão. Sem resposta, não passa de piloto interno.
6. **Janela de refresh** (§2.2): que horário pode ficar lento, e quem é avisado se falhar.
7. Credenciais de produção read-only e TLS — trabalho de DBA e de infraestrutura.

- **Critério de saída da onda:** um pedido sem sessão leva 401, e a data do
  `/api/saude` avança sozinha de um dia para o outro.

### Onda 3 — o que transforma piloto em substituição

8. Fechar a paridade (§2.4): as 3 páginas relidas no Power BI **sem limpar filtro**, e
   `npm run paridade` sem diferença não declarada.
9. Decidir as 10 perguntas de negócio abertas — cada uma virando código, entrada em
   `divergencias.yaml`, ou "o visual sai".

- **Critério de saída da onda:** o Power BI pode ser desligado sem ninguém perder um
  número. É a definição de pronto de `CONTINUACAO.md` §9.7, e nenhuma onda anterior a
  alcança.

---

## 7. Dia do deploy — a lista curta

Antes:

- [ ] `npm test` verde na máquina que vai empacotar (**2020** em 17/09/2026 — confira o
      número do dia, não este: o que reprova é falha, não total diferente)
- [ ] árvore limpa (`git status` sem modificação) e commit empurrado
- [ ] `npm run paginas -- --pagina=<três páginas diferentes>` sem erro
- [ ] `snapshot/` do dia, e `npm run snapshot:confere` sem divergência de tipo
- [ ] `.env` de produção conferido contra o §3.5 — porta, `REDIS_URL`, usuário read-only
- [ ] **não** rodar refresh nas horas anteriores: troca o carimbo e esfria todo o cache

Depois, na ordem:

- [ ] `GET /api/saude` — adapter de cache e data do snapshot (memória: ver §3.4)
- [ ] `GET /api/dashboards` — 14 páginas, todas `pronta: true`
- [ ] uma página abrindo pelo navegador, no endereço real, com TLS
- [ ] um `POST` qualquer levando **405**
- [ ] a página mais lenta a frio (`agendamento-field`) abrindo sem 504 — é o teto do
      `proxy_read_timeout` que se está medindo, não a página
- [ ] RSS medido de novo 30 min depois, sob uso real

Rollback: parar o container e subir a etiqueta anterior. **O snapshot é compatível entre
versões** — ele é dado, não esquema de aplicação —, então voltar a imagem não exige
voltar o dado. É o que torna o rollback barato, e é a razão de o snapshot ser volume e
não camada de imagem.
