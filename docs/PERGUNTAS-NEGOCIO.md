# Perguntas que só a operação responde

Coisas que o código não decide. Cada uma tem a evidência do lado, para a conversa
não virar "acho que". O texto de cada pergunta está pronto para copiar e enviar.

Decisão geral do projeto: **replicar fielmente** o comportamento atual
(ver [ACHADOS.md](./ACHADOS.md)). Então nenhuma resposta aqui bloqueia
desenvolvimento — o que elas mudam é se, mais para frente, vale registrar uma
divergência deliberada em relação ao Power BI de hoje.

| # | Pergunta | Para quem | Status |
|---|---|---|---|
| 1 | Quanto vale um sábado no cálculo de dia útil? | Fabrício | ⏳ aberta |
| 2 | As 5 medidas sem uso eram de painel descontinuado? (+ 1 relacionamento inativo) | Fabrício | ⏳ aberta (limpeza) |

---

## 1. Quanto vale um sábado no cálculo de dia útil?

**Por que estou perguntando.** O relatório tem duas contas de "dia útil" que
discordam entre si, e as duas alimentam médias que a operação usa.

**Onde uma diz que sábado vale 1 dia inteiro** — coluna `PESO`, e a decisão está
escrita no próprio cálculo, com data e autor:

```dax
SWITCH(
    'CALENDARIO INSTALADO'[DIA_SEMANA],
    "domingo", 0,
    --"sábado", 0.5, -- Cerqueira afirmou que o sábado era 100% 19/05/2025 12:00
    1
)
```

Essa é a regra que vale para 8 medidas, incluindo `# MEDIA INSTALADO MENSAL`,
`#DIAS_ÚTEIS_TRABALHADOS` e as projeções.

**Onde a outra diz que sábado vale 1,5** — medida `# MEDIA CRIADOS`:

```dax
VAR Dias_Uteis_No_Mes  = ... exclui domingo e feriado ...   -- sábado já entra como 1
VAR Quantidade_Sabados = ... conta os sábados ...
VAR Dias_Uteis_Ajustados = Dias_Uteis_No_Mes + (Quantidade_Sabados * 0.5)
```

`Dias_Uteis_No_Mes` **já conta o sábado como um dia**, porque o filtro só remove
domingo e feriado. Somar 0,5 por sábado leva o sábado a **1,5**.

**O efeito prático.** Um "dia útil ajustado" acima de 1 não corresponde a nada que
exista na operação. Como esse número é o **denominador** de uma média diária, ele
infla e a média de protocolos criados por dia sai **mais baixa do que deveria**
nos meses com sábado trabalhado.

**A pergunta.**

> Fabrício, no cálculo de dia útil, quanto vale um sábado trabalhado?
>
> Pergunto porque o relatório de instalação usa duas regras diferentes. Na coluna
> `PESO` — que alimenta as médias de instalação e as projeções — sábado vale **1
> dia inteiro**, e tem um comentário no cálculo dizendo que foi o Cerqueira que
> definiu isso em 19/05/2025.
>
> Já na medida `# MEDIA CRIADOS` o sábado acaba valendo **1,5 dia**: a conta já
> contava o sábado como 1 e ainda soma outro 0,5 em cima. Como esse valor é o
> divisor da média, a média de protocolos criados por dia está saindo mais baixa
> do que deveria nos meses com sábado.
>
> Se a regra certa é 1 (como no `PESO`), a `# MEDIA CRIADOS` tem um erro de conta
> e o número que a operação vê hoje está subestimado. Se por algum motivo sábado
> realmente conta como 1,5 nessa medida, me diz o porquê que eu registro.
>
> Não estou mudando nada por conta própria — a plataforma nova está replicando o
> comportamento atual como está. Só quero saber qual dos dois números é o certo
> antes de alguém tomar decisão em cima deles.

**Nota de 04/08/2026 — existe uma terceira regra, mas ela não muda a pergunta.**
Ao implementar o avaliador apareceu `CALENDARIO CRIADO[PESO]`, que trata sábado
como **0,5** e traz os feriados chumbados no próprio DAX (2020, 2021 e um
`DATE(2026,6,4)`; nada de 2022 a 2025). Conferi antes de incluir na pergunta:
**nenhuma medida a soma e ela não está em nenhum dos 306 visuais.** É DAX morto,
então não vale ocupar o tempo do Fabrício — fica só registrada em ACHADOS.md #7.
A pergunta continua sendo entre as duas regras que estão em uso.

**Se a resposta for "vale 1":** a correção é remover `+ (Quantidade_Sabados * 0.5)`
de `# MEDIA CRIADOS`. Vale corrigir também no Power BI atual, que é o que a
operação usa hoje. Do nosso lado passa a ser divergência deliberada, registrada em
ACHADOS.md.

---

## 2. As 5 medidas sem uso eram de painel descontinuado?

**Por que estou perguntando.** Cinco das 78 medidas não são usadas por nenhuma
outra medida nem por nenhum dos 306 visuais das 14 páginas. Três delas nem
conseguiriam rodar.

