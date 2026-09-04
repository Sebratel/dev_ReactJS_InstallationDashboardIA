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

**O que isto evitava.** Sem a janela, a próxima carga completa de `field-agenda`
buscaria ~8 meses em vez de 3 — numa query cujo grão é (slot, relato) e cuja última
carga **morreu** com `ECONNRESET` após 38 min de colunas calculadas
(`snapshot/field-agenda.erro.log`, 19/08). A regressão seria silenciosa: número
maior, sem erro.

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
suas `entities_used`. `clima-tempo` não está em `refresh.yaml` (é uma das "7 fontes
nunca medidas isoladamente", risco já registrado lá), então a única forma de
perceber a quebra era rodar `--refazer` à mão — o que aparentemente não acontecia
há 27 dias. Reproduzido com `node tools/snapshot/src/index.ts --query=clima-tempo
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
--           ORDER BY (ac.active IS TRUE) DESC, s.start_date DESC NULLS LAST,
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
OLT, EQUIPAMENTO, SLOT, PORTA, LATITUDE, LONGITUDE — `l-mapa` plotava coordenada
sorteada para ~12 mil protocolos, e dois refreshes moviam o ponto sem ninguém ter
mexido em nada.

**A regra, decidida por Erick em 04/09/2026 (`ACTIVE TRUE`):** preferir o registro
de `authentication_contracts` com `active = true`. Medido em escala, antes de
decidir a regra secundária: dentre as 247.668 solicitações com partição múltipla,
**234.475 (94,7%) têm no máximo UM ponto de acesso ativo** — `active=true`
resolve sozinho. As **13.193 (5,3%) restantes** têm mais de um contrato
simultaneamente `active=true` (achado ao vivo: um cliente com 4 contratos
`active=true` em 4 endereços diferentes, acumulados de 2024 a 2026 — dado do ERP,
não erro da consulta). Para este resíduo, o desempate final é `ac.created DESC` —
**o contrato ativo criado mais recentemente vence.** É a parte assumida, não
confirmada por Erick explicitamente; fica registrado aqui para revisão se
alguém discordar. `ac.id DESC` no fim é só para garantir determinismo total,
mesmo num empate teórico de timestamp.

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
