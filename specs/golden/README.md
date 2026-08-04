# specs/golden — linha de base das queries contra dados reais

Um arquivo `<query-id>.golden.json` por query, **gerado** por:

```bash
npm run validate:queries
```

É a linha de base que separa "a query roda" (`npm run doctor`) de "as medidas
batem com o Power BI" (Fase 2). Sem isso, as 78 medidas DAX seriam
reimplementadas sobre dados nunca verificados.

## O que tem dentro

| Campo | Para que serve |
|---|---|
| `rowCount` | total **exato** de linhas — é este número que se compara com o Power BI |
| `columns[]` | nome, tipo, nulos, distintos e agregados de cada coluna |
| `columnsFromSample` | `true` = os agregados descrevem só a amostra (veja abaixo) |
| `profiledRows` | quantas linhas alimentaram o perfil de colunas |
| `schemaFingerprint` | hash de nomes+tipos. Mudou = regressão, quebra medidas |
| `dataFingerprint` | hash do que é comparável entre execuções |
| `strategy` | `wrapped` (count exato + amostra) ou `direct` (fallback) |
| `capturedAt` | quando foi capturado; fora dos fingerprints, de propósito |

## Exato vs. amostra — a distinção que importa

`rowCount` é **exato**: vem de um `count(*)` sobre a query inteira. É o número
para conferir com o Power BI.

Os agregados por coluna (`nulls`, `distinct`, `min`, `max`, `sum`) vêm das
primeiras `profiledRows` linhas — 5000 por padrão. Quando `columnsFromSample` é
`true`, eles **descrevem a amostra, não o resultado**. O SQL das specs raramente
tem `ORDER BY`, então quais linhas caem na amostra depende da ordem que o banco
devolveu, e esses números mudam entre execuções sem o dado ter mudado.

Por isso, com `columnsFromSample: true` os agregados ficam **fora** do
`dataFingerprint`. Sem isso o `--check` acusaria regressão em toda query grande.
Um exemplo real: `base-categorias-field` filtra desde 01/01/2026 e tem 233 mil
linhas, mas a amostra de 5000 cobria só a primeira semana de janeiro — o `min`/`max`
de data ali descreve a amostra, não a query.

Para perfilar tudo numa query específica, aumente a amostra acima do total:
`npm run validate:queries -- --only=reincidencia --sample-rows=50000`.

## Por que não guardamos as linhas

Estes arquivos são **commitados**. As queries do Voalle devolvem nome de
cliente, endereço, CPF e protocolo — dado pessoal de cliente real. Então o
golden guarda a **forma** e **agregados** do resultado, nunca os valores:

- strings → faixa de **comprimento**, nunca o conteúdo
- numéricas → **soma** (agregado); `min`/`max` ficam de fora porque são o valor
  literal de um registro (um CPF, um protocolo)
- datas → faixa min/max (necessária para conferir a cobertura temporal)

`--include-values` libera min/max numérico e os valores distintos de colunas com
cardinalidade ≤ 25. **Revise a saída antes de commitar** — aí pode haver valor real.

Os agregados são todos independentes de ordem, então o fingerprint é estável
mesmo nas queries sem `ORDER BY`.

## Uso

```bash
npm run validate:queries                        # captura/atualiza os goldens
npm run validate:queries -- --check             # compara; falha se o schema mudou
npm run validate:queries -- --only=contratos    # só algumas
npm run validate:queries -- --sample-rows=20000 # amostra maior para o perfil
```

No `--check`, a saída separa os dois casos que não podem ser confundidos:

- `[SCHEMA]` — coluna sumiu, trocou de nome, de tipo ou de ordem. **É
  regressão**: quebra qualquer medida construída sobre aquela coluna. Sai com
  código 1.
- `[ dados]` — só os números mudaram. Esperado: o ERP recebe dados todo dia.