| Medida | Problema | Verificado |
|---|---|---|
| `# AA MÉDIA GERAL` | aponta para `GESTORES[GERENTE/SUPERVISOR]`, tabela inexistente | ❌ não roda |
| `# AA TOTAL EQUIPES` | idem | ❌ não roda |
| `# AA MÉDIA EQUIPES` | aponta para `CAPACIDADE INSTALAÇÃO[EQUIPE_BASE]`, inexistente | ❌ não roda |
| `TOTAL_DIAS` | conta dia-do-mês (1..31) em vez de data — satura em 31 | ⚠️ roda, número enganoso |
| `TOTAL_DIAS_ENCERRADOS` | idem | ⚠️ roda, número enganoso |

Nas três primeiras parece renomeação de tabela: `CAPACIDADE EQUIPE` **tem** uma
coluna `GERENTE/SUPERVISOR`, que é exatamente o que `GESTORES` deveria ter. E
existe uma consulta `GESTORES EQUIPES` que hoje é mesclada dentro de
`PROTOCOLOS GERAL` em vez de virar tabela.

As duas últimas usam `[DATA CRIADO].[Dia]`, que no Power BI é `DAY(data)` — o dia
do mês. `DISTINCTCOUNT` disso nunca passa de 31, então num trimestre daria ~31 em
vez de ~90.

**A pergunta.**

> Fabrício, cinco medidas do relatório de instalação não são usadas em nenhuma das
> 14 páginas, e eu queria saber se são resto de painel antigo antes de deixá-las de
> fora da plataforma nova.
>
> Três são `# AA MÉDIA GERAL`, `# AA TOTAL EQUIPES` e `# AA MÉDIA EQUIPES`. Elas
> apontam para uma tabela `GESTORES` e outra `CAPACIDADE INSTALAÇÃO` que não
> existem mais no modelo — parece que as tabelas foram renomeadas e as medidas
> ficaram para trás. Hoje elas dariam erro se alguém as colocasse numa página.
>
> As outras duas são `TOTAL_DIAS` e `TOTAL_DIAS_ENCERRADOS`. Essas rodam, mas o
> cálculo conta o **dia do mês** em vez da data: o resultado nunca passa de 31, então
> num período de três meses daria 31 em vez de 90. Como ninguém as usa, isso não
> está errando número em tela — mas erraria no dia em que alguém as usasse como
> divisor de uma média.
>
> Eram de algum painel que saiu do ar? Se sim, dá para apagar as cinco e o modelo
> fica mais limpo. Se alguma ainda deveria funcionar, me diz o que ela calculava
> que eu ajusto.
>
> Aproveitando a limpeza: existe também um relacionamento **desativado** entre
> `PROTOCOLOS PRODUTIVIDADE[SOLICITACAO]` e `PROTOCOLOS GERAL[SOLICITACAO]`. Como
> nenhuma medida usa `USERELATIONSHIP`, ele não afeta número nenhum — só fica ali.
> Meu chute é que foi desativado porque criava dois caminhos entre as mesmas
> tabelas (elas já se ligam por `CALENDARIO INSTALADO`) e o Power BI não aceita
> isso. Se for esse o caso, pode apagar junto.

**Nota de 05/08/2026 — o relacionamento inativo.** Entrou como parágrafo aqui em vez
de virar pergunta 3 pelo mesmo critério que deixou o `CALENDARIO CRIADO[PESO]` de
fora: não erra número em tela, então não justifica uma rodada própria de conversa.
Evidência em ACHADOS.md #13 — `USERELATIONSHIP` não aparece em nenhuma das 127
expressões, conferido por varredura, junto com `RELATED`, `ALLEXCEPT` e `CROSSFILTER`.

**Impacto se ficar sem resposta:** nenhum. A plataforma nova entrega 75 medidas em
vez de 78 (as 3 que não rodam), e as 5 ficam registradas em ACHADOS.md #6 e #10.
`TOTAL_DIAS` e `TOTAL_DIAS_ENCERRADOS` são replicadas como estão, defeito incluído.

---

## 6. O card `CLIENTES` da telefonia mostra 466 ou 558?

Esta não é pergunta de negócio — é uma **observação de cinco segundos** que resolve uma
ambiguidade do PBIP. Está aqui porque não tenho como fazê-la sozinho: exige o relatório
aberto.

