# Decisão: implementar a camada M ou substituí-la por SQL?

> **DECIDIDO em 05/08/2026: opção A** — executar o M com um transform engine guiado
> pelas specs. O Erick também definiu a ordem: seguir sem o Google Sheets e deixar
> `PROTOCOLOS PRODUTIVIDADE` (a única tabela que depende de planilha) para a última
> etapa. Estado da implementação no README; o que segue é o levantamento que embasou a
> decisão, mantido como está para o raciocínio ficar auditável.

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
2. **`PROTOCOLOS PRODUTIVIDADE` ficou bloqueada até existir o connector de Google
   Sheets** — condição que sobreviveu a uma tentativa de contorná-la e foi
   **resolvida em 06/08/2026** (as 3 planilhas abrem; ver o Anexo B). O histórico
   abaixo fica porque a ida e volta é a informação, não o desfecho.

   O histórico, porque a ida e volta em si é informação: em 05/08/2026 decidiu-se ler
   `QUADRO FUNCIONAL` do Data Hub interno em vez da planilha, o que teria dispensado o
   connector. A API foi sondada em vez de suposta, e os três campos de hierarquia
   (`manager_name`, `supervisor_name`, `coordinator_name`) vêm `null` em 100% das 2448
   linhas — sendo `GESTOR` a única coluna que a mesclagem expande. No mesmo dia a decisão
   voltou para o Google Sheets. Detalhes no **Anexo A**; o achado em `ACHADOS.md` #17.

   Então: `QUADRO FUNCIONAL` continua na fonte de hoje, **sem divergência de fonte a
   registrar**, e o connector de Google Sheets é caminho crítico — não mais "baixíssima
   urgência". Das três planilhas, esta é a que 9 medidas alcançam.

   **O que já existia** (05/08/2026): a autenticação de service account escrita e
   testada (`packages/query-engine/src/google-auth.ts`, 11 testes, sem rede), a Sheets API
   ativada no projeto e o JWT aceito pelo Google. **O que faltava** era um passo que não
   é código: compartilhar as 3 planilhas com o e-mail da conta de serviço como
   **Leitor** — e as três devolviam `PERMISSION_DENIED`.

   **Feito em 06/08/2026**, com uma conta de serviço nova (de outro projeto GCP). As 3
   abrem, o connector existe e as 3 queries de planilha rodam. `npm run probe:gsheets`
   mostra o estado, e ele imprime **qual identidade** está em uso — que é o que faltava
   para não confundir "não compartilharam" com "compartilharam com a outra conta".
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

#### Desfecho, no mesmo dia: escolhida a opção 3

O Erick escolheu manter `QUADRO FUNCIONAL` no Google Sheets. Consequências, todas boas:

- **A divergência deliberada de fonte deixa de existir.** `QUADRO FUNCIONAL` continua vindo
  de onde o Power BI a lê hoje, o que é o padrão do projeto ("replicar fielmente") e não
  precisa de registro em `ACHADOS.md` como divergência. O achado #17 permanece pelo motivo
  oposto: documenta por que a troca **não** foi feita.
- **O Data Hub não é descartado, fica adiado.** A sonda, a autenticação por header e o
  mapeamento de campos ficam no repo (`npm run probe:datahub`). No dia em que
  `manager_name` vier preenchido, o caminho está medido.
- **O connector de Google Sheets voltou a ser caminho crítico** — e com ele a condição 2 da
  recomendação, que havia sido marcada como superada em 05/08/2026. Ver Anexo B: a
  autenticação já está escrita e testada, e o compartilhamento — o que faltava quando esta
  linha foi escrita — saiu em 06/08/2026 (`3d059d1`, `13ffd12`), com uma conta de serviço
  NOVA. As 3 queries de planilha rodam ponta a ponta desde então.

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

## Anexo B: o "connector de Google Sheets" — RESOLVIDO em 06/08/2026

> **Estado final:** as 3 planilhas abrem e as 3 queries rodam ponta a ponta. O que
> bloqueava era o passo 6 (compartilhar com a conta de serviço), resolvido com uma conta
> nova — ver "Como o passo 6 foi resolvido" mais abaixo. O histórico fica porque a
> sequência de tentativas é o que ensina, não o resultado.

