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
> | §4/§7 "1357 testes verdes" | **1666** (04/09/2026) |
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

| frente | estado em 27/08/2026 | bloqueia deploy? |
|---|---|---|
| Motor DAX + Widget Engine | 14 páginas, **117 de 117 visuais calculam**, 0 erros | não |
| Testes | **1357 verdes**, 0 falhando, nenhum precisa de credencial nem de build — mas ver §4.1 | não |
| Cache + pré-aquecimento | resposta a quente medida em **2,9–6,2 ms**; `npm start` aquece as 14 páginas sem filtro (o pré-aquecimento por Ano/Mês foi perdido, §4) | não |
| Tela React | 14 páginas navegáveis, filtros na URL. **Sem SSE e sem store de filtros** — perdidos com a árvore de 21/08 (§4) | não |
| **Paridade com o Power BI** | **não fechada** — 42 cards em jogo, **18 batem**, 7 divergências reais na fila (§2.3) | **sim, para "substituir"** |
| **Autenticação** | **não existe.** A API serve todo número a todo pedido | **sim, e é o primeiro** |
| **Refresh do dado** | `tools/refresh/` existe e roda (§2.2), 03/09/2026 — o script de cron (`tools/refresh/cron.sh`) está pronto, falta só colar a linha no crontab do host de produção | **sim** |
| Containerização | **não existe** nenhum `Dockerfile`. O `docker-compose.yml` sobe Redis e Kafka, não a aplicação | sim |
| Proxy reverso + TLS | **não existe** nenhum arquivo de Nginx no repositório | sim |
| Processo supervisionado | **não existe** — nem PM2, nem unit de systemd, nem healthcheck de container | sim |
| CDC contra o Voalle real | validado só contra a stack descartável de `docker/cdc/` | não — está fora do deploy (§5) |

**Em uma frase:** faltam **três decisões** (identidade, janela de refresh, o que fazer
com dado pessoal na tela) e **quatro artefatos de infraestrutura** que ainda não têm
uma linha escrita. Nada do que falta é cálculo.

---

## 1. O que está pronto, com o número que prova

Cada linha aqui tem um comando que reproduz a afirmação. Linha sem comando não entra.

| afirmação | como conferir |
|---|---|
| 1357 testes verdes, sem credencial e sem build | `npm test` |
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

### 2.1 Não existe login, e o dado é pessoal

A API não autentica ninguém. Há **costura** (`apps/api/src/identidade.ts`, e a chave do
cache já carrega o usuário para que nenhum recorte futuro seja servido para a pessoa
errada) e há **formato de decisão** (`specs/_catalog/permissoes.yaml`) — falta o leitor
e falta a tela de entrada.

Isso é tolerável numa máquina de desenvolvimento e **não é** tolerável em rede da
empresa, porque o que a API serve inclui:

- endereço de cliente, em `field-agenda`;
- **CPF e RG**, em `QUADRO FUNCIONAL`;
- 371 MB de dado operacional consolidado, em `snapshot/`.

- **Quem destrava:** decisão de produto sobre a origem da identidade — SSO do HUBBI ou
  usuário local. Enquanto ela não vier, não há o que implementar sem chutar.
- **Critério de saída:** um pedido sem sessão válida recebe **401** antes do
  roteamento, com teste que falha se a trava for removida — a mesma disciplina dos 405.
- **Mitigação aceitável para um piloto interno** (não é o deploy final): publicar
  **apenas na rede interna**, atrás do SSO que já existe no HUBBI, com a URL não
  divulgada e as páginas que expõem dado pessoal fora do menu. Isso é um piloto de
  alcance reduzido, e precisa ser dito com essas palavras a quem aprovar.

### 2.2 O dado não se atualiza sem alguém lembrar

