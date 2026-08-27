# Continuação — onde o trabalho parou

> **Atualizado em 14/08/2026**, depois de as mesclagens mortas da camada M serem
> achadas e decididas (#64) e de o congelamento de `Status Protocolo Dia` revelar
> **14 h 28 min** (#66). É o ponto de entrada de uma sessão nova: autocontido, feito
> para ser lido antes de tocar em qualquer coisa.
>
> **Se for ler uma coisa só antes de escolher o que fazer, leia o #66.** Ele é o maior
> número aberto do projeto e passou na frente da paridade.
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

> **Mas a paridade deixou de ser o primeiro item em 14/08.** Congelar
> `Status Protocolo Dia` leva **14 h 28 min**, e 12 h 50 disso é **uma coluna
> calculada** ([ACHADOS](ACHADOS.md) #66). Como a guarda de idade do #60 obriga a
> regenerá-la sempre que uma origem é rematerializada, hoje **o snapshot não pode ser
> atualizado num dia de trabalho**. Isso é bloqueio de operação, não lentidão.

---

## 2. Rodar em cinco minutos

Requisitos: **Node 24+** (roda TypeScript direto, sem build) e o `.env` na raiz do
repositório — ele existe na máquina do Erick e o git o ignora.

```bash
cd "C:\Users\erick.azambuja\Desktop\DASHBOARD - Instalação\dev_ReactJS_InstallationDashboardIA"

npm test          # 939 testes, ~4 s, NENHUM precisa de credencial
npm run doctor    # confere .env, conexões e o guard read-only (saída mascarada)
```

Para ver a tela com dado real são dois passos, nesta ordem:

```bash
# 1. Materializa a camada M em disco. Uma vez; demora. Só GET nas fontes.
npm run snapshot -- --pagina=diario-instalacao --memoria=8192

# 2. Sobe API + tela
npm run api        # http://localhost:3100
```

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

**939 testes verdes.** Nenhum precisa de credencial.

| camada | estado |
|---|---|
| Extrator PBIP → specs | ✅ 14 páginas, 306 visuais, 78 medidas, 49 colunas calculadas, 7 tabelas calculadas, 24 queries |
| Query Engine + camada M | ✅ **as 24 de 24** queries rodam contra a fonte real |
| Modelo semântico + avaliador DAX | ✅ as 56 funções que a base usa, 75 medidas |
| Widget Engine | ✅ card, tabela, gráfico e matriz — 117 visuais sobre dado sintético |
| **Snapshot** (`packages/snapshot`, `tools/snapshot`) | ✅ materializa a camada M em disco. ⚠️ **Congelar as calculadas leva 14 h 28 min** — 6 delas em 7 s e `Status Protocolo Dia` no resto (#66) |
| **Camada M — mesclagens** | ✅ junção que não casa **nenhuma** linha emite nota com o número; reconciliar exige decisão em `specs/_catalog/juncoes.yaml` (#64). 2 das 3 mortas resolvidas |
| **API** (`apps/api`) | ✅ somente leitura, uma página por pedido, `?filtro=` e rota de valores; cache da resposta desde 11/08 |
| **Cache da resposta** | ✅ quem invalida é o **dado**, não o relógio: a chave carrega carimbo do snapshot **e** dia UTC (32 expressões chamam `TODAY()`). O TTL virou prazo de guarda. Medido: 2 a 7 ms por página, e **continua acerto depois de 95 s parado** — antes custava 8 a 36 s a cada minuto (#69) |
| **Reaquecimento** (`apps/api/src/aquecedor.ts`) | ✅ a API se aquece no arranque e sempre que a identidade muda (snapshot refeito **ou** virada do dia). ~3 min para as 14 páginas. `npm start` espera por ele em vez de disputar |
| **Paginação de tabela** (`apps/api/src/cache-visual.ts`) | ✅ o resultado inteiro do visual fica guardado e a janela é um `slice`. Antes, cada clique em "próxima" recalculava as 33.462 linhas para entregar 200 — **2,9 s a 8,0 s por clique**, medido (#70). Orçamento LRU de 512 MB, `CACHE_VISUAL_MB=0` desliga |
| **Redis** | ⏳ **não configurado** — a `.env` tem `REDIS_KEY_PREFIX` mas **não** `REDIS_URL`, então o cache é só memória e morre no restart (o aquecimento de arranque cobre). Basta pôr `REDIS_URL=redis://host:6379/0` para ele entrar **atrás** da memória, não no lugar dela (#69) |
| **CDC / Fase 4** (`tools/cdc`) | 🚧 **o código existe, o gatilho não foi atingido.** `cdc:observa` conta, `cdc:slot` vigia o slot, `cdc:ingere` rematerializa só as queries afetadas (debounce + guarda de concorrência). Validado contra `docker/cdc/`: 15 eventos → 1 rodada de 13 queries, 12 materializaram, 2.090.676 linhas (#72). Contra o **Voalle de produção não há slot, não há medição e não está ligado** — ver §6 |
| **Autenticação** | ❌ **não existe** — costura pronta (`apps/api/src/identidade.ts`), formato da decisão em `specs/_catalog/permissoes.yaml`, sem leitor e sem login |
| **Tela** (`apps/web`) | ✅ React 19 + Vite, 14 páginas, **segmentações filtrando**, estado na URL |
| **Relatório inteiro** (`tools/paginas`) | ✅ **13/14 páginas, 96 de 96 visuais calculam** |
| **Paridade** | 🚧 **medida, não fechada** — 18 batem, 18 diferem (11 delas com gabarito inválido), 6 divergem por decisão, **0 não calculam** |
| **Subida** (`tools/subir`) | ✅ `npm start` — build + API + aquecimento das 14 páginas, com teto por página e veredito |
| **Conferência do snapshot** (`npm run snapshot:confere`) | ✅ acha coluna inteira nula e calculada obsoleta em milissegundos — hoje aponta **4 erros e 5 avisos** |

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

1. **A base de referência é read-only — e o PBIP não está mais no disco.**
   Verificado em 27/08/2026: não há `.pbix` / `.pbip` / `.Report` /
   `.SemanticModel` na pasta pai. O que existe é a **extração**, em
   `../QUERIES-DASHBOARD-INSTALACAO/`, e ela só se lê.
   **Nunca procure nem exija um `.pbip`** (regra 1 do `CLAUDE.md`).
   E cuidado com o nome: o alvo é o `INST - Relatório Instalação`, **não** o
   `... Gerencial` — são dois relatórios (Erick, 27/08/2026).
2. **Arquivo gerado vs. humano.** Tudo em `specs/_catalog/queries|tables|measures/` e
   `specs/dashboards/` é **sobrescrito** por `npm run extract`. Nenhuma decisão humana
   mora lá — decisões vão em `specs/_catalog/cache-policies.yaml`.
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
   registro; hoje tem 40 entradas.

---

## 5. O que está bloqueado, e de quem depende

### 5.1 `git push` — depende do Erick ou de um admin da org

A conta `erickazambuja-Sebratel` **não tem permissão de escrita** no repositório da
organização. O remoto está configurado
(`git@github.com:Sebratel/dev_ReactJS_InstallationDashboardIA.git`), mas **não existe
`origin/main`** e os **59 commits do repositório vivem só nesta máquina**. Não tente
contornar — é permissão, não configuração.

Confira com:

```bash
git rev-list --count HEAD          # 59 no momento em que este arquivo foi escrito
git rev-parse --verify origin/main # falha: o ref não existe
```

### 5.2 As 14 páginas calculam. Uma leva 104 minutos.

Nenhuma página está parada por falta de dado: `field-agenda` materializou
(1.458.244 linhas, 950 MB, `--timeout=1800`) e `clima-tempo` também (achado #42,
1.638 linhas). O índice de igualdade (#44) destravou o resto.

`agendamento-field` **termina** — 21 de 21 visuais, 0 erros, pela primeira vez — mas:

| | |
|---|---|
| carga | **25,6 s** |
| **cálculo** | **104 minutos** |

As outras treze somam 96 visuais em 84 s. Enquanto for assim, **não rode
`npm run paginas` sem `--pagina=`**: a lista das 13 está na seção 7.

**O que já foi feito, para não refazer.** O índice de igualdade
(`packages/measure-engine/src/indice.ts`) cobre as três formas caras —
`CALCULATE(x, 'T'[c]=v)`, `FILTER('T', 'T'[c]=v && …)` e
`CALCULATE(MAX(…), FILTER(…))`. Ele funciona: mediu 635× na reprodução sintética e
tirou a carga desta página de "nunca vista terminar" para 25,6 s.

**O que sobra, e por onde começar.** As 7 colunas calculadas de `FIELD AGENDA`
materializam **sob demanda**, e quem as toca são os visuais — por isso o custo saiu
da carga e apareceu no cálculo. Duas delas varrem `FIELD AGENDA` por linha de
`FIELD AGENDA`:

```
RankDataProtocolo  = … DISTINCT(SELECTCOLUMNS(FILTER('FIELD AGENDA',
                       'FIELD AGENDA'[protocolo] = ProtocoloAtual), …))
RankAtualProtocolo = CALCULATE(MAX('FIELD AGENDA'[RankDataProtocolo]),
                       FILTER('FIELD AGENDA', 'FIELD AGENDA'[protocolo] = ProtocoloAtual))
```

**Já medido (achado #46): não é visual nenhum, é uma coluna.**

| coluna calculada de `FIELD AGENDA` | µs/linha |
|---|---|
| **`RankAtualProtocolo`** | **697** — ~90% do total |
| `RankDataProtocolo` | 77 |
| as outras cinco | 2 a 25 |

O custo é **linear** nas fatias medidas, o que confirma que o índice do #44 pegou:
sem ele estas duas seriam quadráticas. O que sobrou é **custo constante por
chamada** — `filterFromTable` monta chave de linha sobre as **26 colunas** de
`FIELD AGENDA`, ~3.000 a 4.000 composições de chave por linha da tabela.

**A decisão vem antes da próxima otimização**, e está aberta em
`docs/PERGUNTAS-NEGOCIO.md` #8: essas duas colunas são *rank por protocolo*, e o
Power BI as calcula **no refresh, uma vez**. Materializá-las no snapshot tira os 104
minutos do caminho da tela — nenhuma otimização de avaliador chega perto, porque o
problema não é a velocidade do cálculo, é o **momento** dele. Em troca, o snapshot
deixa de ser "a camada M em disco" e vira "o dataset materializado".

### 5.3 Paridade — depende de alguém abrir o Power BI

**Este é o próximo grande passo, e é o único que não dá para fazer sozinho.** 64
visuais calcularem quer dizer que a conta *termina*; não que o número é o mesmo.

Perguntas abertas em `docs/PERGUNTAS-NEGOCIO.md` que precisam do Erick na frente da
tela:

- **#6 / #6b** — card `CLIENTES` dá 466 aqui e 558 no relatório.
- **#7** — o rótulo do eixo de datas: `2026 janeiro` ou `janeiro`?
- **#1** — sábado conta como dia útil no cálculo?
- O `rowCount` de **6 tabelas**, a conferir contra a tela.

---

## 6. O que fazer a seguir (ordem sugerida)

1. **Montar o harness de paridade.** Hoje `npm run paginas` diz *que calculou*; falta
   um arquivo onde o Erick dite os números da tela e a ferramenta compare. Sugestão:
   `specs/paridade/<pagina>.yaml` com `visual: id, esperado: <número>`, e
   `npm run paridade` apontando as divergências. Sem isso, cada conferência é manual e
   se perde. **Agora vale para 96 visuais, não 64** — é mais valioso que era.
2. **`Status Protocolo Dia`** (ver 5.2) — destrava a 14ª página. O número que
   dimensiona o trabalho já está medido; o desenho vem do achado #38.
3. **Filtros na tela.** O relatório tem segmentações (`slicer`) que hoje aparecem como
   "sem número". Fazê-las filtrar de verdade é o que separa "página que abre" de
   "dashboard que se usa". Os filtros de página e de visual **já** são aplicados; o que
   falta é a interação.
4. **Empurrar para SQL o que o SQL faz melhor** — as mesclagens de **mesma fonte** e a
   agregação de `FIELD AGENDA` ao grão `(protocolo, slot)`, que é o passo 4 da
   `DECISAO-DESEMPENHO.md` e o maior ganho que resta (1.458.244 linhas → 30.252).
   **Depois do item 1**, e o motivo é a rede de segurança: sem gabarito de paridade
   verde, um `LEFT JOIN` que multiplica linha passa despercebido. As 3 mesclagens
   *cross-source* ficam na camada M — a `DECISAO-CAMADA-M` vale onde o argumento dela
   vale. O SQL escrito à mão não pode morar em `specs/_catalog/queries/` (regra 2);
   o lugar é um `sql-override.yaml` no molde de `divergencias.yaml`, com
   `original_sha` da expressão M que ele substitui.
5. **Chart SDK.** A tela desenha barra em HTML de propósito — escolher uma biblioteca
   de passagem seria decidir por uma peça que tem dono. Quando for hora, é decisão
   registrada, não escolha de conveniência.

Não faça na frente disso, e o motivo:

- **Não migre para Fastify/React/Vite ainda.** O `ARCHITECTURE.md` os declara, e a API
  atual diverge de propósito (`node:http`, sem build) — está registrado no
  [ACHADOS](ACHADOS.md) #39, com a condição de revisão: Permission Engine, corpo de
  requisição e WebSocket de realtime. Antes disso é troca de peça que funciona.
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
- **`npm run paginas` roda as páginas em série, e uma que trava esconde as outras.**
  `agendamento-field` é a primeira em ordem alfabética e não termina (5.2): rodando
  sem `--pagina=`, o relatório inteiro parece travado. Use a lista explícita das 13
  enquanto o #43 não fechar.
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
docs/
  ACHADOS.md          40 achados. É a memória técnica do projeto — leia antes de
                      "consertar" qualquer coisa que pareça estranha.
  PERGUNTAS-NEGOCIO.md o que só o Erick responde
  DESIGN-SYSTEM.md     v2 — autoritativa
  ARCHITECTURE.md      o desenho alvo (a API diverge dele de propósito, ver #39)
```

**Se for ler um documento só antes de mexer no cálculo, leia `docs/ACHADOS.md`.** Quase
toda coisa que parece um bug já está lá, explicada, com o número que a mediu.
