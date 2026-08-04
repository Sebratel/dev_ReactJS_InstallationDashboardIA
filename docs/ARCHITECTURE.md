# Arquitetura — Analytics Platform Enterprise

> Plataforma corporativa de Analytics que substitui o Power BI da Sebratel.
> Orientada por **Engines** e **metadados**, não por controllers CRUD.

## 1. Princípios

1. **Spec-driven** — nada é reimplementado sem uma spec extraída da base atual (Power BI). As specs em `specs/` são o contrato; código novo é validado contra elas (paridade). Ver [SPEC-DRIVEN.md](./SPEC-DRIVEN.md).
2. **Dashboard é metadado** — não contém lógica. Aponta para widgets.
3. **Widget é a unidade** — consulta + datasource + cache + realtime + visualização + permissão.
4. **Query Registry único** — cada SQL existe em um só lugar, com TTL/cache/dependências.
5. **Read-only sobre as fontes** — a plataforma nunca escreve no ERP Voalle/MariaDB.

## 2. Visão geral

```
React Client ──SDK──► API Gateway ──► Analytics Core (Engines) ──► Data Connectors ──► Fontes
                                             ▲
                              Realtime  ─────┘ (Debezium → Kafka → Redis)
```

### Engines (Analytics Core)
Identity · Permission · Query · Dataset · Analytics · Widget · Dashboard · Cache ·
Realtime · Visualization · AI · Export · Notification · Audit · Observability.

Cada Engine é um módulo independente (arquitetura hexagonal + vertical slice), comunicando por eventos.

## 3. Fontes de dados reais (extraídas do PBIP)

| Datasource | Queries | Tipo | Uso |
|---|---|---|---|
| `dbVoalle` | 15 | ODBC → **PostgreSQL** (ERP Voalle) | protocolos, contratos, patrimônio, agendas, técnicos |
| `dbMaria` | 3 | ODBC → **MariaDB** | `DB_Applicattion`: `Backlog_Installation`, `Backlog_Schedules`, `Installation_Teams` |
| `gsheets` | 3 | Google Sheets API | `QUADRO FUNCIONAL` (RH), capacidade de equipe, apuração de premiação |
| `web` | 1 | API Open-Meteo | clima |
| `inline` | 1 | dados embutidos no `.pbix` | feriados |
| `computed` | 1 | — | timestamp de atualização |

As 18 queries de `dbVoalle`+`dbMaria` são as executáveis hoje pelo
`npm run validate:queries`; `gsheets` e `web` entram quando seus connectors existirem.

## 4. Arquitetura de Real-time (Debezium + Kafka + Redis)

Infra já existente no Portainer da Sebratel: **Debezium, Kafka e Redis**.

```
┌─────────────┐   CDC (logical      ┌──────────┐   topics      ┌──────────────────┐
│ PostgreSQL  │──  replication)  ──► │ Debezium │──  por tabela ─► │      Kafka       │
│  (Voalle)   │                     └──────────┘               └────────┬─────────┘
└─────────────┘                                                          │ consume
┌─────────────┐   polling                                               ▼
│  MariaDB    │──  updated_at ───────────────────────────────►  ┌──────────────────┐
└─────────────┘                                                 │ Change Ingestor  │
┌─────────────┐   webhook/poll                                  │ (Realtime Engine)│
│ GoogleSheets│──────────────────────────────────────────────► └────────┬─────────┘
└─────────────┘                                                          │
                                                                         ▼
                                            ┌────────────────────────────────────────┐
                                            │  Query Invalidator                      │
                                            │  mapa: tabela-fonte → queries afetadas  │
                                            │  (declarado nas specs de cada query)    │
                                            └───────────────┬────────────────────────┘
                                                            │ invalida cache + recomputa
                                              ┌─────────────┴──────────────┐
                                              ▼                            ▼
                                     ┌──────────────┐            ┌───────────────────┐
                                     │ Redis (cache │            │ Redis Streams /   │
                                     │  por query)  │            │ Pub-Sub (fan-out) │
                                     └──────────────┘            └─────────┬─────────┘
                                                                           │
                                                                ┌──────────▼──────────┐
                                                                │  SSE / WebSocket    │
                                                                │  Gateway            │
                                                                └──────────┬──────────┘
                                                                           │ patch
                                                                  só widgets afetados
                                                                           ▼
                                                                       React Client
```

### Fluxo
1. **Debezium** captura mudanças do Postgres via *logical replication* e publica um tópico Kafka por tabela (`voalle.public.assignment_incidents`, `voalle.public.contracts`, ...).
2. **Change Ingestor** (Realtime Engine) consome os tópicos.
3. **Query Invalidator** usa o mapa `tabela → queries` (cada spec de query lista suas `source_tables`) para saber quais queries do Registry ficaram sujas.
4. Invalida o cache Redis dessas queries e agenda recomputação incremental.
5. Publica o delta em **Redis Streams**; o **SSE/WS Gateway** faz fan-out apenas para os widgets que consomem aquelas queries.
6. O React aplica o patch **só no widget afetado** — sem recarregar o dashboard.

### Por que este desenho
- **Debezium/Kafka** desacoplam a captura da carga analítica e absorvem picos.
- **Redis** serve tanto de cache quente por query quanto de barramento de fan-out para os clientes.
- **Granularidade por widget/query** evita o custo do Power BI de recarregar o modelo inteiro.

### Degradação graciosa
- MariaDB e Google Sheets (sem CDC nativo prático) usam **polling incremental** por `updated_at`/revisão, publicando no mesmo Change Ingestor.
- Se Debezium/Kafka estiverem indisponíveis, o Query Engine cai para TTL-cache normal (a plataforma continua funcionando, só perde o "tempo real").

## 5. Stack

- **Core:** Node 22+ · Fastify · TypeScript · hexagonal + vertical slice · event-driven
- **Estado quente / barramento:** Redis · Kafka · Debezium
- **Metadados:** PostgreSQL próprio (dashboards, widgets, queries, permissões)
- **Client:** React 19 · React Router v7 · TanStack Query · Zustand · Vite
- **Design System:** Atomic Design + Design Tokens · Chart SDK (biblioteca de gráficos trocável)
