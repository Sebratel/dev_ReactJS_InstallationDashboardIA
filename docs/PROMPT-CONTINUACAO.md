# Prompt de continuação — Analytics Platform Enterprise

> Cole o bloco abaixo em uma sessão nova (Antigravity, Claude Code CLI, etc.).
> Ele é autocontido: reconstrói o contexto lendo o repositório, não a conversa.

---

Você vai continuar o desenvolvimento da **Analytics Platform Enterprise** da Sebratel.

## Diretório de trabalho

```
C:\Users\erick.azambuja\Desktop\DASHBOARD - Instalação\dev_ReactJS_InstallationDashboardIA
```

Repositório: `git@github.com:Sebratel/dev_ReactJS_InstallationDashboardIA.git` (branch `main`).

**Comece lendo, nesta ordem:** `README.md`, `docs/ARCHITECTURE.md`, `docs/SPEC-DRIVEN.md`,
`specs/golden/README.md`, `specs/EXTRACTION-REPORT.md`. Eles contêm todo o estado do projeto.
Antes de escrever **qualquer** UI (componente, página, dashboard, gráfico), leia
`docs/DESIGN-SYSTEM.md` — é o Design System oficial GER/Sebratel e tem prioridade
máxima sobre qualquer default visual.

## O que é o projeto

Substituir o Power BI da Sebratel por uma plataforma própria de Analytics, orientada
por **Engines** e **metadados** (não é um CRUD com controllers). O objetivo da primeira
etapa é **replicar fielmente** os dashboards atuais; só depois evoluir para o que o
Power BI não faz (IA, tempo real, permissionamento granular).

Domínio: operação de **instalação / field service de ISP**.

## Base de referência — LEIA, NUNCA MODIFIQUE

O projeto Power BI PBIP fica na pasta **pai**:

```
C:\Users\erick.azambuja\Desktop\DASHBOARD - Instalação\
  INST - Relatório Instalação Gerencial.pbix          (73 MB)
  INST - Relatório Instalação Gerencial.SemanticModel\ (tabelas, medidas, queries M)
  INST - Relatório Instalação Gerencial.Report\        (páginas e visuais)
```

Escala: **25 tabelas (7 delas calculadas em DAX), 78 medidas DAX, 49 colunas
calculadas (também DAX), 22 relacionamentos, 14 páginas, 306 visuais, 24 queries
com 303 passos de Power Query**.

Fontes reais das 24 queries: **15** `dbVoalle` (PostgreSQL do ERP Voalle), **3** `dbMaria`
(MariaDB `DB_Applicattion`: `Backlog_Installation`, `Backlog_Schedules`,
`Installation_Teams`), **3** `gsheets` (QUADRO FUNCIONAL, capacidade de equipe, apuração
de premiação), **1** `web` (Open-Meteo), **1** `inline` (feriados embutidos no .pbix),
**1** `computed`.

> **Esses dados são usados hoje na operação de instalação.** Replicar fielmente é
> requisito. Sugerir melhorias é bem-vindo, mas registre-as separadamente — nunca
> troque o comportamento atual sem avisar.

Achados sobre o comportamento atual ficam em [`docs/ACHADOS.md`](./ACHADOS.md) —
**leia antes da Fase 2b.** A decisão do Erick sobre todos eles já está lá, no topo:
**replicar fielmente**, inclusive onde o comportamento atual parece errado. Não
"conserte" nada por iniciativa própria; divergência deliberada só com decisão nova
registrada nessa seção.

O achado 1 está **retirado** — era erro meu de ordenação de data em texto, não um
defeito do relatório. Leia de qualquer forma: a lição sobre `DD/MM/YYYY` vale para
o resto do projeto.

## Estado atual (já pronto e testado)

**347 testes verdes.** Rode `npm test` para confirmar antes de mexer em qualquer coisa.
Nenhum teste precisa de credencial ou banco.

| Fase | Escopo | Status |
|---|---|---|
| 0 | Extrator PBIP → specs | ✅ |
| 1 | Query Engine + Registry + cache | ✅ |
| — | Infra de conexão + doctor + guard read-only | ✅ |
| — | Validação contra dados reais — 18/18 queries capturadas em `specs/golden/` | ✅ |
| 2a | Modelo semântico completo + verificação de referências do DAX | ✅ |
| 2b.1 | Parser de DAX → AST — as 134 expressões da base parseiam | ✅ |
| 2b.2 | Avaliador: escalares e agregação | ✅ |
| 2b.3 | Contexto de filtro (`CALCULATE`, `FILTER`, `ALL`, `TREATAS`) | ✅ |
| 2b.4 | Time intelligence, conjuntos, `RANKX` — 74 das 78 medidas executam | ✅ |
| 2b.5 | Propagação de filtro por relacionamento — 22 medidas dependiam dela | ✅ |
| 2b.6 | O que separa o avaliador do dado real: camada M + 7 tabelas calculadas | ✅ |
| 2b.7 | Materializar as 7 tabelas calculadas — as 56 funções estão todas implementadas | ✅ |
| 2b.8 | Camada M: parser + avaliador + orquestrador, 37/39 funções. Falta ligar no Query Engine (2 funções de fonte) e a paridade da 2b.9 | 🚧 **em curso** |
| 2b.9 | Paridade medida a medida contra o relatório | ⏳ |
| 3 | Widget/Dashboard Engine + Chart SDK | ⏳ |
| 4 | Realtime Engine (Debezium/Kafka/Redis) | ⏳ |
| 5 | Permission Engine, IA, Export | ⏳ |

