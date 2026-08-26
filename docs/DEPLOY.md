# Deploy — plano de entrega para produção

> **Escrito em 21/08/2026.** Este documento tem uma regra só: **separar o que está
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

| frente | estado em 21/08/2026 | bloqueia deploy? |
|---|---|---|
| Motor DAX + Widget Engine | 14 páginas, **117 de 117 visuais calculam**, 0 erros | não |
| Testes | **1355 verdes**, 0 falhando, nenhum precisa de credencial nem de build | não |
| Cache + pré-aquecimento | resposta a quente medida em **2,9–6,2 ms**; `npm start` aquece as 14 páginas + anos + combinações Ano/Mês | não |
| Tela React | 14 páginas navegáveis, filtros na URL, Zustand + React Query, SSE ligado | não |
| **Paridade com o Power BI** | **não fechada** — 42 cards em jogo, **18 batem**, 7 divergências reais na fila (§2.3) | **sim, para "substituir"** |
| **Autenticação** | **não existe.** A API serve todo número a todo pedido | **sim, e é o primeiro** |
| **Refresh do dado** | manual — alguém digita `npm run snapshot` | **sim** |
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
| 1355 testes verdes, sem credencial e sem build | `npm test` |
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

### 3.3 Proxy reverso, TLS e o detalhe do SSE

Não existe arquivo de Nginx no repositório. O que precisa estar nele, e o que morre em
silêncio se faltar:

- proxy de `/` e de `/api/` para a porta da API;
- **SSE quebra atrás de proxy com a configuração padrão.** `proxy_buffering off`,
  `proxy_http_version 1.1`, `proxy_set_header Connection ''` e
  `chunked_transfer_encoding off`. Sem isso o Nginx segura o `text/event-stream` no
  buffer e a tela **não recebe evento nenhum** — sem erro, sem log, com cara de "não
  mudou nada". O heartbeat de 15 s do `eventsStream` existe para manter a conexão viva,
  e é ele que o buffer engole primeiro;
- `proxy_read_timeout` alto na rota do stream — o padrão de 60 s derruba a conexão a
  cada minuto e o cliente reconecta em laço;
- **CORS.** O `eventsStream` responde hoje `Access-Control-Allow-Origin: *`. Numa rede
  interna com dado pessoal isso precisa virar a origem exata do HUBBI, **no código**,
  não no Nginx;
- certificado: Let's Encrypt só se o host for alcançável de fora; para rede interna, o
  certificado da Sebratel. Isto é decisão de infraestrutura, não do repositório.

- **Critério de saída:** com o proxy no caminho, `npm run cdc:ingere` rematerializando
  uma query faz a aba aberta no navegador atualizar **sem F5** — é o único teste que
  prova os quatro cabeçalhos de uma vez.

### 3.4 Supervisão e observabilidade

- reinício automático: healthcheck do compose contra `GET /api/saude`, ou PM2/systemd se
  o deploy não for containerizado. **Uma das duas coisas, não as duas.**
- `GET /api/saude` já devolve `memoria.rssMB`, `heapUsedMB` e `heapTotalMB` — é o que um
  Prometheus ou um UptimeRobot precisa raspar. O sinal que importa não é "está no ar": é
  o RSS subindo entre refreshes, que é como um vazamento aparece antes do OOM.
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

## 4. Riscos abertos no código de 21/08 — o que revisar antes de empacotar

O trabalho de 21/08 (pré-aquecedor dinâmico, datas ISO, SSE, store de filtros) está
**inteiro não commitado**, e três comportamentos novos **não têm teste**. A suíte de
1355 passa sem eles: ela não os cobre.

