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
