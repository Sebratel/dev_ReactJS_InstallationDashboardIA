# Desenvolvimento orientado a Specs (Spec-Driven)

Objetivo: **replicar o Power BI atual sem quebrar comportamento**. As specs congelam o
que o relatório faz hoje; o código novo é validado contra elas.

## Fonte da verdade

- **O relatório que esta plataforma substitui:** `INST - Relatório Instalação`.
  **Não é o `INST - Relatório Instalação Gerencial`** — são dois relatórios
  diferentes, e confundi-los troca o gabarito de paridade por outro. Ver
  "Qual relatório é o original" abaixo.
- **Base de referência (read-only):** a extração do PBIP em
  `../QUERIES-DASHBOARD-INSTALACAO/` (`m/`, `sql/`, `dax/`, `_meta.json`).
  **Nunca é modificada** — é insumo.

### Qual relatório é o original

O repositório carrega **dois nomes**, e isto está aberto:

| Onde | O que diz |
|---|---|
| `CLAUDE.md` | `INST - Relatório Instalação` |
| `../QUERIES-DASHBOARD-INSTALACAO/README.md` | extraído de `INST - Relatório Instalação Gerencial` |
| Erick, 27/08/2026 | *"é o dashboard de instalação e não o dashboard de instalação gerencial"* |

Vale a palavra do Erick para **o alvo**: é o de instalação. O que fica sem resposta é
se a extração de 11/08 saiu do PBIP certo — o nome do arquivo dela diz "Gerencial".

**Por que isso não é briga de nomenclatura.** As três tabelas em `bloqueadas` de
`specs/_catalog/paridade-janela.yaml` falham todas com a mesma cara — *"as duas
tabelas têm definições diferentes"*, *"formas incompatíveis"*, *"a base congelou"* —
e consultar um relatório diferente do nosso produz exatamente esse sintoma. Antes de
tratar qualquer uma delas como defeito da plataforma, confirme contra QUAL relatório
publicado o token mediu.

**O repositório não registra isso hoje**: `POWERBI_URL`, `POWERBI_REPORT_ID` e
`POWERBI_TENANT_ID` são lidos do `.env` (`tools/powerbi/src/index.ts:180-183`) e
não estão nem no `.env` nem no `.env.example`. Os números de `pbi:` em
`paridade-janela.yaml` não dizem de onde vieram.
- **Specs geradas:** `specs/` — extraídas automaticamente pelo `tools/extractor` e
  depois revisadas por humano. São versionadas no git.

## Edições à mão em spec gerada

`specs/_catalog/queries/*.spec.yaml` é **gerado** pelo `tools/extractor`, e o
cabeçalho de cada arquivo pede que toda edição à mão seja registrada aqui. Esta é a
lista.

### `field-agenda` — janela deslizante de 3 meses no `sql:` (27/08/2026)

```sql
-- era:  AND vsdspi.begin_date_slot >= DATE '2026-01-01'
-- é:    AND vsdspi.begin_date_slot >= (CURRENT_DATE - INTERVAL '3 months')
```

**Divergência de propósito**, não conserto de extração: o `m_expression` do PBIP
corta em `2026-01-01` e continua intocado no arquivo — é o registro do original.

**Isto é uma RESTAURAÇÃO.** A janela existia, foi perdida num `git reset --hard` de
outro agente em 26/08/2026 (o `sql:` voltou a ser o extraído) e foi refeita por
medição, não de memória:

1. `tools/probe/src/custo-incremental.ts:75-81` declara que `field-agenda` *"usa
   janela deslizante"* e casa o literal exato `(CURRENT_DATE - INTERVAL '3 months')`
   — a sonda ficou procurando um literal que ninguém mais escrevia;
2. o snapshot em disco foi gerado em **25/08/2026** e o mínimo de `slot agenda` é
   **2026-05-25** — 25/08 menos 3 meses, ao dia. As outras colunas de data descem
   mais (`data criado` vai a 2025-10-24), então o corte é neste campo e em nenhum
   outro;
