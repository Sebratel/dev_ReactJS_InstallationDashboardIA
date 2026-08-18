# Arquitetura — Analytics Platform Enterprise

> Plataforma corporativa de Analytics que substitui o Power BI da Sebratel.
> Orientada por **Engines** e **metadados**, não por controllers CRUD.

> **Como ler este documento.** Ele tem duas metades, e a separação é o ponto:
> a **parte 1 descreve o que existe no repositório** e a **parte 2 descreve o que
> foi desenhado e ainda não tem código**. Até 11/08/2026 as duas estavam
> misturadas, e o resultado é que quem lia aqui concluía que a plataforma consumia
> Kafka. Uma linha só muda de metade quando o código dela existe.
>
> Uma linha mudou no mesmo dia: `tools/cdc` **consome Kafka de verdade** — mas só
> para medir. O pipeline que *age* sobre o evento continua na parte 2, e a distinção
> entre "consome" e "reage" é justamente o que este documento existe para não deixar
> borrar de novo.

## 1. Princípios

1. **Spec-driven** — nada é reimplementado sem uma spec extraída da base atual (Power BI). As specs em `specs/` são o contrato; código novo é validado contra elas (paridade). Ver [SPEC-DRIVEN.md](./SPEC-DRIVEN.md).
2. **Dashboard é metadado** — não contém lógica. Aponta para widgets.
3. **Widget é a unidade** — consulta + datasource + cache + realtime + visualização + permissão.
4. **Query Registry único** — cada SQL existe em um só lugar, com TTL/cache/dependências.
5. **Read-only sobre as fontes** — a plataforma nunca escreve no ERP Voalle/MariaDB.

---

# Parte 1 — Implementado

O que roda hoje, com o arquivo ao lado. Nada nesta parte é aspiração.

## 2. O caminho do dado, ponta a ponta

```
fontes → Query Engine → camada M → toDatasetRows → snapshot/*.jsonl
                                                        │
                                        carrega() ──────┘
                                            │
                      Dataset + tabelas calculadas materializadas
                                            │
                        Evaluator → Widget Engine → apps/api → apps/web
                                                        │
                                             cache da resposta (Redis/memória)
```

