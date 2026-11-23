# 9. Modelo de dados e medidas

## 9.1 Correspondência com o modelo anterior

O modelo é o do relatório `INST - Relatório Instalação`, extraído para YAML e versionado. O
extractor (`backend/tools/extractor/`) gera as specs de dashboard e de medidas a partir dos
artefatos do relatório; o material de origem (M, SQL e DAX) fica no repositório vizinho
`../QUERIES-DASHBOARD-INSTALACAO/`. Não existe arquivo `.pbip` neste repositório.

## 9.2 Modelo semântico

| Arquivo | Conteúdo |
|---|---|
| `backend/specs/_catalog/model.yaml` | Metadados do modelo; `culture: pt-BR` decide como texto vira data |
| `backend/specs/_catalog/tables/*.spec.yaml` | 26 tabelas, com colunas e tipos |
| `backend/specs/_catalog/relationships.yaml` | Relacionamentos entre as tabelas |
| `backend/specs/_catalog/juncoes.yaml` | Junções usadas pelas consultas |
| `backend/specs/_catalog/corte-por-pagina.yaml` | Corte de linhas aplicado por página |
| `backend/specs/_catalog/siglas-cidade.yaml` | Normalização dos nomes de cidade |

As tabelas centrais são `PROTOCOLOS GERAL` (base dos protocolos), `CONTRATOS`, `FIELD AGENDA`,
`INSTALACOES REINCIDENTES`, `APURACAO PREMIACAO`, `BACKLOG INSTALACAO`, `CAPACIDADE EQUIPE` e as
três tabelas de calendário (`CALENDARIO CRIADO`, `CALENDARIO INSTALADO`, `CALENDARIO AGENDAMENTO`),
além de `FERIADOS`.

## 9.3 Medidas

As medidas ficam em `backend/specs/_catalog/measures/`, um arquivo por tabela (12 arquivos).
Cada medida traz nome, `format`, pasta de exibição e o DAX original:

```yaml
- name: "# MEDIA CRIADOS"
  format: "0"
  display_folder: null
  dax: |-
    VAR Total_Criados = CALCULATE(DISTINCTCOUNT('PROTOCOLOS GERAL'[SOLICITACAO]), …)
```

O `measure-engine` faz o parser e a avaliação do DAX; o `format` declarado é o que decide as casas
decimais exibidas no visual. Corrigir um número começa pela cadeia spec da página → medida →
widget-engine → snapshot, e o ponto certo é o primeiro que diverge.

As medidas que dependem de dias úteis excluem domingos e os feriados da tabela `FERIADOS`.

## 9.4 Derivações e desempates

Quando duas linhas disputam o mesmo protocolo, a ordem do `ROW_NUMBER` nas consultas de protocolo
usa o contrato antes do campo `active`. A regra está nas specs das consultas e é coberta por
teste; trocá-la muda silenciosamente contagens de instalação.

## 9.5 Filtros

| Nível | Origem |
|---|---|
| Filtro de página | `filters` da spec do dashboard |
| Filtro de visual | `filters` do visual na spec |
| Filtro da tela | Seletores da barra, codificados em `?filtro=` |
| Filtro de clique | Clique em uma categoria, declarado em `?clicado=` e sujeito à auto-exclusão |

O `widget-engine` combina os quatro e aplica também o `HAVING` quando a spec do visual o exige.

## 9.6 Escalas de cor

As cores das séries e dos realces saem dos tokens de `frontend/src/estilo.css` e são recalculadas
no tema escuro (`corNoTema`), para que nenhuma série desapareça contra o fundo. Hexadecimal solto
não é permitido na interface: cor cheia é fundo e cor escurecida é letra, sempre pelo token de
papel.
