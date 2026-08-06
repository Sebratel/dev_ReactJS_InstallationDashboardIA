# Achados sobre o comportamento atual

Coisas descobertas ao ler a base atual que **não** são bug do código novo — são
comportamento do Power BI de hoje, ou dependências dele. Ficam aqui porque
`specs/` é sobrescrito por `npm run extract` e nenhuma decisão humana pode viver lá.

## Decisão vigente

> **Replicar fielmente.** — Erick, 04/08/2026

Vale para **todos** os achados abaixo. A plataforma nova reproduz o comportamento
atual como ele é, inclusive onde ele parece errado. Nada aqui é "consertado" sem
uma decisão nova e explícita, registrada nesta seção.

Consequência prática por achado:

| Achado | O que a Fase 2b faz |
|---|---|
| 2 — `field-agenda` infla por skill | mantém o `LEFT JOIN person_skills`, 1,4 mi de linhas. Nenhum `string_agg` |
| 3 — data chumbada em `base-categorias-field` | mantém `> '2026-01-01'` literal |
| 6 — 3 medidas apontam para tabela inexistente | **não** reimplementa: replicar fiel de "sem resultado" é não ter resultado. Alvo = **75 medidas** |
| 7 — três definições de dia útil, sábado vale 1, 1,5 e 0,5 | reproduz as três como estão, cada uma com sua regra |
| 10 — `TOTAL_DIAS` conta dia do mês, não data | replica. Nada consome as duas medidas, então não há número errado em tela |
| 11 — `DISTINCTCOUNT` sobre tabela vazia | suposição isolada em uma linha do código, a conferir contra o Power BI |
| 12 — `ISINSCOPE` depende do visual | erra alto. A medida que a usa fica para a Fase 3: são **74** medidas agora, não 75 |

### Divergências deliberadas em relação ao Power BI

Uma só até agora, registrada aqui porque a decisão vigente exige que qualquer desvio
seja explícito:

| Onde | Power BI | Aqui | Por quê |
|---|---|---|---|
| `CALENDAR` com extremo BLANK (05/08/2026, fase 2b.7) | BLANK vale 0 = 30/12/1899, e gera **~46 mil dias** sem reclamar | erra alto e para a materialização | `CALENDARIO INSTALADO` começa em `MIN('PROTOCOLOS GERAL'[DATA INSTALAÇÃO])`. Uma tabela de datas grande demais não aparece como erro — aparece como toda média por dia útil errada |

Não muda número nenhum hoje: a coluna não vem vazia. É um desvio que só se manifesta
no dia em que ela vier.

O único item que **ainda depende de você** é a conferência dos `rowCount` contra
o Power BI (`specs/golden/`), que você pediu para deixar para depois. Isso não é
decisão de comportamento — é a verificação de que a query foi extraída certa.

> **Leia o achado 15 antes de conferir.** O `rowCount` do golden é a contagem do
> **SQL**, e em **11 das 17** tabelas o Power Query ainda filtra, deduplica ou
> expande linha depois disso. Nessas 11 os dois números são diferentes por
> construção, e divergência não indica extração errada. Comparável em 6.

Duas perguntas de negócio seguem abertas com o Fabrício, com o texto pronto para
enviar em [PERGUNTAS-NEGOCIO.md](./PERGUNTAS-NEGOCIO.md). Nenhuma bloqueia
desenvolvimento: elas decidem se, mais para frente, vale registrar uma divergência
deliberada em relação ao Power BI atual.

---

## 1. ~~A tabela FERIADOS para em 2025~~ — SEM FUNDAMENTO, retirado

**Este achado estava errado. A tabela FERIADOS está completa.** Fica registrado
porque foi levado adiante em duas sessões e chegou a ser preparado como pergunta
para a operação.

**O que a tabela tem de verdade:** 85 linhas, de **01/01/2022 a 25/12/2030**, com
feriado em todo ano do intervalo — **10 em 2026**:

| Ano | 2022 | 2023 | 2024 | 2025 | 2026 | 2027 | 2028 | 2029 | 2030 |
|---|---|---|---|---|---|---|---|---|---|
| Feriados | 9 | 9 | 9 | 12 | **10** | 9 | 9 | 9 | 9 |

**Como o erro aconteceu.** As datas no blob são texto `DD/MM/YYYY`. Ordenei com
`sort()` direto, que compara string: a ordenação saiu por **dia**, não por data.
`"04/03/2025"` era só a maior string do conjunto, e eu li isso como "a tabela
para em março de 2025".

```js
// ERRADO — ordena "30/03/2029" antes de "04/01/2030"
datas.sort()

// CERTO — converte para ISO antes de comparar
const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(data);
const iso = `${m[3]}-${m[2]}-${m[1]}`;
```

**Lição que vale para o resto do projeto:** data em texto no formato brasileiro
não se ordena nem se compara direto. Isso vai reaparecer — várias colunas das
queries chegam como `DD/MM/YYYY`.

**Verificação (esta roda certo):**

```bash
node --input-type=module -e "
import fs from 'node:fs'; import zlib from 'node:zlib'; import {parse} from 'yaml';
const s = parse(fs.readFileSync('specs/_catalog/queries/feriados.spec.yaml','utf8'));
const b64 = /Binary.FromText\(\"([^\"]+)\"/.exec(s.m_expression)[1];
const rows = JSON.parse(zlib.inflateRawSync(Buffer.from(b64,'base64')).toString());
const iso = rows.map(r => String(r[0]).replace(/^(\d{2})\/(\d{2})\/(\d{4})/, '\$3-\$2-\$1')).sort();
console.log(rows.length, 'linhas |', iso[0], '->', iso[iso.length-1]);
const anos = {};
for (const d of iso) anos[d.slice(0,4)] = (anos[d.slice(0,4)] || 0) + 1;
console.log(anos);
"
```

**O que segue valendo deste achado.** A dependência que ele mapeou é real e
importa para a Fase 2b, só não é um defeito: a coluna calculada **`PESO`** — em
`CALENDARIO INSTALADO` e em `CALENDARIO CRIADO` — consulta FERIADOS, e oito
medidas somam essa coluna. Então **11 das 78 medidas dependem de FERIADOS**, e o
avaliador precisa da tabela carregada para calcular qualquer uma delas.

**Melhoria que continua valendo.** Feriado é dado que muda todo ano e hoje mora
dentro de um `.pbix` de 73 MB, num blob Base64. Vale virar tabela de verdade —
mas como evolução, não correção. Hoje ela cobre até 2030, então não é urgente.

```dax
// CALENDARIO INSTALADO[PESO] — consulta FERIADOS; a tabela está completa,
// então o feriado recebe peso 0 como se pretendia.
VAR Feriado = NOT(ISBLANK(LOOKUPVALUE(FERIADOS[Feriado], FERIADOS[Data],
                                     'CALENDARIO INSTALADO'[DATA INSTALADO])))
RETURN IF(Feriado, 0, SWITCH('CALENDARIO INSTALADO'[DIA_SEMANA], "domingo", 0, 1))
```

Fecho transitivo — a **ordem de carga** da Fase 2b, não uma lista de defeitos:

| Caminho | Medidas |
|---|---|
| Direto em FERIADOS | `# MEDIA CRIADOS` |
| Somam `[PESO]` | `# PROJEÇÃO`, `# MEDIA AGENDADO`, `# PROJEÇÃO AGENDADA FUTUROS`, `# PROJEÇÃO AGENDADA RESTANTE`, `# MEDIA INSTALADO BACKLOG`, `# MEDIA INSTALADO MENSAL`, `#DIAS_ÚTEIS_TRABALHADOS`, `DIAS_ÚTEIS_RESTANTES_NO_MÊS` |
| Via outra medida afetada | `# PROJEÇÃO AGENDADA TOTAL`, `# BACKLOG` |