Já implementado em `packages/query-engine/`:
- `QueryRegistry` — carrega specs, aplica `cache-policies.yaml`, `validate()`,
  mapa `tabela-fonte → queries`
- `Cache` — porta única; `MemoryCache` e `RedisCache` (usa SCAN, não KEYS)
- `QueryEngine` — cache, **single-flight** (20 widgets = 1 query no banco),
  `invalidateByTable()`
- `Connectors` — porta com driver injetável; `SqlConnector`, `FakeConnector`,
  e os pools reais em `connectors-sql.ts`

Já implementado em `packages/semantic-model/` (Fase 2a):
- `SemanticModel` — carrega tabelas, colunas (com o DAX das calculadas), medidas e
  relacionamentos. Resolve nome **sem distinguir caixa**: o modelo real escreve a
  mesma tabela como `'FIELD AGENDA'` e `'Field Agenda'`, e a mesma coluna como
  `[Protocolo]` e `[protocolo]`
- `extractRefs` — scanner que tira de um DAX as referências `'Tabela'[Coluna]`,
  `[Medida]` e tabela solta, pulando string e comentário. **Não é o parser** — é
  o que responde "isto referencia coisa que existe?"
- `checkModelRefs` — resolve as referências contra o modelo. `npm run validate:model`

Em `tools/validate/` (`npm run validate:tables`) — fase 2b.6:
- `mlayer.ts` — scanner estático da camada M. Responde "que coluna este passo cria?"
  e "este passo muda a contagem de linhas?". **Não é avaliador de M**; erra alto em
  função `Table.*` desconhecida e em `let` aninhado
- `tables.ts` — classifica as 298 colunas físicas em SQL / alias repetido / passo M /
  DAX da própria tabela / sem golden / sem explicação, e sai com código 1 se uma coluna
  **citada pelo DAX** não for explicada por ninguém

Em `tools/validate/` (`npm run validate:queries`):
- executa as **18 queries SQL** (dbVoalle + dbMaria) nas fontes reais
- grava `specs/golden/<id>.golden.json` com a **forma e os agregados** do
  resultado — nunca as linhas, porque o golden é commitado e as queries do
  Voalle devolvem nome, endereço e CPF de cliente. Ver `specs/golden/README.md`.
- `-- --check` reexecuta e separa mudança de **schema** (regressão: coluna sumiu
  ou trocou de tipo, quebra medidas, exit 1) de mudança de **dados** (esperado)
- a fonte entra como `SqlRunner` injetado, então tudo é testável sem banco

## Regras invioláveis

1. **O PBIP é read-only.** Só o extrator lê. Nunca escreva nessa pasta.
2. **Arquivos gerados vs. humanos.** Tudo em `specs/_catalog/queries|tables|measures/`
   e `specs/dashboards/` é **sobrescrito** por `npm run extract`. Nenhuma decisão
   humana pode viver lá. Decisões vão em `specs/_catalog/cache-policies.yaml`.
3. **A plataforma nunca escreve no ERP.** Read-only em 3 camadas: usuário só-leitura,
   `default_transaction_read_only=on` na sessão Postgres, e `assertReadOnly()`
   barrando DDL/DML antes de a query sair do processo. Não afrouxe isso.
4. **Toda implementação vem com teste.** Nenhuma fase fecha sem testes verdes de
   paridade contra a spec. É o que impede quebrar o que já existe.
5. **Toda UI segue `docs/DESIGN-SYSTEM.md`.** Fundo `#F5F1E8`, cards brancos,
   DM Sans, sidebar 256px, primária âmbar `#FFB000`, semáforo verde/vermelho/cinza.
   Sem roxo/azul/gradiente/dark mode e sem HEX hardcoded — só tokens.
6. **Nunca peça nem aceite credenciais em texto.** Elas vivem só no `.env` local,
   que o git ignora. A saída de `npm run doctor` é mascarada e segura.

## Comandos

```bash
npm test                              # suíte completa (347 testes, sem credencial)
npm run extract                       # regenera as specs a partir do PBIP
npm run validate:model                # o DAX referencia coisas que existem no MODELO? (sem banco)
npm run validate:tables               # essas colunas existem no que a FONTE devolve? (sem banco)
npm run doctor                        # configuração e conectividade (não imprime credencial)
npm run validate:queries              # executa as queries reais e grava os goldens
npm run validate:queries -- --check    # falha se o schema de alguma query mudou
```

