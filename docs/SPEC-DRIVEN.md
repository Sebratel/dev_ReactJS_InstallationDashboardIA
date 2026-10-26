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
`backend/specs/_catalog/paridade-janela.yaml` falham todas com a mesma cara — *"as duas
tabelas têm definições diferentes"*, *"formas incompatíveis"*, *"a base congelou"* —
e consultar um relatório diferente do nosso produz exatamente esse sintoma. Antes de
tratar qualquer uma delas como defeito da plataforma, confirme contra QUAL relatório
publicado o token mediu.

**O repositório não registra isso hoje**: `POWERBI_URL`, `POWERBI_REPORT_ID` e
`POWERBI_TENANT_ID` são lidos do `.env` (`backend/tools/powerbi/src/index.ts:180-183`) e
não estão nem no `.env` nem no `.env.example`. Os números de `pbi:` em
`paridade-janela.yaml` não dizem de onde vieram.
- **Specs geradas:** `backend/specs/` — extraídas automaticamente pelo `backend/tools/extractor` e
  depois revisadas por humano. São versionadas no git.

## Edições à mão em spec gerada

`backend/specs/_catalog/queries/*.spec.yaml` é **gerado** pelo `backend/tools/extractor`, e o
cabeçalho de cada arquivo pede que toda edição à mão seja registrada aqui. Esta é a
lista.

### `gestores-equipes` — Installation_Teams (parada em 16/07/2025) → team_capacities (14/10/2026)

A fonte era `DB_Applicattion.Installation_Teams`, cópia da planilha de capacidade que parou de
ser atualizada em 16/07/2025; agora é `DB_InstallationDashboard.team_capacities` (n8n, mesma
planilha). O `sql:` devolve as colunas com os nomes antigos e `COALESCE(…, '')` nas de texto,
porque a tabela antiga guardava vazio como `''` e o M troca `''` por TERCEIROS no gerente. O M
não mudou. Diverge do Power BI de propósito (ele segue lendo a tabela parada). ACHADOS #211.

### `quadro-funcional`, `capacidade-equipe`, `apuracao-premiacao` — Google Sheets → MariaDB (14/10/2026)

A fonte das três era a planilha do Google; agora é o `DB_InstallationDashboard`
(`employee_managers`, `team_capacities`, `installer_awards`), que o n8n preenche a cada
15 min a partir da MESMA planilha (`backend/tools/banco/n8n/`). O `sql:` devolve as colunas
com os nomes da planilha, então o M segue o de antes, menos a navegação de aba, o
`PromoteHeaders` e o `RemoveColumns` de colunas que não chegam mais. O `quadro-funcional`
chega com 2 colunas em vez de 38 — CPF, RG e o resto de RH ficam na planilha. Conferido
contra o snapshot do Google no mesmo dia: premiação e capacidade idênticas (hash dos blocos),
quadro 538/540 linhas iguais (o snapshot do Google era de 07/10). ACHADOS #209.

### Seis queries — o histórico vai no máximo até o início do ano anterior (24/10/2026)