**Como refazer a lista das 11:**

```bash
node --input-type=module -e "
import { SemanticModel } from './packages/semantic-model/src/model.ts';
import { extractRefs } from './packages/semantic-model/src/refs.ts';
const m = SemanticModel.fromSpecsDir('specs');
const hit = new Set(m.measures
  .filter(x => /FERIADOS/i.test(x.dax) || /\[PESO\]/i.test(x.dax))
  .map(x => x.name.toLowerCase()));
for (let mudou = true; mudou;) {           // fecho transitivo: medida que usa medida afetada
  mudou = false;
  for (const med of m.measures) {
    if (hit.has(med.name.toLowerCase())) continue;
    if (extractRefs(med.dax).some(r => r.kind === 'bare' && hit.has(r.name.toLowerCase()))) {
      hit.add(med.name.toLowerCase()); mudou = true;
    }
  }
}
console.log(hit.size);
for (const med of m.measures) if (hit.has(med.name.toLowerCase())) console.log(med.table+'['+med.name+']');
"
```

---

## 2. `field-agenda` multiplica linha por skill do relator (1,4 milhão de linhas)

**Evidência.** `npm run validate:queries` devolveu **1.435.852 linhas** para
`field-agenda` — 74% de todas as linhas das 18 queries somadas. O SQL:

```sql
FROM v_service_desk_slots_productivity_informative vsdspi
LEFT JOIN reports r        ON vsdspi.assignment_id = r.assignment_id
LEFT JOIN people p         ON p.id = r.person_id
LEFT JOIN person_skills ps ON ps.person_id = p.id   -- <<< 1 linha por skill
LEFT JOIN skills s         ON s.id = ps.skill_id
WHERE vsdspi.begin_date_slot >= DATE '2026-01-01'
```

`person_skills` é 1:N. Cada relato é replicado **uma vez por skill do relator**.
Um técnico com 8 skills gera 8 linhas idênticas exceto a coluna `Skill`.

**Por que importa.** Qualquer `COUNT` sem `DISTINCT` sobre essa tabela conta
inflado, e o fator de inflação varia por técnico. Note que as medidas de
`protocolos-geral` usam `DISTINCTCOUNT` — indício de que alguém já tropeçou nisso.

**Decisão: replicar fielmente** (Erick, 04/08/2026). O `LEFT JOIN person_skills`
fica como está, com a inflação. Duas consequências que a Fase 2b tem de respeitar:

1. Onde o Power BI usa `DISTINCTCOUNT`, o avaliador **também** usa — trocar por
   `COUNT` mudaria o número por um fator que varia por técnico.
2. 1,4 milhão de linhas é 74% do volume total. É a query que vai doer no cache
   (achado 4) e a primeira candidata a materialização na Fase 3.

Continua valendo *perguntar* se a granularidade por skill é necessária — mas como
melhoria futura, não como mudança agora.

---

## 3. `base-categorias-field` tem data fixa no SQL

`where ai.beginning_service_date > '2026-01-01'` — data **hardcoded**, não
relativa. Em 2027 a query vai continuar trazendo tudo desde jan/2026 e crescendo
para sempre. Hoje são 233 mil linhas.

**Decisão: replicar fielmente** (Erick, 04/08/2026). O filtro fica literal. Mudar
para relativo mudaria o conjunto de linhas e, com ele, todo número construído
sobre a tabela.

Vale revisar as 18 queries à procura de outras datas chumbadas — como
levantamento, não como correção. É o tipo de coisa que só incomoda na virada do
ano, e aí já é conversa de manutenção.

---

## 4. Quatro queries levam mais de 10s (uma chega a 29s)

Medido na captura dos goldens, contra o ERP de produção:

| Query | Tempo |
|---|---|
| `protocolos-geral` | 29,1s |
| `protocolos-produtividade` | 25,5s |
| `protocolos-auxiliares` | 25,4s |
| `field-agenda` | 19,6s |
| `protocolos-telefonia` | 11,2s |

O `statement_timeout` está em 30s, então `protocolos-geral` está a 1 segundo do
limite. Na primeira captura o `troca-endereco` **estourou** e caiu para execução
direta.

**Por que importa.** Isso é aceitável para uma ferramenta de validação que roda
de vez em quando; **não** é aceitável para um dashboard. A Fase 3 não pode
depender de uma query de 29s no caminho do usuário. É o que justifica o cache do
Query Engine (TTL + single-flight, já prontos) e depois a invalidação por CDC da
Fase 4 — o número acima é a linha de base que mostra por quê.

---

## 6. Três medidas apontam para uma tabela que não existe no modelo

**Evidência.** `npm run validate:model` (novo) resolve toda referência
`'Tabela'[Coluna]` e `[Medida]` das 78 medidas e das 49 colunas calculadas
contra o modelo. Três não resolvem:

| Medida | Referência | Tabela existe? |
|---|---|---|
| `# AA MÉDIA GERAL` | `GESTORES[GERENTE/SUPERVISOR]` | ❌ |
| `# AA TOTAL EQUIPES` | `GESTORES[GERENTE/SUPERVISOR]` | ❌ |
| `# AA MÉDIA EQUIPES` | `CAPACIDADE INSTALAÇÃO[EQUIPE_BASE]` | ❌ |

Não existe tabela `GESTORES` nem `CAPACIDADE INSTALAÇÃO` no modelo — as duas
strings aparecem **só dentro dessas medidas**, em nenhum outro lugar do PBIP.

**O que aconteceu, quase certamente.** A tabela foi renomeada e as medidas
ficaram para trás:

- `CAPACIDADE EQUIPE` **tem** uma coluna `GERENTE/SUPERVISOR` — exatamente a que
  `GESTORES` deveria ter.
- Existe uma query M chamada `GESTORES EQUIPES` (com espaço), mesclada dentro de
  `PROTOCOLOS GERAL` em vez de carregada como tabela.
- `EQUIPE_BASE` não existe em nenhuma tabela; `CAPACIDADE EQUIPE` tem `EQUIPE` e
  `BASE DE ORIGEM`.

**Nenhuma das três é usada em visual algum.** Varredura nas 14 páginas / 306
visuais de `specs/dashboards/`: zero ocorrências. São medidas mortas — no Power
BI de hoje elas dariam erro se alguém as colocasse numa página.

**Decisão: replicar fielmente** (Erick, 04/08/2026) — e replicar fielmente aqui
significa **não implementar**. Uma medida que referencia tabela inexistente não
tem resultado hoje; reproduzir isso é não ter resultado. Se a plataforma nova
"consertasse" apontando para `CAPACIDADE EQUIPE`, passaria a mostrar um número
que o Power BI nunca mostrou — o oposto de paridade.

**A Fase 2b tem como alvo 75 medidas, não 78.** As três ficam registradas aqui
como mortas.

Continua valendo confirmar com quem manteve o relatório se elas eram de um painel
descontinuado — nesse caso dá para apagar as três do Power BI também. Mas isso é
limpeza, não bloqueio.

O teste `specs reais: só as 3 referências quebradas já conhecidas` em
`packages/semantic-model/test/model.test.ts` trava essa lista. Se uma quarta
aparecer no PBIP, o `npm test` falha e aponta para cá.

---

## 7. Três definições de "dia útil" convivem no modelo, e discordam do sábado

**Evidência.** São três, não duas — a terceira apareceu ao implementar o
avaliador (04/08/2026), porque o DAX dela só entrou nas specs com o conserto do
extrator descrito no achado 8.