São **três** planilhas, e a ordem de importância é bem desigual: `QUADRO FUNCIONAL`
(alcançada por 9 medidas via `PROTOCOLOS PRODUTIVIDADE` — voltou para cá, ver Anexo A),
`#APURAÇÃO PREMIAÇÃO` (1 medida) e `CAPACIDADE EQUIPE` (nenhuma medida a cita).

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
| 6 | Cada uma das 2 planilhas | Compartilhar → colar o e-mail da conta de serviço (`algo@projeto.iam.gserviceaccount.com`) → **Leitor** |

**Estado em 05/08/2026: passos 1 a 5 feitos, e o 1 do código também.** Verificado com
`npm run probe:gsheets`:

| # | Estado |
|---|---|
| 1 projeto | ✅ `erick-project-501315` |
| 2 Sheets API ativada | ✅ — se não estivesse, o erro seria `SERVICE_DISABLED`, e não é |
| 3–4 conta de serviço + chave JSON | ✅ `shets-consult-api@erick-project-501315.iam.gserviceaccount.com` — **conta ANTIGA**, abandonada em 06/08/2026; ver o fim deste anexo |
| 5 chave fora do repositório | ✅ `C:/Users/erick.azambuja/.secrets/`, e o `Desktop` é um repo git com remote real — nunca deixar chave lá |
| **6 compartilhar cada planilha** | ✅ **resolvido em 06/08/2026** — mas com **outra** conta de serviço; ver o fim deste anexo |
| código: autenticação | ✅ `google-auth.ts`, fluxo JWT bearer com `node:crypto`, 11 testes sem rede |
| código: connector | ✅ `connectors-gsheets.ts`; as 3 queries rodam ponta a ponta |