Os cinco respondem perguntas diferentes: `npm test` = o código respeita as specs;
`validate:model` = o DAX aponta para tabela/coluna que existe **no modelo**;
`validate:tables` = essa coluna existe no que a **fonte** devolve; `doctor` = as
fontes estão alcançáveis; `validate:queries` = as queries rodam e devolvem o quê.
Os três primeiros dispensam `.env`.

A diferença entre o segundo e o terceiro não é redundância: `validate:model` aprova
`'PROTOCOLOS GERAL'[HORA CRIADO]` porque a coluna está declarada na spec da tabela.
Ela **não sai do SELECT** — nasce num passo do Power Query.

Node 24 roda TypeScript nativamente — **não há build step**.

## Pendência conhecida

O `git push` falhou: a conta `erickazambuja-Sebratel` **não tem permissão de escrita**
no repositório da org. Os commits estão todos locais em `main`, aguardando. Quando um
admin liberar o acesso, basta `git push -u origin main`. Não tente contornar.

Pode haver **outra sessão de CLI commitando no mesmo repo em paralelo** (foi o caso
do `docs/DESIGN-SYSTEM.md`). Antes de commitar, rode `git status` e confira o que
está sendo staged — um `git add -A` distraído varre o trabalho da outra sessão para
dentro do seu commit.

Existe também uma cópia antiga do trabalho em
`.claude/worktrees/analytics-platform-enterprise-394804` (repositório errado,
`dev_Sebratel_Images`). **Ignore essa pasta** — o diretório acima é o canônico.

## Pendência com o Erick (não bloqueia começar)

