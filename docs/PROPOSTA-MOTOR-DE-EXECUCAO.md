# Proposta: separar o DAX que **especifica** do motor que **executa**

> **Estado: proposta, não decisão.** Nomeada `PROPOSTA-` de propósito — os `DECISAO-`
> deste repositório são coisas fechadas. Isto espera o "vai" do Erick, porque envolve
> uma dependência nativa nova e algumas semanas de compilador.
>
> Perguntado em 11/08/2026: *"como poderíamos reduzir esse tempo? nem tudo precisa ser
> realtime, talvez trazer tudo aos poucos… talvez até mudar stacks ou arquitetura, DAX
> talvez não seria a melhor opção"*.

## O diagnóstico

Os 104 minutos de `agendamento-field` não são lentidão difusa. Têm nome.

Das **78 medidas** do modelo, a segunda função mais usada é `DISTINCTCOUNT`, com **37
usos** — quase todos dentro de `CALCULATE(…, FILTER(…))`:

| coluna contada | usos |
|---|---|
| `'PROTOCOLOS GERAL'[SOLICITACAO]` | 12 |
| `'PROTOCOLOS PRODUTIVIDADE'[N°PROTOCOLO]` | 8 |
| `'FIELD AGENDA'[Protocolo]` | **8** — sobre 1.458.244 linhas |
| `'PROTOCOLOS GERAL'[N°PROTOCOLO]` | 3 |
| outras (datas, reincidentes, `Status Protocolo Dia`) | 6 |

O avaliador executa isso como **laço de linha em JavaScript**, refazendo o contexto de
filtro por linha, por célula, por medida. O custo é
`O(linhas × células × medidas)` — e `DISTINCTCOUNT` ainda mantém um `Set` vivo em cada
passagem. Não existe constante que salve essa forma.

**Esta é a operação que motor colunar existe para fazer.** Agregação com hash,
vetorizada, sobre coluna contígua.

## A ideia central: o DAX vira especificação, não implementação

Hoje o DAX é as duas coisas ao mesmo tempo, e é isso que amarra a lentidão ao projeto:

| papel | quem faz hoje | quem deveria fazer |
|---|---|---|
| **o que o número significa** (regra de negócio, auditável contra o Power BI) | o DAX | **o DAX — não muda** |
| **onde e quando o número é calculado** | avaliador DAX em JS, no request | SQL num motor colunar, no request; e o refresh para o que puder |

Dá para trocar o segundo sem tocar no primeiro. As medidas continuam sendo a fonte da
verdade e continuam vindo do PBIP pelo extractor — muda o **executor**.

### O truque que torna a troca segura: o avaliador vira oráculo

A objeção óbvia é de sequência: *não troque o motor antes da paridade estar provada,
senão uma divergência fica sem dono — foi a migração ou foi o motor novo?*

A saída é transitividade:

1. Rodar o avaliador JS de hoje **uma vez**, offline, por página, e gravar **todo valor
   de card** como fixture golden.
2. O teste passa a exigir `SQL == fixture`.
3. A paridade `fixture == Power BI` é a conferência que já está no plano (os 42 valores
   ditados).
4. Transitividade dá `SQL == Power BI` sem reditar nada.

E aqui está o reenquadramento que destrava tudo: **104 minutos é inaceitável por
request e perfeitamente aceitável uma vez só.** O avaliador lento deixa de ser o
caminho de produção e passa a ser o instrumento de medição — que é o papel em que a
lentidão dele não incomoda ninguém.

Isso também satisfaz a regra de teste do projeto: mexer numa regra compilada errado
quebra o fixture. O teste falha quando a regra desaparece.

## A estratégia, na ordem que a medição dita

### Etapa 0 — agregar ao grão, no refresh *(já é o passo 4 da DECISAO-DESEMPENHO)*

`FIELD AGENDA` tem 1.458.244 linhas e **30.252** pares distintos
`(protocolo, slot agenda)` — o grão que a página realmente usa. **48x menos linha.**

Vale fazer **independente de motor**: é correção de modelagem, e barateia todas as
etapas seguintes. Projeção linear: 104 min → ~2 min. Ainda longe dos 300 ms, mas outro
universo.

⚠️ Exige saber, visual por visual, qual mede *slot* e qual mede *relato*. É a etapa
delicada, não a difícil.

### Etapa 1 — Parquet + DuckDB como motor de execução *(a estrutural)*

- **Armazenamento:** o snapshot passa a escrever **Parquet** além do JSONL. É o "passo
  5 — formato colunar" da DECISAO-DESEMPENHO, promovido: ele estava por último porque
  otimizar `parse` de dado que não deveria ser carregado é a ordem errada — mas com
  DuckDB o Parquet não é sobre `parse`, é sobre **não materializar linha nenhuma**.
- **Execução:** compilar `MeasureSpec` + `FiltroSpec` → SQL, e rodar no DuckDB.
- **Híbrido explícito:** a cauda difícil (~13 usos: `AVERAGEX`, `TREATAS`, `INTERSECT`,
  `ISINSCOPE`, `SELECTCOLUMNS`) **continua no avaliador JS**. O compilador **erra alto**
  quando não sabe compilar uma medida e cai no avaliador **dizendo que caiu**. Nunca em
  silêncio — BLANK calado é a única classe de erro que este projeto não pode cometer.

Projeção: `DISTINCTCOUNT` sobre 1,46 milhão de linhas em DuckDB fica na casta de
**dezenas a centenas de ms**. A página inteira entra no orçamento de 2 s **mesmo sem a
etapa 0**. ⚠️ **Projeção, não medida** — a primeira coisa a fazer é o benchmark
(ver "O que fazer primeiro").

