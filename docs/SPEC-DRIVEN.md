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
| `tables/*.spec.yaml` → `columns[].dax` | 43 | coluna calculada é DAX. `CALENDARIO INSTALADO[PESO]` carrega a regra de dia útil que 8 medidas somam |
| `relationships.yaml` | 22 | define para onde o filtro propaga. Sem isso, medida que cruza tabelas não pode ser avaliada |

O TMDL delimita expressão multi-linha com ``` ``` ```. **Essa cerca não é DAX** e
não pode aparecer nas specs — se aparecer, o extrator regrediu (ver
[ACHADOS](./ACHADOS.md) #8). Há teste travando isso.

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
