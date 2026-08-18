# Continuação — onde o trabalho parou

> **Atualizado em 18/08/2026**, depois de a Fase 4 sair do papel: um
> `iniciaKafkaCDC` sem medição foi revertido (#71) e substituído pelo **ingestor de
> rematerialização**, validado ponta a ponta contra a stack descartável (#72). No mesmo
> dia, a terceira mesclagem morta ficou explicada e **saiu da fila técnica**: a fonte
> dela parou de ser alimentada em 16/07/2025, e isso é pergunta de negócio, não código
> (#73). Antes
> disso, em 14/08, as mesclagens mortas da camada M foram achadas e decididas (#64) e
> o congelamento das tabelas calculadas caiu de **14 h 28 min para 26 min**
> (#66 → #67 → #68). É o ponto de entrada de uma sessão nova: autocontido, feito para
> ser lido antes de tocar em qualquer coisa.
>
> Para o histórico longo do projeto (o que é, de onde veio, as fases 0 a 2b), leia o
> `README.md` e o `docs/PROMPT-CONTINUACAO.md`. Este arquivo é só **o estado de
> agora e o que fazer a seguir**.

---

## 1. Em uma frase

A **Analytics Platform Enterprise** substitui o Power BI da Sebratel. Hoje ela lê as
fontes reais, calcula **117 visuais das 14 páginas** do relatório e é uma **aplicação
React** que navega entre as páginas, **filtra pelas segmentações** e põe o estado na
URL. **As 14 páginas calculam** e nenhuma está parada por falta de dado.

A **paridade está medida**, e é o número a bater: dos 64 cards com gabarito ditado do
Power BI, **18 batem**, 18 diferem, 6 divergem porque foi decidido, e **0 deixam de
calcular** (eram 2 até 13/08 — ver ACHADOS #61). Dos 18 que diferem, **11 estão nas 3
páginas cujo gabarito é sabidamente inválido** (`docs/PARIDADE-11-08.md`: quem leu os
números no navegador limpou os filtros da página antes de ler). A fila real são **7
divergências**, e a primeira é `manutencao-inicial`, que diverge no sentido oposto e
ainda não tem causa provada.

> **O bloqueio de operação de 14/08 está resolvido.** Congelar `Status Protocolo Dia`
> levava **14 h 28 min** — 12 h 50 numa coluna só. A causa não era a coluna: era **um
> processo compartilhado** entre as quatro ([ACHADOS](ACHADOS.md) #66 → #67). Com um
> processo por coluna são **26 min 14 s**, e o arquivo sai **idêntico byte a byte**
> (#68). O refresh inteiro volta a caber numa janela, e a paridade volta a ser a fila.

---

## 2. Rodar em cinco minutos

Requisitos: **Node 24+** (roda TypeScript direto, sem build) e o `.env` na raiz do
repositório — ele existe na máquina do Erick e o git o ignora.

```bash
cd "C:\Users\erick.azambuja\Desktop\DASHBOARD - Instalação\dev_ReactJS_InstallationDashboardIA"

npm test          # 1328 testes, NENHUM precisa de credencial e NENHUM precisa de build
npm run doctor    # confere .env, conexões e o guard read-only (saída mascarada)
```

Para ver a tela com dado real são **dois** passos, nesta ordem:

```bash
# 1. Materializa a camada M em disco. Uma vez; demora. Só GET nas fontes.
npm run snapshot -- --pagina=diario-instalacao --memoria=8192

# 2. Compila a tela, sobe a API e aquece as 14 páginas. Fica no ar até o Ctrl+C.
npm start          # http://localhost:3100
```

> **13/08/2026: `npm start` substituiu a sequência decorada** de `web:build` + `api` +
> `bash tools/aquece.sh`. Quem pulava o aquecimento abria a apresentação numa tela
> branca de ~1 min; quem pulava o build servia a tela de ontem. O `aquece.sh` era bash
> numa máquina Windows — agora é `tools/subir/`, TypeScript e com teste.

Em desenvolvimento da tela, com recarga a quente, são dois processos:

```bash
npm run api        # 3100
npm run web        # 5173, com proxy de /api para 3100
```

> A tela antiga (uma página só, sem filtro) continua em `http://localhost:3100/legado`.
> Ela é a referência com que comparar a nova durante a conferência — ver
> `docs/DECISAO-TELA.md` §4.

E para medir o relatório inteiro:

```bash
npm run paginas -- --erros # só as mensagens de erro, inteiras
```

> **Não rode `npm run paginas` sem `--pagina=`.** `agendamento-field` é a primeira em
> ordem alfabética e era a que levava **104 minutos** (5.2). Esse número é de **antes**
> das otimizações #46-#52 e nunca foi remedido neste harness; o que **foi** medido é a
> página pela API, que abre em **48,6 s a frio** (`npm start`, 13/08). Enquanto o
> `paginas` não tiver número novo, trate a execução sem `--pagina=` como se ainda
> fossem duas horas. A lista das outras treze está na seção 7.

> `snapshot/` **contém dado de cliente** (endereço em `field-agenda`, CPF e RG em
> `QUADRO FUNCIONAL`). Está no `.gitignore`, ancorado na raiz. Nenhuma ferramenta
> imprime valor de linha — a saída delas é segura para colar em ticket. **Mantenha
> assim.**

---

## 3. Estado exato

**1328 testes verdes.** Nenhum precisa de credencial, e nenhum precisa de build.

| camada | estado |
|---|---|
| Extrator PBIP → specs | ✅ 14 páginas, 306 visuais, 78 medidas, 49 colunas calculadas, 7 tabelas calculadas, 24 queries |
| Query Engine + camada M | ✅ **as 24 de 24** queries rodam contra a fonte real |
| Modelo semântico + avaliador DAX | ✅ as 56 funções que a base usa, 75 medidas |
| Widget Engine | ✅ card, tabela, gráfico e matriz — 117 visuais sobre dado sintético |
| **Snapshot** (`packages/snapshot`, `tools/snapshot`) | ✅ materializa a camada M em disco. Congelar as 7 calculadas leva **~26 min** — um processo por coluna, com guarda de ordem de linha (#68). Era 14 h 28 min |
| **Camada M — mesclagens** | ✅ junção que não casa **nenhuma** linha emite nota com o número; faixa de data disjunta é nomeada como causa (#73); reconciliar exige decisão em `specs/_catalog/juncoes.yaml` (#64). 2 das 3 mortas resolvidas; a 3ª **não tem conserto em código** — a fonte parou em 16/07/2025 (#73, PERGUNTAS-NEGOCIO #11) |
| **API** (`apps/api`) | ✅ somente leitura, uma página por pedido, `?filtro=` e rota de valores; cache da resposta desde 11/08 |
| **Cache da resposta** | ✅ quem invalida é o **dado**, não o relógio: a chave carrega carimbo do snapshot **e** dia UTC (32 expressões chamam `TODAY()`). O TTL virou prazo de guarda. Medido: 2 a 7 ms por página, e **continua acerto depois de 95 s parado** — antes custava 8 a 36 s a cada minuto (#69) |
| **Reaquecimento** (`apps/api/src/aquecedor.ts`) | ✅ a API se aquece no arranque e sempre que a identidade muda (snapshot refeito **ou** virada do dia). ~3 min para as 14 páginas. `npm start` espera por ele em vez de disputar |
| **Paginação de tabela** (`apps/api/src/cache-visual.ts`) | ✅ o resultado inteiro do visual fica guardado e a janela é um `slice`. Antes, cada clique em "próxima" recalculava as 33.462 linhas para entregar 200 — **2,9 s a 8,0 s por clique**, medido (#70). Orçamento LRU de 512 MB, `CACHE_VISUAL_MB=0` desliga |
| **Redis** | ⏳ **não configurado** — a `.env` tem `REDIS_KEY_PREFIX` mas **não** `REDIS_URL`, então o cache é só memória e morre no restart (o aquecimento de arranque cobre). Basta pôr `REDIS_URL=redis://host:6379/0` para ele entrar **atrás** da memória, não no lugar dela (#69) |
| **CDC / Fase 4** (`tools/cdc`) | 🚧 **o código existe, o gatilho não foi atingido.** `cdc:observa` conta, `cdc:slot` vigia o slot, `cdc:ingere` rematerializa só as queries afetadas (debounce + guarda de concorrência). Validado contra `docker/cdc/`: 15 eventos → 1 rodada de 13 queries, 12 materializaram, 2.090.676 linhas (#72). Contra o **Voalle de produção não há slot, não há medição e não está ligado** — ver §6 |
| **Autenticação** | ❌ **não existe** — costura pronta (`apps/api/src/identidade.ts`), formato da decisão em `specs/_catalog/permissoes.yaml`, sem leitor e sem login |
| **Tela** (`apps/web`) | ✅ React 19 + Vite, 14 páginas, **segmentações filtrando**, estado na URL |
| **Relatório inteiro** (`tools/paginas`) | ✅ **14/14 páginas, 117 de 117 visuais calculam**. `agendamento-field` abre em **48,6 s a frio** pela API (medido em 13/08 no `npm start`) — os 104 min do #45 são de ANTES das otimizações #46-#52 e nunca foram remedidos no `npm run paginas` |
| **Paridade** | 🚧 **medida, não fechada** — 18 batem, 18 diferem (11 delas com gabarito inválido), 6 divergem por decisão, **0 não calculam** |
| **Subida** (`tools/subir`) | ✅ `npm start` — build + API + aquecimento das 14 páginas, com teto por página e veredito |
| **Conferência do snapshot** (`npm run snapshot:confere`) | ✅ acha coluna inteira nula e calculada obsoleta em milissegundos — hoje aponta **2 erros e 5 avisos** (eram 4; ver #64) |

Os commits que são a fase 3 inteira:

```
(este)   Indice de igualdade: inverter a coluna uma vez, 635x
819cfc5  clima-tempo materializa: a URL que so existe avaliando
f0e3341  docs/CONTINUACAO.md: o ponto de entrada de quem assume o projeto
9582fc1  O relatorio inteiro contra dado real: 64 de 64 visuais calculam
8bbefa4  A tela existe: uma pagina do relatorio abre no navegador
aaae46f  As linhas do grupo ja estavam na mao: 246x, o mesmo sha256
868ebf3  O primeiro numero real: a camada M chegou ao avaliador
```

O caminho completo hoje:

```
fontes → Query Engine → camada M → toDatasetRows → snapshot/*.jsonl
                                                        │
                                        carrega() ──────┘
                                            │
                      Dataset + tabelas calculadas materializadas
                                            │
                        Evaluator → Widget Engine → apps/api → tela
```

---

## 4. Regras invioláveis

Elas não são estilo. Cada uma existe porque quebrá-la produz **número errado
plausível**, que é o único tipo de erro que este projeto não pode cometer.

1. **O PBIP é read-only.** Só o extrator lê. Nunca escreva em
   `INST - Relatório Instalação Gerencial.pbix` / `.Report` / `.SemanticModel`, na
   pasta pai.
2. **Arquivo gerado vs. humano.** Tudo em `specs/_catalog/queries|tables|measures/` e
   `specs/dashboards/` é **sobrescrito** por `npm run extract`. Nenhuma decisão humana
   mora lá — decisões vão em `specs/_catalog/cache-policies.yaml`, `divergencias.yaml`,
   `projecao.yaml` ou `juncoes.yaml`, conforme o tipo.
3. **A plataforma nunca escreve no ERP.** Quatro camadas: usuário somente-leitura,
   `default_transaction_read_only=on` na sessão, `assertReadOnly()` antes de a query
   sair do processo, e a API que só aceita `GET`/`HEAD`. Não afrouxe nenhuma.
4. **Toda implementação vem com teste**, e o teste tem de **falhar** se a regra sumir.
   Ver a seção 7: teste de mutação já pegou duas regras sem cobertura nenhuma.
5. **Toda UI segue `docs/DESIGN-SYSTEM.md` — a v2.** Fundo `#F4F4F5`, cards brancos
   radius 14px, Inter/system, âmbar `#F59E0B` (hover `#D97706`), semáforo verde
   `#10B981` / vermelho `#EF4444` / cinza `#D1D5DB`. O vermelho da marca `#E30613`
   **não é status**. A sidebar **não é desta página** — vem do AppShell do HUBBI. Sem
   HEX solto: só tokens.
   *(A v1 — `#F5F1E8`, DM Sans, sidebar 256px, `#FFB000` — era aspiracional e está
   substituída. Se encontrar esses valores em algum documento, o documento está velho.)*
6. **Nunca peça nem aceite credencial em texto.** Elas vivem só no `.env` local.
7. **Escreva em português.**

E uma regra de método, que é a que mais rendeu:

8. **Meça antes de decidir, e registre o número.** Toda decisão difícil deste projeto
   foi resolvida contando alguma coisa primeiro — quantas colunas a regra atinge,
   quantos visuais mudam, quantas linhas o corte descarta. `docs/ACHADOS.md` é o
   registro; hoje tem 73 entradas.

E uma regra de prioridade, decidida pelo Erick em 10/08/2026 — leia
`docs/DECISAO-DESEMPENHO.md` antes de mexer no caminho de carga ou de cálculo:

9. **Velocidade acima de fidelidade ao Power BI.** "Bate com o Power BI" deixou de ser
   a régua única. A régua é: número **certo e explicável**, tela **rápida** — abrir em
   menos de 2 s a frio, menos de 300 ms a quente. Refresh não tem teto, e é para lá que
   todo trabalho caro deve ir. Divergir do Power BI é permitido; divergir **em silêncio**
   não. O que a decisão *não* autoriza está listado no documento, e a regra 4 continua
   valendo inteira: coluna omitida da carga erra alto, nunca devolve BLANK calado.

---

## 5. O que está bloqueado, e de quem depende

### 5.1 `git push` — depende do Erick ou de um admin da org

A conta `erickazambuja-Sebratel` **não tem permissão de escrita** no repositório da
organização. O remoto está configurado
(`git@github.com:Sebratel/dev_ReactJS_InstallationDashboardIA.git`), mas **não existe
`origin/main`** e os **113 commits do repositório vivem só nesta máquina**. Não tente
contornar — é permissão, não configuração.

> **18/08/2026 — `apps/web/` estava fora do git.** A tela inteira, 28 arquivos,
> existia só no disco. Foi commitada junto com o resto do acúmulo (13 commits). Vale
> como aviso permanente: **rode `git status` no começo da sessão**, não no fim. Um
> `?? apps/web/` no meio da lista não parece um incidente, e era.

Confira com:

```bash
git rev-list --count HEAD          # 113 no momento em que este arquivo foi escrito
git rev-parse --verify origin/main # falha: o ref não existe
```

### 5.2 As 14 páginas calculam. `agendamento-field` foi o problema do dia 10/08.

Nenhuma página está parada por falta de dado: `field-agenda` materializou
(1.466.202 linhas, 1,06 GB, `--timeout=1800`) e `clima-tempo` também (achado #42,
1.638 linhas). As outras treze somam 96 visuais em 84 s.

**A régua mudou em 10/08/2026** — leia `docs/DECISAO-DESEMPENHO.md` (regra 9) antes de
mexer aqui. O alvo é **abrir em menos de 2 s a frio**, e o refresh não tem teto.

**O que foi feito, na ordem em que a medição mandou:**

| # | o quê | efeito medido |
|---|---|---|
| #46 | achar o dono dos 104 min: `RankAtualProtocolo`, 90% | — |
| #47 | coluna calculada **congela no snapshot**, com guarda de `sha256` | tira o rank do caminho da tela |
| #48 | materialização adota a tabela em vez de copiá-la | o heap parava de estourar |
| #49 | **a carga** também copiava | a cópia custava 337 ms contra 332 ms de ler o arquivo |
| #50 | o índice devolvia BLANK sobre coluna calculada | 5 medidas desta página estavam nesse caminho |
| #52 | projeção derivada de colunas | **45 de 107** colunas não viram memória |
| #52 | `Relato` sob demanda | 9 de 26 colunas fora de `FIELD AGENDA`; ~350 MB |

**O tempo final ainda não tem número confiável**, e o motivo é uma lição:
três medições de 10/08 foram perdidas por **execuções concorrentes de `npm run paginas`
na mesma máquina** — ver §7. Rode uma de cada vez, e confira com
`Get-CimInstance Win32_Process -Filter "Name='node.exe'"` antes de começar.

**O instrumento para a próxima rodada já existe:** `npm run paginas -- --visuais`
lista o custo de cada visual, do maior para o menor. Use-o **antes** de otimizar
qualquer coisa; os 104 minutos eram 90% de um lugar só, e cada hipótese testada às
cegas custou uma hora de relógio.

**O que sobra, se ainda não couber no orçamento:** agregar `FIELD AGENDA` ao grão
`(protocolo, slot agenda)` — 1.458.244 linhas viram **30.252**, 48× menos. É o passo 4
da `DECISAO-DESEMPENHO.md`, o maior ganho que resta e também o mais delicado: exige
saber, visual por visual, qual mede slot e qual mede relato. O Erick sugeriu fazer isso
no **SQL**, e ele está certo — o Postgres agrupa 1,46 milhão de linhas em segundos, e
aí nem se trafega nem se materializa o que vai ser jogado fora.

### 5.3 Paridade — o harness existe; faltam os números

**É o único passo que não dá para fazer sozinho.** 117 visuais calcularem quer dizer
que a conta *termina*, não que o número é o mesmo da tela.

O harness está pronto desde 10/08:

```bash
npm run paridade                              # confere tudo que tem gabarito
npm run paridade -- --pagina=visao-geral
npm run paridade -- --esqueleto=<pagina>      # gera o gabarito em branco
```

`specs/paridade/*.yaml` tem **11 páginas e 64 cards** esperando número. Abra a página no
Power BI e escreva o valor em `powerbi:`. Só card, de propósito: card é um número sem
agrupamento nem paginação, então ditar o valor é inequívoco.

**Depois da regra 9 o trabalho dele mudou de nome:** não é provar que é *idêntico* ao
Power BI, é provar que é o **pretendido**. Um card marcado `divergente: <id>` **tem** de
diferir — bater ali vira falha, e é o que impede uma decisão de ficar só no papel. Os 6
cards de `relatorio-do-mes` que dependem do `PESO` já estão marcados.

Perguntas abertas em `docs/PERGUNTAS-NEGOCIO.md` que precisam de gente:

- **#6 / #6b** — card `CLIENTES` dá 466 aqui e 558 no relatório. *(Erick, na tela.)*
- **#7** — rótulo do eixo de datas: `2026 janeiro` ou `janeiro`? *(Erick, na tela.)*
- **#2 / #4 / #5** — limpeza e `categoria4`/`categoria5`. *(Fabrício.)*
- **`# MEDIA CRIADOS`** — adiada pelo Erick em 10/08 ("como está no Power BI"). O
  denominador conta sábado como **1,5** e o numerador exclui domingo; mudar exige as
  duas pontas juntas. O mecanismo está pronto: é uma entrada em
  `specs/_catalog/divergencias.yaml`.
- **#1** — ✅ respondida e **implementada**: sábado e domingo valem 0,5.

---

## 6. O que fazer a seguir (ordem sugerida)

> **O perímetro foi fechado em 11/08/2026** — [ACHADOS](ACHADOS.md) #56, a partir da
> revisão de arquitetura do #55. Já estão feitos: parâmetro de SQL (o valor de um
> filtro nunca vira texto de query), o cache da resposta calculada ligado com Redis
> e degradação para memória, `ARCHITECTURE.md` separado entre o que existe e o que é
> desenho, e a costura de identidade da Fase 4.

1. **Ditar os números de paridade que faltam.** Voltou a ser o primeiro item: o bloqueio
   de operação de 14/08 foi resolvido ([ACHADOS](ACHADOS.md) #68 — o congelamento caiu de
   14 h 28 min para 26 min), e a paridade é o único passo que ninguém faz sozinho. Abra
   `http://localhost:3100` ao lado do Power BI, ache a linha `visual: <id>` em
   `specs/paridade/<pagina>.yaml` — **o id aparece embaixo de cada card na tela, de
   propósito** — e escreva o valor em `powerbi:`. As 3 páginas cujo gabarito é inválido
   (`docs/PARIDADE-11-08.md`) são 11 das 18 divergências: elas vêm primeiro. São 64 cards,
   dos quais 22 já saíram por serem carimbo de refresh.
2. ✅ **A terceira mesclagem morta foi investigada em 18/08/2026 — e não tem conserto
   em código.** [ACHADOS](ACHADOS.md) #73. `DB_Applicattion.Installation_Teams` **parou
   de receber linha em 16/07/2025**: 0 registros de 2026. Como `PROTOCOLOS GERAL` só
   carrega 2026, as faixas de data **não se sobrepõem em um único dia** — a junção casa
   0 de 26.130 e `TÉCNICO 2`/`GERENTE/SUPERVISOR` saem inteiras nulas, aqui e no Power
   BI. O nome casa (26 dos 70 técnicos, 11.703 linhas): se a tabela voltar a ser
   alimentada, a junção funciona sem mudar código.

   Virou **`PERGUNTAS-NEGOCIO.md` #11**, não item de fila técnica. `juncoes.yaml`
   reconcilia *tipo* de chave; faixa disjunta não é problema de tipo. O que saiu de
   código foi diagnóstico: `Table.NestedJoin` agora nomeia a faixa disjunta em vez de
   mandar "conferir as duas pontas", e o `run:mlayer` passou a imprimir as notas da
   camada M e a honrar o `juncoes.yaml` — ele fazia nem uma nem outra.
3. **Empurrar para SQL o que o SQL faz melhor** — as mesclagens de **mesma fonte** e a
   agregação de `FIELD AGENDA` ao grão `(protocolo, slot)`, que é o passo 4 da
   `DECISAO-DESEMPENHO.md` e o maior ganho que resta (1.458.244 linhas → 30.252).
   **Depois do item 1**, e o motivo é a rede de segurança: sem gabarito de paridade
   verde, um `LEFT JOIN` que multiplica linha passa despercebido. As 3 mesclagens
   *cross-source* ficam na camada M — a `DECISAO-CAMADA-M` vale onde o argumento dela
   vale. O SQL escrito à mão não pode morar em `specs/_catalog/queries/` (regra 2);
   o lugar é um `sql-override.yaml` no molde de `divergencias.yaml`, com
   `original_sha` da expressão M que ele substitui.
4. **Chart SDK.** A tela desenha barra em HTML de propósito — escolher uma biblioteca
   de passagem seria decidir por uma peça que tem dono. Quando for hora, é decisão
   registrada, não escolha de conveniência.

Não faça na frente disso, e o motivo:

- **Não migre a API para Fastify ainda.** Metade desta espera terminou em 11/08 — a
  tela virou React/Vite (`DECISAO-TELA.md`) —, mas a API **continua** em `node:http` de
  propósito. A condição de revisão do [ACHADOS](ACHADOS.md) #39 não mudou: Permission
  Engine, corpo de requisição e WebSocket de realtime. Antes disso é troca de peça que
  funciona.
- **Não aponte o CDC para o Voalle.** Isto mudou em 18/08/2026 e mudou só pela
  metade — leia [ACHADOS](ACHADOS.md) #71 e #72 antes.

  **O que passou a existir:** `npm run cdc:ingere`. Ele resolve as queries afetadas
  pelo evento e roda `snapshot --query=<ids> --refazer` só nelas, com debounce e
  guarda de concorrência. Não inventa invalidação: o carimbo do snapshot novo já está
  na chave do cache, então o cache cai sozinho. Está **validado ponta a ponta** contra
  a stack de `docker/cdc/` — 15 eventos crus coalesceram em 1 rodada de 13 queries,
  12 materializaram, 2.090.676 linhas.

  **O que continua fora:** o gatilho de
  [DECISAO-REALTIME.md](DECISAO-REALTIME.md) — as **duas medições** — segue **não
  medido e não atingido contra o Voalle de produção**. Existir o consumidor não
  autoriza ligá-lo lá. O que autoriza é o número, e ele é um número: não a
  disponibilidade do Kafka no Portainer, nem o fato de o código estar pronto.
  `npm run cdc:observa` continua sendo o instrumento, e continua só contando.

  **A ordem, quando for a hora:** medir com `cdc:observa` numa janela de verdade
  (minutos, não milissegundos — 4 eventos em 56 ms foi exatamente o que enganou no
  #71) → confrontar com o gatilho → só então o RUNBOOK.
- **Não registre conector Debezium sem o monitor de slot de pé.**
  `npm run cdc:slot -- --vigia`. Slot sem consumidor retém WAL até o disco do ERP
  encher, e o incidente é no Voalle, em produção. Leia
  [RUNBOOK-CDC.md](RUNBOOK-CDC.md) antes — inclusive o rollback, que tem ordem certa
  (parar o conector **antes** de derrubar o slot, senão ele o recria).

---

## 7. Armadilhas que já custaram tempo

Cada uma destas apareceu de verdade nesta base. Ler aqui é mais barato que redescobrir.

**Sobre o cálculo**

- **Dado sintético não prova quase nada.** Duas regras inteiras passaram despercebidas
  porque o teste sempre põe número em coluna numérica e tabela de 5 linhas. Os achados
  #38 e #40 só apareceram contra a base real.
- **Teste de mutação, sempre.** Quebre a regra de propósito e veja se algum teste cai.
  Duas vezes a resposta foi **zero de 860** — e as duas viraram teste. Se a mutação não
  derruba nada, a regra não está coberta, independentemente de quantos testes existam.
- **Erre alto, nunca chute.** Função não implementada, tipo inesperado, âncora ambígua:
  a resposta é erro com mensagem que diz o que fazer. Um número plausível e errado é o
  pior resultado possível aqui.
- **Conversão de tipo nunca é silenciosa.** `npm run paginas` lista as colunas
  convertidas. Se você acrescentar outra conversão, ela tem de aparecer em algum lugar.

**Sobre medir**

- **Uma medição de cada vez, e confira antes de começar.** Em 10/08/2026 **três**
  medições de `agendamento-field` foram perdidas: duas porque havia outro
  `npm run paginas` da mesma página rodando em paralelo — dois processos de 8 GB numa
  máquina de 16 disputando tudo —, e uma porque eu matei o que achei ser duplicata.
  Custou a manhã. Antes de medir:

  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId,CommandLine
  ```

  E olhe a **linha de comando**, não só o PID: os dois eram idênticos exceto por
  `--max-old-space-size`, e foi só aí que ficou claro que um não era meu.
- **`kill -0 <pid>` do Git Bash mente sobre PID do Windows.** MSYS tem espaço de PID
  próprio, então o watcher deu "processo terminou" com o processo vivo. Use
  `Get-Process -Id <pid> -ErrorAction SilentlyContinue`.
- **Parar a tarefa de background mata o `npm`, não o `node` filho.** Em 11/08 isso me
  deu `EADDRINUSE` e, pior, um servidor **com código velho** respondendo como se fosse
  o novo. Para matar de verdade, ache o dono da porta:

  ```powershell
  $c = Get-NetTCPConnection -LocalPort 3100 -State Listen; Stop-Process -Id $c.OwningProcess -Force
  ```

  E prefira `PORT=3101 npm run api` a matar o servidor de outra sessão.
- **`chrome --headless --screenshot` não grava arquivo; `--headless=old` grava.** O
  `--dump-dom` funciona nos dois, e é ele que prova que o React montou. Um screenshot
  que não sai parece "a página não renderizou" quando o DOM está perfeito.
- **Saída canalizada para `tail` só aparece no fim.** Um `npm run paginas | tail -60`
  em segundo plano fica 45 minutos sem escrever nada, e não dá para saber se avançou.
  Redirecione para arquivo (`> arquivo 2>&1`) e leia o arquivo.
- **Antes de otimizar, rode `npm run paginas -- --visuais`.** Ele lista o custo de cada
  visual, do maior para o menor. Os 104 minutos do #46 eram 90% de um lugar só, e cada
  hipótese testada sem esse número custou uma hora.
- **`npm run paridade` só imprime no fim.** Ele calcula as 14 páginas e só então escreve
  as 64 linhas. Um arquivo de saída vazio depois de 30 minutos **não** quer dizer que
  travou — confira o processo (`Get-Process node`) e olhe o CPU subindo. Em 13/08 isso
  me fez suspeitar de laço infinito onde o programa estava trabalhando.
- **`npm start` com a porta ocupada aquecia o servidor de OUTRA sessão** — e o
  relatório saía bonito. O filho morria com `EADDRINUSE`, o `esperaSaude` recebia 200
  do processo alheio, e o programa concluía "subiu". Consertado em 14/08: ele confere
  a porta **antes** de subir (`tools/subir/src/porta.ts`, com teste) e diz o que fazer.
  Se você vir a mensagem, as saídas são `--porta=3101`, `npm run aquece`, ou matar o
  dono da porta.
- **`npm start` reprova e mesmo assim deixa a API no ar.** Se ele disser "passou de
  180s" numa página, essa página é o problema — rode
  `npm run paginas -- --pagina=<ela> --visuais` e olhe o visual mais caro. Foi assim que
  o `tableEx` de 40 min do #63 apareceu.

**Sobre o ambiente**

- **Node apaga tipos, não gera código.** `constructor(private readonly x: T)`
  (propriedade de parâmetro) **não compila**. Declare o campo e atribua no corpo.
- **Os arquivos são CRLF.** A ferramenta `Edit` falha em alguns; um script Python que
  normaliza para LF, aplica e regrava CRLF funciona. **Confira depois de todo script de
  edição** — um `assert` no meio já abortou um patch deixando metade aplicada.
- **`import yaml` não resolve fora do repositório.** Em script de rascunho, importe por
  caminho absoluto `file:///.../node_modules/yaml/dist/index.js`.
- **Não rode `npm run snapshot -- --todas` sem necessidade.** São ~20 minutos e 123 MB.
  Materialize por página.
- **`npm run paginas` roda as páginas em série, e a primeira leva 104 minutos.**
  `agendamento-field` é a primeira em ordem alfabética (5.2): rodando sem
  `--pagina=`, o relatório inteiro parece travado por quase duas horas. Use a lista
  das outras treze enquanto o #45 não fechar:

  ```bash
  npm run paginas -- --pagina=capa,diario-instalacao,instalacao-reincidente,l-inst,  l-mapa,l-tec,manutencao-inicial,premiacao-instalacao,protocolos-detalhados,  relatorio-do-ano,relatorio-do-mes,telefonia-ouvidoria,visao-geral
  ```
- **Script de rascunho: o stdout do Node vira buffer de bloco quando é cano.** Um
  processo que trava não imprime *nada* do que já tinha feito, e a saída vazia se
  parece com "não começou". Em script de diagnóstico, grave com `appendFileSync` a
  cada item — foi o que separou "trava num visual" de "trava no carregamento".
- **Confira se sobrou processo `node` de uma execução anterior.** Dois `paginas` de
  8 GB de heap disputando a máquina fazem qualquer medida de tempo mentir.
  `Get-Process node | Where-Object { $_.CPU -gt 10 }`.

**Sobre o repositório**

- **Outra sessão pode estar commitando em paralelo.** Rode `git status` e confira o que
  está staged **antes** de commitar; um `git add -A` distraído leva o trabalho dela
  junto. Em 18/08/2026 os arquivos que eram dela — `prototype.html`,
  `docs/DOCUMENTACAO_ARQUITETURA.md`, `docs/diagrama_arquitetura.svg`,
  `docs/miro_diagrams/` — **não existem mais no disco**, e `docs/DECISAO-REALTIME.md`
  está commitado. A armadilha continua valendo como método; a lista, não.
- **`git status` no começo da sessão, não no fim.** Foi assim que `apps/web/` passou
  dias inteiro fora do git — ver §5.1.
- **`docker-compose.yml` da raiz é armadilha, e está fora do git de propósito.** É a
  variante incompleta descrita no [ACHADOS](ACHADOS.md) #71 — sem Postgres falso e sem
  conector — e ela **briga por porta** com `docker/cdc/docker-compose.yml`, que é a que
  o [RUNBOOK-CDC.md](RUNBOOK-CDC.md) manda usar. Foi ela que produziu os "4 eventos em
  56 ms" que quase passaram por medição. Não a versione; se for apagar, apague.

---

## 8. Mapa do repositório

```
packages/
  query-engine/     busca linhas da fonte, com cache, timeout e guard read-only
  transform-engine/ a camada M (Power Query) — 39 funções, 303 passos
  semantic-model/   tabelas, colunas, medidas e relacionamentos vindos do PBIP
  measure-engine/   o avaliador de DAX: contexto de filtro, 56 funções, propagação
  widget-engine/    card, tabela, gráfico e matriz — o cálculo de um visual
  snapshot/         formato em disco, plano por página, carregamento
apps/
  api/              servidor somente-leitura; serve a tela compilada e `/legado`
  web/              a tela: React 19 + Vite. A lógica testável mora em `.ts` puro
                    (formato, rota, api, rotulos) e só o desenho em `.tsx` —
                    `node --test` roda TypeScript, mas não JSX.
tools/
  extractor/ validate/ doctor/ auth/ probe/ mrun/ cdc/ powerbi/
  snapshot/         materializa a camada M em disco; `confere.ts` audita o que ficou lá
  subir/            `npm start`: build + API + aquecimento das 14 páginas, com teto
  paginas/          calcula o relatório inteiro e conta o que fecha
  paridade/         compara com o gabarito ditado do Power BI
specs/              GERADO pelo extrator — o contrato. Não editar à mão.
  _catalog/cache-policies.yaml  decisões humanas de cache
  _catalog/divergencias.yaml    onde o DAX diverge do PBI, com o sha do original
  _catalog/projecao.yaml        coluna usada que fica fora da carga (sob demanda)
  _catalog/juncoes.yaml         mesclagem morta que pode casar como inteiro (#64)
docs/
  ACHADOS.md          73 achados. É a memória técnica do projeto — leia antes de
                      "consertar" qualquer coisa que pareça estranha.
  PERGUNTAS-NEGOCIO.md o que só o Erick responde
  DESIGN-SYSTEM.md     v2 — autoritativa
  ARCHITECTURE.md      o desenho alvo (a API diverge dele de propósito, ver #39)
```

**Se for ler um documento só antes de mexer no cálculo, leia `docs/ACHADOS.md`.** Quase
toda coisa que parece um bug já está lá, explicada, com o número que a mediu.
