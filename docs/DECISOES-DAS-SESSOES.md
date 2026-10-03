# Decisões do projeto, extraídas das sessões

> Levantado em **27/08/2026** varrendo **as 31 sessões do Claude Code** deste projeto
> (04/08 a 27/08), em `~/.claude/projects/c--Users-erick-azambuja-Desktop-DASHBOARD---Instala--o/*.jsonl`:
> **293 mensagens suas** e **639 trechos de decisão**. Cada item abaixo tem a data em
> que foi decidido e, quando existe, o número que o embasou.
>
> **Para que este documento existe:** o `docs/ACHADOS.md` tinha **5.808 linhas** em
> 19/08 e hoje tem **217**. A memória técnica do projeto foi perdida (§8), e boa parte
> dela só existe nestas sessões. Isto aqui é o resgate da camada de *decisão* — o
> "por quê", que é o que não se reconstrói lendo o código.

---

## 1. As regras da casa

Não são preferências: cada uma nasceu de um erro concreto.

| regra | de onde veio |
|---|---|
| **Um número plausível e errado é o pior resultado possível.** | É a regra fundadora. Todas as outras são consequência dela. |
| **Meça antes de decidir, e registre o número** (regra 8). | 07/08: uma manhã perdida perseguindo `Status Protocolo Dia` (304,7 bi de visitas) quando o custo real estava em `FIELD AGENDA` (2,1 tri). "Medir a parte que se suspeita não é medir onde o tempo vai." |
| **Divergir, mas nunca em silêncio.** | Toda diferença deliberada vira entrada em `divergencias.yaml` com o `sha256` do original. Card marcado `divergente:` **tem de** diferir — bater ali é falha. |
| **Todo teste tem de falhar se a regra sumir** (regra 4). | Testes de mutação: quebra-se a regra de propósito e verifica-se qual teste cai. Em 07/08 uma mutação não derrubou nada e revelou que aquilo não era regra, era otimização redundante. |
| **Decisão difícil vira documento** (08/08). | "Senão a próxima sessão a refaz." Provou-se caro quando não foi seguido — ver §8. |
| **Item de fila sem critério de saída é afirmação que ninguém verifica** (19/08, achado #75). | A `CONTINUACAO.md` dizia "64 cards com gabarito ditado" na §1 e "64 cards esperando número" na §5.3, quarenta linhas abaixo. Ninguém tropeçou nisso em três leituras. |
| **Texto não vira número em silêncio.** | `value.ts`. Erra alto com mensagem acionável. Várias colunas chegam como texto `DD/MM/YYYY`; converter na surdina é como se produz número errado plausível. |
| **Uma sessão por unidade de trabalho, commit ao fim de cada fase** (sua, 04/08). | Não foi seguido entre 19/08 e 26/08 — e é a causa direta da perda (§8). |

---

## 2. Arquitetura e stack

| # | decisão | quando | por quê |
|---|---|---|---|
| 2.1 | **Não escrever API/UI antes de o motor DAX ter paridade** | 05/08 | Construir tela sobre número não conferido gera retrabalho. **Autocrítica registrada em 07/08:** "foi escolha minha e ela foi longe demais" — 112 dos 117 visuais já calculavam e a perseguição aos 5 restantes continuou em vez de fazer aparecer algo na tela. |
| 2.2 | **`node:http` em vez de Fastify** (achado #39) | 07/08 | Cinco rotas `GET` sem corpo, sem escrita e sem autenticação não pagam um framework, e o repositório não tem passo de build. Condição de revisão escrita: Permission Engine, corpo de requisição, WebSocket. |
| 2.3 | **Next.js: não** (`DECISAO-TELA.md` §3b) | 11/08 | Não é preferência. A regra read-only é **estrutural** — a API recusa tudo que não é `GET`/`HEAD` antes de qualquer roteamento. Next traz Server Actions, e Server Action *é* um POST gerado no build: adotá-lo põe um servidor capaz de escrever entre o navegador e o dado. Reabre se houver RLS por usuário ou se o HUBBI padronizar Next. |
| 2.4 | **Se um dia migrar, é Hono — não Fastify** | 11/08 | Correção da própria resposta anterior no mesmo dia: "porque o `ARCHITECTURE.md` já declarava" é dívida de decisão, não argumento. Com números: 1 pacote contra 49. |
| 2.5 | **FastAPI: não para esta plataforma** | 11/08 | Seria a escolha certa para um *serviço de previsão* separado, falando com esta por HTTP — não para o runtime que já tem motores DAX e M em TypeScript. |
| 2.6 | **React 19 + Vite, estado na URL** | 11/08 | `?pagina=…&filtro=…` — recarregar não perde a escolha, e o link mostra ao outro exatamente o que você viu. |
| 2.7 | **A sidebar não é desta página** | 07/08 | Vem do AppShell do HUBBI. O `AppShell.tsx` daqui é andaime marcado como tal: embutir em produção é **apagá-lo**, não redesenhar o resto. |
| 2.8 | **Gráfico é desenho próprio, sem biblioteca** | 07/08 | Adiada de propósito: "escolher uma de passagem seria decidir por uma peça que tem dono". O id do visual aparece sob cada card **de propósito** — é a chave de `backend/specs/paridade/*.yaml`. |

---

## 3. Dados: camada M, SQL e o Data Hub

| # | decisão | quando | por quê |
|---|---|---|---|
| 3.1 | **Manter a camada M** (`DECISAO-CAMADA-M.md`) | 05/08 | Duas razões: 3 das 15 mesclagens **atravessam fonte** (Postgres×MariaDB, Postgres×Sheets) e nenhum `SELECT` junta duas fontes; e SQL escrito à mão **não tem onde morar** — `backend/specs/_catalog/queries/` é regerado pelo extrator, então divergiria em silêncio. |
| 3.2 | **A camada M não atende request** (achado #20) | 06/08 | Uma query estoura 4 GB de heap e o CLI roda uma por processo. Ela existe para **validar paridade**; produção lê o snapshot materializado. Motivo técnico: em M qualquer passo pode citar qualquer anterior, então o avaliador não libera tabela intermediária — 56 passos = 56 tabelas vivas ao mesmo tempo. |
| 3.3 | **Revisão sênior discordou** | 11/08 | Registrado como divergência explícita: ingerir MariaDB/Sheets para dentro do Postgres uma vez elimina a categoria inteira, e as 15 mesclagens viram SQL nativo. Não foi adotado, mas está no registro. |
| 3.4 | **Reduzir o grão é trabalho de SQL, não da camada M** | 10/08 | Mudança de plano no meio: o Postgres agrupa 1,46 milhão de linhas em segundos, e assim não se trafega nem materializa 950 MB para jogar 97% fora. |
| 3.5 | **Adotar o Data Hub para `protocolos-produtividade`** | 24/08 | A query não materializava nesta máquina (4,6 GB livres de 15,7). |
| 3.6 | **Tirar o Data Hub — queries diretas ao dbVoalle** | 25/08 | Sua decisão, reafirmada ("a gente tinha combinado de não usar o data hub, lembra?"). A medição sustentou: o Data Hub estava **parado em julho** (nenhuma linha de agosto num snapshot de 24/08) e usava um conjunto de tipos mais estreito. Aplicar a regra de 2026 em todas as CTEs deixou o SQL **3,4× mais rápido** (570,6 s → 167,6 s). |
| 3.7 | **Carga incremental só onde é segura** | 25/08 | `incremental.yaml`, fora das specs geradas. Só `protocolos-produtividade`: `field-agenda` não pode (a view não tem coluna de modificação) e `protocolos-geral` não pode (`Table.Distinct`/`Table.Sort` decidem sobre o conjunto inteiro). A ferramenta **se recusa a rodar** passados 7 dias da última completa. |
| 3.8 | **Janela deslizante de 3 meses no `field-agenda`** | 25/08 | `CURRENT_DATE - INTERVAL '3 months'`, não data fixa, para deslizar sozinha a cada refresh. **1.458.244 → 41.773 linhas.** É a maior economia de carga do projeto. |
| 3.9 | **O tipo declarado da coluna vale ao materializar** (achado #31) | 07/08 | E **não** "SUM converte texto" — essa valeria para qualquer texto em qualquer agregação e abriria a porta para `"1.234"` virar 1,234. A conversão é da coluna, não da soma. Estendida às colunas físicas em 07/08, depois de medir que todo valor era literal limpo ou nulo. |
| 3.10 | **As duas pontas de um relacionamento chegam na mesma espécie** | 13/08 | A junção comparava texto com número, e quem a quebrou fomos nós: o PBIP declarava um lado `int64` e a regra do #40 convertia só um. Critério estreito: dispara 1 vez em 22 relacionamentos. |
| 3.11 | **O motor mede e reporta; quem libera a reconciliação é decisão registrada** (`juncoes.yaml`) | 14/08 | O caminho óbvio — comparar como inteiro quando as espécies diferem — foi escrito e **descartado**: um teste existente derrubou, e tinha razão. Reconciliar sozinho troca junção *morta* por *viva e possivelmente errada*, e junção errada é invisível. |

---

## 4. Desempenho

**O orçamento** (`DECISAO-DESEMPENHO.md`, 10/08, com as suas palavras no cabeçalho):
`< 2 s a frio · < 300 ms a quente · refresh sem teto`. E a frase que decide empate:
**"rápido e errado é pior que lento e certo — lento a gente conserta."**

| # | decisão | quando | número |
|---|---|---|---|
| 4.1 | **Colunas e tabelas calculadas congelam no snapshot** | 08/08 | Sua escolha (`PERGUNTAS-NEGOCIO` #8, opção B). 90% dos 104 min eram uma coluna de rank. O custo passa a acontecer uma vez, no refresh, fora da tela. |
| 4.2 | **`adotaTabela` em vez de copiar** | 08/08 | A cópia estourava 8 GB de heap aos 20,5 min antes de gravar. |
| 4.3 | **Projeção de colunas** | 10/08 | 45 de 107 colunas não veem mais memória. A lista sai do mesmo fechamento que o `plano.ts` usa, não de lista escrita à mão. |
| 4.4 | **`Relato` sob demanda** | 10/08 | 36,8% dos bytes da maior tabela. **Revertida em 24/08** — ver §7.2. |
| 4.5 | **O dia entra na chave de cache antes de o TTL sair** | 17/08 | 32 expressões chamam `TODAY()` e a chave não tinha dia. Esticar o TTL primeiro teria tornado permanente um bug de virada de meia-noite, em vez de horário. A ordem não era negociável. |
| 4.6 | **Quem invalida o cache é o dado, não o relógio** | 17/08 | O TTL de 60 s recalculava 36 s por minuto: `visao-geral` levava 36,1 s na 1ª chamada e 0,022 s na 2ª. Somado ao aquecedor automático: 14 páginas quentes em 157,5 s, sem ninguém pedir. |
| 4.7 | **Disjuntor no Redis** | 24/08 | Teto de 750 ms por chamada; após uma falha o Redis fica 5 s fora e volta sozinho. `enableOfflineQueue: false` para o comando falhar na hora em vez de enfileirar. |
| 4.8 | **Rodar no host, não no container** | 19/08 | O container lia o snapshot de 1,2 GB pela ponte de arquivos Windows↔WSL — ordens de grandeza mais lento. Explicava 70 s que pareciam ser do cache. |

---

## 5. Realtime, CDC e a tríade Redis/Kafka/Debezium

**A decisão que manda:** `DECISAO-REALTIME.md` (06/08, reafirmada 11/08 e 20/08) —
**não construir realtime.**

O motivo é mais interessante que a conclusão: *o caminho de leitura é um snapshot em
disco; a API não consulta fonte nenhuma.* Um evento de CDC invalidando cache **não
tornaria o número mais fresco** — só faria a API recalcular sobre o **mesmo** arquivo.
Mais lento, não mais fresco. E 3 das 24 queries vêm de MariaDB e Google Sheets, que
não têm CDC.

Decorrências:

- **O gatilho para abrir a Fase 4 é um número medido**, não a stack estar disponível:
  (a) alguém pedir frequência menor que o tempo de um snapshot daquela página, e
  (b) o refresh não caber mais na máquina. **Nunca foi medido contra o Voalle.**
- **"O item mais barato ainda não é Kafka: é polling incremental por `updated_at`."**
  Antes dele, mais barato ainda: uma tarefa agendada de `npm run snapshot`.
- **Debezium contra o Voalle não é leitura** (11/08). Exige `wal_level=logical`
  (restart do Postgres do ERP), `CREATE PUBLICATION` (DDL, escrita) e um *replication
  slot* persistente. Colide de frente com a regra read-only. Pior: **slot não consumido
  faz o WAL do ERP crescer até encher o disco** — o incidente seria em produção.
  Por isso `npm run cdc:slot` foi construído **antes** do conector, como condição.
- **O ingestor nunca guarda o payload.** Evento Debezium carrega a linha inteira —
  `field-agenda` tem endereço, `QUADRO FUNCIONAL` tem CPF. Descarta `before`/`after`
  na entrada e mantém só tabela, operação e timestamp.
- **"4 eventos em 56 ms" não é medição** (18/08, achado #71). É rajada, e quase passou
  por evidência. Janela curta não mede taxa; mede o instante em que se olhou. Por isso
  60 minutos, não 5.
- **Um `iniciaKafkaCDC` não autorizado foi encontrado e revertido** (18/08) — ver §7.4.

---

## 6. Segurança e dado pessoal

O `snapshot/` tem **CPF, RG e endereço de cliente**. Isso governa várias decisões:

- **Read-only em quatro camadas**, sendo a quarta a API recusar tudo que não é
  `GET`/`HEAD` **antes** do roteamento. Numa eventual migração isso tem de virar hook
  global — não basta "não declarar rotas POST", porque aí a resposta vira 404 e a
  garantia deixa de ser explícita.
- **O golden não guarda linhas** (04/08). Um teste pegou o vazamento no próprio
  desenho: `min`/`max` de coluna numérica é o valor literal de um registro, então num
  CPF isso iria direto para o commit. Ficou: strings → faixa de comprimento;
  numéricas → só soma. `--include-values` libera explicitamente.
- **A rota `/valores` tem allowlist** — só colunas que são segmentação daquela página.
  Sem ela viraria dump de qualquer coluna do modelo. Por isso **drill-through exige
  lista declarada de colunas**, nunca "devolve a linha" (19/08).
- **O bloqueio nº 1 do deploy não é Docker nem Nginx: é não existir login** (21/08).
  Publicar antes disso é incidente de dado pessoal, não deploy apertado.
- **Token do Power BI** (25/08): escopo `.default` — tudo que a sua conta pode,
  **incluindo escrita**. O que impede escrita não é o escopo, é código:
  `assertSomenteEvaluate` recusa DAX que não comece por `EVALUATE`; 2 POSTs no total no
  tool inteiro, zero PUT/PATCH/DELETE. **Trate o arquivo como credencial plena**, não
  como token de leitura.
- **Nunca digite um device code que chegou por mensagem, e-mail ou chamada** — só o
  que você mesmo acabou de disparar.

---

## 7. Decisões que foram revertidas

Esta seção existe para ninguém "restaurar" o que foi retirado de propósito.

| # | o que | adotado | revertido | por quê |
|---|---|---|---|---|
| 7.1 | **Data Hub como fonte** | 24/08 | 25/08 | Sua decisão. E a medição concordou: estava parado em julho, com regra de tipos mais estreita. A sonda e o connector **ficam no repositório** parados, custam nada — foi assim que o achado #17 tratou caso igual. |
| 7.2 | **`Relato` sob demanda** | 10/08 | 24/08 | **A medição envelheceu.** Foi decidida sobre `field-agenda.jsonl` de 1.458.244 linhas e 950 MB; o snapshot de 24/08 tinha 103.913 linhas e 120 MB. Pior: dos 12 s do carregamento sob demanda, só 1 s era cálculo — os outros 11 eram montar um **segundo** dataset com o primeiro ainda em memória. |
| 7.3 | **Fastify como destino da API** | 11/08 | 11/08 | Mesma sessão. O primeiro argumento era dívida de decisão, não engenharia. Passou a ser Hono. |
| 7.4 | **`iniciaKafkaCDC` ligado** | (não commitado) | 18/08 | Estava na árvore, conectando um consumer Kafka de verdade e invalidando cache — exatamente o que a `DECISAO-REALTIME.md` diz por escrito que não está autorizado. Sem medição que satisfizesse o gatilho. |
| 7.5 | **Paleta âmbar `#F59E0B`** | 04/08 | 26/08 | Sua escolha: "ao invés dessa cor amarelada coloque um bordô". A tela foi para `#880F17`. O conflito com o `CLAUDE.md` — que ainda declarava âmbar como primária e vinho como proibido — foi apontado em 25/08 e é dívida aberta. |
| 7.6 | **Modo dashboard interativo (capa → dashboard)** | 04/08 | 04/08 | "Esqueça essa ideia." Ficaram os mockups estáticos como referência. |

---

## 8. O estado da documentação de decisões

**Este é o achado mais sério desta auditoria.** Entre 19/08 e 26/08 nada foi
commitado. Em 27/08 você relatou: *"O GEMINI REVERTEU TUDO QUE FIZEMOS"*. A
reconstrução foi feita a partir dos transcripts, e os documentos voltaram **muito
menores** do que eram:

| documento | 19/08 | hoje | perdido |
|---|---|---|---|
| `docs/ACHADOS.md` | 5.808 | 217 | **−5.591** |
| `docs/PROMPT-CONTINUACAO.md` | 659 | 143 | −516 |
| `docs/PERGUNTAS-NEGOCIO.md` | 654 | 254 | −400 |
| `docs/CONTINUACAO.md` | 738 | 408 | −330 |
| `docs/DECISAO-CAMADA-M.md` | 542 | 424 | −118 |
| `docs/DECISAO-GRAO-FIELD-AGENDA.md` | 211 | 110 | −101 |

São ~7.000 linhas, e o `ACHADOS.md` sozinho carregava os **achados #1 a #76** — a
memória técnica numerada que o resto da documentação inteira referencia. Hoje ele tem
3 achados e nenhuma numeração, porque foi **recriado do zero** em 25/08 por uma sessão
que constatou que o arquivo "não existia mais".

**A boa notícia: as versões de 19/08 estão no git**, intactas, em `5ce7c20`:

```
git show 5ce7c20:docs/ACHADOS.md > docs/ACHADOS.md
```

O que **não** está no git é o que foi acrescentado a esses documentos entre 20/08 e
26/08 — isso só existe nas sessões, e é o que este documento resgata na camada de
decisão. Restaurar exige **fundir**, não sobrescrever: `README.md`, `DESIGN-SYSTEM.md`,
`ARCHITECTURE.md` e `DECISAO-DESEMPENHO.md` **cresceram** no mesmo período e a versão
de hoje é a boa.

---

## 9. Aberto — esperando decisão sua

| # | o quê | prazo |
|---|---|---|
| 9.1 | **O corte do ano é o literal `'2026-01-01'`, escrito em 11 queries.** Em 01/01/2027 o painel soma dois anos sob o rótulo de um, sem erro e sem alerta. Uma decisão, onze cópias. Não dá para consertar aqui — o SQL mora nas expressões M do PBIP, que é read-only pela regra 1. | **quebra em 01/01/2027** |
| 9.2 | **O piso corta por `DATA CRIADO`; toda medida de instalação agrega por `DATA INSTALAÇÃO`.** Protocolo criado em dez/2025 e instalado em jan/2026 é invisível. A primeira semana de janeiro sai ~25% menor (05/01: 11 contra 134). | — |
| 9.3 | **`Installation_Teams` parou de receber linha em 16/07/2025.** `PROTOCOLOS GERAL[técnico 2]` é 100% nulo — aqui *e* no Power BI. Não tem conserto em código: ou a carga volta, ou o visual sai. A coluna foi deixada como está de propósito, para `snapshot:confere` errar alto a cada refresh. | — |
| 9.4 | **De onde vem a identidade do usuário: SSO do HUBBI ou usuário local?** É o que separa "roda aqui" de "pode ser publicada". **A resposta provavelmente já existe a duas pastas:** `by/dev_HUBBI_NodeJS` tem `POST /auth/sso-firebase` (valida token, certifica domínio `@sebratel.com.br`, libera `accessLevel`) e `GET /dashboard/email/:email`. | bloqueia deploy |
| 9.5 | **O visual `084be384` (tabela de detalhe em `agendamento-field`) usa `Data Relato`.** É o único entre 117 que impede a redução de 48× no grão do `FIELD AGENDA`. Vira sob demanda como o `Relato`, ou fica no grão fino? | — |
| 9.6 | **A regra do `INSTALADOR` não está no repositório.** No modelo publicado a coluna é *de origem*, e o `m_expression` da spec só tem passos de `QUADRO FUNCIONAL`/`GESTOR`. Precisa do passo M no PBIP, ou de quem sabe de qual campo sai o instalador quando não houve alocação. | — |
| 9.7 | **`CLAUDE.md` ainda declara âmbar como primária e vinho como proibido**, e a tela está em bordô `#880F17` desde 26/08. O documento tem de acompanhar a tela. | — |

---

## 10. Como este documento foi feito

Scripts no scratchpad da sessão `dc2c82e3`:

- `audita.mjs` → `auditoria.txt` — as 31 sessões e todo arquivo que cada uma escreveu.
- `decisoes.mjs` → `falas.txt` (293 mensagens suas) e `decisoes.txt` (639 trechos com
  marcador de decisão).

**Duas ressalvas de método**, para ninguém tratar isto como completo:

1. O extrator pega texto de resposta com marcador (`decidi`, `em vez de`, `descartado`,
   `o motivo`…). Decisão tomada sem nenhuma dessas palavras não aparece.
2. Ele **não enxerga** edições feitas por script via Bash — e várias sessões trabalharam
   assim. As datas e números aqui foram conferidos contra o git e o disco; o que não
   deu para conferir está dito como não conferido.
