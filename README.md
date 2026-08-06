# Analytics Platform Enterprise

Plataforma corporativa de Analytics que substitui o Power BI da Sebratel.
Orientada por **Engines** e **metadados** — dashboards são apenas uma das funcionalidades.

## Estado atual

| Fase | Escopo | Status |
|---|---|---|
| 0 | Fundação spec-driven + extrator PBIP | ✅ |
| 1 | Query Engine + Query Registry + cache | ✅ |
| — | Infra de conexão + `doctor` + guard read-only | ✅ |
| — | Validação contra dados reais — 18/18 queries capturadas | ✅ (⏳ `rowCount` a conferir com o Erick, em **6** tabelas) |
| 2a | Modelo semântico completo + verificação de referências | ✅ |
| 2b.1 | Parser de DAX → AST (134/134 expressões parseiam) | ✅ |
| 2b.2 | Avaliador: escalares e agregação | ✅ |
| 2b.3 | Contexto de filtro: `CALCULATE`, `FILTER`, `ALL`, `TREATAS` | ✅ |
| 2b.4 | Time intelligence, conjuntos, `RANKX` — **74 das 78 medidas executam** | ✅ |
| 2b.5 | Propagação de filtro por relacionamento — **22 medidas dependiam dela** | ✅ |
| 2b.6 | O que separa o avaliador do dado real: camada M + tabelas calculadas | ✅ |
| 2b.7 | Materializar as 7 tabelas calculadas (`CALENDAR`, `ADDCOLUMNS`) — **as 56 funções agora estão todas implementadas** | ✅ |
| 2b.8 | Camada M — **opção A confirmada** ([decisão](docs/DECISAO-CAMADA-M.md)). Parser + avaliador + orquestrador; **as 39 funções do escopo rodam** (37 na tabela de funções + as 2 de fonte, ligadas aos connectors). As 23 queries executam os 303 passos | ✅ |
| — | **19 das 23 queries rodam contra a fonte real** (`npm run run:mlayer`), incluindo `field-agenda` com 1.445.730 linhas. As 4 que faltam são as de planilha — 3 diretas e `PROTOCOLOS PRODUTIVIDADE`, que mescla com uma delas — todas barradas no mesmo 403 | 🚧 |
| — | A camada M **não streama**: 4 GB de heap não bastam, 8 GB bastam hoje ([ACHADOS](docs/ACHADOS.md) #20). Decide a arquitetura da Fase 3 | ⚠️ |
| — | Connector de Google Sheets pronto e testado; falta compartilhar as 3 planilhas com a conta de serviço ([Anexo B](docs/DECISAO-CAMADA-M.md)) | 🚧 |
| 2b.9 | Paridade medida a medida contra o relatório | 🚧 em curso |
| 3 | Widget/Dashboard Engine + Chart SDK | ⏳ |
| 4 | Realtime Engine (Debezium/Kafka/Redis) | ⏳ |
| 5 | Permission Engine, IA, Export | ⏳ |

**514 testes verdes.** Nenhum deles precisa de credencial.

### Extraído do Power BI

| Artefato | Qtd |
|---|---|
| Tabelas | 25 |
| Medidas (DAX) | 78 — 5 não são usadas por nada ([ACHADOS](docs/ACHADOS.md) #6 e #10) |
| Colunas calculadas (DAX) | 49 — 6 recuperadas em 04/08 ([ACHADOS](docs/ACHADOS.md) #8) |
| **Tabelas calculadas (DAX)** | **7** — recuperadas em 05/08 ([ACHADOS](docs/ACHADOS.md) #14). São tabelas cujas *linhas* vêm de DAX |
| Passos M (Power Query) | 303 nas 23 queries legíveis — criam 56 colunas e mexem em linha ([ACHADOS](docs/ACHADOS.md) #15) |
| Relacionamentos | 22 (+44 de hierarquia automática de datas, ignorados) |
| Queries (Query Registry) | 24 — 15 `dbVoalle`, 3 `dbMaria`, 3 `gsheets`, 1 `web`, 1 `inline`, 1 `computed` |
| Dashboards (páginas) | 14 |
| Visuais | 306 |

### Modelo semântico (Fase 2a)

`packages/semantic-model/` carrega o catálogo num modelo consultável — tabelas,
colunas (incluindo as calculadas), medidas e relacionamentos — resolvendo nomes
**sem distinguir caixa**, porque o modelo real escreve a mesma tabela como
`'FIELD AGENDA'` e `'Field Agenda'`.

`npm run validate:model` resolve toda referência `'Tabela'[Coluna]` e `[Medida]`
das 78 medidas, das 49 colunas calculadas e das 7 tabelas calculadas. Não precisa
de `.env` nem de banco.
Serve para responder *quais medidas referenciam coisas que existem* — a resposta
hoje é **75 de 78**, e as 3 que sobram são as medidas mortas do achado 6.

Não confundir com as **74** que o avaliador executa: a diferença é
`[Faixa 1 Premiação Total]`, cujas referências existem mas que usa `ISINSCOPE` —
pergunta que só o Widget Engine responde ([ACHADOS](docs/ACHADOS.md) #12). Os dois
números medem coisas diferentes: "aponta para o que existe" e "roda".

### Measure Engine (Fase 2b)

As 78 medidas **não** são 78 funções escritas à mão: o DAX da spec é a
implementação. `packages/measure-engine/` lê `measures/*.yaml` e avalia — assim
`npm run extract` não faz o código divergir em silêncio quando alguém mexe no
Power BI.

**Front-end (2b.1).** Tokenizer e parser → AST, com as **134 expressões da base
parseando** (78 medidas + 49 colunas calculadas + 7 tabelas calculadas). O AST é
deliberadamente burro: quem decide se `[Data]` é medida ou coluna é o avaliador,
que conhece o modelo.

Duas implementações independentes concordam sobre as referências de todas as 134
expressões (o scanner por caractere do `semantic-model` e o parser com gramática),
o que é evidência de que nenhuma das duas está lendo o DAX errado.

**Avaliador (2b.2 a 2b.7).** As **56 funções DAX que a base usa** estão **todas
implementadas** — há teste que falha e diz qual, se o PBIP passar a usar uma nova.
As duas últimas a entrar foram `CALENDAR` e `ADDCOLUMNS`, das tabelas calculadas.
Inclui contexto de filtro (`CALCULATE`, `FILTER`, `ALL`, `TREATAS`,
`LOOKUPVALUE`, `SELECTEDVALUE`), *time intelligence* (`DATESBETWEEN`, `DATESMTD`,
`ENDOFMONTH`, `STARTOFMONTH`), conjuntos (`INTERSECT`, `EXCEPT`, `UNION`,
`SELECTCOLUMNS`, `DISTINCT`), `RANKX`, `AVERAGEX`, colunas calculadas em contexto
de linha, `VAR` (inclusive guardando tabela), dependência entre medidas com
detecção de ciclo, a hierarquia automática de datas (`[Data].[Dia]`) e a
propagação de filtro pelos **21 relacionamentos ativos** do modelo.

Cinco níveis de cobertura, porque medem coisas diferentes:

| Nível | Hoje | O que prova |
|---|---|---|
| Parseia | 134/134 | o DAX é lido inteiro, sem construção estranha |
| Está no implementado | **134/134** | nenhuma função da base fica fora do avaliador |
| **Executa de ponta a ponta** | **123/127** das escalares — e **74 das 78 medidas**; + as **7 tabelas calculadas materializadas** | roda sobre dados e devolve valor |
| Roda contra dado real | ⏳ | faltam as **11 colunas que nascem em M** ([ACHADOS](docs/ACHADOS.md) #15) |
| Bate com o Power BI | ⏳ | **paridade — ainda não provada** |

As duas últimas linhas são as que importam para migrar, e nenhuma foi feita. Os
testes rodam sobre dados sintéticos, então provam que o avaliador *funciona*, não
que o número é o mesmo do relatório.

A fase 2b.6 tornou a penúltima linha concreta, e ela não era o que parecia: não
falta "conferir números", falta **código**. Eram duas lacunas, ambas invisíveis em
dado sintético porque o dataset de teste inventava linhas para toda tabela e valores
para toda coluna declarada:

- **7 tabelas calculadas** (`CALENDARIO INSTALADO`, `calendar`,
  `Status Protocolo Dia` e mais 4) cujas linhas vêm de DAX. Três delas são por onde
  o filtro propaga — contra dado real nasceriam vazias, e vazio do lado que filtra
  não dá erro: dá zero ([ACHADOS](docs/ACHADOS.md) #14). **Fechada em 2b.7.**
- **11 colunas que o DAX usa e o SQL não devolve** — nascem em passo M
  (`HORA CRIADO` é `DateTime.Time([DATA CRIADO])`; `DATA DA TROCA` vem de uma
  mesclagem). `validate:model` não pega porque confere modelo contra modelo
  ([ACHADOS](docs/ACHADOS.md) #15). É a fase 2b.8.

A fase 2b.5 deu uma medida de **o quanto dado sintético não prova**. Das 22 medidas
que dependem de propagação por relacionamento, o dataset sintético consegue mostrar
**uma** mudando de valor quando a propagação é desligada — porque quatro linhas por
tabela com valores uniformes fazem quase todo filtro aceitar tudo. As outras 21 só
aparecem com dado real. Há teste fixando os dois números justamente para que a
distância entre eles fique visível.

As 4 que não executam têm cada uma seu motivo, e há teste exigindo que continuem
falhando. Três são as medidas mortas do achado 6 — e isso é confirmação
independente: `validate:model` chegou nelas lendo referências, o avaliador chega
tentando calcular. A quarta usa `ISINSCOPE`, que pergunta *"o visual está agrupando
por esta coluna?"* — resposta que não existe sem o Widget Engine ([ACHADOS](docs/ACHADOS.md) #12).

**A regra do contexto de filtro que decide números.** Filtro de `CALCULATE`
**substitui** o filtro existente sobre a mesma coluna em vez de somar com ele, e
quem vence é o `CALCULATE` mais **interno**. Então
`CALCULATE([Total 2026], 'VENDAS'[Ano] = 2025)` devolve o total de **2026** — o
pedido de fora é descartado. Se os filtros se intersectassem, daria vazio, e vazio
num cartão parece "sem dados" em vez de erro. Está travado por teste em
`test/filter.test.ts`, junto com `ALL` (que é o mesmo mecanismo: substituir o
filtro por "aceita tudo") e a transição de contexto.

**Propagação por relacionamento (2b.5), e a maior fonte de erro silencioso que o
avaliador teve.** `Contagem Solicitacao 2026` é
`CALCULATE(COUNT('PROTOCOLOS GERAL'[SOLICITACAO]), 'CALENDARIO INSTALADO'[DATA INSTALADO] >= DATE(2026,1,1))`.
Até a fase 2b.4 ela **rodava** e devolvia a contagem de todos os anos: o filtro
pousava em `CALENDARIO INSTALADO` e nada atravessava para `PROTOCOLOS GERAL`. Sem
erro, sem aviso, com cara de total de 2026.

São **22 das 78 medidas** que citam mais de uma tabela sem usar `TREATAS` — todas
dependiam disso, e há teste travando o número. O filtro anda do lado *one* para o
lado *many*, nos dois sentidos com `cross_filter: bothDirections`, e é **recursivo**
porque nesta base ele anda dois saltos de verdade (`calendar` → `Status Protocolo
Dia` → `FIELD AGENDA`).

Três decisões que a implementação exigiu:

- **A coluna de junção pode ser calculada — e cinco são.** Entre elas
  `'PROTOCOLOS GERAL'[DATA INSTALAÇÃO]`, que é justamente a do caso acima e escolhe
  entre três colunas de data conforme o tipo do protocolo. Ler a linha crua devolve
  vazio e a junção não casa nada, calada. Por isso o contexto de filtro recebe do
  avaliador a função que resolve coluna.
- **Origem que não está restringida não restringe ninguém.** Sem essa regra
  propagar viraria `INNER JOIN` e sumiria com as linhas do lado *many* que não casam
  — que no Power BI continuam visíveis. É também o que mantém `ALL` funcionando.
- **Não voltar pelo mesmo relacionamento; caminho ambíguo é erro.** A primeira regra
  é do DAX e é o que impede `bothDirections` de virar laço. A segunda: se duas
  tabelas se ligam por dois caminhos distintos, o avaliador se recusa a escolher um
  — o Power BI recusa esse modelo, e inventar um número aqui seria pior.

Junção entre tipos diferentes (data de um lado, texto `DD/MM/YYYY` do outro) **erra
alto**, porque ela nunca casa e o resultado sairia zero com cara de filtro apertado.

**Princípio: falhar alto.** Função não suportada, construção não reconhecida,
referência que não resolve, texto onde se espera número → erro com linha e coluna,
nunca um palpite. Um avaliador que devolve número errado em silêncio é pior que um
que se recusa a rodar, porque o erro chega ao dashboard da operação com a mesma
cara de um número certo.

Três armadilhas do modelo real estão travadas por teste:

- `FORMAT(data,"dddd")` sai **em português** (`culture: pt-BR` no modelo). Em inglês
  o `SWITCH` do `PESO` não casaria nenhum `"domingo"`, e todo domingo passaria a
  valer um dia útil.
- Coluna de texto `DD/MM/YYYY` **não** é comparada com data. Ordenar isso direto
  ordena por dia — foi o erro que gerou o achado 1 falso.
- `DATEVALUE` **descarta a hora**, como o DAX. `'FIELD AGENDA'[Data]` é
  `DATEVALUE([Slot Agenda])` e `Slot Agenda` tem hora; o `RANKX` de
  `[RankDataProtocolo]` compara esse valor com uma lista feita de `TRUNC`, que não
  tem. Mantendo a hora, nada casaria e o rank sairia BLANK.

E uma escolha de resolução de nome que decide um caso real: contextos de linha são
percorridos **do mais interno para o mais externo**. Em
`RANKX(TabelaDatas, [Data], , ASC, DENSE)` existem dois candidatos para `[Data]` — a
coluna da tabela anônima do `SELECTCOLUMNS` e a coluna calculada
`'FIELD AGENDA'[Data]`, que também existe. O DAX escolhe a do iterador mais interno;
a ordem de inserção escolheria a outra e ranquearia errado em silêncio.

**O que separa o avaliador do dado real (2b.6).** Esta fase não escreveu avaliador
nenhum: ela foi medir o que falta, e o que achou foi que a spec estava incompleta em
dois lugares — nos dois casos sem dar erro, porque o dataset sintético dos testes
preenche exatamente o que faltava.

*Primeiro: sete tabelas não diziam de onde vinham as linhas.* No TMDL elas são
`partition = calculated` — a tabela **é** uma expressão DAX. O extrator lia só a
partition `= m`, então a spec gravava `query_ref: null` e mais nada. Três dessas
sete — `CALENDARIO INSTALADO`, `calendar` e `Status Protocolo Dia` — são por onde o
filtro propaga na 2b.5. Agora o campo `table_dax` carrega a expressão, o
`validate:model` confere as referências das 7 (passam limpas) e há um teste que trava
o invariante que pega a próxima perda: **nenhuma tabela sem origem** — 18 vêm de
query, 7 vêm de DAX, e a soma tem de ser 25.

*Segundo: existe uma camada M entre o SQL e a tabela.* São **303 passos** de Power
Query depois do `Odbc.Query`, e eles não são cosméticos:

| | |
|---|---|
| **56 colunas** do modelo nascem em passo M, não no SELECT | e **11 delas são citadas pelo DAX** — `HORA CRIADO` é `DateTime.Time([DATA CRIADO])`, `DATA DA TROCA` vem de uma mesclagem, `TÉCNICO INSTALAÇÃO` é renomeação de coluna expandida |
| **11 das 17** tabelas têm `rowCount` que **não** é comparável com o Power BI | o golden conta o SQL; o M ainda filtra, deduplica e expande depois. Em `PROTOCOLOS GERAL` são seis passos, incluindo `[STATUS] <> "Cancelado"` e `Table.Distinct` por `SOLICITACAO` |

`npm run validate:tables` é o quarto nível de verificação e existe por causa da
diferença com o segundo: `validate:model` confere **modelo contra modelo**, então
`'PROTOCOLOS GERAL'[HORA CRIADO]` passa — está declarada na spec da tabela. O que
não existe é a coluna no resultado do SELECT. Contra dado real ela chegaria vazia, e
vazio não dá erro: dá zero, BLANK, ou junção que não casa nada.

O scanner de M (`tools/validate/src/mlayer.ts`) é para a camada M o que o
`extractRefs` é para o DAX: **não é um avaliador**, não executa nada, e responde
duas perguntas estáticas — que nome de coluna este passo produz, e ele pode mudar a
contagem de linhas. Segue o mesmo princípio do avaliador: passo `Table.*` cuja
função não está na tabela de efeitos vira **erro com o nome do passo**. Foi essa
regra que expôs a `clima-tempo`, que define uma função M com `let` aninhado — em vez
de achatar os passos internos na tabela de fora (o que atribuiria colunas à tabela
errada, em silêncio), o scanner recusa a query e o relatório a lista à parte.

**Materializar as 7 tabelas calculadas (2b.7).** O dataset dos testes agora carrega
**só as 18 tabelas que vêm de query**; as 7 calculadas são produzidas avaliando o DAX
delas, na mesma ordem que o Power BI segue no refresh. É a mudança que dá sentido aos
números: sem materializar, **46 das 127 expressões param de executar** — e antes desta
fase esse número era zero, não porque estivesse resolvido, mas porque o dataset
inventava as linhas.

Três coisas foram necessárias, e as duas últimas não eram óbvias:

- **`CALENDAR` e `ADDCOLUMNS`.** `CALENDAR` é a única função do avaliador que
  **gera** linhas — todas as outras funções de data filtram valores que já existem
  numa coluna. Com um extremo BLANK ela **erra alto**, e é um desvio deliberado do
  Power BI: lá BLANK vale 0, que é 30/12/1899, e `CALENDARIO INSTALADO` sairia com uns
  46 mil dias sem reclamar de nada. Ninguém percebe isso numa tabela de datas, mas
  toda média que divide por dia útil muda.
- **Casar o nome da coluna, exigindo bijeção.** O DAX devolve uma coluna chamada
  `Date`; a tabela do modelo chama a mesma coluna de `DATA INSTALADO`. Quem faz a
  ponte é `sourceColumn`. Materializar com o nome do DAX não daria erro nenhum —
  daria um relacionamento que nunca casa. A exigência vale nas duas direções, e a
  segunda metade é a que pega o erro que já aconteceu: coluna que o DAX devolve e a
  spec não declara é coluna que o extrator perdeu.
- **Aplicar o tipo declarado da coluna.** `Status Protocolo Dia[Dia]` é
  `TRUNC('FIELD AGENDA'[Slot Agenda])`, e `TRUNC` em DAX devolve **número** — a série
  da data. Essa coluna se liga a `calendar[Data]`, que é `DATEVALUE(...)` e portanto
  data. Sem aplicar o `dateTime` que o TMDL declara, a junção compara número com data
  e o guarda de espécie erra alto — corretamente ([ACHADOS](docs/ACHADOS.md) #16).

Dois efeitos colaterais que valem registro. O primeiro: o palpite de tipo do dataset
de teste caiu de **10 colunas para 1**. Nove das dez eram colunas de tabela calculada,
e o tipo delas nunca faltou — vinha do DAX, que não era avaliado. A que sobra é o
achado 15, `PROTOCOLOS GERAL[EQUIPE_BASE]`. O segundo: `validate:tables` ganhou a
procedência `dax` para as **10 colunas** dessas tabelas, que antes caíam em
"sem golden para conferir" junto com as de gsheets e web — lia como *não se sabe*
onde se sabe, e há teste.

O grafo de dependência entre as 7 é **plano** nesta base (medido, não suposto): todas
dependem só de tabelas que vêm de query. A ordenação topológica existe pelo que ela
recusa — ciclo erra alto nomeando o caminho, em vez de deixar a última tabela do laço
nascer vazia.

**A camada M (2b.8): decisão pendente, levantamento pronto.** Sobra um bloqueio entre o
avaliador e dado real, e ele exige uma decisão de arquitetura: **executar o M ou traduzi-lo
para SQL?** O levantamento com números está em
[docs/DECISAO-CAMADA-M.md](docs/DECISAO-CAMADA-M.md); a recomendação é **executar**, por
dois motivos que fecham a questão antes do gosto pessoal:

- **3 das 15 mesclagens atravessam fonte de dados** — dbVoalle × dbMaria e
  dbVoalle × gsheets. Nenhum `SELECT` faz essas três, e duas delas são `PROTOCOLOS GERAL`
  e `PROTOCOLOS PRODUTIVIDADE`. A plataforma precisa de junção acima dos connectors de
  qualquer maneira.
- **SQL escrito à mão não tem onde morar.** As specs de query são sobrescritas por
  `npm run extract` (regra 2), então SQL humano ali diverge em silêncio no dia em que
  alguém mexer no Power Query — o mesmo argumento que impediu as 78 medidas de virarem 78
  funções TypeScript.

Tamanho da camada: **23 funções de tabela + 15 de valor**, contra as 56 do avaliador de
DAX. E as 11 colunas que o DAX usa e o SQL não devolve são a parte fácil — **9 são renome
puro**. O que muda número de verdade são as **25 mudanças de linha**.

Um ponto não é replicável só lendo o M, e está registrado como tal: em `PROTOCOLOS GERAL`
um `Table.Sort` (passo 47), uma mesclagem que multiplica linha (51) e um `Table.Distinct`
por `SOLICITACAO` (53) decidem **qual supervisor fica preso a cada protocolo** pela ordem
das linhas. `Table.Distinct` mantém a primeira ocorrência, e nada no M diz o que a
ordenação faz ao atravessar uma mesclagem. Isso exige medição contra dado real.

### Query Engine (Fase 1)

- **Query Registry** — carrega as specs geradas e aplica as políticas de cache
  humanas (`specs/_catalog/cache-policies.yaml`), com `validate()` de integridade.
- **Cache** — porta única com adapters `MemoryCache` e `RedisCache` (SCAN, não KEYS),
  validados pela mesma bateria de testes de contrato.
- **Single-flight** — 20 widgets pedindo a mesma query = 1 execução no banco.
- **Invalidação por tabela** — `invalidateByTable('contracts')` derruba só as queries
  dependentes. É o gancho que o Realtime Engine (Fase 4) vai chamar a cada evento CDC.
- **Connectors** — porta `Connector` com `SqlConnector` (driver injetável) e
  `FakeConnector` para testes; o Engine não conhece driver nenhum.

### Validação contra dados reais

`npm run validate:queries` executa as 18 queries SQL do registry nas fontes e
grava em `specs/golden/` a **forma e os agregados** de cada resultado — nunca as
linhas, porque esses arquivos são commitados e as queries devolvem dado pessoal
de cliente.

O `rowCount` gravado é a contagem da **query SQL**. Só em 6 das 17 tabelas ele é
comparável com a contagem no Power BI: nas outras 11 o Power Query mexe em linha
depois disso, e os dois números são diferentes por construção
([ACHADOS](docs/ACHADOS.md) #15). `npm run validate:tables` diz em qual grupo cada
tabela está.

Depois, `-- --check` reexecuta e separa mudança de **schema** (regressão: coluna
sumiu ou trocou de tipo, quebra medidas) de mudança de **dados** (esperado).
Ver [specs/golden/README.md](specs/golden/README.md).

## Comandos

```bash
npm test                              # suíte completa (514 testes, sem credencial)
npm run extract                       # regenera as specs a partir do PBIP
npm run validate:model                # o DAX referencia coisas que existem? (sem banco)
npm run validate:tables               # as colunas do modelo existem na fonte? (sem banco)
npm run doctor                        # valida configuração e conectividade
npm run validate:queries              # executa as queries reais e grava os goldens
npm run validate:queries -- --check    # falha se o schema de alguma query mudou
npm run probe:datahub                 # perfila a API do Data Hub (shape, nunca linha)
npm run probe:gsheets                 # a service account alcança as planilhas?
npm run run:mlayer -- --all --memoria=8192   # roda a camada M contra as fontes reais
```

Os oito respondem perguntas diferentes, e só os três primeiros dispensam `.env`:

| Comando | Pergunta | Precisa de `.env`? |
|---|---|---|
| `npm test` | o código respeita as specs? | não |
| `validate:model` | o DAX aponta para tabelas/colunas que existem **no modelo**? | não |
| `validate:tables` | essas colunas existem no que a **fonte** devolve? | não |
| `doctor` | as fontes estão alcançáveis e a sessão é read-only? | sim |
| `validate:queries` | as queries rodam e devolvem o quê? | sim |
| `probe:datahub` | a API do Data Hub tem os campos que a mesclagem precisa? | sim |
| `probe:gsheets` | a service account lê as planilhas, e o cabeçalho bate com a spec? | sim |
| `run:mlayer` | os passos de Power Query rodam contra o dado real, e a contagem fecha? | sim |

A diferença entre o segundo e o terceiro é a razão de o terceiro existir:
`validate:model` confere modelo contra modelo e aprova
`'PROTOCOLOS GERAL'[HORA CRIADO]`, que está declarada na spec da tabela e **não sai
do SELECT** — nasce num passo do Power Query.

Node 24 roda TypeScript nativamente — não há build step.

## Estrutura

```
docs/
  ARCHITECTURE.md      # Engines, stack e arquitetura de real-time (Debezium/Kafka/Redis)
  SPEC-DRIVEN.md       # como as specs governam a implementação
specs/
  _catalog/
    cache-policies.yaml  # HUMANO — TTL e realtime por query (não é sobrescrito)
    datasources.yaml     # GERADO
    relationships.yaml   # GERADO — 22 relacionamentos entre tabelas
    queries/             # GERADO — SQL + source_tables (alimenta o invalidador)
    tables/              # GERADO — colunas (com o DAX das calculadas) + table_dax das 7 calculadas
    measures/            # GERADO — as 78 medidas DAX
  dashboards/            # GERADO — as 14 páginas com seus visuais
  golden/                # GERADO por validate:queries — linha de base real
  EXTRACTION-REPORT.md
tools/extractor/          # extrator PBIP -> specs (sem dependências externas)
tools/doctor/             # valida configuração e conectividade
tools/validate/           # queries contra o ERP, verificação do modelo e scanner da camada M
packages/query-engine/    # Query Registry, Cache, Connectors, Engine
packages/semantic-model/  # tabelas, colunas, medidas, relacionamentos + refs do DAX
packages/measure-engine/  # DAX: tokenizer, parser, AST, avaliador e contexto de filtro
```

> Arquivos marcados **GERADO** são reescritos por `npm run extract` — nenhuma
> decisão humana pode viver dentro deles. Por isso as políticas de cache ficam
> em `cache-policies.yaml`, separado.

## Base de referência (read-only)

O projeto Power BI `INST - Relatório Instalação Gerencial` (pasta pai) é a fonte da
verdade do comportamento atual. **Não é modificado** — apenas lido pelo extrator.

Ver [docs/SPEC-DRIVEN.md](docs/SPEC-DRIVEN.md) e [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