Hoje o refresh é uma pessoa digitando `npm run snapshot`. Um painel cujo dado depende
de memória humana vira painel velho em duas semanas — e velho aqui é silencioso: a
tela não diz "isto é de terça".

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
  **O gatilho externo é `cron` no host, não Agendador de Tarefas do Windows** —
  produção é Linux/container (`docker-compose.prod.yml`), então a peça certa é a
  que o próprio arquivo já citava ("`SNAPSHOT_DIR_HOST` é onde o refresh agendado
  materializa no host"). `tools/refresh/cron.sh` (03/09/2026, ACHADOS #91) é essa
  peça — `flock -n` contra sobreposição, log em `snapshot/refresh.log`, roda de um
  checkout completo do repo (não da imagem Docker, que é deliberadamente enxuta e
  não tem `tools/snapshot/` nem `pg`/`mariadb`). Instalar é uma linha de crontab:

  ```
  */15 * * * * /caminho/do/repo/tools/refresh/cron.sh
  ```

  **Continua sem ser instalado nesta sessão** — editar o crontab do host de
  produção é mudança persistente no SO, fora do que uma sessão de repositório
  deveria fazer sem confirmação explícita, mesma régua do item acima. O que muda
  em relação à versão anterior deste parágrafo: o script e a linha de crontab já
  existem prontos, só falta alguém com acesso ao host colar a linha. **O primeiro
  tick real já valeu a pena antes de ser agendado**: achou duas queries que não
  podiam estar num grupo de 15 minutos — `field-agenda` custa 21min49s de verdade,
  não os 22,0s documentados (#82), e `protocolos-geral` crasha por uma dependência
  de npm que falta, `mysql2` (#83). As duas saíram de `refresh.yaml` até serem
  resolvidas; os grupos que sobraram (~11s e ~24s medidos ao vivo) são seguros
  para a cadência declarada.
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
  real. **Mas a única query com política (`protocolos-produtividade`) não materializa
  em nenhum modo hoje** — `ACHADOS.md` #81: SQL e M calculam as mesmas três colunas
  (colisão), e o full-fetch passou do teto de 600 s (era 190,3 s em 25/08/2026, 3,15×
  mais caro agora). **A cadência rápida que a Frente de automação prometia para esta
  query (grupo F: "hoje 1×/dia, depois medido de novo") continua bloqueada** — não
  pela fiação da incremental, que já está pronta, mas por estes dois defeitos
  anteriores e independentes dela.

### 2.3 A paridade não está fechada

Dos 64 cards com gabarito, 22 são carimbo de refresh (fora do jogo) e **42 estão em
jogo**: 18 batem, 18 diferem, 6 divergem por decisão registrada. Dos 18 que diferem,
11 estão em 3 páginas cujo gabarito é sabidamente inválido — a fila real são **7
divergências**, a primeira sendo `TOTAL INSTALADOS` de `manutencao-inicial`, 34% maior
do nosso lado.

Isto **não impede** um piloto lado a lado com o Power BI. Impede a frase "substitui o
Power BI". O caminho e os critérios estão em `CONTINUACAO.md` §9.1 — não os duplico
aqui de propósito, para não haver duas versões da mesma fila.

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
- **O `snapshot/` não vai dentro da imagem.** São 371 MB de dado de cliente, e ele muda
  a cada refresh: é **volume**, e um volume que precisa de backup e de política de
  retenção como qualquer base com dado pessoal.

- **Critério de saída:** `docker run` da imagem responde `/api/saude` com o mesmo JSON
  que a execução local, apontando para um volume de snapshot montado de fora.

### 3.2 `docker-compose` de produção

O `docker-compose.yml` da raiz sobe **Redis e Kafka**, e o cabeçalho dele explica por
extenso por que não sobe mais que isso. Produção precisa de um arquivo **separado**
(`docker-compose.prod.yml`), não de uma edição neste — o de hoje é a infra local do
desenvolvimento e continua valendo para isso.

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
preencher `GOOGLE_CLIENT_ID` e `DOMINIO_CORPORATIVO`, e aí a guarda sai da frente
sozinha.

Para conferir que a guarda continua viva, suba **sem** a sobreposição: o container
tem de morrer com saída 1.

### 3.3 Proxy reverso e TLS

Não existe arquivo de Nginx no repositório. O que precisa estar nele:

- proxy de `/` e de `/api/` para a porta da API — a API serve a tela e o JSON;
- `proxy_read_timeout` que caiba o pedido a frio: `agendamento-field` chega a ~1 min na
  primeira abertura, e o padrão de 60 s do Nginx corta exatamente aí, devolvendo 504 na
  página mais lenta do relatório;
- certificado: Let's Encrypt só se o host for alcançável de fora; para rede interna, o
  certificado da Sebratel. Isto é decisão de infraestrutura, não do repositório.

> **Se um dia o SSE voltar, o Nginx precisa de mais quatro linhas** —
> `proxy_buffering off`, `proxy_http_version 1.1`, `proxy_set_header Connection ''` e
> `chunked_transfer_encoding off`. Sem elas o proxy segura o `text/event-stream` no
> buffer e não chega evento nenhum, sem erro e sem log. Fica registrado aqui porque é o
> tipo de coisa que só se descobre em produção.

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

**Estado hoje (27/08/2026):** árvore limpa, `main` == `staging` == `origin/main` ==
`origin/staging`, **1357 testes verdes**. Não há mais nada em risco fora do git.

- **Critério de saída desta seção:** nenhum documento afirma comportamento que não
  esteja num commit, e cada fase de trabalho termina com commit em `staging` antes de ir
  para `main`.

### 4.1 A discrepância de testes que ainda está aberta

A árvore pré-reset de 26/08 marcava **1438 testes com 4 falhando**; hoje são **1357 com
0**. Os 87 arquivos `*.test.ts` existem e o glob do `npm test` alcança todos — então os
~81 de diferença foram acrescentados **dentro de arquivos existentes** e se perderam com
a árvore. Enquanto não forem identificados, "suíte verde" mede menos do que media.

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

8. Fechar a paridade (§2.3): as 3 páginas relidas no Power BI **sem limpar filtro**, e
   `npm run paridade` sem diferença não declarada.
9. Decidir as 10 perguntas de negócio abertas — cada uma virando código, entrada em
   `divergencias.yaml`, ou "o visual sai".

- **Critério de saída da onda:** o Power BI pode ser desligado sem ninguém perder um
  número. É a definição de pronto de `CONTINUACAO.md` §9.7, e nenhuma onda anterior a
  alcança.

---

## 7. Dia do deploy — a lista curta

Antes:

- [ ] `npm test` verde na máquina que vai empacotar (1357)
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