Decisão do Misael: "não precisamos de históricos muito antigos, no máximo 1 ano para
trás". O piso fixo `'2025-01-01'` virou `(DATE_TRUNC('year', CURRENT_DATE) - INTERVAL
'1 year')` no `sql:` de `protocolos-geral`, `protocolos-telefonia`, `protocolos-tipo`,
`alocacao-patrimonio` e `troca-endereco`, e `tc.capacity_date > '2024-12-31'` virou
`>= MAKEDATE(YEAR(CURDATE()) - 1, 1)` em `gestores-equipes` (MariaDB). O texto dentro do
`Odbc.Query` do M não mudou: ele só nomeia o passo.

**Por que o ano anterior inteiro, e não 12 meses corridos.** O Relatório do Ano compara
"até hoje" com o "mesmo período do ano anterior" — de 1º/jan do ano passado até o dia de
hoje do ano passado. Com 12 meses corridos (desde out/2025) esses cards comparariam com
um ano quase vazio: número errado e plausível. Com o ano anterior inteiro nenhum relatório
muda, e o histórico para de crescer — hoje o piso ainda é 2025-01-01; em 2027 vira
2026-01-01 e 2025 sai.

Mudaram junto, porque repetem o texto: o piso do histórico congelado
(`historico-congelado.ts`), as costuras do poller (`realtime-poll.yaml`) e do ao vivo
(`ao-vivo.yaml`), e a sonda `paridade-divisao.ts`. Conferido no banco, versão antiga e nova
ao mesmo tempo: as cinco menores linha a linha iguais; a `protocolos-geral` com as mesmas
100.870 linhas e diferença só em TECNICOS AUXILIARES.AUXILIAR e HR. ALOCAÇÃO — a mesma
que a versão antiga tem contra ela mesma (empate, ACHADOS #241).

### `protocolos-produtividade` — a mescla com TECNICOS AUXILIARES volta para o M (24/10/2026)

A junção `LEFT JOIN auxiliar ax ON ax._chave = u._chave` era 434 dos 469 s da consulta
(`EXPLAIN ANALYZE`, 22/10/2026): o planejador estima `bruto` em ~11 mil linhas onde há
dezenas de milhares e escolhe Nested Loop sobre CTE Scan (88 mil × 40 mil leituras). A
cerca `MATERIALIZED` de 12/09 tirou o `regexp_replace` de dentro do par, mas não a
estimativa, e não há como corrigi-la sem `SET` na sessão. Então a mescla voltou para onde
o relatório original a fazia — o M, que mescla por hash:

- o `sql:` perdeu o CTE `auxiliar` e a junção, e passou a entregar `_RAMO` e
  `_CHAVE AUXILIAR` (a MESMA chave inteira de antes, calculada em `unificado`) no lugar de
  `TECNICOS AUXILIARES.AUXILIAR` e `INSTALADOR`;
- o M tipa a chave, mescla com `tecnicos-auxiliares` (mesma regra do CTE: RAUX do ano, o
  relato mais recente por protocolo; "PROTOCOLO:" já é Int64 lá) e monta as duas colunas
  com as regras que estavam no SELECT final.

O ano inteiro: **43 s** (`validate:queries`) contra 469 s. `docs/sql/datahub-protocolos-
produtividade.sql` segue igual ao `sql:` (o teste de `incremental.test.ts` trava). A costura
incremental não mudou: as âncoras são a abertura de `bruto` e o filtro de `a.created`.
ACHADOS #239.

### `quadro-funcional` — o GESTOR sai da Senior, não da planilha (23/10/2026)

Decisão do Misael: o gestor da Premiação e do Diário (`PROTOCOLOS PRODUTIVIDADE[GESTOR]`,
que a mescla de `protocolos-produtividade` traz daqui por `upper_name`) vem de
`API_WebDeveloper.db_senior_collaborators`, a tabela que o fluxo n8n "Senior G5 — Sync
Colaboradores" mantém; a planilha (`employee_managers`) deixa de ser lida. O `sql:`:

- **um registro por nome** (`ROW_NUMBER() OVER (PARTITION BY TRIM(name))`): a Senior tem
  131 nomes repetidos, e nome repetido multiplicaria linha na mescla. Vale o ativo
  (`termination_date` nulo), depois o que tem líder, depois a admissão mais nova;
- **GESTOR = o líder imediato na árvore**: `supervisor_name`; sem ele, `coordinator_name`;
  sem os dois, `manager_name`.

O `Table.SelectRows` nos três nomes da planilha saiu (a Senior escreve o nome completo em
maiúsculas; o filtro zeraria tudo). Conferido no banco em 23/10: 2.521 linhas, 2.521
`upper_name` distintos, 50 gestores. A conta MariaDB da stack precisa de `SELECT` em
`API_WebDeveloper.db_senior_collaborators`. `capacidade-equipe` e `gestores-equipes` (a
planilha de capacidade, de onde saem a capacidade e o `TÉCNICO 2`) continuam como estão: a
Senior não tem esse dado. ACHADOS #237.

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

1. `backend/tools/probe/src/custo-incremental.ts:75-81` declara que `field-agenda` *"usa
   janela deslizante"* e casa o literal exato `(CURRENT_DATE - INTERVAL '3 months')`
   — a sonda ficou procurando um literal que ninguém mais escrevia;
2. o snapshot em disco foi gerado em **25/08/2026** e o mínimo de `slot agenda` é
   **2026-05-25** — 25/08 menos 3 meses, ao dia. As outras colunas de data descem
   mais (`data criado` vai a 2025-10-24), então o corte é neste campo e em nenhum
   outro;
3. nada em `backend/tools/` ou `backend/packages/` reescreve esse literal na carga, e o CLI do
   snapshot não tem flag de data (`--todas`, `--plano`, `--refazer`,
   `--sem-calculadas`, `--incremental`).

**O que isto evita.** Sem a janela, a próxima carga completa de `field-agenda`
buscaria ~8 meses em vez de 3 — numa query cujo grão é (slot, relato) e que já é a
mais cara do catálogo **com** o corte de 3 meses: **21 min 49 s** ponta a ponta
(ACHADOS #82, medido ao vivo em 02/09/2026, 642.365 linhas × 26 colunas), e é por
isso que ela continua fora de todo grupo de `backend/specs/_catalog/refresh.yaml`. Triplicar
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

**Fechado:** o `sql-override.yaml` que a `DECISAO-GRAO-FIELD-AGENDA.md` previa **não
deve existir** — a solução foi spec de query própria (aviso do topo daquele documento).
`npm run extract` também não é mais um script, então o risco de sobrescrita não existe.

### `field-agenda-slot` — arquivo NOVO, não existe no PBIP (02/09/2026)

`backend/specs/_catalog/queries/field-agenda-slot.spec.yaml` não é uma edição de arquivo
gerado — é um arquivo que `backend/tools/extractor` nunca produziu e nunca vai apagar,
porque não corresponde a nenhuma query do PBIP. É a forma de GRÃO DE SLOT de
`field-agenda`: mesma origem (`vsdspi`), sem os `LEFT JOIN` de
`reports`/`people`/`skills` que multiplicam cada slot por (relato × skill) — ver
`docs/DECISAO-GRAO-FIELD-AGENDA.md` e ACHADOS #82/#85/#86/#87.

> **Corrigido em 22/09/2026 (`ACHADOS.md` #145), aviso de 01/10:** medido no arquivo em
> disco, **todo relator tem exatamente 1 skill** (182 relatores, mín = máx = 1) — o `LEFT JOIN
> person_skills` não multiplica nada. Quem multiplica é `reports`: o grão real é
> (slot, relato), ~13,4 relatos por solicitação.

O SQL preserva a EXISTÊNCIA da linha com um `EXISTS` que repete os seis filtros de
`r.title` do `LEFT JOIN` original — sem isso, o corte traria slot A MAIS do que a
forma completa (o `LEFT JOIN` de `field-agenda` é, na prática, um `INNER JOIN`: o
`WHERE` rejeita linha com `r.title` nulo). `backend/specs/_catalog/projecao.yaml`, bloco
`grao_reduzido`, declara qual tabela usa qual das duas por padrão e o que escala
para a completa.

Sem risco de sobrescrita: o `npm run extract` não existe mais (27/08).

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
> `backend/specs/_catalog/refresh.yaml` — **7.267 ms** medidos ao vivo, 1.869 linhas, 14
> chamadas à Open-Meteo — e hoje roda a cada 30 min. Entrou primeiro entre as 7 fontes
> justamente porque é a **única** query do catálogo cujo conteúdo caduca sozinha: a
> previsão é uma janela de ~16 dias que anda todo dia, e sem cadência ela envelhece até
> o visual de previsão esvaziar (estava 6 dias parada quando isso foi descoberto).
> O diagnóstico acima continua valendo para explicar **por que ninguém percebeu os 27
> dias**; o que não vale mais é a conclusão operacional — não depende mais de alguém
> lembrar de rodar `--refazer` à mão. Reproduzido com `node backend/tools/snapshot/src/index.ts --query=clima-tempo
--refazer`, que falhou em 6,5s com o erro acima antes do conserto e teve sucesso
(1.827 linhas, 6,46s) depois.

**Cuidado operacional achado ao testar o conserto**: `--refazer` de uma query cuja
materialização avança o carimbo "mais recente" do snapshot dispara, sozinho, o
recongelamento automático das tabelas calculadas afetadas
(`backend/tools/snapshot/src/calculadas.ts --todas`) — e esse recongelamento usa nomes de
arquivo fixos em `snapshot/_parciais/` (`status-protocolo-dia.0.jsonl` etc.), sem
namespacing por processo. Rodar DOIS `--refazer` em paralelo (o que fiz, sem saber
disso, testando `clima-tempo` e o grupo `quente` de `refresh.yaml` ao mesmo tempo)
faz as duas recongelações colidirem no mesmo arquivo temporário e uma delas morre
com `ENOENT`. **Não é bug de produção** — `backend/tools/refresh/src/index.ts` já documenta
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

### `protocolos-auxiliares` — 56 passos de M viraram o `sql:`; sobrou 1 (17/09/2026)

```diff
- Fonte = Odbc.Query("dsn=dbVoalle", "<cópia de ~5.000 caracteres do sql:, já desatualizada>"),
- #"Hora Inserida1" ... #"Colunas Renomeadas3"        (HORA CRIADO)
- #"Colocar Cada Palavra Em Maiúscula"                (Text.Proper de CIDADE/BAIRRO)
- #"Coluna Duplicada" ... #"Valor Substituído8"       (as nove trocas de SIGLA CIDADE)
- #"Coluna Mesclada Inserida" ... #"Valor Substituído10"  (INDICE 2 e as duas correções)
- #"Texto em Maiúscula" ... #"Valor Substituído11"    (RESPONSÁVEL)
- #"Hora Inserida" ... #"Colunas Renomeadas1"         (HORA AGENDA, type date de DATA AGENDA)
- #"Valor Substituído12..15"                          (nulo -> "Sem Informação")
- #"Dividir Coluna por Delimitador" ... #"Prefixo Adicionado"   (POP e VLAN)
- #"Texto Extraído Após/Antes o Delimitador"          (CTO)
- #"Consultas Mescladas1" / #"ALOCAÇÃO_PATRIMONIO Expandido"    (-> CTE `alocacao`)
- #"Linhas Filtradas1"                                (STATUS <> "Cancelado")
- #"Hora Inserida2" ... #"Colunas Removidas"          (HR. ALOCAÇÃO)
- #"Tipo Alterado1"                                   (type date de DATA CRIADO/ENCERRADO)
- #"Consultas Mescladas2" / #"TROCA ENDEREÇO Expandido"         (-> CTE `troca`)
- #"Personalização Adicionada" / #"...Adicionada1"    (INSTALADO POR: e DATA FINAL)
- #"Linhas Classificadas" / #"Linhas Classificadas1"  (os dois Table.Sort -> ORDER BY)
- #"Consultas Mescladas" / #"TECNICOS AUXILIARES Expandido"     (-> NULL::text, ver abaixo)
+ Fonte = Odbc.Query("dsn=dbVoalle", "o SQL desta query é o campo `sql:` desta spec")
```

**Não sobrou nenhum passo além do `Fonte`** — é a primeira query do corpus a chegar no
mínimo possível. `protocolos-telefonia` ficou com quatro porque `DateTime.LocalNow()`
devolve o relógio injetado; aqui nada depende do relógio.

**A razão real da migração não é desempenho.** A cópia do SQL que morava dentro do
`Odbc.Query` **já estava desatualizada**: o desempate do `ROW_NUMBER` decidido em 15/09
(ACHADOS #125) está no `sql:` e nunca chegou nela. Duas fontes da verdade para a mesma
consulta, sendo que uma nunca roda — `runQueries` busca `spec.sql` pelo Query Engine e
injeta o resultado como `Fonte`. Medido nesta sessão: M 58,1 s contra SQL 55,4 s, 5% e
dentro do ruído (o custo dominante é a consulta de base, igual nos dois caminhos).

**A prova, e por que ela precisou de três execuções.** Com 38.269 linhas de uma tabela
operacional, a deriva de `dbVoalle` entre duas materializações é maior que o efeito que
se quer medir. Comparar só antes×depois acusou 17 colunas divergentes — todas ruído. O
veredito veio do grupo de controle (ACHADOS #133):

```
M(t) × SQL(t+1)  linguagens diferentes, adjacentes ... 38.268 de 38.269 idênticas (99,997%), 1 coluna
SQL × SQL        mesmo código, ~5 min ................ 38.256 (99,966%), 9 colunas
M   × M          mesmo código, ~5 min ................ 38.241 (99,929%), 20 colunas
```

O par que troca a linguagem inteira é o mais limpo dos três. Chave composta
(`SOLICITACAO` + `DATA ALOCAÇÃO` + `HR. ALOCAÇÃO` + `TÉCNICO INSTALAÇÃO` + `POSIÇÃO`),
0 repetições dos dois lados; 46 colunas, mesmas e na mesma ordem.

**As armadilhas de tradução, todas conferidas contra o avaliador antes de virar SQL:**

| passo | a armadilha |
|---|---|
| `DateTime.Time` | devolve `MTime`, que `toDatasetRows` converte para `Date` sobre **1899-12-30**. Um `::time` puro chega como string e a coluna troca de `date` para `string`. Daí `DATE '1899-12-30' +` nas três horas. |
| `Text.Combine` | trata **nulo como vazio**, e `NULL \|\| '/' \|\| x` é `NULL`. Daí os `COALESCE` de `INDICE 2`. |
| `[STATUS] <> "Cancelado"` | em M, `null <> "x"` é **true**; em SQL é `NULL` e a linha sairia. Daí `IS DISTINCT FROM`. |
| `Text.AfterDelimiter(_, "-", 1)` | o `1` é o índice da **ocorrência** (ACHADOS #126): é o terceiro campo, não o segundo. E `Text.BeforeDelimiter` devolve **vazio**, não o texto inteiro, quando não há delimitador — daí o `>= 3` antes do `split_part(...,3)`. |
| `Table.SplitColumn` + `Int64.Type` | a 2ª parte de `CODIGO` vira inteiro **antes** do prefixo: `POP01-0012` dá `VLAN 12`, não `VLAN 0012`. Daí `::bigint::text`. |
| `Table.ExpandTableColumn` de `ALOCAÇÃO PATRIMONIO` | **multiplica** a linha por item de patrimônio — é dela que saem 38.269 linhas de 38.030 solicitações. O `LEFT JOIN` reproduz, e é desejado. |
| os dois `Table.Sort` encadeados | são **estáveis**: o segundo manda e o primeiro só desempata, então no `ORDER BY` eles aparecem na ordem **inversa** da que o M os escreve. |
| `type date` em `troca-endereco` | corta a hora, e sem o corte `DATA FINAL` passaria a ter um valor por instante em vez de um por dia. Daí o `::date`. |

**O mapa CIDADE→SIGLA não virou duas cópias.** No M dele era uma só (a cadeia produzia
`SIGLA CIDADE` e `INDICE 2` lia a coluna). O CTE `derivado` preserva isso;
`siglas-cidade.test.ts` trava em `1`. O placar de cópias segue **cinco**: uma em M
(`protocolos-geral`), duas no SQL de `protocolos-produtividade`, uma em `telefonia` e uma
aqui.

**A coluna `TECNICO` sai `NULL::text` de propósito.** Era o terceiro `Table.NestedJoin`,
`{"N°PROTOCOLO"}` × `{"PROTOCOLO:"}` de `tecnicos-auxiliares`, e ele **não casava
nenhuma linha**: texto contra número, e o motor não reconcilia sozinho. A coluna está
inteira nula no snapshot de produção (38.087 de 38.087, tipo `vazia`).
`backend/specs/_catalog/juncoes.yaml` já tem a decisão para `backlog-agendado-futuro` e para
`protocolos-geral` — esta última contra a **mesma** ponta direita — e não tem para
`protocolos-auxiliares`. Medido em 17/09: **28.833 de 37.248 (77,4%)** casariam como
inteiro. Ligar a junção é decisão humana e não cabe dentro de uma migração cuja promessa
é que o valor não muda; o lugar dela é `juncoes.yaml`.

**`source_tables` ganhou três** (`patrimony_packing_lists`, `patrimony_packing_list_items`,
`reports`): as duas mesclagens que viraram CTE trouxeram tabelas novas para dentro da
consulta, e é esse campo que alimenta a invalidação por CDC.

**Golden regravado**: 33 → 46 colunas, `rowCount` 32.574 → 38.271. Estava parado em
06/08/2026, quando o `sql:` ainda não produzia as colunas derivadas.

**Contadores do corpus atualizados**: 233 → 178 passos de M (`cobertura.test.ts`), piso do
parser 205 → 150, escaneáveis 208 → 153 (`mlayer.test.ts`). Detalhe completo em
`docs/ACHADOS.md` #133.

### `backend/specs/dashboards/*.spec.yaml` — `title:` nos visuais (02/10/2026)

**124 dos 306 visuais** ganharam `title:` (o nome que o visual mostra no Power BI:
`VISÃO PRODUTIVA`, `PRAZO SLA`…), logo abaixo de `type:`. Os outros 182 não têm título
no relatório. Fonte: `Desktop\projetos\files\visuais.csv` (colunas `id`/`titulo`, da
extração do PBIP), casado por id — os 306 ids batem com as specs, nenhum sobra.

**Por que à mão.** O extrator nunca emitiu título, e o PBIP não existe mais para
reextrair. O título já tinha sido posto na spec em 20/08 (`DECISAO-UX-TELAS.md`), mas
fora do git, e se perdeu na restauração de 26/08. Sem ele a tela derivava o cabeçalho
dos campos (`Qtd Protocolos Base por Status · Data`), e a VISÃO PRODUTIVA ficou
irreconhecível para quem a procura pelo nome — "o card nem aparece". `calcula.ts`
repassa o campo como `VisualCalculado.titulo`, que `rotulos.ts` já preferia.

### `protocolos-tipo` — arquivo NOVO; `backlog-agendado-futuro` mescla com ele (09/10/2026)

O M de `backlog-agendado-futuro` faz `Table.NestedJoin` com `#"PROTOCOLOS GERAL"` só para
trazer `TIPO DE PROTOCOLO`, e citar a PG fazia o runner avaliá-la INTEIRA a cada carga:
SQL no Voalle + as quatro mesclagens dela. Medido em 09/10: 116,6 s (59 s noutra rodada),
dos quais 0,9 s eram a própria backlog. `protocolos-tipo.spec.yaml` é SQL de mão com o par
(`N°PROTOCOLO`, `TIPO DE PROTOCOLO`) no MESMO recorte da PG — os 12 tipos, `created >=
'2025-01-01'` e o `STATUS <> "Cancelado"` do M, com `IS NULL OR` porque em M `null <>
"Cancelado"` é verdadeiro. A única linha mudada em `backlog-agendado-futuro.spec.yaml` é a
mescla: `#"PROTOCOLOS GERAL"` → `#"PROTOCOLOS TIPO"`; o nome da coluna aninhada e a
expansão ficaram iguais, então a saída tem o mesmo esquema.

**Prova:** as duas versões materializadas em seguida no contêiner do `refresh`: 101.563
linhas cada, **0** só numa ou só noutra, mesmas colunas; 116,6 s → 4,9 s. Golden capturado
por `npm run validate:queries -- --only=protocolos-tipo`. ACHADOS #200.

### `contratos` — onze colunas de dado pessoal sem uso saem da query (14/10/2026)

`CPF/CNPJ`, `E-MAIL`, `TELEFONE`, `TELEFONE CONTATO`, `RUA`, `NUMERO`, `COMPLEMENTO`,
`BAIRRO`, `CEP`, `LATITUDE` e `LONGITUDE` saíram do `sql:`,
do SQL de origem guardado no `m_expression` e de `tables/contratos.spec.yaml` (S6 de
`docs/PLANO-SEGURANCA.md`, ACHADOS #218). Nenhuma página, medida, coluna calculada,
relacionamento, catálogo, passo M ou código as usava (`npm run seguranca:inventario`), e o
carregador do snapshot (`colunas-usadas.ts`) só carregava `PLANO` e `CLIENTE` desta tabela.
A query não tem `DISTINCT` nem `GROUP BY`, então a contagem não muda: SQL antigo e novo
rodados em seguida devolveram as mesmas 89.019 linhas (23 → 12 colunas). Golden
regravado. Voltar com qualquer uma delas sem uso reprova `spec-seguranca.test.ts`.

### `protocolos-telefonia` — corte de `created` passa a `'2025-01-01'` (13/10/2026)

Era `a.created >= DATE_TRUNC('year', CURRENT_DATE)` — o corte do Power BI **Gerencial**. A
página Telefonia & Ouvidoria existe nos dois relatórios e, pela decisão do Erick de 13/10
(ACHADOS #205), segue o **Instalação**, que carrega a telefonia desde 2025 (2.110 linhas lá;
698 aqui). Medido na réplica: 699 → **2.112** linhas, mesmo custo (~11 s). A mesma linha
muda na costura de `realtime-poll.yaml`, que ancora nela. Efeito em cadeia, desejado: a
CALENDARIO CRIADO nasce do `MIN` desta tabela e passa a começar em 2025, como no Instalação —
ela só é usada por Visão Geral, Relatório do Mês e Telefonia, que seguem o Instalação.

### `relatorio-do-ano` — visuais e medidas NATIVOS, que não existem no PBIP (15/10/2026)

Decisão do Erick: a página do ano só tinha dois totais da base inteira, um combo
empilhado por base com eixo duplo e uma barra de 26 cidades — não respondia "o ano está
melhor ou pior que o anterior?". Entraram **11 visuais nativos** (8 cards, 2 gráficos, 1
tabela) e **11 medidas** sem contraparte no Power BI:

- `backend/specs/visuais-novos/relatorio-do-ano.yaml` — escrito à mão. `loadDashboards`
  (`widget-engine/src/spec.ts`) soma estes visuais à página com `origem: nativo`; a spec
  gerada **não** é editada. Visual nativo sem `porque`, com id repetido ou de página
  inexistente erra alto na carga.
- `backend/specs/_catalog/measures/relatorio-do-ano.measures.yaml` — `origem: nativo` no
  arquivo marca as medidas (`SemanticModel.measuresDoPbip` as exclui).
- Os testes de **inventário** do relatório original (`cobertura.test.ts` dos dois motores,
  `model.test.ts`) contam só o PBIP (`soDoPbip`, `measuresDoPbip`); os nativos têm teste
  próprio em `widget-engine/test/visuais-novos.test.ts`.
- Paridade não se aplica: não há número no Power BI para comparar. Os 4 visuais originais
  que a tela deixou de mostrar continuam na spec e em `paridade/relatorio-do-ano.yaml`.

O que muda de comportamento, só para visual nativo: `tableEx` poda linha sem nenhum número
(o padrão do Power BI) e aceita `ordem: {campo, desc}`; coluna de medida com formato `%`
sai marcada `percentual` para a tela. Os visuais do PBIP seguem exatamente como antes.

**Ressalva de borda**, medida em 15/10/2026: a carga de `PROTOCOLOS GERAL` começa em
`DATA CRIADO >= 2025-01-01`, então instalação de jan/2025 de protocolo criado em dez/2024
não existe na base. Jan/2026 teve 324 dessas; o "mesmo período do ano anterior" sai ~1%
menor e a variação de instalados ~1 ponto maior que a real. Some sozinho em 2027 (o ano
anterior passa a ser 2026, inteiro na base) — **mas** `CALENDARIO INSTALADO` termina em
`DATE(2026,12,31)` fixo no `table_dax`, e em 2027 todas as medidas por data de instalação
precisam disso resolvido antes.

### `relatos-do-dia` — arquivo NOVO e GERADO, não vem do PBIP (26/10/2026)

As contagens de relato por (protocolo, dia) — houve relato improdutivo, houve relato de
técnico — sobre a janela inteira da agenda. É a agregada `relatos-do-dia` de
`ao-vivo.yaml` sem período (`sqlRelatosDaJanela`): o SQL da `field-agenda` com a view
aberta, o `GROUP BY` e a `CategoriaProdutividade` gerada das 38 regras do DAX. Ela existe
para o passo 2 do ao vivo (docs/DECISAO-AO-VIVO.md): sem a agenda completa no snapshot, o
congelador tira o `Status Protocolo Dia` da agenda de slot, da PG e destas contagens
(`statusProtocoloDiaDasContagens`), em vez das 633 mil linhas do grão relato.

- **Não se edita à mão.** `npm run gera:relatos-do-dia` regrava; `backend/tools/snapshot/
  test/relatos-do-dia.test.ts` reprova quando a spec da agenda, a costura ou o DAX das
  regras mudam e a cópia fica para trás.
- `origin: expression`: não é tabela do modelo. O refresh grava o arquivo (`quente`, junto
  da `field-agenda-slot`, ~38 mil linhas e ~11 s) e só o congelador o lê.
- **Prova** (`npm run probe:status-dia-sem-completa`, 26/10/2026): com slot e contagens do
  mesmo instante, o `Status Protocolo Dia` é o da tradução nativa sobre a agenda completa —
  13.200 linhas, 0 diferenças; e as contagens do SRD batem com as tiradas da agenda
  completa nos dias fechados, 37.580 de 37.580. O congelador real, rodado com a agenda
  completa desligada, deu a mesma tabela nos dias antes da agenda em disco; as 141 linhas
  trocadas são todas de 24/10 em diante, relatos que o SRD já tinha.

### `valores-do-relato` — arquivo NOVO e GERADO, não vem do PBIP (26/10/2026)

Os valores distintos de `Descrição`, `ClassificacaoRelato` e `CategoriaProdutividade` na
janela inteira da agenda — uma linha por combinação, ~70. É a agregada `valores-do-relato`
de `ao-vivo.yaml` sem período, gerada pelo mesmo script da `relatos-do-dia`, com as duas
colunas DAX traduzidas das mesmas 38 regras (`classificacaoDoRelatoSql`,
`categoriaDoRelatoSql`). Existe para o passo 3 do ao vivo: a API lista os três seletores de
relato da Agendamento Field daqui (`valores_dos_seletores` em `projecao.yaml`), em vez de
carregar a página com a agenda completa (ACHADOS #248).

- **Não se edita à mão**, pelo mesmo motivo e com o mesmo teste da `relatos-do-dia`.
- `origin: expression`. O refresh a grava no grupo `frio` (~11–25 s de SRD); quem lê é a
  rota `/valores`. Sem o arquivo (primeiro deploy), a lista sai da página inteira, como antes.
- **Prova** (`npm run probe:valores-ao-vivo`, 26/10/2026): contra a agenda completa do
  snapshot, a Categoria é igual; a Classificação tem 1 valor a mais (só em relatos de
  26/10, depois do snapshot) e a Descrição 1 a menos (1 protocolo de slot em 25/07, que
  saiu da janela entre o snapshot e a consulta). Diferença de instante, nenhuma de regra.

## Estrutura de `backend/specs/`

```
backend/specs/
  _catalog/
    datasources.yaml          # dbVoalle, dbMaria, gsheets (SEM credenciais)
    relationships.yaml        # 22 relacionamentos + cardinalidade e direção do filtro
    queries/*.spec.yaml       # cada consulta (SQL + colunas + source_tables + cache)
    tables/*.spec.yaml        # 25 tabelas: colunas, tipos, e o DAX das calculadas
    measures/*.spec.yaml      # 78 medidas DAX do PBIP + as nativas (`origem: nativo`)
  dashboards/*.spec.yaml      # 14 páginas: layout, visuais, filtros, medidas usadas
  visuais-novos/*.yaml        # À MÃO: visuais que o PBIP não tem, somados à página na carga
  layout/*.layout.yaml        # À MÃO: a forma da tela (kpis, faixas, ocultos)
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
`backend/specs/golden/` a forma e os agregados de cada resultado — e é o `rowCount` de lá
que se compara com o Power BI. Ver
[backend/specs/golden/README.md](../specs/golden/README.md), inclusive por que esses
arquivos não guardam as linhas.

## Comandos

> **25/09/2026:** `npm run extract` e `npm run test:extractor` não existem mais — o PBIP
> saiu do disco em 27/08 e `backend/specs/` virou o original (ver `CLAUDE.md`).
> `backend/tools/extractor/` ficou só como registro.

```bash
npm run test:semantic-model          # valida o modelo semântico e o scanner de refs
npm run validate:model                # confere as referências do DAX (sem banco)
npm run validate:queries              # captura os goldens contra dados reais
npm run validate:queries -- --check    # falha se o schema de alguma query mudou
```
