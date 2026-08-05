# Analytics Platform Enterprise

Plataforma corporativa de Analytics que substitui o Power BI da Sebratel.
Orientada por **Engines** e **metadados** — dashboards são apenas uma das funcionalidades.

## Estado atual

| Fase | Escopo | Status |
|---|---|---|
| 0 | Fundação spec-driven + extrator PBIP | ✅ |
| 1 | Query Engine + Query Registry + cache | ✅ |
| — | Infra de conexão + `doctor` + guard read-only | ✅ |
| — | Validação contra dados reais — 18/18 queries capturadas | ✅ (⏳ `rowCount` a conferir com o Erick) |
| 2a | Modelo semântico completo + verificação de referências | ✅ |
| 2b.1 | Parser de DAX → AST (127/127 expressões parseiam) | ✅ |
| 2b.2 | Avaliador: escalares e agregação | ✅ |
| 2b.3 | Contexto de filtro: `CALCULATE`, `FILTER`, `ALL`, `TREATAS` | ✅ |
| 2b.4 | Time intelligence, conjuntos, `RANKX` — **74 das 78 medidas executam** | ✅ |
| 2b.5 | Relacionamentos + paridade contra dado real | ⏳ próximo |
| 3 | Widget/Dashboard Engine + Chart SDK | ⏳ |
| 4 | Realtime Engine (Debezium/Kafka/Redis) | ⏳ |
| 5 | Permission Engine, IA, Export | ⏳ |

**283 testes verdes.** Nenhum deles precisa de credencial.

### Extraído do Power BI

| Artefato | Qtd |
|---|---|
| Tabelas | 25 |
| Medidas (DAX) | 78 — 5 não são usadas por nada ([ACHADOS](docs/ACHADOS.md) #6 e #10) |
| Colunas calculadas (DAX) | 49 — 6 recuperadas em 04/08 ([ACHADOS](docs/ACHADOS.md) #8) |
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
das 78 medidas e das 49 colunas calculadas. Não precisa de `.env` nem de banco.
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

**Front-end (2b.1).** Tokenizer e parser → AST, com as **127 expressões da base
parseando** (78 medidas + 49 colunas calculadas). O AST é deliberadamente burro:
quem decide se `[Data]` é medida ou coluna é o avaliador, que conhece o modelo.

Duas implementações independentes concordam sobre as referências de todas as 127
expressões (o scanner por caractere do `semantic-model` e o parser com gramática),
o que é evidência de que nenhuma das duas está lendo o DAX errado.

**Avaliador (2b.2 a 2b.4).** **Todas as 54 funções DAX que a base usa** estão
implementadas — há teste que falha e diz qual, se o PBIP passar a usar uma nova.
Inclui contexto de filtro (`CALCULATE`, `FILTER`, `ALL`, `TREATAS`,
`LOOKUPVALUE`, `SELECTEDVALUE`), *time intelligence* (`DATESBETWEEN`, `DATESMTD`,
`ENDOFMONTH`, `STARTOFMONTH`), conjuntos (`INTERSECT`, `EXCEPT`, `UNION`,
`SELECTCOLUMNS`, `DISTINCT`), `RANKX`, `AVERAGEX`, colunas calculadas em contexto
de linha, `VAR` (inclusive guardando tabela), dependência entre medidas com
detecção de ciclo e a hierarquia automática de datas (`[Data].[Dia]`).

Quatro níveis de cobertura, porque medem coisas diferentes:

| Nível | Hoje | O que prova |
|---|---|---|
| Parseia | 127/127 | o DAX é lido inteiro, sem construção estranha |
| Está no implementado | 127/127 | nenhuma função ou dependência faltando |
| **Executa de ponta a ponta** | **123/127** — e **74 das 78 medidas** | roda sobre dados e devolve valor |
| Bate com o Power BI | ⏳ | **paridade — depende de dado real, ainda não provada** |

A última linha é a que importa para migrar, e ela ainda não foi feita: os testes
rodam sobre dados sintéticos, então provam que o avaliador *funciona*, não que o
número é o mesmo do relatório. Paridade depende da conferência dos `rowCount`.

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
de cliente. O `rowCount` gravado é o número que se compara com o Power BI.

Depois, `-- --check` reexecuta e separa mudança de **schema** (regressão: coluna
sumiu ou trocou de tipo, quebra medidas) de mudança de **dados** (esperado).
Ver [specs/golden/README.md](specs/golden/README.md).

## Comandos

```bash
npm test                              # suíte completa (283 testes, sem credencial)
npm run extract                       # regenera as specs a partir do PBIP
npm run validate:model                # o DAX referencia coisas que existem? (sem banco)
npm run doctor                        # valida configuração e conectividade
npm run validate:queries              # executa as queries reais e grava os goldens
npm run validate:queries -- --check    # falha se o schema de alguma query mudou
```

Os quatro respondem perguntas diferentes, e só os dois primeiros dispensam `.env`:

| Comando | Pergunta | Precisa de `.env`? |
|---|---|---|
| `npm test` | o código respeita as specs? | não |
| `validate:model` | o DAX aponta para tabelas/colunas que existem? | não |
| `doctor` | as fontes estão alcançáveis e a sessão é read-only? | sim |
| `validate:queries` | as queries rodam e devolvem o quê? | sim |

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
    tables/              # GERADO — colunas, incluindo o DAX das calculadas
    measures/            # GERADO — as 78 medidas DAX
  dashboards/            # GERADO — as 14 páginas com seus visuais
  golden/                # GERADO por validate:queries — linha de base real
  EXTRACTION-REPORT.md
tools/extractor/          # extrator PBIP -> specs (sem dependências externas)
tools/doctor/             # valida configuração e conectividade
tools/validate/           # queries contra o ERP + verificação do modelo
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