### Etapa 2 — cadência de refresh *("nem tudo precisa ser realtime")*

Está certíssimo, e o orçamento já autoriza: *"refazer o snapshot — sem teto"*.

- O dado de instalação é de grão **dia**. Refresh cheio noturno + delta intradiário só
  de hoje.
- Materializar no refresh o payload da visão **sem filtro** de cada página: abrir a
  página passa a ser leitura de arquivo.

### ⚠️ A armadilha da pré-agregação, que a etapa 1 dissolve

A ideia natural de "trazer tudo aos poucos" é materializar um **cubo** no grão das
colunas de segmentação, e a seleção do slicer soma a fatia. **Não funciona aqui:**
`DISTINCTCOUNT` **não é aditivo.** Não se soma contagem distinta de duas células — o
mesmo protocolo aparece nas duas e vira dois. Com 37 usos de `DISTINCTCOUNT`, o cubo
erraria na maioria dos cards.

As saídas seriam sketch (`approx_count_distinct` — "aproximado" bate de frente com a
proibição de número errado) ou guardar o conjunto de protocolos por célula (caro).

**Conclusão: com a etapa 1, o cubo fica desnecessário** — a consulta ao vivo é rápida o
bastante. A etapa 1 elimina o trabalho da etapa 2b em vez de somar a ele.

### Etapa 3 — carregamento progressivo na tela

Um pedido por visual (`?visual=` já existe, e o avaliador já é cacheado por página).
Depois da etapa 1 isso é cosmético, não estrutural. Ver DECISAO-TELA §3b.

## "Mudar stacks" — o que muda e o que não

**Não muda: Node, React, Vite, `node:http`.** O problema não é a velocidade da
linguagem: é row store + DAX interpretado + contexto de filtro por linha. O mesmo
código em Go ou Rust continuaria muito atrás de um motor colunar vetorizado, porque a
forma do algoritmo é que está errada. Reescrever a stack seria pagar caro por um ganho
de constante quando o que falta é mudança de ordem de grandeza.

**Muda: a camada de execução.** Por que DuckDB, e não os outros:

| candidato | veredito |
|---|---|
| **DuckDB** | ✅ embutido (zero ops), colunar vetorizado, lê Parquet nativo, binding Node maduro (`@duckdb/node-api`), artefato único. Casa com o "um processo, uma porta" que o projeto já valoriza |
| ClickHouse | ❌ servidor para operar, monitorar e versionar — peso desproporcional para relatório interno |
| Postgres de analytics | ❌ resolve, mas é mais um servidor. E o `dbVoalle` é read-only de propósito: não entra carga nele |
| Polars | ❌ rápido, mas história de SQL e de binding Node mais fraca — e SQL é o que deixa o compilador auditável |
| SQLite | ❌ row store. Ajudaria pouco justamente nas agregações que doem |
| empurrar para o ERP | ❌ viola a regra de não pôr carga no ERP |

**Custo honesto do DuckDB:** é dependência **nativa**. Build e deploy no Windows passam
a ter um binário, o que hoje não têm (o repositório roda TypeScript direto, sem passo de
build no servidor). É o principal argumento contra, e precisa ser aceito de olho aberto.

## Riscos, sem maquiagem

1. **Lacuna semântica DAX → SQL.** Propagação de contexto de filtro por relacionamento,
   BLANK vs zero, `DIVIDE` por zero que dá BLANK e não erro, os níveis de hierarquia de
   data. Cada um é testável contra o oráculo — e é por isso que o oráculo vem antes.
2. **O compilador é trabalho de verdade.** Os ~95% mecânicos não são triviais; a cauda
   fica no híbrido de propósito.
3. **Dependência nativa** (acima).
4. **Sequência.** A etapa 0 e o oráculo da etapa 2 são pré-requisitos do corte. Cortar
   antes é trocar lento-e-certo por rápido-e-não-sei — o que a DECISAO-DESEMPENHO
   proíbe na primeira linha do "não autoriza".

## Esforço × impacto

| etapa | esforço | impacto | risco |
|---|---|---|---|
| 0 — grão no refresh | médio | 104 min → ~2 min (48x) | médio (exige saber slot vs relato) |
| oráculo golden (etapa 2 do truque) | **baixo** | zero em tempo, **destrava tudo** | baixo |
| 1 — Parquet + DuckDB | **alto** | ~2 min → dezenas de ms | médio |
| 2 — cadência de refresh | baixo | abertura vira leitura de arquivo | baixo |
| 3 — progressivo na tela | baixo | percepção | baixo |
| ~~cubo pré-agregado~~ | alto | **negativo** — `DISTINCTCOUNT` não é aditivo | alto |

## O que fazer primeiro

**Um benchmark, antes de qualquer commit de arquitetura.** Escrever
`field-agenda.jsonl` em Parquet e rodar em DuckDB os oito `DISTINCTCOUNT` de
`'FIELD AGENDA'[Protocolo]` com os `WHERE` correspondentes. Isso responde, em uma tarde
e sem compromisso, a única pergunta que decide a proposta: **a projeção de "dezenas de
ms" se confirma?**

Se confirmar, a ordem é: oráculo golden → etapa 0 → etapa 1 → etapa 2 → etapa 3.
Se não confirmar, a etapa 0 sozinha já vale, e esta proposta morre com a medição
registrada — como as três hipóteses das "Hipóteses mortas" da DECISAO-DESEMPENHO.
