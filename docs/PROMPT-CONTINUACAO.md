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
`specs/EXTRACTION-REPORT.md`. Eles contêm todo o estado do projeto.

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

Escala: **25 tabelas, 78 medidas DAX, 14 páginas, 306 visuais, 24 queries**.

Fontes reais: `dbVoalle` (PostgreSQL do ERP Voalle), `dbMaria` (MariaDB,
`DB_Applicattion.Installation_Teams`), `gsheets` (planilha QUADRO FUNCIONAL),
`web` (API Open-Meteo), `inline` (feriados embutidos no .pbix), `computed`.

> **Esses dados são usados hoje na operação de instalação.** Replicar fielmente é
> requisito. Sugerir melhorias é bem-vindo, mas registre-as separadamente — nunca
> troque o comportamento atual sem avisar.

## Estado atual (já pronto e testado)

**71 testes verdes.** Rode `npm test` para confirmar antes de mexer em qualquer coisa.

| Fase | Escopo | Status |
|---|---|---|
| 0 | Extrator PBIP → specs | ✅ |
| 1 | Query Engine + Registry + cache | ✅ |
| — | Infra de conexão + doctor + guard read-only | ✅ |
| 2 | Dataset/Measure Engine (78 medidas DAX) | ⏳ próximo |
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
5. **Nunca peça nem aceite credenciais em texto.** Elas vivem só no `.env` local,
   que o git ignora. A saída de `npm run doctor` é mascarada e segura.

## Comandos

```bash
npm test          # suíte completa (71 testes)
npm run extract   # regenera as specs a partir do PBIP
npm run doctor    # valida specs e conectividade (não imprime credencial)
```

Node 24 roda TypeScript nativamente — **não há build step**.

## Pendência conhecida

O `git push` falhou: a conta `erickazambuja-Sebratel` **não tem permissão de escrita**
no repositório da org. Existe 1 commit local (`first commit`) aguardando. Quando um
admin liberar o acesso, basta `git push -u origin main`. Não tente contornar.

Existe também uma cópia antiga do trabalho em
`.claude/worktrees/analytics-platform-enterprise-394804` (repositório errado,
`dev_Sebratel_Images`). **Ignore essa pasta** — o diretório acima é o canônico.

## Próximo passo recomendado

**Antes da Fase 2, valide contra dados reais.** Peça ao Erick para preencher o `.env`
(a partir do `.env.example`) e rodar `npm run doctor`. Sem confirmar que as 24 queries
retornam os mesmos números que o Power BI hoje, a Fase 2 construiria as medidas sobre
dados não verificados.

Depois disso, **Fase 2**: reimplementar as 78 medidas DAX de
`specs/_catalog/measures/*.measures.yaml` como funções testáveis, com golden samples
para comparação de paridade.

## Como trabalhar

O Erick prefere **uma sessão de CLI por unidade de trabalho** — não arraste uma janela
de contexto gigante. Ao concluir uma fase ou entregável:

1. Commite com mensagem descritiva.
2. Atualize a tabela de fases no `README.md`.
3. Encerre a sessão e abra uma nova para o próximo bloco, usando este prompt.

Deixe o estado no **repositório** (specs, docs, testes, commits) — nunca só na conversa.
Escreva em **português**. Confirme antes de ações irreversíveis ou que publiquem algo.
