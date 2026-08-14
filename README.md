# Analytics Platform Enterprise

Plataforma corporativa de Analytics que substitui o Power BI da Sebratel.
Orientada por **Engines** e **metadados** — dashboards são apenas uma das funcionalidades.

> **Assumindo o projeto?** Comece por [docs/CONTINUACAO.md](docs/CONTINUACAO.md): como rodar, o estado exato, o que está bloqueado e o que fazer a seguir.

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
| 2b.8 | Camada M — **opção A confirmada** ([decisão](docs/DECISAO-CAMADA-M.md)). Parser + avaliador + orquestrador; **as 39 funções do escopo rodam** (37 na tabela de funções + as 2 de fonte, ligadas aos connectors). As 23 queries executam os 303 passos<br>*(hoje são **49 funções, 47 na tabela**, e as **24** queries com **327** passos: `clima-tempo` entrou no escopo no [ACHADOS](docs/ACHADOS.md) #42)* | ✅ |
| — | **23 das 23 queries rodam contra a fonte real** (`npm run run:mlayer -- --all --memoria=8192`), incluindo `field-agenda` com 1.449.281 linhas e `protocolos-produtividade` com 60 passos. As 4 que faltavam eram as de planilha, desbloqueadas em 06/08/2026 | ✅ |
| — | A camada M **não streama**: 4 GB de heap não bastam, 8 GB bastam hoje ([ACHADOS](docs/ACHADOS.md) #20). Decide a arquitetura da Fase 3 | ⚠️ |
| — | Connector de Google Sheets pronto, testado e **em uso**: as 3 planilhas foram compartilhadas com a conta de serviço em 06/08/2026 ([Anexo B](docs/DECISAO-CAMADA-M.md)) | ✅ |
| — | Goldens regravados contra o dbVoalle: `categoria32` e `CIDADE2` passaram a existir, e o corpus subiu para **23 de 23** queries executando inteiras ([ACHADOS](docs/ACHADOS.md) #19) | ✅ |
| 2b.9 | Paridade medida a medida contra o relatório — **depende de alguém abrir o Power BI e ditar os totais**; do lado do código, `--passos` já localiza a divergência passo a passo | 🚧 em curso |
| 3 | Widget/Dashboard Engine + Chart SDK | 🚧 **em curso** |
| — | Filtros de página e visual passaram a ser extraídos: **102 de visual + 6 de página** restringem de fato, 176 são cartão sem seleção, **0 sem tradução** ([ACHADOS](docs/ACHADOS.md) #27). Sem isso um card seria computado sem o filtro dele, em silêncio | ✅ |
| — | Campos de visual passaram a dizer **como** agregam: 84 `Aggregation` com a função, 69 `HierarchyLevel` com coluna e nível (antes nulos), 2 `Arithmetic` descritos, **0 sem tradução** ([ACHADOS](docs/ACHADOS.md) #28) | ✅ |
| — | Data relativa: a âncora de `DateSpan` passou a ser **lida** em vez de presumida `Now()`. Duas páginas inteiras eram filtradas a partir de *hoje* onde o filtro diz data fixa; `TimeUnit` ganhou nome apurado do próprio relatório (`day` 20, `month` 14, `second` 2, `year` 1) ([ACHADOS](docs/ACHADOS.md) #29) | ✅ |
| — | **Card: os 64 do relatório calculam de ponta a ponta.** `packages/widget-engine/` traduz filtro de spec para `TableFilter`, resolve data relativa na hora do cálculo e monta a agregação como nó de AST. Página e visual entram num `with()` **único** — em dois encadeados o de visual apagaria o de página e o número sairia maior, calado | ✅ |
| — | 10 filtros são `COUNT(coluna) > 0` — um **HAVING** sobre os grupos do visual, não um predicado de linha. Aplicados ao valor cru viravam outro filtro, que num campo numérico aceita quase tudo. Recusados pelo nome até o agrupamento existir; nenhum está em card ([ACHADOS](docs/ACHADOS.md) #30) | ✅ |
| — | Medido e preso em teste: **36 cards têm filtro e só 5 mudam de valor** sobre dado sintético. O caminho de filtro *executa* em 36 e está *exercitado* em 5 — mesma lição da 2b.5. **Nada disto é paridade** | ⚠️ |
| — | **Agrupamento + tabela: os 29 `tableEx` calculam.** Uma tabela do Power BI mostra as *combinações distintas* das colunas que não agregam, não uma linha por registro. O teste de cobertura passou a exigir mapa de recusas **vazio** | ✅ |
| — | **O filtro sobre agregado virou o HAVING que sempre foi** e o [ACHADOS](docs/ACHADOS.md) #30 fechou: filtro de linha vale *antes* de agrupar, filtro de grupo *depois*, e trocar a ordem não dá erro — dá outro número. Foi de 5 recusas a zero, e levou 4 tabelas junto | ✅ |
| — | **A 75ª medida chegou.** `[Faixa 1 Premiação Total]` não precisava de mais DAX: precisava de alguém que respondesse `ISINSCOPE`, que é propriedade do visual ([ACHADOS](docs/ACHADOS.md) #12). Calcula no total e fica em branco quando o visual agrupa — o que o comentário do autor pede | ✅ |
| — | `'PROTOCOLOS GERAL'[CONTAGEM]` é o texto `"1"` declarado `int64`. **Resolvido**: o tipo declarado da coluna vale ao materializar, como no Power BI — não é `SUM` que converte. Só literal sem ambiguidade; `"1.234,56"` erra alto. Raio de alcance medido: **1 coluna em 49** ([ACHADOS](docs/ACHADOS.md) #31) | ✅ |
| — | **O estado de drill era descartado.** O PBIP marca cada projeção com `active`, e um eixo de datas lista Ano/Mês/Dia sempre — só as ativas entram. Medido: **21 de 448 são inativas**, e agrupar por elas daria um ponto por dia num gráfico que mostra um por mês. Nenhuma está em tabela, então a cobertura não mudou; o ganho é para os gráficos ([ACHADOS](docs/ACHADOS.md) #32) | ✅ |
| — | **Gráficos: os 16 calculam.** Um ponto de gráfico é uma linha de tabela desenhada — mesmo agrupamento, mesmo contexto de filtro. O que é só do gráfico é o eixo de datas: `'T'[Data].[Mês]` não é coluna, é projeção, e ignorar o `active` daria **455 pontos onde a tela tem 99** ([ACHADOS](docs/ACHADOS.md) #33) | ✅ |
| — | **Cruzar tabelas: a expansão do DAX, não o produto cartesiano.** Agrupar por colunas de tabelas diferentes exige achar a **âncora** — aquela cuja *tabela expandida* cobre as outras — e varrê-la seguindo os relacionamentos. O produto daria 25 linhas onde existem 5, com cara de detalhamento. Destravou 5 tabelas e 2 gráficos; a linha em branco do relacionamento foi o defeito que os testes pegaram ([ACHADOS](docs/ACHADOS.md) #34) | ✅ |
| — | **Matriz: os 8 `pivotTable` calculam.** Uma matriz **não** é uma tabela com duas chaves: os eixos são agrupados em separado, a combinação que não existe é **célula vazia** (não linha ausente), e o HAVING vale por célula. A poda de linha/coluna vazia é o padrão do Power BI, e o resultado carrega quantas descartou ([ACHADOS](docs/ACHADOS.md) #35) | ✅ |
| — | **Os últimos 5 visuais, e as duas regras que faltavam.** `% do total` (`Arithmetic` + `ScopedEval`): o denominador é o total **do visual**, não o da tabela — a leitura errada dá porcentagens plausíveis que somam menos de 1. E a âncora de duas dimensões é a tabela **de onde saem os números do visual**, não uma das 4 candidatas do modelo ([ACHADOS](docs/ACHADOS.md) #36) | ✅ |
| — | **O primeiro número real: a camada M chegou ao avaliador.** `toDatasetRows` — a ponte entre a camada M e o `Dataset` — existia desde a 2b.8 e **só era chamada em teste**: as engines calculavam sobre dado sintético e nada na plataforma tocava a fonte. `npm run snapshot` materializa o que uma **página** alcança e `carrega()` monta o avaliador. O fechamento não é a lista do visual — `FERIADOS` entra em **9 páginas e nenhum visual a nomeia**, quem a puxa é o DAX de `'CALENDARIO INSTALADO'[PESO]` ([ACHADOS](docs/ACHADOS.md) #37) | ✅ |
| — | Medido em `diario-instalacao`: 4 queries, **98.111 linhas, 75,2 MB** em disco, 2m13s para materializar e **1,76 s para carregar**. Os **5 cards da página calculam com dado real** | ✅ |
| — | **A matriz custava 33.945 varreduras onde o Power BI faz uma — resolvido.** Cada célula refiltrava as 65.563 linhas: 2,2 bilhões de visitas contra 65.563 de uma varredura única. O conserto não foi um motor novo: a varredura que descobre as combinações **já separava as linhas de cada grupo** e as jogava fora. O perigo era a substituição do DAX — `ALL()` de uma das chaves derruba um filtro do grupo, e as linhas materializadas ficariam estreitas demais ([ACHADOS](docs/ACHADOS.md) #38) | ✅ |
| — | Medido em dado real contra o mesmo cálculo sem o caminho rápido: `protocolos-detalhados` em **1.519 ms contra 374.260 ms**, com **`sha256` idêntico** sobre 23,8 MB de saída — **246×**, byte a byte o mesmo número. A matriz que não terminava em 400 s: **1.610 ms** | ✅ |
| — | A conferência que torna isso seguro **não era coberta por teste nenhum**: removida, os 860 continuavam passando. Veio de mutação, e hoje 2 testes a pegam. A outra mutação — truncar as linhas materializadas — derruba 38 | ✅ |
| — | **A tela existe: `apps/api` serve a API de leitura e o dashboard.** Uma página do relatório abre no navegador com número calculado a partir da fonte real. `diario-instalacao`: **7 visuais com número, 0 falharam**, 3,8 s por pedido; a tabela de 32.462 linhas sai em 48 KB em vez de 23,8 MB, dizendo o total ([ACHADOS](docs/ACHADOS.md) #39) | ✅ |
| — | **Somente leitura no protocolo**: só `GET`/`HEAD`, qualquer outro método leva 405 antes do roteamento. É a quarta camada — as outras três ficam no Query Engine, que a API nem chama: ela lê snapshot | ✅ |
| — | Divergência registrada do `ARCHITECTURE.md`: **`node:http` em vez de Fastify**. Cinco rotas `GET` sem corpo, sem escrita e sem autenticação não pagam um framework. Continua valendo — a condição de revisão (Permission Engine, corpo, WebSocket) não foi atingida | ⚠️ |
| — | **A tela virou aplicação: `apps/web` em React 19 + Vite.** 14 páginas navegáveis, estado na URL e as **segmentações filtrando de verdade** — a escolha vira um `FiltroSpec` sintético e entra na mesma lista dos filtros de página, sem tocar em engine. Medido em `visao-geral` com `[EQUIPE] = Equipe Field Service`: `CLIENTES DISTINTOS` **28.253 → 2.973** ([DECISAO-TELA](docs/DECISAO-TELA.md)) | ✅ |
| — | **Tabela calculada congelada gravava a coluna-chave inteira nula**, e o acidente que fazia as calculadas saírem certas escondeu isso por um commit. `calendar` inteira eram 30.009 linhas vazias. Achado por uma funcionalidade que **exibe dado cru**, não por teste ([ACHADOS](docs/ACHADOS.md) #54) | ✅ |
| — | A regra 5 do `PROMPT-CONTINUACAO.md` mandava a paleta **v1** (`#F5F1E8`, DM Sans, 256px), que o próprio design system marca como substituída. Corrigida para a **v2** real do HUBBI (`#F4F4F5`, âmbar `#F59E0B`) | ✅ |
| — | **O relatório inteiro contra dado real: `npm run paginas`.** 11 das 14 páginas carregam e **os 64 visuais com número nelas calculam** — 632.620 linhas, 11,9 s de carga e 17,5 s de cálculo. Outra pergunta que a cobertura da fase 3: lá era "o avaliador sabe fazer a conta" sobre tabelas de 5 linhas ([ACHADOS](docs/ACHADOS.md) #40) | ✅ |
| — | Na primeira passada eram 63: **o tipo declarado valia só para coluna calculada**. `'CONSOLIDADO CLIENTES'[authentication_totalizer]` declara `int64` e a camada M entrega texto. É o #31 um nível acima, e nenhum dos 898 testes podia pegar — em dado sintético o teste sempre põe número em coluna numérica. Medido: **14 colunas** declaram número e chegam texto, e em todas **todo valor é literal limpo** | ✅ |
| — | As 4 do sentido contrário (declaram texto, chegam data/número) ficam como estão: `'PROTOCOLOS GERAL'[DATA FINAL]` é data de verdade, e convertê-la para texto quebraria todo `YEAR()` sobre ela | ⚠️ registrado |
| — | 3 páginas não carregam. `clima-tempo` **não tem como ser materializada** (função dentro de `let` + `Web.Contents`, sem connector) e leva 2 páginas junto; `field-agenda`, de 1,4 M de linhas, **estourou o `statement_timeout` de 600 s no servidor** — o teto certo de um refresh depende da query, não de um número redondo | ✅ resolvido abaixo |
| — | **`clima-tempo` materializa: `Web.Contents` não era pré-buscável, e a saída foi reavaliar.** Avaliar M é síncrono e a URL dela sai de `cidade{1}` e de `Date.ToText(ontem)` — valores que só existem no meio da avaliação, então não há o que pré-buscar como se faz com `Odbc.Query`. O runner avalia, é sinalizado, busca e reavalia; termina porque o mapa de respostas só cresce, e a **última** passada roda inteira sem pendência ([ACHADOS](docs/ACHADOS.md) #42) | ✅ |
| — | Medido: **14 requisições** (7 cidades × 2 endpoints), 15 passadas, 1.638 linhas. Dos 13,5 s, **13,4 s são rede e 123 ms são M** — reavaliar 15 vezes custa menos de 1% | ✅ |
| — | **Quarta camada do guard read-only, agora em HTTP**: método sempre `GET`, `Web.Contents` recusa a opção `Content` (que faria POST), host tem de estar em `endpoints` do `.spec.yaml` — que o **extrator gera do PBIP**, então ampliar o alcance de rede exige mudar o Power BI. Comparação de host exata: nem subdomínio nem sufixo passam; só `http`/`https` | ✅ |
| — | `Table.FromColumns` **diverge do M de propósito**: coluna mais curta é erro, não preenchimento com null. Com null, a classificação da própria query (`if = 0 … else "Chuva forte"`) faria o dia **sem dado** sair como **chuva forte** na tela, sem erro nenhum ([ACHADOS](docs/ACHADOS.md) #41) | ✅ |
| — | `field-agenda` materializou com teto de 1800 s: **1.458.244 linhas, 950 MB**. `FORA_DO_ESCOPO` está **vazio** no `mrun` e no `snapshot` pela primeira vez, e as 24 queries do corpus rodam | ✅ |
| — | **13 das 14 páginas carregam e os 96 visuais com número nelas calculam** (era 11 e 64) — 3.751.093 linhas, 53,1 s de carga e 31,1 s de cálculo | ✅ |
| — | A que falta é `agendamento-field`, e **não é mais falta de dado**: a tabela calculada `Status Protocolo Dia` faz **7 varreduras de `FIELD AGENDA` por linha** e tem uma linha por par (protocolo, dia). Medido: 29.846 linhas × 7 = **208.922 varreduras de 1,46 M** = **304,7 bilhões de visitas**; 9 min de CPU sem sair do carregamento. É o #38 outra vez, na tabela calculada em vez da matriz ([ACHADOS](docs/ACHADOS.md) #43) | ⚠️ |
| — | **Índice de igualdade por coluna** (`measure-engine/src/indice.ts`): as três formas caras são `'T'[c] = <valor de fora>`, e inverter a coluna uma vez troca 1,46 M linhas por um balde de ~55. Medido na reprodução sintética: `CALCULATE(MAX(…), FILTER(…))` de **7.626 ms para 12 ms**, **635×** ([ACHADOS](docs/ACHADOS.md) #44) | ✅ |
| — | E a medição desmentiu o #43: o gargalo maior **não** é `Status Protocolo Dia`, e sim as 7 colunas calculadas da própria `FIELD AGENDA` — duas varrem `FIELD AGENDA` por linha de `FIELD AGENDA`, **2,1 × 10¹²** visitas, sete vezes mais, e num lugar que o achado não olhou. Outras páginas não pagavam porque nenhum visual delas toca essas colunas | ⚠️ |
| — | Nada disso decide resultado: o predicado inteiro roda por cima dos candidatos, e os testes diferenciais afirmam o mesmo valor — e o mesmo **erro** — com e sem índice. `=` do DAX não é identidade (`BLANK = 0` é verdadeiro, texto contra número **lança**), e cada guarda existe por causa disso. 6 de 7 mutações derrubam teste; a 7ª não é regra, e está anotada como tal | ✅ |
| 4 | Realtime Engine (Debezium/Kafka/Redis) | ⏳ |
| — | **As 14 páginas calculam: `agendamento-field` termina, 21 de 21 visuais.** É a primeira vez. A carga dela caiu de "nunca vista terminar" para **25,6 s** — mas o **cálculo leva 104 minutos**, e enquanto for assim a página não entra em `npm run paginas` sem `--pagina=` ([ACHADOS](docs/ACHADOS.md) #45) | ⚠️ |
| — | Duas correções que a medição impôs: não era o carregamento (é, agora, o cálculo), e o ganho do índice é real sem entregar a página — as colunas calculadas de `FIELD AGENDA` materializam **sob demanda**, e quem as toca são os visuais. Terceira vez que o gargalo está onde o instrumento acaba, não onde ele aponta | ⚠️ |
| 5 | Permission Engine, IA, Export | ⏳ |

**1264 testes verdes.** Nenhum deles precisa de credencial, e nenhum precisa de build.

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

### API e tela (Fase 3)

```
npm run snapshot -- --pagina=diario-instalacao --memoria=8192   # uma vez
npm start                                                       # http://localhost:3100
```

`npm start` compila a tela, sobe a API e **aquece as 14 páginas** antes de dizer que
está pronto — `agendamento-field` custa ~1 min na primeira abertura, e um minuto de
tela branca é a diferença entre uma demo e um constrangimento. Ele reprova se algum
visual falhar, se alguma página não responder ou se o cache não pegar, e mesmo
reprovando deixa a API no ar para você olhar. Ver `tools/subir/`.

`apps/api` é o fim do caminho: lê o snapshot em disco, calcula a página com as
engines e devolve JSON. Não toca fonte nenhuma — quem busca é `npm run snapshot`.

`apps/web` é a tela: **React 19 + Vite**, navegando pelas 14 páginas, com as
segmentações (`slicer`) filtrando de verdade e o estado na URL. A API serve o build na
raiz; em desenvolvimento, `npm run web` sobe o Vite em 5173 com proxy para a API. A
tela anterior — uma página só, sem filtro — continua em `/legado`, como referência de
comparação durante a conferência de paridade. Ver [DECISAO-TELA](docs/DECISAO-TELA.md).

| rota | |
|---|---|
| `GET /api/saude` | o que há em disco, quantas linhas, de quando |
| `GET /api/dashboards` | as 14 páginas, e quais têm snapshot |
| `GET /api/dashboards/:id?de=&linhas=` | a página calculada |
| `GET /api/dashboards/:id?filtro=…` | a página calculada **com as segmentações da tela** aplicadas |
| `GET /api/dashboards/:id/valores?tabela=&coluna=&nivel=` | os valores distintos que uma segmentação oferece |

Qualquer método que não seja `GET`/`HEAD` leva **405 antes do roteamento**.

Três coisas na resposta que não são das engines e estão em teste: **um visual que
falha não derruba a página** (vira `erro` nele, e a página conta), **tabela grande
vem cortada dizendo o total** (23,8 MB → 48 KB) e **o tipo do valor viaja junto**
(JSON não tem data).

A sidebar da tela é **andaime local, marcado como tal**: pelo
[DESIGN-SYSTEM](docs/DESIGN-SYSTEM.md) v2 esta página abre dentro do AppShell do
HUBBI, e a navegação principal é de lá. O andaime usa as medidas reais (62px → 196px
no hover, header 52px) para que embuti-la no HUBBI seja **apagar um arquivo**, não
redesenhar o resto. E não usa biblioteca de gráfico — o Chart SDK é peça própria, e
escolher uma de passagem seria decidir por ele.

### O relatório inteiro (Fase 3)

```
npm run paginas                              # as 14 páginas
npm run paginas -- --pagina=visao-geral
npm run paginas -- --erros                   # só as mensagens, inteiras
```

Calcula todos os visuais de todas as páginas sobre o snapshot e conta o que fecha.
Nunca imprime valor de linha — só id, tipo, contagem, tempo e mensagem de erro —,
então a saída é segura para colar em ticket.

Também **lista as colunas convertidas para o tipo declarado**: é a única parte do
carregamento que muda o dado, e conversão calada é o erro mais caro desta base
([ACHADOS](docs/ACHADOS.md) #31 e #40).

### Snapshot da camada M (Fase 3)

`packages/snapshot/` e `npm run snapshot` são a costura entre as duas metades que
funcionavam sem se tocar: a camada M, que sabia buscar da fonte, e o avaliador, que
calculava sobre `Dataset` montado à mão no teste.

```
npm run snapshot -- --pagina=diario-instalacao --plano      # só diz o que faria
npm run snapshot -- --pagina=diario-instalacao --memoria=8192
npm run snapshot -- --todas --refazer --memoria=8192       # sem --refazer, pula o que já existe
npm run snapshot:calculadas -- --pagina=diario-instalacao  # e as 7 tabelas calculadas depois
```

> **`--refazer` e o passo das calculadas não são detalhe.** Sem `--refazer`, `--todas`
> pula toda query que já tem arquivo e não rebusca nada. E as 7 tabelas calculadas
> nascem das de query: rematerializar as segundas sem refazer as primeiras deixa em
> disco um congelado velho — que desde 13/08 **erra alto** em vez de ser servido calado.

**Uma query por processo**, pelo motivo já medido no [ACHADOS](docs/ACHADOS.md) #20: o
avaliador de M mantém todos os passos vivos ao mesmo tempo, e as queries num processo
só estouraram 4 GB de heap. Em disco sobra a tabela **final**, não os 60 passos que a
produziram — e é por isso que a API carrega arquivo em vez de rodar M no arranque.

**Só o que a página alcança é materializado.** O fechamento anda por quatro arestas
— visual → tabela·medida, medida → DAX, coluna calculada → DAX, tabela calculada →
DAX — e não pela lista de `entities_used`, que deixaria `FERIADOS` de fora de 9
páginas. As 14 juntas fecham em 23 tabelas e 16 queries; uma página típica pede 4.

**O formato guarda o tipo.** `JSON.stringify` de uma data devolve texto, e texto onde
o modelo espera data faz `YEAR()` errar alto — todas as datas de uma vez, longe da
causa. O arquivo é colunar com o tipo de cada coluna no cabeçalho, apurado varrendo a
coluna inteira.

> **`snapshot/` contém dado de cliente** — endereço em `field-agenda`, CPF e RG em
> `QUADRO FUNCIONAL`. Está no `.gitignore`, e nem a ferramenta nem os testes imprimem
> valor de linha.

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

Não confundir com as **74** que o avaliador executa **sozinho**: a diferença é
`[Faixa 1 Premiação Total]`, cujas referências existem mas que usa `ISINSCOPE` —
pergunta que só o visual responde ([ACHADOS](docs/ACHADOS.md) #12). Com o Widget
Engine informando o agrupamento, ela calcula, e o alvo de **75** está atingido. Os
três números medem coisas diferentes: "aponta para o que existe" (75), "roda no
avaliador" (74) e "roda dentro de um visual" (75).

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
regra que expôs a `clima-tempo` (que **hoje roda**: o avaliador a executa desde o
[ACHADOS](docs/ACHADOS.md) #42, e o que segue vale só para o scanner estático), que
define uma função M com `let` aninhado — em vez
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

### Widget Engine (Fase 3)

`packages/widget-engine/` calcula o que um visual mostra. Começou pelo **card** porque
ele é o caso mais barato de conferir do relatório inteiro: um número, sem eixo, sem
ordenação, sem *top N* — dá para olhar a tela e comparar. São **64**, e todos calculam.

Três partes, e cada uma existe por causa de um número errado específico:

- **`filtro.ts`** — filtro de spec → `TableFilter`. Filtro de página e de visual entram
  num `with()` **único**, nunca em dois encadeados: `FilteredContext.with()` implementa a
  substituição do `CALCULATE` (filtro novo derruba o antigo que toque a mesma coluna), que
  é a semântica certa do DAX e a errada aqui. Em duas etapas, o filtro do visual **apagaria**
  o da página e o card mostraria um número maior, sem erro nenhum.
- **`datas.ts`** — a data relativa é resolvida **na hora do cálculo**, não na extração:
  resolver antes congelaria "os últimos 7 dias" no dia em que alguém rodou
  `npm run extract`. O "agora" vem de `Evaluator.now`, e tudo é UTC — truncar em fuso
  local moveria a fronteira do mês em três horas.
- **`card.ts`** — a agregação vira **nó de AST**, não texto DAX reparseado. Os nomes desta
  base incluem `#APURAÇÃO PREMIAÇÃO` e `ALOCAÇÃO PATRIMONIO.ALOCADO POR:`; um escape errado
  daria erro de sintaxe no melhor caso e a coluna errada no pior.

Depois do card veio o **agrupamento**, que é o que separa um card de todo o resto: um
card é um número, uma tabela é *um número por grupo*.

- **`grupos.ts`** — o grupo é um **filtro**, não um recorte de linhas. Calcular a
  agregação direto sobre as linhas do grupo seria mais rápido e estaria errado para
  medida: `[Ticket]` é `DIVIDE([Total], [Itens])`, e as duas de dentro precisam
  enxergar o contexto do grupo. Filtrando, a propagação por relacionamento (2b.5) vem
  de graça — agrupar por `'EQUIPES'[REGIAO]` restringe `OS` sem que este arquivo saiba
  que existe relacionamento.
- **`tabela.ts`** — os 29 `tableEx` têm tudo em `role: Values`, e isso **não** quer
  dizer que a tabela não agrupa: quem agrupa são os campos sem função de agregação. Uma
  tabela de três colunas de texto mostra as **combinações distintas**, não uma linha por
  registro. Lida como listagem crua ela sairia maior que a da tela, com cara de dado a
  mais em vez de erro.
- **os dois momentos do filtro** — o de linha vale antes de agrupar e decide o que entra
  na conta; o de grupo (`COUNT(x) > 0`, o HAVING) vale depois e decide quais grupos
  sobrevivem. Antes de existir grupo não há o que agregar, e é por isso que esse filtro
  não podia ser implementado junto com o card.
- **`grafico.ts`** — um ponto de gráfico é uma linha de tabela desenhada: mesmo
  agrupamento, mesmo contexto de filtro, mesma ordem de filtros. A diferença é de
  arrumação — `Category` e `Series` agrupam, `Y` e `Y2` viram número. Papel fora
  desses quatro **erra alto**: é uma dimensão que o visual ganhou, e ignorá-la daria
  menos pontos do que a tela tem.
- **`expansao.ts`** — agrupar por colunas de **tabelas diferentes**. A regra é a
  *tabela expandida* do DAX: `T` mais tudo alcançável por relacionamentos muitos→um.
  Se as colunas cabem na expandida de uma delas, essa é a **âncora**, e varrê-la
  seguindo os relacionamentos dá as combinações que existem, uma vez cada. O produto
  cartesiano daria 25 linhas onde existem 5 — maior, ordenado, somando certo.
- **`matriz.ts`** — a matriz **não** é uma tabela com duas chaves. Os dois eixos são
  agrupados em separado, sobre a mesma base, e a célula é o cruzamento: a combinação
  que não existe é uma **célula vazia**, não uma linha ausente, e o conjunto de
  colunas é o mesmo em todas as linhas. Reaproveitar `agrupar` com as chaves das duas
  direções juntas daria uma tabela com cara de matriz.

O que é só do gráfico é o **eixo de datas**, e ele é a armadilha da fatia
([ACHADOS](docs/ACHADOS.md) #33). `'T'[Data].[Mês]` não existe como coluna — é uma
projeção da coluna de data —, e é o eixo de 10 dos 16. Duas coisas se decidem aí:

- **quais níveis contam.** A hierarquia chega sempre inteira (Ano, Mês, Dia) e o
  `active` diz quais estão na tela. Ignorando isso, os 13 gráficos que calculam dão
  **455 pontos em vez de 99** — 4,6× a mais, todos plausíveis, nenhum com cara de erro.
- **o que o nível põe em escopo.** Agrupar por `[DATA].[Mês]` **não** põe `[DATA]` em
  escopo: dentro de `janeiro` a data ainda varia, então `ISINSCOPE('T'[DATA])` é FALSE.
  Já o *filtro* do grupo restringe a coluna base — é ela que um `CALCULATE` de dentro
  de uma medida precisa conseguir sobrepor.

Com o agrupamento veio a **75ª medida**: `[Faixa 1 Premiação Total]` usa `ISINSCOPE`
para só calcular no total, e `ISINSCOPE` é propriedade do visual, não do modelo. O
avaliador ganhou `scopeWithGrouping`; sem ele, `ISINSCOPE` **continua errando alto** —
conjunto vazio é "o visual não agrupa por nada", `undefined` é "não há visual", e a
distinção é o que impede a medida de calcular em toda célula.

**O que está medido, e o que ainda não se sabe.** **Os 117 visuais com número
calculam** — card 64/64, tabela 29/29, gráfico 16/16, matriz 8/8 —, e os 108 filtros
do relatório têm todos quem os aplique: 98 como predicado de linha e 10 como HAVING
sobre os grupos. Os testes de cobertura passaram a exigir que o mapa de recusas saia
**vazio**, então uma recusa nova aparece como `NÃO CLASSIFICADA` em vez de sumir na
contagem.

Foram cinco famílias de recusa, e cada uma fechou por um motivo diferente: o HAVING,
o nível de hierarquia, o cruzamento entre tabelas, o tipo declarado da coluna e o
campo aritmético.

Três distâncias continuam medidas e presas em teste, porque são o tamanho do que
**não** está provado: **36 cards têm filtro e só 5 mudam de valor** sobre o dataset
sintético, **das 5 tabelas cruzadas só 2 trazem linha**, e **das 8 matrizes só 6**.
Nos casos que faltam o filtro esvazia a tabela do eixo antes de agrupar: zero linha é
resultado legítimo e prova nenhuma. Os números estão presos em `cobertura.test.ts`
justamente para que a distância fique visível. É a mesma lição da 2b.5 — **dado
sintético não prova paridade**.

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
npm test                              # suíte completa (832 testes, sem credencial)
npm run extract                       # regenera as specs a partir do PBIP
npm run validate:model                # o DAX referencia coisas que existem? (sem banco)
npm run validate:tables               # as colunas do modelo existem na fonte? (sem banco)
npm run doctor                        # valida configuração e conectividade
npm run validate:queries              # executa as queries reais e grava os goldens
npm run validate:queries -- --check    # falha se o schema de alguma query mudou
npm run probe:datahub                 # perfila a API do Data Hub (shape, nunca linha)
npm run probe:gsheets                 # a identidade em uso alcança as planilhas?
npm run auth:google                   # autoriza uma conta Google (uma vez) e grava o refresh token
npm run run:mlayer -- --all --memoria=8192   # roda a camada M contra as fontes reais
npm run run:mlayer -- --only=uma-query --passos   # linhas por passo, com seta em quem mudou
```

Os nove respondem perguntas diferentes, e só os três primeiros dispensam `.env`:

| Comando | Pergunta | Precisa de `.env`? |
|---|---|---|
| `npm test` | o código respeita as specs? | não |
| `validate:model` | o DAX aponta para tabelas/colunas que existem **no modelo**? | não |
| `validate:tables` | essas colunas existem no que a **fonte** devolve? | não |
| `doctor` | as fontes estão alcançáveis e a sessão é read-only? | sim |
| `validate:queries` | as queries rodam e devolvem o quê? | sim |
| `probe:datahub` | a API do Data Hub tem os campos que a mesclagem precisa? | sim |
| `probe:gsheets` | a identidade em uso lê as planilhas, e o cabeçalho bate com a spec? | sim |
| `auth:google` | qual conta Google a plataforma usa para ler as planilhas? | sim |
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
packages/transform-engine/# camada M: tokenizer, parser, avaliador, runner e connectors
packages/widget-engine/   # o que um visual mostra: filtro, agrupamento, card, tabela e gráfico
```

> Arquivos marcados **GERADO** são reescritos por `npm run extract` — nenhuma
> decisão humana pode viver dentro deles. Por isso as políticas de cache ficam
> em `cache-policies.yaml`, separado.

## Base de referência (read-only)

O projeto Power BI `INST - Relatório Instalação Gerencial` (pasta pai) é a fonte da
verdade do comportamento atual. **Não é modificado** — apenas lido pelo extrator.

Ver [docs/SPEC-DRIVEN.md](docs/SPEC-DRIVEN.md) e [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
