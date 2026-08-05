# Decisão: implementar a camada M ou substituí-la por SQL?

**Para o Erick decidir.** Fase 2b.8. Tudo abaixo foi medido no PBIP com
`npm run validate:tables` e com o scanner de M (`tools/validate/src/mlayer.ts`), não
estimado. Recomendação no fim, com o custo de cada caminho.

## A pergunta

Entre o SQL e a tabela que o DAX vê existem **303 passos de Power Query**. Eles criam
56 colunas do modelo — 11 delas citadas pelo DAX — e mudam a contagem de linhas em 11
das 17 tabelas ([ACHADOS](./ACHADOS.md) #15). Sem essa camada, essas colunas chegam
vazias e essas tabelas têm outro tamanho.

A pergunta é onde essa lógica passa a viver: num executor de M dentro da plataforma, ou
reescrita como SQL que a fonte executa.

## O que a camada M é, em número

| | |
|---|---|
| Passos | **303** em 23 queries legíveis (a 24ª, `clima-tempo`, o scanner recusa) |
| Onde estão | **226** nas 18 queries que viram tabela; **77** em 6 queries que existem **só para ser mescladas** (`alocacao-patrimonio`, `troca-endereco`, `tecnicos-auxiliares`, `protocolos-auxiliares`, `gestores-equipes`, `quadro-funcional`) |
| Funções de tabela distintas | **23** |
| Funções de valor distintas | **15** |
| Mesclagens (`NestedJoin` + `Combine`) | **15**, das quais **3 atravessam fonte de dados** |
| Passos que mexem em linha | **25** |

As 23 funções de tabela, por frequência:

```
Table.ReplaceValue:65  Table.RenameColumns:47  Table.AddColumn:32
Table.TransformColumnTypes:29  Table.TransformColumns:22  Odbc.Query:18
Table.NestedJoin:14  Table.ExpandTableColumn:14  Table.SelectRows:14
Table.Sort:9  Table.RemoveColumns:9  Table.DuplicateColumn:6  Table.SplitColumn:4
GoogleSheets.Contents:3  Table.PromoteHeaders:3  Table.Distinct:3
Table.ReorderColumns:2  Table.Skip:1  Table.FromRows:1  Table.SelectColumns:1
Table.Combine:1  DateTimeZone.SwitchZone:1
```

As 15 de valor — é aqui que está a "lógica de negócio" da camada, e ela é pequena:

```
DateTime.Time:12  Text.Proper:8  Text.Upper:5  Text.Combine:4  Text.From:4
Splitter.SplitTextByDelimiter:4  Text.AfterDelimiter:4  Text.BeforeDelimiter:4
DateTime.Date:3  Date.AddMonths:1  Json.Document:1  DateTimeZone.SwitchZone:1
DateTimeZone.LocalNow:1  DateTime.LocalNow:1  Duration.Days:1
```

Para comparar tamanho: o avaliador de DAX implementa **56** funções e levou as fases
2b.2 a 2b.7. A camada M são **38** nomes (23 + 15), e a maioria é mecânica.

## Fato decisivo 1 — 3 das 15 mesclagens atravessam fonte de dados

```
backlog-agendado-futuro (dbMaria)   ←  protocolos-geral   (dbVoalle)
protocolos-geral        (dbVoalle)  ←  gestores-equipes   (dbMaria)
protocolos-produtividade(dbVoalle)  ←  quadro-funcional   (gsheets)
```

**Nenhum `SELECT` faz essas três.** São PostgreSQL × MariaDB e PostgreSQL × Google
Sheets. Quem junta é o Power Query, na memória, depois de buscar os dois lados.

Isso já resolve metade da pergunta: a plataforma vai precisar de junção **acima** dos
connectors de qualquer maneira. E as três não são de canto — duas delas são
`PROTOCOLOS GERAL` e `PROTOCOLOS PRODUTIVIDADE`, as duas maiores tabelas do modelo.

Consequência de dependência que vale registrar: `PROTOCOLOS PRODUTIVIDADE` **não pode
ser construída fielmente sem o connector de Google Sheets**, que não existe. As outras
duas mesclagens cruzadas são dbVoalle × dbMaria, e os dois connectors já funcionam.

## Fato decisivo 2 — SQL escrito à mão não tem onde morar

Regra 2 do projeto: tudo em `specs/_catalog/queries/` é **sobrescrito** por
`npm run extract`, e nenhuma decisão humana pode viver lá. Um SQL que substitua o M
seria exatamente isso: uma decisão humana num arquivo gerado.

E o problema não é de arrumação. Quando alguém mexer no Power Query do relatório atual
— e vão mexer, o relatório está em uso —, o extrator regrava a spec e o SQL escrito à
mão **não acompanha**. Divergência em silêncio, no lugar onde ninguém procura. É o
mesmo argumento que fez as 78 medidas não serem 78 funções TypeScript.

## Fato decisivo 3 — um trecho não é replicável só lendo o M

Em `PROTOCOLOS GERAL`, nesta ordem:

| Passo | O que faz |
|---|---|
| 47 `Linhas Classificadas` | `Table.Sort` por `INSTALADO POR:` **descendente** |
| 50–51 `GESTORES EQUIPES` | mescla com dbMaria e expande: **multiplica linha** |
| 53 `Duplicatas Removidas` | `Table.Distinct` por **`SOLICITACAO`** |

`Table.Distinct` mantém a **primeira** ocorrência na ordem corrente. Então qual
supervisor fica preso a cada protocolo depende da ordem das linhas na hora do passo 53
— ordem que vem de um `Table.Sort` feito três passos antes e **atravessa uma
mesclagem**. Nada no M diz o que acontece com a ordenação dentro de um `NestedJoin`.

Em SQL isso seria `DISTINCT ON (solicitacao) ... ORDER BY ...`, que exige um critério
de desempate **explícito**. Não há como derivar esse critério do texto do M: ele é um
detalhe de implementação do Power Query.

Vale notar o que isso diz do scanner: `Table.Sort` está classificado como neutro, e está
certo — não muda coluna nem contagem. Mas ele muda **qual linha sobrevive** a um
`Table.Distinct` posterior. Contagem igual, valores diferentes.

Depois do 53 vem `TECNICOS AUXILIARES Expandido`, que multiplica linha e **não** tem
dedup depois. Ou seja: a tabela final tem `SOLICITACAO` repetida mesmo assim — o que
explica os 37 `DISTINCTCOUNT` do DAX.

## As 11 colunas que o DAX usa e o SQL não devolve

Bem menos assustadoras do que o nome sugere. Nenhuma é lógica de negócio nova:

| # | Coluna | O que é |
|---|---|---|
| 1 | `PROTOCOLOS GERAL[HORA AGENDA]` | `DateTime.Time([DATA AGENDA])`, depois renomeada |
| 2 | `PROTOCOLOS GERAL[HORA CRIADO]` | `DateTime.Time([DATA CRIADO])`, depois renomeada |
| 3 | `PROTOCOLOS GERAL[HR. ALOCAÇÃO]` | `DateTime.Time` sobre coluna vinda da mesclagem com `alocacao-patrimonio` |
| 4 | `PROTOCOLOS GERAL[DATA ALOCAÇÃO]` | renome de `DT.ALOCAÇÃO` (coluna do SELECT) |
| 5 | `PROTOCOLOS GERAL[TÉCNICO INSTALAÇÃO]` | renome de `INSTALADO POR:` (coluna do SELECT) |
| 6 | `PROTOCOLOS GERAL[TÉCNICO TROCA]` | renome de `TÉCNICO`, expandida de `troca-endereco` |
| 7 | `PROTOCOLOS GERAL[DATA DA TROCA]` | expandida de `troca-endereco` |
| 8 | `PROTOCOLOS PRODUTIVIDADE[DATA ALOCAÇÃO]` | igual à 4 |
| 9 | `PROTOCOLOS PRODUTIVIDADE[TÉCNICO TROCA]` | igual à 6 |
| 10 | `PROTOCOLOS PRODUTIVIDADE[DATA DA TROCA]` | igual à 7 |
| 11 | `PROTOCOLOS PRODUTIVIDADE[INSTALADOR]` | renome de `TECNICO` |

**9 são renome puro; 2 vêm de uma mesclagem que é da mesma fonte** (`troca-endereco` é
dbVoalle). Só as 3 de hora precisam de cálculo, e é `::time`.

Se o problema fossem só as 11 colunas, a resposta seria SQL e a fase acabava hoje. O
problema são as **25 mudanças de linha** e as **3 mesclagens cruzadas** — e essas o
DAX consome sem citar coluna nenhuma, porque elas mudam o *tamanho* da tabela.

## As três opções

### A. Executar o M — um transform engine guiado pelas specs

Mesma forma do Measure Engine: os passos extraídos **são** a implementação. O scanner de
2b.6 já é o front-end (lê os 303 passos, classifica, erra alto no que não conhece); o
que falta é executá-los.

- **Custo:** 23 funções de tabela + 15 de valor. Menor que o avaliador de DAX (56).
- **A favor:** acompanha o PBIP sozinho. Resolve as 3 mesclagens cruzadas pelo mesmo
  caminho das outras 12. Cabe na regra 2 sem exceção nenhuma.
- **Contra:** move dado para dentro do processo — `protocolos-geral` são 33 mil linhas,
  `field-agenda` 1,4 milhão (achado 2). Precisa de streaming ou de limite de memória
  declarado.
- **Não resolve:** o fato 3. Ordem de linha continua indefinida; só que aí a indefinição
  é nossa e pode ser fixada por uma regra explícita e testada.

### B. Traduzir tudo para SQL

- **Custo:** 18 queries reescritas à mão, 226 passos a traduzir.
- **A favor:** o banco faz o trabalho; nada de 1,4 milhão de linhas no processo.
- **Contra, e é fatal:** as 3 mesclagens cruzadas **não têm tradução**. E o SQL escrito à
  mão não tem onde morar (fato 2): ou vive num arquivo gerado, contra a regra 2, ou vive
  fora e diverge em silêncio quando alguém mexer no relatório.
- **Veredito:** não fecha. Mesmo aceitando o custo, sobram 3 junções sem SQL possível.

### C. Híbrido — SQL onde dá, transform engine para o resto

Empurra para o SQL os passos de fonte única (renome, tipo, filtro, as 12 mesclagens de
mesma fonte) e mantém o engine para as 3 cruzadas.

- **A favor:** o melhor desempenho possível.
- **Contra:** exige **as duas** implementações, e um tradutor M→SQL que decida
  passo a passo o que desce e o que não desce. Mais superfície de erro que A e B somadas,
  e cada decisão dessas é um lugar onde o número pode mudar sem ninguém ver.
- **Quando faz sentido:** depois de A, se a medição mostrar que precisa. Não antes.

## Recomendação: A, com três condições

**Executar o M, guiado pelas specs.** O argumento não é preferência: é que B não fecha
(3 junções sem SQL) e C precisa de A pronto para valer a pena. A é também o único que
respeita a regra 2 sem abrir exceção — e é o mesmo argumento que já foi aceito para o
DAX na fase 2b.

Três condições, e a primeira é sua:

1. **A ordem do `Table.Distinct` precisa de medição contra dado real**, não de leitura.
   Proposta: materializar `PROTOCOLOS GERAL` com um critério de desempate explícito,
   comparar linha a linha com a tabela do Power BI numa amostra de protocolos com
   supervisor duplicado, e registrar o critério que reproduz. Se nenhum reproduzir de
   forma estável, isso vira **divergência deliberada** documentada — como a do `CALENDAR`
   na 2b.7 — e não um número silencioso.
2. ~~`PROTOCOLOS PRODUTIVIDADE` fica bloqueada até existir o connector de Google
   Sheets.~~ **Superado em 05/08/2026.** `QUADRO FUNCIONAL` não vai ler de Google Sheets
   na plataforma nova — vai ler do **Data Hub interno da Sebratel**
   (`data-hub.sebratel.net.br`, dataset `clientes-ativos-na-base`, que apesar do nome é
   dado de colaborador — confirmado com o Erick). É **divergência deliberada de fonte**
   em relação ao Power BI de hoje, a registrar em ACHADOS.md quando o connector existir:
   mesmo conteúdo (colaborador, gestor, CPF...), origem diferente.

   **Isso não fecha sozinho** — falta verificar com token real se o shape da resposta
   bate com o que a spec espera, e se o filtro por gestor
   (`GESTOR = "Luis Aranda"/"Pablo Borges"/"Stefany Souza"`) já vem aplicado ou precisa
   ser replicado. Ver `.env.example` para os detalhes e o que falta medir.

   As outras duas planilhas (`#APURAÇÃO PREMIAÇÃO`, 1 medida, e `CAPACIDADE EQUIPE`,
   nenhuma) continuam precisando do connector de Google Sheets do anexo abaixo — mas
   nenhuma das duas bloqueia `PROTOCOLOS PRODUTIVIDADE`, então a urgência caiu.
3. **`clima-tempo` continua fora.** Define função M com `let` aninhado, o scanner recusa
   por desenho, e a fonte é `web` (Open-Meteo) — sem connector. São duas pendências na
   mesma query, e nenhuma bloqueia o resto.

O que **não** recomendo: começar pelas 11 colunas. Elas são a parte fácil (9 renomes) e
fazê-las primeiro daria a sensação de progresso enquanto as 25 mudanças de linha — que
são o que realmente muda número — continuariam de fora.

---

## Anexo A: `QUADRO FUNCIONAL` vem do Data Hub, não do Google Sheets — decisão de 05/08/2026

**Isto muda o plano de conector para a tabela mais importante das 3 planilhas**, e por
isso vem antes do anexo de Google Sheets. `QUADRO FUNCIONAL` (dado de colaborador —
`NOME`, `GESTOR`, `CPF`, `ADMISSÃO`, `DEMISSÃO`...) é mesclada dentro de
`PROTOCOLOS PRODUTIVIDADE`, que **9 medidas** leem. No Power BI de hoje ela vem de uma
planilha Google Sheets. Na plataforma nova, o Erick decidiu ler a mesma informação do
**Data Hub interno da Sebratel** em vez disso:

```
https://data-hub.sebratel.net.br/api/public/v1/datasets/clientes-ativos-na-base/rows?token=<DATAHUB_TOKEN>
```

O nome do dataset — "clientes ativos na base" — sugere dado de **cliente**, não de
**colaborador**. Perguntei antes de assumir, e a resposta foi que é dado de colaborador
mesmo; o nome no Data Hub só não reflete o conteúdo. Fica registrado aqui porque é
exatamente o tipo de discrepância que este documento existe para não deixar passar batido.

**É divergência deliberada de fonte** em relação ao Power BI atual, e vai para
`ACHADOS.md` quando o connector estiver implementado — a regra do projeto
("replicar fielmente") pede decisão explícita registrada, não decisão silenciosa. O que
precisa continuar igual é o **conteúdo**: mesmo colaborador, mesmo gestor, mesmo CPF.

### Verificação feita em 05/08/2026 — e o resultado bloqueia a substituição

O token chegou e a API foi sondada de verdade (`npm run probe:datahub`,
`tools/probe/src/datahub.ts`). O endpoint correto **não** é o do formato
`/datasets/{slug}/rows` que veio na mensagem original: aquele devolve `403` para este
token. O que responde é

```
GET {DATAHUB_BASE_URL}/p/dash-instalacao        →  HTTP 200
```

e o próprio envelope confirma que é dado de colaborador, como você disse:

```
api: "dash-instalacao"   dataset: "db-senior-collaborators"
total: 2448   limit: 100   offset: 0   rows: [...]
```

Vale registrar um detalhe de diagnóstico que custou tempo: esta API responde **403
idêntico** para "token sem permissão" e para "slug inexistente", e não há endpoint de
catálogo (`/datasets`, `/me`, `/health` e a raiz todos dão `404 Rota não encontrada.`).
Ou seja, um `403` aqui não distingue *falta liberação* de *slug errado* — é sempre uma
pergunta para quem administra o Data Hub, nunca uma dedução.

#### A resposta às três perguntas

**3. Paginação e volume — resolvido.** `limit`/`offset` no envelope, default 100,
`total: 2448`. O servidor honra `limit` arbitrário (`limit=5000` devolveu as 2448 numa
chamada), mas o connector deve paginar por `offset` até bater o `total` de qualquer jeito:
depender de um limite sem teto é depender de um comportamento que muda sem aviso, e a
diferença apareceria como gente faltando numa medida, não como erro.

As 2448 linhas são **histórico de vínculo, não pessoas**: `record_type` é `terminated`
(1820) ou `admitted` (628), e as 628 sem `termination_date` batem exatamente com a soma dos
status ativos (`Trabalhando` 579 + `Férias` 14 + `Auxílio Doença` 14 + `Lic. s/
Remuneração` 7 + `Licença Maternidade` 6 + `Acidente Trabalho` 5 + `Atestado` 3 = 628).
Daí também vêm os **121 CPFs repetidos** em 2448 linhas — recontratação, a mesma pessoa com
mais de um vínculo. `id` é único; `cpf` não é. Casar por CPF sem filtrar vínculo ativo
multiplicaria linha na mesclagem.

**1. O shape — nada a ver com a spec.** A API é `snake_case` em inglês, **19 campos**; a
spec espera **37** em maiúsculas com acento. Batem por nome apenas 3 (`id`, `cpf`,
`status`). Os 19 campos: `id`, `name`, `registration`, `admission_date`, `status`,
`operational_base`, `team`, `position`, `email`, `supervisor_name`, `coordinator_name`,
`manager_name`, `cpf`, `company`, `cost_center`, `updated_at`, `termination_date`,
`record_type`, `unique_key`.

Isso por si só não é problema: renomear campo é trabalho mecânico, e a maioria das 37
colunas da planilha (`MINDSIGTH`, `ETAPA`, `RECRUTADOR`, `LINKS`...) é de recrutamento e
**ninguém consome**. O que importa é o que a mesclagem realmente usa — e é aqui que para.

**2. O filtro por gestor — a coluna não existe com dado.** `PROTOCOLOS PRODUTIVIDADE`
consome `QUADRO FUNCIONAL` em exatamente dois pontos:

```m
#"Consultas Mescladas3"     = Table.NestedJoin(…, {"TECNICO"}, #"QUADRO FUNCIONAL", {"upper_name"}, …, JoinKind.LeftOuter),
#"QUADRO FUNCIONAL Expandido" = Table.ExpandTableColumn(…, "QUADRO FUNCIONAL", {"GESTOR"}, {"GESTOR"}),
```

Ou seja: `NOME` serve de chave de junção (via `upper_name = Text.Upper([NOME])`) e
**`GESTOR` é a única coluna expandida**. A tabela inteira existe para trazer o gestor.

Na API, a chave existe (`name`). O gestor **não**:

| campo | preenchidos em 2448 linhas |
|---|---|
| `supervisor_name` | **0** |
| `coordinator_name` | **0** |
| `manager_name` | **0** |

Os três campos de hierarquia vêm `null` em **todas** as 2448 linhas. Não é "nome
diferente", é ausência de dado. Sem eles não há como aplicar o filtro dos 3 gestores
(`Luis Aranda`, `Pablo Borges`, `Stefany Souza`) nem entregar a coluna que a mesclagem
expande.

#### Impacto: dois slicers, não nove medidas

Verifiquei antes de dimensionar o estrago. `PROTOCOLOS PRODUTIVIDADE[GESTOR]` **não** é
lida por nenhuma medida DAX — as medidas de gestor usam outra tabela
(`GESTORES[GERENTE/SUPERVISOR]`, com nome completo: `"LUIS FELIPE NAZARIO ARANDA"`,
`"STEFANY RODRIGUES"`). `[GESTOR]` aparece como **campo de visual**, em 3 lugares de 2
dashboards: um **slicer** em `diario-instalacao`, um **slicer** e um campo de visual em
`premiacao-instalacao`. Coluna vazia ali = slicer sem opção nenhuma; o filtro por gestor
desses dois dashboards simplesmente deixa de existir.

Menos grave do que "9 medidas erradas", e mais insidioso: some silenciosamente, sem
número errado para ninguém desconfiar.

#### O que precisa acontecer — e é com quem publica o dataset

Três caminhos, em ordem de preferência. Nenhum é adivinhável daqui:

1. **A publicação `dash-instalacao` passar a preencher `manager_name`** (ou
   `supervisor_name`). Os campos já estão no contrato — vêm vazios. Se a origem Senior tem
   o dado e a publicação só não o traz, é o caminho mais curto e resolve de vez.
2. **Usar `team` como proxy** — 24 valores (`ADM`, `SVA`, `SCM`, `GERAL`, `EXTERNO`,
   `TEC-INST FTTX`...) com `cost_center` espelhando a mesma cardinalidade. Só serve se
   existir mapa time → gestor, e esse mapa seria **decisão de negócio nova**, não
   replicação: precisa vir de alguém, e vai para `PERGUNTAS-NEGOCIO.md`.
3. **`QUADRO FUNCIONAL` continuar no Google Sheets** e o Data Hub entrar depois, para o
   resto. Custo: volta a depender do connector de Google Sheets (Anexo B) — que é a decisão
   que esta troca de fonte tinha superado. Nada se perde: a credencial já existe, falta o
   passo 6 na planilha.

**Até uma das três, a divergência de fonte fica registrada mas não implementada.** Não vou
escrever um connector que casa `name` e devolve `GESTOR` vazio: passaria em qualquer teste
de shape, e o efeito só apareceria como slicer vazio em produção. É o mesmo motivo pelo qual
`CALENDAR` recusa BLANK em vez de gerar 1899 dias — ver "Divergências deliberadas" em
`ACHADOS.md`.

### Um achado de segurança já incorporado

A mensagem do 401 (`Token ausente (?token=… ou header X-Api-Token)`) revela que a API
aceita **duas** formas de autenticação. A sonda usa o **header**, e o connector também
deve. Token em query string vaza para log de acesso, histórico de proxy e telemetria de
erro — lugares que ninguém trata como cofre. O `?token=` da URL que originou esta decisão
serviu para descobrir o endpoint; não é o que vai para o código.

### O connector é o mesmo tipo de trabalho que o de Google Sheets

Uma classe nova implementando a porta `Connector` de
`packages/query-engine/src/connectors.ts`, chamando REST com o header `X-Api-Token` —
mais simples que o de Google Sheets porque não tem OAuth de service account, só token.
Token vai em `DATAHUB_TOKEN` no `.env` (ver `.env.example`), nunca na URL commitada e
nunca em query string.

---

## Anexo B: o "connector de Google Sheets" — as 2 planilhas que restam

Com `QUADRO FUNCIONAL` movida para o Data Hub (Anexo A), sobram **duas** planilhas de
baixíssima urgência: `#APURAÇÃO PREMIAÇÃO` (1 medida) e `CAPACIDADE EQUIPE` (nenhuma
medida as cita). Não é nada que se baixe ou compre. São duas coisas separadas, e só a
segunda depende de alguém de fora:

1. **Código nosso**, ~100 linhas: uma classe que implementa a porta `Connector` que já
   existe em `packages/query-engine/src/connectors.ts`, chamando a API REST do Google
   Sheets (`sheets.googleapis.com/v4/spreadsheets/{id}/values/{aba}`). Do mesmo jeito
   que `SqlConnector` recebe o driver injetado, o Engine não muda.
2. **Uma credencial**, que é o que precisa ser providenciado.

A forma da credencial já foi decidida na Fase 1 e está no `.env.example`:
`GOOGLE_APPLICATION_CREDENTIALS` — uma **service account** do Google Cloud. É a opção
certa para servidor: não depende de ninguém estar logado, e a permissão pode ser
somente leitura, o que casa com a regra 3 do projeto.

### Os passos, na ordem

| # | Onde | O que fazer |
|---|---|---|
| 1 | `console.cloud.google.com` | Criar um projeto (ou reusar um da Sebratel) |
| 2 | APIs e serviços → Biblioteca | Ativar a **Google Sheets API** |
| 3 | APIs e serviços → Credenciais | Criar credencial → **Conta de serviço** |
| 4 | Na conta de serviço → Chaves | Adicionar chave → **JSON**. Baixa um arquivo |
| 5 | Máquina local | Guardar o JSON **fora do repositório** e apontar `GOOGLE_APPLICATION_CREDENTIALS` para ele no `.env` |
| 6 | Cada uma das 2 planilhas | Compartilhar → colar o e-mail da conta de serviço (`algo@projeto.iam.gserviceaccount.com`) → **Leitor** |

Já foi feito uma vez nesta fase (a credencial existe, criada para a conta de serviço
`erick-project`); o que falta é só o passo 6 nas duas planilhas que restam.

### O atalho que existe

Planilha marcada como "qualquer pessoa com o link pode ver" é baixável como CSV sem
credencial nenhuma:

```
https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<GID>
```

Serve para desbloquear um teste em minutos, e para estas duas (nenhuma é dado de RH) é
uma opção razoável se o compartilhamento direto demorar.

### Isto bloqueia começar a 2b.8?

**Não.** Nenhuma das duas planilhas restantes bloqueia `PROTOCOLOS PRODUTIVIDADE` — essa
dependência agora é do connector do Data Hub (Anexo A). O plano continua o mesmo: o
engine de M ergue erro explícito nomeando o connector que falta, em vez de pular a
mesclagem em silêncio, e as tabelas que não dependem dele andam.

Prioridade entre as 2 planilhas que restam, medida pelo uso no DAX:

| Planilha | Quem lê | Urgência |
|---|---|---|
| `#APURAÇÃO PREMIAÇÃO` | **1** medida (`[Instalações Apuradas]`) | baixa |
| `CAPACIDADE EQUIPE` | **nenhuma** medida cita a tabela | nenhuma |
