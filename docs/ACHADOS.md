# Achados abertos

Defeitos localizados e ainda não corrigidos, com a medição que os isolou. Cada um traz
o que já foi descartado, para ninguém repetir a investigação.

---

## `INSTALADOR` tem 94 pessoas onde o Power BI tem 166

**Sintoma.** A medida `Média Geral` dá 4,3657 aqui e 3,8998 no modelo publicado (11%).

**Não é janela.** Com o recorte de `specs/_catalog/paridade-janela.yaml` aplicado, as
outras medidas da página batem: `Total Protocolos` 35.096 × 35.090, `Total Dias`
197 × 197, `Média Protocolos por Dia` 178,15 × 178,12. As duas tabelas têm as mesmas
linhas (70.879 × 70.868).

**Não é o motor de medidas.** Recalculando o DAX à mão sobre a nossa coluna 45,
incluindo o grupo em branco, sai **4,3657** — exatamente o que o motor devolveu. Ele
está certo sobre os dados que tem.

**Não é o Power BI que regrediu.** A tela em 11/08/2026 mostrava 3,9 e a API hoje
devolve 3,8998. As duas leituras concordam; a diferente é a nossa. (Contraste com
`Reincidentes`, onde é o inverso — ver `specs/_catalog/paridade-janela.yaml`.)

**É a coluna.** Valores distintos sob o mesmo corte:

| coluna | Power BI | nós |
|---|---|---|
| TÉCNICO INSTALAÇÃO | 94 | 93 |
| TÉCNICO TROCA | 71 | 70 |
| TECNICOS AUXILIARES.AUXILIAR | 138 | 138 |
| **INSTALADOR** | **166** | **94** |

Nosso SQL (`docs/sql/datahub-protocolos-produtividade.sql`, ~linha 419) deriva:

```sql
CASE WHEN "TIPO DE PROTOCOLO" = 'TEC - Troca de Endereço'
     THEN _tecnico_troca ELSE _alocado_por END  AS "INSTALADOR"
```

e `_alocado_por` é o **mesmo** campo de `TÉCNICO INSTALAÇÃO` (linha 397) — por isso as
duas colunas empatam em 93/94 aqui, enquanto lá são 94 e 166.

`INSTALADOR_PAD` e `instalador_Unificado` derivam de `[INSTALADOR]`, então herdam o
erro (94 aqui, 166 lá).

**Onde está o que falta.** Nas linhas SEM alocador, o `INSTALADOR` do Power BI tem
**141 nomes distintos**. Destes, só 4.376 linhas casam com `TÉCNICO TROCA` e **3** com
o auxiliar. Sobram ~5.400 linhas cujo instalador não corresponde a nenhuma coluna que
materializamos: **a fonte desse ramo não existe no nosso SQL**.

**A fonte que falta: o TÉCNICO AUXILIAR do protocolo.** Descoberto varrendo as 39
colunas de texto do modelo publicado (nenhuma casa) e depois cruzando os nomes contra o
nosso snapshot:

- os 116 instaladores que só eles têm existem **100%** na nossa coluna
  `tecnicos auxiliares.auxiliar` (índice 44);
- em **5.391 das 5.395** linhas órfãs (99,9%), o `INSTALADOR` deles é um auxiliar
  **do mesmo protocolo**;
- não há ambiguidade de escolha: todos esses 5.395 protocolos têm **exatamente um**
  auxiliar.

Ou seja: os nomes nunca se perderam na carga. Eles estão no snapshot e simplesmente
nunca são promovidos a instalador.

**O conserto ingênuo NÃO funciona — já testado, não repetir.** Simulando
`COALESCE(instalador, auxiliar_do_protocolo)` sobre o snapshot:

| | hoje | com a regra | Power BI |
|---|---|---|---|
| instaladores distintos | 94 | 158 | 166 |
| linhas em branco | 17.486 | 15.149 | 16.777 |
| `Média Geral` | 4,3657 | **20,0354** | 3,8998 |

Aproxima a cardinalidade e piora a medida em 5×, porque preenche linhas demais
(15.149 brancos contra 16.777 deles).