| Definição | Feriado vem de | Sábado vale | Quem consome |
|---|---|---|---|
| `CALENDARIO INSTALADO[PESO]` | `LOOKUPVALUE` na tabela `FERIADOS` | **1** | as 8 medidas de projeção/média |
| `PROTOCOLOS GERAL[# MEDIA CRIADOS]` | filtro sobre `FERIADOS` | **1,5** | ela mesma, exibida |
| `CALENDARIO CRIADO[PESO]` | lista chumbada no DAX | **0,5** | **ninguém** |

A terceira ignora a tabela `FERIADOS` e traz os feriados escritos à mão —
2020, 2021 e um único `DATE(2026,6,4)`. Não há nenhum feriado de **2022 a 2025**
nessa lista, então nesses anos todo feriado contaria como dia inteiro.

**Só que ela não é consumida por nada.** Nenhuma das 78 medidas soma
`'CALENDARIO CRIADO'[PESO]` (as 8 somam a de `CALENDARIO INSTALADO`), e a coluna
não aparece em nenhum dos 306 visuais. É DAX morto: não produz número errado em
tela hoje. Registrado porque quem for mexer em regra de dia útil vai encontrar as
três e precisa saber que só duas estão em uso.

Segue a comparação entre as duas que **estão** em uso:

`CALENDARIO INSTALADO[PESO]` — sábado vale **1** (dia inteiro), e a decisão está
registrada num comentário dentro do próprio DAX:

```dax
SWITCH(
    'CALENDARIO INSTALADO'[DIA_SEMANA],
    "domingo", 0,
    --"sábado", 0.5, -- Cerqueira afirmou que o sábado era 100% 19/05/2025 12:00
    1
)
```

`PROTOCOLOS GERAL[# MEDIA CRIADOS]` — sábado vale **1,5**:

```dax
VAR Dias_Uteis_No_Mes  = ... WEEKDAY([DATA CRIADO], 2) <> 7 ...  -- exclui só domingo,
                                                                 -- então o sábado já entra como 1
VAR Quantidade_Sabados = ... WEEKDAY([DATA CRIADO], 2) = 6 ...
VAR Dias_Uteis_Ajustados = Dias_Uteis_No_Mes + (Quantidade_Sabados * 0.5)
```

`Dias_Uteis_No_Mes` **já conta o sábado como 1** (o filtro só remove domingo e
feriado). Somar `0,5` por sábado leva o sábado a **1,5**.

**Por que importa.** Um "dia útil ajustado" acima de 1 não descreve nada: o
denominador de uma média diária infla e a média cai. Se a intenção era meio dia,
o correto seria subtrair `0,5`, não somar. E qualquer que fosse a intenção, ela
contradiz o `PESO`, onde a decisão de negócio está explícita e datada.

**Decisão: replicar fielmente** (Erick, 04/08/2026). O avaliador reproduz as duas
contas como estão — `PESO` com sábado = 1, `# MEDIA CRIADOS` com sábado = 1,5.
Elas continuam discordando na plataforma nova, igual hoje.

**Isto é o único achado que ainda é uma pergunta de negócio em aberto**, porque só
quem usa o número sabe qual das duas regras a operação considera certa. Não
bloqueia a Fase 2b — replicar as duas é possível e é o que será feito. Mas
enquanto não houver resposta, `# MEDIA CRIADOS` fica marcada como suspeita: um
"dia útil ajustado" de 1,5 não descreve nada que exista na operação, e o efeito
é a média sair mais baixa do que deveria nos meses com sábado trabalhado.

Se a resposta for "sábado vale 1", a correção é remover
`+ (Quantidade_Sabados * 0.5)` — e aí é divergência deliberada, a registrar aqui.

---

## 8. O extrator estava perdendo DAX e relacionamentos (corrigido)

Não é decisão pendente — fica registrado porque explica por que as specs
mudaram de tamanho e porque os achados 1 e 7 só apareceram agora.

Quatro perdas distintas, todas de silêncio — a spec saía plausível e incompleta:

| Problema | Efeito |
|---|---|
| Cerca ` ``` ` do TMDL no DAX | 33 medidas e 11 colunas começavam e terminavam com ` ``` ` — parser de DAX morre na linha 1 |
| Corpo de coluna calculada descartado | **43 colunas calculadas** gravavam `calculated: true` e nenhuma expressão. `PESO`, que carrega a regra de dia útil de 8 medidas, tinha o DAX inteiro perdido |
| `relationships.tmdl` nunca lido | **22 relacionamentos** fora das specs. Sem eles não há como avaliar medida que cruza tabelas (`CALENDARIO INSTALADO` filtrando `PROTOCOLOS GERAL`) |
| Nome citado com `=` no fim da linha | **6 colunas calculadas** perdidas por inteiro — nome e DAX (ver abaixo) |

A quarta apareceu em 04/08/2026, ao montar dados para o avaliador: a separação
entre nome e expressão procurava por `' = '` **com espaço nos dois lados**. No
TMDL a forma abaixo é comum, e nela não há espaço depois do `=`:

```tmdl
column 'Semana Do Mes Texto' =
        VAR SemanaDoMesNum = [Num Semana]
        RETURN CONCATENATE(SemanaDoMesNum, "ª Semana")
```

Resultado: a coluna era gravada com o nome literal `'Semana Do Mes Texto' =`,
`calculated: false` e nenhum DAX. Não é cosmético — **4 das 6 colunas perdidas
aparecem em visuais ao vivo**:

| Coluna recuperada | Em visual? |
|---|---|
| `Clima/ Tempo[Probabilidade_Chuva_Formatada]` | ✅ |
| `PROTOCOLOS GERAL[EQUIPES TEMPORARIAS]` | ✅ |
| `REINCIDÊNCIA[TempoTotalDias]` | ✅ |
| `RETORNO PRIORITARIO[TempoTotalDias]` | ✅ |
| `CALENDARIO AGENDAMENTO[Semana Do Mes Texto]` | — |
| `PROTOCOLOS GERAL[GRUPO]` | — |

Duas consequências além das colunas: o inventário de funções DAX estava
subestimado (`CONCATENATE` só existe numa dessas seis, então não constava do
escopo do avaliador), e o total de expressões a reimplementar passou de **121 para
127**.

Corrigido em `tools/extractor/src/tmdl.mjs`, com teste para cada um dos quatro
casos. O `specs/_catalog/relationships.yaml` é novo, e as specs de tabela agora
têm o campo `dax` por coluna.

Detalhe que quase passou: existe uma coluna cujo **nome contém ponto** —
`'BACKLOG AGENDADO FUTURO'.'PROTOCOLOS GERAL.TIPO DE PROTOCOLO'`. Um
`split('.')` devolveria a coluna `PROTOCOLOS GERAL`, que também existe: o
relacionamento sairia silenciosamente errado em vez de dar erro.

---

## 9. Quando o `.pbix` pode ser removido

Pergunta do Erick: *mantivemos as infos do BI antigo só para consulta? mais para
frente podemos remover?*

Sim — o PBIP é **insumo read-only**, nunca dependência de execução da plataforma.
Mas remover tem pré-requisitos concretos:

| Pré-requisito | Situação |
|---|---|
| SQL das queries extraído | ✅ 18 queries com SQL nas specs |
| Medidas DAX extraídas | ✅ 78 em `specs/_catalog/measures/` |
| Layout das páginas/visuais | ✅ 14 páginas, 306 visuais em `specs/dashboards/` |
| Dados que só existiam no `.pbix` | ✅ feriados preservados em Base64 (ver achado 1) |
| DAX das colunas calculadas | ✅ 49 colunas (ver achado 8 — 6 delas recuperadas em 04/08) |
| Relacionamentos entre tabelas | ✅ 22 em `specs/_catalog/relationships.yaml` (achado 8) |
| Queries executadas contra o ERP | ✅ 18/18 em `specs/golden/` |
| `rowCount` conferido contra o Power BI | ⏳ passo humano, pendente com o Erick |
| Plataforma nova em produção e aceita pela operação | ⏳ |

Os quatro primeiros já estão no git, então o `.pbix` **não é mais a única cópia**
de nada. O que impede removê-lo agora não é risco de perda de informação — é que
ele continua sendo o **sistema em produção**: a operação de instalação usa esses
números todo dia. Ele deixa de ser necessário quando a plataforma nova estiver
substituindo o uso, não antes.

Recomendação: manter enquanto a Fase 2 e 3 rodarem (é a referência para conferir
paridade visual e numérica) e reavaliar quando os dashboards novos estiverem em
uso. Se for para liberar os 73 MB antes disso, o caminho seguro é **arquivar** o
`.pbix` fora da árvore de trabalho, não apagar.

---

## 10. `TOTAL_DIAS` conta dia do mês, não data — e ninguém a usa

**Evidência.** Duas medidas contam distintos sobre a hierarquia automática de
datas do Power BI:

```dax
TOTAL_DIAS            = DISTINCTCOUNT('CALENDARIO CRIADO'[DATA CRIADO].[Dia])
TOTAL_DIAS_ENCERRADOS = DISTINCTCOUNT('CALENDARIO INSTALADO'[DATA INSTALADO].[Dia])
```

O `.[Dia]` não é a data. Lido no PBIP, em `LocalDateTable_*.tmdl`:

```tmdl
column Dia = DAY([Date])
    dataType: int64
```

É o **dia do mês**, 1 a 31. Contar distintos disso satura em 31: num intervalo de
três meses o resultado é ~31, não ~90. Comparar com `PROTOCOLOS
PRODUTIVIDADE[Total Dias]`, que usa a coluna de data direto e por isso conta certo.

**Consequência hoje: nenhuma.** Nenhuma das 78 medidas referencia as duas, e elas
não aparecem em nenhum dos 306 visuais — mesma situação das 3 medidas do achado 6.
São, portanto, **mais 2 medidas mortas**: 5 das 78 não são consumidas por nada.

Fica registrado porque o defeito é latente: no dia em que alguém puser
`TOTAL_DIAS` como denominador de uma média, o número sai baixo e plausível.

**Decisão: replicar fielmente.** O avaliador implementa `.[Dia]` como `DAY()`,
igual ao Power BI, e há teste fixando isso.

---

## 11. `DISTINCTCOUNT` sobre tabela vazia — suposição nossa, a conferir

Diferente dos outros: não é achado sobre o Power BI, é **uma coisa que não sabemos**
e que está escrita como suposição no código, em vez de escondida.

Agregação do DAX sobre nenhuma linha devolve BLANK, não 0 — vale para `SUM`,
`COUNT`, `MIN`, `MAX` e `COUNTROWS`, e é por isso que tanto DAX de produção
escreve `COUNTROWS(x) + 0`. Para `DISTINCTCOUNT` não achamos documentação
inequívoca de que seja BLANK e não 0.

Escolhemos **BLANK**, por coerência com as demais, isolado numa linha em
`packages/measure-engine/src/functions.ts`. A diferença é observável: `= 0` e
`ISBLANK()` respondem coisas diferentes, e o cartão do Power BI mostra vazio em
vez de zero.

**Como resolver:** quando os `rowCount` forem conferidos contra o Power BI, medir
também um `DISTINCTCOUNT` num filtro que não retorne linha. Se der 0, muda-se uma
linha e o teste correspondente. Não bloqueia nada até lá.

---

## 12. `ISINSCOPE` não é resposta do avaliador — depende do visual

Também não é achado sobre o Power BI: é uma **fronteira de arquitetura**, registrada
para não ser confundida com lacuna de implementação.

`PROTOCOLOS PRODUTIVIDADE[Faixa 1 Premiação Total]` usa `ISINSCOPE` para só
calcular no total, e o próprio DAX explica a intenção num comentário:

```dax
// Esta verificação garante que o cálculo só será exibido nos totais,
// e não nas colunas individuais de "Tipo de Protocolo".
IF(
    ISINSCOPE('PROTOCOLOS PRODUTIVIDADE'[N°PROTOCOLO]),
    BLANK(),
    ... calcula a faixa ...
)
```

`ISINSCOPE(coluna)` responde *"a visualização está agrupando por esta coluna?"*. Não
é propriedade do modelo nem do contexto de filtro: é propriedade do **visual** que
fez a pergunta. O avaliador, sozinho, não tem essa informação — ela chega com o
Widget Engine (Fase 3), que é quem sabe as linhas e colunas de cada visual.

**Decisão: erra alto.** A alternativa seria devolver `FALSE`, e aí a medida
calcularia a faixa em **toda** célula em vez de só no total — exatamente o contrário
do que o comentário do autor pede. Número plausível e errado, sem erro nenhum.

**Consequência:** o avaliador entrega **74 das 78** medidas em vez de 75. A que falta
não precisa de mais DAX; precisa da Fase 3. Há teste fixando isso, para que a
diferença não seja lida como regressão.

---

## 13. Um relacionamento existe no modelo e não pode ser usado por nada

Dos 22 relacionamentos, um está marcado `active: false`:

| | |
|---|---|
| De | `PROTOCOLOS PRODUTIVIDADE[SOLICITACAO]` (many) |
| Para | `PROTOCOLOS GERAL[SOLICITACAO]` (one) |
| `active` | `false` |
| `cross_filter` | `oneDirection` |

Relacionamento inativo no Power BI só entra em jogo dentro de `USERELATIONSHIP`. E
**`USERELATIONSHIP` não aparece em nenhuma das 134 expressões** — conferido por
varredura no catálogo, junto com `RELATED`, `ALLEXCEPT` e `CROSSFILTER`, que também
não aparecem.

Ou seja: ele está desenhado no modelo, é mantido pelo refresh, e não afeta número
nenhum. É parente dos outros trechos mortos já registrados — as 3 medidas do achado 6,
a `TOTAL_DIAS` do achado 10 e o `CALENDARIO CRIADO[PESO]` do achado 7.

**O que isso muda para a plataforma:** nada, e é por isso que está aqui. Tratá-lo como
ativo mudaria números de verdade, porque ele ligaria `PROTOCOLOS PRODUTIVIDADE` a
`PROTOCOLOS GERAL` — duas tabelas grandes que hoje não se filtram. O avaliador o
mantém fora do grafo de propagação, com teste.

**Não vale uma pergunta própria ao Fabrício** — pelo mesmo critério que deixou o
`CALENDARIO CRIADO[PESO]` fora: não afeta número em tela. Entrou como um parágrafo na
pergunta 2, que já é sobre limpeza de resto de painel antigo, em
[PERGUNTAS-NEGOCIO.md](./PERGUNTAS-NEGOCIO.md).

A hipótese mais provável é que ele tenha sido desativado por criar **caminho
ambíguo**: `PROTOCOLOS PRODUTIVIDADE` e `PROTOCOLOS GERAL` já se ligam indiretamente
por `CALENDARIO INSTALADO`, e o Power BI recusa dois caminhos entre as mesmas tabelas.
Se for isso, ele pode ser apagado do modelo sem consequência.

---