| # | o quê | por que importa no deploy |
|---|---|---|
| 1 | `GET /api/events/invalidate` **tem efeito colateral**: limpa as páginas carregadas em memória. É um `GET`, sem autenticação, e o que impedia efeito colateral na API era exatamente o método | Um laço de `curl` nessa rota força recarga de tabela a cada pedido — de milissegundos para dezenas de segundos por página. Precisa ser interna (bind em loopback, ou negada no proxy) **antes** de haver proxy |
| 2 | O ingestor manda `?id=<id da query>`; a tela usa esse id como **id de página** (`queryKey ['pagina', id]`) | Rematerializar **uma** query invalida uma chave que não existe: a tela não atualiza e nada erra. Desaparece quando o id é `*`, o que esconde o defeito justamente nos casos com muitas queries |
| 3 | Datas ISO no `decodificaFiltro` — o ramo novo **não tem teste** em `filtro-url.test.ts` | É a correção que fez os visuais de `agendamento-field` calcularem limpos. Sem teste, a próxima mexida no decodificador a desfaz em silêncio |
| 4 | Pré-aquecimento de anos e meses — sem teste em `tools/subir/test/aquece.test.ts`, e `TIMEOUT_FILTRO_ANO_MS` está **declarado e não usado** | O `fetch` de aquecimento sem timeout pode pendurar a subida numa página lenta. A constante morta diz que a intenção era outra |
| 5 | Anos (`2024`, `2025`, `2026`) e meses cravados no código do aquecedor | Em 01/01/2027 o pré-aquecimento aquece três anos velhos. É o mesmo prazo da pergunta de negócio #12 (o literal `'2026-01-01'` em 11 queries), e vale resolver junto |
| 6 | O diff apagou comentários que registravam decisões em `servidor.ts` (o `identifica()`, o corte do `id` antes do `decodeURIComponent`) | Nesta base o comentário é o registro da decisão. Reponha antes do commit, ou a próxima pessoa refaz o bug que ele evitava |

- **Critério de saída desta seção:** os itens 1 e 2 corrigidos, 3 e 4 com teste, e o
  trabalho **commitado**. Empacotar imagem a partir de árvore suja é a única forma
  garantida de gerar um artefato que ninguém consegue reproduzir depois.

---

## 5. O que **não** vai neste deploy, de propósito

- **Kafka, Debezium e CDC contra o Voalle real.** O ingestor está validado contra a
  stack descartável de `docker/cdc/`, e o gatilho para ligá-lo em produção é um número
  medido (`DECISAO-REALTIME.md`), não a disponibilidade do Kafka no Portainer. O
  refresh agendado do §2.2 resolve o frescor do dado sem nenhuma dessas peças. **O SSE
  fica no ar** — ele é útil sem CDC, disparado por `npm run cdc:ingere` ou por um
  refresh manual.
- **Chart SDK.** Os 16 gráficos calculam; a tela desenha barra em HTML. Escolher uma
  biblioteca sob pressão de deploy é decidir por uma peça que tem dono
  (`CONTINUACAO.md` §9.2).
- **IA e Export.** Não têm critério de saída, e não deveriam ter antes do login.

---

## 6. Ordem de entrega

Três ondas. A ordem não é preferência: cada onda remove um bloqueio da seguinte.

### Onda 1 — fechar o que está na mão (não depende de ninguém de fora)

1. Corrigir os itens 1 e 2 do §4; cobrir 3 e 4 com teste; repor os comentários.
2. `npm test` verde e **commitar** o trabalho de 21/08.
3. Empurrar o repositório — `CONTINUACAO.md` §9.0. **É o único item do projeto cuja
   demora tem consequência permanente:** 123 commits em um disco só.
4. Escrever o `Dockerfile` da API (com o heap), o `docker-compose.prod.yml` e o
   `nginx.conf` com os quatro cabeçalhos de SSE.

- **Critério de saída da onda:** a stack sobe por compose numa máquina que não é a do
  Erick, com o snapshot montado como volume, e a aba atualiza sozinha ao rematerializar.

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

- [ ] `npm test` verde na máquina que vai empacotar (1355)
- [ ] árvore limpa (`git status` sem modificação) e commit empurrado
- [ ] `npm run paginas -- --pagina=<três páginas diferentes>` sem erro
- [ ] `snapshot/` do dia, e `npm run snapshot:confere` sem divergência de tipo
- [ ] `.env` de produção conferido contra o §3.5 — porta, `REDIS_URL`, usuário read-only
- [ ] **não** rodar refresh nas horas anteriores: troca o carimbo e esfria todo o cache

Depois, na ordem:

- [ ] `GET /api/saude` — adapter de cache, data do snapshot, `memoria.rssMB` de partida
- [ ] `GET /api/dashboards` — 14 páginas, todas `pronta: true`
- [ ] uma página abrindo pelo navegador, no endereço real, com TLS
- [ ] um `POST` qualquer levando **405**
- [ ] o stream: `curl -N https://<host>/api/events/stream` recebendo `connected` e, em
      15 s, o `ping` — se o `ping` não chega, o buffer do proxy está ligado (§3.3)
- [ ] RSS medido de novo 30 min depois, sob uso real

Rollback: parar o container e subir a etiqueta anterior. **O snapshot é compatível entre
versões** — ele é dado, não esquema de aplicação —, então voltar a imagem não exige
voltar o dado. É o que torna o rollback barato, e é a razão de o snapshot ser volume e
não camada de imagem.
