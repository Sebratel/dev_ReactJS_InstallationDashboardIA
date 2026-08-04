# Analytics Platform Enterprise

Plataforma corporativa de Analytics que substitui o Power BI da Sebratel.
Orientada por **Engines** e **metadados** — dashboards são apenas uma das funcionalidades.

## Estado atual

| Fase | Escopo | Status |
|---|---|---|
| 0 | Fundação spec-driven + extrator PBIP | ✅ |
| 1 | Query Engine + Query Registry + cache | ✅ |
| 2 | Dataset/Measure Engine (78 medidas DAX) | ⏳ |
| 3 | Widget/Dashboard Engine + Chart SDK | ⏳ |
| 4 | Realtime Engine (Debezium/Kafka/Redis) | ⏳ |
| 5 | Permission Engine, IA, Export | ⏳ |

### Extraído do Power BI

| Artefato | Qtd |
|---|---|
| Tabelas | 25 |
| Medidas (DAX) | 78 |
| Queries (Query Registry) | 24 |
| Dashboards (páginas) | 14 |
| Visuais | 306 |
| Datasources | `dbVoalle`, `dbMaria`, `gsheets`, `web`, `inline`, `computed` |

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

## Comandos

```bash
npm run extract
```

```bash
npm test
```

## Estrutura

```
docs/
  ARCHITECTURE.md      # Engines, stack e arquitetura de real-time (Debezium/Kafka/Redis)
  SPEC-DRIVEN.md       # como as specs governam a implementação
specs/
  _catalog/
    cache-policies.yaml  # HUMANO — TTL e realtime por query (não é sobrescrito)
    datasources.yaml     # GERADO
    queries/             # GERADO — SQL + source_tables (alimenta o invalidador)
    tables/              # GERADO
    measures/            # GERADO — as 78 medidas DAX
  dashboards/            # GERADO — as 14 páginas com seus visuais
  EXTRACTION-REPORT.md
tools/extractor/         # extrator PBIP -> specs (sem dependências externas)
packages/query-engine/   # Query Registry, Cache, Connectors, Engine
```

> Arquivos marcados **GERADO** são reescritos por `npm run extract` — nenhuma
> decisão humana pode viver dentro deles. Por isso as políticas de cache ficam
> em `cache-policies.yaml`, separado.

## Base de referência (read-only)

O projeto Power BI `INST - Relatório Instalação Gerencial` (pasta pai) é a fonte da
verdade do comportamento atual. **Não é modificado** — apenas lido pelo extrator.

Ver [docs/SPEC-DRIVEN.md](docs/SPEC-DRIVEN.md) e [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