## 14. Sete tabelas existiam no modelo sem dizer de onde vinham as linhas (corrigido)

Como o achado 8, não é decisão pendente: fica registrado porque explica por que as
specs cresceram e porque este era um bloqueio da paridade que ninguém tinha visto.

Sete das 25 tabelas são **calculadas**: no TMDL a partition é `= calculated` e o
conteúdo é uma expressão DAX que produz as linhas. O extrator lia só a partition
`= m` (a que virava query), então para essas sete a spec gravava
`query_ref: null` e **mais nada**. A spec afirmava que a tabela existe e não dizia
de onde vêm as linhas.

| Tabela | DAX que a define |
|---|---|
| `CALENDARIO INSTALADO` | `CALENDAR(MIN('PROTOCOLOS GERAL'[DATA INSTALAÇÃO]), DATE(2026,12,31))` |
| `CALENDARIO AGENDAMENTO` | `CALENDAR` sobre `MIN`/`MAX` de `'PROTOCOLOS GERAL'[DATA AGENDA]` |
| `CALENDARIO CRIADO` | `CALENDAR` de `MIN('PROTOCOLOS TELEFONIA'[DATA CRIADO])` a `MAX('PROTOCOLOS GERAL'[DATA CRIADO])` |
| `calendar` | `DISTINCT(SELECTCOLUMNS('FIELD AGENDA', ...))` |
| `Status Protocolo Dia` | `ADDCOLUMNS` sobre `DISTINCT(SELECTCOLUMNS('FIELD AGENDA', ...))`, com 3 `CALCULATE` |
| `BASE DE ORIGEM` | `DISTINCT('PROTOCOLOS GERAL'[EQUIPES TEMPORARIAS])` |
| `PROTOCOLOS` | `DISTINCT('PROTOCOLOS GERAL'[TIPO DE PROTOCOLO])` |

**Por que isso era grave e não aparecia.** Três dessas tabelas —
`CALENDARIO INSTALADO`, `calendar` e `Status Protocolo Dia` — são exatamente por
onde o filtro propaga (fase 2b.5). Contra dado real elas nasceriam **vazias**, e
tabela vazia do lado que filtra não dá erro: dá zero, ou um filtro que não casa
nada. Nos testes nunca apareceu porque o dataset sintético **inventa linhas para
toda tabela do modelo**, calculada ou não — ele preenchia justamente o que faltava.

Note a dependência que isso cria: `CALENDARIO INSTALADO` começa em
`MIN('PROTOCOLOS GERAL'[DATA INSTALAÇÃO])`, e `DATA INSTALAÇÃO` é uma **coluna
calculada** que escolhe entre três colunas de data conforme o tipo do protocolo.
Então materializar a tabela exige avaliar a coluna calculada de outra tabela
primeiro — há ordem de dependência entre tabelas, não só entre medidas.

**Corrigido** em `tools/extractor/src/index.mjs`: a spec de tabela ganhou o campo
`table_dax`, o modelo semântico expõe `calculatedTables`, e o `validate:model`
agora verifica as referências dessas 7 também (passam limpas). Com elas, a base
tem **134 expressões DAX**, não 127, e usa **56 funções**, não 54 — as duas novas
são `CALENDAR` e `ADDCOLUMNS`.

**Materializar veio na fase 2b.7** e as 7 são avaliadas hoje
(`packages/measure-engine/src/calculated.ts`). Vale registrar o que era o caso
perigoso, porque ele descreve uma classe de erro e não um bug pontual:
`BASE DE ORIGEM` **não falhava**. Ela é `DISTINCT` de uma coluna que no dado
sintético tinha um único valor, então cabia na coerção 1×1 → escalar e devolvia um
**texto** onde deveria haver uma tabela. Por isso o teste que a cobre olha a
**forma** do resultado, não "se deu erro" — e por isso existe
`evaluateTableExpression`, que avalia expressão de tabela sem coerção nenhuma.

A ordem de dependência ganhou ordenação topológica com detecção de ciclo. Medindo o
grafo real, ele é **plano**: as 7 dependem só de tabelas que vêm de query, nenhuma
depende de outra calculada. Hoje qualquer ordem funcionaria — a ordenação existe pelo
que ela recusa, e ciclo erra alto nomeando o caminho.

O teste `nenhuma tabela fica sem origem: 18 vêm de query, 7 vêm de DAX` é o que
pega a próxima perda dessas: tabela sem query e sem DAX não é tabela vazia, é
tabela que o extrator perdeu.

---

## 15. O `rowCount` do golden não é a contagem da tabela no Power BI (11 das 17)

**Este achado muda o que a conferência pendente significa**, então vale ler antes
de conferir número nenhum.

Entre o SQL e a tabela que o DAX vê existe a camada **M (Power Query)**: são **303
passos** depois do `Odbc.Query` nas 23 queries que o scanner lê estaticamente (a
24ª, `clima-tempo`, define uma função M com `let` aninhado e o scanner erra alto em
vez de achatar os passos internos na tabela de fora). Esses passos não são
cosméticos — eles criam coluna e **filtram linha**. O golden guarda `count(*)` do **SQL**; a
tabela no Power BI é o resultado depois do M. Onde o M mexe em linha, os dois
números são diferentes **por construção**, e divergência ali não indica extração
errada.

Rode `npm run validate:tables` para a lista completa. O caso mais forte é a maior
tabela do relatório:

```
PROTOCOLOS GERAL (protocolos-geral)
    Table.ExpandTableColumn (multiplica) em 'ALOCAÇÃO_PATRIMONIO Expandido'
    Table.SelectRows       (reduz)      em 'Linhas Filtradas1'    → [STATUS] <> "Cancelado"
    Table.ExpandTableColumn (multiplica) em 'TROCA ENDEREÇO Expandido'
    Table.ExpandTableColumn (multiplica) em 'GESTORES EQUIPES Expandido'
    Table.Distinct         (reduz)      em 'Duplicatas Removidas' → por SOLICITACAO
    Table.ExpandTableColumn (multiplica) em 'TECNICOS AUXILIARES Expandido'
```

O golden diz `rowCount: 33438`. A tabela no Power BI tem outro número, e o certo é
ter: quatro expansões podem multiplicar, um filtro tira os cancelados e um
`Table.Distinct` deduplica por `SOLICITACAO` **depois** disso.

**Balanço:** de 17 tabelas alimentadas por query escaneável, **6 têm `rowCount`
comparável** e **11 não têm**. Em `#APURAÇÃO PREMIAÇÃO` é `Table.Skip`; em
`FIELD AGENDA`, `CONTRATOS`, `Base Categorias Field`, `CAPACIDADE EQUIPE` e
`PROTOCOLOS TELEFONIA` é um `Table.SelectRows`; em `BACKLOG AGENDADO FUTURO` e
`RETORNO PRIORITARIO` é expansão de mesclagem; em `REINCIDÊNCIA` e
`PROTOCOLOS PRODUTIVIDADE` é a combinação de tudo.

**A outra metade do mesmo achado: 11 colunas que o DAX usa não saem do SELECT.**
Elas nascem em passo M — `HORA CRIADO` é `DateTime.Time([DATA CRIADO])`,
`DATA DA TROCA` vem de mesclar com a query `troca-endereco`, `TÉCNICO INSTALAÇÃO`
é renomeação de uma coluna expandida. `validate:model` não pega isso porque
confere modelo contra modelo: a coluna está declarada na spec da tabela, então
passa. Contra dado real ela chegaria vazia.

Duas colunas a mais que apareceram na verificação e valem registro:

- `CONTRATOS[CIDADE2]` — o SELECT pede `ac.city "CIDADE"` **duas vezes**, e o
  Power Query desempata a segunda com `2`. O efeito colateral é sobre o golden: o
  perfilador guarda coluna por nome, então a duplicata desaparece e `contratos`
  aparece com 22 colunas em vez de 23. `columns[]` do golden não serve para
  contar coluna quando o SQL repete alias.
- `PROTOCOLOS GERAL[EQUIPE_BASE]` — no TMDL é `type: calculated` e **não tem
  expressão nenhuma**. Caso único no modelo: coluna calculada vazia. Não é citada
  por nenhuma das 134 expressões e não sai de nenhuma fonte.

**O que a plataforma faz.** Nada de silencioso. `npm run validate:tables` classifica
cada uma das 298 colunas físicas em SQL / alias repetido / passo M / DAX da própria
tabela / sem golden para conferir / sem explicação, e **sai com código 1** se uma
coluna citada pelo DAX não for explicada por ninguém. Hoje não há nenhuma nessa
situação.

A procedência `dax` entrou na fase 2b.7 e cobre as **10 colunas** das 7 tabelas
calculadas. Antes elas caíam em "sem golden para conferir", junto com as de gsheets e
web — e as duas coisas não são iguais: aquelas não têm como ser afirmadas nem negadas,
estas se conferem, porque a materialização exige bijeção entre a coluna declarada e a
que o DAX devolve. O balaio do incerto foi de 30 para 20 colunas sem que nada no PBIP
mudasse.

**Para a conferência pendente:** compare o `rowCount` só nas 6 tabelas em que ele é
comparável. Nas outras 11, o número a comparar é o da tabela **depois do M** — ou,
mais simples, compare a contagem de linhas do visual, não a da query.

---

## 16. `TRUNC` de data devolve número, e é o tipo declarado que salva a junção

Achado da fase 2b.7, e do tipo que só aparece quando o dado passa a existir de
verdade: enquanto as tabelas calculadas vinham do dataset sintético, esta coluna
nascia com o tipo que o teste inventava.

`Status Protocolo Dia[Dia]` é definida assim, dentro do DAX que cria a tabela:

```dax
"Dia", TRUNC ( 'FIELD AGENDA'[Slot Agenda] )
```

`TRUNC` em DAX devolve **número** — o número de série da data, `46032` para
10/01/2026. E essa coluna é uma das duas pontas de um relacionamento:

```
Status Protocolo Dia[Dia]  →  calendar[Data]
```

Do outro lado, `calendar[Data]` vem de `'FIELD AGENDA'[Data]`, que é
`DATEVALUE([Slot Agenda])` — portanto **data**. Número de um lado, data do outro:
a junção não casa **nenhuma** linha.

**Por que isso não é bug do Power BI.** Lá a coluna é declarada `dateTime` no TMDL,
e o valor é armazenado como data — a série vira data na hora em que a coluna é
materializada. O que faltava no avaliador era exatamente isso: aplicar o tipo
declarado ao materializar (`aplicaTipo` em `calculated.ts`). Só este caso é
convertido; texto onde se declarou data continua erro, porque converter `DD/MM/YYYY`
na surdina é como se leu março onde era abril (achado 1, o falso).

**O que impediu de passar em branco** foi o guarda de espécie em
`FilteredContext.restringe`, escrito na fase 2b.5: junção entre data e número erra
alto em vez de devolver zero com cara de filtro apertado. Sem ele, `Status Protocolo
Dia` filtraria `calendar` para nada e toda medida que atravessa esse relacionamento
sairia vazia — sem erro nenhum. **O conserto não era afrouxar o guarda**: era a
coluna nascer com o tipo que o TMDL declara.

---

## 17. O Data Hub tem o colaborador, mas não tem o gestor — e o gestor era o único motivo da mesclagem

Achado de 05/08/2026, sondando a API do Data Hub que substituiria a planilha
`QUADRO FUNCIONAL` (decisão registrada em `docs/DECISAO-CAMADA-M.md`, Anexo A).
Reproduzível com `npm run probe:datahub`.

`PROTOCOLOS PRODUTIVIDADE` — que 9 medidas leem — consome `QUADRO FUNCIONAL` em
exatamente dois pontos do M:

```m
Table.NestedJoin(…, {"TECNICO"}, #"QUADRO FUNCIONAL", {"upper_name"}, …, JoinKind.LeftOuter)
Table.ExpandTableColumn(…, "QUADRO FUNCIONAL", {"GESTOR"}, {"GESTOR"})
```

`NOME` é a chave (via `upper_name = Text.Upper([NOME])`) e **`GESTOR` é a única
coluna expandida**. As outras 35 colunas da planilha não são consumidas por nada.

A API (`/p/dash-instalacao`, dataset `db-senior-collaborators`) tem a chave: o campo
`name`. E tem três campos de hierarquia — `supervisor_name`, `coordinator_name`,
`manager_name` — **todos `null` em 100% das 2448 linhas**. Não é nome de campo
diferente: é ausência de dado.

**Por que isto é pior do que um erro.** `PROTOCOLOS PRODUTIVIDADE[GESTOR]` não é lida
por nenhuma medida — as medidas de gestor usam `GESTORES[GERENTE/SUPERVISOR]`, com
nome completo (`"LUIS FELIPE NAZARIO ARANDA"`). `[GESTOR]` é **campo de visual**: um
slicer em `diario-instalacao`, um slicer e um campo em `premiacao-instalacao`. Coluna
vazia ali não erra número nenhum — só esvazia o slicer, e o filtro por gestor desses
dois dashboards deixa de existir sem ninguém receber sinal.

**O que se decidiu.** Não escrever o connector até haver dado de gestor. Um connector
que casa `name` e devolve `GESTOR` vazio passa em qualquer teste de shape e falha só
em produção — mesma razão pela qual `CALENDAR` recusa BLANK em vez de gerar 1899 dias
(ver "Divergências deliberadas"). Os três caminhos possíveis, e por que a escolha não
é nossa, estão no Anexo A da decisão.

**De quebra, três fatos úteis sobre a fonte**, todos do envelope e das contagens:

- as 2448 linhas são **vínculo, não pessoa**: `record_type` é `terminated` (1820) ou
  `admitted` (628), e as 628 sem `termination_date` batem com a soma dos status ativos;
- por isso há **121 CPFs repetidos** (recontratação). `id` é único, `cpf` não é —
  casar por CPF sem filtrar vínculo multiplicaria linha;
- a API aceita autenticação por `?token=` **ou** header `X-Api-Token`. O connector usa
  o header: token em query string vai para log de acesso e histórico de proxy.

**Desfecho, no mesmo dia.** Escolhida a terceira saída: `QUADRO FUNCIONAL` continua no
Google Sheets. Logo **não há divergência de fonte** a registrar — a tabela lê de onde o
Power BI lê hoje, que é o padrão do projeto. Este achado fica pelo motivo inverso:
documenta por que a troca não foi feita, e o que precisaria mudar no Data Hub para ela
voltar à mesa (um dos três campos de hierarquia preenchido).

Consequência prática: o connector de Google Sheets voltou a ser caminho crítico. A
autenticação de service account já está escrita e testada (`google-auth.ts`, fluxo JWT
bearer com `node:crypto`, 11 testes sem rede) e a Sheets API está ativada; o que falta é
compartilhar as planilhas com a conta de serviço como Leitor — `npm run probe:gsheets`
mostra o estado.

---

## 18. Nome de coluna com espaço não usa aspas em M, e 5 queries dependem disso

Achado da fase 2b.8, encontrado pelo teste de corpus do parser de M no primeiro
disparo — e é a razão de esse teste existir.

