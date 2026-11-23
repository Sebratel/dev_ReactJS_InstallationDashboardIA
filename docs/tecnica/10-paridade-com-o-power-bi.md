# 10. Paridade com o Power BI

Este capítulo é próprio do sistema: a plataforma só substitui o relatório de origem se os números
baterem, e a conferência tem regras que não são evidentes olhando a tela.

## 10.1 O relatório de referência

A referência é **`INST - Relatório Instalação`**. O relatório `INST - ... Gerencial` é outro
produto, com outras regras; usá-lo como gabarito produz resultado plausível e errado.

## 10.2 Janela de comparação

A janela obrigatória está em `backend/specs/_catalog/paridade-janela.yaml`. Ela existe porque o
corte da base e a agregação das medidas usam datas diferentes:

- o piso corta por **DATA CRIADO**;
- as medidas agregam por **DATA INSTALAÇÃO**.

O efeito aparece nas bordas de período — em janeiro, de forma mais visível. Comparar fora da
janela produz divergência legítima que não indica defeito.

## 10.3 Ferramentas

| Comando | Uso |
|---|---|
| `npm run paridade -- --ajuda` | Opções da comparação |
| `npm run powerbi` | Consulta o relatório de origem (somente avaliação) |
| `npm run paginas` | Calcula as páginas com dado real; custoso |
| `npm run layout:valida` | Valida specs e layouts antes de comparar |
| `npm run probe:compara-incremental` | Compara carga incremental com a completa na mesma hora |

O acesso ao Power BI usa o token em `~/.secrets/powerbi-token.json`, renovado automaticamente, e
é restringido por `assertSomenteEvaluate`.

## 10.4 Divergências registradas

`backend/specs/_catalog/divergencias.yaml` guarda as diferenças conhecidas e aceitas entre a
plataforma e o relatório, com o motivo. Antes de abrir investigação, conferir se a divergência já
está registrada ali.

## 10.5 Procedimento de conferência

1. Fixar aba, visual, filtros e período idênticos nos dois lados.
2. Confirmar que o período está dentro da janela de `paridade-janela.yaml`.
3. Comparar o valor agregado — nunca listas de linhas, que contêm dado pessoal.
4. Se divergir, descobrir se o erro está na API ou só na apresentação, consultando a resposta da
   rota e os metadados do visual.
5. Registrar o achado com data em `docs/ACHADOS.md` e, se for diferença aceita, em
   `divergencias.yaml`.

O detalhamento do procedimento está em `docs/PARIDADE-POWERBI.md`.

## 10.6 Estado atual

A paridade **não está fechada**. Nenhuma afirmação de paridade vale sem a janela declarada e o
comando de comparação executado.