**Não há processo servindo consulta ao vivo.** A camada M mantém todos os passos
vivos ao mesmo tempo e precisa de 8 GB de heap ([ACHADOS](ACHADOS.md) #20), então
ela roda **uma query por processo**, offline, em `npm run snapshot`. A API lê o
resultado em disco. Uma API que rodasse a camada M no arranque seria exatamente o
processo que já se sabe que não cabe.

## 3. Os módulos que existem

| pacote | o que faz |
|---|---|
| `packages/query-engine` | connectors (Postgres, MariaDB, Sheets, Web), Query Registry, cache (memória e Redis), guarda de somente-leitura, parâmetros de SQL |
| `packages/transform-engine` | o interpretador da camada M — 303 passos, 38 funções |
| `packages/semantic-model` | modelo semântico, relacionamentos, projeção, divergências |
| `packages/measure-engine` | o avaliador DAX — 56 funções, 75 medidas |
| `packages/widget-engine` | as specs de dashboard e a decodificação do filtro da URL |
| `packages/snapshot` | plano de materialização, formato em disco, manifesto, carga |
| `apps/api` | a API de leitura (`node:http`), o cache da resposta e os estáticos |
| `apps/web` | a tela (React 19 + Vite), 14 páginas, segmentações filtrando, estado na URL |

Ferramentas de linha de comando em `tools/`: `extractor`, `validate`, `doctor`,
`probe`, `auth`, `mrun`, `snapshot`, `paginas`, `paridade`, `cdc`.

**`tools/cdc` tem duas metades agora, e a diferença importa.** `index.ts`
(`npm run cdc:observa`) continua só observação: consome tópicos Debezium e
**conta** — tabela → queries afetadas, taxa, intervalo típico —, sem invalidar
cache nem rematerializar. Existe para produzir o número que o gatilho do
[DECISAO-REALTIME.md](DECISAO-REALTIME.md) exige, e o
[RUNBOOK-CDC.md](RUNBOOK-CDC.md) diz o que é preciso no ERP para alimentá-lo. O
monitor de slot (`npm run cdc:slot`) é pré-requisito operacional, não acessório.

`ingestor.ts` (`npm run cdc:ingere`) **age**: quando uma tabela suja, ele
rematerializa (`npm run snapshot --query=`) só as queries que dependem dela —
`fila.ts` garante uma rematerialização de cada vez, nunca duas em paralelo (a
lição do [ACHADOS](ACHADOS.md) §7). Ele não fala com a API nem com SSE: o
manifesto novo em disco já é o que invalida o cache da resposta sozinho (o
carimbo do snapshot entra na chave, ver §6) — a única invalidação que
existe é a que já existia. **Validado em 18/08/2026 contra a stack descartável de
`docker/cdc/`** ([ACHADOS](ACHADOS.md) #72): pipeline completo, dado real do
Voalle, sem tocar produção. **Ainda não aponta para o Voalle real** — isso exige
as etapas 1.1/1.2 do runbook, que são trabalho de DBA, fora do escopo deste
repositório.

## 4. Fontes de dados reais (extraídas do PBIP)

| Datasource | Queries | Tipo | Uso |
|---|---|---|---|
| `dbVoalle` | 15 | ODBC → **PostgreSQL** (ERP Voalle) | protocolos, contratos, patrimônio, agendas, técnicos |
| `dbMaria` | 3 | ODBC → **MariaDB** | `DB_Applicattion`: `Backlog_Installation`, `Backlog_Schedules`, `Installation_Teams` |
| `gsheets` | 3 | Google Sheets API | `QUADRO FUNCIONAL` (RH), capacidade de equipe, apuração de premiação |
| `web` | 1 | API Open-Meteo | clima |
| `inline` | 1 | dados embutidos no `.pbix` | feriados |
| `computed` | 1 | — | timestamp de atualização |

**As 24 rodam contra a fonte real**, incluindo `gsheets` e `web` — os connectors
dos dois existem desde 06 e 07/08/2026 ([ACHADOS](ACHADOS.md) #42).

## 5. Somente leitura, em quatro camadas

Regra inviolável 3 do [CONTINUACAO](CONTINUACAO.md). Nenhuma pode ser afrouxada, e
`DECISAO-DESEMPENHO.md` repete que velocidade não autoriza mexer nelas.

| # | camada | onde |
|---|---|---|
| 1 | usuário do banco sem permissão de escrita | `.env` |
| 2 | `default_transaction_read_only=on` na sessão | `packages/query-engine/src/connectors-sql.ts` (`createVoallePool`) |
| 3 | `assertReadOnly()` antes de o SQL sair do processo | `connectors-sql.ts` |
| 4 | a API só aceita `GET`/`HEAD`; qualquer outro método leva 405 | `apps/api/src/servidor.ts` |

Uma quinta trava, contra *leitura do conjunto errado*: **valor de filtro nunca vira
texto de SQL**. `traduzParametros` (`connectors-sql.ts`) troca `:nome` pelo marcador
do driver — `$1` no Postgres, `?` com `execute()` preparado no MariaDB — e erra alto
nas duas pontas (nome sem valor, valor sem uso). Hoje nenhuma query passa parâmetro;
o caminho existe para o dia em que uma segmentação da tela virar `WHERE`.

## 6. Cache

**Do que já foi calculado, não da linha de fonte.** `apps/api` consulta o cache antes
de abrir o snapshot: num acerto o pedido não carrega tabela nem roda o avaliador. A
chave carrega tudo que muda o número — página, filtros normalizados, visual, janela
de paginação e o carimbo do snapshot —, e o carimbo é o que faz `npm run snapshot`
invalidar sozinho.

Os TTLs vivem em `specs/_catalog/cache-policies.yaml` (mantido por humanos); o de uma
página é o **menor** entre os das queries que ela usa. Sem `REDIS_URL` o adapter é o
de memória; com ela, `RedisCache` (`ioredis`, `SCAN` e não `KEYS`). **Redis fora do ar
é um miss**, nunca um erro de pedido — `GET /api/saude` diz qual adapter está ligado.

## 7. Stack, de verdade

- **Core:** Node 22+ · TypeScript **executado direto, sem passo de build** · `node:http`
- **Dependências de raiz:** `yaml`, `pg`, `mysql2`, `ioredis`, `kafkajs` — cinco, e a
  quinta entrou em 11/08/2026 pelo observador de CDC. Escrever o protocolo do Kafka à
  mão não era alternativa séria; a conta a manter é *poucas dependências, cada uma
  com motivo escrito*, não um número.
- **Client:** React 19 · Vite · sem biblioteca de gráfico (barra em HTML; ver `CONTINUACAO.md` §6.4)
- **Design System:** ver [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) — v2, tokens do HUBBI

**Sem Fastify, de propósito.** A divergência está registrada no cabeçalho de
`apps/api/src/servidor.ts` e a condição de revisão é a do [ACHADOS](ACHADOS.md) #39:
Permission Engine **+** corpo de requisição **+** WebSocket. Enquanto forem cinco
rotas `GET` sobre um snapshot, `node:http` é a peça certa.

---

# Parte 2 — Projetado, sem código

Nada aqui existe no repositório. É desenho, e está guardado porque continua sendo a
direção pretendida — não porque já valha como descrição do sistema.

## 8. Os Engines

O desenho original prevê 15: Identity · Permission · Query · Dataset · Analytics ·
Widget · Dashboard · Cache · Realtime · Visualization · AI · Export · Notification ·
Audit · Observability.

**Seis existem**, com os nomes que a parte 1 lista (Query, Dataset/Snapshot,
Analytics/Measure, Widget, Cache, e o modelo semântico). Os outros **nove não têm
código**: Identity, Permission, Dashboard como serviço, Realtime, Visualization, AI,
Export, Notification, Audit, Observability.

Os dois que bloqueiam produção multiusuário são **Identity** e **Permission** — a API
não autentica ninguém hoje. O ponto de costura está preparado em
`apps/api/src/servidor.ts` (`identifica()`), e o formato da decisão humana está em
`specs/_catalog/permissoes.yaml`; falta o leitor e o login.

## 9. Real-time (Debezium + Kafka + Redis)

A infra existe no Portainer da Sebratel. **Desde 18/08/2026 existe um Change
Ingestor** (`tools/cdc/src/ingestor.ts`, `npm run cdc:ingere`) — mas ele é mais
simples que o diagrama abaixo, de propósito: quando uma tabela suja, ele
rematerializa (`npm run snapshot --query=`) só as queries afetadas, e para por
aí. O manifesto novo em disco já invalida o cache da resposta sozinho (§6) — não
existe fan-out, Redis Streams, gateway SSE/WebSocket nem patch de widget, porque
nenhum deles é necessário para o dado ficar fresco: o mecanismo de invalidação por
carimbo que já existia resolve isso sem peça nova. **Validado contra a stack
descartável de `docker/cdc/`, com dado real do Voalle** ([ACHADOS](ACHADOS.md)
#72) — **ainda não contra o Voalle de produção**, que exige as etapas de DBA do
[RUNBOOK-CDC.md](RUNBOOK-CDC.md) (role de replicação, publication), fora do
escopo deste repositório. O restante do diagrama — a metade de baixo, a partir do
Query Invalidator — continua sendo desenho: nada aqui empurra patch para o
cliente, a tela continua pedindo.

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

**O mapa e o consumidor já existem.** Cada spec de query declara `source_tables`, e
`QueryRegistry.queriesForTable()` responde "quem sujou" — é o Query Invalidator, e
`ingestor.ts` é quem chama. `cache-policies.yaml` já marca `realtime: true|false`
por query. O que falta, se um dia fizer sentido, é só o gateway de fan-out — e
"faz sentido" aqui também é gatilho medido, não escolha de conveniência: sem um
caso em que a tela pedindo de novo seja tarde demais, empurrar patch para o
cliente é peça a mais sem problema que resolva.

**Antes de escrever qualquer um dos dois, leia [DECISAO-REALTIME.md](./DECISAO-REALTIME.md).**
O gatilho é um número medido, não a disponibilidade do Kafka no Portainer.

## 10. Metadados em banco próprio

O desenho prevê um PostgreSQL da plataforma guardando dashboards, widgets, queries e
permissões. Hoje isso tudo são **arquivos versionados** em `specs/` — gerados pelo
extrator, com as decisões humanas em arquivos separados que `npm run extract` não
sobrescreve (`cache-policies.yaml`, `divergencias.yaml`, `permissoes.yaml`). Enquanto
o relatório de origem for um PBIP e a edição for por commit, arquivo é a peça mais
simples que resolve; o banco entra quando alguém editar dashboard pela tela.