O passo 6 é o único que não é código, e **era** o que faltava em 05/08/2026 — **e não era o
Erick que conseguia fazê-lo.** (Resolvido em 06/08/2026, por outro caminho: ver "Como o
passo 6 foi resolvido". O relato abaixo fica porque é a sequência de tentativas que ensina.)
Descoberto em 05/08/2026, ao tentar: no diálogo de Compartilhar aparece
"Pedir ao proprietário para compartilhar" e "Seu papel é de leitor, por isso não é
possível gerenciar o acesso". O Erick é Leitor nessas planilhas; quem concede é a
proprietária (**Julya De Souza Rocha**, ao menos na que abriu, cujo arquivo se chama
"STAGING"). Então o passo 6 é um pedido a terceiro, não uma tarefa nossa — o que muda a
estimativa da fase: não depende de trabalho, depende de resposta.

Registrado também porque é o tipo de coisa que se esquece: **o pedido tem que ser de
Leitor**, não de Editor. O diálogo de solicitação vem com "Editor" pré-selecionado, e
pedir escrita numa planilha de RH é mais fácil de ser negado — além de contrariar a
regra 3 do projeto e o escopo `spreadsheets.readonly` que o código pede. Vale insistir num ponto que confunde:
**ter acesso à planilha com a sua conta Google não dá acesso à conta de serviço.** São dois
principais distintos; o Google responde `PERMISSION_DENIED` para o segundo mesmo com o
primeiro dentro da planilha. Em cada uma das 3 planilhas:

> Compartilhar → colar `leitura-sheets-instalacao@n8n-workflow-staging.iam.gserviceaccount.com`
> → papel **Leitor** → enviar (pode desmarcar "notificar", é uma conta de robô)

**Esta é a conta que autentica hoje**, conferida em 17/09/2026 no `client_email` da chave
apontada por `GOOGLE_APPLICATION_CREDENTIALS` no `.env` (projeto `n8n-workflow-staging`).

> ⚠️ **NÃO compartilhe com `shets-consult-api@erick-project-501315…`.** Era esse o e-mail
> escrito aqui até 17/09/2026, e é a conta **antiga** — trocada em 06/08/2026 (`3d059d1`,
> `13ffd12`) e sem chave em uso desde então. Compartilhar com ela entrega planilha de RH
> (`QUADRO FUNCIONAL` tem CPF e RG) a uma identidade que o código nem usa, **e o
> `PERMISSION_DENIED` continua igual** — então quem seguir a instrução velha vaza dado
> pessoal e tenta de novo. Foi exatamente essa troca de identidade que "fez a confusão
> durar três tentativas" (ver o fim deste anexo). Na dúvida, `npm run probe:gsheets`
> imprime qual identidade está em uso antes de qualquer leitura.

Leitor, não Editor: a regra 3 do projeto é read-only, e o escopo OAuth pedido no código já é
`spreadsheets.readonly` — Editor daria permissão que o código nem sabe usar.

Depois de compartilhar, `npm run probe:gsheets` mostra as abas, compara as 37 colunas da
spec com o cabeçalho real, conta quantas linhas sobram após o filtro dos 3 gestores e
verifica se `upper_name` é chave única (se não for, a mesclagem multiplica linha — é o tipo
de coisa que sobe medida sem erro).

**Essa última verificação pegou algo, na primeira vez que pôde rodar:** `upper_name` **não
é única** — 535 linhas, 533 distintas. São 2 recontratações, e a mesclagem duplica os
protocolos desses 2 técnicos. Foi exatamente o cenário que motivou a checagem existir.
Ver ACHADOS #25 e PERGUNTAS-NEGOCIO #5.

#### Como saber se o compartilhamento chegou, sem depender de olhar tela

`PERMISSION_DENIED` não distingue "não compartilharam" de "compartilharam o documento
errado" — e a segunda hipótese é real, porque planilha homônima e cópia existem. Quando
alguma planilha falha, o probe pergunta ao **Drive** quais arquivos a conta de serviço
alcança (escopo `drive.metadata.readonly`, só metadado). A lista inclui o que foi
compartilhado com ela, então **lista vazia é prova de que nenhum compartilhamento chegou
nesta identidade**; lista com itens e sem os nossos ids é prova de documento errado.

Isso exige a **Google Drive API** ativada no projeto — a Sheets API não basta, e o erro do
Google traz o link de ativação. Ativada em 06/08/2026.

Medido em 06/08/2026, depois de um "acho que dei permissão": **0 arquivos**. Ou seja, a
permissão não existia — nem em documento errado. Registrado porque a lição vale para a
próxima vez: quando a resposta for "já compartilhei", medir antes de investigar id, cópia
ou propagação (permissão do Google vale na hora, não há fila a esperar).

#### Como o passo 6 foi resolvido, em 06/08/2026

Não foi a conta de serviço deste anexo. Foi criada **outra**, num projeto GCP diferente
(`leitura-sheets-instalacao@n8n-workflow-staging…`), e é ela que recebeu **Leitor** nas 3
planilhas. O `.env` aponta `GOOGLE_APPLICATION_CREDENTIALS` para a chave dela, em
`C:/Users/erick.azambuja/.secrets/`.

Duas coisas ficam desta troca, porque as duas custaram tempo:

- **O e-mail da conta de serviço não serve de credencial.** Ele identifica quem
  compartilhar *com*; quem autentica é a **chave privada** do JSON, que vive no projeto
  onde a conta foi criada. Receber só o e-mail não desbloqueia nada.
- **Trocar de conta de serviço troca a identidade inteira.** O que foi compartilhado com
  a antiga (`shets-consult-api@erick-project-501315…`) não vale para a nova. É por isso
  que `probe:gsheets` imprime **qual identidade** está em uso antes de qualquer leitura:
  ler o `403` sem saber quem falhou é o que fez a confusão durar três tentativas.

Medido depois de compartilhar: as 3 planilhas abrem, `quadro-funcional` casa **37/37**
colunas com a spec e as 3 queries rodam inteiras (ACHADOS #22). O caminho de OAuth, que
tinha sido implementado como alternativa, **nunca precisou ser usado** — e isso é o
melhor resultado, porque service account é o que serve para produção (ACHADOS #23).

### O atalho que existe

Planilha marcada como "qualquer pessoa com o link pode ver" é baixável como CSV sem
credencial nenhuma:

```
https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<GID>
```

**Não se aplica a estas 3, e isso foi medido:** a chave de API devolveu `403` (e não
`404`) nas três, o que prova que existem e que **nenhuma é pública por link**. Bom que
não seja — `QUADRO FUNCIONAL` tem CPF e RG, e uma versão anterior deste anexo dizia
"nenhuma é dado de RH", o que era verdade quando eram só duas planilhas e deixou de ser
quando `QUADRO FUNCIONAL` voltou (Anexo A). Fica registrado como armadilha: o atalho é
tentador justamente quando a planilha é a mais sensível.

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
