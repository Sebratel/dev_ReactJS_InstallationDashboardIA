# Perguntas que só a operação responde

Coisas que o código não decide. Cada uma tem a evidência do lado, para a conversa
não virar "acho que". O texto de cada pergunta está pronto para copiar e enviar.

Decisão geral do projeto: **replicar fielmente** o comportamento atual
(ver [ACHADOS.md](./ACHADOS.md)). Então nenhuma resposta aqui bloqueia
desenvolvimento — o que elas mudam é se, mais para frente, vale registrar uma
divergência deliberada em relação ao Power BI de hoje.

(A pergunta 3 chegou a ser um bloqueio e foi resolvida no mesmo dia, sem depender de
terceiro: `QUADRO FUNCIONAL` fica no Google Sheets.)

| # | Pergunta | Para quem | Status |
|---|---|---|---|
| 1 | Quanto vale um sábado no cálculo de dia útil? | Fabrício | ⏳ aberta |
| 2 | As 5 medidas sem uso eram de painel descontinuado? (+ 1 relacionamento inativo) | Fabrício | ⏳ aberta (limpeza) |
| 3 | ~~O Data Hub não tem gestor: liberar o campo, ou mapear time → gestor?~~ | — | ✅ resolvida em 05/08/2026: fica no Google Sheets |
| 4 | `categoria4`/`categoria5` de `Base Categorias Field` estão trocadas — é bug ou proposital? | Fabrício | ⏳ aberta |
| 5 | Técnico recontratado contaria duas vezes na produtividade — junta por nome ou por vínculo? | Fabrício | ⏳ aberta (latente: 0 efeito hoje) |

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

## 4. `categoria4`/`categoria5` de `Base Categorias Field` estão trocadas — é bug ou proposital?

**Por que estou perguntando.** O SQL de `Base Categorias Field` junta 5 categorias de
serviço (`ssc1`...`ssc5`), mas o `SELECT` tem um erro de cópia:

```sql
select ai.protocol, ai.beginning_service_date,
    ssc1.title categoria1, ssc2.title categoria2,
    ssc3.title categoria3, ssc4.title categoria3, ssc4.title categoria5
    -- ssc5 é juntado (LEFT JOIN) mas ssc5.title nunca aparece no SELECT
```