**O que falta é a PRECEDÊNCIA, e o nosso ramo de troca é parte do problema.** Das 9.771
linhas sem alocador que o Power BI preenche, apenas **4.376** vêm de `TÉCNICO TROCA` e
5.395 do auxiliar. O nosso `CASE WHEN tipo = 'TEC - Troca de Endereço'` preenche
**8.740** — quase o dobro. Os dois erros se cancelavam parcialmente na contagem de
brancos, que foi o que escondeu o problema até agora.

**Pista falsa já descartada:** `DATA INSTALAÇÃO` não tem nada a ver. Vazia em 17.307
linhas lá e 17.308 aqui.

**Variantes de precedência já testadas e REPROVADAS** (não repetir):

| regra | distintos | brancos | `Média Geral` |
|---|---|---|---|
| hoje: `CASE tipo troca ELSE aloc` | 94 | 17.486 | 4,3657 |
| `COALESCE(aloc, troca, aux)` | 158 | 15.146 | 31,61 |
| `COALESCE(aloc, aux, troca)` | 164 | 15.146 | 25,67 |
| `CASE ... ELSE aloc`, + aux | 158 | 15.149 | 20,04 |
| aux só em linha com data de instalação | 129 | 17.311 | 25,34 |
| **alvo (Power BI)** | **166** | **16.777** | **3,8998** |

**Alvos numéricos para testar qualquer candidata rapidamente.** `Média Geral` é
`AVERAGEX` sobre pessoas, então é dominada por grupos pequenos e extremos — um técnico
com 40 protocolos num único dia contribui com 40. Decompondo o alvo:

- soma das razões: **647,3748** sobre **166** grupos;
- o grupo EM BRANCO contribui **62,7891** sozinho;
- os outros 165 somam 584,59, média **3,5429**.

Nosso lado hoje: 94 grupos com média 3,3704 e o branco em **97,9**. Somar auxiliares
leva a 129 grupos mas derruba a média para **2,71** — *afasta* do 3,5429. Ou seja, o
problema não é só "faltam pessoas": a atribuição de linhas por pessoa também difere,
provavelmente em como a lista de `TECNICOS AUXILIARES` é expandida.

**Para destravar:** ler o passo M do `INSTALADOR` no PBIP original. As tentativas
empíricas acima não convergem, e a interseção mais estranha continua sem explicação —
10.550 linhas são do tipo troca sem alocador, mas só 4.376 acabam com o nome do técnico
de troca.

---

## Carga de `field-agenda` está quebrada

`snapshot/field-agenda.erro.log`: `ECONNRESET` em 19/08/2026 após 2.294.200 ms
(38 min) calculando colunas. O arquivo em disco é o que sobrou da carga que morreu.

Some-se a isso que as duas tabelas nem têm a mesma definição — o nosso SQL filtra
região (`Base Canoas (Ativação)`, `Base São Leopoldo (Ativação)`) e exclui relatos por
título, o modelo publicado não. 1.587.041 linhas lá contra 41.255 aqui, e o recorte de
3 meses do SQL sozinho só explica até 641.996.

Enquanto isso, `FIELD AGENDA` está em `bloqueadas` na paridade — 7 medidas ficam sem
gabarito automático. Resolver a carga antes de tentar equalizar.

### A janela de 3 meses tinha saído do `sql:` (achado de 27/08/2026)

O recorte de 3 meses citado acima **não estava mais na spec** quando fui conferir. O
`sql:` de `field-agenda` cortava em `DATE '2026-01-01'` — o valor extraído do PBIP —
porque um `git reset --hard` de outro agente em 26/08 devolveu o campo à versão
gerada, junto com o SQL de dois ramos de `protocolos-produtividade`.

Restaurado em 27/08 (`docs/SPEC-DRIVEN.md`, "Edições à mão em spec gerada"). Não de
memória — por três medidas que fecham entre si:

| Evidência | O que diz |
|---|---|
| `tools/probe/src/custo-incremental.ts:75-81` | declara "janela deslizante" e casa `(CURRENT_DATE - INTERVAL '3 months')` — uma sonda procurando literal que ninguém escrevia |
| `snapshot/field-agenda.jsonl` | gerado 25/08; mínimo de `slot agenda` = **2026-05-25**, que é 25/08 − 3 meses ao dia |
| `data criado` no mesmo arquivo | desce a **2025-10-24**, então o corte é em `begin_date_slot` e em nenhum outro campo |

**A janela do snapshot em disco, medida (41.773 linhas, 26 colunas):**