Os `rowCount` estão em `specs/golden/` e **ainda não foram conferidos contra os
números do Power BI**. O Erick pediu para seguir sem isso ("prossiga sem isso,
depois validaremos"). Continue — mas se um número divergir depois, a medida
construída sobre aquela query nasce errada, então **não trate paridade como
provada** até a conferência acontecer.

**A conferência é de 6 tabelas, não de 18** (descoberto na 2b.6). O `rowCount` do
golden conta o **SQL**; em 11 das 17 tabelas o Power Query filtra, deduplica ou
expande linha depois disso, e ali os dois números são diferentes por construção.
`npm run validate:tables` diz em qual grupo cada tabela está. Ver ACHADOS.md #15.

Os achados de comportamento **já foram decididos: replicar fielmente**
([`docs/ACHADOS.md`](./ACHADOS.md), seção "Decisão vigente"). O que isso impõe à
Fase 2b:

- **Alvo é 75 medidas, não 78.** As 3 do achado 6 apontam para tabela inexistente
  e não têm resultado hoje; replicar fiel de "sem resultado" é não implementar.
- **Onde o Power BI usa `DISTINCTCOUNT`, use `DISTINCTCOUNT`** — `field-agenda`
  infla linha por skill (achado 2) e a inflação foi mantida de propósito.
- **`PESO` e `# MEDIA CRIADOS` discordam sobre o sábado** (1 vs 1,5, achado 7).
  Reproduza as duas como estão. É o único ponto que segue sendo pergunta de
  negócio em aberto, mas não bloqueia nada.

## Próximo passo: Fase 2b — o avaliador de DAX

**Decisão de arquitetura já tomada na 2a, e o motivo importa.** As 78 medidas
**não** vão ser 78 funções TypeScript escritas à mão. O DAX da spec é a
implementação: um avaliador de um subconjunto de DAX lê `measures/*.yaml` e
calcula. Duas razões:

1. `npm run extract` sobrescreve as specs. Função escrita à mão divergiria em
   silêncio quando alguém mexesse no DAX do Power BI; um avaliador acompanha.
2. Semântica de contexto de filtro (`CALCULATE`, `ALL`, `FILTER`, `TREATAS`)
   reimplementada 78 vezes ad hoc dá mais código e menos correção do que uma vez
   só, testada.

**Princípio inegociável do avaliador: falhar alto.** Função DAX não suportada,
construção não reconhecida, referência que não resolve → **erro**, nunca um
palpite. Um avaliador parcial que devolve número errado em silêncio é pior que um
que se recusa a rodar, porque o erro chega ao dashboard da operação como se fosse
um dado.

Inventário real, contado **sobre o AST** das 127 expressões escalares (medidas +
colunas calculadas) — não por regex, que subcontava feio: dizia `IF:10` quando são
31. As 7 tabelas calculadas acrescentam `CALENDAR:3` e `ADDCOLUMNS:1`, implementadas na
2b.7 — com elas, **as 56 funções da base estão todas cobertas**:

```
CALCULATE:50  DISTINCTCOUNT:37  IF:31  TODAY:25  FILTER:16  DIVIDE:14  BLANK:14
ISBLANK:12  SUM:10  TRUNC:10  YEAR:9  COUNTROWS:9  SELECTEDVALUE:8  VALUES:8
COUNT:7  MONTH:7  DATE:7  SWITCH:7  DATESBETWEEN:6  DATEDIFF:6  MAX:6
WEEKDAY:5  ROUND:4  TREATAS:4  ALL:4  MOD:4  FORMAT:4  AVERAGEX:3  EOMONTH:3
SELECTCOLUMNS:3  QUOTIENT:3  ENDOFMONTH:2  DISTINCT:2  CALCULATETABLE:2
LOWER:2  CONTAINSSTRING:2  HOUR:2  NOW:2  INT:2  TIME:2  COALESCE:2
INTERSECT:1  EXCEPT:1  UNION:1  DATESMTD:1  MIN:1  ISINSCOPE:1  STARTOFMONTH:1
LOOKUPVALUE:1  DATEVALUE:1  RANKX:1  OR:1  SUBSTITUTE:1
```

### 2b.1 — parser: PRONTO

`packages/measure-engine/` tem tokenizer, parser (precedência por Pratt) e AST.
**As 134 expressões da base parseiam** (78 medidas + 49 colunas calculadas + 7
tabelas calculadas) — é a métrica de cobertura que vale, medida sobre o DAX real.
Ver `test/cobertura.test.ts`. Eram 127 até a 2b.6 descobrir que faltavam as
tabelas calculadas nas specs.

Duas coisas que o parser trata de propósito e que quebram implementações
ingênuas:

- `==` é igualdade **estrita** do DAX (BLANK não equivale a 0 nem a `""`), não
  dois `=`. Usado em `PROTOCOLOS GERAL[CONDICAO ITEM]`.
- argumento **omitido** no meio da lista: `RANKX(t, e, , ASC, DENSE)` é real. Vira
  nó `Missing`, não um valor inventado.

O AST é burro por decisão: `Identifier` pode ser variável, tabela sem aspas ou
enum (`ASC`/`DENSE`/`DAY`); `NameRef` (`[X]`) pode ser medida ou coluna local.
**Quem resolve é o avaliador**, que conhece o modelo. Não "conserte" isso no
parser — `[Data]` em `RANKX(TabelaDatas, [Data], ...)` é coluna de tabela anônima
criada por `SELECTCOLUMNS`, e resolver cedo escolheria errado em silêncio.

### 2b.2 — avaliador de escalares e agregação: PRONTO

`packages/measure-engine/src/` ganhou `value.ts`, `dataset.ts`, `evaluator.ts` e
`functions.ts`. **34 das 54 funções** que a base usa.

Feito: agregação (`SUM`, `COUNT`, `MIN`/`MAX`, `DISTINCTCOUNT`, `COUNTROWS`),
lógica (`IF`, `SWITCH`, `COALESCE`, `OR`, `BLANK`, `ISBLANK`), matemática
(`DIVIDE`, `ROUND`, `INT`, `TRUNC`, `MOD`, `QUOTIENT`), texto (`LOWER`,
`SUBSTITUTE`, `CONTAINSSTRING`, `CONCATENATE`, `FORMAT`), data (`TODAY`, `NOW`,
`DATE`, `YEAR`, `MONTH`, `DAY`, `HOUR`, `WEEKDAY`, `TIME`, `EOMONTH`, `DATEVALUE`,
`DATEDIFF`), `VAR`, `IN {...}`, dependência entre medidas com detecção de ciclo,
coluna calculada em contexto de linha (memorizada na linha) e a hierarquia
automática de datas (`[Data].[Dia]`).

**Como a cobertura é medida** — em `test/avaliador-cobertura.test.ts`, e a
distinção entre os níveis não é formalidade:

| Nível | Hoje |
|---|---|
| Parseia | 127/127 |
| Dentro do implementado (seguindo dependências) | 60/127 |
| **Executa de ponta a ponta** | **59/127** |
| Bate com o Power BI | ⏳ **não provado** |

Os testes rodam sobre dados **sintéticos**. Eles provam que o avaliador funciona,
**não** que o número é o do relatório. Não diga "paridade" com base neles.

A diferença 60 → 59 é `# AA MÉDIA EQUIPES`, medida morta do achado 6, e há teste
exigindo que ela continue falhando.

Duas lições que já custaram retrabalho, registradas para não repetir:

- **Contagem estática de cobertura mente se esquecer uma aresta.** A primeira
  versão olhava só o AST da própria expressão e dizia 69; seguindo medidas caiu
  para 62; seguindo colunas calculadas, 60. Quem expôs as duas faltas foi o teste
  que *executa*, não o que analisa.
- **A cultura do modelo é `pt-BR`** (lido em `model.tmdl`). `FORMAT(data,"dddd")`
  tem de devolver `"domingo"`: o `SWITCH` do `[PESO]` compara com essa string, e
  em inglês nenhum domingo casaria — todo domingo passaria a valer 1 dia útil.

### 2b.3 — contexto de filtro: PRONTO

`src/filter.ts` é novo e é onde vive o modelo. **Leia antes de mexer em qualquer
coisa de filtro.**

Cobertura foi de 59 para **107 de 127** expressões executando. Implementado:
`CALCULATE`, `CALCULATETABLE`, `FILTER`, `ALL`, `VALUES`, `DISTINCT`, `TREATAS`,
`LOOKUPVALUE`, `SELECTEDVALUE`, `AVERAGEX`, `COUNTROWS` sobre expressão de tabela,
`x IN <tabela>`, e `VAR` guardando tabela. **44 das 54 funções.**

**A regra central, e ela é contraintuitiva.** Filtro de `CALCULATE` **substitui** o
filtro existente sobre a mesma coluna em vez de somar, e quem vence é o `CALCULATE`
mais **interno**:

```dax
// devolve o total de 2026. O Ano = 2025 pedido por fora é DESCARTADO.
CALCULATE([Total 2026], 'VENDAS'[Ano] = 2025)
```

Se os filtros se intersectassem daria vazio — e vazio num cartão parece "sem
dados", não erro. Cada filtro carrega **quais colunas restringe** (`TableFilter.columns`);
é isso que permite saber o que substituir, e é por isso que o contexto não é só uma
lista de linhas visíveis.

Consequências que caem de graça desse desenho, e vale saber para não "melhorar":
- `ALL('T'[C])` não tem tratamento especial. Ele devolve todos os valores de `C`;
  como filtro novo substitui o antigo, substituir por "aceita tudo" **é** remover o
  filtro.
- `FILTER` é diferente de propósito: ele itera o que já está visível, então **soma**
  ao contexto em vez de substituir. Daí o idioma `FILTER(ALL('T'), ...)` da base.

**Transição de contexto** está em `Evaluator.transitionRowContext`. Duas regras:
`CALCULATE` converte o contexto de linha em filtro e apaga o de linha (é por isso
que os 5 `CALCULATE` de um argumento só da base não são inúteis); e **referência a
medida traz um `CALCULATE` implícito**, então `AVERAGEX(VALUES('T'[C]), [Medida])`
calcula por valor de `C`. Sem isso a média sairia igual ao total — errado de um jeito
plausível.

**Limite declarado do modelo**, no topo de `filter.ts`: o motor real do Power BI
guarda tabelas de filtro, não predicados por coluna. A diferença aparece em filtro
que correlaciona colunas (`FILTER(T, T[a] > T[b])`). Para as 60 chamadas desta base
os dois modelos coincidem.

### 2b.4 — time intelligence, conjuntos e RANKX: PRONTO

**Todas as 54 funções DAX que as 127 expressões escalares usam estão implementadas.**
O teste que antes rankeava o que faltava virou o inverso: ele afirma que a lista de
faltantes está **vazia**, e falha dizendo o nome se o PBIP passar a usar função nova.

Cobertura: **123 das 127** expressões escalares e **74 das 78 medidas** executam.

> Ressalva vinda da 2b.6: a base usa **56** funções, não 54 — as duas que faltavam
> (`CALENDAR` e `ADDCOLUMNS`) só apareciam nas 7 tabelas calculadas, que não estavam
> nas specs quando esta fase fechou. Foram implementadas na 2b.7.

Escolhas de projeto desta etapa, todas com teste:

- **Funções de data devolvem tabela**, não escalar — é assim no DAX, e faz
  `DATESBETWEEN` entrar como filtro pelo mesmo mecanismo de substituição de coluna
  que já existia. Junto veio a coerção **tabela 1×1 → escalar**, que é o que faz
  `DATESBETWEEN(col, TODAY(), ENDOFMONTH(col))` funcionar.
- Elas **filtram** os valores que existem na coluna; não geram datas. Um calendário
  com buracos continua com buracos, como no Power BI.
- `DATESMTD` vai até a **última data visível no contexto**, não até hoje. Usar
  `TODAY()` daria outro número em qualquer contexto de mês passado.
- `SELECTCOLUMNS`, `INTERSECT` e `EXCEPT` produzem **tabela anônima**
  (`TableValue.table === null`): as colunas não existem em tabela nenhuma do modelo.
  Anônima conta linha e cria contexto de linha, mas **não pode virar filtro** — erra
  alto sugerindo `TREATAS`.
- `UNION` **mantém duplicatas**, como no DAX. Remover mudaria contagem.
- `[Nome]` resolve do contexto de linha **mais interno para o mais externo**. Sem
  isso, `RANKX(TabelaDatas, [Data], ...)` pegaria `'FIELD AGENDA'[Data]` (que existe
  no modelo) em vez da coluna da tabela anônima, e ranquearia errado em silêncio.
- `DATEVALUE` **descarta a hora**, como o DAX. Era bug meu: `'FIELD AGENDA'[Data]` é
  `DATEVALUE([Slot Agenda])`, `Slot Agenda` tem hora, e o `RANKX` compara com uma
  lista feita de `TRUNC`. Mantendo a hora nada casaria e o rank sairia BLANK.

### 2b.5 — propagação de filtro por relacionamento: PRONTO

**Era a maior fonte de erro silencioso do avaliador.** `Contagem Solicitacao 2026`
filtra `CALENDARIO INSTALADO` e conta `PROTOCOLOS GERAL`. Até a 2b.4 ela **rodava** e
devolvia a contagem de todos os anos, sem erro nenhum. São **22 das 78 medidas** que
citam mais de uma tabela sem `TREATAS`; todas dependiam disso.

O grafo está em `packages/measure-engine/src/propagation.ts` (só responde "de onde o
filtro chega e por qual coluna") e a travessia em `FilteredContext.linhasVisiveis`.
21 dos 22 relacionamentos são ativos; o inativo só valeria dentro de
`USERELATIONSHIP`, **confirmado ausente** das 134 expressões (reconferido na 2b.6,
com as 7 tabelas calculadas incluídas).

Decisões, todas com teste em `test/propagacao.test.ts`:

- **A coluna de junção pode ser calculada — e cinco são**, entre elas
  `'PROTOCOLOS GERAL'[DATA INSTALAÇÃO]`, a do caso acima, que escolhe entre três
  colunas de data conforme o tipo do protocolo. Por isso `Propagation` recebe do
  avaliador a função que resolve coluna: ler a linha crua devolve vazio e a junção
  não casa nada, calada.
- **Origem que não está restringida não restringe ninguém.** Sem isso, propagar
  viraria `INNER JOIN` e sumiria com as linhas do lado *many* que não casam — que no
  Power BI continuam visíveis. É também o que mantém `ALL` funcionando sem caso
  especial.
- **A propagação é recursiva** porque nesta base o filtro anda dois saltos:
  `calendar` → `Status Protocolo Dia` → `FIELD AGENDA`.
- **Não voltar pelo mesmo relacionamento** (regra do DAX; é o que impede
  `bothDirections` de virar laço) e **caminho ambíguo é erro alto** — se duas tabelas
  se ligam por dois caminhos distintos, o Power BI recusa o modelo e o avaliador
  também recusa, em vez de escolher um. O modelo real passou: nenhuma ambiguidade.
- **Junção entre tipos diferentes erra alto.** Data de um lado e texto `DD/MM/YYYY`
  do outro nunca casa, e o resultado sairia zero com cara de filtro apertado.

**Uma medição que vale carregar para a 2b.6.** Das 22 medidas que dependem de
propagação, o dataset sintético consegue mostrar **uma** mudando de valor quando a
propagação é desligada. As outras 21 não aparecem porque quatro linhas por tabela com
valores uniformes fazem quase todo filtro aceitar tudo. Isso obrigou a acrescentar
uma data de 2025 ao `DATAS` do teste de cobertura — sem ela o efeito medido era
**zero**. Dois testes fixam os dois números para que a distância entre eles fique
visível: é a demonstração mais concreta que o projeto tem de que **dado sintético não
prova paridade**.

### 2b.6 — o que separa o avaliador do dado real: PRONTO

Esta fase não escreveu avaliador. Ela foi **medir** o que falta para dado real
entrar, porque "conferir os `rowCount`" era a descrição errada da tarefa. Achou duas
lacunas na spec, ambas invisíveis em teste porque o dataset sintético inventa linha
para toda tabela e valor para toda coluna declarada.

**1. Sete tabelas não diziam de onde vinham as linhas.** No TMDL são
`partition = calculated` — a tabela **é** uma expressão DAX. O extrator lia só a
partition `= m`, então a spec gravava `query_ref: null` e mais nada. Três delas —
`CALENDARIO INSTALADO`, `calendar` e `Status Protocolo Dia` — são por onde o filtro
propaga na 2b.5: contra dado real nasceriam vazias, e vazio do lado que filtra não dá
erro, dá zero. Corrigido: campo `table_dax`, `model.calculatedTables`,
`validate:model` conferindo as 7 (passam limpas). A base tem **134 expressões DAX**,
não 127, e **56 funções**, não 54. Detalhes em ACHADOS.md #14.

**2. Existe uma camada M entre o SQL e a tabela** — 303 passos de Power Query. Ela
cria **56 colunas** do modelo (11 delas citadas pelo DAX) e **muda a contagem de
linhas em 11 das 17 tabelas**. Consequência direta: o `rowCount` do golden é a
contagem do SQL e só é comparável com o Power BI em **6** tabelas. Detalhes em
ACHADOS.md #15.

Ferramenta nova: `npm run validate:tables`. Rode antes de qualquer trabalho com dado
real — é ele que diz de onde vem cada coluna.

### 2b.7 — materializar as 7 tabelas calculadas: PRONTO

`packages/measure-engine/src/calculated.ts`. O dataset de teste agora carrega **só as
18 tabelas de query**; as 7 calculadas saem de avaliar o DAX delas, na ordem de
dependência. A medida do que isso destravou: **sem materializar, 46 das 127 expressões
param de executar** — e antes desta fase o número era zero, porque o dataset inventava
as linhas.

As **56 funções da base estão todas implementadas** (`CALENDAR` e `ADDCOLUMNS` foram as
duas últimas). O teste que afirmava o contrário virou o inverso, e o
`FUNCOES_SEM_IMPLEMENTACAO` que só existia como comentário virou asserção de verdade.

Quatro coisas que valem saber ao mexer nisto:

1. **`CALENDAR` é a única função que gera linhas** — todas as outras funções de data
   filtram o que já existe numa coluna. Com extremo BLANK ela **erra alto**, e é
   divergência deliberada do Power BI (registrada em ACHADOS.md, seção "Divergências
   deliberadas"): lá BLANK = 30/12/1899 e sairiam ~46 mil dias em silêncio.
2. **`ADDCOLUMNS` recusa tabela de origem nomeada.** Em DAX coluna acrescentada não tem
   linhagem, e `TableValue` não sabe dizer "estas colunas têm linhagem e aquelas não".
   Aceitar deixaria o resultado virar filtro por coluna inexistente no destino, o que
   zera medida em silêncio. A única chamada da base é sobre tabela anônima. Se aparecer
   uma sobre nomeada, o conserto é dar linhagem por coluna a `TableValue` — não relaxar
   a recusa.
3. **A materialização exige bijeção** entre coluna declarada na spec e coluna que o DAX
   devolve, casadas por `sourceColumn` (`[Date]` → `DATA INSTALADO`). As duas direções
   pegam erros diferentes; a segunda é a que pega coluna que o extrator perdeu.
4. **O tipo declarado é aplicado** ao materializar. `Status Protocolo Dia[Dia]` é
   `TRUNC(...)`, que devolve **número**, e se liga a uma coluna de **data**. Ver
   ACHADOS.md #16 — e não afrouxe o guarda de espécie da 2b.5 para "resolver" isso.

O grafo de dependência entre as 7 é **plano** (medido): todas dependem só de tabelas de
query. A ordenação topológica existe pelo que recusa — ciclo erra alto nomeando o
caminho. Se algum dia uma calculada passar a depender de outra, a ordem já funciona.

### 2b.8 — a camada M — EM CURSO. Opção A confirmada em 05/08/2026

**É o último bloqueio entre o avaliador e dado real.**

**O que já está pronto** (`packages/transform-engine/`, 36 testes):

| Arquivo | O que faz |
|---|---|
| `src/tokenizer.ts` | Léxico de M. As diferenças em relação ao DAX estão comentadas uma por uma — `--` **não** é comentário em M, `&` não tem irmão `&&`, `#"nome"` é identificador |
| `src/ast.ts` | Nós. Discriminante é `type`, igual ao DAX. O escopo é o que o corpus usa, medido sem strings — `try/otherwise`, faixa `..` e recursão `@f` não existem na base e não têm nó |
| `src/parser.ts` | Descendente recursivo, um nível por precedência do M |
| `test/parser.test.ts` | Sintaxe isolada **+ o corpus real**: as 24 `m_expression` do PBIP parseiam |

O teste de corpus é o que segura a fase: se o parser não lê a base, o resto não
existe. Ele achou um bug real no primeiro disparo — ver ACHADOS #18.

**Números medidos pelo parser** (e conferem com o levantamento): **327 passos** nas 24
queries, **303** nas 23 do escopo. Funções chamadas nas 23: **19 `Table.*` + 5 de fonte
+ 15 de valor = 39**.

**Também já está pronto** (mesma pasta, 115 testes no pacote):

| Arquivo | O que faz |
|---|---|
| `src/value.ts` | `MTable` com **ordem de coluna e de linha explícitas**, e `toDatasetRows` — a fronteira com o `Dataset` do avaliador de DAX (normaliza nome, converte `time` para a época 1899-12-30 do Power BI, recusa célula não-escalar) |
| `src/evaluator.ts` | Escopo do `let` com resolução preguiçosa por nome (M é mutuamente recursivo), ciclo com erro nomeado, `each` fechando sobre o ambiente, `[Coluna]` como campo do `_` |
| `src/functions.ts` | **34 das 39** funções que o corpus chama, mais allowlist de enums/tipos |
| `test/cobertura.test.ts` | Mede contra o corpus e **prende os números**: 39 chamadas distintas, 34 implementadas, e as 5 que faltam nominalmente |

**Também pronto:** `src/runner.ts` — o orquestrador. Resolve a citação entre queries
(`PROTOCOLOS GERAL` cita `#"GESTORES EQUIPES"` como se fosse variável), ordena por
dependência com ciclo nomeado, e busca as linhas **antes** de avaliar (ler fonte é
assíncrono, avaliar M é síncrono). E `culture`: o extrator agora lê `culture: pt-BR`
do `model.tmdl` para `specs/_catalog/model.yaml`, e é isso que permite converter
`"01/01/2022"` em data e `"7637491824"` em Int64 — sem a culture, o engine recusa, e
está certo.

**O que falta, e é o próximo bloco:**

1. **Ligar `Odbc.Query` e `GoogleSheets.Contents` nos connectors.** São as 2 únicas
   funções que faltam, e não são linguagem: são a fronteira com o Query Engine da Fase 1,
   que já sabe cache, timeout e read-only. O runner recebe `fonte` injetada — basta passar
   o Engine ali. Atenção: o connector de Google Sheets tem que devolver a **tabela de
   navegação** (uma linha por aba, dados na coluna `Data`), porque é assim que o M navega.
2. **Paridade contra dado real (2b.9).** `avaliaQuery` devolve o valor de **cada passo**
   de propósito: é o que permite comparar passo a passo com o Power Query quando um número
   divergir. Sem isso, "a tabela deu 33.104 em vez de 33.101" não tem onde ser investigado.
3. **ACHADOS #19** — `base-categorias-field` renomeia `categoria32`, que o SQL real não
   devolve. Precisa da operação para saber se é pivot variável ou query quebrada.

**Um teste que vale entender antes de mexer:** *"cada query do escopo para no primeiro
passo de fonte, e não antes"*. Ele avalia as 23 queries de verdade, sem credencial, e
exige que o **único** motivo de parada seja ler a fonte (ou citar outra query). Qualquer
outra parada é função ou semântica faltando, e aparece pelo nome. É o teste de execução
mais forte que dá para ter antes de existir connector.

**Ordem de trabalho definida pelo Erick:** seguir **sem** o Google Sheets e deixar
`PROTOCOLOS PRODUTIVIDADE` — a única tabela que depende de planilha — para a **última
etapa**. As outras 17 tabelas não dependem de nada pendente.

**Leia [DECISAO-CAMADA-M.md](./DECISAO-CAMADA-M.md) antes de continuar.** O
levantamento está lá, com números medidos no PBIP. O resumo do porquê da opção A:

- **3 das 15 mesclagens atravessam fonte de dados** (dbVoalle × dbMaria e
  dbVoalle × gsheets). Nenhum `SELECT` faz essas — a plataforma precisa de junção acima
  dos connectors de qualquer maneira.
- **SQL escrito à mão não tem onde morar** sem violar a regra 2: as specs de query são
  sobrescritas por `npm run extract`, e SQL humano ali diverge em silêncio no dia em que
  alguém mexer no Power Query do relatório.
- Tamanho: **23 funções de tabela + 15 de valor**, contra as 56 do avaliador de DAX.

**Não comece pelas 11 colunas.** 9 delas são renome puro — é a parte fácil, e fazê-la
primeiro dá sensação de progresso enquanto as **25 mudanças de linha**, que são o que
muda número de verdade, ficam de fora.

Três coisas que a decisão deixa em aberto e que valem confirmar antes de codar:

1. **A ordem do `Table.Distinct` de `PROTOCOLOS GERAL` não é derivável do M.** Um
   `Table.Sort` no passo 47, uma mesclagem que multiplica linha no 51, e um
   `Table.Distinct` por `SOLICITACAO` no 53 que mantém a **primeira** linha da ordem
   corrente. Qual supervisor fica preso a cada protocolo depende disso. Exige medição
   contra dado real, e possivelmente uma divergência deliberada documentada.
2. **`PROTOCOLOS PRODUTIVIDADE` está bloqueada** até existir connector de Google Sheets:
   a mesclagem com `quadro-funcional` é cross-source e um dos lados não é legível hoje.
   A autenticação de service account já existe e está testada
   (`packages/query-engine/src/google-auth.ts`); o que falta **não é código** — é a
   proprietária das planilhas conceder Leitor à conta de serviço
   (`npm run probe:gsheets` mostra o estado). Por decisão do Erick, esta tabela fica
   para o fim; não bloqueia as outras 17. Ver ACHADOS #17 e o Anexo B da decisão.
3. **`clima-tempo` segue fora** — `let` aninhado que o scanner recusa, e fonte `web` sem
   connector.

### 2b.9 — paridade medida a medida

Só depois da 2b.8. Todos os números de cobertura de hoje vêm de **dados
sintéticos**: eles provam que o avaliador roda, não que ele acerta. Não chame nada
disso de paridade, e mantenha a distinção que o README faz em todas as menções.

Cuidado concreto com datas: várias colunas chegam como texto `DD/MM/YYYY`.
**Não ordene nem compare direto** — foi exatamente esse erro que gerou o achado 1
falso. O avaliador já erra alto nessa comparação, com teste; não "facilite" a
conversão para fazer uma expressão passar.

Não tente fazer as 4 medidas que falham rodarem. As 3 do achado 6 não têm resultado
(tabela inexistente) e `[Faixa 1 Premiação Total]` depende de `ISINSCOPE`, que só o
Widget Engine responde (achado 12). Há teste **exigindo** que as quatro continuem
falhando. O alvo do avaliador é **74**; a 75ª chega com a Fase 3.

`gsheets` (3 queries) e `web` (1) só entram no `validate:queries` quando existirem
connectors para eles — hoje o harness só sabe executar SQL. A `clima-tempo` (web) é
também a única cujo M o scanner não lê: ela define função M com `let` aninhado.

## Como trabalhar

O Erick prefere **uma sessão de CLI por unidade de trabalho** — não arraste uma janela
de contexto gigante. Ao concluir uma fase ou entregável:

1. Commite com mensagem descritiva.
2. Atualize a tabela de fases no `README.md`.
3. Encerre a sessão e abra uma nova para o próximo bloco, usando este prompt.

Deixe o estado no **repositório** (specs, docs, testes, commits) — nunca só na conversa.
Escreva em **português**. Confirme antes de ações irreversíveis ou que publiquem algo.