`categoria3` é selecionada duas vezes (uma de `ssc3`, outra de `ssc4`), e
`categoria5` repete `ssc4.title` em vez de usar `ssc5.title` — que está ali, juntado,
sem nunca ser lido. O texto do `SELECT` é fixo (não é pivot, não depende do dado, e
já tem data chumbada — achado #3), então não é uma coluna que varia: é sempre assim.

**O efeito no relatório de hoje.** Um passo de Power Query depois (`Table.RenameColumns`)
resolve a colisão dos dois `categoria3` renomeando o segundo para `categoria4` — é assim
que o Power BI evita erro. O resultado prático: `categoria4` e `categoria5`, que deveriam
mostrar a 4ª e a 5ª categoria de serviço, mostram **a mesma coisa** (`ssc4.title` nos
dois), e a 5ª categoria de serviço de verdade nunca aparece em lugar nenhum — mesmo
juntada, ninguém lê. Essas duas colunas aparecem em `manutencao-inicial`
(`specs/dashboards/manutencao-inicial.spec.yaml`).

**A pergunta.**

> Fabrício, achei um erro de cópia no SQL de `Base Categorias Field` — a query que traz
> as até 5 categorias de serviço de um protocolo (usada no painel de manutenção inicial).
>
> A 4ª e a 5ª coluna de categoria (`categoria4` e `categoria5`) hoje mostram exatamente o
> mesmo valor (a 4ª categoria, repetida). A 5ª categoria de serviço de verdade nunca
> aparece — a tabela que ela vem de dentro é buscada, mas ninguém lê o campo certo.
>
> Isso já está assim no relatório atual, não é nada que a plataforma nova introduziu — e
> não estou corrigindo por conta própria porque pode ser que ninguém tenha reparado e
> vocês queiram saber antes de eu replicar um número que parece errado. Faz sentido
> corrigir (mostrar a 5ª categoria de verdade em vez de repetir a 4ª), ou tem algum motivo
> pra ficar como está?

**Se a resposta for "corrige":** troca `ssc4.title categoria5` por `ssc5.title categoria5`
no SQL — no Power BI atual e na spec daqui. Do nosso lado vira divergência deliberada,
registrada em [ACHADOS.md](./ACHADOS.md#19-base-categorias-field-renomeia-uma-coluna-que-o-sql-não-devolve).
**Se a resposta for "fica como está":** replicamos fielmente, sem mudar nada — é a
mesma regra que já vale para as perguntas 1 e 2.

**Impacto se ficar sem resposta:** nenhum a curto prazo. A plataforma replica o
comportamento atual (`categoria4` = `categoria5`, ambas `ssc4.title`) até haver decisão —
o motivo técnico de `categoria32` não aparecer no golden já está resolvido (ver
ACHADOS.md #19); o que falta é só a decisão de negócio sobre o conteúdo.

---

## 3. ~~O Data Hub não tem gestor~~ — RESOLVIDA em 05/08/2026, fica no Google Sheets

**Resolvida pela terceira saída, e sem precisar de ninguém de fora:** `QUADRO FUNCIONAL`
continua lendo do Google Sheets, como o Power BI faz hoje. Nenhuma divergência de fonte,
nenhuma regra de negócio nova. O texto abaixo fica registrado porque descreve uma
alternativa que continua válida se o Data Hub passar a trazer hierarquia — e porque o
diagnóstico (2448 vínculos, 121 CPFs repetidos, três campos de gestor vazios) é útil para
quem for consumir esse dataset para outra coisa.

O que **não** virou pergunta para o Fabrício: o mapa time → gestor. Ele só seria necessário
na saída 2, que não foi escolhida.

---

### O texto original da pergunta

**Por que estou perguntando.** A decisão de 05/08/2026 foi ler `QUADRO FUNCIONAL`
(dado de colaborador) do Data Hub interno em vez da planilha Google Sheets. Sondei a
API antes de escrever o connector, e ela tem tudo **menos** a única coluna que a
mesclagem usa.

**A evidência.** `npm run probe:datahub` contra `/p/dash-instalacao` (dataset
`db-senior-collaborators`), 2448 linhas, 19 campos:

| campo de hierarquia | preenchidos em 2448 linhas |
|---|---|
| `supervisor_name` | **0** |
| `coordinator_name` | **0** |
| `manager_name` | **0** |

E, do lado do Power BI, `PROTOCOLOS PRODUTIVIDADE` puxa da planilha exatamente uma
coluna: `Table.ExpandTableColumn(…, {"GESTOR"}, {"GESTOR"})`. A tabela inteira existe
para trazer o gestor; o resto das 37 colunas ninguém lê.

**O que quebra sem isso.** Não é medida — `[GESTOR]` não aparece em nenhum DAX. É
**slicer**: um em `diario-instalacao`, um em `premiacao-instalacao`, mais um campo de
visual. Coluna vazia = slicer sem opção nenhuma, e o filtro por gestor desses dois
dashboards deixa de existir. Sem erro, sem número torto: só desaparece.

**As três saídas** (a primeira é de longe a melhor):

1. **A publicação `dash-instalacao` preencher `manager_name` ou `supervisor_name`.**
   Os campos já estão no contrato da API — só vêm vazios. Se o Senior tem o dado na
   origem, é mudança na publicação, não no nosso lado. *Pergunta para quem publica.*
2. **Mapear `team` → gestor.** A API traz `team` com 24 valores (`ADM`, `SVA`, `SCM`,
   `GERAL`, `EXTERNO`, `TEC-INST FTTX`…) e `cost_center` com a mesma cardinalidade.
   Se existir "time X responde ao gestor Y", dá para derivar. Mas isso é **regra de
   negócio nova**, não replicação do que existe — precisa vir de alguém, por escrito.
   *Pergunta para o Fabrício.*
3. **`QUADRO FUNCIONAL` fica no Google Sheets** e o Data Hub entra depois, para o
   resto. Custo baixo: a credencial de service account já existe, falta só
   compartilhar a planilha como Leitor. *Decisão do Erick, não precisa de terceiro.*

**Como enviar (opção 1), pronto para copiar:**

> Oi! Estou consumindo a API pública do Data Hub `p/dash-instalacao` (dataset
> `db-senior-collaborators`) para montar o painel de instalação. Vem tudo certo —
> 2448 linhas, os campos de colaborador todos preenchidos. Só que os três campos de
> hierarquia (`supervisor_name`, `coordinator_name`, `manager_name`) vêm `null` em
> 100% das linhas. Preciso do gestor de cada colaborador; hoje esse dado vem de uma
> planilha manual que estou justamente tentando aposentar. A origem no Senior tem
> essa informação? Se tiver, dá para a publicação passar a trazer pelo menos um dos
> três campos?

**Enquanto não houver resposta**, o connector não é escrito e a divergência de fonte
fica registrada mas não implementada (ACHADOS.md #17). Um connector que casa o nome e
devolve `GESTOR` vazio passaria em todo teste de shape e falharia só em produção.

## 5. Técnico recontratado contaria duas vezes na produtividade — junta por nome ou por vínculo?

**Por que estou perguntando.** `QUADRO FUNCIONAL` é ligada aos protocolos pelo
**nome em maiúsculas** (`upper_name = Text.Upper([NOME])`), e nas 535 linhas que o
filtro de gestor deixa passar há **2 nomes repetidos**. Não é erro de cadastro: são
duas recontratações, a mesma pessoa com dois vínculos que não se sobrepõem.

| Nome | Vínculo 1 | Vínculo 2 |
|---|---|---|
| `DJONATA … WEDY` | 28/03/2023 → 27/05/2024, gestor **Luis Aranda** | 19/11/2024 → 25/07/2025, gestor **Pablo Borges** |
| `GABRIEL DA SILVA FREITAS` | 05/11/2024 → 17/06/2025, *Auxiliar*, demitido | em `Recrutamento` de novo, sem admissão, mesmo gestor |

**O número de hoje está certo — e é sorte, não desenho.** Medi: os dois nomes não
aparecem no dado de 2026, porque a consulta que traz o nome do técnico filtra
`out_date > 01/01/2026` e os dois vínculos encerraram em junho e julho de 2025. Então
nenhuma linha está duplicada hoje.

**O que acontece no dia em que um recontratado trabalhar dentro da janela.** A
mesclagem casa por nome e expande as duas linhas do quadro funcional, então **cada
serviço dele passa a valer duas linhas**. No caso de alguém como o `DJONATA`, uma com
`GESTOR = Luis Aranda` e outra com `GESTOR = Pablo Borges`: o mesmo serviço creditado
aos dois gestores ao mesmo tempo, sem olhar em qual vínculo foi executado. No caso do
`GABRIEL`, duas vezes para a mesma gestora. E não aparece como erro em lugar nenhum —
aparece como produtividade um pouco alta demais, e como total que não fecha com a soma
das partes.

**A pergunta, em duas partes:**

1. Quando um técnico é recontratado, o serviço do vínculo antigo deve continuar
   contando para o gestor antigo (é histórico) ou passar para o atual? Hoje conta
   para os dois, o que provavelmente não é o que ninguém pediu.
2. Existe matrícula, CPF ou ID de colaborador que a planilha e o ERP compartilhem?
   Juntar por nome é o que cria o problema — e também significa que **homônimo de
   verdade** já seria misturado hoje, sem aviso. `QUADRO FUNCIONAL` tem `ID`,
   `MATRÍCULA` e `CPF`; o que falta é saber se algum deles existe do lado do ERP.

**Enquanto não houver resposta, a plataforma replica o comportamento atual** — os
mesmos números do Power BI de hoje, duplicação inclusa, porque a regra é replicar
fielmente e um número "corrigido" aqui não fecharia com o relatório que a operação
confere. A correção é de modelagem (juntar por nome **+ período de vínculo**, ou por
matrícula), e muda número que alguém acompanha: não é decisão de quem escreve código.
Detalhe técnico em ACHADOS.md #25.

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