| coluna | com data | nulo | min | max | dias |
|---|---|---|---|---|---|
| data criado | 41.773 | 0 | 2025-10-24 | 2026-08-25 | 101 |
| slot agenda | 41.773 | 0 | **2026-05-25** | 2026-09-05 | 87 |
| data relato | 41.773 | 0 | 2025-10-24 | 2026-08-25 | 84 |
| data ultimo play app | 30.808 | 10.965 | 2026-05-25 | 2026-08-25 | 85 |

Sem a janela, a próxima carga completa buscaria ~8 meses em vez de 3, na query que já
morreu de `ECONNRESET`. Regressão silenciosa: mais linhas, nenhum erro.

### O snapshot de `protocolos-produtividade` estava À FRENTE da spec — RESOLVIDO em 27/08

O cabeçalho real do arquivo em disco (`snapshot/protocolos-produtividade.jsonl`,
25/08 19:34) dizia:

```
linhas=70991  modo=completo  marca=2026-08-25T00:00:00.000Z
```

**70.991 é o número dos DOIS RAMOS** — o `UNION ALL` que reproduz o `INSTALADOR`.
O `sql:` da spec tinha voltado a ter um ramo só e daria **70.868**. Ou seja: o dado
em disco era a saída de um SQL que a spec já não continha, e a próxima carga
derrubaria 123 linhas e esvaziaria o `INSTALADOR`, sem erro e sem teste vermelho.

**E eu escrevi aqui que isso não era recuperável. Estava errado.**

O SQL de produção **nunca esteve perdido**: mora em
`docs/sql/datahub-protocolos-produtividade.sql`, 422 linhas, e o cabeçalho dele diz
*"ESTE SQL É O QUE RODA EM PRODUÇÃO DESDE 25/08/2026 ... o campo `sql:` da spec é
uma cópia deste arquivo"*. O que o `git reset --hard` apagou foi a **cópia**. A
busca que me fez errar procurava `ramo_auxiliares` só em `specs/` — e ele estava em
`docs/`.

Restaurado por cópia verbatim em 27/08. Medido:

| | antes | depois |
|---|---|---|
| `sql:` da spec | 100 linhas / 3.636 chars | **422 linhas / 23.264 chars** |
| `ramo_produtividade` | 0 | 3 |
| `ramo_auxiliares` | 0 | 3 |
| `UNION ALL` | 0 | 1 |
| `"INSTALADOR"` | 0 | 1 |
| idêntico ao doc | não | **sim** |

A costura incremental foi conferida sobre o SQL restaurado, sem tocar no banco:
422 → 457 linhas, `WITH alvos AS (` 1x, `AND a.title IN (SELECT title FROM alvos)`
1x, `:desde` 3x, parênteses com saldo 0 e mínimo 0. A âncora de duas linhas voltou
ao original — com o comentário `-- o mais largo dos dois ramos`, que é o
desambiguador contra o `a.created >= '2026-01-01'` que o próprio ramo 3 do `alvos`
insere.

**O guard que faltava.** O teste "a política de verdade do catálogo carrega e
costura o SQL de produção" já existia e **passou verde o dia 26 inteiro com o SQL
errado** — ele guardava a ÂNCORA, não o CONTEÚDO. O novo teste
`o sql: de protocolos-produtividade é cópia FIEL do SQL de produção em docs/`
compara os dois arquivos byte a byte. Conferi que ele falha: removendo uma linha do
`UNION ALL`, ele quebra com mensagem nomeada — e o teste antigo continua passando.

**Falta MEDIR contra o banco.** A contagem esperada é 70.991 (o que está em disco),
mas o dado andou desde 25/08. Uma carga completa custa ~190 s de dbVoalle e uma
incremental ~67 s. Só depois dessa medição o `pbi:`/`nos:` de
`specs/_catalog/paridade-janela.yaml` (que registra `nos: 70868`) pode ser corrigido.

## `BACKLOG AGENDADO FUTURO`: nós temos mais linhas que eles

91.335 lá, 147.936 aqui. Não é recorte de data — é o contrário do esperado. No Power BI
a tabela tem 5 colunas (`protocolo_id`, `data_inicio_slot`, `data_carga`); `data_carga`
sugere acumulado diário. Investigar a definição antes de declarar qualquer predicado de
janela.