Em M, o nome dentro de `[...]` não é um identificador comum: é um **generalized
identifier**, que pode conter espaço sem nenhuma aspa. A base usa isso à vontade:

```m
DateTime.Time([DATA CRIADO])
each [CAPACIDADE MANHÃ] + [CAPACIDADE TARDE]
```

Um parser que exija identificador simples (ou `#"..."`) recusa **5 das 24 queries**:
`protocolos-geral`, `protocolos-produtividade`, `protocolos-auxiliares`,
`protocolos-telefonia` e `gestores-equipes` — ou seja, as duas maiores tabelas do
modelo entre elas.

**Onde isso quase virou bug silencioso.** O nome é recortado do texto original em vez
de remontado a partir dos tokens. Remontar juntando com um espaço daria o mesmo
resultado em 100% dos casos de hoje, e resultado **diferente** no dia em que alguém
escrever `[DATA  CRIADO]` com dois espaços na fonte: o nome remontado casaria com a
coluna do modelo e o recortado não — ou o contrário, dependendo de qual lado ficou
com o espaço duplo. Nome de coluna é chave de junção com o modelo semântico; não é
lugar para normalização implícita.

A varredura tem um limite deliberado: o nome **não atravessa quebra de linha**. Um
`]` esquecido faria o nome engolir o passo seguinte inteiro, e o erro apareceria
longe da causa.

**De quebra, duas correções de medição.** O levantamento de 2b.8 contou "23 funções
de tabela + 15 de valor". Medido pelo parser, nas 23 queries do escopo são
**19 `Table.*` + 5 de fonte (`Odbc.Query`, `GoogleSheets.Contents`, `Json.Document`,
`Binary.Decompress`, `Binary.FromText`) + 15 de valor = 39**. O número de 23 tinha as
funções de fonte misturadas na lista de tabela; as 15 de valor conferem exatamente.
E a contagem de passos fecha: **303** nas 23 do escopo, **327** com `clima-tempo`.

---

## 19. `base-categorias-field` renomeia uma coluna que o SQL não devolve

Achado da fase 2b.8, apontado pelo teste que executa as 23 queries do escopo contra
o *shape* gravado nos goldens. Reproduzível com
`node --test packages/transform-engine/test/runner.test.ts`.

O último passo do M da query é:

```m
#"Colunas Renomeadas" = Table.RenameColumns(#"Linhas Filtradas", {{"categoria32", "categoria4"}})
```

E o golden — gravado executando o SQL de verdade contra o dbVoalle — registra as
colunas `protocol`, `beginning_service_date`, `categoria1`, `categoria2`,
`categoria3`, `categoria5`. **Não existe `categoria32`.**

O passo **não** passa `MissingField.Ignore`. Em Power Query, `Table.RenameColumns`
sem essa opção **erra** quando a coluna não está lá. Ou seja: não é uma tolerância
do Power BI que o nosso engine deixou de reproduzir — é um erro que aconteceria lá
também, com o dado que o golden registra.

**Duas explicações possíveis, e nenhuma é adivinhável daqui:**

