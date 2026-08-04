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
| `rowCount` | total exato de linhas — **é este número que se compara com o Power BI** |
| `columns[]` | nome, tipo, nulos, distintos e agregados de cada coluna |
| `schemaFingerprint` | hash de nomes+tipos. Mudou = regressão, quebra medidas |
| `dataFingerprint` | hash dos agregados. Muda naturalmente com dado novo no ERP |
| `strategy` | `wrapped` (count exato + amostra) ou `direct` (fallback) |
| `capturedAt` | quando foi capturado; fora dos fingerprints, de propósito |

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
