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

Escala: **25 tabelas, 78 medidas DAX, 49 colunas calculadas (também DAX),
22 relacionamentos, 14 páginas, 306 visuais, 24 queries**.

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

**249 testes verdes.** Rode `npm test` para confirmar antes de mexer em qualquer coisa.
Nenhum teste precisa de credencial ou banco.

| Fase | Escopo | Status |
|---|---|---|
| 0 | Extrator PBIP → specs | ✅ |
| 1 | Query Engine + Registry + cache | ✅ |
| — | Infra de conexão + doctor + guard read-only | ✅ |
| — | Validação contra dados reais — 18/18 queries capturadas em `specs/golden/` | ✅ |
| 2a | Modelo semântico completo + verificação de referências do DAX | ✅ |
| 2b.1 | Parser de DAX → AST — as 127 expressões da base parseiam | ✅ |
| 2b.2 | Avaliador: escalares e agregação — executa 59/127 | ✅ |
| 2b.3 | Contexto de filtro: `CALCULATE`, `FILTER`, `ALL` | ⏳ **próximo** |
| 2b.4 | Relacionamentos, time intelligence, funções de tabela | ⏳ |
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
npm test                              # suíte completa (249 testes, sem credencial)
npm run extract                       # regenera as specs a partir do PBIP
npm run validate:model                # o DAX referencia coisas que existem? (sem banco)
npm run doctor                        # configuração e conectividade (não imprime credencial)
npm run validate:queries              # executa as queries reais e grava os goldens
npm run validate:queries -- --check    # falha se o schema de alguma query mudou
```

Os quatro respondem perguntas diferentes: `npm test` = o código respeita as specs;
`validate:model` = o DAX aponta para tabelas/colunas que existem; `doctor` = as
fontes estão alcançáveis; `validate:queries` = as queries rodam e devolvem o quê.
Os dois primeiros dispensam `.env`.

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

Os 18 `rowCount` estão em `specs/golden/` e **ainda não foram conferidos contra os
números do Power BI**. O Erick pediu para seguir sem isso ("prossiga sem isso,
depois validaremos"). Continue — mas se um número divergir depois, a medida
construída sobre aquela query nasce errada, então **não trate paridade como
provada** até a conferência acontecer.

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

Inventário real, contado **sobre o AST** das 127 expressões (medidas + colunas
calculadas) — não por regex, que subcontava feio: dizia `IF:10` quando são 31:

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
**As 127 expressões da base parseiam** (78 medidas + 49 colunas calculadas) — é a
métrica de cobertura que vale, medida sobre o DAX real. Ver
`test/cobertura.test.ts`.

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

### 2b.3 — contexto de filtro: PRÓXIMO

`CALCULATE` está no caminho de **56 das 127** expressões — é o maior bloqueio
isolado, e o teste `'o que falta é liderado por CALCULATE'` mantém esse número
honesto.

O ponto de extensão já existe: `FilterContext` em `evaluator.ts`, hoje com a
implementação `UnfilteredContext` (devolve a tabela inteira). Toda agregação já
pergunta as linhas a ele, então `CALCULATE` entra por ali sem mexer em função de
agregação nenhuma.

Ordem, de menos para mais:

1. **`CALCULATE`** com filtro de coluna (`'T'[Col] = "x"`), depois `FILTER`,
   depois `ALL`. `FILTER` bloqueia 21 expressões; `ALL`, 4.
2. **`LOOKUPVALUE`** — 11 expressões, e é o que falta para
   `CALENDARIO INSTALADO[PESO]` rodar (ele consulta a tabela `FERIADOS`). Destrava
   as 8 medidas de projeção/média de uma vez.
3. **`SELECTEDVALUE`** (9) e **`VALUES`** (8).
4. **Relacionamentos** — `specs/_catalog/relationships.yaml`. Filtro propaga do
   lado `to_*` (one) para o lado `from_*` (many); `cross_filter: bothDirections`
   vai nos dois sentidos; `active: false` só vale dentro de `USERELATIONSHIP`.
   Sem isso, `Contagem Solicitacao 2026` (filtra `PROTOCOLOS GERAL` por
   `CALENDARIO INSTALADO`) não fecha.
5. **Time intelligence** — `DATESMTD`, `DATESBETWEEN`, `ENDOFMONTH`,
   `STARTOFMONTH`. Deixe para o fim: é onde mais se erra e depende de tudo acima.
6. **Tabelas e conjuntos** — `DISTINCT`, `SELECTCOLUMNS`, `TREATAS`, `INTERSECT`,
   `EXCEPT`, `UNION`, `CALCULATETABLE`, `AVERAGEX`, `RANKX`, `ISINSCOPE`. Aqui
   também entra `COUNTROWS` sobre expressão de tabela e `x IN <tabela>`, que hoje
   erram alto de propósito.
7. **Paridade** contra o Power BI. Aqui a conferência de `rowCount` pendente
   volta a importar — é ela que transforma "executa" em "está certo".

Cuidado concreto com datas: várias colunas chegam como texto `DD/MM/YYYY`.
**Não ordene nem compare direto** — foi exatamente esse erro que gerou o achado 1
falso. O avaliador já erra alto nessa comparação, com teste; não "facilite" a
conversão para fazer uma expressão passar.

Não tente fazer as 3 medidas mortas do achado 6 rodarem — elas não têm resultado.
O alvo é **75 medidas**.

`gsheets` (3 queries) e `web` (1) só entram no `validate:queries` quando existirem
connectors para eles — hoje o harness só sabe executar SQL.

## Como trabalhar

O Erick prefere **uma sessão de CLI por unidade de trabalho** — não arraste uma janela
de contexto gigante. Ao concluir uma fase ou entregável:

1. Commite com mensagem descritiva.
2. Atualize a tabela de fases no `README.md`.
3. Encerre a sessão e abra uma nova para o próximo bloco, usando este prompt.

Deixe o estado no **repositório** (specs, docs, testes, commits) — nunca só na conversa.
Escreva em **português**. Confirme antes de ações irreversíveis ou que publiquem algo.