1. As colunas vêm de um pivot cuja forma depende do dado, e no dia em que o golden
   foi gravado o conjunto era outro. Reforça a suspeita: esta query tem **data fixa
   no SQL** (achado #3), então o recorte que ela lê não muda com o tempo, mas o que
   estava lá quando o relatório foi montado pode ter mudado desde então.
2. A query está quebrada no relatório atual e ninguém notou — plausível, porque
   `categoria4` (o nome de destino) não é citada por nenhuma medida.

**O que fica registrado:** o engine erra alto, com o nome da coluna e a lista das
que existem. O teste classifica esta falha como achado conhecido em vez de
regressão, com referência a este item — quando a operação esclarecer qual dos dois
casos é, o tratamento muda junto.

**Por que isso não apareceu antes.** `validate:tables` compara coluna do modelo
contra coluna da fonte, e `categoria32` não é coluna do modelo: é um nome
intermediário, que existe só entre dois passos M. Só executando os passos ela
aparece — que é exatamente o que a 2b.8 passou a fazer.

**Causa raiz encontrada — não é #1, é #2.** O SQL da query é texto fixo, sem
pivot nenhum:

```sql
select ai.protocol, ai.beginning_service_date,
    ssc1.title categoria1, ssc2.title categoria2,
    ssc3.title categoria3, ssc4.title categoria3, ssc4.title categoria5
    -- ...left join solicitation_service_categories ssc5 on ssc5.id = scm.service_category_id_5
```

`categoria3` está no `SELECT` **duas vezes** (`ssc3.title` e `ssc4.title`), e
`ssc5` é `LEFT JOIN`ado mas `ssc5.title` nunca é selecionado — `categoria5` é
`ssc4.title` de novo. A hipótese #1 (pivot que dependeria do dado) está
descartada: o texto do `SELECT` é o mesmo sempre, não há `Table.Pivot` nem
coluna gerada por valor. Sobra a #2: é a query quebrada, com jeito de erro de
copiar-e-colar (`ssc4`/`ssc4` em vez de `ssc4`/`ssc5`).

**Onde a coluna se perdia, e é aqui que estava o defeito nosso, não do PBIP.**
`categoria32` nunca chegava ao golden porque `postgresRunner`
(`packages/query-engine/src/connectors-sql.ts`) pedia o resultado do `pg` no
modo objeto — que já colapsa as duas colunas chamadas `categoria3` **antes**
de `result.rows` existir, sobrescrevendo a de `ssc3` com a de `ssc4`. O Power
Query nunca teve esse problema: `ODBC.Query` resolve a colisão com o mesmo
esquema de sufixo que o passo `Table.RenameColumns` da spec pressupõe
(`categoria3`, `categoria32`). **Corrigido**: `postgresRunner` agora pede
`rowMode: 'array'` e aplica `nomesSemDuplicata` (mesmo arquivo) para
reproduzir esse esquema antes de montar a linha — testado sem credencial em
`packages/query-engine/test/readonly.test.ts`.

**O que isso resolve e o que continua aberto.** Resolvido: o motivo técnico de
`categoria32` não existir no golden — era perda de dado no driver, não uma
característica do M ou do SQL. Continua aberto — e agora é claramente
pergunta de negócio, não mistério técnico: o `SELECT` em si tem cara de bug
(`categoria4` não existe nele; `categoria5` duplica `categoria4`; `ssc5`
juntado e ignorado). Registrado em
[PERGUNTAS-NEGOCIO.md](./PERGUNTAS-NEGOCIO.md) #4. O golden só vai mostrar
`categoria32` depois de `npm run validate:queries` rodar de novo contra o
dbVoalle real — o teste de corpus em `runner.test.ts` continua classificando
esta query como achado conhecido até isso acontecer, porque ele lê o golden
committado, não o banco.

## 20. A camada M não streama: 1,4 milhão de linhas precisam de 8 GB de heap

Achado da primeira execução da camada M contra as fontes reais
(`npm run run:mlayer --all`), 06/08/2026. Não é um achado sobre o Power BI — é
sobre **o nosso** avaliador, e muda uma decisão de arquitetura, então fica aqui.

**O que aconteceu.** Rodar 21 queries num processo só matou o processo:

```
FATAL ERROR: Ineffective mark-compacts near heap limit — JavaScript heap out of memory
Mark-Compact 4070.7 (4119.7) -> 4059.3 (4121.2) MB
```

**Por que, e por que não é um vazamento.** Em M qualquer passo pode citar qualquer
outro passo do mesmo `let` — `#"Linhas Filtradas1"` pode voltar a `Fonte`. O escopo
não pode liberar nenhum passo antes do fim da query, porque não sabe qual ainda
será citado. Então uma query de 56 passos mantém **56 tabelas vivas ao mesmo
tempo**. Com `field-agenda` (1.445.730 linhas × 19 colunas) e `protocolos-geral`
(56 passos × 50 colunas), 4 GB não chegam.

O Power Query não tem esse problema porque **não é um avaliador de expressão**:
ele dobra o que pode para dentro do SQL (*query folding*) e transmite o resto em
lotes. Nós fizemos a escolha oposta de propósito — avaliar passo a passo é o que
permite comparar passo a passo com o relatório atual.

**Medido, com 8 GB por query e um processo por query:**

| Query | Linhas da fonte | Linhas finais | Passos | Tempo |
|---|---|---|---|---|
| `field-agenda` | 1.445.730 | 1.445.730 | 3 | 37,7 s |
| `backlog-agendado-futuro` | 86.436 | 86.436 | 4 | 23,2 s |
| `protocolos-geral` | 33.687 | 32.248 | 56 | 21,4 s |
| `protocolos-produtividade` | 33.438 | — | 56 | (bloqueada na planilha) |
| `protocolos-auxiliares` | 32.514 | 32.057 | 56 | 19,6 s |
| `base-categorias-field` | 234.679 | 183.169 | 4 | 1,1 s |

Ou seja: o gargalo é **passo × largura**, não só contagem de linhas.
`base-categorias-field` tem 7× mais linhas que `protocolos-geral` e roda 19× mais
rápido, porque tem 4 passos e 7 colunas em vez de 56 passos e 50 colunas.

**O que foi feito agora.** `npm run run:mlayer` roda **uma query por processo**
(`tools/mrun/src/index.ts`). A memória volta ao sistema entre uma query e outra, e
uma query grande derruba só a si mesma em vez de matar o relatório inteiro. Quando
o processo morre sem resultado, o CLI diz "estourou o heap" em vez de despejar o
stack trace nativo do V8.

**O que isto decide para a Fase 3, e é a parte que importa.** Servir dashboard
recarregando 1,4 milhão de linhas por requisição está fora de questão — a camada M
como está serve para **validar paridade**, não para atender request. As saídas
possíveis, em ordem de preferência:

1. **Materializar.** Rodar a camada M num job (por query, por processo, como
   agora) e gravar o resultado. O dashboard lê o materializado. É o que o refresh
   do Power BI faz, e mantém a semântica M como fonte da verdade.
2. **Dobrar para SQL o que dá.** Os passos de `field-agenda` são 3 e triviais;
   traduzi-los para o `SELECT` elimina o pico de memória dessa query. Vale
   **query por query**, e cada tradução é uma divergência que precisa de teste de
   equivalência — não é otimização gratuita.
3. Streaming de verdade no avaliador. Exigiria análise de dependência entre passos
   para liberar tabela intermediária, e não resolve `Table.Sort` nem
   `Table.Distinct`, que precisam do conjunto todo.

Nada disso é decidido aqui. O que este achado fixa é o **número**: 4 GB não bastam,
8 GB bastam hoje, e `field-agenda` cresce.

## 21. O `interval` do Postgres não chegava ao engine, e duas queries paravam na primeira linha

Achado da mesma execução. `reincidencia` e `retorno-prioritario` subtraem timestamps
no próprio SQL:

```sql
ps.data_suporte - pi.data_instalacao AS intervalo_suporte
```

Em Postgres isso é `interval`, e o driver `pg` devolve um objeto `PostgresInterval`.
O `comoM` do runner recusava — corretamente, porque recusar é melhor que inventar —
com "a fonte devolveu um valor de tipo object que o engine de M não sabe
representar".

**Medido contra o driver, não suposto** (`select timestamp - timestamp`):

| Expressão | O que o `pg` devolve |
|---|---|
| `'2026-08-04 12:00' - '2026-01-15 08:30'` | `PostgresInterval { days: 201, hours: 3, minutes: 30 }` |
| `'...12:00:00.250' - '...12:00:00'` | `PostgresInterval { milliseconds: 250 }` |
| intervalo zero | `PostgresInterval {}` — **nenhum campo** |
| `date - date` | `201` — número, não interval |

Duas consequências dessa medição:

- **A detecção é pelo método `toPostgres`, não pelos campos.** O intervalo zero vem
  como `{}`, indistinguível de um `jsonb` vazio se olharmos só as chaves — e `jsonb`
  o engine **continua** recusando, que é o certo.
- `date - date` já era número e nunca passou por aqui.

`interval` com ano ou mês erra alto: mês não tem duração fixa e o `duration` de M
não tem mês, então converter exigiria uma data de referência. Subtração de timestamp
nunca produz mês, então isso só dispara se alguém selecionar uma coluna `interval`
de verdade — e aí é decisão, não palpite de 30 dias.

**Onde isso aparece no relatório de hoje:** em `reincidencia` o próprio M descarta a
coluna no passo seguinte (`Table.RemoveColumns({"intervalo_suporte"})`) — o dado é
lido e jogado fora. Em `retorno-prioritario` a coluna **sobrevive** até a tabela
final. Ou seja: uma das duas gasta rede e memória com uma coluna que ninguém usa, e
é assim que o relatório funciona hoje. Replicado como está.

## 22. O que o connector de planilha assume, e o que só a planilha aberta confirma

Registrado em 06/08/2026, quando o `GoogleSheetsConnector` entrou. As 3 queries de
planilha continuam bloqueadas em 403 ([Anexo B](./DECISAO-CAMADA-M.md)), então
**nada abaixo foi verificado contra a planilha real** — está aqui para ser conferido
no dia em que o acesso sair, em vez de virar surpresa depois.

| Decisão | Por quê | Como conferir quando o acesso sair |
|---|---|---|
| `valueRenderOption=UNFORMATTED_VALUE` + `dateTimeRenderOption=SERIAL_NUMBER` | é o que faz data virar número de série (dias desde 1899-12-30), como o Power Query recebe. `FORMATTED_VALUE` traria texto já formatado, e aí o tipo passaria a depender do formato de exibição de quem editou a célula | `npm run probe:gsheets` mostra o cabeçalho e o tipo do que chega |
| célula vazia vira `null`, não `""` | é o que o Power Query mostra, e a diferença é visível: `Table.PromoteHeaders` sobre `""` daria coluna de nome vazio | conferir se alguma coluna final nasce com nome `ColumnN` |
| colunas nascem `Column1..ColumnN` | quem promove cabeçalho é o passo `Table.PromoteHeaders` do M. Nomear pelo conteúdo da primeira linha faria o M promover duas vezes | as 3 queries têm `PromoteHeaders`; se o nome final bater com a spec, está certo |
| baixa **só a aba que o M navega** | divergência deliberada: o conector do Power BI lista todas as abas da planilha. `QUADRO FUNCIONAL` tem CPF e RG, e ler aba que não se usa é risco sem contrapartida | a aba sai do próprio M (`sheet:` na spec, via `npm run extract`) |

**A evidência que sustenta a primeira linha, e é indireta:** o M da planilha declara
`ADMISSÃO`, `DEMISSÃO`, `DATA DE NASCIMENTO` e `DATA RECRUTAMENTO` como `Int64.Type`
— tipo inteiro para colunas que são datas. Isso só faz sentido se o valor chega como
número. E `CAPACIDADE EQUIPE` declara `{"DATA", type date}`, que a partir de um
serial funciona. As duas coisas juntas são consistentes com `UNFORMATTED_VALUE` e
inconsistentes com texto formatado — mas é inferência a partir do M, não medição.
