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
2. **`PROTOCOLOS PRODUTIVIDADE` fica bloqueada até existir o connector de Google
   Sheets.** Não é limitação do engine de M: a mesclagem com `quadro-funcional` é
   cross-source e um dos lados não tem como ser lido hoje. Vale decidir se o connector
   entra antes da 2b.8 ou se essa tabela fica declaradamente pendente.
3. **`clima-tempo` continua fora.** Define função M com `let` aninhado, o scanner recusa
   por desenho, e a fonte é `web` (Open-Meteo) — sem connector. São duas pendências na
   mesma query, e nenhuma bloqueia o resto.

O que **não** recomendo: começar pelas 11 colunas. Elas são a parte fácil (9 renomes) e
fazê-las primeiro daria a sensação de progresso enquanto as 25 mudanças de linha — que
são o que realmente muda número — continuariam de fora.

---

## Anexo: o "connector de Google Sheets" — o que é e como se consegue

Não é nada que se baixe ou compre. São duas coisas separadas, e só a segunda depende de
alguém de fora:

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
| 6 | Cada uma das 3 planilhas | Compartilhar → colar o e-mail da conta de serviço (`algo@projeto.iam.gserviceaccount.com`) → **Leitor** |

O passo 6 é o que costuma travar, e não por técnica: o e-mail da service account parece
estranho, e `QUADRO FUNCIONAL` é planilha de **RH** — quem autoriza compartilhar
provavelmente não é quem desenvolve. Vale começar por descobrir quem é o dono dela.

O passo 1 também pode travar: muitos Google Workspace corporativos bloqueiam criação de
projeto no Cloud por usuário comum. Se for o caso, é pedido para quem administra o
Workspace da Sebratel.

### O atalho que existe, e por que não serve para as três

Planilha marcada como "qualquer pessoa com o link pode ver" é baixável como CSV sem
credencial nenhuma:

```
https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<GID>
```

Serve para desbloquear um teste em minutos. **Não serve para `QUADRO FUNCIONAL`**: tornar
uma planilha de quadro de pessoal legível por qualquer um com o link é exposição de dado
de RH, e não é uma troca que valha para economizar meia hora de configuração.

### Isto bloqueia começar a 2b.8?

**Não.** Bloqueia **uma** tabela. O plano é o engine de M erguer erro explícito
("falta connector gsheets para a mesclagem com `quadro-funcional`") em vez de pular a
mesclagem em silêncio — assim `PROTOCOLOS PRODUTIVIDADE` fica declaradamente pendente e
as outras 17 tabelas andam.

Prioridade entre as 3 planilhas, medida pelo uso no DAX:

| Planilha | Quem lê | Urgência |
|---|---|---|
| `QUADRO FUNCIONAL` | mesclada em `PROTOCOLOS PRODUTIVIDADE`, que **9 medidas** leem | é a que importa |
| `#APURAÇÃO PREMIAÇÃO` | **1** medida (`[Instalações Apuradas]`) | baixa |
| `CAPACIDADE EQUIPE` | **nenhuma** medida cita a tabela | nenhuma |