**O que está ambíguo.** O PBIP grava a agregação de um campo como número
(`Function: 2`). Provei pelo próprio PBIP que esse número se chama `Count` na
nomenclatura da ferramenta (ver ACHADOS.md #28), mas o nome não diz qual das duas
contagens do DAX ele é: `DISTINCTCOUNT` (valores distintos) ou `COUNTA` (linhas não
vazias).

**Quanto isso custa, medido.** Quase nada, e é por isso que não bloqueia nada: das 10
cartas que usam `count`, 8 estão sobre colunas 100% distintas no perfil dos goldens — as
duas leituras dão o mesmo número. Sobram **2 de 64 cards**, os dois sobre `CLIENTE`.

**A observação que decide.** Página `TELEFONIA/OUVIDORIA`, card **`CLIENTES`**:

| Se o card mostra | Então `count` é | E a plataforma usa |
|---|---|---|
| ~466 | contagem distinta | `DISTINCTCOUNT` |
| 558 (igual ao card `PROTOCOLOS`) | contagem de não-vazios | `COUNTA` |

(558 é o total de linhas de `PROTOCOLOS TELEFONIA`; 466 é quantos clientes distintos há
nelas. Os números do dia podem ter mudado — o que importa é se `CLIENTES` está **igual**
a `PROTOCOLOS` ou **menor**.)

**Enquanto não houver resposta**, adoto contagem distinta, com uma evidência de dentro do
próprio relatório: o card que alguém batizou de **`CLIENTES DISTINTOS`** na página
`VISÃO GERAL` usa exatamente essa agregação. Se a tela disser o contrário, muda uma linha.

### 6b. E se for distinta: o vazio conta como um valor?

Descoberto ao testar o card (06/08/2026), e é uma segunda pergunta **dentro** da primeira
— não uma nova. Só importa se a resposta acima for "distinta".

`DISTINCTCOUNT` do DAX conta o **vazio como um valor distinto**; quem o ignora é
`DISTINCTCOUNTNOBLANK`. Então, numa coluna com buracos, o card sai **um a mais** do que a
leitura intuitiva de "quantos valores diferentes existem":

| coluna | valores distintos "de verdade" | `DISTINCTCOUNT` |
|---|---|---|
| Alfa, Alfa, Beta, *(vazio)* | 2 | **3** |

A plataforma usa hoje o comportamento do DAX, que está correto para `DISTINCTCOUNT` — não
foi alterado, e há teste fixando o número (`card.test.ts`). O ponto é que **a mesma
observação de cinco segundos responde as duas perguntas**: se o card `CLIENTES` estiver
entre os dois números da tabela acima (nem 466 nem 558, mas 467), a resposta é "distinta,
e o vazio conta".

Vale conferir se a coluna `CLIENTE` de `PROTOCOLOS TELEFONIA` tem linha vazia — se não
tiver, a sub-pergunta não tem efeito neste card e fica adormecida até aparecer uma coluna
com buraco.

---

## 7. Com `Ano` e `Mês` ativos, o eixo do gráfico mostra `2026 janeiro` ou só `janeiro`?

Também não é pergunta de negócio — é outra **observação de cinco segundos**, e vale
para 10 dos 16 gráficos.

**O que está ambíguo.** A hierarquia de datas chega na spec sempre inteira (`Ano`,
`Mês`, `Dia`), e o `active` diz quais estão na tela (ACHADOS.md #32). Em 10 gráficos
há **mais de um nível ativo ao mesmo tempo**. As duas leituras possíveis são:

| leitura | eixo | `janeiro/2025` e `janeiro/2026` |
|---|---|---|
| **composta** (a que está implementada) | um ponto por combinação dos níveis ativos | dois pontos |
| só o nível mais fino | um ponto por `Mês` | um ponto, com os dois somados |

**Quanto isso custa, medido.** Menos do que parece, e por isso não bloqueia nada: os
gráficos com eixo de data estão filtrados a um período curto, e dentro de um único
ano as duas leituras dão **o mesmo número de pontos e os mesmos valores** — muda só
o rótulo. A diferença só aparece quando o período atravessa o ano, e aí a leitura
errada **soma anos diferentes no mesmo ponto** sem nada indicar.

**A observação que decide.** Qualquer gráfico de `RELATÓRIO DO MÊS` com eixo de
data: se o rótulo do eixo traz o ano junto do mês (ou se há um cabeçalho de ano
acima dos meses), é a leitura composta; se traz só `janeiro`, é a outra.

A plataforma usa hoje a composta, com teste que separa as duas
(`eixo-de-data.test.ts`, "agrupar por ano e mês distingue janeiro de 2025 de janeiro
de 2026").

---

## Pendência que é do Erick, não do Fabrício

Conferir os `rowCount` de `specs/golden/` contra os números do Power BI. Não é
decisão de negócio — é verificar se cada query foi extraída certa. Se um número
divergir, toda medida construída sobre aquela query nasce errada.

**Nota de 05/08/2026 — a conferência é de 6 tabelas, não de 18.** Ao verificar a
camada Power Query apareceu que o `rowCount` do golden é a contagem do **SQL**, e
em **11 das 17** tabelas o M ainda filtra, deduplica ou expande linha depois disso
(`[STATUS] <> "Cancelado"` e `Table.Distinct` por `SOLICITACAO` em
`PROTOCOLOS GERAL`, por exemplo). Nessas 11 os dois números são diferentes **por
construção** — comparar acusaria erro que não existe.

Rode `npm run validate:tables` para ver em qual grupo cada tabela está e qual passo
faz a diferença. Detalhes em ACHADOS.md #15.