3. nada em `tools/` ou `packages/` reescreve esse literal na carga, e o CLI do
   snapshot não tem flag de data (`--todas`, `--plano`, `--refazer`,
   `--sem-calculadas`, `--incremental`).

**O que isto evita.** Sem a janela, a próxima carga completa de `field-agenda`
buscaria ~8 meses em vez de 3 — numa query cujo grão é (slot, relato) e que já é a
mais cara do catálogo **com** o corte de 3 meses: **21 min 49 s** ponta a ponta
(ACHADOS #82, medido ao vivo em 02/09/2026, 642.365 linhas × 26 colunas), e é por
isso que ela continua fora de todo grupo de `specs/_catalog/refresh.yaml`. Triplicar
a janela numa query desse custo é a regressão silenciosa: número maior, sem erro.

> **A prova que acompanhava este parágrafo caiu; o argumento não.** Até 17/09/2026
> lia-se aqui que a última carga *"morreu com `ECONNRESET` após 38 min de colunas
> calculadas (`snapshot/field-agenda.erro.log`, 19/08)"*. **Esse arquivo não existe** —
> e o único outro `.erro.log` que a pasta ainda tinha, `protocolos-geral.erro.log` de
> 02/09, era resíduo morto do tempo em que faltava `mysql2` e **foi apagado em
> 17/09/2026**: aquela carga é das mais recentes do catálogo (95.442 linhas no
> `manifesto.json`). Hoje **não há `.erro.log` nenhum em `snapshot/`**, e isso é o
> estado normal — o arquivo só nasce quando `guardaErro` grava uma falha de
> materialização. E a carga de `field-agenda` não está mais morta: o `manifesto.json` a dá
> com **643.176 linhas × 26 colunas, geradoEm 2026-09-15**. A citação foi trocada pela
> medição do #82, que sustenta a mesma conclusão sem depender de um arquivo que sumiu.

**Ainda em aberto:** o lugar definitivo desta decisão é um
`specs/_catalog/sql-override.yaml` com `original_sha` da expressão M
(`docs/DECISAO-GRAO-FIELD-AGENDA.md`, seção 2). Ele não existe, e `npm run extract`
também não é um script hoje — então o risco de sobrescrita não está armado. Quando
qualquer um dos dois passar a existir, mova esta divergência para lá.

### `field-agenda-slot` — arquivo NOVO, não existe no PBIP (02/09/2026)

`specs/_catalog/queries/field-agenda-slot.spec.yaml` não é uma edição de arquivo
gerado — é um arquivo que `tools/extractor` nunca produziu e nunca vai apagar,
porque não corresponde a nenhuma query do PBIP. É a forma de GRÃO DE SLOT de
`field-agenda`: mesma origem (`vsdspi`), sem os `LEFT JOIN` de
`reports`/`people`/`skills` que multiplicam cada slot por (relato × skill) — ver
`docs/DECISAO-GRAO-FIELD-AGENDA.md` e ACHADOS #82/#85/#86/#87.

O SQL preserva a EXISTÊNCIA da linha com um `EXISTS` que repete os seis filtros de
`r.title` do `LEFT JOIN` original — sem isso, o corte traria slot A MAIS do que a
forma completa (o `LEFT JOIN` de `field-agenda` é, na prática, um `INNER JOIN`: o
`WHERE` rejeita linha com `r.title` nulo). `specs/_catalog/projecao.yaml`, bloco
`grao_reduzido`, declara qual tabela usa qual das duas por padrão e o que escala
para a completa.

**Risco igual ao do item anterior, ainda sem `sql-override.yaml`.** Se algum dia
`npm run extract` passar a apagar arquivo de query que ele não reconhece (hoje não
apaga — ele só sobrescreve o que já existia), este arquivo precisa da mesma
proteção. Registrado aqui para não se perder no meio tempo.

### `clima-tempo` — guarda de nulo antes da classificação de chuva (03/09/2026)

```
-- era:  comClassificacao = Table.AddColumn(comTipo, "Classificacao_Chuva", each
--       if [Precipitacao_mm] = 0 then "Sem chuva" ...
-- é:    semNulos = Table.TransformColumns(comTipo, {{"Precipitacao_mm", each if _ = null then 0 else _, type number}}),
--       comClassificacao = Table.AddColumn(semNulos, "Classificacao_Chuva", each
--       if [Precipitacao_mm] = 0 then "Sem chuva" ...
```

**Conserto de defeito, não divergência de propósito.** A API `open-meteo` volta
`precipitation_sum: null` para algum dia (histórico incompleto ou ponta da janela de
previsão), e `if [Precipitacao_mm] = 0` com `[Precipitacao_mm]` nulo dá `null`, não
`false` — nosso interpretador de M exige lógico e ERRA ALTO (`"A condição do if deu
null, e M exige logical (true/false)"`), corretamente: é o mesmo comportamento que o
Power BI real teria com essa expressão. O defeito é do M original, não da nossa
leitura dele.

**Como foi achado.** `clima-tempo` era a materialização mais antiga do snapshot
inteiro (`2026-08-07T19:12:54.718Z`) — 27 dias parada — e era ela quem definia o
"dado desatualizado" na tela de `agendamento-field`, que usa `Clima/ Tempo` entre
suas `entities_used`. `clima-tempo` **não estava** em `refresh.yaml` (era uma das "7
fontes nunca medidas isoladamente", risco já registrado lá), então a única forma de
perceber a quebra era rodar `--refazer` à mão — o que aparentemente não acontecia
há 27 dias.

> **Essa última frase caiu em 09/09/2026** (`957e2e4`, ACHADOS #104), e este parágrafo
> só foi alinhado em 17/09. `clima-tempo` entrou no grupo `frio` de
> `specs/_catalog/refresh.yaml` — **7.267 ms** medidos ao vivo, 1.869 linhas, 14
> chamadas à Open-Meteo — e hoje roda a cada 30 min. Entrou primeiro entre as 7 fontes
> justamente porque é a **única** query do catálogo cujo conteúdo caduca sozinha: a
> previsão é uma janela de ~16 dias que anda todo dia, e sem cadência ela envelhece até
> o visual de previsão esvaziar (estava 6 dias parada quando isso foi descoberto).
> O diagnóstico acima continua valendo para explicar **por que ninguém percebeu os 27
> dias**; o que não vale mais é a conclusão operacional — não depende mais de alguém
> lembrar de rodar `--refazer` à mão. Reproduzido com `node tools/snapshot/src/index.ts --query=clima-tempo
--refazer`, que falhou em 6,5s com o erro acima antes do conserto e teve sucesso
(1.827 linhas, 6,46s) depois.

**Cuidado operacional achado ao testar o conserto**: `--refazer` de uma query cuja
materialização avança o carimbo "mais recente" do snapshot dispara, sozinho, o
recongelamento automático das tabelas calculadas afetadas
(`tools/snapshot/src/calculadas.ts --todas`) — e esse recongelamento usa nomes de
arquivo fixos em `snapshot/_parciais/` (`status-protocolo-dia.0.jsonl` etc.), sem
namespacing por processo. Rodar DOIS `--refazer` em paralelo (o que fiz, sem saber
disso, testando `clima-tempo` e o grupo `quente` de `refresh.yaml` ao mesmo tempo)
faz as duas recongelações colidirem no mesmo arquivo temporário e uma delas morre
com `ENOENT`. **Não é bug de produção** — `tools/refresh/src/index.ts` já documenta
que nenhum tick roda em paralelo com outro por design; o gatilho externo (Agendador
de Tarefas) é quem garante isso. É risco só para quem, como eu, roda `--refazer` à
mão em duas janelas ao mesmo tempo. Registrado para o próximo que fizer o mesmo.

### `protocolos-geral` — desempate do `ROW_NUMBER` + `EXISTS` no lugar do `LEFT JOIN` financeiro (04/09/2026)

```sql
-- era:  ROW_NUMBER() OVER (PARTITION BY a.title ORDER BY s.start_date DESC) AS PERSONA1,
--       CASE WHEN frt.title IS NULL THEN 'Pendente' ELSE 'Cobrado' END AS "STATUS FINANCEIRO"
--       ...
--       LEFT JOIN financial_receivable_titles frt ON c.id = frt.contract_id
--
-- é:    ROW_NUMBER() OVER (
--           PARTITION BY a.title
--           ORDER BY (ac.active IS TRUE) DESC,
--                    ((ac.contract_id = cst.contract_id) IS TRUE) DESC,
--                    s.start_date DESC NULLS LAST,
--                    ac.created DESC NULLS LAST, ac.id DESC NULLS LAST
--       ) AS PERSONA1,
--       CASE
--           WHEN EXISTS (
--               SELECT 1 FROM financial_receivable_titles frt
--               WHERE frt.contract_id = c.id AND frt.title IS NOT NULL
--           ) THEN 'Cobrado'
--           ELSE 'Pendente'
--       END AS "STATUS FINANCEIRO"
--       (LEFT JOIN financial_receivable_titles removido)
```

**Divergência de propósito, não conserto de extração** — o PBIP original não tem
critério de desempate nenhum, e não há "comportamento original" para restaurar: o
`ROW_NUMBER` já era arbitrário no relatório de origem, só que ninguém tinha
percebido. É decisão de negócio nova.

**O defeito, medido:** `a.title` (SOLICITACAO) tem mais de uma linha candidata
sempre que a cadeia `people_addresses → authentication_contracts →
authentication_access_points` multiplica o cliente por endereço/contrato de
autenticação, e o `ORDER BY s.start_date DESC` empata sempre que os candidatos têm
o mesmo agendamento (ou nenhum). Rodando o SQL de produção duas vezes no MESMO
snapshot de transação (`REPEATABLE READ READ ONLY`): **14.090 de 98.110
solicitações (14,4%) mudavam de valor** em USUÁRIO, CTO, PONTO DE ACESSO, CODIGO,
OLT, EQUIPAMENTO, SLOT, PORTA, LATITUDE, LONGITUDE. `l-mapa` **não** plota nada
disso — é um `Tooltip` oculto sem essas colunas, e nenhuma das 14 páginas usa
LATITUDE/LONGITUDE (o projeto não tem biblioteca de mapa). O impacto real,
visível, é a tabela da página VISÃO GERAL: `EQUIPAMENTO1` e `CONEXÃO` (USUÁRIO)
mudavam de valor ali entre refreshes. Ver `docs/ACHADOS.md` #97.

**A regra, decidida por Erick em 04/09/2026 (`ACTIVE TRUE`):** preferir o registro
de `authentication_contracts` com `active = true` (achado ao vivo: um cliente com
4 contratos `active=true` em 4 endereços diferentes, acumulados de 2024 a 2026 —
dado do ERP, não erro da consulta).

#### O resíduo: `ac.contract_id`, não recência (medido em 04/09/2026)

**Correção de unidade primeiro.** A versão anterior deste parágrafo dava "247.668
solicitações com partição múltipla, 13.193 (5,3%) com mais de um ativo". Esses
números foram medidos sobre o **leque de linhas**, não sobre a **partição do
`ROW_NUMBER`**, que é `a.title`. Na unidade certa — protocolo, que é a que decide
o valor na tela:

| | protocolos |
|---|---:|
| no recorte (`it.id IN (...)`, `a.created >= '2025-01-01'`) | 98.204 |
| com leque (mais de uma linha candidata) | 44.746 |
| **ambíguos depois de `active=true`** | **4.407** (9,8% do leque) |

**A regra secundária não precisava ser inventada — o SQL já sabia a resposta e não
usava.** O leque nasce porque `people_addresses`/`authentication_contracts` entram
pela **pessoa** (`pa.person_id = p.id`), o que traz todos os endereços do cliente.
Mas o mesmo bloco já junta `cst`/`c` pelo **próprio incidente**
(`cst.id = ai.contract_service_tag_id`), e `authentication_contracts` **tem coluna
`contract_id`**. Casar os dois é perguntar "qual destes contratos de autenticação é
do contrato DESTE protocolo?" — semântica, não recência.

Medido sobre os 44.746 com leque:

| regra | resolve sozinha | não casa nenhum | casa vários |
|---|---:|---:|---:|
| `ac.contract_id = cst.contract_id` | 24.756 (55,3%) | 19.924 (44,5%) | 66 (0,1%) |

**Por isso ela é secundária e não primária:** em 44,5% dos protocolos com leque
nenhum contrato de autenticação casa com o contrato do protocolo, e uma regra que
não decide em quase metade dos casos não pode ser a primeira.

Aplicada ao resíduo de 4.407 que `active=true` deixa ambíguo:

| | protocolos |
|---|---:|
| resolvidos por casar contrato | **3.935** |
| nenhum ativo casa o contrato | 413 |
| continuam ambíguos (vários ativos casam) | 59 |

**O número que autoriza a mudança, e é o que importa:** nos **20.821** protocolos
em que as duas regras decidem sozinhas (exatamente 1 ativo *e* exatamente 1 que
casa contrato), elas apontam para linhas diferentes em **0**. Zero. Acrescentar a
regra do contrato **não pode mudar nenhum valor que `ACTIVE TRUE` já resolvia** —
ela só corta o resíduo em 89% (4.407 → 472).

`s.start_date DESC` (o critério do PBIP original) e `ac.created DESC` seguem
abaixo dela, agora decidindo **472 protocolos em vez de 4.407**. `ac.id DESC` no
fim é o piso de determinismo, para o empate teórico de timestamp.

**Erick delegou esta escolha explicitamente** ("não sei, decida por mim",
04/09/2026). O que fiz com a delegação: procurei no banco antes de assumir, e a
recência caiu de regra principal do resíduo para último recurso de 0,5% dos
protocolos com leque.

**Medida e recusada, com o número:** `ac.service_tag_id = ai.contract_service_tag_id`
é mais específica (tag de serviço é item dentro do contrato) mas resolve **menos**
— 14.086 sozinha contra 24.756 — e só alcançaria os 66 casos de "casa vários".
Não entrou: dois termos a mais no `ORDER BY` para 0,1% dos protocolos, sem medição
de concordância com a regra do contrato. Fica registrado para quem quiser os 66.

**Conferido:** `npm run probe:determinismo-pg` — mesmo SQL, mesma transação,
duas execuções, **0 solicitações divergentes** (era 14.090). E o caso mais
extremo do banco (solicitação com 4 contratos `active=true` simultâneos)
escolhe o mesmo ponto de acesso em 3 execuções seguidas.

**A reescrita do financeiro, junto porque tinha o MESMO bloqueio.** O `LEFT JOIN
financial_receivable_titles` existia para um teste de existência
(`frt.title IS NULL`), custava 3,1x a consulta inteira (77,1 s de Seq Scan,
16,5 M linhas para checar 98 mil), e `frt.title` é **NULL em 0 de 16.563.491
linhas** — "não casou" e "casou com título nulo" não são estados distinguíveis
nesta base, então `EXISTS` é semanticamente exato. Não podia entrar antes de
desempatar o `ROW_NUMBER` porque o `LEFT JOIN` também multiplicava a partição —
tirá-lo mudava qual linha "ganhava" o sorteio, e a diferença medida era
exatamente as mesmas 10 colunas. Substituição de `docs/sql/protocolos-geral-exists.sql`,
que fica marcado como incorporado.

**Medido, SQL completo (antes vs depois), sem cache do plano (duas execuções
sucessivas, a segunda mais rápida por buffer quente):** 137,9 s (LEFT JOIN,
sorteando) → 56,0 s / 31,6 s (EXISTS + desempate, determinístico). Ver
`docs/ACHADOS.md` #97.

### `protocolos-produtividade` — M reduzido ao join de `GESTOR`; o resto já vem do `sql:` (10/09/2026)

```diff
- Fonte = Odbc.Query(...)
- #"Linhas Filtradas" = Table.SelectRows(Fonte, each true),
- #"Hora Inserida1" = Table.AddColumn(..., each DateTime.Time([DATA CRIADO]), type time),
- #"Colunas Renomeadas3" = Table.RenameColumns(..., {{"Hora", "HORA CRIADO"}}),
- ... (~57 passos: proper-case de cidade/bairro, sigla, split de CODIGO/CTO, e as
-       mesclagens com ALOCAÇÃO PATRIMONIO / TROCA ENDEREÇO / TECNICOS AUXILIARES,
-       o Table.Combine com PROTOCOLOS AUXILIARES) ...
- #"Consultas Mescladas3" = Table.NestedJoin(..., {"TECNICO"}, #"QUADRO FUNCIONAL", {"upper_name"}, ...),
- #"QUADRO FUNCIONAL Expandido" = Table.ExpandTableColumn(...),
- #"Colunas Renomeadas11" = Table.RenameColumns(..., {{"TECNICO", "INSTALADOR"}})
+ Fonte = Odbc.Query(...)
+ #"Consultas Mescladas3" = Table.NestedJoin(Fonte, {"INSTALADOR"}, #"QUADRO FUNCIONAL", {"upper_name"}, "QUADRO FUNCIONAL", JoinKind.LeftOuter),
+ #"QUADRO FUNCIONAL Expandido" = Table.ExpandTableColumn(#"Consultas Mescladas3", "QUADRO FUNCIONAL", {"GESTOR"}, {"GESTOR"})
```

Corrige o Bloqueio 1 do achado #81 (`docs/ACHADOS.md`): o `sql:` migrado em
25/08/2026 já entrega as 47 colunas prontas — inclusive `HORA CRIADO`,
`HORA AGENDA` e `INSTALADOR` —, e o M **também** tentava derivar as mesmas
colunas do zero, sem remover as versões vindas do SQL antes. O avaliador parava
na primeira colisão (`Table.RenameColumns: o nome 'HORA CRIADO' ficaria
duplicado`) e nunca chegava nem perto da segunda ou da terceira.

`GESTOR` é a única coisa que o `sql:` não entrega (Google Sheets, via
`QUADRO FUNCIONAL`, comentário no fim do próprio `SELECT`) — é o único passo
que sobrou. Verificado rodando o `m_expression` de verdade (`runQueries`) com
dado sintético no lugar do `Fonte`/`QUADRO FUNCIONAL`: sem colisão, `GESTOR`
casa como antes, `LeftOuter` não derruba a query quando não casa. Detalhe
completo, incluindo o que o conserto EXPÕE (golden desatualizado desde a
migração, três testes vermelhos até ele ser regravado) em `docs/ACHADOS.md` #105.

### `protocolos-telefonia` — 46 passos de M viraram o `sql:`; sobraram 5 (16/09/2026)

```diff
- Fonte = Odbc.Query("dsn=dbVoalle", "<cópia de 5.169 caracteres do sql:>"),
- #"Hora Inserida1" ... #"Colunas Renomeadas3"        (HORA CRIADO)
- #"Colocar Cada Palavra Em Maiúscula"                (Text.Proper de CIDADE/BAIRRO)
- #"Coluna Duplicada" ... #"Valor Substituído8"       (as nove trocas de SIGLA CIDADE)
- #"Coluna Mesclada Inserida" ... #"Valor Substituído10"  (INDICE 2 e as duas correções)
- #"Texto em Maiúscula" ... #"Valor Substituído11"    (RESPONSÁVEL)
- #"Hora Inserida" ... #"Colunas Renomeadas1"         (HORA AGENDA)
- #"Tipo Alterado" / #"Tipo Alterado1"                (type date nas três datas)
- #"Dividir Coluna por Delimitador" ... #"Prefixo Adicionado"   (POP e VLAN)
- #"Valor Substituído12..15"                          (nulo -> "Sem Informação")
- #"Texto Extraído Após/Antes o Delimitador"          (CTO)
- #"Colunas Reordenadas" / #"Colunas Reordenadas1"    (a ordem final das colunas)
- #"Linhas Filtradas1"                                (STATUS <> "Cancelado")
- #"Personalização Adicionada"                        (SITUAÇÃO)
- #"Colunas Renomeadas4"                              (DATA ENCERRRADO -> DATA MODIFICADO)
+ Fonte = Odbc.Query("dsn=dbVoalle", "o SQL desta query é o campo `sql:` desta spec"),
  #"DATA HOJE"        = Table.AddColumn(Fonte, "DATA HOJE", each DateTime.LocalNow()),
  #"DATA HOJE em data" = Table.TransformColumnTypes(..., {{"DATA HOJE", type date}}),
  #"TMA"              = Table.AddColumn(..., "TMA", each Duration.Days(...), Int64.Type),
  #"DATA ENCERRADO"   = Table.AddColumn(..., "DATA ENCERRADO", each if [SITUAÇÃO] = "Finalizado" ...)
```

**O que sobrou, e por quê.** `DATA HOJE` é `DateTime.LocalNow()`, que nesta
plataforma devolve o relógio **injetado** (`ctx.agora`, `functions.ts`). Mandá-lo
para o PostgreSQL entregaria o relógio ao banco, e `diaDoCalculo` faz parte da
chave de cache — a mesma pergunta deixaria de ter a mesma resposta. `TMA` depende
dele. `DATA ENCERRADO` não depende, e caberia no SQL: fica em M só porque a ordem
das colunas é observável no snapshot e no M ela é a última.

**A prova.** `npm run probe:compara-materializacao` entre a materialização com a
spec anterior e com esta, as duas com o avaliador já corrigido (#126):

```
antes ..... 640 linhas, 42 colunas       depois .... 640 linhas, 42 colunas
colunas ... as 42 são as mesmas, e na mesma ordem: sim
chaves .... 640 em comum, 0 só de um lado
valor ..... ✅ as 42 colunas batem em TODAS as chaves
```

**Três coisas que a tradução ao pé da letra teria errado**, e que só apareceram por
conferir cada passo contra o avaliador antes de escrever SQL:

| passo | a armadilha |
|---|---|
| `DateTime.Time` | devolve `MTime`, e `toDatasetRows` o converte para `Date` sobre **1899-12-30**. Um `::time` puro chega como string: a coluna troca de `date` para `string` em 640 de 640 linhas, com o mesmo texto na tela. Daí o `DATE '1899-12-30' +`. |
| `Text.Combine` | trata **nulo como vazio** (`{null,"POA"}` → `"/POA"`), e `NULL \|\| '/' \|\| 'POA'` é `NULL`. Daí os `COALESCE` de `INDICE 2`. |
| `[STATUS] <> "Cancelado"` | em M, `null <> "x"` é **true**; em SQL é `NULL`, e a linha sairia. Daí `IS DISTINCT FROM`. |

**O mapa CIDADE→SIGLA não virou duas cópias.** No M ele era uma só (a cadeia
produzia `SIGLA CIDADE` e `INDICE 2` lia a coluna). A tradução direta repete a
cadeia inteira dentro de `INDICE 2` — foi o que o primeiro rascunho fez, e é o que
`protocolos-produtividade` tem hoje. O CTE `derivado` preserva a cópia única;
`siglas-cidade.test.ts` trava isso em `1`.

**Ganho não previsto:** `PROTOCOLOS TELEFONIA` saiu da lista de tabelas cujo
`rowCount` do golden não é comparável com o Power BI (11 → 10). O filtro que a
tornava incomparável agora é o `WHERE` da consulta.

## Estrutura de `specs/`

```
specs/
  _catalog/
    datasources.yaml          # dbVoalle, dbMaria, gsheets (SEM credenciais)
    relationships.yaml        # 22 relacionamentos + cardinalidade e direção do filtro
    queries/*.spec.yaml       # cada consulta (SQL + colunas + source_tables + cache)
    tables/*.spec.yaml        # 25 tabelas: colunas, tipos, e o DAX das calculadas
    measures/*.spec.yaml      # 78 medidas DAX
  dashboards/*.spec.yaml      # 14 páginas: layout, visuais, filtros, medidas usadas
  golden/*.golden.json        # GERADO por validate:queries — linha de base contra
                              # dados reais (forma + agregados, SEM linhas)
  EXTRACTION-REPORT.md        # gerado: contagens e alertas do extrator
```

### O que conta como DAX na spec

São **três** lugares, não um. Ignorar qualquer um deles quebra a paridade:

| Onde | Qtd | Por quê importa |
|---|---|---|
| `measures/*.measures.yaml` → `dax` | 78 | as medidas propriamente ditas |
| `tables/*.spec.yaml` → `columns[].dax` | 49 | coluna calculada é DAX. `CALENDARIO INSTALADO[PESO]` carrega a regra de dia útil que 8 medidas somam |
| `relationships.yaml` | 22 | define para onde o filtro propaga. Sem isso, medida que cruza tabelas não pode ser avaliada |

Total a reimplementar: **127 expressões** (78 + 49).

Duas armadilhas do TMDL, as duas já corrigidas e travadas por teste — ambas
faziam a spec sair **plausível e incompleta**, que é o pior resultado possível:

1. A cerca ``` ``` ``` que delimita expressão multi-linha **não é DAX** e não pode
   aparecer nas specs.
2. `column 'Nome Citado' =` com o corpo indentado abaixo (nada depois do `=`) é
   coluna calculada. Ler isso como nome sem expressão custou 6 colunas, 4 delas
   usadas em visuais ao vivo.

Se qualquer uma reaparecer, o extrator regrediu — ver [ACHADOS](./ACHADOS.md) #8.

## Regras

1. Toda query/medida/página nova referencia sua spec por `id`.
2. Uma spec só muda com justificativa registrada (é o "diff de contrato").
3. `source_tables` de cada query alimenta o Query Invalidator do real-time.
4. Melhorias sobre o Power BI são bem-vindas, mas entram como **campo adicional** na
   spec (`improvements:`), preservando o comportamento original para comparação.

## Ciclo por fase

```
extrair spec  ──►  implementar contra a spec  ──►  testar paridade vs golden  ──►  fase fecha
```

Nenhuma fase avança sem testes verdes de paridade.

## Os quatro níveis de verificação

Eles respondem a perguntas diferentes e não se substituem:

| Comando | Pergunta que responde | Precisa de `.env`? |
|---|---|---|
| `npm test` | O código respeita as specs? | não |
| `npm run validate:model` | O DAX aponta para tabelas/colunas que existem? | não |
| `npm run doctor` | As fontes existem e estão alcançáveis? | sim |
| `npm run validate:queries` | As 18 queries SQL rodam e devolvem o quê? | sim |

O `validate:model` responde *quais medidas são reimplementáveis*. Hoje: **75 de
78** — três referenciam uma tabela que não existe no modelo e não têm resultado
nem no Power BI atual (ver [ACHADOS](./ACHADOS.md) #6). Descobrir isso por
varredura custa segundos; descobrir no meio da Fase 2b custa depurar um
avaliador procurando um bug que está no PBIP.

O `validate:queries` fecha o vão entre "conecta" e "os números batem": grava em
`specs/golden/` a forma e os agregados de cada resultado — e é o `rowCount` de lá
que se compara com o Power BI. Ver
[specs/golden/README.md](../specs/golden/README.md), inclusive por que esses
arquivos não guardam as linhas.

## Comandos

```bash
npm run extract                       # gera/atualiza specs/ a partir do PBIP
npm run test:extractor                # valida o extrator (contagens e parsing)
npm run test:model                    # valida o modelo semântico e o scanner de refs
npm run validate:model                # confere as referências do DAX (sem banco)
npm run validate:queries              # captura os goldens contra dados reais
npm run validate:queries -- --check    # falha se o schema de alguma query mudou
```
