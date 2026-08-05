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
| 2 | As 5 medidas sem uso eram de painel descontinuado? | Fabrício | ⏳ aberta (limpeza) |

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

**Impacto se ficar sem resposta:** nenhum. A plataforma nova entrega 75 medidas em
vez de 78 (as 3 que não rodam), e as 5 ficam registradas em ACHADOS.md #6 e #10.
`TOTAL_DIAS` e `TOTAL_DIAS_ENCERRADOS` são replicadas como estão, defeito incluído.

---

## Pendência que é do Erick, não do Fabrício

Conferir os 18 `rowCount` de `specs/golden/` contra os números do Power BI. Não é
decisão de negócio — é verificar se cada query foi extraída certa. Se um número
divergir, toda medida construída sobre aquela query nasce errada.
