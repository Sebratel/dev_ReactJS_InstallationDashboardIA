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
| 2b | Measure Engine — avaliador de DAX e as 78 medidas | ⏳ próximo |
| 3 | Widget/Dashboard Engine + Chart SDK | ⏳ |
| 4 | Realtime Engine (Debezium/Kafka/Redis) | ⏳ |
| 5 | Permission Engine, IA, Export | ⏳ |

**167 testes verdes.** Nenhum deles precisa de credencial.

### Extraído do Power BI

| Artefato | Qtd |
|---|---|
| Tabelas | 25 |
| Medidas (DAX) | 78 — 3 delas apontam para tabela inexistente ([ACHADOS](docs/ACHADOS.md) #6) |
| Colunas calculadas (DAX) | 43 |
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
das 78 medidas e das 43 colunas calculadas. Não precisa de `.env` nem de banco.
Serve para responder *quais medidas são reimplementáveis* antes de escrever o
avaliador — a resposta hoje é 75 de 78.

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
npm test                              # suíte completa (167 testes, sem credencial)
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
```

> Arquivos marcados **GERADO** são reescritos por `npm run extract` — nenhuma
> decisão humana pode viver dentro deles. Por isso as políticas de cache ficam
> em `cache-policies.yaml`, separado.

## Base de referência (read-only)

O projeto Power BI `INST - Relatório Instalação Gerencial` (pasta pai) é a fonte da
verdade do comportamento atual. **Não é modificado** — apenas lido pelo extrator.

Ver [docs/SPEC-DRIVEN.md](docs/SPEC-DRIVEN.md) e [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
