# Desenvolvimento orientado a Specs (Spec-Driven)

Objetivo: **replicar o Power BI atual sem quebrar comportamento**. As specs congelam o
que o relatório faz hoje; o código novo é validado contra elas.

## Fonte da verdade

- **Base de referência (read-only):** o projeto Power BI PBIP
  `INST - Relatório Instalação Gerencial` (pasta `DASHBOARD - Instalação/`).
  **Nunca é modificado** — é insumo.
- **Specs geradas:** `specs/` — extraídas automaticamente pelo `tools/extractor` e
  depois revisadas por humano. São versionadas no git.

## Estrutura de `specs/`

```
specs/
  _catalog/
    datasources.yaml          # dbVoalle, dbMaria, gsheets (SEM credenciais)
    queries/*.spec.yaml       # cada consulta (SQL + colunas + source_tables + cache)
    tables/*.spec.yaml        # 25 tabelas: colunas, tipos, transformações (M)
    measures/*.spec.yaml      # 78 medidas DAX
  dashboards/*.spec.yaml      # 14 páginas: layout, visuais, filtros, medidas usadas
  golden/*.golden.json        # GERADO por validate:queries — linha de base contra
                              # dados reais (forma + agregados, SEM linhas)
  EXTRACTION-REPORT.md        # gerado: contagens e alertas do extrator
```

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

## Os três níveis de verificação

Eles respondem a perguntas diferentes e não se substituem:

| Comando | Pergunta que responde | Precisa de `.env`? |
|---|---|---|
| `npm test` | O código respeita as specs? | não |
| `npm run doctor` | As fontes existem e estão alcançáveis? | sim |
| `npm run validate:queries` | As 18 queries SQL rodam e devolvem o quê? | sim |

O `validate:queries` é o passo que fecha o vão entre "conecta" e "os números
batem": ele grava em `specs/golden/` a forma e os agregados de cada resultado —
e é o `rowCount` de lá que se compara com o Power BI. Ver
[specs/golden/README.md](../specs/golden/README.md), inclusive por que esses
arquivos não guardam as linhas.

## Comandos

```bash
npm run extract                       # gera/atualiza specs/ a partir do PBIP
npm run test:extractor                # valida o extrator (contagens e parsing)
npm run validate:queries              # captura os goldens contra dados reais
npm run validate:queries -- --check    # falha se o schema de alguma query mudou
```
