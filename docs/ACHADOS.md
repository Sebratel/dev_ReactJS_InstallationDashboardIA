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

---

## `BACKLOG AGENDADO FUTURO`: nós temos mais linhas que eles

91.335 lá, 147.936 aqui. Não é recorte de data — é o contrário do esperado. No Power BI
a tabela tem 5 colunas (`protocolo_id`, `data_inicio_slot`, `data_carga`); `data_carga`
sugere acumulado diário. Investigar a definição antes de declarar qualquer predicado de
janela.
