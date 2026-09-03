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

Estes quatro números são exatamente os que expõem um risco na Fase 4 que
ainda não tinha sido registrado: sob `realtime: true`, um evento CDC invalida
o cache antes do TTL, então nada limita a cadência de recompute dessas
mesmas quatro queries. Levantamento das opções e decisão adiada em
[DECISAO-REALTIME.md](./DECISAO-REALTIME.md).

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
  Power Query desempata a segunda com `2`. **Atualizado em 06/08/2026:** a
  observação de que a duplicata desaparecia do golden (`contratos` com 22 colunas
  em vez de 23) **não vale mais** — a perda era do driver, não do perfilador, e
  está corrigida (#19). O golden regravado tem as 23, e `columns[]` volta a servir
  para contar coluna.
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
[PERGUNTAS-NEGOCIO.md](./PERGUNTAS-NEGOCIO.md) #4.

**Fechado do lado técnico em 06/08/2026.** Os goldens foram regravados contra o
dbVoalle, `categoria32` passou a existir, e com ela o `Table.RenameColumns` acha o
que renomear: `base-categorias-field` **executa inteira**. O teste de corpus subiu
de 22 para **23 de 23** queries executando, e a lista de "achado conhecido" em
`runner.test.ts` ficou vazia — deixá-la povoada esconderia a próxima regressão.

**A mesma colisão existia numa segunda query, e só apareceu agora.** O golden
regravado de `contratos` ganhou `CIDADE2`: o `SELECT` tem `ac.city "CIDADE"` **duas
vezes**. Aqui, diferente do `base-categorias-field`, as duas expressões são
idênticas — é redundância pura, não dado perdido, e nenhuma medida cita a segunda.
Fica registrado por dois motivos: mostra que a colisão de nome no `SELECT` não é
caso isolado desta base, e é o tipo de coisa que um `validate:queries -- --check`
futuro vai acusar como "coluna nova" sem ser regressão nenhuma.

## 20. A camada M não streama: 1,4 milhão de linhas precisam de 8 GB de heap

Achado da primeira execução da camada M contra as fontes reais
(`npm run run:mlayer -- --all --memoria=8192`), 06/08/2026. Não é um achado sobre o
Power BI — é
sobre **o nosso** avaliador, e muda uma decisão de arquitetura, então fica aqui.

> **Complemento de 06/08/2026 (ver #26):** a mesma causa que exige heap grande
> aparecia como **24% do tempo em coletor de lixo** — um `Map` novo por linha por
> passo, e antes dele um array de pares descartável. A parte descartável foi removida
> e o avaliador ficou 2,7× mais rápido na query mais pesada, mas o consumo de memória
> **continua o mesmo em ordem de grandeza**: as linhas seguem materializadas, e o
> `let` de M mantém todos os passos vivos. As 8 GB continuam necessárias.

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

**As contagens acima andam entre execuções, e isso é esperado:** a fonte é o ERP em
produção. `field-agenda` deu 1.445.730, 1.445.786 e 1.445.878 em três execuções de
05 e 06/08. Compare ordem de grandeza, não o número exato — e para comparar com o
Power BI, os dois lados têm que olhar o mesmo instante.

**Duas armadilhas de leitura do relatório**, ambas encontradas ao conferir:

- **Falha de rede aparece como falha de query.** Uma execução mostrou
  `instalacoes-reincidentes: read ECONNRESET`, e a mesma query passou sozinha na
  repetição. O Query Engine **não tem retry** — leitura é idempotente, então retry
  seria seguro, mas é decisão que ainda não foi tomada. Repita antes de acreditar
  numa falha isolada de rede.
- **Não edite fonte com um `--all` em andamento.** Cada query é um processo novo,
  que carrega os arquivos **no momento em que sobe**. Salvar um `.ts` no meio da
  execução faz os filhos seguintes morrerem com erro de módulo, e o relatório
  mostra isso como se a query estivesse quebrada.

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

Registrado em 06/08/2026, quando o `GoogleSheetsConnector` entrou, com as 3 queries
ainda bloqueadas em 403 — as quatro decisões eram inferência a partir do M, não
medição. **O acesso saiu no mesmo dia** (ver o fim do #23) e as quatro se
confirmaram contra a planilha real. A coluna da direita deixou de ser plano e passou
a ser resultado.

| Decisão | Por quê | O que a planilha real mostrou |
|---|---|---|
| `valueRenderOption=UNFORMATTED_VALUE` + `dateTimeRenderOption=SERIAL_NUMBER` | é o que faz data virar número de série (dias desde 1899-12-30), como o Power Query recebe. `FORMATTED_VALUE` traria texto já formatado, e aí o tipo passaria a depender do formato de exibição de quem editou a célula | **confere.** `DATA RECRUTAMENTO` chega com 16.138 valores numéricos e 0 texto; se viesse formatado, `Int64.Type` teria falhado em todas |
| célula vazia vira `null`, não `""` | é o que o Power Query mostra, e a diferença é visível: `Table.PromoteHeaders` sobre `""` daria coluna de nome vazio | **confere.** nenhuma coluna final nasceu `ColumnN`, e o vazio é contado como vazio (14.595 em `ADMISSÃO`) em vez de virar texto |
| colunas nascem `Column1..ColumnN` | quem promove cabeçalho é o passo `Table.PromoteHeaders` do M. Nomear pelo conteúdo da primeira linha faria o M promover duas vezes | **confere.** depois do `PromoteHeaders`, as 37 colunas da spec casam 37/37 com a planilha, sem faltar nem sobrar |
| baixa **só a aba que o M navega** | divergência deliberada: o conector do Power BI lista todas as abas da planilha. `QUADRO FUNCIONAL` tem CPF e RG, e ler aba que não se usa é risco sem contrapartida | **vale a pena.** as 3 planilhas têm 8, 1 e 4 abas; o M navega uma de cada. `QUADRO FUNCIONAL` traz junto `ACESSOS`, `CANDIDATURAS` e `GESTORES`, que ninguém pediu |

**A confirmação vale mais que as quatro linhas somadas:** `quadro-funcional` roda
ponta a ponta e devolve **535 linhas × 38 colunas** (37 + `upper_name`), o mesmo
número que `probe:gsheets` chegou por caminho independente — ele conta as linhas
direto da API, sem passar pelo engine de M. Dois caminhos separados batendo no mesmo
número é o que dá confiança de que o filtro de gestor e a tipagem estão fiéis.

**Uma divergência que eu registrei e estava errada.** Anotei antes que a planilha de
`CAPACIDADE EQUIPE` não teria a aba certa, porque suas abas são `STAGING, MEMORIES,
STATUS, DEFAULT` e nenhuma se chama `CAPACIDADE EQUIPE`. Não é divergência: o M
navega `Fonte{[name="STAGING"]}`, e `CAPACIDADE EQUIPE` é o nome da **tabela no
modelo**, não da aba. Fica registrado porque o erro é fácil de repetir — no PBIP o
nome da query e o nome da aba coincidem em `QUADRO FUNCIONAL` e não coincidem aqui.

## 23. Três credenciais do Google, e só uma delas é acesso

Registrado em 06/08/2026, depois de gastar três tentativas na mesma confusão. O
console do Google Cloud oferece coisas de nomes parecidos e naturezas diferentes, e
a diferença não é de configuração — é de **quem tem permissão**:

| Credencial | O que identifica | Alcança planilha privada? |
|---|---|---|
| Chave de API | o **projeto** | **Não.** Não carrega permissão nenhuma; só chega a documento público por link |
| Service account | uma **identidade própria** | Só se a planilha for compartilhada **com o e-mail dela** |
| Cliente OAuth (id + secret) | o **aplicativo** | Sozinho, não. Vira acesso quando **uma pessoa consente**, e é o acesso *dessa pessoa* |

O que cada um custou aqui:

- **Chave de API.** Restringi-la "à API do Sheets" no console autoriza a chave a
  *chamar* a API — não a ler documento privado. Medido: 403 nas 3. Efeito colateral
  útil da medição: 403 também **prova que nenhuma das 3 é pública por link**, o que
  importa porque `QUADRO FUNCIONAL` tem CPF e RG.
- **Service account.** `PERMISSION_DENIED` não distingue "não compartilharam" de
  "compartilharam o documento errado". Quem resolve isso é a Drive API:
  `probe:gsheets` lista o que a conta alcança, e **0 arquivos** encerra a dúvida.
  Medido em 06/08/2026: 0.
- **Cliente OAuth.** É o caminho que **não exige compartilhar nada**, porque a
  plataforma passa a agir como uma conta que já tem acesso — e o Erick é Leitor nas
  3. Implementado em `npm run auth:google` (código + PKCE + loopback).

**A divergência que isso cria, e que é temporária de propósito.** OAuth amarra a
leitura a uma conta pessoal: o refresh token morre se a senha mudar, se a pessoa
sair da empresa, ou em 7 dias se a tela de consentimento estiver em modo "Teste".
Para produção o certo continua sendo a service account, que não depende de pessoa.
Então OAuth aqui é **desbloqueio de desenvolvimento**, não decisão de arquitetura —
e o `probe:gsheets` imprime qual identidade está em uso justamente para que isso não
passe batido no dia em que alguém for para produção.

**Por que um `403` precisa saber qual identidade falhou.** As soluções são opostas:
com service account, compartilhar a planilha com um robô; com OAuth, reautorizar com
uma conta que enxergue o documento. Uma mensagem que sirva para os dois casos não
serve para nenhum — daí o texto do 403 ramificar por tipo de identidade.

**Como terminou, em 06/08/2026: service account, e o OAuth nunca foi usado.** Uma
segunda service account foi criada e recebeu Leitor nas 3 planilhas
(`leitura-sheets-instalacao@n8n-workflow-staging…`, de um projeto GCP **diferente**
do da primeira — o e-mail sozinho não serve, é a chave privada dele que autentica).
As 3 abriram, e o desbloqueio veio pelo caminho que já era o certo para produção.
Então o parágrafo acima sobre a divergência temporária **não se aplica ao estado
atual**: nada depende de conta pessoal hoje. O código de OAuth fica, porque é o
caminho de quando não se pode compartilhar com robô, e porque quem escolhe a
identidade (`google-identidade.ts`) é o mesmo que imprime a escolha no probe.

**O que a sequência ensina, e é o motivo de estar escrito:** as três tentativas
custaram tempo porque cada uma foi discutida antes de ser medida. Quando alguém diz
"já compartilhei", a Drive API responde em um segundo quantos arquivos aquela
identidade alcança — e `0` encerra o assunto sem ninguém precisar ler tela em voz
alta. Medir primeiro, investigar depois.

## 24. `Table.TransformColumnTypes` erra por célula, não por tabela — e sem isso `quadro-funcional` não roda

Medido em 06/08/2026, na primeira execução da camada M contra a planilha real. A
query morreu com:

```
Table.TransformColumnTypes: a coluna 'MINDSIGTH' tem string ("Fit 52,0")
e o passo pede number.
```

E o passo do M realmente pede: `{"MINDSIGTH", type number}`. O dado realmente é
texto. Só que **no Power BI isso não é erro de query** — é célula de Erro, uma por
célula, e a tabela carrega.

O tamanho exato do problema, medido coluna por coluna sobre as 16.687 linhas:

| Coluna | Tipo que o M pede | Não converte | Nas 535 linhas do filtro | Exemplos |
|---|---|---|---|---|
| `MINDSIGTH` | `type number` | **68** (24 distintos) | **0** | `"Fit 52,0"`, `"Fit cultural 50,67"`, `"Não se aplica"`, `"Não terminou"` |
| `RG` | `Int64.Type` | **16** (16 distintos) | **0** | `"B057890-A"`, `"RJ - 268282886"`, `"5445157 (RG de SC)"` |

As outras 5 colunas numéricas (`ADMISSÃO`, `DEMISSÃO`, `DATA DE NASCIMENTO `,
`DATA RECRUTAMENTO`, `ID VAGA`) convertem 100%.

**Por que o relatório de hoje funciona apesar disso.** Três coisas ao mesmo tempo: o
passo de tipo roda **antes** do filtro de gestor, então as 84 células ruins existem;
mas nenhuma delas cai nas 535 linhas que sobrevivem ao filtro; e nenhuma medida do
modelo cita `MINDSIGTH` ou `RG`. O Power BI marca as células, ninguém lê, e o número
final não muda. É um erro real que não tem consequência — ainda.

**O que foi implementado, e por que não é afrouxar o fail-loud.** O engine ganhou
`MCellError`, um valor M que carrega o motivo da falha. `Table.TransformColumnTypes`
passa a produzi-lo em vez de derrubar a tabela, e a célula é **inerte** enquanto
ninguém a lê: pode ser filtrada fora, reordenada, descartada. No instante em que
alguém a *usa*, o erro original sobe:

- `each [MINDSIGTH] + 1` → erro, citando `"Fit 52,0"`;
- comparação, inclusive igualdade → erro. Este era o furo perigoso: `igual()`
  devolveria `false` calado, e a linha seria filtrada fora sem ninguém saber;
- ida para o modelo semântico (`toDatasetRows`) → erro, com coluna e linha.

O que **não** acontece é a célula virar `null` nem continuar texto em silêncio. As
duas seriam mais fáceis e as duas são o modo de falha do achado 1: número errado sem
erro nenhum no caminho. O fail-loud não foi relaxado — mudou de lugar, do passo de
tipo para o ponto de leitura, que é onde o Power Query também o coloca.

**A distinção que impede a fidelidade de virar cegueira.** Só *dado incompatível*
vira célula de Erro (a classe `MTipoIncompativel`). Tipo que o engine não implementa
continua derrubando a query, porque uma coluna inteira virando Erro em silêncio
pareceria sucesso — e o engine responderia "rodou" para uma query que não entendeu.

## 25. A chave de junção de `quadro-funcional` tem nome repetido — hoje inofensivo, por acidente de data

Medido em 06/08/2026, no mesmo perfil. O último passo do M cria a chave que liga o
quadro funcional ao resto do modelo:

```m
#"Personalização Adicionada" = Table.AddColumn(#"Linhas Classificadas", "upper_name",
    each Text.Upper([NOME]))
```

Nas 535 linhas que sobram do filtro de gestor: **535 preenchidos, 533 distintos, 0
vazios**. Ou seja, **2 nomes aparecem duas vezes**. E os dois casos, olhados de
perto, são a mesma coisa — **nenhum é duplicata de digitação**:

| Nome | Linha 1 | Linha 2 |
|---|---|---|
| `DJONATA … WEDY` | 2023-03-28 → 2024-05-27, gestor **Luis Aranda**, *Técnico Instalador Jr N1* | 2024-11-19 → 2025-07-25, gestor **Pablo Borges**, *Instalador de Linhas de Telecom N1* |
| `GABRIEL DA SILVA FREITAS` | 2024-11-05 → 2025-06-17, *Auxiliar de Instalador*, `SITUAÇÃO=Demitidos` | sem `ADMISSÃO`, `SITUAÇÃO=Recrutamento`, mesmo gestor (**Stefany Souza**) |

São **recontratações**: a mesma pessoa com dois vínculos, sem sobreposição de
período. A planilha é histórico de **vínculo**, e `upper_name` está sendo usada como
se fosse chave de **pessoa**. Não há erro de cadastro para limpar.

**O que a duplicidade faz, exatamente.** O único consumidor é
`protocolos-produtividade`:

```m
#"Consultas Mescladas3" = Table.NestedJoin(#"Consulta Acrescentada", {"TECNICO"},
    #"QUADRO FUNCIONAL", {"upper_name"}, "QUADRO FUNCIONAL", JoinKind.LeftOuter),
#"QUADRO FUNCIONAL Expandido" = Table.ExpandTableColumn(#"Consultas Mescladas3",
    "QUADRO FUNCIONAL", {"GESTOR"}, {"GESTOR"})
```

`NestedJoin` guarda as 2 linhas casadas numa tabela aninhada, e `ExpandTableColumn`
as **abre em 2 linhas**. Se um protocolo fosse desses dois técnicos, aconteceria isto:

- **`DJONATA`**: cada protocolo dele viraria 2 linhas, uma com `GESTOR=Luis Aranda` e
  outra com `GESTOR=Pablo Borges` — o mesmo serviço creditado a **dois gestores ao
  mesmo tempo**, independente de quando foi executado, porque a junção é por nome e
  não por período de vínculo.
- **`GABRIEL`**: as 2 linhas têm o mesmo gestor, então contaria **duas vezes para a
  mesma pessoa**. Sem ambiguidade de atribuição, só inflação.

**O efeito hoje é ZERO, e isso foi medido — não inferido.** Duas medições
independentes:

1. `npm run run:mlayer -- --only=protocolos-produtividade --passos` mostra
   `Consultas Mescladas3` e `QUADRO FUNCIONAL Expandido` com **exatamente a mesma
   contagem**. Como a expansão emite `max(1, linhas_aninhadas)` linhas por linha da
   esquerda, contagem igual **prova** que nenhuma linha casou com 2 — ou seja, a
   chave duplicada não foi tocada.
2. Consultando o ERP direto: os dois nomes estão **ausentes** dos alocadores de 2026.

**E o motivo de ser zero não tem nada a ver com a junção — é um acidente de data.**
`alocacao-patrimonio`, que é de onde `INSTALADO POR:` nasce, termina com
`AND plis.out_date > '01/01/2026'`. Os dois vínculos duplicados encerraram em
25/07/2025 e 17/06/2025. Eles não aparecem porque saíram antes da janela, não porque
alguma coisa protege a junção.

**Então isto é defeito latente, não defeito inexistente** — e é por isso que continua
registrado. Basta um técnico ser recontratado e trabalhar dentro da janela para a
duplicação começar, silenciosamente, num relatório que ninguém vai reconferir. Não
tem erro, não tem aviso: só um número que passa a ser maior do que deveria.

**Uma coisa que a medição confirmou de passagem, e que valia confirmar:** a mesclagem
**funciona** — 30 nomes casam, cobrindo 8.584 linhas de alocação em 2026. A maioria
dos alocadores não casa, e isso é **por desenho**: o M filtra `QUADRO FUNCIONAL` para
3 dos 69 gestores, então técnico de fora dessas 3 equipes sai com `GESTOR` nulo, que
é o que o relatório quer. Não confundir com falha de junção.

**A plataforma replica, e isso é deliberado.** O Power BI de hoje faz exatamente
isto, e a regra é replicar fielmente ([SPEC-DRIVEN](./SPEC-DRIVEN.md)); corrigir no
engine faria os números divergirem do relatório que as pessoas conferem hoje. Mas a
correção certa é de negócio, não de código: juntar por vínculo (nome + período) em
vez de por nome, ou ter matrícula/CPF como chave. Registrado em
[PERGUNTAS-NEGOCIO.md](./PERGUNTAS-NEGOCIO.md).

## 26. Onde o tempo da camada M vai: 80% é o banco, e o que era nosso era lixo de alocação

Medido em 06/08/2026, quando a pergunta passou a ser "carregar rápido". Antes disso
ninguém tinha medido a divisão — e as duas suposições naturais estavam erradas.

`run:mlayer` passou a separar três tempos (`onBusca` devolve `msExecute` e
`msConversao`; o de M sai por subtração). Rodando as 23 queries:

| | ms | % |
|---|---|---|
| fonte (banco/rede) | 136.307 | **80%** |
| conversão de `Row[]` em valor de M | 438 | 0% |
| avaliação dos 303 passos de M | 33.707 | 20% |

**A primeira suposição errada era a conversão.** Parecia o suspeito óbvio —
`field-agenda` tem 1,4 milhão de linhas e cada uma passa por `comValoresAninhados`.
São 438 ms no total, 0%. Não é ali.

**A segunda era o algoritmo.** Perfilando `protocolos-produtividade` com
`node --cpu-prof` (60 passos, 65 mil linhas finais, 55 s):

```
  52%  (idle)              — esperando o banco
  24%  (garbage collector)
   7%  linha        value.ts
   2%  Table.NestedJoin
```

`Table.NestedJoin` já era indexado por hash, e aparece com 2%. **O gargalo nosso era
o coletor de lixo**, e a causa é um idioma que se repetia em 19 lugares:

```ts
linha(t.columns.map((c) => [c, r.get(c) ?? null] as const))
```

Cada linha de cada passo alocava um array de N arrays de dois elementos, só para o
`Map` consumir e descartar. Em `protocolos-produtividade` são 65 mil linhas × 48
colunas × 60 passos de lixo puro. E `comoRegistro` fazia o mesmo mais uma cópia de
`Map` inteira **por linha**, para o `each [COLUNA]` ler **um** campo.

**As duas correções, sem mudar semântica:**

1. `linhaPor(columns, valor)` grava direto no `Map`, sem par intermediário. Substituiu
   o idioma nos passos que reconstroem a linha (`RenameColumns`, `RemoveColumns`,
   `SelectColumns`, `ReorderColumns`, `AddColumn`, `DuplicateColumn`, `ReplaceValue`,
   `TransformColumns`, `TransformColumnTypes`, `PromoteHeaders`, `Combine`,
   `NestedJoin`, `ExpandTableColumn`, `SplitColumn`).
2. `MRecord` ganhou construção **por espelho**: `new MRecord(colunas, linha)` compartilha
   o `Map` da linha (que já é imutável) e materializa os campos só se alguém precisar
   iterá-los. `each [COLUNA]` nunca precisa.

**Resultado medido, mesma máquina, mesma query, saída idêntica** (33.799 linhas de
fonte → 65.363 finais, 48 colunas, nos dois lados):

| | antes | depois |
|---|---|---|
| avaliação de M em `protocolos-produtividade` | 32.566 ms | **12.116 ms** |
| avaliação de M nas 23 queries | 33% do tempo | **20%** |

**O que isto diz para a Fase 3, e é a parte que importa.** Depois de 2,7× no
avaliador, **80% do tempo continua sendo o banco** — e três statements pairam no
`statement_timeout` de 30 s (`protocolos-geral`, `field-agenda`,
`protocolos-auxiliares` estouraram numa execução e passaram na seguinte, sem
mudança nossa). Ou seja: **otimizar o engine não vai fazer o dashboard abrir rápido.**
O que faz é não repetir o `SELECT`, e a arquitetura para isso já está desenhada — o
`Cache` é porta do Engine e `specs/_catalog/cache-policies.yaml` já tem TTL por query
(60 s no operacional quente, 900 s em cadastro, 1 dia em feriado). O que falta medir,
quando a Fase 3 chegar, é *hit rate*, não velocidade de M.

E fica o alerta que a medição expôs de graça: com 30 s de `statement_timeout` e
statements de 17–31 s, a carga é **intermitente por construção**. Antes de discutir
cache vale olhar índice no ERP — uma query que às vezes estoura o limite vai às vezes
estourar o do usuário também.

## 27. Os filtros dos visuais ficavam fora das specs, e sem eles o Widget Engine nasceria errado

Primeiro achado da Fase 3, medido em 06/08/2026 antes de escrever uma linha do Widget
Engine. A pergunta era simples: a spec de um visual tem tudo que é preciso para
calcular o número que ele mostra? Não tinha.

O `filterConfig` do PBIP — que existe em **página** e em **visual** — não era
extraído. O efeito é o pior possível: um card com filtro de visual seria computado
sem ele, daria um número maior, e **nada erraria no caminho**. Não é hipótese; é
aritmética de contexto de filtro.

**O tamanho, medido nos 306 visuais das 14 páginas:**

| | quantidade |
|---|---|
| filtros de **visual** que restringem de fato | **102** |
| filtros de **página** que restringem de fato | **6** |
| cartões de filtro **sem seleção** (não mudam número) | **176** |
| formas que o extrator não traduz | **0** |

A separação entre as duas primeiras linhas e a terceira é o que impede a conta de
confundir depois: 284 filtros existem no PBIP, e só 108 têm condição. Os outros 176
são o cartão que alguém abriu no Power BI e deixou sem seleção — ele aparece na
interface e não altera resultado. Por isso a spec grava `filters` e `filters_vazios`
separados, em vez de os vazios desaparecerem: quem comparar 108 com 284 precisa achar
a explicação escrita, não deduzi-la.

**O vocabulário é pequeno, e isso foi verificado antes de traduzir** — não há forma
"genérica" a adivinhar. São cinco condições e quatro formatos de literal:

| Condição no PBIP | Vira | Ocorrências |
|---|---|---|
| `Not(In(...))` | `not_in` | 54 |
| `Comparison` (com `ComparisonKind`) | `comparison` | 28 |
| `In(...)` | `in` | 22 |
| `Between` com `DateSpan`/`DateAdd`/`Now` | `between_relativo` | 4 |
| `Not(Comparison(...))` | `comparison` + `negado: true` | (dentro dos 54/28) |

Três decisões de tradução que mudam resultado, e ficam registradas por isso:

1. **`In` e `Not(In)` são traduzidos separadamente.** A "seleção invertida" do Power
   BI (`isInvertedSelectionMode`) chega como `Not(In)`, e a diferença entre os dois é
   o relatório inteiro: "só estes" contra "todos menos estes". Traduzir os dois como
   `in` daria número plausível e errado.
2. **Data relativa guarda o deslocamento, não a data resolvida.** `Between` com
   `DateAdd(Now(), -7)` vira `{amount: -7, time_unit: 0}`. Resolver na extração
   congelaria "os últimos 7 dias" na data em que `npm run extract` rodou — o filtro
   passaria a significar outra coisa a cada dia.
3. **Forma desconhecida não desaparece:** vira `op: desconhecido` com o JSON cru, e
   **há teste de integração exigindo zero desconhecidos** contra o PBIP real. No dia
   em que alguém usar um filtro novo no Power BI, o teste falha dizendo em qual página
   e visual — em vez de a plataforma calcular sem ele.

**O que isto habilita.** Com filtro na spec, um visual passa a ser calculável ponta a
ponta, e a conferência de paridade fica mais barata do que era: em vez de alguém ditar
78 totais de medida, compara-se **visual a visual** — o número está na tela. É também
o que a 2b.9 precisava para deixar de depender de ditado.

## 28. A agregação dos campos era jogada fora, e 84 campos de visual não eram calculáveis

Segundo achado da Fase 3, na mesma pergunta que produziu o 27 — *a spec de um visual
tem tudo que é preciso para calcular o número que ele mostra?* Com os filtros no lugar,
a resposta continuou sendo não, por outro motivo: a spec dizia **qual** coluna o visual
agrega e não dizia **como**.

`{kind: aggregation, entity: 'PROTOCOLOS GERAL', property: 'SOLICITACAO'}` não é
calculável. Somar, contar, contar distintos e pegar o mínimo daquela coluna dão quatro
números diferentes, e os quatro têm a mesma cara de número certo na tela. Três das cinco
formas de campo do PBIP saíam mutiladas:

| Forma no PBIP | O que a spec dizia antes | Campos |
|---|---|---|
| `Aggregation` | agrega a coluna — sem dizer com qual função | **84** |
| `HierarchyLevel` | `kind: column` com `entity: null, property: null` | **69** |
| `Arithmetic` | `kind: column` com `entity: null, property: null` | **2** |

Os 69 `HierarchyLevel` são a hierarquia automática de datas (`Data Criado Ano`). Como o
campo aponta para a coluna de origem por `PropertyVariationSource`, o extrator antigo não
achava `Property` e gravava nulo — 37 slicers e 32 eixos de gráfico descritos como
"coluna nenhuma". Um efeito colateral visível: slicers com `entities_used: []`, isto é,
visuais que a spec afirmava não ler tabela alguma.

### `queryRef` parece a resposta e é uma armadilha

O PBIP traz, ao lado de cada campo, o texto `queryRef` (`"Sum(CAPACIDADE EQUIPE.CAPACIDADE
MANHÃ)"`) e `nativeQueryRef` (`"Contagem de protocolo"`). É tentador ler a função dali.
**Medido neste PBIP, o mesmo `Function: 2` aparece com quatro textos diferentes** —
`Count(...)`, `CountNonNull(...)`, `Sum(...)`, `Min(...)` e sem função nenhuma. O texto é
congelado no momento em que o campo foi criado e nunca reescrito: há `queryRef` citando
`HoraAtualizado` e `Protocolos/Telefonia`, nomes de tabela que já não existem no modelo.
Só `Function` está atualizado.

Por isso **`queryRef` não entra na spec**. Guardar um texto provado velho ao lado do dado
correto seria deixar armadilha para quem viesse depois.

### Mas o texto velho prova o vocabulário, justamente por ser histórico

`Count(...)` aparece **só** com `Function: 2` — campos que ninguém alterou desde que
foram criados. `CountNonNull(...)` aparece com 2 **e** com 5 — foram criados como 5 e
alterados depois. Logo 2 é `Count` e 5 é `CountNonNull` na nomenclatura do próprio PBIP,
e a spec grava o nome **e** o número (`aggregation: count`, `aggregation_code: 2`): o
nome é nossa leitura, o número é o dado, e quem quiser refazer a leitura consegue.

O vocabulário completo, medido: `count` 34, `min` 24, `count_non_null` 14, `sum` 8,
`max` 3, `avg` 1. Nenhuma mediana, desvio ou variância — e se aparecerem, o nome sai
`desconhecida6` e o teste de integração falha dizendo em qual visual, em vez de virar
`null` e ser lido como "sem agregação".

### O que ainda não se decide aqui, e quanto isso custa

Falta a semântica DAX de `count`: contagem **distinta** ou contagem de **não-vazios**.
Em vez de escolher no escuro, o tamanho da dúvida foi medido contra os goldens — e ele é
pequeno:

- das 10 cartas `count`, 8 estão sobre colunas **100% distintas** no perfil
  (`SOLICITACAO` 5000/5000, `N°PROTOCOLO` 5000/5000, telefonia 558/558). Nessas, as duas
  leituras dão o **mesmo** número;
- sobram **2 de 64 cards**, ambos sobre `CLIENTE`, que repete (4404 distintos em 5000
  perfilados na geral; 466 em 558 na telefonia).

E a evidência de dentro do relatório aponta para contagem distinta: o card que alguém
batizou de **`CLIENTES DISTINTOS`** é exatamente `Function: 2`. A confirmação de cinco
segundos está em `docs/PERGUNTAS-NEGOCIO.md` #6 — olhar o card `CLIENTES` da página de
telefonia e ver se ele mostra 466 ou 558.

Nota de escopo semelhante: `avg` (1 campo, `Function: 1`) tem `queryRef` dizendo `Sum` —
outra prova de texto velho. Está num gráfico combinado, não em card, e por isso não
bloqueia a fatia atual.

### O que isto habilita

Somado ao 27, um card agora é calculável ponta a ponta: **um** campo (`role: Values`,
sempre um só nos 64), com função de agregação explícita ou uma medida nomeada, mais os
filtros de visual e de página. É o que faltava para o Widget Engine começar pelo caso
mais barato de conferir.

---

## 29. Duas páginas inteiras eram filtradas "a partir de hoje" quando o filtro diz uma data fixa

Terceiro achado da mesma família do 27 e do 28, e o de raio maior: o extrator lia **toda**
`DateSpan` como se a âncora fosse `Now()`.

```js
right: cond.Comparison.Right?.DateSpan
  ? { relativo: 'agora', time_unit: cond.Comparison.Right.DateSpan.TimeUnit ?? null }
  : ...
```

`DateSpan` é `{Expression, TimeUnit}` — uma data truncada numa unidade — e a `Expression`
**não é sempre `Now()`**. Medido no PBIP de 06/08/2026, das 21 datas relativas do
relatório duas ancoram em data fixa, e as duas são filtros de **página**:

| página | o PBIP diz | a spec dizia |
|---|---|---|
| AGENDAMENTO FIELD | `Data > DateSpan(datetime'2025-08-31T01:00:00', 5)` | `relativo: agora` |
| INSTALAÇÃO/ REINCIDENTE | `DATA INSTALADO >= DateSpan(datetime'2026-01-01T00:00:00', 5)` | `relativo: agora` |

Filtro de página vale para **todos** os visuais da página. Um Widget Engine lendo essa
spec calcularia as duas páginas inteiras a partir de *hoje* em vez de 31/08/2025 e
01/01/2026 — e o número mudaria sozinho todo dia, sempre com cara de número certo.

Agora a âncora é lida, e `anchor_kind` (`agora` | `literal` | `desconhecido`) é explícito
justamente para que os dois casos não possam ser confundidos por quem consome:

```yaml
right:
  anchor_kind: literal
  anchor: 2026-01-01T00:00:00
  time_unit: second
  time_unit_code: 5
```

### `TimeUnit`: os nomes foram apurados do próprio relatório, não copiados

`DateSpan` e `DateAdd` compartilham o enum, e é isso que permite fixá-lo sem documentação:

- os quatro `DateAdd` do relatório usam `TimeUnit: 0` com montantes `-7`, `-1`, `+1` e
  `+365`. Só fazem sentido como **dia** ("últimos 7 dias", "próximos 365 dias") ⇒ **0 = dia**;
- com 0 = dia, os outros valores caem na sequência de calendário crescente: **2** aparece
  em 14 filtros `RelativeDate` de visual como `DateSpan(Now(), 2)` — "este mês" — e **3**
  em 1 filtro de página, "este ano";
- **5** aparece só nos dois filtros `Advanced`, sobre data **literal já alinhada ao
  segundo**. Cai no bloco de unidades abaixo do dia, onde truncar não muda nada — por isso
  aqueles dois estão seguros mesmo sem cravar se 5 é segundo, minuto ou hora.

Medido: `day` 20, `month` 14, `second` 2, `year` 1. Valor nunca visto sai como
`unidade<N>` em vez de virar dia por omissão, e o teste de integração falha dizendo onde:
um filtro de semana lido como dia daria número errado calado.

### E `eq` contra `DateSpan` não é igualdade

`DateSpan` é um **intervalo**. `coluna = DateSpan(Now(), mês)` é como o Power BI escreve
"este mês" — "cai dentro do intervalo", não "é igual a". Sem a unidade na spec, "este mês"
e "este ano" ficariam indistinguíveis; é por isso que `time_unit` sobrevive até o cálculo
em vez de ser resolvido na extração.

### O truncamento das bordas de `Between` também era descartado

A borda é `DateSpan(DateAdd(...DateAdd(Now())), unidade)`: deslocamentos encadeados e **um
truncamento por fora**. Só os deslocamentos eram guardados. É o truncamento que faz
"últimos 7 dias" começar à **meia-noite** em vez de na hora corrente — diferença de até um
dia de dados na ponta da janela. Agora a borda é um objeto com `anchor_kind`, `truncate` e
`offsets`, em vez de uma lista solta de deslocamentos.

Efeito nas specs: 5 dashboards mudaram (`agendamento-field`, `instalacao-reincidente`,
`manutencao-inicial`, `relatorio-do-mes`, `visao-geral`). 581 testes verdes.

## 30. Dez filtros são `COUNT(coluna) > 0`, e como predicado de linha viram outro filtro

Quarto achado da família do 27, 28 e 29 — e o primeiro que estava no **código**, não na
extração. A spec já trazia o dado certo; o Widget Engine é que o ignorava.

Uma condição de comparação tem `left_aggregation`, e ela não é decoração:

```yaml
# visao-geral, filtro de visual
op: comparison
kind: gt
left_property: SOLICITACAO
left_aggregation: count     # <- isto
right: 100
```

O lado esquerdo é `COUNT('PROTOCOLOS GERAL'[SOLICITACAO])`, não `[SOLICITACAO]`. É o
"filtrar por valor agregado" do painel do Power BI: um **HAVING**, que decide quais
**grupos** o visual mostra, e não quais linhas entram na conta.

`traduzFiltros` construía o predicado a partir de `left_property` e nunca olhava
`left_aggregation`. O resultado é um filtro **diferente**, não um filtro aproximado:

| o relatório diz | o que era aplicado |
|---|---|
| `COUNT(SOLICITACAO) > 100` — grupos com mais de 100 protocolos | `SOLICITACAO > 100` — linhas cujo número de protocolo passa de 100 |
| `COUNT(N°PROTOCOLO) > 0` — grupos com algum protocolo | `N°PROTOCOLO > 0` — linhas com número positivo |

Num campo numérico o segundo aceita **quase toda linha**, e o filtro some sem deixar erro.
Hoje as duas colunas estão declaradas `string` no modelo, então o guarda de espécie
pegaria — mas por acidente do tipo declarado, não por desenho.

São 10 no relatório, medidos: `count > 0` em 8 e `count > 100` em 2, distribuídos em
3 `pivotTable`, 5 `tableEx`, 1 `barChart` e 1 `columnChart`. **Nenhum em card** — é o que
torna a correção barata agora: ela não muda número nenhum que já se calcula.

Correção em duas etapas, e a segunda fechou.

**Primeira (06/08/2026):** `filtro.ts` passou a **recusar pelo nome** condição com
`left_aggregation`. Implementar de verdade exigia o agrupamento do visual, que ainda
não existia; até lá, recusar é o que impede o filtro de virar outro em silêncio.

**Segunda (06/08/2026, com o agrupamento pronto): implementado.** `separaFiltros`
divide os filtros em dois momentos e `predicadoDeGrupo` avalia a agregação **dentro do
escopo do grupo** — que é o que o HAVING sempre foi. A ordem entre os dois é a regra, e
trocá-la não dá erro, dá outro número:

| momento | quem | o que decide |
|---|---|---|
| antes de agrupar | filtro de linha | o que entra na conta |
| depois de agrupar | filtro de grupo | quais grupos sobrevivem |

`traduzFiltros` **continua recusando** — e isso não é resto de implementação. Ela
traduz predicado de linha, e quem não sabe agrupar (o card) tem de receber o erro: um
card não tem grupos para filtrar, e nenhum dos 10 está em card. Há teste dos dois lados.

Efeito medido: as tabelas que calculam foram de **15 para 19** das 29. Quatro das cinco
`tableEx` com HAVING passaram a rodar; a quinta caiu na família seguinte (chaves de mais
de uma tabela), e é por isso que aquela subiu de 4 para 5.

A função de agregação sai do **mesmo mapa** dos campos de visual (`agregacao.ts`, extraído
de `card.ts` para os dois usarem um só). Isso liga o HAVING à PERGUNTAS-NEGOCIO #6: se
`count` for contagem de não-vazios em vez de distinta, muda nos dois de uma vez. Duas
cópias divergiriam exatamente no dia da resposta.

### O que a medição de cobertura mostrou junto

Os cards executam todos: **64 de 64**, com os filtros de página e de visual aplicados.
Mas o número que importa é o outro: **36 cards têm filtro e só 5 mudam de valor** quando
ele entra. Nos outros 31 o filtro aceita todas as linhas — cinco linhas sintéticas de
valores uniformes passam em quase qualquer predicado.

É a mesma lição da 2b.5, onde 22 medidas dependiam de propagação e o dado sintético só
conseguia mover **uma**. Os dois números ficam presos no teste para que a distância entre
eles seja visível: o caminho de filtro *executa* em 36 e está *exercitado* em 5.

## 31. `PROTOCOLOS GERAL[CONTAGEM]` é o texto `"1"` e se declara `int64` — RESOLVIDO em 07/08/2026

Coluna calculada cujo DAX é um literal de **texto**, com tipo declarado numérico:

```yaml
name: CONTAGEM
type: int64
calculated: true
dax: '"1"'
```

É o idioma clássico de "coluna que sempre vale 1 para poder somar" — só que escrito
com aspas. No Power BI isso não incomoda: o tipo declarado da coluna é `int64`, o
motor armazena o inteiro 1, e `SUM('PROTOCOLOS GERAL'[CONTAGEM])` devolve a contagem
de linhas. Aqui o avaliador calcula o DAX, obtém o texto `"1"`, e `SUM` **erra alto**:
DAX não converte texto para número implicitamente, e o avaliador não converte na
surdina.

**Duas tabelas do relatório param nisso** (`l-inst` e `l-tec`, ambas somando
`[CONTAGEM]` com três colunas de detalhe). Nenhum card é afetado.

### Por que não foi "consertado" junto

Porque o conserto é uma **regra**, não um caso, e a regra tem custo. Já existe
`aplicaTipo` (measure-engine/calculated.ts), e ele é deliberadamente estreito: aplica
só `dateTime`, e só converte número → data. Texto onde se declarou data **erra alto
de propósito**, e o comentário no arquivo diz por quê — é a mesma classe de erro do
achado 1 falso, onde um `DD/MM/YYYY` comparado direto vira março em vez de abril.

Alargar `aplicaTipo` para "texto → número quando a coluna se declara numérica"
resolveria estas duas tabelas e abriria a porta para converter texto de verdade em
número em silêncio. Num modelo cuja cultura é `pt-BR`, `"1.234,56"` tem duas leituras
plausíveis e nenhuma segura.

Há ainda um segundo custo, e ele decide o tamanho: `aplicaTipo` hoje roda ao
materializar **tabela calculada**. Coluna calculada de tabela de query é avaliada em
`Evaluator.columnValue`, no caminho quente, que não aplica tipo nenhum. Fazer isso
ali é mudança de semântica do avaliador inteiro — 49 colunas calculadas — e merece
ser medida, não enfiada no meio de outra fatia.

**Três saídas possíveis, para quem for decidir:**

1. **Conversão estreita e nomeada:** ao materializar, texto que casa `/^-?\d+$/`
   exatamente vira número quando a coluna se declara `int64`. Recusa qualquer outro
   texto. Cobre o caso e não abre a porta.
2. **Corrigir no Power BI:** trocar `"1"` por `1` no DAX da coluna. É onde o defeito
   está de verdade, mas mexe na base de referência — que é read-only por regra.
3. **Deixar como está**, com as duas tabelas recusando pelo nome. É o estado atual, e
   é o único que não decide nada errado.

`cobertura.test.ts` conta as duas recusas nominalmente, então a escolha aparece como
mudança de número quando alguém a fizer.

### Efeito colateral bom: os erros de agregação passaram a dizer a coluna

Este achado só ficou legível porque a mensagem foi consertada. Ela era:

```
SUM: esperava número e recebeu o texto "1".
```

Num modelo de 298 colunas, isso não diz onde procurar. Agora `agregacao` leva a
referência para dentro do erro do redutor:

```
SUM('PROTOCOLOS GERAL'[CONTAGEM]): esperava número e recebeu o texto "1".
```

Vale para `SUM`, `AVERAGE`, `MIN` e `MAX`. Foi o classificador de recusas do teste de
cobertura que expôs a falta — ele não conseguia dizer de qual coluna a recusa era.

### Resolvido em 07/08/2026, e o que decidiu foi a medição

A hesitação acima era sobre o **tamanho** da regra, não sobre o caso. Medido: das 49
colunas calculadas da base, **3** declaram tipo, e **1** devolve texto onde declarou
número. O raio de alcance da regra é uma coluna.

E a regra que ficou não é a que estava sendo temida. Não é *"SUM converte texto"* —
essa valeria para qualquer texto chegando a qualquer agregação, e é a porta para
`"1.234"` virar 1,234. É *"o tipo declarado da coluna vale na hora de materializar"*,
que é o que o Power BI faz: a expressão produz um valor, e a coluna o armazena no
tipo em que foi declarada. A conversão é **da coluna**, não da soma, e mora em
`aplicaTipo` junto com a de `dateTime` que já existia.

Duas travas mantêm a regra honesta, e as duas têm teste:

- **só literal sem ambiguidade** (`/^-?\d+(\.\d+)?$/`). `"1.234,56"`, `"1,234.56"`,
  `"1 234"` e `"R$ 10"` **erram alto**. Numa base `pt-BR` a diferença entre as duas
  leituras de `"1.234"` é de mil vezes, e nenhuma pode ser escolhida em silêncio.
- **a agregação continua sem converter.** `1 + "2"` erra alto como antes.

As 2 tabelas passaram a calcular.

---

## 32. O estado de drill era descartado: 21 projeções que a tela não mostra

Quinto achado da família do 27, 28, 29 e 30 — e o segundo que estava na **extração**.
O PBIP marca cada projeção de um poço com `active`, e o extrator lia o campo sem
gravá-lo.

```json
"Category": { "projections": [
  { "field": { "HierarchyLevel": { ..., "Level": "Ano" } }, "active": true  },
  { "field": { "HierarchyLevel": { ..., "Level": "Mês" } }, "active": true  },
  { "field": { "HierarchyLevel": { ..., "Level": "Dia" } }, "active": false }
]}
```

Um eixo com a hierarquia automática de datas lista **os três níveis sempre**. Quem
diz o que a tela mostra é o `active`: acima, o gráfico tem um ponto por **mês**.
Agrupando pelos três, ele teria um ponto por **dia** — trinta vezes mais pontos, e
nenhum erro.

### A medição que mostra que o campo não é decorativo

Se todas as projeções fossem ativas, ignorar `active` não custaria nada. Medido no
PBIP de 07/08/2026, sobre 448 projeções:

| `active` | n | o que é |
|---|---|---|
| `true` | 125 | declaradamente em jogo |
| `false` | **21** | a tela não mostra |
| ausente | 302 | poço de um campo só, onde a pergunta não se coloca |

E as 21 não estão espalhadas ao acaso:

| onde | n | |
|---|---|---|
| `slicer` | 16 | níveis de hierarquia abaixo do drill |
| `lineStackedColumnComboChart` | 4 | o `Dia` de gráficos que exibem por mês |
| `clusteredBarChart` | 1 | **uma coluna comum**, não nível de hierarquia |

A última linha é a que generaliza a regra. `active` não é sobre hierarquia de datas:
é sobre **quais projeções do poço estão em jogo**, e duas colunas comuns num eixo
formam uma hierarquia de drill do mesmo jeito.

### `null` não é `true`, e a distinção é da spec

O extrator grava `true`, `false` ou `null` — e `null` significa "o PBIP não declarou
estado", não "está ativo". São 302, todas de poço de um campo só.

Gravar `true` ali seria afirmar um estado de drill que ninguém escreveu. Quem decide
que na prática `null` e `true` levam ao mesmo lugar é **uma função só**,
`campoAtivo` em `grupos.ts`, e é lá que a decisão fica visível se um dia mudar.

### Campo inativo não aparece — nem como coluna, nem como chave

Foi a segunda coisa a acertar. "Inativo" não é "não agrupa por ele": é **não está no
visual**. Mantido como coluna da tabela, criaria uma coluna que a tela não tem;
mantido como chave, refinaria o agrupamento. As duas com cara de dado.

Tabela cujos campos são **todos** inativos erra alto: não existe tabela sem coluna
nenhuma na tela, e o caso só pode ser leitura errada do estado.

### Por que a cobertura não mudou, e por que isso está testado

**Nenhuma das 21 está em `tableEx`** — são 16 de slicer e 5 de gráfico. Ligar
`active` não moveu as 19 tabelas que calculam, e há teste afirmando isso. Ele existe
para o dia em que mover: sem ele, a mudança pareceria regressão em vez de correção.

O ganho é adiantado, e é para a fatia dos gráficos: 5 das 21 estão nos gráficos que
vêm a seguir, e sem isto eles nasceriam agrupando por dia.

---

## 33. O eixo de datas não é uma coluna, e ignorá-lo custaria 356 pontos falsos

Não é um defeito do PBIP — é uma armadilha da leitura, e ela só aparece quando se
tenta desenhar o gráfico. Fica registrada porque a decisão que a desarma é
invisível no código de quem só lê a spec.

**`'T'[Data].[Mês]` não existe como coluna.** É uma projeção da coluna de data,
gerada pelo Power BI numa tabela local (`LocalDateTable_*`). Agrupar por ela exige
projetar o nível linha a linha; procurar uma coluna chamada `Mês` não acha nada, e
o caminho fácil dali é agrupar pela data crua — que dá **um ponto por data**, não
por mês.

### O tamanho do erro, medido

O eixo de 10 dos 16 gráficos é essa hierarquia. Com os níveis inativos entrando no
agrupamento, os 13 gráficos que calculam dão **455 pontos** em vez de 99. É 4,6× a
mais, e nenhum deles com cara de erro: são pontos plausíveis, ordenados, com
valores que somam certo. Um gráfico de linha com 4,6× os pontos parece um gráfico
mais detalhado.

O número foi obtido trocando `campoAtivo` por `return true` e rodando a cobertura —
está no teste `os 13 gráficos que calculam somam 99 pontos e 19 séries`, que é o que
falha se a projeção ou o `active` pararem de valer.

### O que o nível põe em escopo — e o que não põe

Agrupar por `[DATA].[Mês]` **não** põe `'T'[DATA]` em escopo. Dentro do ponto
`janeiro` a data ainda varia entre o dia 10 e o dia 25, então a coluna não está
determinada e `ISINSCOPE('T'[DATA])` tem de responder FALSE. O nível entra sob chave
própria (`t[data].[mês]`).

O filtro do grupo, porém, restringe a **coluna base** — e a assimetria é
deliberada. É ela que faz um `CALCULATE(..., ALL('T'[DATA]))` de dentro de uma
medida sobrepor o eixo, como a inteligência de tempo espera. Registrado sob a chave
do nível, o filtro do eixo sobreviveria ao `CALCULATE` e o número sairia menor sem
nada apontar por quê.

### O que ficou por decidir

Com mais de um nível ativo, o eixo é a combinação de todos (`2026`/`janeiro`) e não
só o mais fino. Dentro de um único ano as duas leituras dão o mesmo resultado; elas
divergem quando o período atravessa o ano. É a pergunta 7 de PERGUNTAS-NEGOCIO.md, e
é uma observação de cinco segundos na tela.

---

## 34. Cruzar tabelas não é produto cartesiano — e o erro seria uma tabela plausível

Treze visuais agrupam por colunas de **mais de uma tabela**: 5 `tableEx`, 3 gráficos
e 5 `pivotTable`. Até aqui todos eram recusados, e a recusa era honesta: as duas
saídas óbvias estão erradas.

| leitura | o que dá |
|---|---|
| produto cartesiano das colunas | cada protocolo em **cada** data — 5 linhas viram 25 |
| varrer só uma das tabelas | falta a coluna da outra |

Nenhuma das duas quebra. O produto cartesiano dá uma tabela maior, ordenada, com
valores que somam certo — parece detalhamento.

### A regra é a tabela expandida do DAX

A *tabela expandida* de `T` é `T` mais tudo que se alcança dela seguindo
relacionamentos **muitos→um**. Se todas as colunas de agrupamento estão na expandida
de uma delas, essa é a **âncora**: varrê-la seguindo os relacionamentos dá exatamente
as combinações que existem, uma vez cada.

`bothDirections` **não** entra na expansão. Ele muda por onde o filtro propaga, não o
que a tabela contém — e se entrasse, qualquer dimensão viraria âncora do próprio
fato, com a varredura saindo da tabela errada.

### A medição que definiu o escopo

| caso | n | resultado |
|---|---|---|
| âncora única entre as próprias tabelas de chave | 12 | resolvido |
| âncora só fora delas | 1 | recusado, com os candidatos nomeados |
| nenhuma âncora | 0 | — |

O caso de fora é `relatorio-do-ano/2d498e...`: `CALENDARIO INSTALADO` e `BASE DE
ORIGEM` são duas dimensões que não se alcançam, e quem as liga é uma tabela de fato
**ausente do visual**. Há 4 candidatas (`FIELD AGENDA`, `INSTALAÇÕES REINCIDENTES`,
`PROTOCOLOS GERAL`, `Status Protocolo Dia`) e cada uma dá um conjunto de combinações
diferente. Escolher em silêncio seria escolher o número.

Também erra alto quando há **dois caminhos do mesmo tamanho** entre as duas tabelas:
são duas junções diferentes — o caso clássico de um fato com data de criação e data
de instalação apontando para o mesmo calendário —, e qual delas vale é decisão do
relatório.

### A linha em branco do relacionamento, que aqui não existe

Foi o defeito que os testes pegaram, e ele é sutil. Uma linha de fato cuja chave
estrangeira não casa com dimensão nenhuma aparece na tela com a coluna da dimensão em
branco — e o valor dela **conta**. Expressar esse grupo como "filtre `'EQUIPES'[REGIAO]`
igual a branco" não seleciona nada: não existe linha de `EQUIPES` com região em
branco. O DAX resolve com a *linha em branco* que todo relacionamento ganha; aqui ela
não existe, e o grupo saía vazio.

O número sairia BLANK onde a tela mostra o valor — e um BLANK numa linha de tabela
não chama atenção nenhuma. Hoje esse grupo é expresso como filtro **sobre a âncora**:
"as linhas cujo caminho não chega a lugar nenhum". Sem coluna declarada, para que um
`CALCULATE` sobre a coluna da dimensão não derrube o grupo inteiro.

### O que isto destravou, e o que continua não provado

Tabelas foram de 20 para **25** das 29; gráficos, de 13 para **15** das 16. A família
"chaves de mais de uma tabela" foi de 5 recusas a zero, e restam duas famílias:
campo aritmético (2) e `[CONTAGEM]` (2, achado #31).

**Mas das 5 tabelas cruzadas, só 2 trazem linha sobre dado sintético** — nas outras 3
o filtro de linha esvazia a âncora antes de agrupar. Zero linha é resultado legítimo
e prova nenhuma. Quem prova a semântica é `expansao.test.ts`, com um dataset montado
para que o produto cartesiano dê 4 combinações onde existem 3, e onde uma delas o
produto nem conhece.

---

## 35. Uma matriz não é uma tabela com duas chaves

Os 8 `pivotTable` do relatório são uniformes: papéis `Rows`, `Columns` e `Values`,
todas as chaves `kind: column` (nenhum nível de hierarquia), no máximo uma chave por
direção. Sete têm as duas direções; um tem só linhas, com três medidas lado a lado.

A tentação é óbvia — já existe `agrupar`, é só passar as chaves das duas direções
juntas. E **está errado**, de um jeito que não quebra.

| | tabela | matriz |
|---|---|---|
| combinação que não existe | não aparece | **célula vazia** |
| conjunto de colunas | por linha | o mesmo em todas |

Com o dado onde `Bauru` não tem `Reparo`: a leitura de tabela dá 3 linhas; a matriz
dá 2 linhas × 2 colunas, e a célula `Bauru`/`Reparo` é vazia. As duas somam o mesmo
total. O que muda é a forma — e uma matriz cujas linhas têm conjuntos de colunas
diferentes não é uma matriz, é uma tabela com cara de matriz.

Por isso os dois eixos são agrupados **em separado**, sobre a mesma base, e a célula
é o cruzamento: os filtros dos dois lados num `with()` único.

### O HAVING é da célula, não da linha

A consulta que o Power BI monta para um visual é um `SUMMARIZECOLUMNS` sobre
**todas** as colunas de eixo juntas, e o filtro de agregado é um HAVING sobre esse
agrupamento. Numa matriz, esse agrupamento é a célula.

A diferença aparece quando só algumas células de uma linha passam: aplicado por
linha, o filtro derruba a linha inteira; aplicado por célula, apaga as células
reprovadas e a linha some **só** se nenhuma passar. São 3 dos 8.

### A poda de vazios, e a propriedade que não foi lida

Linha ou coluna **inteiramente** vazia some — é o padrão da matriz do Power BI. Sem
isso, um eixo de datas traria o mês inteiro de colunas onde a tela mostra os poucos
dias com dado.

**A propriedade que desliga esse padrão ("mostrar itens sem dados") não é lida do
PBIP.** Se algum dos 8 a tiver ligada, a poda tira colunas que a tela mostra. Por
isso o resultado carrega `descartadas: { linhas, colunas }`: o descarte fica contável
em vez de invisível, e o lugar de resolver isso — quando alguém abrir o relatório e
confirmar — é o extrator, não este arquivo.

### O que isto fechou, e o que continua não provado

As 8 calculam, somando **39 células**. Com isso os quatro tipos de visual com número
estão cobertos: card 64/64, tabela 25/29, gráfico 15/16, matriz 8/8.

**Mas 2 das 8 saem sem linha nenhuma sobre dado sintético** — o filtro de linha
esvazia a tabela do eixo antes de agrupar. E o detalhe que torna isso legível: as
duas têm **gêmea na mesma página**, com a mesma chave de linha e o mesmo eixo de
coluna, diferindo por um filtro a mais — e as gêmeas trazem linha. É a terceira vez
que a distância entre "calcula" e "está exercitado" precisa ser medida e presa em
teste.

---

## 36. Os últimos cinco visuais, e as duas regras que faltavam

Fechados os quatro tipos de visual, sobravam cinco casos. Dois deles pediam regra
nova; o terceiro era o #31, resolvido acima.

### `% do total`: o denominador tem três leituras, e duas somam errado

Dois `tableEx` têm um campo `Arithmetic`, e a forma é sempre a mesma:

```
divide( COUNTA('T'[C]),  ScopedEval( COUNTA('T'[C]), [] ) )
```

`ScopedEval(expr, [])` é "a mesma conta **sem o agrupamento do visual**" — o total.
E "total" tem três leituras que só divergem quando existe filtro:

| leitura | denominador | efeito |
|---|---|---|
| total do **visual** | respeita filtro de página e de visual | a coluna soma 1,0 |
| total da **tabela** | ignora os filtros | porcentagens menores, soma < 1 |
| total do **grupo** | o próprio numerador | tudo 1,0 |

A do meio é a que engana: os números saem pequenos e plausíveis, e ninguém soma uma
coluna de porcentagem para conferir. Por isso o teste central de `aritmetica.test.ts`
tem filtro e afirma que **a coluna soma 1,0** — sem filtro, as três leituras dariam o
mesmo resultado e o teste não provaria nada.

Duas decisões menores, ambas com teste:

- **`divide` é `DIVIDE` do DAX, não `/`.** Denominador zero ou BLANK dá BLANK, não
  `Infinity` — que numa coluna de porcentagem apareceria como `∞`.
- **escopo não vazio erra alto.** Ele reteria parte do eixo, e tratá-lo como vazio
  daria denominador maior e porcentagens menores. Não ocorre nesta base.

### A âncora de duas dimensões é a tabela de onde saem os números

O achado #34 deixou um caso em aberto: `relatorio-do-ano/2d498e...`, com eixo em
`CALENDARIO INSTALADO` e legenda em `BASE DE ORIGEM` — duas dimensões que não se
alcançam. Havia 4 tabelas de fato capazes de ligá-las, e escolher uma seria escolher
o número.

A regra que faltava estava no próprio visual: **a âncora é a tabela de onde saem os
valores.** Ali, `Y` conta `'PROTOCOLOS GERAL'[SOLICITACAO]` — e é `PROTOCOLOS GERAL`
que o `SUMMARIZECOLUMNS` do Power BI varre. Não é uma escolha entre as 4 candidatas
do modelo: é a única das **tabelas do visual** que liga as duas dimensões.

A recusa continua de pé quando a regra não decide, e agora com três mensagens
distintas: nenhuma tabela de valor liga as dimensões (diz quais são e quais ligariam
de fora), mais de uma liga, ou não há caminho nenhum.

### O estado ao fechar

| visual | calcula | |
|---|---|---|
| card | 64/64 | |
| tableEx | 29/29 | 76 linhas |
| gráfico | 16/16 | 106 pontos, 23 séries |
| pivotTable | 8/8 | 39 células |

Os testes de cobertura passaram a exigir que o mapa de recusas saia **vazio**. Uma
recusa nova não some na contagem: aparece como `NÃO CLASSIFICADA`.

**E nada disto é paridade.** Continua valendo, e medido: 36 cards têm filtro e só 5
mudam de valor sobre dado sintético; das 5 tabelas cruzadas só 2 trazem linha; das 8
matrizes, 6. O que falta para paridade não é código — é alguém abrir o Power BI e
ditar os totais.

---

## 37. A camada M nunca havia chegado ao avaliador: `toDatasetRows` só era chamada em teste

**Medido em 07/08/2026.** Desde a fase 2b.8 existia uma função chamada
`toDatasetRows` — a ponte entre a tabela que a camada M produz e o `Dataset` sobre o
qual o DAX é avaliado. Ela tinha teste, passava, e **nenhum caminho de produção a
chamava**. Grep no repositório: 3 ocorrências, todas em
`transform-engine/test/avaliador.test.ts`.

O efeito é sutil porque nada falhava. As engines calculavam, os 860 testes passavam,
e o número que saía vinha de `Dataset` montado à mão no teste. A plataforma tinha
duas metades que funcionavam e não se tocavam:

```
fontes reais → Query Engine → camada M → (fim: só contagem impressa pelo mrun)

Dataset sintético → Evaluator → Widget Engine → número (só em teste)
```

`npm run snapshot` é a costura. E o percurso completo, agora exercitado:

```
fontes → Query Engine → camada M → toDatasetRows → snapshot em disco
                                                         │
                                       carrega() ────────┘
                                           │
                     Dataset + tabelas calculadas materializadas
                                           │
                       Evaluator → Widget Engine → número
```

### Por que disco, e não a camada M no arranque da API

Não foi escolha de gosto: o #20 já tinha medido. O avaliador de M mantém **todos** os
passos vivos ao mesmo tempo — em M qualquer passo pode citar qualquer outro, então o
escopo não libera nenhum antes do fim — e rodar as queries num processo só estourou o
heap em 4 GB. Uma API que rodasse a camada M no arranque seria exatamente esse
processo. Em disco sobra a tabela **final**, não os 60 passos que a produziram.

### O fechamento não é a lista de `entities_used` — e `FERIADOS` prova

Materializar "as tabelas que o visual nomeia" deixa de fora tudo o que o DAX
alcança. Medido nas 14 páginas:

| tabela | páginas | quem a puxa |
|---|---|---|
| `FERIADOS` | **9** | o DAX de `'CALENDARIO INSTALADO'[PESO]` — **nenhum visual a nomeia** |

Sem ela, 9 páginas buscariam tudo o mais nas fontes reais e só então morreriam com
`Tabela 'FERIADOS' não está no dataset`, no meio de um cálculo, longe da causa. O
fechamento anda por quatro arestas: visual → tabela·medida, medida → DAX,
coluna calculada → DAX, tabela calculada → DAX.

### O que o fechamento economiza

| query | em quantas das 14 páginas |
|---|---|
| `protocolos-geral` | 13 — é a espinha do relatório |
| `hora-atualizado` | 13 |
| `field-agenda` (1,4 M de linhas) | **3** |

As 14 páginas juntas fecham em **23 tabelas e 16 queries** — não nas 24 do
registry. Uma página típica pede 4.

### `statement_timeout` de 30 s é o teto certo para uma tela e o errado para um refresh

Primeira execução: `protocolos-geral` e `protocolos-auxiliares` foram **canceladas
pelo servidor** — `canceling statement due to statement timeout`. O `.env` traz 30 s,
que é o valor certo para um widget: passou disso, alguém está esperando.

Materialização não é pedido de tela. A ferramenta usa 600 s **e imprime que
substituiu o valor do `.env`**, com `--timeout=` para mandar. Sobrescrever calado
seria pior que o timeout. Com o teto novo: `protocolos-geral` 45 s,
`protocolos-produtividade` 87 s.

### O formato existe por causa da data

`JSON.stringify(new Date())` devolve string e `JSON.parse` devolve a string de volta.
Guardar a camada M em JSON puro transformaria **toda** coluna de data em texto, e aí
`YEAR()`, `DATESMTD` e a hierarquia `[Data].[Mês]` passariam a errar alto — todas, e
longe da causa. O snapshot é colunar com **o tipo de cada coluna no cabeçalho**, e o
tipo é apurado varrendo a coluna inteira: olhar só o primeiro não-nulo erra na coluna
que começa data e termina texto, e aí a leitura devolveria `Invalid Date` calada.

### O arquivo é dado de cliente

`field-agenda` tem endereço, `QUADRO FUNCIONAL` tem CPF e RG. `snapshot/` está no
`.gitignore`, a gravação é em temporário com `rename` no fim, e a saída da ferramenta
nunca imprime valor de linha — só id, contagem, nome de coluna e tempo, a mesma regra
do `mrun`, para poder colar em ticket.

**Medido em `diario-instalacao`:** 4 queries, **98.111 linhas, 75,2 MB** em disco, 2
min 13 s para materializar, **1,76 s para carregar** (incluindo materializar
`CALENDARIO INSTALADO`, 364 linhas, de DAX).

---

## 38. A matriz custa 33.945 varreduras onde o Power BI faz uma — RESOLVIDO em 07/08/2026

**O primeiro número real quebrou o desenho, e só dado real quebraria.** Com o
snapshot carregado, os 5 cards de `diario-instalacao` calcularam. A página não
terminou: uma das duas matrizes não devolveu em **mais de 400 segundos**.

A causa não é o volume. É a forma do cálculo. `matriz.ts` agrupa os dois eixos em
separado (o que está certo, #35) e depois, **para cada célula**, monta um contexto de
filtro e reavalia a medida — que varre a tabela inteira.

Medido no visual `diario-instalacao/2c224be87531efbec489`:

| | |
|---|---|
| eixo de linha | `'PROTOCOLOS PRODUTIVIDADE'[INSTALADOR]` — 93 distintos |
| eixo de coluna | `[DATA INSTALAÇÃO]` — 365 distintos |
| grade | **33.945 células** |
| combinações que **existem** | 8.524 (25,1%) |
| linhas da tabela | 65.563 |
| **visitas de linha, por célula** | **2,2 bilhões** |
| **visitas de linha, varredura única** | **65.563** |

A razão é de **~34.000×**. A 10 milhões de visitas por segundo — que é a taxa medida
na matriz vizinha, 93 × 1 células com 3 medidas em 1.951 ms — a grade custa ~220 s.
A página inteira ficaria em torno de 4 minutos.

O Power BI resolve o visual com **um** `SUMMARIZECOLUMNS`: varre uma vez, agrupa por
chave e agrega incrementalmente. O custo é O(linhas), não O(células × linhas).

### O que **não** serve como conserto

- **Pular a célula cuja combinação não existe.** Ganharia 4× (25,1% das células) e
  está errado no geral: uma medida com `ALL(...)` ignora o filtro da célula e devolve
  número mesmo com zero linhas; `SELECTEDVALUE` devolve o rótulo. Célula vazia não
  quer dizer valor em branco.
- **Calcular uma vez o "valor da célula vazia" e repetir.** Mesmo problema: os
  contextos de filtro de duas células vazias são **diferentes** ainda que os dois
  selecionem zero linhas.

O conserto é o do Power BI — varrer uma vez e agrupar em balde — e é a próxima fatia.
Vale para os quatro tipos de visual, não só para a matriz: hoje toda medida de todo
grupo refiltra a tabela.

**Nada disto aparecia em dado sintético**, onde as tabelas de teste têm 3 a 5 linhas
e 33.945 células custam microssegundos. É a mesma lição da 2b.5 e da 2b.6, agora sobre
desempenho: o teste provava que o cálculo *funciona*, não que ele *termina*.

---

### Resolução: as linhas já estavam na mão e eram jogadas fora

O conserto não foi escrever um motor de agregação. Foi notar que
`enumeraCombinacoes` **já varre a âncora uma vez** para descobrir quais
combinações existem — e descartava as linhas de cada uma. Elas passaram a ser
entregues ao contexto de filtro como ponto de partida, em vez de ele redescobri-las
varrendo a tabela por grupo.

### O perigo era a substituição do DAX, não o desempenho

`CALCULATE(x, ALL('T'[TIPO]))` derruba o filtro de tipo e mantém o de cidade. Se as
linhas materializadas do grupo `(cidade, tipo)` continuassem valendo depois disso, o
grupo ficaria estreito demais — número **menor, plausível, sem aviso**. É a mesma
família de erro do #30 e do #36.

Por isso a materialização é do **grupo inteiro**, não de um filtro: a mesma instância
vai em todos os filtros que ele põe no contexto, e o contexto só usa o caminho rápido
enquanto encontra **todos** eles. Derrubou um, o carimbo não fecha a conta e o cálculo
volta ao predicado exato.

**Isto veio de teste de mutação, não de análise.** Tirando a conferência de validade,
os 860 testes do repositório continuavam passando — nenhum exercitava `ALL` de uma
chave dentro de um agrupamento de duas. Os dois testes que hoje pegam a mutação foram
escritos por causa dela. A outra mutação, truncar as linhas materializadas para uma
só, derruba 38 testes: o caminho rápido está exercido.

### Medido em dado real, contra o mesmo cálculo sem o caminho rápido

Página `protocolos-detalhados`, duas tabelas de detalhe de 32.462 linhas cada
(agrupamentos de 5 e 7 chaves, uma linha por combinação — o caso O(linhas²)):

| | com | sem |
|---|---|---|
| tempo | **1.519 ms** | 374.260 ms |
| saída | 23.819.414 bytes | 23.819.414 bytes |
| `sha256` | `65def8f4…c28f` | `65def8f4…c28f` |

**246× mais rápido, byte a byte o mesmo resultado.** O hash é sobre a saída inteira
dos 4 visuais — é o teste diferencial que os testes unitários fazem em pequeno.

A matriz que abriu este achado, 93 × 365 sobre 65.563 linhas: **não terminava em 400 s,
passou a 1.610 ms**. A vizinha, 93 × 1 com 3 medidas: 1.951 ms → **194 ms**. A página
`diario-instalacao` inteira — 7 visuais com número — calcula em **4,0 s**, mais 1,8 s
de carregamento do snapshot.

### O que sobra

O caminho rápido é o ponto de partida da tabela, não uma agregação incremental. Uma
célula de matriz ainda percorre as linhas do menor dos dois eixos, e uma medida com
`CALCULATE` que troca o contexto volta a varrer. Para os visuais desta base isso
basta; se um dia não bastar, o passo seguinte é agregar durante a varredura em vez de
depois dela.

---

## 39. A tela existe, e três decisões dela não são de engine

Com o snapshot (#37) e o caminho rápido (#38), uma página passou a responder em
segundos — e só aí fazia sentido escrever API e tela. `apps/api` serve as duas.

### `node:http` em vez de Fastify — divergência do `ARCHITECTURE.md`, registrada

O `docs/ARCHITECTURE.md` declara Fastify. São cinco rotas `GET` sobre um snapshot
em disco: nada de corpo para validar, nada de escrita, nada de autenticação ainda.
O repositório roda sem passo de build e com quatro dependências, e `node:http`
mantém isso. **Quando existirem Permission Engine, corpo de requisição e WebSocket
de realtime — Fases 4 e 5 — a conta muda e esta decisão deve ser revista.**

### Somente leitura no protocolo, e é a quarta camada

Só `GET` e `HEAD` passam; qualquer outro método leva 405 **antes** de qualquer
roteamento. As outras três camadas (usuário do banco, `default_transaction_read_only`,
`assertReadOnly`) ficam no Query Engine, que esta API **nem chama** — ela lê
snapshot em disco. Esta é a única que um cliente enxerga.

### As três decisões que a resposta carrega

| decisão | por quê |
|---|---|
| **um visual que falha não derruba a página** | são 306 visuais; um erro vira `erro` naquele visual, com a mensagem inteira, e a página conta quantos falharam. O que não pode é o erro sumir |
| **tabela grande vem cortada, e a resposta diz o total** | as duas tabelas de `protocolos-detalhados` somam 23,8 MB de JSON. A janela é 200 linhas e `linhasTotais` viaja junto — corte silencioso seria pior que o peso |
| **o tipo do valor viaja com o valor** | JSON não tem data. Sem o tipo por coluna, a tela não sabe se `"2026-08-07T…"` é uma data ou um protocolo que se parece com uma. Mesma razão do formato do snapshot (#37) |

Medido em `diario-instalacao`: **7 visuais com número, 0 falharam, 15 sem número**
(imagem, caixa de texto, forma). Primeiro pedido 6,58 s (inclui 1,8 s de
carregamento do snapshot), pedidos seguintes **3,8 s**, 237 KB. Em
`protocolos-detalhados` o corte leva a resposta de 23,8 MB para **48.735 bytes**.

### A tela: sem sidebar, sem biblioteca de gráfico

Dois recortes deliberados, os dois por não inventar decisão alheia:

- **Sem sidebar.** O `DESIGN-SYSTEM.md` v2 dizia que esta página abre dentro do
  AppShell do HUBBI: a navegação principal e o header de 52px seriam de lá. Desenhar
  uma sidebar aqui seria inventar uma navegação que a plataforma real já tem.

  > **Corrigido em 27/08/2026.** A sidebar chegou a existir aqui — veio junto com o
  > AppShell do HUBBI em `dfe40b9` — e saiu. A navegação hoje é a **faixa de telas no
  > topo**, do próprio produto. O motivo é medido: a lateral gastava 230px de LARGURA
  > permanentemente (17% do horizontal em 1366px), e largura é o que decide quantas
  > categorias cabem por página de gráfico e de matriz. A faixa cobra ~74px de altura
  > em troca. Ver `DESIGN-SYSTEM.md` § 5.
- **Sem biblioteca de gráfico.** O Chart SDK é peça própria da Fase 3; escolher uma
  biblioteca de passagem seria decidir por ele. Barra proporcional em HTML já mostra
  a forma do dado e prova que os pontos chegam certos.

### A regra 5 do `PROMPT-CONTINUACAO.md` estava desatualizada

Ela mandava usar fundo `#F5F1E8`, DM Sans, sidebar 256px e âmbar `#FFB000` — a
**v1** do design system, que o próprio documento marca como substituída por ser
paleta *aspiracional*, sem código real por trás. Vale a **v2**, copiada do
`shared_layout.css` do HUBBI: fundo `#F4F4F5`, Inter/system, âmbar `#F59E0B`.
A regra foi corrigida.

### Conferido e descartado

O card `REALIZADOS` mostra **32.463** e a tabela `PROTOCOLOS GERAL` tem **32.462**
linhas — proximidade que parece erro de um. Não é: `[Total Protocolos]` é
`DISTINCTCOUNT('PROTOCOLOS PRODUTIVIDADE'[N°PROTOCOLO])`, outra tabela, com 65.563
linhas e 32.463 protocolos distintos. Medido também que **não há branco** naquela
coluna, então o `DISTINCTCOUNT` não está contando a linha em branco como valor.

**E isto continua não sendo paridade.** A tela mostra números calculados a partir da
fonte real, o que é novo; que eles sejam os *mesmos* do Power BI segue sem prova.

---

## 40. O relatório inteiro contra dado real, e o que só ele mostra

`npm run paginas` calcula as 14 páginas sobre o snapshot e conta o que fecha. É
outra pergunta que a cobertura da fase 3: lá era "o avaliador sabe fazer a conta"
sobre tabelas sintéticas de 3 a 5 linhas; aqui é "a conta termina sobre estes
dados".

| | |
|---|---|
| páginas que carregaram | **11 de 14** |
| visuais com número nelas | 64 |
| **calcularam** | **64** |
| visuais sem número | 139 |
| linhas carregadas | 632.620 |
| carga + cálculo | 11,9 s + 17,5 s |

Na primeira passada eram **63 de 64**, e o que faltava era um defeito de verdade.

### O tipo declarado valia só para coluna calculada

`relatorio-do-ano/2d498e…` parou com:

```
AVERAGE('CONSOLIDADO CLIENTES'[authentication_totalizer]):
  esperava número e recebeu o texto "83205"
```

O modelo declara a coluna `int64`; a camada M entrega texto. **É o achado #31 um
nível acima**: lá a regra "o tipo declarado da coluna vale ao materializar" entrou
no caminho da coluna *calculada*, e coluna física ficou de fora — porque em dado
sintético o teste sempre põe número em coluna numérica. Nenhum dos 898 testes podia
pegar isso.

**Medido antes de mexer, sobre as 14 tabelas materializadas:**

| divergência entre tipo declarado e tipo entregue | n |
|---|---|
| declara número, chega **texto** | **14** |
| declara texto, chega número ou data | 4 |

E, nas 14, **todo valor não-nulo é literal numérico limpo** — nenhum `"1.234,56"`,
nenhum `"R$ 10"`. Sem essa medição a conversão trocaria "funciona" por "erra alto"
em qualquer coluna com um valor sujo; com ela, o alcance é conhecido.

**As 4 do sentido contrário ficam como estão, de propósito.**
`'PROTOCOLOS GERAL'[DATA FINAL]` é data de verdade e se declara `string`; convertê-la
para texto quebraria todo `YEAR()` sobre ela. Perda, não ganho.

A conversão acontece no carregamento do snapshot, usa a **mesma** `aplicaTipo` do
#31 — uma regra, um lugar — e decide pelo tipo apurado no cabeçalho, que já foi
varrido sobre a coluna inteira. Coluna que chega no tipo certo não é tocada. E
`npm run paginas` **lista as colunas convertidas**: é a única parte do carregamento
que muda o dado, e conversão calada é o erro mais caro desta base.

### As 3 páginas que não carregam, e por quê

| página | falta |
|---|---|
| `visao-geral` | `FIELD AGENDA` |
| `agendamento-field` | `FIELD AGENDA` + `Clima/ Tempo` |
| `relatorio-do-mes` | `FIELD AGENDA` + `Clima/ Tempo` |

- **`clima-tempo` não tem como ser materializada.** Define função dentro de `let` e
  lê `Web.Contents`, que não tem connector. É a mesma exclusão do `mrun` desde a
  2b.8, e agora ela custa duas páginas inteiras.
- **`field-agenda` estourou o `statement_timeout` de 600 s no servidor.** É a query
  de 1,4 milhão de linhas. Não é limite do processo nem de heap: foi o Postgres que
  cancelou. Com teto de 1800 s ela segue em curso.

### `statement_timeout`: 30 s serve para tela, 600 s não serve para refresh

O #37 tinha subido o teto de materialização de 30 s para 600 s e resolvido
`protocolos-geral` (45 s) e `protocolos-produtividade` (87 s). `field-agenda` mostra
que 600 s também é chute: **o teto certo de um refresh depende da query, não de um
número redondo.** Por isso `--timeout=` existe e o valor usado é impresso.

**E nada disto é paridade.** 64 visuais calcularem quer dizer que a conta termina
sobre estes dados. Que o número seja o do Power BI segue sem prova.

## 41. `Table.FromColumns`: onde o M preenche com null, aqui recusa

O M preenche a coluna mais curta com `null` quando as listas têm comprimentos
diferentes. **Esta implementação recusa**, e é a primeira divergência deliberada de
semântica do M nesta base — as outras 64 funções seguem o M como ele é.

O motivo é o caminho que o `null` percorre depois. Em `clima-tempo` as três listas
vêm de arrays paralelos da **mesma** resposta da Open-Meteo (`daily.time`,
`daily.precipitation_sum`), e a query classifica logo abaixo:

```
if [Precipitacao_mm] = 0 then "Sem chuva"
else if [Precipitacao_mm] < 5 then "Chuva fraca"
else if [Precipitacao_mm] < 20 then "Chuva moderada"
else "Chuva forte"
```

Com `null`, `= 0` é falso e `< 5` é `null` — os dois ramos escapam, e o dia **sem
dado** sai como **"Chuva forte"** na tela. Não há erro em lugar nenhum: é o número
plausível e errado, na forma mais direta que já apareceu neste projeto.

Recusar não custa nada no corpus: o próprio autor do M iguala os comprimentos à
mão, com `List.Repeat({null}, List.Count(datas))`. Ou seja, **a divergência só é
observável sobre uma resposta que a API não deveria dar** — e é exatamente aí que
ela precisa aparecer.

## 42. `Web.Contents` não é pré-buscável, e a saída foi reavaliar

`clima-tempo` estava fora do escopo desde a 2b.8, e o motivo registrado era "lê
`Web.Contents`, que não tem connector". Escrever o connector era a parte fácil. O
problema real é outro, e é de arquitetura:

> **Avaliar M é síncrono; ler fonte é assíncrono.** Para `Odbc.Query` isso se
> resolve pré-buscando — a spec diz qual é a fonte antes de a avaliação começar. Em
> `clima-tempo` a URL sai de `cidade{1}` e de `Date.ToText(ontem, "yyyy-MM-dd")`:
> **valores que só existem no meio da avaliação.** Não há o que pré-buscar.

Três saídas foram consideradas:

| saída | por que não / por que sim |
|---|---|
| tornar o avaliador assíncrono | 622 linhas de avaliador e 1.576 de funções, todas síncronas, e `await` no caminho quente de `field-agenda` (1,4 mi de linhas × 19 colunas). Caro e arriscado pelo pior motivo: uma query de 1.638 linhas |
| valor "pendente" que se propaga | contamina toda a tabela de funções e produz resultado parcial plausível. É o erro que o projeto inteiro existe para não cometer |
| **ponto-fixo: avalia, sinaliza, busca, reavalia** | **escolhida** |

O laço vive em `runner.ts`. `Web.Contents` monta a URL (transformação pura, e por
isso ela **está** em `standardFunctions`, diferente de `Odbc.Query`) e consulta o
mapa de respostas; no que falta, lança um sinal interno. O runner busca, guarda, e
avalia de novo do zero.

Ele termina porque o mapa **só cresce**, e é correto porque a **última** passada
roda inteira sem nenhuma busca pendente: nenhum resultado parcial sobrevive.

**Medido em `clima-tempo`:** 14 requisições (7 cidades × 2 endpoints), 15 passadas,
1.638 linhas. Da execução de 13,5 s, **13,4 s são rede** e **123 ms são M** — ou
seja, reavaliar 15 vezes custa menos de 1% do total. O custo que parecia proibitivo
no papel é ruído medido.

### O guard read-only ganhou uma quarta camada, em HTTP

As três camadas existentes (usuário somente-leitura, `default_transaction_read_only`,
`assertReadOnly`) protegem o Postgres e não dizem nada sobre HTTP. Sem nada no lugar,
uma expressão M passaria a escolher com quem a plataforma fala.

- o método é **GET**, e não é parâmetro de lugar nenhum;
- `Web.Contents` **recusa a opção `Content`**, que é o que faria um POST;
- o host tem de estar em `endpoints` do `.spec.yaml` — que o **extrator gera do
  PBIP**, então ampliar o alcance de rede exige mudar o Power BI, não o código;
- comparação de host é exata: nem subdomínio (`mau.api.open-meteo.com`) nem
  sufixo (`api.open-meteo.com.invalido`) passam;
- só `http`/`https`: um M pedindo `file:///` leria o disco da máquina;
- o corpo de uma resposta de erro **não** entra na mensagem — é texto de terceiro.

### O que a mutação disse

Quatro regras novas, quebradas de propósito, **todas derrubam teste**. Uma delas só
depois de consertada: o teste de que `Date.ToText` lê em UTC passava por acidente do
fuso da máquina (-03) e teria passado num CI em UTC — justamente onde ninguém
olharia. Agora ele fixa `TZ` e falha nos dois.

**Consequência:** `clima-tempo` materializa, e `FORA_DO_ESCOPO` está **vazio** no
`mrun` e no `snapshot` pela primeira vez. As 24 queries do corpus rodam.

## 43. `Status Protocolo Dia`: 304 bilhões de visitas, e o #38 de novo noutro lugar

Destravar `clima-tempo` fez `relatorio-do-mes` e `visao-geral` carregarem. A terceira
página, `agendamento-field`, **continua sem carregar — por outro motivo, que estava
escondido atrás do primeiro.** Ela nunca tinha chegado a carregar, então este custo
nunca havia sido pago.

Não é visual nenhum: o processo **não termina o carregamento**. Quem trava é a
tabela calculada `Status Protocolo Dia`, que só esta página pede.

```
VAR BaseAgenda = DISTINCT(SELECTCOLUMNS('FIELD AGENDA', "protocolo", …, "Dia", TRUNC(…)))
RETURN ADDCOLUMNS(BaseAgenda,
    "Status", … 3 × CALCULATE(COUNTROWS(…), 'FIELD AGENDA'[protocolo] = Protocolo, …))
```

mais **4 colunas calculadas**, cada uma um
`CALCULATE(MAX('FIELD AGENDA'[X]), FILTER('FIELD AGENDA', [protocolo]=… && TRUNC([Slot Agenda])=…))`.

São **7 varreduras de `FIELD AGENDA` por linha da tabela**, e a tabela tem uma linha
por par (protocolo, dia).

**Medido sobre o snapshot real:**

| | |
|---|---|
| linhas de `FIELD AGENDA` | 1.458.244 |
| protocolos distintos | 26.554 |
| pares (protocolo, dia) = linhas de `Status Protocolo Dia` | **29.846** |
| varreduras de `FIELD AGENDA` | 29.846 × 7 = **208.922** |
| **visitas de linha** | **304.659.252.968** |

Observado: **9 minutos de CPU sem sair do carregamento**, e sem crescer memória — é
CPU pura, não vazamento. A 10 milhões de visitas por segundo, seriam ~8,5 horas.

**É o achado #38 outra vez, na tabela calculada em vez da matriz.** Lá cada célula
refiltrava as 65.563 linhas e o conserto não foi motor novo: a varredura que
descobre as combinações **já separava as linhas de cada grupo** e as jogava fora.
Aqui a forma é a mesma — `[protocolo] = X && TRUNC([Slot Agenda]) = Y` é exatamente
a chave que o `DISTINCT` de cima já agrupou. O Power BI resolve com hash; o laço
aninhado, não.

**Não foi consertado nesta sessão**, e o motivo é de escopo: o caminho é o avaliador
de DAX, onde um erro produz número plausível — a parte da base que menos tolera
conserto apressado. O que existe agora é o número que dimensiona o trabalho, que é
o que faltava para decidir.

O perigo a evitar, herdado do #38: o agrupamento **não pode** ignorar a substituição
de filtro. `MAX('FIELD AGENDA'[Base])` sob um `FILTER` que reconstrói o predicado não
é a mesma coisa que ler o grupo já materializado se alguma medida da página derrubar
um dos filtros com `ALL()`.

### Estado do relatório depois desta sessão

| | antes | agora |
|---|---|---|
| páginas que carregam | 11 de 14 | **13 de 14** |
| visuais com número nelas | 64 | **96** |
| calcularam | 64 | **96** |
| linhas carregadas | 632.620 | 3.751.093 |
| carga + cálculo | 11,9 s + 17,5 s | 53,1 s + 31,1 s |

A única página fora é `agendamento-field`, por este achado. `field-agenda`
materializou (1.458.244 linhas, 950 MB) e `clima-tempo` também (#42), então
**nenhuma página está mais parada por falta de dado.**

## 44. O índice de igualdade, e o que a medição desmentiu do #43

O #43 mediu `Status Protocolo Dia` e disse que o custo de `agendamento-field` eram
304,7 bilhões de visitas. **A conta estava certa e a conclusão estava errada**: essa
tabela não é o gargalo principal. Ao instrumentar, o processo não saía do
*carregamento* — e quem trava ali é a própria `FIELD AGENDA`, que tem **7 colunas
calculadas**, duas delas varrendo `FIELD AGENDA` por linha de `FIELD AGENDA`:

```
RankDataProtocolo  = ... DISTINCT(SELECTCOLUMNS(FILTER('FIELD AGENDA',
                         'FIELD AGENDA'[protocolo] = ProtocoloAtual), ...))
RankAtualProtocolo = CALCULATE(MAX('FIELD AGENDA'[RankDataProtocolo]),
                         FILTER('FIELD AGENDA', 'FIELD AGENDA'[protocolo] = ProtocoloAtual))
```

1.458.244 × 1.458.244 ≈ **2,1 × 10¹²** visitas — **sete vezes** o que o #43 tinha
medido, e num lugar que ele não olhou. A lição de método é a de sempre neste
projeto, e desta vez contra mim mesmo: **medir a parte que se suspeita não é medir
onde o tempo vai.** O `Status Protocolo Dia` era o suspeito óbvio porque só aquela
página o pede; o custo maior estava numa tabela que **outras páginas também
carregam** — e que elas não pagavam porque nenhum visual delas toca essas colunas.

### O conserto: inverter a coluna uma vez

As três formas caras têm a mesma cara — `'T'[coluna] = <valor de fora>` — e é isso
que dá para indexar. `FIELD AGENDA` tem 26.554 protocolos em 1,46 milhão de linhas,
então o balde médio é de **55 linhas**.

`packages/measure-engine/src/indice.ts` inverte a coluna sob demanda, guarda o
índice num `WeakMap` pela **instância** do array de linhas (indexar por nome de
tabela responderia sobre linhas que um filtro já tinha tirado), e é usado em três
lugares:

| caminho | onde | antes | depois |
|---|---|---|---|
| `CALCULATE(x, 'T'[c] = v)` | `partidaIndexada` em `filter.ts` | 0 ms/consulta¹ | 0 ms |
| `FILTER('T', 'T'[c] = v && …)` | `candidatosPorIndice` em `functions.ts` | 0 ms¹ | 0 ms |
| `CALCULATE(MAX(…), FILTER('T', 'T'[c] = v))` | `igualdadeConstante` em `filter.ts` | **38 ms** | **0 ms** |

*(¹ medido na reprodução sintética de 200.000 linhas e 4.000 chaves, 200 consultas;
os dois primeiros já saem em 0 ms porque a medição foi feita depois de eles
existirem. O total do caso composto caiu de **7.626 ms para 12 ms** — 635×.)*

O terceiro caminho foi o que quase escapou: o `FILTER` já estava rápido, mas o `MAX`
**depois** dele avalia num contexto onde aquele filtro substituiu os anteriores, e
`linhasVisiveis` recomeçava da tabela inteira testando `keep` linha a linha.

### Por que não se pode partir das linhas do próprio `FILTER`

Foi a primeira ideia, e é errada — do jeito silencioso. O filtro vindo de tabela
**derruba** os filtros anteriores sobre as colunas dele; uma linha que o contexto de
fora escondia volta a ser visível e **passa** no `keep` se tiver os mesmos valores de
alguma linha do `FILTER`. Ela não está em `tv.rows`, e começar por ali a perderia.

A saída foi derivar uma **igualdade**, não um conjunto de linhas: se toda linha de
`tv` tem `c = v`, então toda chave permitida tem `v` na posição de `c`, e **toda**
linha que passa no `keep` tem `c = v` — inclusive a escondida. O balde as contém
todas. É a mesma armadilha do #38 (substituição de filtro) evitada por outro meio.

### `=` do DAX não é igualdade de identidade, e é aí que mora o perigo

Um índice que agrupasse por identidade responderia "nenhuma linha" onde o DAX diria
"estas aqui". Por isso `candidatos()` devolve **"não sei, varre"** em três casos:

- **o valor procurado é BLANK, `0` ou `""`** — `BLANK = 0` e `BLANK = ""` são
  verdadeiros no DAX, então a busca atravessaria baldes;
- **a coluna mistura texto e número** — ali o DAX **lança erro**, e devolver lista
  vazia trocaria um problema visível por um invisível;
- **a tabela é pequena** (< 1.000 linhas) — inverter custa mais que varrer.

Fora disso, `identityKey` e `compareValues(_, _, false)` concordam: os dois usam
`toLocaleLowerCase('pt-BR')` para texto e `serialFromDate`/0-1 para data e booleano.

O analisador de predicado é igualmente conservador: só desce em **conjunção** (num
`||` uma linha pode passar sem satisfazer a igualdade), só aceita `=` (nunca `==`,
que é estrito com BLANK), e só aceita do outro lado literal ou variável — nunca uma
chamada, que poderia esconder a linha que está sendo varrida.

**Nada disso decide resultado.** Em todos os três caminhos o predicado inteiro roda
por cima dos candidatos: o índice só encurta a lista. É o que os testes diferenciais
afirmam — o mesmo cálculo com e sem índice, mesmo valor, inclusive o mesmo **erro**
quando a coluna mistura tipos.

### O que a mutação disse

Sete regras quebradas de propósito, **seis derrubam teste**. A sétima — recusar BLANK
em `igualdadeConstante` — não derruba nada, e a investigação mostrou que ela **não é
regra**: o guarda de `candidatos()` recusa a busca logo depois e o resultado não muda.
Está anotada no código como economia, não como segurança, para ninguém a confundir
com as outras.

## 45. `agendamento-field` termina — em 104 minutos, que não é usável

Com o índice do #44, a 14ª página **calcula**: 21 de 21 visuais, 0 erros. É a
primeira vez que ela termina. E o número que interessa não é esse:

| | |
|---|---|
| linhas carregadas | 1.561.770 |
| **carga** | **25,6 s** |
| **cálculo** | **6.251.082 ms = 104 minutos** |
| total | 104m38s |

**Duas correções ao que os #43 e #44 afirmaram, e as duas importam.**

**1. Não era "o processo não sai do carregamento".** Era, antes do índice — e é
justamente por isso que a frase envelheceu: a carga agora leva **25,6 s**, e o
tempo mudou de fase. As tabelas calculadas que a página pede (`Status Protocolo
Dia` entre elas) materializam dentro dela, e essa parte está resolvida. O que
sobra está nos **visuais**.

**2. O ganho é real e é grande, e mesmo assim não entrega a página.** De "nunca
vista terminar" para 25,6 s de carga é o conserto funcionando. Só que as colunas
calculadas de `FIELD AGENDA` são materializadas **sob demanda, na primeira vez que
alguém as toca** — e quem as toca são os visuais, não o carregamento. O custo não
foi eliminado: foi adiado para depois do ponto que estava sendo medido.

É a terceira vez neste projeto que a mesma armadilha aparece: **o gargalo não está
onde o instrumento aponta, e sim onde o instrumento acaba.** O #43 mediu a tabela
suspeita e o custo estava noutra; o #44 mediu a carga e o custo estava no cálculo.

### O que não foi feito, e o que perguntar antes de fazer

Não foi medido **qual** dos 21 visuais consome os 104 minutos, nem quanto cabe a
cada coluna calculada de `FIELD AGENDA`. Sem isso, otimizar seria repetir o erro
acima — escolher um suspeito.

O caminho é o mesmo perfil por visual que achou este achado
(`calculaPagina` visual a visual, gravando com `appendFileSync`), agora sobre a
página que termina. E vale perguntar antes de acelerar: `RankDataProtocolo` e
`RankAtualProtocolo` são **rank por protocolo** sobre 1,46 milhão de linhas. O
Power BI as calcula no refresh, uma vez, não a cada abertura. A pergunta de
desenho — se elas pertencem ao snapshot em vez do avaliador — pode valer mais que
qualquer índice, e é decisão a registrar, não otimização a fazer.

### Estado do relatório

| | antes desta sessão | agora |
|---|---|---|
| páginas que carregam | 11 de 14 | **14 de 14** |
| visuais com número nelas | 64 | **117** |
| calcularam | 64 | **117** |

**As 14 páginas calculam.** Treze delas somam 96 visuais em 84 s. A décima quarta
sozinha leva 104 minutos, e enquanto for assim ela não entra em `npm run paginas`
sem `--pagina=`.

## 46. Os 104 minutos têm dono: `RankAtualProtocolo`, 90% deles

O #45 dizia que não se sabia qual dos 21 visuais consumia os 104 minutos, e que
escolher um suspeito seria repetir o erro. Medindo antes: **não é visual nenhum.**
É uma coluna calculada, e uma só.

Custo por coluna calculada de `FIELD AGENDA`, cada uma num avaliador novo para a
memorização de uma não pagar a conta da outra:

| coluna | 20.000 linhas | 40.000 linhas | µs/linha |
|---|---|---|---|
| **`RankAtualProtocolo`** | **13.591 ms** | **27.888 ms** | **697** |
| `RankDataProtocolo` | 1.493 ms | 3.081 ms | 77 |
| `CategoriaProdutividade` | 505 ms | 1.004 ms | 25 |
| `ClassificacaoRelato` | 471 ms | 924 ms | 23 |
| `Status SLA` | 56 ms | 106 ms | 2,6 |
| `Data` | 54 ms | 90 ms | 2,3 |
| `Turno` | 46 ms | 89 ms | 2,2 |

O custo é **linear** nas duas fatias (74,6 → 77 e 679,5 → 697 µs/linha), o que
confirma que o índice do #44 está funcionando: sem ele estas duas seriam
quadráticas. E ainda assim `RankAtualProtocolo` sozinha é **9×** a segunda colocada
e ~90% do total.

### Por que 697 µs, se o índice já reduziu o balde a ~55 linhas

```
RankAtualProtocolo = CALCULATE(MAX('FIELD AGENDA'[RankDataProtocolo]),
                       FILTER('FIELD AGENDA', 'FIELD AGENDA'[protocolo] = ProtocoloAtual))
```

O `FILTER` devolve ~55 linhas — rápido. O que custa é o que vem **depois** dele:
`filterFromTable` monta um `Set` de `rowKey` sobre as **26 colunas** de
`FIELD AGENDA`, e o `keep` recalcula `rowKey` por candidato. São ~55 linhas × 26
colunas em cada ponta, mais a varredura de `igualdadeConstante`: da ordem de 3.000 a
4.000 composições de chave **por linha de `FIELD AGENDA`**. A ~5 milhões de
operações por segundo, isso dá ~700 µs — que é exatamente o medido.

Ou seja: o achado #44 tirou o custo quadrático, e o que sobrou é o **custo constante
por chamada** de um filtro que identifica linha por tupla de 26 colunas. Otimizá-lo
mais dentro do avaliador é possível, e é a terceira rodada de aceleração no mesmo
lugar.

### A pergunta que vem antes da quarta rodada

`RankDataProtocolo` e `RankAtualProtocolo` são **rank por protocolo**. O Power BI as
calcula **no refresh, uma vez** — não a cada abertura do relatório. Aqui elas são
recalculadas em toda carga de página que as toque.

Materializá-las no snapshot, junto com as linhas, tiraria os 104 minutos do caminho
da tela e os poria onde eles já existem no modelo original: no refresh. Nenhuma
otimização do avaliador chega perto disso, porque o problema não é a velocidade do
cálculo — é o **momento** dele.

Isso muda o que o snapshot é (hoje ele guarda a camada M; passaria a guardar também
coluna calculada em DAX), e por isso é **decisão a registrar**, não conserto a fazer.
Está em `docs/PERGUNTAS-NEGOCIO.md`.

## 47. Coluna calculada entra no snapshot — decidido, e o guarda que o torna seguro

> **Decisão de 08/08/2026 — Erick.** O snapshot passa a guardar **coluna calculada
> em DAX**, não só a camada M. É a opção B da pergunta #8 de `PERGUNTAS-NEGOCIO.md`.

O motivo está no #46: `agendamento-field` levava 104 minutos e ~90% era
`'FIELD AGENDA'[RankAtualProtocolo]`, um rank por protocolo sobre 1,46 milhão de
linhas. O Power BI calcula essa coluna **no refresh, uma vez**. O problema nunca foi
a velocidade do cálculo — era o **momento** dele, e nenhuma otimização de avaliador
chega perto de não calcular.

### O avaliador não precisou mudar, e é isso que assusta

`columnValue` devolve o valor quando o nome está na linha, **sem perguntar de onde
veio**. Uma coluna calculada gravada no arquivo é usada como se fosse física. Isso é
o que torna a mudança barata de implementar — e é exatamente o que a torna perigosa:
**valor congelado que ninguém desconfia.**

Mudar o DAX no Power BI e rodar `npm run extract` deixaria o relatório servindo o
número do DAX antigo, sem sinal nenhum. Por isso metade deste trabalho é o guarda:

- cada coluna calculada materializada carrega o **`sha256` do DAX** que a produziu,
  no cabeçalho do arquivo;
- o carregamento compara com o DAX que o modelo declara **hoje** e **erra alto** se
  divergir, dizendo o comando que refaz;
- coluna que deixou de ser calculada (ou sumiu) no modelo também erra alto: o valor
  em disco não tem mais dono;
- o hash normaliza espaço em branco, porque reindentar no Power BI não muda o que a
  coluna calcula, e invalidar 950 MB por um espaço é um alarme que ensina a ignorar
  alarmes.

**Erra alto em vez de recalcular calado.** Recalcular seria defensável se fosse
barato, e não é: são os 104 minutos reaparecendo no meio de uma carga que deveria
levar 25 segundos, sem ninguém entender por quê.

### Só coluna que depende da própria tabela

O snapshot materializa **uma query por processo** (a regra de memória da 2b.8), e
uma coluna que cite outra tabela precisaria dela carregada. Materializar sobre um
dataset incompleto daria BLANK onde havia número — calado.

A detecção é conservadora de propósito: `Identifier` é ambíguo em DAX (variável,
enum ou tabela sem aspas) e conta como possível tabela, então o resultado erra para
o lado de **não materializar**. Medido no catálogo:

| tabela | calculadas | materializáveis |
|---|---|---|
| `FIELD AGENDA` | 7 | **7** |
| `PROTOCOLOS GERAL` | 13 | **13** |
| `Status Protocolo Dia` | 4 | **0** — as quatro citam `FIELD AGENDA` |

As que não passam continuam nascendo no carregamento, como sempre.

### Uma mudança de comportamento, dita por extenso

`'FIELD AGENDA'[Status SLA]` usa `NOW()`. Materializada, ela **congela no instante
da materialização**, não no da abertura da tela. É o que o Power BI faz — coluna
calculada congela no refresh —, então é replicar e não divergir. Mas é diferente de
ontem, e o `AGORA` do `tools/snapshot` é único para toda a execução: um relógio por
query poria instantes diferentes em tabelas do mesmo snapshot, e a divergência
apareceria depois como erro de paridade sem causa visível.

### Estado

Implementado e testado: 964 testes, 7 novos, e **as 4 mutações do guarda derrubam
teste** (não conferir o sha, não conferir se ainda é calculada, não chamar a
conferência, e materializar coluna que cita outra tabela).

**O ganho ainda não foi medido contra a base real.** Falta rematerializar
`field-agenda` com as colunas (`npm run snapshot -- --query=field-agenda --refazer
--memoria=8192 --timeout=1800`) e rodar `agendamento-field` de novo. O custo sai do
caminho da tela e vai para o snapshot; **quanto** é o número que falta.

---

## #48 — A materialização copiava a tabela inteira para poder escrever nela

**Encontrado enquanto a rematerialização de `field-agenda` rodava**, olhando a
memória do processo em vez do relógio: 6,1 GB de heap aos 22 minutos, 7,0 GB aos 45,
com teto de 8192 MB. O `--refazer` ainda nem tinha chegado à escrita do arquivo.

O culpado não é o volume de dado, é uma cópia que ninguém precisava. `materializaColunas`
registrava a tabela com `Dataset.addTable`, e `addTable` **copia as linhas** —
deliberadamente, e por um bom motivo: o avaliador memoriza coluna calculada
escrevendo na própria linha, e mexer no objeto de quem chamou surpreenderia. Só que
a materialização do snapshot quer **exatamente** esse efeito: o valor tem de cair na
linha que vai ser gravada. A cópia era pura perda, e a perda tem tamanho: 1,46 milhão
de linhas com ~30 colunas vivas duas vezes, dentro de um processo que ainda segura a
camada M da mesma tabela. Três representações do mesmo dado ao mesmo tempo.

### `adotaTabela`, e o que ela conferiu para poder ser barata

O contrário de `addTable`: registra as linhas **sem copiar**, e o avaliador memoriza
direto no objeto do chamador. O preço é que a chave já tem de vir normalizada —
`toDatasetRows` normaliza (`trim().toLowerCase()`), então no caminho do snapshot ela
vem.

**Isso é conferido, não assumido.** Uma chave fora do padrão não daria erro: o
avaliador procuraria a coluna, não acharia, e devolveria BLANK — a coluna inteira
sairia zero no arquivo, calada. É o mesmo formato de estrago do achado #47, e a
mesma resposta: errar alto. A conferência varre **todas** as linhas (não só a
primeira: a chave torta apareceria justo na linha que ganhou uma coluna a mais), e é
barata porque cada chave distinta é normalizada uma vez e as repetições são busca em
`Set` sobre a mesma string — sem alocar nada por linha.

### Estado

970 testes, 6 novos. A mutação que confere só a primeira linha derruba teste.

**O processo que estava rodando não pegou a correção** — o Node já tinha carregado o
módulo quando ela foi escrita. Se ele estourar o heap, a próxima execução já vai com
a adoção; se não estourar, a correção continua valendo, porque a cópia era perda em
qualquer cenário.

---

## #49 — A **carga** também copiava, e a cópia custa o mesmo que ler o arquivo

O achado #48 tirou a cópia da **materialização** (`npm run snapshot`, uma vez por
refresh). Ficou de fora o caminho que roda a cada processo que serve a página:
`carrega.ts` também chamava `Dataset.addTable`, e pelo mesmo motivo de sempre —
normalizar o nome das colunas. Só que `le()` devolve as linhas prontas: as chaves já
vêm normalizadas de `toDatasetRows`. A cópia normalizava o que já estava normalizado.

### O número

Medido em 10/08/2026 sobre `snapshot/contratos.jsonl` — 86.501 linhas, 23 colunas.
Tabela pequena de propósito: a máquina tem 16 GB e havia um `--refazer` de
`field-agenda` rodando com 5 GB.

| | |
|---|---|
| `le()` — ler e decodificar o arquivo | 332 ms |
| `addTable` — só a cópia | **337 ms** |
| `adotaTabela` — só a conferência | **46 ms** |
| Heap extra que a cópia segurava | **128 MB** |

**A cópia custava mais que ler o arquivo do disco.** Não "um pouco a mais na conta":
dobrava o custo da carga.

Extrapolando para `field-agenda` — 1.458.244 linhas, ~26 colunas, 16,9x mais linha —
são ~6 s dos 25,6 s de carga e ~2,4 GB de heap, gastos para reconstruir objeto por
objeto um dado que já estava do jeito certo.

### O que mudou, e a armadilha que apareceu no meio

Duas linhas, uma delas inesperada:

1. `carrega.ts` passa a **adotar** as linhas.
2. `le()` passa a **normalizar a chave** ao montar a linha.

A segunda não estava no plano. `le()` documentava que devolvia chave normalizada, e
isso deixou de ser verdade no achado #47: `materializaColunas` grava a coluna
calculada sob o **nome de exibição** (`Status SLA`, com maiúscula e espaço), então o
cabeçalho passou a misturar os dois estilos. `adotaTabela` teria recusado o arquivo —
errando alto, como projetada. Consertar na leitura, e não na escrita, é o que permitiu
fazer isso **sem invalidar arquivo já gravado**, inclusive o `--refazer` que estava em
voo naquele momento.

Normalizar cria uma colisão possível que antes não existia: duas colunas cujos nomes
só diferem em caixa ou espaço passariam a ser a mesma chave, e a segunda sobrescreveria
a primeira em toda linha — número errado, sem erro. `chavesNormalizadas` confere isso
uma vez, no cabeçalho, e erra alto nomeando as duas colunas.

### Estado

972 testes, 2 novos. Falta a medida que importa: a carga de `field-agenda` de ponta a
ponta, que só dá para fazer quando o `--refazer` terminar.

---

## #50 — O índice de igualdade devolvia BLANK sobre coluna calculada, e só em tabela grande

**Encontrado indo verificar outra coisa.** A `DECISAO-DESEMPENHO.md` autoriza deixar
coluna fora da carga, e eu fui conferir se o avaliador erra alto quando alguém pede uma
coluna que não veio. Erra: `columnValue` tem a mensagem certa. Mas `columnValue` não é o
único caminho que lê uma linha — o **índice de igualdade** do #44 lê `row[coluna]`
direto, para ser rápido. E `row[coluna] ?? null` não distingue duas coisas
completamente diferentes:

- a coluna está na linha e **vale BLANK**;
- a coluna **não está na linha**.

Coluna calculada não está na linha até alguém pedi-la: o avaliador a memoiza sob
demanda, e é isso que torna o custo dela proporcional ao uso. Indexar antes disso jogava
**a tabela inteira** no balde do branco. Aí `candidatos("baixo")` procurava o balde de
`"baixo"`, não achava, e devolvia lista vazia — e como quem chama só aplica o predicado
**aos candidatos**, o predicado nunca rodava, a coluna nunca era materializada, e o
número saía BLANK.

### O mínimo reproduzível

1.500 linhas, coluna calculada `grupo = IF([valor] < 50, "baixo", "alto")`:

| | `CALCULATE(COUNTROWS('T'), 'T'[grupo] = "baixo")` |
|---|---|
| 1.500 linhas (com índice) | **BLANK** |
| 999 linhas (sem índice) | 529 — certo |
| 1.500 linhas, depois da correção | **795** — certo |

**O gatilho é `MINIMO_PARA_INDEXAR`.** Abaixo de 1.000 linhas não há índice e a conta sai
certa; acima, sai BLANK. Isto é a definição de um erro que nenhum teste com dado
sintético pega e que só existe contra a base real — que é a razão de o #44 ter sido
escrito quase todo em guardas, e de faltar justamente este.

### Quantas medidas reais estavam nesse caminho

Varrendo as expressões do modelo atrás de `'T'[coluna calculada] = <valor>`:

```
[ATINGIDO] 'FIELD AGENDA'[RankAtualProtocolo]    (1.458.244 linhas)  [QtdProtocolosPorRankAtual]
[ATINGIDO] 'FIELD AGENDA'[Turno]                 (1.458.244 linhas)  [Protocolos Manhã]
[ATINGIDO] 'FIELD AGENDA'[Turno]                 (1.458.244 linhas)  [Protocolos Tarde]
[ATINGIDO] 'FIELD AGENDA'[CategoriaProdutividade](1.458.244 linhas)  [##Qtd Improdutivo]
[ATINGIDO] 'FIELD AGENDA'[CategoriaProdutividade](1.458.244 linhas)  [##Qtd Sem Ação]
'CALENDARIO CRIADO'[data_vigente]                (abaixo do mínimo)  [& DIAS VIGENTES …] x2
```

**Cinco medidas de `agendamento-field`, todas sobre a tabela de 1,46 milhão de linhas.**
Se cada uma de fato saiu BLANK na tela depende da ordem de avaliação da página — um
visual anterior que tivesse lido `[Turno]` linha a linha já teria memoizado a coluna e o
índice acertaria. Não foi conferido visual a visual: o `--refazer` estava rodando, e a
correção não depende dessa resposta.

**O #47 mascara três delas a partir de agora, por acidente.** `Turno`,
`CategoriaProdutividade` e `RankAtualProtocolo` passaram a ser materializadas **no
arquivo**, então chegam presentes em toda linha e o índice as trata bem. Isso não conserta
nada: qualquer coluna calculada que dependa de outra tabela continua nascendo sob demanda,
e cairia no mesmo buraco. A correção é no índice.

### A correção

`in`, não `?? null`. Se a coluna falta em **qualquer** linha, o índice se declara
inutilizável e `candidatos()` devolve `null` — o quarto guarda do arquivo. `null` nunca é
erro: quem chama varre, a varredura passa por `columnValue`, e aí acontece a coisa certa
nos dois casos — coluna calculada é materializada, coluna que não veio na carga **erra
alto**. É esse guarda que autoriza a projeção de colunas da `DECISAO-DESEMPENHO.md`.

Sai na primeira linha faltante, então o caso ruim custa O(1) e o caso bom custa um `in`
por linha.

### Os outros lugares que leem a linha direto — conferidos, e limpos

`columnValue` é o caminho seguro, mas não é o único que toca uma linha. Os outros três
foram testados com a mesma coluna calculada, e **nenhum tem o problema**:

| onde | lê | veredito |
|---|---|---|
| `evaluator.ts` `resolveNameRef` | `if (key in row)` e senão `columnValue` | já usava `in` — correto |
| `filter.ts` `rowKey` (via `filterFromTable`) | `row[c] ?? null` | as linhas chegam de `ALL`/`VALUES`, que passam por `columnValue` e materializam antes |
| `evaluator.ts` `expr IN <tabela>` | `row[coluna] ?? BLANK` | idem |

Medido: `ALL`, `VALUES`, `FILTER(ALL(col))`, `IN {…}`, `IN VALUES` e `DISTINCTCOUNT`
sobre a coluna calculada dão o número certo com 1.500 linhas e com 999. O buraco era do
índice, e só dele — porque o índice é o único que substitui a varredura em vez de
preceder uma.

### Estado

975 testes, 3 novos. Mutação conferida: apagar `if (!this.completo) return null;` derruba
os 3, e só eles.

---

## #51 — Onde mora uma divergência deliberada, e o guarda que a mantém honesta

**A PERGUNTAS-NEGOCIO #1 ficou respondida e não implementada por dois dias**, e não
por falta de resposta. O Fabrício respondeu em 08/08/2026: *"sábado conta como 0.5 e
domingo 0,5 pois é equipe reduzida"*. O que faltava era **lugar**: as fórmulas moram em
`specs/_catalog/{tables,measures}/`, que `npm run extract` sobrescreve (regra 2). Editar
ali é escrever na areia; não editar é servir a conta que o negócio disse estar errada.

`specs/_catalog/divergencias.yaml` é o lugar — mesmo padrão do `cache-policies.yaml`,
que já resolvia isso para cache. Cada entrada substitui o DAX de uma coluna ou medida e
declara a pergunta que a decidiu, a data, o porquê, e o `sha256` do DAX **original**.

### O `original_sha` é a metade que importa

Sem ele, isto seria uma bomba de efeito retardado: alguém corrige a fórmula no Power BI,
o extrator traz a versão nova, e o arquivo a descarta **em silêncio** para continuar
aplicando um remendo decidido contra outra fórmula — para sempre, e sem sinal nenhum. É
o mesmo formato de estrago do #47, e a mesma resposta: comparar e errar alto.

São três erros altos, e nenhum deles é zelo: o objeto que sumiu (a spec foi regenerada e
mudou de nome), o objeto sem DAX (trocar fórmula de coluna física não significa nada), e
o sha que não bate. Todos nomeiam a pergunta, para a próxima pessoa começar pela decisão
e não pelo código.

### O que mudou de número

As duas colunas `PESO` do modelo **discordavam entre si**, o que já era sinal:

| | feriado | domingo | sábado |
|---|---|---|---|
| `CALENDARIO INSTALADO[PESO]` (Power BI) | 0 | 0 | **1** |
| `CALENDARIO CRIADO[PESO]` (Power BI) | 0 | **0** | 0,5 |
| **Nossa regra, a partir de agora** | 0 | **0,5** | **0,5** |

No `INSTALADO`, o `0.5` do sábado estava lá — comentado, com a nota *"Cerqueira afirmou
que o sábado era 100% 19/05/2025"*. Aproveitei para trocar o `SWITCH` sobre
`[DIA_SEMANA]`, que compara o **nome do dia em texto**, por `WEEKDAY(_, 2)`: o resultado
deixa de depender do idioma da fonte.

**Não** foi mexida a lista de feriados chumbada no DAX do `CRIADO` (2020, 2021 e
2026-06-04, em vez da tabela `FERIADOS`). É o achado #7, é outro problema, e corrigir de
carona seria esconder uma mudança dentro de outra.

### O que ficou de fora, e por quê

`'PROTOCOLOS GERAL'[# MEDIA CRIADOS]` é atingida pela mesma pergunta e **não** foi
mexida. O DAX dela faz duas coisas que a resposta não cobre:

- o denominador conta sábado como 1 (ele passa no filtro `WEEKDAY <> 7`) e **depois**
  soma mais 0,5 por sábado — sábado vale **1,5**. Isso é claramente errado;
- o **numerador** exclui domingo, então protocolo criado no domingo não conta. Mas a
  regra nova diz que domingo é dia de equipe reduzida, não dia parado. Somar 0,5 no
  denominador e manter o numerador excluindo domingo derruba a média por um motivo que
  ninguém pediu.

Consertar só o denominador deixaria a medida internamente incoerente, e escolher o resto
seria adivinhar. Fica registrado no próprio `divergencias.yaml`, como pergunta aberta.

### Estado

989 testes, 6 novos. Os três erros altos têm teste, e o teste do arquivo real falha se
alguém apagar uma decisão sem reabrir a pergunta.

---

## #52 — A página carrega o que toca, e o `Relato` revelou o que "sob demanda" custa

Dois passos da `DECISAO-DESEMPENHO.md`, e o segundo só existiu porque o primeiro
esbarrou numa semântica do Power BI que eu não esperava.

### A projeção derivada

`FIELD AGENDA` tem 26 colunas; `agendamento-field` usa 17. `PROTOCOLOS GERAL` tem 63 e
usa 34. Somando as tabelas da página: **45 de 107 colunas não viram memória**.

A lista é **derivada**, e isso não é preciosismo. Uma lista de "colunas que a página
usa" escrita à mão apodrece no primeiro `npm run extract` — alguém acrescenta um campo
num visual e a lista não sabe. O conjunto sai do mesmo fechamento que `plano.ts` já faz
para tabelas, por cinco arestas: campo de visual, filtro, DAX (medida, coluna calculada
e tabela calculada), as duas pontas de cada relacionamento, e o `[X]` sem tabela —
esse último marcado em **toda** tabela que tenha coluna com esse nome, porque só o
avaliador sabe qual era, e só em tempo de execução.

**O erro possível tem um lado só, e não é silencioso.** Omitir coluna que a página usa
faz `columnValue` errar alto, e o índice de igualdade recusar responder (#50). Foi por
isso que o #50 veio antes: sem ele, uma coluna omitida por engano viraria zero calado em
tabela grande. Com ele, a projeção é segura de ligar.

A armadilha mais discreta não estava na projeção, estava ao lado dela:
`aplicaTiposDeclarados` percorre as colunas **do modelo** e escreve o valor convertido na
linha. Sem excluir as omitidas, ela as **ressuscitaria valendo BLANK** — a projeção
produzindo exatamente o número errado silencioso que promete não produzir. Tem guarda,
tem teste e tem mutação.

### O `Relato`, e por que "paginar e buscar" não funciona

`'FIELD AGENDA'[Relato]` é **36,8% dos bytes** da maior tabela — ~350 MB de texto livre
— e a derivação o **mantém**, corretamente: um `tableEx` da página o exibe.

O plano era buscar o texto sob demanda, por linha, depois de paginar. **Não dá**, e o
motivo é uma semântica do Power BI que o próprio `tabela.ts` já documentava sem que eu
tivesse ligado os pontos:

```
visual 815c0959 (tableEx)
   count  [Protocolo]
   chave  [Protocolo]  [Data Relato]  [Descrição]
   chave  [Relato]          ← campo sem agregação = CHAVE DE AGRUPAMENTO
   chave  [ClassificacaoRelato]  [CategoriaProdutividade]
```

Um `tableEx` mostra as **combinações distintas** dos campos sem agregação. Formar os
grupos exige o valor de `Relato` em todas as 1,46 milhão de linhas — e a paginação só
existe **depois** do agrupamento. Paginar-e-buscar resolveria um problema que não é o
que está ali.

### O que sobrou é melhor, e é a diferença entre relatório e aplicação

O visual não é calculado na abertura da página. Ele vira **sob demanda** — não erro — e
os outros 38 seguem. `GET /api/dashboards/<id>?visual=<id>` libera as colunas que
**aquele** visual amarra, e só elas.

Três detalhes que decidem se isso funciona ou vira mentira:

1. **A chave do cache inclui o que foi liberado.** Com cache por página, a primeira
   pessoa a pedir os relatos deixaria os 350 MB residentes para todos os pedidos
   seguintes, e a versão cara viraria a versão de todo mundo.
2. **Liberar é explícito e por coluna.** Um booleano "carregue tudo" acabaria ligado em
   algum script até virar o padrão de novo, calado.
3. **Sob demanda vale para o que a tela mostra, não para o que a conta ignora.** Medida
   que dependa de coluna omitida continua errando alto.

`ClassificacaoRelato` não se perde: é coluna congelada no snapshot desde o #47, calculada
no refresh a partir do `Relato`. Os cartões e gráficos que classificam relato funcionam
com o texto fora da memória — o #47 pagou por este passo sem saber.

### Estado

1008 testes, 17 novos entre projeção, sob demanda e a rota. Em `FIELD AGENDA` saem
**9 de 26** colunas. O efeito em tempo ainda não está medido: as três tentativas de hoje
foram invalidadas por execuções concorrentes na mesma máquina (ver `CONTINUACAO` §7 — o
aviso estava lá e eu demorei a segui-lo).

---

## #53 — "Não existe aplicação para eu validar", e o que a frase estava certa em dizer

O Erick olhou o projeto em 11/08/2026 e disse que não havia frontend nem backend. A
frase era **factualmente errada**: os dois existiam e estavam no ar. Meu próprio
`npm run api` falhou com `EADDRINUSE` porque um servidor de sessão anterior já
segurava a 3100, com `agendamento-field` carregada. `GET /api/dashboards` devolvia as
14 páginas, todas `pronta: true`, e `visao-geral` calculava 28 visuais em 2,3 s.

E ainda assim ele estava **substancialmente certo**, que é o achado.

### A diferença entre uma tela e uma aplicação

O que existia era uma tela de conferência: 461 linhas de HTML, um `<select>` de
páginas, uma página por vez. O que faltava não era código de desenho — era tudo que
transforma "abre" em "dá para usar":

| o que existia | o que faltava |
|---|---|
| card, tabela, matriz e gráfico desenhando número real | navegação entre as 14 páginas |
| filtro de página e de visual aplicados no cálculo | **as segmentações não filtravam nada** |
| a página inteira num pedido | estado na URL — nenhuma vista era compartilhável |

A terceira linha é a que doía. As `slicer` do relatório chegavam à tela como
`semCalculo: 'segmentação de dados'` e viravam caixa morta. Uma página com dez
controles que não fazem nada não é um dashboard incompleto: é um dashboard que
**mente sobre o que oferece**.

### A lição de método

Eu tinha medido tudo neste projeto — 104 minutos, 45 de 107 colunas, 36,8% dos bytes —
e não tinha medido **a distância entre o que a tela mostra e o que alguém consegue
fazer com ela**. `npm run paginas` dizia "117 de 117 visuais calculam", e essa métrica
está certa e é inútil para responder "dá para conferir?". O `CONTINUACAO` chegou a
listar "filtros na tela" como item 3 da ordem sugerida, atrás de otimizar
`agendamento-field` — e o item 3 era o que bloqueava a pessoa que ia usar a coisa.

**Métrica de engenharia não substitui a pergunta "o que a pessoa consegue fazer".**

### O que a correção custou, e o que ela não mexeu

`apps/web` em React 19 + Vite 7, e o filtro de tela atravessando como `FiltroSpec`
sintético — nenhuma engine mudou, porque `traduzFiltros` já sabia aplicar
`FiltroSpec`. O caminho inteiro do filtro é uma URL virando uma entrada na lista de
filtros de página.

Medido em `visao-geral` com `[EQUIPE] = 'Equipe Field Service'`: `CLIENTES DISTINTOS`
28.253 → **2.973**, `PROTOCOLOS TOTAIS` 32.744 → **3.030**, `PROTOCOLOS INSTALADOS`
24.400 → **2.503**. Conferido em Chrome headless, renderizando a URL com o filtro:
o controle vem marcado, a faixa diz "1 segmentação(ões) aplicada(s)", e os números
são os filtrados.

### As duas armadilhas do caminho

- **`TaskStop` mata o wrapper do `npm`, não o `node` filho.** Parei a tarefa de
  background, subi outra na mesma porta e levei `EADDRINUSE` — o processo antigo
  ainda estava lá, servindo **código velho**, e por um momento a resposta pareceu um
  bug meu. Para matar de verdade: achar o dono da porta
  (`Get-NetTCPConnection -LocalPort <p>`) e `Stop-Process` nele. É primo da armadilha
  do `kill -0` do Git Bash já registrada no `CONTINUACAO` §7.
- **`chrome --headless --screenshot` não grava nada; `--headless=old` grava.** O
  `--dump-dom` funciona nos dois. Um screenshot que não sai parece "a página não
  renderizou", quando o DOM está perfeito.

### Estado

1063 testes, 52 novos: o codec de filtro (11, quase todos sobre erro que produziria
número errado calado), a formatação da tela (11), o estado na URL (12), as
segmentações (5), as rotas novas da API (9) e as siglas da navegação (4). A decisão
está em
`docs/DECISAO-TELA.md`; a API **continua** em `node:http`, porque só metade da espera
do `CONTINUACAO` §6 terminou.

---

## #54 — A tabela calculada congelada gravou a coluna-chave inteira nula, e ninguém viu

Achado ao ligar a segmentação de hierarquia de datas: pedi a lista de anos distintos de
`'CALENDARIO CRIADO'[DATA CRIADO]` e a API devolveu **um valor: `null`**. A coluna
existia no modelo, a tabela tinha 365 linhas, e mesmo assim o dataset lia vazio.

### O que estava errado

`escreve` lê `linha[nome]` usando o nome do **modelo** (`DATA CRIADO`). O `Dataset`
guarda toda linha sob a chave **normalizada** (`addTable` normaliza na entrada — é a
mesma regra que o `adotaTabela` do #49 exige). As duas nunca se encontraram.

Resultado: **toda coluna cujo nome difere do normalizado foi gravada como `null`.**

| arquivo | coluna | linhas nulas |
|---|---|---|
| `calc.calendario-criado` | `DATA CRIADO` | 365 de 365 |
| `calc.calendario-instalado` | `DATA INSTALADO` | 364 de 364 |
| `calc.calendar` | `Protocolo` **e** `Data` | 30.009 de 30.009 — a tabela inteira |
| `calc.status-protocolo-dia` | `Dia`, `Status` | 30.009 de 30.009 |

São **chaves de relacionamento**. Uma tabela de calendário sem data não propaga filtro
nenhum, e `calendar` inteira era ruído.

### Por que passou por um commit inteiro

Três coisas se somaram, e cada uma sozinha teria sido pega:

1. **As colunas calculadas escapavam por acidente.** O laço que as preenche gravava o
   valor sob o **nome de exibição** (`linhas[i][nome] = v`), criando uma chave paralela
   que `escreve` encontrava. Então `PESO` e `data_vigente` saíam certos, e o arquivo
   *parecia* bom. O acidente escondia o defeito exatamente nas colunas que o commit
   existia para produzir.
2. **`apuraColunas` registra `tipo: 'vazia', nulos: 365` sem reclamar.** Está certo —
   coluna legitimamente vazia existe. Mas nada distinguia "vazia porque o dado é vazio"
   de "vazia porque a chave não existe".
3. **O commit não trouxe teste.** `4024ace` acrescentou 235 linhas e **zero** testes,
   contra a regra 4 do `CONTINUACAO`. Um teste de ida e volta pelo arquivo — gravar e
   reler — teria pego na primeira execução, e é o que existe agora.

### A correção

`paraGravacao(linhas, colunas, onde)` em `packages/snapshot/src/tabelas-calculadas.ts`:
projeta as linhas para as chaves que o cabeçalho declara, lendo pela chave normalizada.
Usada pela biblioteca **e** pela ferramenta — duas projeções divergiriam no primeiro
nome esquisito, e a divergência sairia como coluna nula outra vez.

O guarda é a metade que importa: **coluna do modelo que não existe na linha é erro**,
não `null`. Coluna legitimamente vazia continua passando; o que não passa é a coluna que
não está lá. Sete testes, um deles gravando e relendo o arquivo de verdade.

### O byte NUL no fonte

O mesmo commit gravou `tabelas-calculadas.ts` com um **byte NUL literal** dentro de
`partes.join('…')` — o separador do `sha`, escrito como byte cru em vez de escape. O
git classificou o arquivo como binário (`Bin 0 -> 5033 bytes` no commit), então ele não
tem diff, não normaliza fim de linha, e algumas ferramentas de edição o recusam.
Trocado por `\u0000`, que produz **a mesma string** — conferido: os quatro `tabelaSha`
gravados nos arquivos continuam idênticos aos recalculados.

### O raio de alcance, medido — e menor do que parecia

Corrigido o arquivo, refiz `visao-geral` e comparei **visual a visual** contra a
resposta gravada antes da correção: **10 visuais com número, 10 idênticos, 0 mudaram.**
Os 6 cards da página contam sobre `PROTOCOLOS GERAL` e não atravessam o calendário.

Isso não diminui o defeito — o dado no disco estava errado —, mas impede a conclusão
exagerada de que "todo número do relatório estava errado". O que ainda **não** foi
medido é o efeito nas páginas que usam medida por data sobre as tabelas de calendário
(`relatorio-do-mes`, `diario-instalacao`). O A/B honesto ali é rodar `npm run paginas`
antes e depois, e é uma razão a mais para a medição que já estava na fila.

Vale notar o que **não** estava nulo: `PESO`, `data_vigente` e as outras colunas
calculadas. Ou seja, a decisão do sábado/domingo valendo 0,5 (#51) nunca foi afetada —
o que estava vazio eram as **chaves**, não os pesos.

### A varredura dos outros 19 arquivos

Seis arquivos do snapshot têm alguma coluna 100% nula, mas **só um é este defeito**. Os
outros cinco (`protocolos-geral`, `protocolos-produtividade`, `protocolos-telefonia`,
`retorno-prioritario`, `backlog-agendado-futuro`) têm nomes de coluna **já
normalizados** — `técnico 2`, `categoria4`, `gerente/supervisor` —, então `linha[nome]`
os encontra. São colunas genuinamente vazias na fonte, e duas delas já são pergunta
aberta: `categoria3/4/5` é a #4 e `gerente/supervisor` é a #2 do `PERGUNTAS-NEGOCIO`.

A distinção é conferível em uma linha: o defeito atinge **só** coluna cujo nome difere
do normalizado. Em `calc.status-protocolo-dia`, `protocolo` (minúsculo) tinha valores e
`Dia`/`Status` não — no mesmo arquivo, na mesma gravação.

### A lição

**O acidente que faz metade do resultado parecer certo é pior que a falha inteira.** Se
nenhuma coluna tivesse valor, o arquivo teria denunciado o problema na primeira leitura.
Como as calculadas saíam certas — e eram elas o assunto do commit —, o arquivo passou
por revisão parecendo o que deveria ser.

E a segunda: **o bug foi achado por uma funcionalidade nova, não por um teste.** A rota
de valores distintos existe para alimentar um controle de tela; ela leu a coluna e a
mostrou vazia. Ferramenta que exibe dado cru encontra o que teste sobre dado sintético
não encontra — é o mesmo mecanismo dos achados #38 e #40.

---

## #55 — Revisão de arquitetura do código real, contra o desenho documentado

**Encontrado em 11/08/2026, numa revisão pedida do lado de fora do código** (sem
medir incidente nenhum) — lendo o grafo de dependência real entre pacotes e
comparando com o pipeline que `README.md`/`ARCHITECTURE.md` descrevem. Cinco pontos,
nenhum é bug de cálculo; são estrutura.

### `packages/snapshot` já invoca o Evaluator — a composição não é só de `apps/api`

`packages/snapshot/src/carrega.ts:27` importa `Evaluator` de `measure-engine` e o
instancia em `carrega.ts:187`; `plano.ts:34` e `colunas-usadas.ts:28` importam o tipo
`DashboardSpec` de `widget-engine/src/spec.ts`. O pipeline documentado é
`Evaluator → Widget Engine → apps/api`, mas na prática `snapshot` já monta o
Evaluator para descobrir quais colunas materializar — faz sentido (ele precisa saber
o que cada página consome), só que o desenho documentado sugere uma fronteira mais
limpa do que a que existe.

### Fronteira entre pacotes é convenção de pasta, não é imposta

Só `apps/web` e `tools/extractor` têm `package.json` próprio; `query-engine`,
`transform-engine`, `semantic-model`, `measure-engine`, `widget-engine`, `snapshot` e
`apps/api` não têm. Nenhum import no repo usa `@analytics/...` — tudo é caminho
relativo direto para dentro do `src/` de outro pacote (ex.: `apps/api/src/servidor.ts`
importa de quatro pacotes por caminho relativo). Cada pacote tem um `index.ts` de
barrel, mas só um import no repo inteiro o usa (`apps/api/src/calcula.ts:26`) — todo
o resto fura o barrel. Renomear um arquivo interno de `measure-engine` quebra
`widget-engine`, `snapshot` e `apps/api` ao mesmo tempo, sem nenhuma camada de API
pública para avisar antes.

### Seis ferramentas de `tools/` não têm teste nenhum

Confirmado (zero arquivos `*.test.*` em cada uma): `tools/auth`, `tools/doctor`,
`tools/mrun` (526 linhas), `tools/paginas`, `tools/probe`, `tools/snapshot`
(547 linhas). São os orquestradores CLI que materializam a camada M em disco — a
regra 4 ("todo teste tem de falhar se a regra sumir") vale hoje para as engines, não
para os scripts que as acionam.

### `packages/measure-engine/src/evaluator.ts` é o arquivo com mais responsabilidade concentrada

813 linhas — avaliação de AST, contexto de filtro e time intelligence juntos. Os
`functions.ts` grandes (`transform-engine`: 1.821 linhas; `measure-engine`:
1.372 linhas) são tabelas de função DAX/M, coesão esperada para o tamanho;
`evaluator.ts` é o único arquivo grande onde separar por responsabilidade
provavelmente ajudaria a navegar.

### Lógica de negócio dentro de um `.tsx`

`apps/web/src/componentes/Segmentacao.tsx:70-166` embute `mesmoValor` (dedup),
`visiveis` (filtro de busca) e `resumo` (formação de texto) direto no componente.
Só os `.ts` puros de `apps/web` têm teste (`formato.ts`, `janela.ts`, `rota.ts`,
`rotulos.ts`) — nenhum `.tsx` é testado —, então essa lógica está no único lugar da
tela que o padrão do próprio projeto não cobre.

### O que não é problema, conferido

Grafo de dependência entre pacotes é um DAG limpo — nenhum ciclo encontrado
(`semantic-model ← measure-engine ← widget-engine ← snapshot ← apps/api`;
`query-engine` e `transform-engine` são independentes entre si). O guard read-only
da API está centralizado uma única vez, no topo de `atende()`
(`apps/api/src/servidor.ts:92-100`), antes de qualquer roteamento — sem duplicação.

### Estado

Nada aqui foi corrigido. É registro de risco estrutural para decisão futura, não
conserto — no espírito da regra 8 (medir antes de decidir): os cinco pontos foram
conferidos por leitura direta do código e contagem de linha/arquivo, não por leitura
superficial da documentação.

---

## #56 — O perímetro, fechado no que não dependia de gente

> 11/08/2026. É a execução das Fases 1.0, 2, 3 e 4 do plano montado a partir do
> [#55](#55--revisão-de-arquitetura-do-código-real-contra-o-desenho-documentado).
> Nada aqui toca cálculo: o núcleo continua o mesmo, e paridade continua sendo o
> bloqueio de verdade — ela depende de alguém com o Power BI aberto.

### O valor de um filtro nunca vira texto de SQL

`SqlRunner` **já declarava** `params?: Record<string, unknown>` desde a fase 2, e
`SqlConnector.execute` já o repassava. Os dois runners o ignoravam: `postgresRunner`
mandava `{ text: sql }` sem `values`, `mariaRunner` chamava `pool.query(sql)` cru. O
contrato existia e não chegava a lugar nenhum.

`traduzParametros` fecha isso em `connectors-sql.ts`: `:nome` vira `$1..$n` no
Postgres e `?` com `execute()` **preparado** no MariaDB. Um pool MariaDB sem
`execute` recebendo parâmetro **derruba** em vez de cair na interpolação.

Três detalhes que só aparecem escrevendo:

- **`::time` não é parâmetro.** Três queries do catálogo dependem do cast. O
  scanner copia `::` inteiro antes de procurar nome.
- **O mesmo nome duas vezes vira dois marcadores.** `$1` repetido funcionaria no
  Postgres; `?` do MySQL é posicional. Uma regra só, e a que serve aos dois.
- **`assertReadOnly` roda sobre o texto traduzido**, que é o que sai do processo. Os
  valores não passam por ela de propósito: eles não são SQL.

Erra alto nas duas pontas — nome citado sem valor, e valor que veio e não foi usado.
O segundo é o que importa: uma consulta que ignora o recorte pedido devolve o
conjunto errado calada.

**Por que agora, se nada passa parâmetro hoje.** Conferido: `grep` por `:nome` fora
de `::` nas 24 specs de query devolve **zero**. E `?filtro=` nunca toca SQL —
`decodificaFiltros` produz `FiltroSpec` que o avaliador aplica em memória. A
superfície de injeção nasce no dia em que uma segmentação virar `WHERE`, que é
exatamente o passo 1.2/1.3 do plano. O caminho tinha de existir antes.

### O cache que existia e não era usado

`RedisCache` estava pronto e testado desde a fase 2 — `SCAN` em vez de `KEYS`,
`ioredis` já como dependência de raiz — e `new RedisCache(...)` só aparecia em
`packages/query-engine/test/cache.test.ts`. A API não usava cache nenhum.

Agora `apps/api` cacheia a **resposta calculada**, não a linha de fonte. O snapshot
em disco continua sendo a verdade; o que estava caro era recalcular.

A decisão que faz diferença é **onde** a consulta ao cache entra: **antes** de
`carrega()`. Num acerto o pedido não abre o snapshot, não materializa tabela
calculada e não roda o avaliador — o teste prova isso olhando `paginasCarregadas` do
`/api/saude` continuar vazio depois de uma resposta 200. Cachear só a serialização
não caberia nos 300 ms da regra 9.

A chave carrega tudo que muda o número:

```
resp:v1:<usuario>:<pagina>:<sha filtros normalizados>:<visual|*>:<de>:<linhas>:<carimbo>
```

- **`<carimbo>`** é o sha do manifesto (`query@geradoEm#linhas`). É o que faz
  `npm run snapshot` invalidar sozinho — sem ele, "o refresh rodou e o painel não
  mudou", que é o tipo de erro que ninguém percebe.
- **filtros normalizados**: ordem dos filtros e ordem dos valores não mudam a chave
  (`IN (a,b)` e `IN (b,a)` filtram igual), mas o **tipo** entra — `IN ('2026')` e
  `IN (2026)` não podem colidir. O `nivel` também: filtrar pelo ano de uma data e
  pela data crua dá números diferentes sobre a mesma coluna.
- **`<usuario>`** entra **antes de existir RLS**, e é a única parte disto que é
  desenho. Depois de existir recorte por linha, uma chave sem usuário serve a página
  do gestor A para o gestor B — cache virando vazamento. Custa um campo agora;
  custaria lembrar na hora certa depois.

TTL: o **menor** entre os das queries da página, de `cache-policies.yaml` — servir
`protocolos-geral` com o TTL de `feriados` mostraria ontem por 24 h. Query fora do
registry, ou plano indeterminado, **desliga** o cache.

**O Redis caído é um miss, nunca um erro de pedido.** É a única exceção à regra
"erre alto" desta base, e é deliberada: o cache não participa do valor da resposta,
só do tempo dela. A falha vai para `aoFalhar` — degrada, não silencia. O 409 de
snapshot faltando **não** entra no cache: guardá-lo travaria a página por um TTL
inteiro depois de o snapshot já existir.

### A documentação declarava uma plataforma que não está aqui

`docs/ARCHITECTURE.md` listava 15 Engines; `packages/` tem 6. O diagrama de
Debezium → Kafka → Redis Streams → SSE aparecia como descrição do sistema, e
`kafka`/`debezium` têm **zero** ocorrências em código.

O arquivo agora tem duas metades: **Parte 1 — Implementado** (com o arquivo ao lado
de cada afirmação) e **Parte 2 — Projetado, sem código**. Uma linha só troca de
metade quando o código dela existe.

E `docs/DECISAO-REALTIME.md` **passou a existir**: o `CONTINUACAO.md` §6 mandava não
mexer na Fase 4 "porque há decisão pendente" nesse arquivo, e o arquivo nunca tinha
sido escrito. A decisão é TTL + refresh agendado, com um **gatilho medido** para
abrir a Fase 4 — e, quando ele disparar, o próximo passo ainda não é Kafka: é
polling incremental por `updated_at` no mesmo Query Invalidator, que já existe em
`QueryRegistry.queriesForTable()`.

### O que continua não existindo, e está escrito onde

Autenticação. `specs/_catalog/permissoes.yaml` (mantido por humanos, no molde de
`cache-policies.yaml`) tem o **formato** da decisão e nenhum leitor;
`apps/api/src/identidade.ts` tem a costura e devolve sempre `local`. Ele
deliberadamente **não** lê cabeçalho nem cookie: um `X-Usuario` aceito sem
verificação seria pior que não ter identidade, porque a plataforma passaria a
*parecer* que controla acesso.

### Medição

**Contra o snapshot real** (16 queries em disco, dado de 07/08/2026 13:34 UTC), API
em `PORT=3101` para não derrubar a de outra sessão:

| página | 1º pedido | 2º pedido | 3º |
|---|---|---|---|
| `visao-geral` (28 visuais) | **7,75 s** `miss` | **5,6 ms** `hit` | 25 ms `hit` |
| `diario-instalacao` (22 visuais) | **3,03 s** `miss` | **4,6 ms** `hit` | 4,3 ms `hit` |
| `capa` | 16 ms `miss` | 2,2 ms `hit` | 2,4 ms `hit` |

E a prova de que a chave não colide: o mesmo `diario-instalacao` com `?linhas=50`
volta a `miss` e leva 2,61 s — ele **não** reaproveitou a resposta da janela padrão.

Duas leituras:

- **O orçamento de 300 ms a quente da regra 9 está atendido com folga** — 5 ms, três
  ordens de grandeza abaixo. Era o que a Fase 2 tinha de entregar.
- **O de 2 s a frio não está**, e o cache não o resolve por construção: o primeiro
  pedido paga a carga inteira. Quem ataca isso é o passo 4 do `CONTINUACAO.md` §6
  (empurrar mesclagem e agregação para SQL), e ele vem **depois** da paridade — sem
  gabarito verde, um `LEFT JOIN` que multiplica linha passa despercebido.

`npm test`: **1136 verdes**, 33 deles novos (16 de parâmetro, 17 de cache). Teste de
mutação em todas as regras novas, como manda a regra 4 — sete mutações, sete
derrubaram teste:

| mutação | teste que caiu |
|---|---|
| runner volta a ignorar `params` | injeção chega como valor |
| `::` deixa de ser cast | `::time` é cast |
| parâmetro sem uso passa calado | parâmetro sem uso derruba |
| carimbo sai da chave | snapshot refeito invalida |
| janela sai da chave | janela diferente recalcula |
| `get` que falha propaga | Redis fora do ar não derruba |
| usuário sai da chave | usuários não compartilham resposta |

---

## #57 — CDC ligado, mas como instrumento de medida: o observador que só conta

> 11/08/2026, mesmo dia do #56. O Erick pediu Kafka e Debezium "para testar a
> aplicação"; as três escolhas — capturar do **Voalle de produção**, evento em modo
> **só observar e medir**, Redis apontando para o **Portainer** — são dele, feitas
> depois de eu registrar os riscos abaixo.

### Dois fatos que mudaram o que "testar com CDC" significa

**1. Debezium contra o Voalle não é leitura.** Replicação lógica exige
`wal_level=logical` (restart do Postgres do ERP), `CREATE PUBLICATION` (DDL), uma
role com `REPLICATION` e um slot. O usuário somente-leitura da plataforma não faz
nenhuma dessas coisas, e não deve fazer — a regra inviolável 3 fica inteira. Tudo
isso saiu de código e foi para [RUNBOOK-CDC.md](RUNBOOK-CDC.md), para mão humana com
permissão.

**2. Hoje o CDC não deixaria número mais fresco.** A API lê `snapshot/*.jsonl` em
disco. Um evento invalidando cache só faria ela recalcular **sobre o mesmo arquivo**
— mesmos números, mais lento. Para o CDC valer alguma coisa, o evento teria de
disparar rematerialização, que é outra decisão e tem outro custo (`protocolos-geral`
leva ~21 s).

Essas duas juntas são o motivo de o modo escolhido — **só observar** — ser o único
que rende alguma coisa hoje: ele produz a condição 1 do gatilho do
`DECISAO-REALTIME.md` sem mudar comportamento nenhum.

### O risco que virou pré-requisito, não aviso

**Slot de replicação retém WAL até o consumidor confirmar leitura.** Consumidor
parado — container derrubado, fim de semana — e o WAL cresce sem limite até o disco
encher. O banco que para é o Voalle, em produção.

Por isso `npm run cdc:slot` foi escrito **antes** de qualquer conector existir, e a
regra que ficou no CONTINUACAO é: sem o monitor de pé, não se registra conector. Ele
lê `pg_replication_slots` — `SELECT` em catálogo, passa por `assertReadOnly`, sessão
somente-leitura — e alerta em três casos: slot inativo, WAL retido acima do teto
(1 GB por padrão) e `wal_status='lost'`.

**Medição contra o Voalle real, 11/08/2026 17:39 UTC: nenhum slot de replicação
existe.** É a baseline — se um aparecer, é nosso.

Duas armadilhas que entraram no runbook porque não são óbvias:

- **`heartbeat.interval.ms` não é enfeite.** Sem heartbeat, uma base cujas tabelas
  *capturadas* mudam pouco deixa o `restart_lsn` parado enquanto o resto do servidor
  gera WAL — e o servidor retém tudo. O gráfico de eventos/min fica em **zero**
  enquanto o disco some. É o modo silencioso da falha.
- **O rollback tem ordem.** Derrubar o slot com o conector vivo faz o Debezium
  recriá-lo em segundos, e parece que o rollback não funcionou. Para o conector
  primeiro.

### O payload não entra, por construção

Um evento Debezium carrega a linha inteira: `field-agenda` tem endereço de cliente,
`QUADRO FUNCIONAL` tem CPF e RG. `EventoMinimo` **não tem campo** para isso — não é
uma regra de disciplina, é ausência de caminho. `leEnvelope` reduz a mensagem a
`{topico, schema, tabela, op, ts, recebidoEm}` e o resto morre ali.

O teste que trava isso não olha campo escolhido a dedo: ele serializa o objeto
inteiro e procura vazamento. Um campo novo que carregasse payload cai sem ninguém
precisar lembrar.

### Duas decisões de medida que mudam o resultado

- **Mediana, não média.** Um lote de 500 alterações num segundo (uma importação, um
  job noturno) puxaria a média para perto de zero e faria a base parecer que muda o
  tempo todo. A mediana descreve o intervalo *típico*, que é o que decide se o
  refresh agendado dá conta.
- **Do fim do tópico, não do começo.** A pergunta é a taxa de **agora**;
  `--desde-inicio` existe, mas o padrão não o usa, porque o histórico distorceria.

E duas de convivência: grupo de consumo **próprio** (`<grupo>-observador`), para não
roubar mensagem de um ingestor de verdade caso um dia exista; e janela de amostras
limitada a 5.000 por query, para um observador esquecido no fim de semana não virar
vazamento de memória por guardar carimbo de tempo.

### O mapa já existia

`tabela → queries afetadas` não foi escrito aqui: é `QueryRegistry.queriesForTable()`
alimentado pelo `source_tables` de cada spec. A única sutileza é que as duas formas
convivem — `dbVoalle` declara `assignment_incidents` pelado, `dbMaria` declara
`db_applicattion.installation_teams` —, e procurar só uma deixaria metade das queries
fora do mapa em silêncio. Tem teste para as duas.

### Estado

| peça | estado |
|---|---|
| `tools/cdc` observador + medidor | ✅ 15 testes verdes |
| `tools/cdc/src/slot.ts` monitor de WAL | ✅ **validado contra o Voalle real** |
| `tools/probe/src/redis.ts` | ✅ escrito; falta `REDIS_URL` no `.env` |
| `docker/cdc/` stack local (compose + seed + conector + scripts) | ⏸ escrito, **não executado** |
| conector Debezium no Voalle | ❌ depende de DBA — ver runbook |

**O stack local não subiu**: `com.docker.service` está parada no Windows e iniciá-la
exige elevação. O `docker compose up` falhou em `npm pipe not found`, não por erro de
configuração — o `docker-compose.yml` continua não verificado por execução, e isso
está dito aqui em vez de presumido.

`npm test`: **1151 verdes** (1136 do #56 + 15 do medidor).

---

## #58 — `Protocolos Manhã` dava 20 contra 12.269, e a culpa era do fuso do Windows

**Encontrado em 11/08/2026**, ao triar as divergências que a primeira leitura de
paridade deixou sem explicação (`docs/PARIDADE-11-08.md`). É o achado mais caro do
dia: não é bug de cálculo, é dado deslocado antes de qualquer cálculo começar.

### O sintoma

| card | Power BI | nós |
|---|---|---|
| `Agendados Manhã` | 12.269 | **20** |
| `Agendados Tarde` | 16.091 | 26.691 |

Somando, os dois lados chegam perto (28.360 contra 26.711): o total estava razoável e
**a divisão entre os dois turnos estava destruída**. Isso já dizia onde procurar — o
problema não era quantos protocolos existem, era em qual balde cada um caía.

A medida não deixa margem para dúvida:

```dax
Protocolos Manhã =
CALCULATE( DISTINCTCOUNT('FIELD AGENDA'[Protocolo]), 'FIELD AGENDA'[Turno] = "Manhã" )
```

E `Turno` é coluna calculada:

```dax
Turno = IF( HOUR('FIELD AGENDA'[Slot Agenda]) < 12, "Manhã", "Tarde" )
```

Nada aqui pode dar errado por conta própria. Então o errado era o `Slot Agenda`.

### A linha que se denunciou sozinha

Uma linha qualquer do snapshot tem `slot agenda = "2026-08-10T13:00:00.000Z"` e, na
mesma linha, o campo `relato` diz por escrito:

> *"Agendamento para 10/08/2026 no turno da MANHÃ."*

**Às 13h nada é manhã.** E o dado carregava a própria refutação ao lado — um campo de
texto que ninguém tinha pensado em usar como gabarito.

### A medida, no volume inteiro

Histograma da hora de `slot agenda` nas 1.466.202 linhas, lida das duas maneiras:

| hora | como UTC (o que `HOUR()` via) | convertida para UTC−3 |
|---|---|---|
| 08h | — | 630 |
| 09h | — | **252.543** |
| 10h | — | 226.449 |
| 11h | 630 | 138.043 |
| 12h | **252.543** | 21.060 |
| 13h | 226.449 | **249.703** |
| 14h | 138.043 | 217.604 |
| … | … | … |
| 20h | 45.902 | 973 |

A leitura em UTC tem **zero agendamentos entre 02h e 10h** e pico às 12h e 16h. A
leitura em UTC−3 começa às 08h, tem dois picos (09h e 13h) e acaba à noite — é um dia
de trabalho de campo, com turno da manhã e da tarde. Não é questão de gosto: **só uma
das duas é uma agenda de serviço.**

E os dois picos reais, 09h e 13h, sob UTC viram 12h e 16h — **os dois ≥ 12**, os dois
"Tarde". É por isso que a manhã sumiu inteira.

Reproduzindo a medida das duas formas:

| | Manhã | Tarde |
|---|---|---|
| hora em UTC (o que estava rodando) | **20** | 26.691 |
| hora em UTC−3 | 12.150 | 15.956 |
| **Power BI na tela** | **12.269** | **16.091** |

12.150 contra 12.269 é 0,97% para baixo; 15.956 contra 16.091 é 0,84%. Essa é
exatamente a assinatura da defasagem de 4,2 dias do snapshot, e sempre no mesmo
sentido. **Os dois cards passam a bater dentro da folga da defasagem.**

Terceira testemunha, independente das outras duas — cruzando o turno que o texto do
relato declara contra o turno calculado:

| linhas | texto diz | UTC calcula | UTC−3 calcula |
|---|---|---|---|
| 127.548 | Manhã | Tarde ❌ | **Manhã ✅** |
| 106 | Manhã | Manhã | Manhã |

127.548 contra 106. Não há empate a desfazer.

### A causa

`npm run probe:tipos-data` (criado para esta investigação) pergunta o tipo à origem:

```
  reports.beginning_date                        timestamp without time zone
  vsdspi.begin_date_slot                        timestamp without time zone
  vsdspi.begin_date / end_date / final_date     timestamp without time zone
  vsdspi.assignment_created / conclusion_date   timestamp without time zone
```

**As sete são `timestamp without time zone`.** Um `timestamp without time zone` não
tem fuso: `2026-08-10 10:00:00` é dez da manhã e ponto. O driver `pg`, sem fuso
declarado para usar, adota o do processo — e o processo roda em `America/Sao_Paulo`:

```
  fuso do Node : America/Sao_Paulo (offset -3h)
```

Dez da manhã em Brasília é o instante `13:00Z`. O `toISOString()` do snapshot grava
`13:00Z`, e `HOUR()` — que lê componente UTC, como YEAR/MONTH/DAY — responde 13.

Não é bug do `pg`: sem fuso declarado ele **tem** de escolher um. É bug de quem não
escolheu.

### O que resolveu a contradição que quase me fez errar o diagnóstico

Duas colunas do mesmo banco pareciam exigir hipóteses opostas: `slot agenda` chegava
a `13:00Z` (deslocada) e `data relato` a `00:00:00.000Z` exato (não deslocada). Sob
uma única hipótese, uma das duas tinha de estar errada.

Não estava. `r.beginning_date` valia `2026-08-09 21:00:00` — e 21h em Brasília **é**
meia-noite UTC do dia seguinte. As duas colunas confirmam a mesma coisa; a segunda
só parecia inocente por coincidência de horário. Foi o que fechou o diagnóstico
antes de escrever código, e é o motivo de o probe existir em vez de um chute.

### O conserto

`packages/query-engine/src/connectors-sql.ts`, bloco "Data e hora sem fuso":

- `parseSemFuso()` lê `YYYY-MM-DD[ HH:MM:SS[.ffffff]]` **como UTC** — o único fuso
  que não move o relógio.
- `tiposSemFuso()` monta a opção `types` do pool, interceptando só os OIDs **1114**
  (`timestamp without time zone`) e **1082** (`date`).
- **1184 (`timestamptz`) fica de fora de propósito.** Ali o instante é real e o `pg`
  acerta; trocar o parser dele moveria dado que estava certo. É o erro simétrico
  deste conserto, e tem teste dedicado.
- Não usa `pg.types.setTypeParser`: aquele é global ao módulo. Bastaria um segundo
  consumidor de `pg` no processo para herdar a nossa decisão sem pedir.
- **MariaDB tinha o mesmo bug por outro caminho**: `DATETIME` do MySQL também não tem
  fuso, e o padrão do `mysql2` é `timezone: 'local'`. Agora é `timezone: 'Z'`.

`Date.UTC` **rola** o que não existe — mês 13 vira janeiro do ano seguinte, dia 99
vira três meses depois, calado. `parseSemFuso` confere a volta e erra alto. Isso não
saiu de código defensivo: o primeiro teste que escrevi pegou o buraco
(`2026-13-99 10:00:00` passava), o que foi um lembrete barato de que este arquivo
existe exatamente porque data errada em silêncio viaja longe.

### O raio de alcance, medido — e o que ele NÃO é

Varrendo os 21 arquivos do snapshot, coluna de data por coluna de data:

| | valores |
|---|---|
| com hora, deslocados +3h | **12.798.071** |
| que trocam de **DIA** com o conserto | **31.398** (0,25% dos que têm hora) |

A segunda linha é a que importa, e ela é bem menor do que a primeira sugere. Colunas
de **grão de dia** — `contratos.criado`, `protocolos-geral.data criado`,
`data encerrado`, `data da troca` — estão em meia-noite UTC **exata**, ou seja não
carregam hora nenhuma e não estão deslocadas. A maior parte do relatório agrupa por
dia, e essa parte estava certa.

O estrago concentra-se em quem lê **hora**: `Turno` foi o caso extremo (100% errado),
e o resto é a virada de dia de quem trabalha depois das 21h. Duas colunas se
destacam e merecem atenção separada:

| coluna | troca de dia |
|---|---|
| `reincidencia.data_suporte` | **7,70%** |
| `instalacoes-reincidentes.data_manutencao` | **7,21%** |

As duas são de reincidência — a mesma página com 4 cards que não calcularam e as
maiores divergências restantes. Provavelmente não é coincidência, e é o próximo fio
a puxar.

Primeira versão deste número saiu **19× maior** (595.982), porque o contador tratava
meia-noite UTC exata como "vira dia". Meia-noite exata é grão de dia, não timestamp
deslocado — um timestamp deslocado cairia em `03:00Z`. Corrigido antes de entrar
aqui; fica registrado porque a conta errada era grande o bastante para mudar a
conclusão.

### O que NÃO muda agora

**O snapshot em disco continua deslocado.** O conserto age na leitura da fonte, então
só vale depois de `npm run snapshot -- --todas --memoria=8192`. Isso é bom para hoje:
os números da demo continuam sendo os que foram medidos, e a rematerialização —
que troca o carimbo do manifesto e derruba todo o cache de resposta — fica para
depois de apresentar.

### Estado

| peça | estado |
|---|---|
| `parseSemFuso` + `tiposSemFuso` | ✅ 11 testes, mutação inclusa |
| `mariaRunner` com `timezone: 'Z'` | ✅ mesma classe de bug, fechada junto |
| `npm run probe:tipos-data` | ✅ **validado contra o Voalle real** |
| snapshot rematerializado | ⏸ **depois da demo**, por causa do cache |
| `Agendados Manhã` / `Tarde` na paridade | ⏸ passam a bater só após rematerializar |

`npm test`: **1168 verdes** (1157 do #57 + 11 do fuso).


### O mesmo bug, segundo card: `MÉDIA POR DIA` errado por um fator de exatamente 2

Achado logo depois, puxando o fio do "divisor errado" que a triagem tinha marcado.
É a **mesma causa** — por isso está aqui e não num achado novo —, mas o mecanismo é
outro, e vale conhecer os dois porque procuram-se de jeitos diferentes.

```dax
MÉDIA POR DIA = DIVIDE( [Total Protocolos], [Total Dias] )
  Total Protocolos = DISTINCTCOUNT('PROTOCOLOS PRODUTIVIDADE'[N°PROTOCOLO])
  Total Dias       = DISTINCTCOUNT('PROTOCOLOS PRODUTIVIDADE'[DATA INSTALAÇÃO])
```

Power BI 178,63 contra os nossos 88,94 — razão 2,009. Razão perto de um inteiro
redondo raramente é coincidência: alguma coisa estava sendo contada duas vezes.

Reproduzindo o denominador de três maneiras, sobre as mesmas 65.563 linhas:

| `DISTINCTCOUNT(DATA INSTALAÇÃO)` contando | valor | `MÉDIA POR DIA` |
|---|---|---|
| **instante cheio** (o que rodava) | **364** | **89,18** |
| dia, truncado em UTC | 186 | 174,53 |
| dia, truncado em UTC−3 | 215 | 150,99 |

E pelo outro lado, com o número do Power BI: `33.046 ÷ 178,63 = 185,0 dias`. Contra
os nossos **186**. As duas contas fecham na mesma leitura: **o denominador tem de
contar DIAS, e o nosso contava INSTANTES.**

Faltava explicar por que havia quase exatamente dois instantes por dia. O histograma
da hora-do-dia de `DATA ALOCAÇÃO` respondeu de um jeito que não deixa dúvida:

```
distintas horas-do-dia em `data alocação`: 1
   03:00:00    41192
```

**Uma só, e é `03:00:00`.** `data alocação` é `date` no Postgres (OID 1082), e
meia-noite lida como hora de Brasília é exatamente `03:00Z`. Todos os 41.192.

`DATA INSTALAÇÃO` é calculada e escolhe entre três colunas:

| coluna | transform na camada M | onde caía |
|---|---|---|
| `DATA AGENDA` | `type date` | `00:00Z` ✅ |
| `DATA DA TROCA` | — | `00:00Z` ✅ |
| `DATA ALOCAÇÃO` | **nenhum** | `03:00Z` ❌ |

`DATA AGENDA` passa por `Table.TransformColumnTypes(..., type date)`, que trunca.
`DATA ALOCAÇÃO` não passa por transform nenhum: vai crua do SQL para o modelo, com o
horário que o driver inventou. Misturar as duas dá, para **o mesmo dia do
calendário**, dois instantes distintos — `00:00Z` e `03:00Z`. Daí 364 ≈ 2 × 186, e
daí o fator 2.

**A previsão sai sem rematerializar nada.** `03:00Z → 00:00Z` é o mesmo dia em UTC,
então o conserto colapsa o denominador de 364 para exatamente os 186 dias distintos.
Com o numerador sem a defasagem de 4,2 dias: `33.046 ÷ 185 = 178,6` — o número que
está na tela do Power BI.

### O que este segundo card mudou na cabeça do conserto

Eu quase escrevi `tiposSemFuso` só para o OID **1114** (`timestamp`). O card do
`Turno` sozinho não pedia mais que isso: `begin_date_slot` é `timestamp`, e incluir o
**1082** (`date`) parecia zelo — meia-noite deslocada continua sendo o mesmo dia, e
`YEAR`/`MONTH`/`DAY` não notariam.

`MÉDIA POR DIA` mostra o custo de ter parado ali. Meia-noite deslocada **não** é
inofensiva quando ela encontra uma meia-noite não deslocada: `DISTINCTCOUNT` vê dois
valores onde há um dia, e o resultado sai pela metade sem erro nenhum. O 1082 estava
certo por um motivo que eu não tinha na hora de decidir — fica registrado porque na
próxima vez o argumento é este, não a intuição.

### E o terceiro, que é o maior: um relacionamento inteiro morto

Puxando os 4 cards que "não calcularam", chegou-se ao mesmo bug pela terceira vez —
e desta vez o estrago não é de um card, é de uma **junção**.

Três cards de `INSTALAÇÃO/ REINCIDENTE` devolviam BLANK: `Reincidentes`,
`% Reincidencia` e `Instalados`. O terceiro é que denuncia, porque ele é
`COUNT('PROTOCOLOS GERAL'[N°PROTOCOLO])` — uma contagem crua, que só dá vazio se
**nada sobrar**. E não era filtro mal escrito: os quatro filtros da página encontram
valor de sobra quando olhados um a um (`STATUS PROTOCOLO = "Instalado"` casa com
24.400 linhas; `DATA_VIGENTE_INSTALADO = "Sim"` casa com 222 dias).

O que estava morto era o encontro entre as duas tabelas:

```
  CALENDARIO INSTALADO[DATA INSTALADO]   364 instantes, TODOS às 00:00:00
  PROTOCOLOS GERAL[data alocação]        181 instantes, TODOS às 03:00:00

  instantes em comum: 0 de 181
```

**Zero.** Duas páginas de filtro sobre uma junção que nunca casa uma linha. A página
inteira dependia de restringir `PROTOCOLOS GERAL` através do `CALENDARIO INSTALADO`,
e a ponte não existia.

`CALENDARIO INSTALADO` é tabela calculada — nasce aqui, com datas limpas à meia-noite
UTC. `data alocação` vem do Postgres como `date` e chegava às `03:00Z`. Nenhuma das
duas está "errada" sozinha; elas só não se encontram.

### O que isso explica de uma vez

`DATA INSTALAÇÃO` de `PROTOCOLOS GERAL` é calculada e escolhe entre três colunas —
das quais só uma está deslocada. O resultado é uma tabela partida ao meio:

| `DATA INSTALAÇÃO` cai em | linhas | casa com o calendário? |
|---|---|---|
| `03:00:00` (veio de `DATA ALOCAÇÃO`) | 19.965 | ❌ |
| `00:00:00` (veio de `DATA DA TROCA`/`AGENDA`) | **4.435** | ✅ |
| em branco | 8.344 | — |

Não-vazias: 24.400 — exatamente o `PROTOCOLOS INSTALADOS` da `VISÃO GERAL`. Ou seja,
**de cada 24.400 instalações, só 4.435 conseguiam ser alcançadas pelo calendário.**

```
  24.400 / 4.435 = 5,50
```

E o bloco "MÊS ATUAL" de `relatorio-do-mes`, que a triagem tinha marcado como
"~5× menor, sem explicação":

| card | Power BI | nós | razão |
|---|---|---|---|
| `MÉDIA REALIZADOS (MÊS ATUAL)` | 156 | 29 | **5,38** |
| `PROTOCOLOS TOTAIS REALIZADOS` | 1.248 | 228 | **5,47** |
| `MÉDIA REALIZADO BACKLOG` | 152 | 27 | **5,63** |
| `PROJEÇÃO (MÉDIA REALIZADA)` | 4.056 | 750 | **5,41** |

Quatro cards, quatro razões entre 5,38 e 5,63, contra **5,50 previsto pela conta
acima**. Não é uma família de bugs: é um bug com quatro sintomas.

Depois do conserto, `data alocação` passa de `03:00Z` para `00:00Z` — o mesmo dia —,
a junção volta a casar as 24.400, e os quatro cards sobem junto.

### O que NÃO está provado aqui

`manutencao-inicial` tem divergências grandes no **sentido oposto** (`TOTAL INSTALADOS`
26.165 nossos contra 19.581 do Power BI — nosso é *maior*). Junção morta também
produz número alto quando o que falha é uma restrição em vez de uma soma, então é
plausível que seja a mesma causa. **Plausível não é medido**, e essa página também
está entre as três cujo gabarito foi lido com filtro limpo. Fica para depois de
rematerializar, com gabarito novo — não vai para a conta de vitórias deste achado.

### Por que um bug de fuso conseguiu apagar uma junção

Vale dizer em voz alta, porque a lição não é sobre fuso. Uma data deslocada em três
horas continua sendo **a mesma data para um humano**: `10/08 03:00` e `10/08 00:00`
são o mesmo dia 10 em qualquer conversa. Toda inspeção visual do dado passa. O que
não passa é a igualdade — e é a igualdade que junção e `DISTINCTCOUNT` usam.

Foi por isso que o mesmo bug apareceu de três formas que não se pareciam entre si:
um card com o balde trocado (`Turno`), uma média pela metade (`DISTINCTCOUNT`
contando dois instantes por dia), e uma página em branco (junção sem par). Procurar
os três separadamente teria custado o triplo — e dois deles pareciam problema de
regra de negócio, não de leitura de dado.
### A lição que vale mais que o card

Este bug **desaparece na máquina errada**. Em CI com `TZ=UTC` ele não se manifesta —
o teste de mutação diz isso por escrito e se auto-desliga fora de UTC−3. Sobreviveu
porque produzia números plausíveis: 26.691 protocolos à tarde não parece absurdo, e
`Agendados Tarde` errado por 66% passaria por variação de dado.

O que o pegou não foi ler código. Foi um harness que exige gabarito externo e
**reprova `null`**, e um campo de texto que a própria fonte escreveu contando o que o
número deveria ser. Sem os 42 cards ditados, `Protocolos Manhã` continuaria valendo
20 na tela de um gestor.

---

## #59 — A transição de contexto era opaca para o índice, e um card sozinho custava 32 s

**Encontrado em 11/08/2026**, ao medir onde os 86 s de `agendamento-field` iam.
Este achado tem duas metades: a primeira é uma otimização que funcionou muito bem;
a segunda é uma regressão que ela causou e que **não está resolvida**.

### Antes de otimizar, duas hipóteses minhas caíram

**Primeira: "o gargalo são as colunas calculadas O(n²)."** O #44 mediu que o
processo não saía do carregamento, por causa de `RankDataProtocolo` e
`RankAtualProtocolo`, que varrem `FIELD AGENDA` por linha de `FIELD AGENDA`. Errado
hoje: as **sete** colunas calculadas de `FIELD AGENDA` já estão materializadas no
snapshot (`daxSha` no cabeçalho). Não são recalculadas no pedido.

**Segunda: "então o gargalo é o JSON de 1 GB."** `field-agenda.jsonl` tem 1.010 MB, e
eu afirmei que ler isso era a parede. A medida:

| | ms | share |
|---|---|---|
| carga (ler + `JSON.parse` de 1 GB) | **7.410** | 9% |
| cálculo (os visuais) | **75.409** | **91%** |

Ler o giga custa 7 segundos. **A parede é o cálculo**, e eu tinha dito o contrário
em voz alta antes de medir — pela terceira vez neste projeto a lição é a mesma:
*medir a parte que se suspeita não é medir onde o tempo vai.*

### O tempo estava em três visuais

| ms | % | acum. | visual |
|---|---|---|---|
| **32.581** | 48,7% | 48,7% | card `bc2c33d2` — `Média Diária` |
| 19.351 | 28,9% | 77,6% | tableEx `e2d5549b` — `Status Protocolo Dia` × `Slot Agenda` |
| 6.704 | 10,0% | **87,6%** | tableEx `084be384` |
| | | | *os outros 36 somam ~8 s* |

O pior é uma medida de quatro linhas:

```dax
Média Mensal Protocolos =
AVERAGEX( VALUES('FIELD AGENDA'[Data]), CALCULATE( DISTINCTCOUNT('FIELD AGENDA'[Protocolo]) ) )
```

364 datas × 1.466.202 linhas ≈ **534 milhões de visitas** para produzir um número.

### A causa: o `keep` da transição é opaco

`AVERAGEX(VALUES(c), CALCULATE(...))` faz **transição de contexto** a cada iteração,
e `transitionRowContext` montava o filtro assim:

```ts
keep: (r) => rowKey(r, columns) === alvo
```

O índice de igualdade do #44 existe e funciona — mas ele lê igualdade **da AST**
(`igualdadeIndexavel`). Uma closure não tem AST. Então a cada uma das 364 datas o
`linhasVisiveis` recomeçava da tabela inteira chamando `keep` linha a linha.

O mecanismo que faltava **já estava no tipo**: `TableFilter.igualdade`, criado pelo
#44, é exatamente "uma igualdade `coluna = valor` que este filtro implica", e
`partidaIndexada` a consome. A transição implica isso trivialmente e não declarava.

### Por que declarar é seguro — a verificação que veio antes do código

O `keep` da transição aceita a linha que casa em **todas** as colunas. Logo, para
qualquer uma delas, toda linha que passa tem ali o valor da linha de fora — que é
literalmente o que `igualdade` promete.

Faltava um detalhe que poderia ter estragado tudo em silêncio: **`rowKey` e o índice
codificam valor do mesmo jeito?** Se `rowKey` fosse insensível a caixa e o índice
sensível, o balde perderia linha que o `keep` aceita, e o número sairia menor,
plausível e sem aviso.

Não é o caso: `rowKey` chama `identityKey` por coluna, e o índice monta os baldes com
o mesmo `identityKey`. O balde é sempre **superconjunto** do que o `keep` aceita.
Confirmado por leitura antes de mexer, e é o motivo de este achado não ter um
"corrigido depois" no meio.

### O conserto, e o que ele deliberadamente não faz

`igualdadeDaTransicao(row, columns)` em `evaluator.ts`, declarada no filtro que
`transitionRowContext` monta. Ela devolve `undefined` quando a linha tem **mais de
uma coluna**, e isso é escolha, não preguiça: com várias, qualquer uma seria
*correta*, mas o índice cobra uma varredura para inverter a coluna, e escolher a
errada é pagar isso para receber um balde do tamanho da tabela. Sem saber a
seletividade de antemão, o chute tem valor esperado negativo.

Uma coluna é o caso que estava caro e o caso sem ambiguidade: `VALUES('T'[C])` itera
linhas de uma coluna só.

### O resultado, medido duas vezes

| visual | antes | depois (1ª) | depois (2ª) | delta |
|---|---|---|---|---|
| `bc2c33d2` `Média Diária` | 32.581 | 1.765 | 1.711 | **−30.870 (19×)** |
| `e2d5549b` | 19.351 | 24.217 | 24.471 | **+5.120 (+26%)** |
| `084be384` | 6.704 | 8.734 | 8.799 | **+2.095 (+31%)** |
| **total dos visuais** | **66.166** | 44.519 | **43.934** | **−22.232 (−34%)** |

Página inteira, pela API: **86,5 s → 62,6 s** a frio. A quente continua em
milissegundos, como já estava.

### A regressão é real, e eu quase a chamei de ruído

Dois visuais ficaram **mais lentos**, e a primeira leitura sugeria que todos tinham
ficado — o que pareceria ruído de máquina. Rodei a medição **duas vezes com o mesmo
código** para separar as coisas, e foi o que salvou a conclusão:

| | variação entre duas rodadas IGUAIS |
|---|---|
| `e2d5549b`, `084be384` (os grandes) | **±1%** |
| visuais pequenos (`a88b3232`, `ae5871aa`…) | até **±28%** |

Os pequenos oscilam demais para dizer qualquer coisa sobre eles. Os dois grandes são
estáveis em ±1%, então **+26% e +31% são efeito da mudança, não da máquina.** Sem a
segunda rodada eu teria escrito "o resto é ruído" e estaria errado.

### O que causa a regressão: não sei ainda, e duas hipóteses já caíram

- **"O índice é reconstruído a cada contexto."** Não: `partidaIndexada` recebe
  `todas = this.dataset.rows(key)`, que é sempre a **mesma instância** do array, e
  `indiceDe` cacheia num `WeakMap` por instância. Construção é uma vez por
  (tabela, coluna).
- **"`partidaIndexada` desiste e joga fora um bom `melhor`."** Ela tem
  `if (!indice) return null`, mas `indiceDe` só devolve `null` para tabela abaixo de
  `MINIMO_PARA_INDEXAR` (1.000). Com 1,46 milhão de linhas isso não acontece.

A hipótese que sobra, **não medida**: o índice paga uma varredura de 1,46 milhão de
linhas mais os baldes para cada coluna nova que passa a ser indexada, e nesses dois
visuais a coluna da transição é consultada poucas vezes — então o custo de inverter
não se amortiza. `MINIMO_PARA_INDEXAR` guarda o **tamanho da tabela**, não o
**número de consultas**, e é essa a lacuna. O conserto certo seria construir o índice
só depois de N consultas na mesma coluna, o que é mudança em `indice.ts` com risco
próprio.

**Fica registrado como dívida, com número.** O saldo é −34% e por isso a mudança
entra, mas ela não é gratuita e não vale fingir que é.

### Os testes, e por que a maioria deles não mata o mutante

12 testes novos em `packages/measure-engine/test/transicao-indexada.test.ts`, todos
com **3.000 linhas** — `MINIMO_PARA_INDEXAR` é 1.000, e um teste de 10 linhas passaria
verde sem nunca ter exercitado o caminho. Foi assim que o #50 escapou.

Sete deles afirmam que o número **não muda**: texto com caixa diferente, coluna com
BLANK, zero e vazio, data com hora, `DISTINCTCOUNT` por grupo, transição de várias
colunas. Nenhum deles cai se alguém apagar a otimização — e isso é correto, porque a
declaração não é regra: o `keep` decide o resultado sozinho.

A regra 4 pede um teste que caia quando a regra sumir, e a regra aqui não é "o número
é X" — é **"a transição declara a igualdade que ela implica"**. Os cinco últimos
testes afirmam isso direto, sem relógio: um teste de tempo mentiria numa máquina
rápida e falharia numa lenta. Mutação: apagada a linha em `transitionRowContext`,
**exatamente um** teste cai — `a igualdade chega ao filtro que a transição monta`.

`npm test`: **1183 verdes** (1171 do #58 + 12).

### O que sobra em `agendamento-field`

Os 62,6 s restantes estão quase todos em `e2d5549b` (24,5 s) e `084be384` (8,8 s) —
os dois que pioraram. O passo 4 da `DECISAO-DESEMPENHO` (agregar `FIELD AGENDA` ao
grão `(protocolo, slot)` no SQL, 1.458.244 → 30.252 linhas) ataca os dois de uma vez,
e ataca também os 7,8 s de carga. Continua sendo o próximo passo — só não é mais o
primeiro por eliminação, e sim por medida.

---

## #60 — A tabela calculada congelada não tinha guarda de **data**, e a hipótese que ela explicava era falsa

**13/08/2026.** O snapshot tinha 4 das 7 tabelas calculadas congeladas em 11/08, antes
do conserto de fuso do #58. A hipótese era direta e parecia forte: **as 18 divergências
de paridade vêm daí.** Congelei as 7 (`npm run snapshot:calculadas`, 2 h 24 min, das
quais 2 h 23 min só de `Status Protocolo Dia`) e rodei a paridade de novo.

### A hipótese caiu, e o número é pequeno

```
antes: 64 card(s): 16 batem, 18 diferem, 6 divergem, 2 não calcularam
depois: 64 card(s): 16 batem, 18 diferem, 6 divergem, 2 não calcularam
```

**Um único card mudou:** `instalacao-reincidente/Instalados`, de 19.659 para 19.666 —
sete linhas, 0,34% → 0,37% de diferença contra o Power BI. Nada mais se moveu.

As tabelas congeladas velhas custavam **7 linhas em 1 card**, não as 18 divergências.
Sem a segunda medição eu teria passado o dia consertando a coisa errada, e teria
escrito no relatório que consertei.

### Mas o buraco é real, e o número dele cresce sozinho

As 7 linhas não são ruído: são exatamente o que
`'CALENDARIO INSTALADO'[DATA_VIGENTE_INSTALADO]` deixou de contar, porque ela é

```dax
IF('CALENDARIO INSTALADO'[DATA INSTALADO] <= TODAY(), "Sim", "Não")
```

congelada com `TODAY()` = 11/08 — **e é filtro de página** de `instalacao-reincidente`
(`IN ["Sim"]`, 29 visuais). Dois dias de defasagem = 7 protocolos sumidos. Uma semana
= a semana inteira. E some **calado**: o `daxSha` do #47 confere se o DAX mudou, e o
DAX não mudou. Mudou o **dia**.

São duas obsolescências diferentes, e nenhuma das duas tinha guarda:

| | pergunta | quem respondia | agora |
|---|---|---|---|
| DAX | a fórmula é a mesma? | `tabelaSha` (#47) | igual |
| **dado** | as linhas de origem são as mesmas? | **ninguém** | erra alto |
| **relógio** | é o mesmo dia? | **ninguém** | recalcula, e diz |

### Por que uma erra alto e a outra recalcula

**Dado velho erra alto.** Só acontece depois de um `npm run snapshot`, que é ação de
operador; o remédio é o comando que a mensagem traz, e depois de um refresh se ia
rodar de qualquer jeito. O critério é conservador de propósito — compara com a
materialização de query mais recente **do plano**, não com as dependências apuradas do
DAX. Apurar dependência erraria para o lado permissivo se a leitura do DAX falhasse, e
o lado permissivo aqui é servir número velho calado.

**Relógio recalcula.** Errar alto aqui quebraria o relatório **toda meia-noite**, e um
painel que não abre de manhã não é mais correto que um painel errado — é só inútil de
outro jeito. Recalcular é viável porque a regra **não é transitiva**: ela olha só o DAX
*da própria tabela* (corpo e colunas calculadas dela). Nesta base isso dá
`CALENDARIO CRIADO` (9 ms) e `CALENDARIO INSTALADO` (13 ms) — **22 ms**. Puxar a
transitividade para dentro arrastaria `Status Protocolo Dia` por causa de um `NOW()`
que já está materializado dentro de `field-agenda.jsonl`, e o guarda passaria a custar
**2 h 23 min por meia-noite**. A recalculação sai em `Carregado.recalculadas`, vai para
o log da API e para o relatório do `npm run paginas`: recalcular custa tempo e muda o
número, e as duas coisas precisam ser visíveis.

### Três coisas menores, encontradas no caminho, todas do mesmo feitio

1. **`dadoDe` devolvia a materialização mais NOVA.** O comentário do campo prometia a
   mais antiga, `manifesto.maisAntigo` calcula a mais antiga, e `carrega` fazia
   `datas.sort()[datas.length - 1]`. A tela escreve "dado de <isto>" — a promessa é que
   *nada* ali é mais velho que a data mostrada, e o código invertia exatamente essa
   promessa, escondendo a tabela atrasada atrás da mais recente.
2. **O carimbo do cache de resposta não enxergava os `calc.*.jsonl`.** Ele saía só do
   `manifesto.json`, que lista query e nada mais. `npm run snapshot:calculadas`
   reescrevia 3,7 MB de `Status Protocolo Dia` e o cache continuava servindo a resposta
   anterior ao refresh até o TTL vencer.
3. **`Servidor.carregadas` só era limpo em erro.** O comentário dizia "quem refaz é
   `npm run snapshot`, e aí o processo é reiniciado" — verdade até o dia em que o
   aquecimento passa a rodar junto do refresh. Agora as duas camadas usam **o mesmo**
   carimbo, e enxergam a troca no mesmo instante.

### O que trava isso

8 testes novos em `packages/snapshot/test/carrega.test.ts` (congelada antes da origem
erra alto e nomeia o comando; congelada depois é usada; com `TODAY()` em outro dia é
recalculada **e o valor do disco é descartado**; no mesmo dia continua sendo lida), 6
em `tabelas-calculadas.test.ts` (incluindo `NOW()` dentro de literal de texto **não**
contar — sem isso, uma tabela que só *escreve* "NOW()" num rótulo seria recalculada
toda meia-noite) e 2 em `apps/api/test/cache.test.ts`.

---

## #61 — A junção comparava texto com número, e quem a quebrou foi a nossa própria conversão

**13/08/2026.** Dois cards de `instalacao-reincidente` não calculavam — erravam alto,
todo dia, desde que a paridade existe:

```
[ERRO] instalacao-reincidente/1c15b278  Reincidentes
[ERRO] instalacao-reincidente/6bed9d36  % Reincidencia
  Junção 'PROTOCOLOS GERAL'[N°PROTOCOLO] -> 'INSTALAÇÕES REINCIDENTES'[protocolo_instalacao]
  compara texto com número: nunca casa, e o resultado sairia vazio como se fosse filtro.
```

A leitura óbvia é "a camada M está entregando um dos lados no tipo errado". **Ela está
errada.** Os dois lados chegam do disco como texto:

```
snapshot/protocolos-geral.jsonl        {"nome":"n°protocolo","tipo":"string","nulos":0}
snapshot/instalacoes-reincidentes.jsonl {"nome":"protocolo_instalacao","tipo":"string","nulos":0}
```

Quem os separa é o **carregamento**. O PBIP declara `protocolo_instalacao` como
`int64`, e a regra do #40 — "o tipo declarado vence ao materializar" — converte esse
lado para número. O outro se declara `string` e fica texto. A conversão que existe para
consertar agregação (`AVERAGE` sobre o texto `"83205"`) quebra o relacionamento.

### A regra, e por que ela é estreita

**As duas pontas de um relacionamento têm de chegar na mesma espécie.** Quando as duas
chegam do disco iguais e é a *declaração* que as separaria, a conversão é suprimida.
Quando elas já chegam diferentes, nada é suprimido e a junção continua errando alto —
esse guarda é do #58 e não pode ser enfraquecido.

Sobre o modelo real, o critério dispara **exatamente uma vez** entre os 22
relacionamentos:

```
'INSTALAÇÕES REINCIDENTES'[protocolo_instalacao] fica string (declara number):
  a junção com 'PROTOCOLOS GERAL'[N°PROTOCOLO] exige a mesma espécie nos dois lados
```

E ela é **dita**, nunca calada: sai em `Carregado.juncoesPreservadas` e no relatório do
`npm run paginas`, ao lado das conversões que *foram* feitas. Uma conversão suprimida
muda o dado tanto quanto uma aplicada.

### A prova é o gabarito ditado do Power BI

```
antes:  16 batem, 18 diferem, 6 divergem, 2 NÃO CALCULARAM
depois: 18 batem, 18 diferem, 6 divergem, 0 não calcularam

[OK] Reincidentes    PBI=1272    nós=1276              (0,31%)
[OK] % Reincidencia  PBI=0,0649  nós=0,06488355537476  (0,03%)
```

Os dois entram dentro da tolerância de 0,5%, e **nenhum outro card se moveu** — o que é
a metade que importa: uma regra sobre conversão de tipo podia ter mexido em qualquer
lugar, e o diff mostra que não mexeu.

### O que trava isso

4 testes em `packages/snapshot/test/carrega.test.ts`. O central monta o caso reduzido —
duas tabelas, uma declarando `int64` sobre texto, um filtro de página que força a
propagação — e afirma o número **2**; sem a supressão ele erra alto. O contraste está
no teste seguinte: tirado o relacionamento, a mesma coluna volta a ser convertida. Sem
esse par, a supressão poderia estar simplesmente matando a regra do #40 inteira.

---

## #62 — A subida era uma sequência decorada, e dois dos passos prescritos eram no-op

**13/08/2026.** Ter o relatório no ar eram três comandos em três terminais:
`npm run web:build`, `npm run api`, `bash tools/aquece.sh`. Quem pulasse o terceiro
abria a apresentação numa tela branca de ~1 min (`agendamento-field` a frio); quem
pulasse o primeiro servia a tela de ontem sem saber. **Uma sequência que só funciona
quando ninguém erra a ordem não é uma entrega.**

E o terceiro comando era **bash, numa máquina Windows**. `tools/aquece.sh` dependia de
`curl`, `mktemp` e `cut`: ele morria com erro de shell antes de medir coisa alguma.
Estava prescrito no `DEMO-HOJE.md` como "NÃO PULE".

### `npm start`

Um comando: compila a tela, sobe a API com o heap certo, espera a saúde responder,
aquece as 14 páginas uma de cada vez e imprime frio, quente, visuais e erros. Fica no
ar até o Ctrl+C.

Ele **reprova** em três casos — visual com erro, página que não respondeu, e cache que
não pegou — e reprovando **deixa a API no ar**: derrubá-la ali só tiraria de quem está
olhando a chance de abrir a página e ver o que houve.

O terceiro caso é o que o antecessor mais errava em não ter: a segunda abertura é o que
a regra 9 orça em 300 ms, e um `miss` ali quer dizer que o carimbo do snapshot está
mudando sozinho — isso é problema, não lentidão.

12 testes em `tools/subir/test/aquece.test.ts`, com `fetch` injetado. O antecessor não
tinha nenhum, e não por descuido: um script que só se verifica subindo a API inteira
não se verifica — ninguém roda o caminho triste de propósito, então o caminho triste é
o que nunca foi exercitado. Um dos testes afirma que **nunca há dois pedidos ao mesmo
tempo**, que é a armadilha que custou a manhã de 10/08 em outro lugar.

### Os dois no-ops

**`npm run snapshot -- --todas` não rebusca nada.** O mapa `jaTem`
(`tools/snapshot/src/index.ts`) pula toda query que já tem arquivo em disco, a menos
que venha `--refazer`. O `DEMO-HOJE.md` prescrevia, como primeiro passo depois da demo,
exatamente o comando sem `--refazer` — "aplica o conserto do fuso e zera a defasagem"
era literalmente um comando que não fazia nada.

**E faltava o segundo passo.** As 7 tabelas calculadas nascem das de query; refazer as
de query sem refazer as calculadas deixa em disco um congelado velho. Até hoje isso era
servido calado; com o #60 ele erra alto, o que transforma um passo esquecido numa
página que não abre — em vez de um número plausível.

### `npm run snapshot:confere`

O snapshot em disco está servível? Duas perguntas, respondidas lendo só a **primeira
linha** de cada arquivo (milissegundos sobre 1,3 GB): alguma coluna veio inteira nula, e
alguma tabela calculada é mais velha que o dado dela.

A primeira é o sintoma do #54, e ele é calado por construção — `apuraColunas` registra a
coluna como `tipo: 'vazia'` sem reclamar, o carregamento a lê como BLANK, e o visual
mostra vazio como se o filtro estivesse apertado. Rodado hoje sobre a base:

```
23 arquivo(s), 1.860.444 linhas (7 de tabela calculada).
4 erro(s), 5 aviso(s)
```

| coluna | linhas nulas | de mescla? |
|---|---|---|
| `BACKLOG AGENDADO FUTURO[protocolos geral.tipo de protocolo]` | 87.805 | sim |
| `PROTOCOLOS GERAL[técnico 2]` | 33.187 | (de mescla, renomeada) |
| `PROTOCOLOS GERAL[tecnicos auxiliares.auxiliar]` | 33.187 | sim |
| `PROTOCOLOS TELEFONIA[data encerrado]` | 555 | não |

**Erro e aviso são coisas diferentes, e a separação é o ponto.** Erro é coluna que
alguma página ou algum DAX **lê** — hoje elas leem BLANK. Aviso é coluna que ninguém
alcança: chamar isso de falha ensinaria a ignorar falhas, e são 5 delas.

Três das quatro nasceram de `Table.ExpandTableColumn`, e o nome com ponto denuncia. As
chaves das mesclas são:

```
protocolo_id                     -> 'PROTOCOLOS GERAL'[N°PROTOCOLO]
'N°PROTOCOLO'                    -> 'TECNICOS AUXILIARES'[PROTOCOLO:]
{INSTALADO POR:, DATA FINAL}     -> 'GESTORES EQUIPES'{TÉCNICO 1, DATA}
```

Mescla inteira nula é a assinatura de uma junção que **não casou nunca** — é o #61 um
andar abaixo, dentro da camada M, onde não há guarda de espécie nenhum. Consertar exige
rematerializar da fonte e fica para a próxima sessão; o que muda hoje é que deixou de
ser invisível: são 4 linhas de saída, com o arquivo, a contagem e a pista.

11 testes em `packages/snapshot/test/confere.test.ts`.

---

## #63 — Consertar a junção destravou um visual de 40 minutos, e a regra 9 decidiu o que fazer com ele

**13/08/2026, consequência direta do #61.** Com a junção casando,
`instalacao-reincidente` passou de "abre rápido com 2 cards errando alto" para "não
abre". A paridade, que rodava em ~9 min, passou de 50.

O custo estava inteiro em **um** visual:

```
[23/29]  d93e5f33  tableEx   > 40 min (interrompido)
os outros 28 visuais         ~4 s somados
```

`d93e5f33` é a tabela de detalhe de **19 campos** cruzando `INSTALAÇÕES REINCIDENTES`,
`PROTOCOLOS GERAL` e `CALENDARIO INSTALADO`. Ela nunca tinha calculado: atravessa
exatamente o relacionamento que errava alto, então até ontem ela custava 1 ms e um erro.

### A decisão, pela regra 9

> Velocidade acima de fidelidade ao Power BI. Divergir é permitido; divergir em
> silêncio, não.

Trocar "erra alto em 1 s" por "calcula certo em 40 min" **não é progresso** — a página
deixa de abrir, e um painel que não abre não é mais correto, é inútil de outro jeito.

O mecanismo para isso já existia e é do #52: `specs/_catalog/projecao.yaml`, o arquivo
onde uma coluna **usada** fica fora da carga por decisão humana, e todo visual que a
amarra passa a ser **"sob demanda"** — não erro. Foi o caminho decidido para o `Relato`
de `FIELD AGENDA` em 10/08.

Três colunas entram: `dias_para_reincidencia`, `protocolo_manutencao` e
`tecnico_responsavel`. O critério foi conferido, não suposto — nas **14 páginas**, elas
são amarradas por **um único visual** (este), e **nenhuma medida, coluna calculada ou
tabela calculada** as cita. `tipo_instalacao` seria a quarta e ficou de fora: dois
outros visuais a usam como filtro.

### Medido depois

```
página                     ok  erro  s/nº      linhas    carga  cálculo
 instalacao-reincidente     8     0    21      53.598   322 ms  3835 ms

  d93e5f33  tableEx  (sob demanda: 'INSTALAÇÕES REINCIDENTES'[dias_para_reincidencia], …)
```

**De >40 min para 4,2 s**, com os 8 visuais que têm número calculando e zero erros. E
os dois cards do #61 continuam batendo com o Power BI: eles não amarram nenhuma das
três colunas.

### O que isso **não** resolve

O custo não sumiu — mudou de lugar. Quem pedir a tabela de detalhe vai esperar os 40
min. Baixar isso é trabalho de **agregar no grão certo**, como o passo 4 da
`DECISAO-DESEMPENHO`, e não de projeção. Fica registrado como dívida, com número, e é o
primeiro candidato da próxima sessão junto com as 4 colunas nulas do #62.

### E o teto que impede a subida de travar

`npm start` aquece com **teto de 180 s por página** (`--limite=`): uma página cara vira
uma linha `passou de 180s — investigue esta página`, e não um cursor parado sem uma
palavra sobre o que está acontecendo. O teto **não** torna a página barata — abortar o
pedido não para o cálculo do outro lado —, ele serve para **dizer qual é**.



## #64 — Três mesclagens da camada M não casavam **nenhuma** linha, e o motor não tinha como dizer isso

**13/08/2026.** O `npm run snapshot:confere` do #62 apontava 4 colunas inteiras nulas
que alguma página lê. Duas delas tinham ponto no nome — a assinatura de expansão de
mescla. Esta entrada é a investigação delas.

O #61 já tinha consertado uma junção texto×número, mas **no relacionamento DAX**. Estas
são uma camada antes, no `Table.NestedJoin` do Power Query, e ninguém tinha olhado ali
porque **a camada M não tinha onde falar**: uma mescla que não casa nada devolve a
tabela aninhada vazia, o `Table.ExpandTableColumn` a expande para nulo, e o resultado é
uma coluna com 87.805 nulos e nenhuma mensagem. O defeito só apareceu semanas depois,
como um card em branco.

### O que a medição mostrou

```
Table.NestedJoin 'protocolo_id' × 'N°PROTOCOLO'        (backlog-agendado-futuro)
  0 de 88.143 casam por espécie · 60.425 (68,6%) casariam como inteiro

Table.NestedJoin 'N°PROTOCOLO' × 'PROTOCOLO:'          (protocolos-geral)
  0 de 33.459 casam por espécie · 25.707 (76,8%) casariam como inteiro

Table.NestedJoin 'INSTALADO POR:' + 'DATA FINAL' × 'TÉCNICO 1' + 'DATA'  (protocolos-geral)
  0 de 25.472 casam · as chaves NÃO são texto×número — sem reconciliação provável
```

As duas primeiras são o mesmo erro escrito duas vezes: um lado declara
`{"protocolo_id", Int64.Type}` (ou `{"PROTOCOLO:", Int64.Type}`) e o outro deixa
`N°PROTOCOLO` como texto, porque `ai.protocol` vem do Voalle como `varchar` e nenhum
passo o converte. O Power Query compara chave por espécie, então **o Power BI mostra
essas colunas em branco também**. Não é divergência nossa: é um defeito que herdamos
fielmente.

### A regra que entrou, e a que **não** entrou

O caminho óbvio — comparar como inteiro quando as espécies diferem — foi escrito,
testado, e **descartado**. O teste que o derrubou já existia desde a primeira versão do
avaliador:

> `a chave de junção distingue tipo: número 1 não casa com texto "1"` — *"se casasse,
> uma junção por código de equipe passaria a casar coisa errada dependendo de a fonte
> devolver o campo como texto ou como inteiro."*

Ele está certo. Reconciliar por conta própria troca uma junção **morta** por uma
**viva e possivelmente errada**: dois espaços de identificador que por acaso sejam
inteiros pequenos passam a casar, e sai um número plausível — o único erro que este
projeto não pode cometer. Uma junção morta é escandalosa; uma junção errada é
invisível.

Então o motor ficou com **duas responsabilidades e nenhuma decisão**:

1. **Detectar e falar.** Zero linhas casadas com as duas pontas cheias não é um
   resultado, é um sintoma. Toda mesclagem nessa situação emite uma nota, e a nota traz
   o número que permite decidir: quantas casariam como inteiro, e em que percentual.
2. **Obedecer, se alguém decidir.** `specs/_catalog/juncoes.yaml` — arquivo humano, no
   molde de `divergencias.yaml` e `projecao.yaml`. Cada entrada declara a query, as duas
   listas de chave **na ordem**, o número medido, a data, quem decidiu e por quê. Falta
   qualquer um deles e o carregador erra alto: reconciliação sem o número que a
   justificou é remendo, não decisão.

O padrão do avaliador é **não** reconciliar. Quem não injeta nada não ganha o conserto.

### Dois detalhes que a implementação obrigou a acertar

**`null` casa com `null` em M, e isso mascarava a morte.** Uma mescla com duas linhas
de chave nula dos dois lados casaria "duas linhas" e escaparia do diagnóstico enquanto
as outras 87.803 saíam nulas. O contador de "esta junção está viva?" passou a olhar só
**linhas de chave completa**. O resultado da junção não mudou — só o diagnóstico.

**A comparação frouxa é estreita de propósito.** Só inteiro: `"007"` casa com `7` e
`" 8 "` com `8`, mas `9.5` não é identificador e `"10x"` não é inteiro. Data em texto
**não** entra — `"01/02"` depende da culture, e adivinhar ali é o achado #1. Em chave
composta, só a posição texto×número afrouxa; as outras continuam comparadas por
espécie.

### O risco que quase passou, e a medição que o fechou

`Table.ExpandTableColumn` **multiplica linha** quando a tabela aninhada tem mais de uma.
Enquanto a junção estava morta, toda aninhada tinha zero linhas e a expansão era 1:1.
Ligá-la podia mudar a contagem de linhas de `PROTOCOLOS GERAL` — e aí **toda** medida
sobre aquela tabela, não só a coluna em branco. Um protocolo com dois auxiliares faria
exatamente isso.

Medido antes de aplicar, numa saída separada:

```
                          linhas antes  linhas depois  SOLICITACAO distintas
backlog-agendado-futuro         88.143         88.143  —
protocolos-geral                33.459         33.462             33.462
```

Nenhuma linha multiplicada — `33.462` linhas para `33.462` SOLICITACAO distintas. O
`Table.Distinct` por SOLICITACAO vem antes da mescla e, no dado de hoje, cada protocolo
casa com um auxiliar só. **É a propriedade a reconferir se a decisão for revista**, e
está escrita no `porque:` da entrada.

### O resultado

```
'BACKLOG AGENDADO FUTURO'[PROTOCOLOS GERAL.TIPO DE PROTOCOLO]   0 → 60.425 não nulas
'PROTOCOLOS GERAL'[TECNICOS AUXILIARES.AUXILIAR]                0 → 25.707 não nulas
```

`npm run snapshot:confere` caiu de 4 erros para 2.

### A terceira, que continua morta

`{INSTALADO POR:, DATA FINAL} × {TÉCNICO 1, DATA}`, contra `GESTORES EQUIPES`. É a
origem de `'PROTOCOLOS GERAL'[TÉCNICO 2]` e `[GERENTE/SUPERVISOR]` inteiras nulas, e
`visao-geral` lê `TÉCNICO 2` — inclusive como filtro `not_in [null]`, que sobre uma
coluna 100% nula descarta **toda** linha. As chaves não são texto×número (nome × nome,
data × data), então este mecanismo não tem o que dizer sobre ela e o motor não inventa:
a nota diz "sem reconciliação provável, confira as duas pontas". Fica registrada como a
próxima a investigar, com o número (`0 de 25.472` contra `5.619` do outro lado).

### O que o teste de mutação pega

Apague a checagem de `ctx.reconcilia` e cai *"sem decisão registrada, a junção morta
continua morta"*. Apague a nota e cai *"texto×número sem decisão: a nota traz o número
que decidiria"*. Aceite `esquerda: []` como campo declarado e cai *"lista de chaves
vazia conta como ausente"* — essa é a traiçoeira, porque uma lista vazia liberaria a
reconciliação de **qualquer** mesclagem daquela query.

---

## #65 — O `TMA` da telefonia mede contra hoje, e a causa é um `"Finalizado"` comparado com `"FINALIZADO"`

**13/08/2026, achado ao investigar a quarta coluna nula do #62.**
`'PROTOCOLOS TELEFONIA'[DATA ENCERRADO]` é 100% nula nas 562 linhas, e não é junção:
não saiu nota nenhuma da camada M. É a expressão que a cria.

```m
#"Personalização Adicionada" = Table.AddColumn(…, "SITUAÇÃO", each
    if [STATUS] = "Encerrado" and … then "Finalizado"
    else if …                      then "Finalizado Pendência Financeira"
    else "Pendente")

//if [STATUS] = "Encerrado" and [TÍTULO RECEBÍVEL] <> null then "FINALIZADO" else "PENDENTE")
                                                               ↑ a versão anterior, comentada logo abaixo

#"Personalização Adicionada1" = Table.AddColumn(…, "PERSONALIZAÇÃO", each
    if [SITUAÇÃO] = "FINALIZADO" then [DATA MODIFICADO]-[DATA CRIADO]
    else [DATA HOJE] - [DATA CRIADO]),
#"Dias Inseridos" = … Duration.Days([PERSONALIZAÇÃO]) …  → renomeada para "TMA"

#"Personalização Adicionada2" = Table.AddColumn(…, "DATA ENCERRADO", each
    if [SITUAÇÃO] = "FINALIZADO" then [DATA MODIFICADO] else null),
```

`SITUAÇÃO` recebe `"Finalizado"`. As duas comparações abaixo testam `"FINALIZADO"`. Em
M, comparação de texto é **sensível a maiúscula**, então as duas são **sempre falsas**.
A linha comentada logo abaixo do primeiro passo mostra o que houve: a versão anterior
escrevia `"FINALIZADO"` em caixa alta; quando o valor virou `"Finalizado"`, as duas
comparações lá embaixo ficaram para trás.

Duas consequências, e a segunda é a que importa:

- **`DATA ENCERRADO` é sempre nula** — a coluna aparece vazia num visual de detalhe de
  `telefonia-ouvidoria`.
- **`TMA` mede sempre contra `DATA HOJE`**, nunca contra a data de encerramento. Ou
  seja: o tempo de atendimento de um protocolo **já encerrado** continua crescendo todo
  dia. Quanto mais antigo o protocolo, mais errado o número — e ele está no mesmo
  visual, ao lado da coluna vazia.

**Isto não é divergência nossa.** O Power Query compara texto do mesmo jeito, então o
Power BI mostra exatamente os mesmos valores. É um defeito do relatório que a plataforma
reproduz com fidelidade — e que só ficou visível porque `snapshot:confere` reclamou da
coluna nula.

**Não foi corrigido aqui, de propósito.** O conserto é trocar `"FINALIZADO"` por
`"Finalizado"` em dois lugares do PBIP — trinta segundos no Power BI, e
`npm run extract` traz a correção. Criar um quarto mecanismo de override na camada M
para um erro de digitação seria construir uma peça permanente para um problema que tem
conserto na origem. E o PBIP é read-only para esta plataforma (regra 1).

Está em `docs/PERGUNTAS-NEGOCIO.md` como **#8**, com o número: 562 linhas, 100% da
coluna, e um `TMA` que erra proporcionalmente à idade do protocolo.

## #66 — Congelar `Status Protocolo Dia` leva **14 h 28 min**, e 12 h 50 min é uma coluna só

> **CORRIGIDO PELO #67.** O número (14 h 28 min) está certo; a leitura dele estava
> errada. Não existe coluna 120× mais cara e não é distorção de dado — a mesma coluna
> custa 9,2 ms/linha sozinha e 52,4 rodando em quarto lugar. A causa é o processo
> compartilhado, e a conta é 38×. Leia o #67; o que fica de pé aqui é a medição bruta e
> o argumento de por que isso é bloqueio de operação.

**13→14/08/2026, medido por acidente.** Rematerializar `protocolos-geral` para o #64
deixou as 7 tabelas calculadas obsoletas, e a guarda de idade do #60 mandou regenerá-las.
Seis levaram **7 segundos somados**. A sétima levou o resto da noite.

```
BASE DE ORIGEM, calendar, CALENDARIO AGENDAMENTO/CRIADO/INSTALADO, PROTOCOLOS
  → prontas 13/08 17:54:52   (7 s somados)

Status Protocolo Dia
  [Base Dia]                     383.137 ms   ·  6 min 23
  [Turno Dia]                  2.733.054 ms   · 45 min 33
  [Rank Protocolo Dia]         2.746.957 ms   · 45 min 47
  [Tipo Protocolo Dia]        46.202.829 ms   · 12 h 50 min
  30.404 linhas, 7 colunas     52.069.946 ms  · 14 h 28 min
  → pronta 14/08 08:22:42
```

O tempo de cada coluna é **por coluna**, não acumulado (`tc = Date.now()` está dentro
do laço), e o relógio de parede confirma: 17:54:52 → 08:22:42.

### A forma do custo

As quatro colunas calculadas são **a mesma expressão**, mudando só o que agregam:

```dax
CALCULATE (
    MAX ( 'FIELD AGENDA'[<coluna>] ),
    FILTER (
        'FIELD AGENDA',
        'FIELD AGENDA'[protocolo] = ProtocoloAtual
            && TRUNC ( 'FIELD AGENDA'[Slot Agenda] ) = DiaAtual
    )
)
```

30.404 linhas × 1.466.202 linhas de `FIELD AGENDA` = **44,6 bilhões** de avaliações de
linha, quatro vezes. E a tabela pai (`table_dax`) faz o mesmo padrão outra vez, contra
`PROTOCOLOS GERAL`.

### O que **não** explica o 120× entre colunas idênticas

`[Base Dia]` custa 383 s e `[Tipo Protocolo Dia]` custa 46.203 s com **a mesma
estrutura**. As hipóteses baratas foram descartadas, cada uma com a conferência:

| hipótese | conferido | veredito |
|---|---|---|
| a coluna agregada é calculada e recomputa 44,6 bi de vezes | `Turno` e `RankDataProtocolo` **são** calculadas e custam 2,7 ks; `Base` e `Tipo de Protocolo` **não são** e custam 383 s e 46 ks | ❌ o padrão é o inverso |
| `Tipo de Protocolo` está `sob_demanda` e cai num caminho lento | `specs/_catalog/projecao.yaml` só lista `Relato` | ❌ |
| `MAX` sobre texto usa comparação com locale | não há `localeCompare` nem `Intl.Collator` em `measure-engine` nem `widget-engine` | ❌ |
| tempo acumulado, não por coluna | `tc` é reatribuído dentro do laço | ❌ |

**Fica sem causa provada, de propósito.** A diferença de 120× entre duas expressões
idênticas é a pista, e ela não se resolve lendo código: precisa de uma execução
instrumentada, e o ciclo dela é de 14 horas. Chutar aqui seria exatamente o que a regra
8 proíbe — e o #46 já ensinou o preço: cada hipótese testada sem número custou uma hora.

### Por que isso é bloqueio, e não só lentidão

A regra 9 diz que **refresh não tem teto**. Ela pressupõe que o refresh caiba numa
janela: 14 h 28 min não cabe em nada. E o gatilho não é raro — é **toda** vez que
`field-agenda`, `protocolos-geral` ou qualquer origem desta tabela é rematerializada,
porque a guarda do #60 (corretamente) recusa a versão velha.

Ou seja: hoje o snapshot não pode ser atualizado num dia de trabalho. **É o maior número
aberto do projeto**, na frente das divergências de paridade.

### O caminho que a medição sugere

O passo 4 da `DECISAO-DESEMPENHO` — agregar `FIELD AGENDA` ao grão
`(protocolo, slot agenda)`, 1.458.244 linhas → 30.252 — é exatamente o grão que estas
quatro colunas procuram linha por linha. Feita a agregação no SQL, o `FILTER` deixa de
varrer 1,46 milhão de linhas e passa a procurar numa tabela do tamanho do resultado.
O Erick já havia apontado o SQL como lugar certo, e este número é o argumento que
faltava: não é economia de memória, é a diferença entre poder e não poder atualizar.

Antes disso, porém, vale o mais barato: **descobrir o 120×**. Se as quatro colunas
deveriam custar 383 s cada, o congelamento inteiro cai de 14 h 28 para ~26 min sem
mexer em SQL nenhum.

## #67 — As 14 h 28 min do #66 eram **um processo compartilhado**, não uma coluna ruim: 38×

> **CONSERTADO no #68**, e o numero saiu melhor que a projecao: 14 h 28 min -> 26 min 14 s,
> com o arquivo IDENTICO byte a byte. As quatro colunas passaram a custar a mesma coisa.

**14/08/2026.** O #66 registrou o número e deixou a causa aberta de propósito, porque
testar hipótese custava um ciclo de 14 horas. A saída não foi arriscar um palpite: foi
construir o instrumento que tira o ciclo de 14 horas do caminho —
`snapshot:calculadas --amostra=N --pular=N --coluna=`. Com ele, cada hipótese passou a
custar minutos, e **duas afirmações do #66 caíram**.

### Medido

**1. Não existe coluna 120× mais cara.** A mesma expressão, na mesma tabela:

```
[Tipo Protocolo Dia], sozinha, processo limpo
   3.200 linhas     9,1 ms/linha
  12.800 linhas     9,2 ms/linha
  30.404 linhas    11,2 ms/linha   → 5 min 41 s para a TABELA INTEIRA
```

Linear até o fim, e é o número que fecha o caso: a mesma coluna que a execução real de
13/08 levou **12 h 50 min** para calcular faz as mesmas 30.404 linhas em **5 min 41 s**
quando é a única coisa que o processo está fazendo. **135×.**

**2. Não é distorção de dado.** Faixas de 400 linhas em três pontos da tabela:

```
  linhas      0–   400   14,6 ms/linha
  linhas 14.000–14.400   16,0 ms/linha
  linhas 28.800–29.200   14,3 ms/linha
```

O `--pular=` existe por causa disto: amostra é sempre prefixo, e prefixo não distingue
"custo que cresce" de "dado que fica mais caro no fim".

**3. O que importa é a ordem.** As quatro colunas, 12.800 linhas, cada uma medida
sozinha num processo limpo e depois em sequência num processo só:

| coluna | sozinha | em sequência | penalidade |
|---|---|---|---|
| `[Base Dia]` (1ª) | 12,5 ms/linha | 13,1 | 1,0× |
| `[Turno Dia]` (2ª) | 11,6 | 57,6 | **5,0×** |
| `[Rank Protocolo Dia]` (3ª) | 10,9 | 56,2 | **5,2×** |
| `[Tipo Protocolo Dia]` (4ª) | 9,2 | 52,4 | **5,7×** |

Sozinhas elas custam **a mesma coisa** — 9 a 12 ms/linha. Juntas, a primeira continua
barata e **todas as outras ficam 5× mais caras**. É **degrau, não rampa**: o salto
acontece na segunda coluna e depois estabiliza.

E é o que a execução real dizia sem que ninguém lesse: 383 → 2.733 → 2.747 → 46.203 s,
**monotônico na ordem de execução**. A "coluna de 12 h 50" era simplesmente a última da
fila.

### A conta

```
isolada por coluna, projetada para as 30.404 linhas
  [Base Dia]            381 s
  [Turno Dia]           353 s
  [Rank Protocolo Dia]  330 s
  [Tipo Protocolo Dia]  279 s
  + 4 cargas de snapshot (~16 s cada)
  ------------------------------------
  ~24 min   (e a de 30.404 linhas medida de verdade: 5 min 41 s)

compartilhando um processo (medido, 13→14/08)
  14 h 28 min
```

**36×.** E a penalidade **cresce com a escala**: em 12.800 linhas ela é 4,1× (somando
ms/linha), na execução inteira é 38×. Ou seja, o efeito não é um custo fixo por coluna —
ele compõe com o tamanho da tabela, o que é coerente com pressão de memória (o processo
real chegou perto do teto de 8 GB) e não com uma constante de código.

### A causa provável, e o que ainda não está provado

As quatro colunas varrem `FIELD AGENDA` (1.466.202 linhas), e `columnValue` **memoiza na
própria linha**. `Turno` e `RankDataProtocolo` são colunas calculadas *de `FIELD AGENDA`*,
então calculá-las escreve campo novo em mais de um milhão de objetos. Suspeita: as linhas
degradam de forma (V8 sai da hidden class e vai para modo dicionário), e daí em diante
**toda** leitura de propriedade nelas fica mais lenta — inclusive a de
`[Tipo Protocolo Dia]`, que só lê uma coluna física.

Encaixa com o degrau na segunda coluna e com a penalidade compondo com a escala. **Mas
não está provado**, e não precisa estar para consertar: o remédio é o mesmo para qualquer
estado acumulado no processo.

### O conserto, e o perigo dele

`npm run snapshot` já resolve isto por query, com `spawn` por id. O equivalente aqui é
**um processo por coluna calculada** — e ele tem um perigo que o caso da query não tem:
lá cada processo escreve **um arquivo inteiro**; aqui os quatro têm de acabar **no mesmo
arquivo**, e juntar resultados de processos diferentes por posição supõe que a ordem das
linhas é idêntica nos dois. Se não for, o arquivo sai **plausível e errado** — o único
resultado que este projeto não aceita.

O desenho, então, tem de carregar a garantia junto, no molde dos outros guardas
(`daxSha`, `tabelaSha`, `original_sha`):

- o **primeiro** filho grava as colunas físicas mais a sua calculada;
- cada filho grava também um **`chaveSha`**: o `sha256` dos valores das colunas físicas,
  na ordem das linhas;
- o pai só junta por posição depois de conferir que **todos** os `chaveSha` são iguais.
  Diferente = erra alto, e não junta nada;
- o pai fica leve (só orquestra e junta), e cada filho é o único processo pesado da vez —
  que é a regra desta máquina.

Enquanto isso não existir, quem precisar recongelar `Status Protocolo Dia` tem o
paliativo medido: rodar **uma coluna por vez** com
`--coluna=` (e, hoje, sem gravar), ou aceitar as 14 h 28 min.

## #68 — Um processo por coluna: 14 h 28 min viraram 26 min, com o arquivo idêntico

**14/08/2026, o conserto do #67.** Medido, e o número é o do arquivo, não de projeção:

```
Status Protocolo Dia, as 30.404 linhas

  ontem, um processo para as quatro colunas
    [Base Dia]              383.137 ms
    [Turno Dia]           2.733.054 ms
    [Rank Protocolo Dia]  2.746.957 ms
    [Tipo Protocolo Dia] 46.202.829 ms
                        -------------
                         52.069.946 ms   14 h 28 min

  hoje, um processo por coluna
    [Base Dia]              400.546 ms
    [Turno Dia]             386.188 ms
    [Rank Protocolo Dia]    388.700 ms
    [Tipo Protocolo Dia]    398.329 ms
                        -------------
                          1.574.292 ms   26 min 14 s
```

**33×.** E as quatro colunas passaram a custar **a mesma coisa** — 386 a 400 s, incluindo
a carga de snapshot de cada filho —, que é a confirmação final do #67: nunca houve coluna
cara, havia processo cansado.

### O arquivo é o mesmo, e isso foi conferido

```
linhas                     30.404 = 30.404
colunas e tipos            iguais (7 colunas, mesma ordem, mesmos tipos)
tabelaSha                  igual
nulos por coluna           0 em todas, nos dois
linhas de dados diferentes 0 de 30.404
```

Byte a byte. Não é "provavelmente equivalente": é o mesmo arquivo, em 1/33 do tempo.

### O guarda, que é a parte que não podia estar errada

As quatro colunas caem no **mesmo** arquivo e são juntadas **por posição**. Se dois
processos produzirem as linhas em ordens diferentes, o valor de uma linha entra em outra —
plausível e errado, o único resultado que este projeto não aceita.

`shaDasChaves(linhas, colunas)` é a identidade da ordem das linhas pelas colunas físicas.
Cada filho grava um parcial; o pai calcula o sha de cada um e **só junta se todos
baterem**. Divergência = erro alto, e nada é gravado. Oito testes provam que ele discorda
quando deve: linha trocada de posição, linha a mais, linha a menos, valor diferente,
número `1` contra texto `"1"`, `null` contra `""` — e que sobrevive a gravar e ler, que é
como os processos se comparam.

**Os parciais são snapshots de verdade**, escritos com `escreve` e lidos com `le`. Um
formato próprio de troca entre processos teria de reimplementar a codificação, e os
valores incluem `Date`: na primeira divergência uma data viraria texto e o cabeçalho final
diria `"tipo":"string"` sem ninguém notar.

### O limiar, e por que ele existe

Isolar custa uma carga de snapshot por coluna (~16 s). As outras **seis** tabelas
calculadas congelam em **7 segundos somados** — para elas, isolar seria trocar 7 s por 2
minutos. Então o automático só vale de **5.000 linhas** para cima, e com 2+ colunas
calculadas. `--isolar` e `--sem-isolar` mandam mais que o limiar.

O número é um proxy honesto: o que encarece é varrer tabela grande, não ter muitas linhas.
Mas é o proxy que a medição sustenta, e ele está no código com essa ressalva escrita.

### O que o teste pegou, e por que ele existia

O primeiro ensaio do modo isolado — feito de propósito numa tabela **pequena**
(`CALENDARIO INSTALADO`, 364 linhas, 4 colunas calculadas, ~70 s) — falhou de duas
formas, e a primeira era grave: **o filho gravou no arquivo final em vez do parcial**,
deixando a tabela com 2 colunas em vez de 5. Ou seja: produziu exatamente o arquivo
plausível-e-errado que este achado passa o tempo dizendo que não pode existir. Havia
backup, e o arquivo foi restaurado.

Duas lições que valem mais que o conserto:

- **Ensaie o caminho novo na tabela barata.** O mesmo bug descoberto em
  `Status Protocolo Dia` custaria 26 minutos por tentativa em vez de 70 segundos, e teria
  ficado escondido atrás da espera.
- **Copie o arquivo antes.** O modo novo sobrescreve o congelado, e "regerar" não é
  desfazer: sem o backup, restaurar `CALENDARIO INSTALADO` teria exigido recalcular.

Depois do conserto, a mesma tabela pequena saiu com cabeçalho, tipos e `tabelaSha`
idênticos, e **361 das 364 linhas** iguais. As 3 que mudaram são só nas duas colunas com
`TODAY()`, nas linhas da virada do dia — relógio, não junção. É o comportamento que o #60
já tinha desenhado.

### O que isto destrava

O #66 dizia que **o snapshot não podia ser atualizado num dia de trabalho**. Agora pode:
o congelamento das 7 tabelas calculadas passa de 14 h 28 min para **~26 min**, e a
materialização das queries é minutos. O refresh inteiro cabe numa janela noturna com
folga — e cabe até no meio da tarde.

Com isso, a fila volta a ser a paridade, que é onde ela estava antes do #66.

---

## #69 — O painel recalculava 36 s **uma vez por minuto**, e o TTL de 60 s era a causa

**17/08/2026.** A queixa era "o backend demora a carregar". A medição desmontou a
hipótese óbvia — não era lentidão de cálculo, era cache jogado fora enquanto ainda
valia.

O primeiro número já apontava para o lugar errado do costume:

```
página              1ª chamada   2ª chamada
capa                    0,07 s      0,006 s
visao-geral            36,1  s      0,022 s
relatorio-do-mes        8,3  s      0,004 s
```

A API estava no ar desde a véspera, **ninguém tinha reiniciado nada e o disco não
tinha mudado uma linha**. Mesmo assim `visao-geral` custou 36 s. O que tinha
acontecido entre a última visita e aquela era só uma coisa: o relógio.

### A causa

`ttlDaPagina` devolvia o **menor TTL entre as queries da página** — 60 s para o
operacional quente, de `cache-policies.yaml`. A cada minuto a resposta pronta era
descartada e o próximo visitante pagava o recálculo inteiro. O dia todo.

Aqueles 60 s nunca foram sobre esta camada. Eles foram decididos para o cache do
**Query Engine**, onde o TTL segura o quanto se vai ao ERP — e lá continuam valendo.
Este outro cache guarda a resposta calculada sobre o `snapshot/` **em disco**, que não
muda sozinho: quem o troca é `npm run snapshot`. Esperar 60 s não traz dado novo
porque não há de onde vir. O número vazou de uma camada para a outra e ninguém tinha
motivo para notar, porque o efeito era lentidão — não erro.

### O que substituiu o TTL, e por que ele já estava lá

A chave da resposta já carregava o `carimbo` do snapshot. Isso é *melhor* que TTL nos
dois sentidos: invalida no **instante** do refresh, e não tem a janela em que o TTL
ainda não venceu e o dado já é outro. O TTL virou prazo de **guarda** (7 dias), só
para entrada morta não ficar guardada para sempre.

### A correção que tinha de vir antes, e que quase não veio

Esticar o TTL sozinho teria trocado uma lentidão diária por um **número errado**
diário. A chave tinha `carimbo` mas não tinha o **dia**, e 32 expressões chamam
`TODAY()`. O TTL de 60 s escondia isso por acidente: apagava a entrada muito antes de
a meia-noite chegar. Ou seja, o cache estava certo **por acidente**, e o acidente
custava 36 s por minuto para evitar um erro uma vez por dia.

O dia entrou na chave, em **UTC** — porque `TODAY()` é `getUTCFullYear/Month/Date`.
Com o dia local, a chave viraria à meia-noite de Brasília e o `TODAY()` só três horas
depois; nessa janela a página serviria o dia novo com o número do dia velho.

E o dia teve de entrar **também** no mapa de avaliadores (`Servidor.carregadas`),
que era chaveado só pelo carimbo. O avaliador congela o `now` que recebeu ao carregar.
Sem essa segunda metade, o estrago ficaria **pior** depois da primeira: a chave nova
daria miss (certo), o recálculo pegaria o avaliador de ontem (errado), e o `TODAY()`
de ontem seria gravado sob a chave de hoje — o cache carimbando o erro em vez de
expô-lo. As duas camadas agora medem `identidadeDoCalculo(carimbo, dia)`, uma função
só.

### Uma otimização tentada e revertida (0,4 ms não compra desatualização silenciosa)

A decomposição do caminho quente mostrou onde vão os milissegundos de um acerto:

```
carimboAtual()                    0,57 ms   ← I/O de disco, todo pedido
  leManifesto (ler + JSON.parse)    0,41 ms
  carimboDasCalculadas              0,13 ms
JSON.stringify de 96 KB           0,56 ms
chave + dia                       0,002 ms
```

O `carimboAtual` é o maior custo fixo, e memoizá-lo atrás de um `stat` (mtime +
tamanho) parecia livre. Não é, e o teste pegou antes de o código sair do diretório:

- o **tamanho** não separa duas versões do manifesto — `geradoEm` tem largura fixa,
  então trocar 11h por 18h não muda um byte;
- o **mtime** desta máquina tem granularidade medida de **~2,45 ms** (4.000 escritas
  produziram 265 carimbos de tempo distintos), e duas reescritas cabem dentro dela.

O memo devolveria o carimbo velho e a tela mostraria o número anterior ao refresh, sem
nada dizendo que era o anterior. Revertido, com o aviso no código e um teste que
prende a metade determinística (a do tamanho). A metade do mtime **não** virou
asserção de propósito: seria afirmar o resultado de uma corrida, e teste instável é
pior que teste nenhum.

### O reaquecimento, que é o que faltava para "sempre pronto"

Consertar o TTL tira o recálculo de 36 s **por minuto**, mas não tira o **primeiro** de
cada ciclo: depois de um refresh ou de um restart, a conta ainda cai em quem abrir a
página primeiro. `apps/api/src/aquecedor.ts` passa essa conta para o servidor —
aquece no arranque e sempre que a identidade muda (dado **ou** dia).

Duas decisões dele que não são óbvias:

- **Por HTTP contra si mesmo**, e não chamando o cálculo por dentro. O cache é
  endereçado pela chave exata do pedido; reaquecer por um caminho paralelo encheria
  chaves *parecidas* e o acerto nunca aconteceria.
- **Relógio aqui é legítimo, e no caminho da resposta não.** Este laço não decide o
  que responder, só quando adiantar trabalho: chegar atrasado não produz número
  errado, produz um visitante que pagou o que o laço ia pagar por ele. Por isso o
  carimbo continua sendo recalculado a cada pedido, exato, e a vigilância é a cada 5 s.

### O estado depois

`REDIS_URL` não existe na `.env` (só `REDIS_KEY_PREFIX`), então o adapter é o de
memória e o cache morre no restart — o que o reaquecimento de arranque agora cobre. O
código do Redis já está pronto e entra sozinho no dia em que a URL aparecer.

### Ligar o Redis teria deixado a API **mais lenta** (e isso quase passou)

`index.ts` escolhia o adapter de forma **exclusiva**: `RedisCache` **no lugar do**
`MemoryCache` quando `REDIS_URL` existisse. Como a `.env` só tem `REDIS_KEY_PREFIX` e
nunca teve a URL, esse caminho jamais rodou — e no dia em que rodasse, cada acerto
passaria a pagar ida e volta de rede mais `JSON.parse` de até 172 KB no lugar de uma
leitura de `Map`. Uma peça de infraestrutura que piora o número que deveria melhorar é
pior que a ausência dela, porque ninguém vai procurar ali.

As duas camadas resolvem coisas diferentes e agora são duas
(`packages/query-engine/src/cache-camadas.ts`): a **memória** dá a latência (o acerto
não sai do processo), o **Redis** dá a permanência (sobrevive ao restart, é
compartilhado entre processos). Escreve nas duas, lê da rápida primeiro, promove o que
achar na durável. Redis fora do ar vira miss e nunca exceção.

### Um defeito meu, achado porque o `npm start` foi rodado de verdade

Com a API se aquecendo sozinha, `npm start` não pode disparar o aquecimento dele por
cima — seriam dois calculando as mesmas páginas num processo só. A espera foi escrita
e, na primeira execução real, **não esperou**: o relatório saiu com
`diario-instalacao` a 4,13 s numa rodada que deveria ser toda de acertos, e o
`[aquecedor] 14 páginas quentes em 194,8s` apareceu **depois** de metade da tabela.

A causa era uma linha:

```ts
const s = await saude();
if (s === null) return;   // ← trata falha transitória como "a API sumiu"
```

Falhar ali é **esperado**: enquanto a API calcula `agendamento-field`, o laço de
eventos dela fica travado por dezenas de segundos e um socket de keep-alive
reaproveitado cai nesse intervalo. `npm start` saiu da espera com o aquecedor na **2ª
de 14** páginas.

Agora são 15 falhas **seguidas** para desistir (~15 s sem nenhuma resposta), o
contador zera a cada resposta boa, e a espera devolve um veredito
(`ausente` / `pronto` / `sem-resposta` / `estourou`) em vez de `void` — quem chama
precisa poder dizer por que parou de esperar. Extraída para
`tools/subir/src/aquecimento.ts`, com 9 testes, porque inline em `index.ts` ela era
intestável e foi exatamente aí que o defeito se escondeu.

**A lição operacional:** o defeito não apareceu em teste nenhum, apareceu em rodar o
comando de verdade e **ler a tabela**. Os tempos na coluna "a frio" não faziam sentido
para uma rodada que deveria ser toda quente, e era só isso que denunciava.

---

## #70 — Trocar de página estava rápido; **paginar uma tabela** custava até 8 s, e o cálculo já tinha sido feito

**17/08/2026.** Depois do #69 o Erick disse: *"quando clico para ir para próxima
página isso demora bastante em toda aplicação"*. O #69 tinha acabado de medir a troca
de página do menu em milissegundos, então a primeira coisa foi **não acreditar em
nenhuma das duas versões** e medir o caminho inteiro, do clique ao pixel.

### O que foi medido, e com o quê

A API respondendo é fácil de medir com `curl`. O que faltava era o pedaço entre a
resposta e a tela — e para isso subiu um Chrome de verdade (headless, via CDP sobre
o `WebSocket` embutido do Node 24, sem dependência nova), instrumentado com um
`MutationObserver` na área de conteúdo. Cada clique no menu foi decomposto em
**clique → resposta** e **resposta → DOM parado**:

| página | rede | render | total | nós no DOM |
|---|---:|---:|---:|---:|
| AGENDAMENTO FIELD | 13 ms | 14 ms | **27 ms** | 9.034 |
| DIÁRIO INSTALAÇÃO | 5 ms | 22 ms | **27 ms** | 18.233 |
| VISÃO GERAL | 8 ms | 5 ms | **13 ms** | 5.029 |
| CAPA | 8 ms | 1 ms | **9 ms** | 19 |

As 14 páginas ficaram entre 5 ms e 27 ms. **A navegação do menu não era o problema**,
e insistir nela teria consumido o dia inteiro.

### Onde o tempo estava

O clique que custa não é o do menu — é o **"próxima" de uma tabela**. Ele pede
`?visual=X&de=200`, que é uma chave de resposta diferente da que o aquecimento
encheu, e cai no caminho frio:

| ação | 1ª vez | repetida |
|---|---:|---:|
| `protocolos-detalhados`, janela 100→200 | **2,90 s** | 2 ms |
| `protocolos-detalhados`, janela 200→300 | **7,99 s** | — |
| `visao-geral`, tabela de 33.462 linhas | **1,28 s** | 14 ms |
| aplicar um filtro em `relatorio-do-mes` | **3,35 s** | 15 ms |
| abrir uma segmentação (`/valores`) | 9–95 ms | 20 ms |

O `ms` que a própria resposta declara confirmou de onde vinha: **2.879 ms de cálculo
para devolver 200 linhas**.

### A causa, e por que ela é constrangedora

```ts
const r = calculaTabela(dash, v, ev);            // 33.462 linhas
const fatia = r.linhas.slice(de, de + linhas);   // 200 sobrevivem
```

A tabela inteira é calculada e **99,4% dela é jogada fora**. A cada clique. E a parte
constrangedora: a abertura da página já tinha feito esse mesmo cálculo inteiro, e já
tinha jogado fora as mesmas 33.262 linhas, minutos antes.

### O conserto

O resultado inteiro passa a ser guardado (`apps/api/src/cache-visual.ts`), com chave
igual à da resposta **menos `de` e `linhas`** (`chaveDoCompleto`). A ausência da
janela na chave *é* a otimização: a janela não muda o resultado, ela recorta o
resultado.

O ganho não custa CPU nenhuma, e é por isso que ele existe: o cálculo já acontecia. O
que se paga é memória, e ela tem orçamento — LRU com teto de 512 MB
(`CACHE_VISUAL_MB=0` desliga). O tamanho de tudo que é paginável nas 14 páginas foi
medido antes de escolher o teto:

| visual | linhas | bytes/linha | total |
|---|---:|---:|---:|
| `agendamento-field` tabela maior | 323.680 | 88 B | 27,1 MB |
| `visao-geral` detalhe | 33.462 | 424 B | 13,5 MB |
| `agendamento-field` relatos | 33.303 | 226 B | 7,2 MB |
| `protocolos-detalhados` detalhe | 33.462 | 151 B | 4,8 MB |
| — demais | — | — | 2,8 MB |
| **soma de todos** | | | **~55 MB de JSON** |

Como o aquecimento calcula a página inteira, ele agora deixa **todas** as janelas de
todas as tabelas prontas de uma vez — sem calcular nada a mais do que já calculava.

### Duas armadilhas que o conserto tinha

**A chave "completa" demais.** O instinto de quem lê `chaveDaResposta` é que a chave
carrega tudo que muda a resposta — e `de` muda a resposta. Pôr `de` aqui seria
tecnicamente correto e destruiria o ganho inteiro. Virou teste com o motivo escrito
dentro (`chaveDoCompleto: a janela NÃO entra na chave`).

**A espécie suposta.** Recortar um resultado guardado exige saber se ele é tabela ou
matriz. Uma spec regerada pode trocar o tipo de um visual mantendo o id, e recortar
uma matriz como tabela devolveria uma tabela **vazia sem erro nenhum** — número
plausível e errado, o pior resultado deste projeto. O `especie` é conferido, não
suposto.

### O que continua caro, e por quê

Aplicar um **filtro novo** ainda custa o cálculo (1,3 a 3,4 s na primeira vez com
aquela combinação): é resultado que nunca existiu, não há o que reaproveitar. O
aquecimento cobre a página sem filtro, que é como ela abre. Segmentação com muitos
valores marcados um a um paga uma vez por combinação — e cada uma fica guardada.

### O resultado, medido no navegador depois do conserto

Clique em "próxima", do clique ao DOM parado, Chrome real:

| página | linhas da tabela | 1º clique | 2º | 3º |
|---|---:|---:|---:|---:|
| `agendamento-field` | 323.680 | 8 ms | 7 ms | 8 ms |
| `protocolos-detalhados` | 33.462 | 10 ms | 6 ms | 8 ms |
| `visao-geral` | 33.462 | 27 ms | 11 ms | 10 ms |
| `agendamento-field` (relatos) | 33.303 | 9 ms | 14 ms | 9 ms |
| `manutencao-inicial` | 1.227 | 15 ms | 11 ms | 12 ms |

**O primeiro clique também é rápido** — é o que prova que o aquecimento está deixando
o resultado inteiro pronto, e não que o segundo clique aproveitou o primeiro.

`protocolos-detalhados`, tabela de 33.462 linhas: **2,90 s → 0,010 s**.

O aquecimento de arranque não ficou mais lento com a serialização do resultado
inteiro: 95,9 s nesta rodada, contra 157,5 s / 194,8 s / 264,0 s nas três anteriores
ao conserto. A variação entre rodadas é do disco, não do conserto — o que se pode
afirmar é que **não houve regressão**, não que houve ganho. Ocupação do orçamento com
as 14 páginas quentes: **153,3 MB de 512 MB**, 35 resultados guardados.

## #71 — Um `iniciaKafkaCDC` que **age** apareceu no diff sem gatilho medido; a medição real deu 4 eventos em 56 ms

**18/08/2026.** Uma sessão de continuação encontrou, não commitado, um
`apps/api/src/index.ts` com `iniciaKafkaCDC`: um consumer Kafka de verdade que, a
cada evento, chamava `srv.notificaMudanca()` para invalidar cache e empurrar por SSE
(`/api/realtime`, `servidor.ts`). Isso é exatamente o que o
[DECISAO-REALTIME.md](DECISAO-REALTIME.md) diz, por escrito, que não está
autorizado: *"Fazer o evento CDC agir — invalidar cache ou rematerializar — é que
continua fora."* Não havia registro de que o gatilho (as duas condições do
documento) tivesse sido medido.

### O que a medição real mostrou

Três checagens, todas somente-leitura:

1. `npm run cdc:slot` contra o Voalle: **nenhum slot de replicação**. Igual estava em
   11/08 — nenhuma captura ativa contra produção.
2. `npm run cdc:observa` com o `KAFKA_BROKERS` do `.env` (`localhost:9092`):
   `ECONNREFUSED`. Nenhum broker de pé para conectar.
3. A stack local descartável (`docker-compose.yml` da raiz — variante incompleta da
   de `docker/cdc/`, sem Postgres fake nem conector) estava com os quatro containers
   parados (`Exited`). Subindo-os: `GET :8083/connectors` devolveu `[]` — nenhum
   conector registrado —, mas o tópico `voalle.public.v_service_desk_slots_productivity_informative`
   já existia, sobra de uma captura anterior. Lendo-o do início
   (`cdc:observa -- --desde-inicio`): **4 eventos, todos dentro de uma janela de
   56 ms**.

O próprio `cdc:observa` calcula "intervalo típico: 0 ms" a partir desses 4 eventos e
imprime "isso satisfaz a condição 1 do gatilho" — mas isso é um artefato de amostra
pequena (4 eventos colados, provavelmente sobra do *snapshot* inicial de um teste),
não uma taxa de mudança real. O `DECISAO-REALTIME.md` pede uma janela de observação
de verdade (minutos, não milissegundos) antes de contar como medição.

### Por que reverter, e não só "faltou medir"

Mesmo com uma medição de verdade da condição 1, agir sobre o evento hoje não traria
dado mais fresco: a API não consulta fonte nenhuma, ela lê o snapshot que
`npm run snapshot` materializou em disco. Invalidar o cache de resposta faria o
próximo pedido recalcular sobre o **mesmo arquivo** — um cache-miss que parece fresco
e não é, que é exatamente a classe "número plausível e errado" que a regra 4 não
aceita. Fazer o CDC valer a pena exige antes um dos dois: rematerializar o snapshot
no evento (a operação de 26 min do #68, que não pode rodar concorrente com nada,
ver §7) ou um modelo de carga incremental — nenhum dos dois existe. Ou seja: o
bloqueio não é só "faltou medir a condição 1", é que a condição 2
("a conta do refresh não cabe mais") e a arquitetura de leitura por snapshot
continuam de pé independentemente do resultado da medição.

### O que foi feito

`iniciaKafkaCDC`, `notificaMudanca`, `clientesSSE` e a rota `/api/realtime` foram
revertidos de `apps/api/src/{index,servidor}.ts` antes de qualquer commit — a Fase 4
continua bloqueada como o `DECISAO-REALTIME.md` já dizia. O resto do diff da sessão
(parâmetros de SQL, o fix de fuso horário sem-timezone, a otimização por índice da
transição de contexto, o nível de hierarquia de data em filtro) não tem relação com
CDC e não foi tocado. `tools/cdc` continua existindo e sendo apenas o instrumento de
medição — nenhuma mudança nele.

**Se alguém reabrir isto:** meça de verdade primeiro — `npm run cdc:slot -- --vigia`
numa janela, depois `npm run cdc:observa -- --minutos=60` contra uma fonte real (o
Voalle com conector de DBA, ou a stack de `docker/cdc/` com `gera-mudancas.sh`
simulando volume real) —, e resolva a arquitetura de invalidação-sem-rematerialização
antes de reintroduzir `iniciaKafkaCDC`.

## #72 — O Change Ingestor existe: evento CDC rematerializa só o que sujou, dado real do Voalle, sem tocar produção

**18/08/2026.** Depois do #71 (o `iniciaKafkaCDC` revertido por não ter medição
nem resolver a arquitetura de invalidação-sem-rematerialização), o Erick decidiu
abrir a Fase 4 de verdade — não contra o Voalle de produção (isso continua
exigindo as etapas de DBA do `RUNBOOK-CDC.md`), mas construindo e validando o
Change Ingestor contra a stack descartável de `docker/cdc/`, que já existia
parada no Docker.

### O desenho: rematerializar, não só invalidar

A pergunta que o #71 deixou em aberto: o que o Change Ingestor deve fazer quando
chega um evento, já que invalidar cache sozinho não deixa nada mais fresco (a API
lê snapshot em disco)? A resposta escolhida: **rematerializar só as queries que a
tabela suja**, via `npm run snapshot --query=<ids> --refazer` — que já existe e já
faz exatamente isso. O manifesto novo em disco já é o que invalida o cache da
resposta sozinho (o carimbo entra na chave, ACHADOS #47/#66), então não precisou
de rota nova, SSE nem gateway de fan-out — a única invalidação que existe continua
sendo a que já existia.

Duas peças novas, as duas com teste:

- **`tools/cdc/src/fila.ts`** (`FilaDeRematerializacao`) — acumula queries sujas e
  roda uma rematerialização por rajada (debounce), **nunca duas ao mesmo tempo**.
  É a lição do §7 aplicada aqui: dois `npm run paginas` de 8 GB brigando pela
  mesma máquina já custaram uma manhã de medição perdida; o mesmo risco existe
  entre um Kafka barulhento e uma rematerialização lenta. O teste que mais valeu:
  `roda()` que rejeita tinha um `finally` sem `catch` em volta — a rejeição
  escapava do `void this.#tentaRodar()` (fire-and-forget) como *unhandled
  rejection*, e teria derrubado o processo inteiro na primeira falha de
  rematerialização. Pego pelo teste antes de rodar contra Kafka de verdade.
- **`tools/cdc/src/ingestor.ts`** (`npm run cdc:ingere`) — a parte que fala com o
  Kafka: `leEnvelope` e a nova `queriesDoEvento` (extraída de `medidor.ts`, para
  observador e ingestor nunca discordarem sobre o que uma tabela suja) resolvem o
  evento, `fila.ts` decide quando rodar.

### A validação, com número

A stack de `docker/cdc/docker-compose.yml` nunca tinha subido neste ambiente.
Duas coisas quebraram antes de funcionar, as duas específicas deste ambiente
Windows:

1. O healthcheck do zookeeper (`echo ruok | nc ...`) falhava com `nc: command not
   found` — a imagem `quay.io/debezium/zookeeper:2.7` não tem `nc`. O processo
   estava saudável (log confirma), só o healthcheck mentia. Trocado para
   `curl http://localhost:8080/commands/ruok` — o AdminServer HTTP que a mesma
   imagem já expõe.
2. `docker/cdc/registra-conector.sh` fazia `node -e "require('$AQUI/conector.json')"`
   com `$AQUI` no formato `/c/Users/...` do Git Bash. Interpolado dentro da string
   do script, o MSYS não traduz para `C:/...` (só traduz argumento que *é* um
   caminho inteiro) — `MODULE_NOT_FOUND`. Corrigido passando o caminho como
   `process.argv[1]`, argumento separado: aí a tradução automática do Git Bash
   entra, e funciona nos dois mundos (no Linux/Mac o argv passa direto, sem
   tradução nenhuma a fazer).

Com a stack de pé e o conector registrado, `bash docker/cdc/gera-mudancas.sh 15`
gerou eventos reais de Debezium em `erp.contracts`, `erp.assignment_incidents` e
`erp.tabela_que_ninguem_usa` (a terceira, de propósito, para provar que tabela sem
query dona não dispara nada). O ingestor:

- resolveu corretamente as 19 queries afetadas pelas duas tabelas reais (união de
  `contracts` e `assignment_incidents`);
- ignorou `tabela_que_ninguem_usa` com a mensagem certa, sem tentar rematerializar
  nada;
- **coalesceu os 15 eventos brutos numa rodada só** — não 15, não 2 (uma por
  tabela): o debounce de 5 s juntou tudo antes de disparar. É a prova de que
  `fila.ts` funciona contra Kafka de verdade, não só contra o agendador de mentira
  do teste.

A rodada então chamou `npm run snapshot --query=<13 ids> --refazer` contra o
**Voalle de produção real** — leitura, o mesmo `npm run snapshot` que já roda
rotineiramente, nenhum risco novo. Resultado: **12 de 13 sucesso, 2.090.676
linhas, 1218,2 MB**, entre 792 ms (`tecnicos-auxiliares`) e 30,2 s
(`protocolos-geral`). A 13ª (`protocolos-produtividade`) estourou o heap padrão —
característica já conhecida desta query, não bug novo — e terminou com sucesso
rodando `--memoria=8192` isolada (68.707 linhas, 52,7 s). O ingestor já aceita
`--memoria=` para isto; só não veio setado nesta rodada de validação.

### O que isto prova, e o que continua faltando

Prova o pipeline inteiro, ponta a ponta, com dado real: evento → tabela → queries
afetadas → uma rematerialização por rajada → cache invalidado pelo mecanismo que
já existia. **Não prova o gatilho do `DECISAO-REALTIME.md`** — isso exige medir
contra o Voalle de verdade, com um conector de DBA, e continua não feito. Ligar
isto contra produção é a próxima decisão, e ela é do Erick com um DBA, não deste
repositório sozinho.

A stack de `docker/cdc/` foi derrubada ao final (`docker compose down -v`),
como o `RUNBOOK-CDC.md` manda.

---

## #73 — A terceira mesclagem morta não tinha conserto: a fonte parou de ser alimentada 13 meses antes

**18/08/2026.** A pendência que o #64 deixou registrada: a mescla
`PROTOCOLOS GERAL {INSTALADO POR:, DATA FINAL} × GESTORES EQUIPES {TÉCNICO 1, DATA}`
casava 0 de 25.472 linhas, as chaves não eram texto×número, e o mecanismo de
`juncoes.yaml` não tinha o que dizer sobre ela. O `CONTINUACAO.md` registrava a
hipótese: *"suspeite da data primeiro — `DATA FINAL` chega meia-noite UTC; `DATA`
vem do MariaDB e ninguém olhou ainda."*

A hipótese estava certa quanto à coluna e **errada quanto ao motivo**.

### A medição, componente por componente

A chave é composta, então a pergunta útil é qual das duas colunas mata a junção.
Medindo cada uma sozinha:

```
COMPONENTE 1 — O NOME
  distintos: esq 93 · dir 70 · interseção EXATA 26
  linhas da esquerda cujo nome existe na direita: 11.703 de 34.025

COMPONENTE 2 — A DATA
  distintas: esq 190 · dir 187 · interseção EXATA 0
  faixa esq: 2026-01-02 → 2026-08-18
  faixa dir: 2025-01-01 → 2025-07-16
  interseção ignorando hora (só YYYY-MM-DD): 0 de 34.025
```

**O nome casa.** 26 dos 70 técnicos da direita existem na esquerda, cobrindo 11.703
linhas. A expressão M está correta; não é normalização, não é acento, não é espaço
em volta — `trim+upper+espaço colapsado` não muda nada (93 × 70 → interseção 26,
igual).

**A data não tem como casar.** As duas faixas **não se sobrepõem em um único dia**.
Não é fuso: ignorar a hora inteira mantém a interseção em zero. Não é tipo: a
esquerda é data e a direita é `Date` nas duas pontas.

### A causa, na fonte crua

`DB_Applicattion.Installation_Teams` no dbMaria, **antes** de qualquer filtro do M:

```
10.795 linhas · DATA de 2024-08-01 a 2025-07-16 · 0 nulas
por ano:  2024: 5.153   ·   2025: 5.642   ·   2026: 0
por mês:  2025-05: 923 · 2025-06: 988 · 2025-07: 566  ← e para aqui
```

**A tabela parou de receber linha em 16/07/2025** — 13 meses antes desta medição.
Julho de 2025 tem 566 linhas contra ~900 dos meses cheios: parou no meio do mês.

Confirmado que não é filtro nosso escondendo dado recente, contando linha por passo
(`run:mlayer --passos`): `CAPACIDADE TOTAL <> null` corta **19** linhas,
`Table.Distinct` corta 27, e o `[DATA] > #date(2024,12,31)` corta 5.130 — todas de
2024. Zero linhas de 2026 na fonte crua, com ou sem filtro.

### O que isto significa para a plataforma

**Não há conserto em código, e `juncoes.yaml` não serve.** Reconciliar tipo não
casa faixa disjunta: se um lado termina antes de o outro começar, não existe par
possível em comparação nenhuma. `TÉCNICO 2` e `GERENTE/SUPERVISOR` continuam
inteiras nulas, e **o Power BI mostra o mesmo** — ele lê a mesma tabela do MariaDB.
É defeito herdado com fidelidade, como as duas primeiras mesclagens do #64.

A consequência que importa: `visao-geral` filtra `TÉCNICO 2` com `not_in [null]`
sobre uma coluna 100% nula, o que **descarta toda linha do visual**. Esse visual
está vazio aqui e está vazio no Power BI. Vira pergunta de negócio
(`PERGUNTAS-NEGOCIO.md` #11), não item de fila técnica: ou a tabela volta a ser
alimentada, ou o visual precisa de outra origem.

### O que virou código: fazer o motor dizer a causa

A nota antiga terminava em *"confira as duas pontas no `m_expression`"* — e mandava
procurar defeito onde não havia nenhum. Foi o que custou esta manhã de medição.
`Table.NestedJoin` agora checa faixa de data **antes** de falar de tipo:

```
nenhuma das 26130 linhas de chave completa casou, e a causa é a faixa de
'DATA FINAL' × 'DATA': ela é data nas duas pontas e as faixas NÃO SE TOCAM —
esquerda de 2026-01-02 a 2026-08-18, direita de 2025-01-01 a 2025-07-16.
Nenhuma reconciliação de tipo casaria: não existe par possível. A coluna
aninhada sai INTEIRA NULA, e isto é dado que parou de chegar, não chave errada.
```

Diagnóstico causal em uma linha, contra a base real. **Antes de tipo** de propósito:
faixa disjunta explica a morte inteira e nenhuma reconciliação a conserta, então
falar de `Int64.Type` primeiro seria enterrar a resposta.

Onde ela **não** dispara, e cada caso tem teste: faixas que se sobrepõem sem casar
dia nenhum (aí "confira as duas pontas" é o conselho certo), faixas que encostam
pela ponta (casam de verdade — não são disjuntas), e coluna de espécie misturada
(sem faixa; afirmar uma seria resolver dois defeitos ao mesmo tempo, que é o que o
`reconciliavel` já evita). Numa chave composta, uma posição impossível basta, e a
nota nomeia **qual** posição. Teste de mutação: anulando a chamada de
`faixaDisjunta`, **3 dos 17** testes de `juncao-morta.test.ts` caem.

### Dois buracos no `run:mlayer` que esta investigação achou

Os dois valem mais que o achado em si, porque afetam toda investigação futura da
camada M:

1. **Ele engolia as notas.** O `tools/snapshot` as imprime desde o #64; o
   `run:mlayer` as descartava. A ferramenta de *investigar* a camada M era a única
   que não mostrava o diagnóstico que a camada M produz. Agora imprime, **antes** dos
   alertas de contagem — junção morta costuma ser a causa da contagem estranha.
2. **Ele não carregava `juncoes.yaml`.** Pior que faltar recurso: as duas ferramentas
   rodam a mesma camada M e davam diagnóstico **diferente**. O `run:mlayer` reportava
   como morta a junção de `N°PROTOCOLO` que o `snapshot` reconcilia por decisão
   registrada — alarme falso na ferramenta usada para investigar alarme.

### Um erro meu que vale registrar

A primeira rodada do diagnóstico disse que as duas colunas da direita eram
**100% nulas** — o que contradizia o próprio filtro `[DATA] > #date(2024,12,31)`
da query, que 5.619 linhas atravessam. A contradição é que denunciou o erro:
`MRow` é `ReadonlyMap`, e eu lia `r['DATA']` em vez de `r.get('DATA')`. Devolvia
`undefined`, que meu contador classificava como `null`.

Se eu tivesse acreditado na primeira saída, a conclusão registrada seria "a tabela
de gestores está vazia" — plausível, e errada. **Número que contradiz uma regra
conhecida do sistema é sinal de instrumento quebrado antes de ser sinal de dado
quebrado.** O diagnóstico passou a separar `undefined` de `null` na saída, com o
motivo escrito ao lado.

---

## #74 — Duas queries são a mesma menos dois IDs, uma é subconjunto da outra, e o corte do ano está escrito onze vezes

**18/08/2026.** Pergunta do usuário: *"sobre redundância de querys, existe algo que
podemos reutilizar que traz a mesma coisa?"* Medi as 24 queries do catálogo por
quatro eixos independentes, porque cada um erra sozinho: duas queries podem ler as
mesmas tabelas e devolver coisas diferentes (agregação distinta), e podem ter SQL
parecido com recortes opostos. Nenhum valor de linha foi lido — só metadado do
catálogo.

### 1. `protocolos-auxiliares` × `protocolos-produtividade` = **99,4%**

Jaccard de trigramas sobre o SQL canonizado (espaço colapsado, minúsculas,
`AS "apelido"` removido — dois `SELECT` iguais com apelidos diferentes ainda são a
mesma leitura). O diff de tokens em ~3.070 caracteres: **zero tokens exclusivos de
`auxiliares`**, e exclusivos de `produtividade` apenas `'1256'` e `'279'`, na lista
comentada *"Filtrando os tipos de protocolo"*:

```
auxiliares    it.id IN ('12','1014','1254','1255',       '1136','249','268','1160','1015',      '15')
produtividade it.id IN ('12','1014','1254','1255','1256','1136','249','268','1160','1015','279','15')
```

Todo o resto é idêntico, inclusive `AND a.created >= '2026-01-01'` e o
`WHERE PERSONA1 = 1;` final.

E as duas não são independentes: **`protocolos-produtividade` cita
`PROTOCOLOS AUXILIARES` no M *e* tem `Odbc.Query` próprio.** Materializar
`produtividade` faz duas idas ao Voalle com o mesmo SQL menos dois IDs.

### 2. `protocolos-produtividade` é **subconjunto** de `protocolos-geral`

Diff de tokens `geral` (3.656 ch) × `produtividade` (3.078 ch): **zero tokens
exclusivos de `produtividade`**. Mesma lista de 12 tipos, mesmo corte de data.
`geral` só acrescenta `PLANOS_CONTRATO` (um `STRING_AGG(DISTINCT sp2.title…)` sobre
`service_products`) e projeções `per."…"`, e usa `WHERE per.PERSONA1 = 1;`.

As duas leem **as mesmas linhas da fonte**; `geral` calcula mais colunas. Custo no
manifesto do snapshot:

```
protocolos-auxiliares    33.804 linhas · 46 col · 26,0 MB · tabelas: []
protocolos-geral         34.025 linhas · 63 col · 34,8 MB
protocolos-produtividade 68.707 linhas · 51 col · 57,5 MB
```

`protocolos-auxiliares` tem **`tabelas: []`** — não é tabela do modelo, existe só
para alimentar as outras duas. É a candidata que dá para remover sem que nenhum
visual perceba.

E as três citam **as mesmas três** auxiliares (`alocacao-patrimonio`,
`tecnicos-auxiliares`, `troca-endereco`): não são queries parecidas por acaso, são
três variações do mesmo recorte.

### 3. `'2026-01-01'` está em **11 das 24 queries**

```
base-categorias-field, field-agenda, instalacoes-reincidentes, protocolos-auxiliares,
protocolos-geral, protocolos-produtividade, protocolos-telefonia, reincidencia,
retorno-prioritario, tecnicos-auxiliares, troca-endereco
```

É o único literal de data no corpus, e é o mesmo que **não vira o ano** — em
01/01/2027 o painel continua mostrando 2026 (medido junto: o piso é este literal em
`a.created`, o teto é `DATA INSTALADO <= TODAY()` em DAX, duas colunas diferentes).
Uma decisão de negócio escrita onze vezes: consertar o rollover hoje é acertar onze
lugares no Power BI e não errar nenhum.

### 4. Quanto reuso já existe, e onde ele falha

```
alocacao-patrimonio  ←  5 queries        protocolos-geral      ←  backlog-agendado-futuro
tecnicos-auxiliares  ←  3                gestores-equipes      ←  protocolos-geral
troca-endereco       ←  3                protocolos-auxiliares ←  protocolos-produtividade
quadro-funcional     ←  1
7 queries são reusadas · 17 são folhas
```

O padrão de citação existe e funciona — essas são resolvidas uma vez por processo.
**O que falha é o único caso em que a citação convive com duplicação:**
`auxiliares` é citada *e* refeita.

Contexto de fonte: **29 de 48 tabelas são lidas por mais de uma query** —
`people` por 13, `assignment_incidents` por 11, `assignments` e `incident_types`
por 10, `contract_service_tags` por 9. Isso **não** é defeito: é `LEFT JOIN` de
dimensão, e cada query precisa dela. Registro para não confundir depois com o
item 1, que é.

Demais pares acima de 50%: 88,4% `auxiliares × geral`, 78,1%
`reincidencia × retorno-prioritario`, 77,3 / 77,1 / 69,5 / 59,9 / 57,0.
**9 pares de 153 possíveis, 0 idêntico após canonizar.**

### O que não dá para fazer daqui, e por quê

O SQL mora nas expressões M do PBIP, e o PBIP é read-only (regra 1). Divergir de
propósito exigiria um `sql-override.yaml` no molde de `divergencias.yaml`, com
`original_sha` da expressão que ele substitui — **esse mecanismo não existe**, e é o
item 3 da fila do `CONTINUACAO.md`, que manda fazê-lo **depois** da paridade: sem
gabarito verde, um `LEFT JOIN` que multiplica linha passa despercebido. E
`produtividade` sai com 68.707 linhas contra 34.025 de `geral`, ou seja, existe um
passo que multiplica linha exatamente ali.

Ordem por risco crescente, se e quando for mexer:

1. **O `'2026-01-01'`** — não é desempenho, é correção, e é a única com data marcada
   para quebrar. Virou `PERGUNTAS-NEGOCIO.md` #12.
2. **Remover `protocolos-auxiliares`** — maior ganho, menor risco conceitual: não é
   tabela do modelo, e a diferença é uma lista `IN`. Um `Table.SelectRows` sobre
   `produtividade` faz o mesmo sem segunda ida ao banco.
3. **Fundir `geral` e `produtividade`** — maior ganho e maior risco, pelo fator de
   multiplicação acima. Depende da paridade.

### Terceiro buraco no `run:mlayer` no mesmo dia

**`run:mlayer` não consegue rodar `protocolos-produtividade`.** Falhou em 34.975 ms
com *"Falha ao ler a fonte da query `protocolos-auxiliares`: canceling statement due
to statement timeout"*. Causa: `mrun` não tem `--timeout=` e cai no padrão do `.env`
(`VOALLE_STATEMENT_TIMEOUT_MS = 30_000`), que o próprio `tools/snapshot` documenta
como *"teto de pedido de tela, não de materialização"* — e o `snapshot` tem o flag.

A falha é a prova do item 1: é a **busca dupla** que estoura os 30 s. O instrumento
quebrou justamente no lugar que ele deveria medir, pela terceira vez hoje (#73 tinha
achado as notas engolidas e o `juncoes.yaml` não carregado). **Ferramenta de
diagnóstico que não alcança o caso mais pesado do corpus não está pronta**, e três
buracos no mesmo dia dizem que ela nunca foi exercitada contra a query mais cara.

---

## #75 — O primeiro item da fila pedia, havia oito dias, um trabalho que não existia

**19/08/2026.** Ao escrever um roteiro de finalização com critério de saída por item,
o primeiro item da fila não passou. Ele dizia:

> *"Ditar os números de paridade que faltam… São 64 cards, dos quais 22 já saíram por
> serem carimbo de refresh."*

Contei os cards em vez de acreditar na frase:

```
pág.                    cards  ignor.  em jogo  ditados  FALTAM
agendamento-field           6       2        4        4       0
capa                        2       2        0        0       0
diario-instalacao           5       2        3        3       0
instalacao-reincidente      5       2        3        3       0
manutencao-inicial         12       2       10       10       0
premiacao-instalacao        2       2        0        0       0
protocolos-detalhados       2       2        0        0       0
relatorio-do-ano            4       2        2        2       0
relatorio-do-mes           16       2       14       14       0
telefonia-ouvidoria         4       2        2        2       0
visao-geral                 6       2        4        4       0

TOTAL: 64 cards · 22 carimbo · 42 em jogo · 42 ditados · 0 FALTAM
```

**Nenhum número falta.** Os 42 cards em jogo têm todos o `powerbi:` preenchido desde
11/08. O que existe não é gabarito vazio — é gabarito **contaminado**, e a diferença
entre as duas coisas muda o trabalho inteiro:

| a descrição pedia | a medição pede |
|---|---|
| ditar 42 números | reler **17** |
| em 11 páginas | em **3** |
| tarefa manual inteira | 2 dos 3 passos são da máquina |

As 3 são `AGENDAMENTO FIELD`, `INSTALAÇÃO/ REINCIDENTE` e `MANUTENÇÃO INICIAL` — as
únicas que declaram filtro de página, e a leitura de 11/08 foi feita com os filtros
apagados. O `PARIDADE-11-08.md` **já tinha medido isso e já tinha escrito a receita de
três passos**; ela só nunca chegou ao item da fila.

### A causa: dois documentos com donos diferentes e nenhum critério de saída

O `PARIDADE-11-08.md` é registro de uma medição — imutável, e estava certo. O
`CONTINUACAO.md` §6 é fila de trabalho — mutável, e ficou velho. Entre 11/08 e 19/08
ninguém releu um contra o outro, porque **nada obrigava**: o item da fila não tinha
critério de saída, e item sem critério de saída não tem como ser conferido. Ele só
podia envelhecer.

O sintoma tinha aparecido antes e passou: a §1 dizia "os 64 cards **com gabarito
ditado**" e a §5.3, quarenta linhas abaixo, dizia "64 cards **esperando número**". As
duas frases não podem ser verdadeiras juntas. Estavam no mesmo arquivo, e ninguém
tropeçou nelas — inclusive eu, que li o arquivo inteiro três vezes nesta semana.

### O que virou estrutura

Duas seções novas no `CONTINUACAO.md`, e as duas existem por causa desta falha:

- **§0, o painel.** Sete números, cada um com **o comando que o regenera** ao lado.
  Não é para ser lido e crido: é para ser conferido em segundos. Os três primeiros
  foram conferidos ao escrever, e dois estavam velhos — 113 commits eram **118**, e
  "74 achados" eram **73 numerados até #74** (o #5 nunca existiu; contagem e maior
  número são grandezas diferentes, e confundi-las é como o contador andou sozinho).
- **§9, o roteiro.** Todo item pendente tem `critério de saída`, `quem destrava` e
  `o que já está pronto`. É a peça que faltava: agora um item pode ser **conferido**
  contra a realidade, e não só relido.

### A lição, que é mais geral que a paridade

Este projeto tem a regra 8 — *meça antes de decidir, e registre o número*. Faltava a
outra metade: **um item de fila sem critério de saída é uma afirmação que ninguém vai
verificar.** Ele não fica errado por descuido; fica errado porque não existe operação
que o teste. Oito dias é pouco — este item teria envelhecido por meses do mesmo jeito.

E vale notar de onde veio a descoberta: não de reler a documentação, mas de tentar
escrever **quando parar**. A pergunta "como eu sei que isto acabou?" é um teste, e ela
reprovou o item na primeira tentativa de responder.

---

## #76 — A ferramenta de investigar a camada M não alcançava a query mais cara: 30 s de teto para 78,8 s de fonte

**19/08/2026.** Item 4 da fila da `CONTINUACAO.md` §6, e o mais barato dela. O
`run:mlayer` não tinha `--timeout=` e caía no default do `.env`
(`VOALLE_STATEMENT_TIMEOUT_MS = 30_000`). O `tools/snapshot` documenta esse número
como *"teto de pedido de tela, não de materialização"* — e **tinha** o flag desde
sempre. Duas ferramentas rodando a **mesma** camada M, uma alcançando a query mais
cara do corpus e a outra não.

Terceiro buraco achado no `mrun` em dois dias: o #73 achou dois (não imprimia as notas
da camada M, não honrava o `juncoes.yaml`). O padrão é o mesmo nos três — **ela nunca
foi exercitada contra a query mais cara**, então todo defeito que só aparece lá ficou.

### A medição, que diz que o teto era o problema e por quanto

Depois do conserto, `--only=protocolos-produtividade --memoria=8192`:

```
protocolos-produtividade   35.652 fonte → 69.062 final · 48 col · 60 passos · 93.440 ms

  fonte (banco/rede):     78.806 ms   84%
  conversão de linha:        183 ms    0%
  avaliação de M:         14.451 ms   15%
  127.872 linhas lidas de fonte
```

**78,8 s só de banco, contra um teto de 30 s.** Não era margem apertada: era 2,6× o
teto. E os 84% explicam por que nenhuma otimização de M resolveria — o tempo está na
fonte, que é exatamente o argumento do item 3 da fila (empurrar para SQL, #74).

### A segunda parede, que só apareceu depois de derrubar a primeira

Com o timeout corrigido e **sem** `--memoria=`, a query rodou **138.490 ms** e estourou
o heap. O `--memoria=` já existia; o que não existia era chegar longe o bastante para
precisar dele. Vale como método: **um limite escondido atrás de outro não é visível até
o primeiro cair**, e por isso "consertei o timeout" não era resposta — a resposta é a
query terminando.

### O que mudou no código

- `tools/mrun/src/args.ts`, novo: o parser saiu do `index.ts` para ter teste. Importar
  o `index.ts` lê o `.env` e abre o catálogo, e nada disso cabe num `node --test`.
  Erro de argumento **lança** (`ErroDeArgumento`) em vez de chamar `process.exit`, para
  o teste poder afirmar a recusa sem derrubar o runner junto.
- `TIMEOUT_PADRAO_S = 600` — o mesmo número e a mesma justificativa do
  `tools/snapshot`. O default é **impresso na saída, com o valor do `.env` ao lado**
  quando difere: trocar o teto calado seria pior que o timeout, porque quem lê a saída
  precisa poder dizer se a query demorou ou se a régua era outra.
- `argvDoFilho()`, também em `args.ts`, porque a metade que quebra é o **repasse**: o
  filho é quem abre o pool, então uma flag que o pai lê e não passa adiante não faz
  nada, e não faz nada em silêncio.

### O teste, e as duas mutações que ele derruba (regra 4)

`tools/mrun/test/args.test.ts`, 7 casos, registrado no `npm test` e em `test:mlayer`.
Conferido quebrando a regra de propósito, que é o que a regra 4 exige:

| mutação | o que cai |
|---|---|
| apagar `--timeout=` de `argvDoFilho` | *o pai repassa o timeout ao filho — ida e volta* |
| `TIMEOUT_PADRAO_S` de 600 para 30 | *sem `--timeout=`, o default é de materialização e não de tela* |

O teste do ida-e-volta (`parseArgs(argvDoFilho(...))`) cai nos **dois** sentidos — se o
pai parar de passar, ou se o filho parar de ler. É a forma que pega o defeito real,
porque um flag lido e não repassado deixa o pai imprimindo "600s" enquanto o filho abre
o pool com 30.

### O bônus que estava escondido atrás do timeout

Com a query terminando, a nota da camada M apareceu — e ela nunca tinha sido vista
nesta query, porque a execução morria antes:

```
Table.NestedJoin 'N°PROTOCOLO' × 'PROTOCOLO:': 0 de 35083 linhas casam por espécie,
e 27058 (77,1%) casariam comparando N°PROTOCOLO como inteiro
```

É uma mesclagem morta reconciliável, do tipo do #64: uma ponta declara `Int64.Type` e a
outra fica texto. **Não** é a do #73 (aquela é faixa de data disjunta, sem conserto em
código). Esta tem conserto — uma entrada em `specs/_catalog/juncoes.yaml` com o número
—, e fica registrada aqui em vez de decidida agora: 77,1% não é 100%, e o que fazer com
os 22,9% restantes é decisão, não conserto.

---

## #77 — `npm run paridade` estava travando por uma chave YAML duplicada, calada desde 11/08

**01/09/2026.** Ao fechar a Fase L7 de `PLANO-LAYOUT-V1.md` (decisão do chart SDK),
rodei `npm run paridade` só para conferir o placar antes de responder "falta algo?" — e
o programa **morria** com `YAMLParseError: Map keys must be unique`, sem chegar a
comparar um card sequer.

A causa: `specs/paridade/relatorio-do-mes.yaml` tinha dois blocos de `observacao:`
colados **byte a byte iguais**, um em cima do outro, dentro do mesmo card (`20d23554...`,
"DIAS TRABALHADOS NO MÊS") — na verdade **três** cópias, não duas; a primeira tentativa
de conserto colapsou só um par e deixou duas. Um segundo card (`bbc6684...`, "DIAS
ÚTEIS RESTANTES NO MÊS") tinha o mesmo acidente, **triplicado**. `yaml` (a lib) recusa
mapa com chave repetida — corretíssimo, YAML não define qual das duas vale — e o
programa não tinha `try/catch` nenhum em volta do `parseYaml` em `leGabaritos()`
(`tools/paridade/src/index.ts`): a exceção subia crua e derrubava o processo antes de
imprimir uma linha.

**Por que ficou calado desde 11/08/2026** (a data de `conferido_em` no cabeçalho do
arquivo): não há teste que rode `npm run paridade` — não está em `npm test`, é comando
separado, de uso manual. Um YAML que carrega bem noutro contexto (`layout:valida`,
por exemplo, não lê este diretório) não denuncia sozinho um vizinho quebrado.

**Conserto:** as duas cópias extras removidas à mão (`git diff` confirma **30 linhas**
a menos no arquivo — 10 do primeiro card, 20 do segundo —, texto idêntico preservado; a
única cópia que sobrou de cada
observação é literalmente igual às que foram removidas, então nenhuma decisão nova
entrou, só a duplicação saiu). O programa não ganhou `try/catch` novo: a causa era o
dado, não a ferramenta.

### O que a ferramenta destravada mostrou — e não é o #77, é o §9.1 de novo

Rodando limpo pela primeira vez desde a reconstrução de 27/08: **64 cards, 3 batem, 25
diferem, 3 divergem como já decidido, 33 não calculam** (22 são carimbo de
atualização — `ignorar:` no YAML, fora do jogo por convenção, não por código — e 11 são
cards de negócio de verdade, concentrados em `relatorio-do-mes` e `manutencao-inicial`,
provavelmente medidas de "mês atual"/"30 dias" caindo em divisão por janela vazia bem
no primeiro dia de setembro — não investigado a fundo, é hipótese consistente com a
data).

As 25 diferenças batem no padrão que `CONTINUACAO.md` §9.1 já tinha nomeado em
19/08/2026 (**4,2 dias de defasagem** entre snapshot e gabarito): `relatorio-do-mes.yaml`
foi ditado em **11/08/2026**, e hoje são **três semanas depois** — `TOTAL INSTALADOS` de
`manutencao-inicial` (PBI=19.581, calculado=28.060, **43%** de diferença) é exatamente
o tamanho de diferença que três semanas de protocolo novo instalado explicariam, não um
defeito de cálculo. **Não tentei rematerializar nem reler o Power BI** — os dois passos
que fecham isso são os mesmos do item 1/§9.1, e o segundo exige alguém com a tela do
Power BI aberta na frente, que não sou eu. Fica registrado que a ferramenta agora
*roda*; ela não prova paridade nenhuma sozinha, porque o gabarito está mais velho do que
estava em 19/08, não mais novo.

## #78 — `tools/snapshot/` corrigia sem que nada testasse: duas restaurações de `0aae15c` ficaram quebradas por 7 dias

**02/09/2026.** Ao levantar o plano de deploy, pedi uma auditoria do que ainda faltava
para publicar — ela voltou dizendo que `tools/snapshot/src/index.ts` e
`tools/snapshot/src/calculadas.ts` **crashavam em qualquer execução real**. Verifiquei
ao vivo antes de aceitar (rodando os dois de verdade, não só lendo o diff), e era
verdade nos dois:

- `index.ts`: `ReferenceError: avisos is not defined` no `catch` de `materializa()` —
  `avisos`, `politicas`, `AGORA`, `materializaColunas` e `resumoDoErro` eram usados sem
  nunca terem sido declarados ou importados.
- `calculadas.ts`: `SyntaxError: Identifier 'pular' has already been declared` — o
  arquivo não carregava, ponto.

**Causa.** `0aae15c` ("restaurar 100% do estado... do dia 26", 26/08/2026) colou blocos
de código por cima de si mesmos nos dois arquivos (alguns 2-3×) e, no meio da colagem,
apagou trechos que já existiam: em `calculadas.ts`, `--todas`, `--parcial=` e as duas
validações que os acompanhavam (`--isolar`+`--sem-isolar` mutuamente exclusivos;
`--parcial= exige --coluna=`) sumiram da lista de argumentos conhecidos. Consequência
prática: o encadeamento automático em `index.ts:709` (`calculadas.ts --todas`, disparado
ao fim de todo `--refazer`) falhava sempre — silenciosamente, para quem só conferisse o
snapshot das *queries* (que tinha rodado bem e escondia a etapa seguinte quebrada).

**Por que ficou 7 dias sem ninguém notar.** `tools/snapshot/` nunca teve pasta `test/`.
O glob de `npm test` (`tools/*/test/*.test.ts`) simplesmente não alcançava esta pasta —
a suíte seguiu 100% verde o tempo todo, porque não havia teste nenhum que pudesse ficar
vermelho. É a peça que materializa **todo** o dado servido pela API, e era uma das 4
(de 15) sem cobertura nenhuma em `tools/` — as outras três (`auth`, `bench`, `paginas`,
`probe`) continuam assim por decisão deliberada, por dependerem de banco/rede real.

**Conserto.** `index.ts`: as declarações e os imports que faltavam, mais a limpeza dos
blocos duplicados. `calculadas.ts`: restaurado por inteiro para `f3c4aa7` (18/08/2026,
o último commit bom antes da corrupção) — diff linha a linha confirmou que **tudo** que
mudou entre `f3c4aa7` e `0aae15c` era duplicação ou regressão, nada legítimo se perdia.
Acrescentei `tools/snapshot/test/cli.test.ts` (8 testes herméticos — só exercitam
`--plano` e validação de argumento, sem tocar `snapshot/` real nem o banco) para que
essa classe de regressão — restauração que duplica **e** apaga, parecendo trabalho
novo — pare de passar despercebida. `npm test`: 1502/1502. Verificado ao vivo contra o
Voalle real: fetch de `capa --refazer` disparando o encadeamento das 7 tabelas
calculadas, incluindo o modo isolado por coluna de `Status Protocolo Dia` (13.012
linhas), ponta a ponta, exit 0. Commit `39e4ce6`, em `staging`. Ver `DEPLOY.md` §4.2.

## #79 — No Windows, renomear por cima de um arquivo aberto para leitura falha sempre, não às vezes — e retentativa resolve

**02/09/2026.** Seguindo o plano de atomicidade da escrita do snapshot (DEPLOY.md
§2.2/§4.3), medi antes de decidir, em vez de supor: uma sonda local (`fs.openSync` e
`fs.createReadStream` pausado, os dois jeitos como `formato.ts` lê, segurando um
arquivo aberto enquanto outro processo tenta `fs.renameSync('<arquivo>.parcial',
'<arquivo>')`) deu **100% de falha** (`EPERM`) em 600 tentativas (300 de cada
variante). Não é caso raro do NTFS sob carga — é o comportamento normal. Com o mesmo
handle fechado depois de um tempo realista de leitura (5–25 ms) e retentativa (3
tentativas, 50 ms de espera), **100% de sucesso**, sempre na segunda tentativa.

**Por que importava.** `packages/snapshot/src/formato.ts` gravava direto no arquivo
final (`fs.createWriteStream(arquivo, {flags:'w'})`, que trunca no `open`) — quem lesse
durante a escrita via arquivo ausente ou truncado, não uma linha rasgada: o arquivo
inteiro, pelo tempo todo da escrita. E o único ponto que já fazia temp+rename
(`tools/snapshot/src/index.ts`, a escrita das queries) fazia `fs.renameSync` sem
nenhuma retentativa — exposto ao defeito medido acima sempre que um pedido de página
estivesse lendo aquele `.jsonl` no instante exato de um refresh.

**Conserto.** `packages/snapshot/src/escrita-atomica.ts` (novo):
`renomeiaComRetentativa`, com 6 tentativas em backoff crescente (25 ms a 800 ms,
~1,575 s de orçamento) só para `EPERM`/`EBUSY` — qualquer outro código de erro sobe na
hora, sem esperar por algo que esperar não resolve. `escreve()` (`formato.ts`) passou a
escrever em `.parcial` e renomear com retentativa **por dentro** — de graça para todo
call-site, inclusive os dois de `calculadas.ts` que nunca tiveram proteção nenhuma
contra isso. `escreveManifesto` (`manifesto.ts`) ganhou o mesmo tratamento, mais
`fsync` antes do rename (o arquivo tem ~5 KB, o custo é ~1 ms, e fecha a janela de
queda de energia entre o rename e o dado estar de fato no disco). `tools/snapshot/src/
index.ts` perdeu o temp/rename manual que já tinha — vira só `escreve(arquivo, …)`.
Testes novos em `packages/snapshot/test/escrita-atomica.test.ts` (lógica de
retentativa, com a função de renomear injetada — sem depender de segurar um handle de
verdade), `formato.test.ts` e `manifesto.test.ts` (handle real aberto, contra a função
de produção — confirmados **vermelhos** antes do conserto, com o `.parcial` nunca
aparecendo).

**O que fica em aberto.** As esperas (25–800 ms) foram medidas contra leituras curtas
(5–25 ms); não há dado real do tempo de leitura de um `.jsonl` de 60 MB sob carga, nem
do comportamento do antivírus do servidor de deploy segurando um handle por mais tempo
que isso — é exatamente a Sonda 2 do plano de atomicidade (30 min no servidor real,
sob o Defender de verdade), que continua pendente por exigir a máquina de produção,
não a de desenvolvimento. Sob carga alta e contínua também é teoricamente possível que
um leitor novo sempre abra o arquivo antes do anterior fechar, esgotando as 6
tentativas — não medido, e diferente do caso testado (um leitor por vez). Verificado
ao vivo contra o Voalle real: `--pagina=capa --refazer`, exit 0, manifesto e as 7
tabelas calculadas regravadas (incluindo o modo isolado por coluna de `Status
Protocolo Dia`), zero `.parcial` órfão em `snapshot/`.

## #80 — A carga incremental foi ligada de verdade ao materializador, e um teste ao vivo pegou um vazamento de parâmetro entre queries

**02/09/2026.** `packages/snapshot/src/incremental.ts` (costura, `decideIncremental`,
`mescla`) sempre foi lógica pura, correta e testada — e **desconectada** do
materializador de produção. `tools/snapshot/src/index.ts` importava `costura`,
`decideIncremental` e `mescla`, mas `grep` confirma: nenhuma das três era **chamada**
em lugar nenhum do arquivo. `--incremental` só pulava o cache de "já em disco"
(`index.ts:458`, forçando rebusca completa de tudo) e imprimia um relatório que lia
`marca`/`modo`/`completoEm` do manifesto — campos que `CabecalhoDeSnapshot` nem
declarava, então eram sempre `undefined`. O comentário em `rodaEmSubprocesso`
("quem decide se a carga é incremental é o filho... mas a intenção é do pai") já
documentava a fiação pretendida; ela nunca foi terminada.

**A fiação que faltava, e por que não era só "chamar as três funções".**
`QueryEngine.execute(queryId)` resolve o SQL pelo **próprio registry**
(`this.#registry.get(queryId).sql`), não pelo array `specs` que `runQueries`
recebe — então o SQL costurado só chega ao banco se o registry em si for alterado
para aquele id. Como `materializa()` roda em processo isolado por query
(`--uma=<id>`, um processo por vez, ACHADOS #46), mutar
`registry.queries.set(q.id, {...q, sql: costurado})` ali dentro é seguro: nada
mais neste processo volta a ler o SQL original desta query depois. `packages/
snapshot/src/incremental.ts` ganhou `planejaBusca` — função pura que decide COMO
buscar (completo ou incremental, e com qual SQL/parâmetro), com 6 testes novos —
para que essa decisão continuasse testável sem tocar o Voalle.

**O bug real que só apareceu rodando contra o Voalle de verdade.**
`packages/transform-engine/src/fonte.ts` não tinha como passar parâmetro de SQL
adiante (`engine.execute(spec.id, {forceRefresh})`, sem `params`). A primeira
versão acrescentou um `params` único para toda a `fonte` — e a primeira tentativa
real de incremental em `protocolos-produtividade` falhou em 752 ms com "Falha ao
ler a fonte da query 'alocacao-patrimonio': Parâmetro sem uso no SQL: desde". A
causa: o M de `protocolos-produtividade` cita `alocacao-patrimonio` como
dependência, e as duas passam pela **mesma** `fonte` dentro do mesmo `runQueries`.
Um `params` sem escopo por id vazava `:desde` para a consulta da dependência, que
não foi costurada — e `traduzParametros` recusou, corretamente ("erra alto nas
duas pontas" é o comportamento documentado, não um defeito dela). Corrigido para
`paramsPorQuery: Record<string, Record<string,unknown>>`, escopado por id — dois
testes novos travam isto: um confirma que o parâmetro chega na query certa, outro
que ele **não** vaza para a dependência que não está no mapa.

**Verificado ao vivo, até onde os dois bloqueios do #81 permitem.** Um fetch
incremental real de `protocolos-produtividade` (cabeçalho patcheado para simular
"última completa há 3 dias", dentro do teto de 7) terminou a busca SQL — a
costura estreitou o suficiente para isso — em 120,8 s, contra os 681,6 s (e
cancelamento por timeout) da carga completa sem nenhum recorte. A comparação
completa (incremental reconstrói o mesmo conjunto que uma carga completa do
mesmo período) **não foi possível**: os dois modos topam com o mesmo bloqueio de
M/SQL descrito no #81, que não tem relação nenhuma com a carga incremental em si
— ele bloquearia igualmente uma carga completa comum. `npm test`: 1521/1521;
as funções de decisão e mesclagem têm cobertura total, a integração está
confirmada até o ponto em que a busca retorna dados.

## #81 — `protocolos-produtividade` não materializa em NENHUM modo hoje: SQL e M calculam as mesmas três colunas, e o full-fetch passou do teto de 600s

**02/09/2026**, achado ao tentar verificar o #80 ao vivo. Dois bloqueios
independentes, nenhum relacionado à carga incremental — uma carga **completa**
comum bateria nos dois do mesmo jeito.

**Bloqueio 1 — colisão de coluna entre SQL e M.** O fetch incremental (que
estreitou a consulta o bastante para terminar) chegou à avaliação de M e parou em:

> Table.RenameColumns: o nome 'HORA CRIADO' ficaria duplicado.

`docs/sql/datahub-protocolos-produtividade.sql` — a SQL de produção migrada em
25/08/2026, idêntica ao `sql:` da spec (travado por
`packages/snapshot/test/incremental.test.ts`) — já seleciona `"HORA CRIADO"`
(linha 340), `"HORA AGENDA"` (linha 341) e `"INSTALADOR"` (linha 414)
**diretamente**. O `m_expression` da mesma spec nunca foi atualizado para essa
migração: ele ainda deriva as três por conta própria —
`Table.AddColumn(..., "Hora", each DateTime.Time([DATA CRIADO]))` + rename para
`"HORA CRIADO"` (linha 5 do M), o mesmo padrão para `"HORA AGENDA"` (linha 25), e
`Table.RenameColumns(#"QUADRO FUNCIONAL Expandido", {{"TECNICO","INSTALADOR"}})`
(linha 61) — sem nenhum `Table.RemoveColumns` antes que descarte as versões que
já vêm do SQL. Confirmado por leitura de ponta a ponta do M: nenhum passo remove
as três antes de tentar recriá-las. O avaliador para na primeira colisão que
encontra no pipeline (`HORA CRIADO`); as outras duas (`HORA AGENDA`,
`INSTALADOR`) ainda não foram alcançadas — resolver a primeira **não** garante
que a query complete sem tocar as outras duas.

Relacionado, não igual: [[proj-instalador-e-union-nao-coalesce]] (memória de
25/08) descreve `INSTALADOR` nascendo de um `Table.Combine` entre
`PROTOCOLOS PRODUTIVIDADE`/`PROTOCOLOS AUXILIARES`, um mecanismo diferente do
`Table.RenameColumns` via join com `QUADRO FUNCIONAL` que este M usa — ambos
terminam produzindo uma coluna `INSTALADOR` que a SQL migrada de 25/08 já
calcula sozinha. As duas investigações apontam para a mesma correção: algo no M
desta query ficou para trás quando a SQL foi migrada, e ninguém terminou de
reconciliar os dois lados.

**Bloqueio 2, independente — o full-fetch passou do teto.**
`npm run snapshot -- --query=protocolos-produtividade --refazer` (sem
`--incremental`, sem costura nenhuma) rodou **681,6 s** e foi cancelado pelo
Postgres por `statement_timeout` — o teto desta execução era **600 s**, já
**3,15× o valor medido em 25/08/2026** por `npm run probe:custo-incremental`
(190,3 s). A query nunca chegou a devolver linha nenhuma, então nem topou com o
Bloqueio 1. Ou o custo cresceu de verdade em oito dias de dado novo, ou o plano
do Postgres mudou (estatísticas, índice, contenção) — não investigado a fundo:
é território de banco/infra, e esta conexão é somente-leitura por desenho.

**Estado real, hoje: `protocolos-produtividade` não materializa em nenhum modo.**
O arquivo em disco (`snapshot/protocolos-produtividade.jsonl`, 70.991 linhas,
`geradoEm`/`completoEm` de 25/08/2026) não pode ser atualizado até um dos dois
bloqueios ser resolvido — e é a query mais pesada, mais otimizada e mais citada
da plataforma (ACHADOS #66–#68, #72–#74, e a Frente de incremental do #80
inteira foi desenhada em cima dela). Nenhum dos dois bloqueios foi corrigido
nesta sessão: o primeiro exige reconciliar o M inteiro com a SQL migrada (risco
de quebrar outro passo que dependa da forma antiga), o segundo exige medição e
decisão de infraestrutura que uma sessão somente-leitura não pode tomar sozinha.
Ver `DEPLOY.md` §2.2 sobre o impacto disto na automação do refresh.

## #82 — `field-agenda` custa 21 minutos e 49 segundos ponta a ponta, não os 22,0s documentados

**02/09/2026**, achado ao rodar o primeiro tick real do Refresh Manager (#84
abaixo). O grupo "quente" original incluía `field-agenda` com a expectativa de
~22,0s — o número citado em `incremental.ts` e no briefing da Frente 3 de
automação. A materialização real (`--query=..., field-agenda, ...` dentro do
tick) levou **1.308.770 ms** — 21 min 49 s.

**A causa: dois custos diferentes, com o mesmo rótulo.** Os 22,0s vêm de
`npm run probe:custo-incremental`, que mede só o `SELECT` contra o `dbVoalle`,
isolado — sem a camada M, sem `toDatasetRows`, sem escrever em disco (o próprio
cabeçalho do arquivo diz que é essa a medição). A materialização de verdade
(`tools/snapshot/src/index.ts --uma=field-agenda`) soma busca + M (o `LEFT JOIN`
com `person_skills` que infla a tabela por skill, decisão vigente do achado #2)
+ conversão de 642.365 linhas × 26 colunas + colunas calculadas + `escreve()`.
Nenhum documento existente media essa segunda parte para esta query.

**Impacto imediato:** o grupo "quente" de `specs/_catalog/refresh.yaml` tinha
`field-agenda` numa cadência de 15 minutos — logicamente impossível, a query
sozinha já custa mais que o intervalo do grupo inteiro. Removida do arquivo até
ser remedida.

**Causa raiz, encontrada por instrumentação — não é a hipótese (a)/(b)/(c) que
este achado levantava antes de medir por etapa.** `tools/snapshot/src/index.ts`
(`materializa()`) ganhou timing por fase (busca, M, `toDatasetRows`, colunas
calculadas, `escreve()`) para responder isto. Rodando `field-agenda` de novo,
isolada (`node --uma=field-agenda`, para ver o próprio stderr — o modo pai
absorve o stderr do filho e só mostra a linha final):

```
busca field-agenda: 643.353 linha(s), 18886 ms banco/rede + 6 ms conversão
busca + avaliação de M: 20503 ms
toDatasetRows: 615 ms
7 coluna(s) calculada(s) em 958194 ms      <- aqui
escreve(): 15709 ms
```

**Busca + M + conversão somam 21,1 s — batendo quase exato com os 22,0s
documentados.** O número antigo não estava errado; media exatamente o que dizia
medir. A hipótese (a) era a certa, mas incompleta: faltava a etapa que ninguém
tinha cronometrado porque não existia quando a query era só SQL.

**Os 958.194 ms (15 min 58 s) são `materializaColunas` — as 7 colunas
calculadas de DAX de `FIELD AGENDA`.** É a mesma classe de defeito dos
achados #66/#67: o avaliador de DAX perde desempenho compartilhando processo
numa tabela grande (ali, 30.404 linhas de `Status Protocolo Dia` custavam 36×
mais que isoladas; aqui são 643.353 linhas — 21× mais linhas que aquele caso).
A correção que #67/#68 já validaram e comprovaram (**um processo por
coluna calculada**, `tools/snapshot/src/calculadas.ts`, `congelaIsolada`) nunca
foi estendida para este caminho: `calculadas.ts` isola colunas de TABELAS
CALCULADAS que já estão em disco (cada filho `carrega()` o snapshot e computa
uma coluna); `materializaColunas()` dentro de `materializa()`, em
`index.ts`, calcula colunas de QUERY logo depois da busca, sobre linhas que
só existem na memória do processo pai — nenhum filho tem de onde ler ainda.
Estender a isolação para cá exigiria gravar as linhas cruas num arquivo
temporário antes de spawnar os filhos (o que `calculadas.ts` não precisa
fazer, porque a origem dele já está em disco).

**A variância entre execuções também é real, e não só o total.** A mesma
query, rodada de novo (isolada, para pegar o stderr): 995.074 ms — 16 min 35 s,
5 minutos a menos que a primeira medição (21 min 49 s) dentro do tick. Ambas
enormes frente aos 22,0s, mas a diferença ENTRE elas (~30%) sugere que o
custo de `materializaColunas` aqui não é só função do tamanho da tabela — tem
componente de carga da máquina (a mesma nesta sessão vinha de rodar
`protocolos-geral` duas vezes seguidas, estourando heap nas duas). Não
isolado desta investigação.

**O alcance é maior que `field-agenda`.** `grep 'calculated: true'` nas 11
tabelas de `specs/_catalog/tables/` com coluna calculada mostra 7 QUERIES
(não tabelas calculadas independentes — essas já passam por `calculadas.ts`,
que tem a isolação) cujas colunas calculadas rodam pelo caminho inline de
`materializa()`: `apuracao-premiacao` (1), `clima-tempo` (1), `field-agenda`
(7), `protocolos-geral` (**13** — mais que `field-agenda`), `protocolos-
produtividade` (3), `reincidencia` (2), `retorno-prioritario` (1). As duas
últimas têm poucas linhas (1.350 e 258, medido ao vivo) e não devem sofrer o
mesmo custo; `protocolos-geral`, com 13 colunas e uma tabela grande, é
candidata a que este MESMO mecanismo contribua para o estouro de heap do
achado #83 — não confirmado, porque a query não termina de buscar para
chegar lá.

**Não corrigido nesta sessão** — é uma peça de engenharia do tamanho de
`congelaIsolada()` (~150 linhas), tocando o caminho de materialização de toda
query com coluna calculada. Registrado para decisão: vale estender a
isolação para cá — o que talvez destrave `protocolos-geral` de graça —, ou o
custo de ~16 min em `field-agenda` é aceitável para uma query que, mesmo sem
cadência automática, ainda precisa rodar no passe diário (`--todas`)?

## #83 — `mysql2` não está instalado nem declarado: toda query que toca dbMaria, direta ou por junção de M, crasha

**02/09/2026**, mesmo tick. `protocolos-geral` (grupo "quente", `datasource:
dbVoalle`) falhou com:

> Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'mysql2' imported from
> packages/query-engine/src/connectors-sql.ts

**Causa.** O M de `protocolos-geral` faz `Table.NestedJoin` com
`GESTORES EQUIPES` (`specs/_catalog/queries/protocolos-geral.spec.yaml:201`) —
a query `gestores-equipes`, `datasource: dbMaria`. Buscar essa dependência aciona
`createMariaPool()` (`packages/query-engine/src/connectors-sql.ts:387`), que faz
`await import('mysql2/promise')` — e `mysql2` **não existe em `node_modules` nem
em `package.json`** (`npm ls mysql2` devolve vazio; `pg`, o driver do Voalle,
está presente normalmente). O import é dinâmico, não estático: por isso o
módulo inteiro carrega sem erro (confirmado importando `connectors-sql.ts`
isolado) e só quebra quando uma busca de verdade precisa da conexão MariaDB —
o que explica por que só esta query, entre as nove do grupo, falhou.

**Alcance confirmado por leitura, não suposição.** Além das 3 queries
nativamente `dbMaria` (`gestores-equipes`, `backlog-instalacao`,
`backlog-agendado-futuro` — já fora de `refresh.yaml`, ACHADOS #80),
`grep -rl "GESTORES EQUIPES\|BACKLOG" specs/_catalog/queries/*.spec.yaml`
mostra que só `protocolos-geral` cita uma dessas tabelas entre as outras 20
queries — nem `protocolos-auxiliares` (a irmã quase-clone dela,
[[proj-instalador-e-union-nao-coalesce]]) faz essa junção.

**Corrigido — e a causa era mais interessante que "faltou instalar".**
`package.json` já tinha um driver de MariaDB: `mariadb@3.5.3`, em
`devDependencies`. Só que `MysqlPoolLike` — a interface que `mariaRunner`
implementa contra o pool (`query(sql): Promise<[Row[], unknown]>`,
`execute(sql, values): Promise<[Row[], unknown]>`, o retorno em tupla) — é a
API do `mysql2`, não a do pacote `mariadb` (formato de retorno diferente,
sem `execute` com essa assinatura). `grep` confirma: `mariadb` nunca é
importado em lugar nenhum do `.ts` do repositório. Alguém declarou o driver
errado — ou trocou de driver no código sem atualizar `package.json` — e
ninguém notou porque nenhuma query dbMaria tinha rodado desde então.
Consertado: `npm uninstall mariadb && npm install mysql2 --save-dev`
(mesma categoria de `pg`, o driver do Voalle). `npm test`: 1551/1551.

**Mas `protocolos-geral` continua sem materializar — motivo novo.** Com o
`mysql2` certo, o erro de módulo desaparece (confirmado: `import('mysql2/
promise')` resolve), mas a busca completa **estoura o heap mesmo com 8192 MB**
— metade da RAM desta máquina de 16 GB (medido: falha aos 129s numa tentativa,
164s noutra, sem completar). O evaluador de M mantém todo passo vivo ao mesmo
tempo (mesmo desenho documentado em `tools/snapshot/src/index.ts:9-15`), e o M
de `protocolos-geral` tem dezenas de passos nomeados sobre uma tabela grande —
dar mais heap não é solução viável aqui: 8 GB já é metade da máquina, e os
16 GB inteiros não sobrariam nada para o SO. Isto não é o mesmo achado que o
`mysql2` — é um bloqueio **arquitetural** separado, que só ficou visível depois
de destravar o primeiro. `protocolos-geral` continua fora de `refresh.yaml`.

## #84 — O Refresh Manager existe: tick, cadência por grupo, `refresh-status.json`, e um primeiro tick real que já pagou a própria auditoria

**02/09/2026.** `tools/refresh/` (novo): `tools/refresh/src/index.ts` roda um
**tick** — lê `specs/_catalog/refresh.yaml`, decide o que está vencido (idade
desde o último **sucesso**, não da última tentativa — uma falha não espera o
intervalo inteiro de novo, o próprio próximo tick já é o retry), roda os grupos
vencidos **em série** (nunca em paralelo, mesmo dentro de um tick — dois grupos
concorrentes fariam `leManifesto` → mescla → `escreveManifesto` como um
read-modify-write clássico entre processos, e a escrita atômica do #79 não
cobre esse caso) e grava `snapshot/refresh-status.json` depois de CADA grupo,
não só no fim. Sem daemon 24/7: cada tick nasce, faz o que está vencido, morre —
o gatilho fica por conta do Agendador de Tarefas do Windows (não configurado
nesta sessão; ver `DEPLOY.md` §2.2).

`GET /api/saude` ganhou o bloco `refresh` (lido de `refresh-status.json`, com
`try/catch` — rota de operador, não é caminho quente, então um `readFileSync` a
mais aqui não paga o preço que pagaria em `carimboAtual()`).

A decisão (`estaVencido`/`proximoStatus`) e a orquestração
(`executaTick`, com relógio e execução injetáveis) são funções puras — 11
testes cobrem "só o vencido dispara", "série nunca sobreposta", "falha num
grupo não trava os seguintes" e "persiste depois de cada grupo, não só no
fim". `tools/refresh/src/grupos.ts` valida `refresh.yaml` contra o Query
Registry real e recusa carregar se `protocolos-produtividade` (achado #81)
aparecer em qualquer grupo — trava em código, não só em comentário.

**O primeiro tick real (contra o Voalle ao vivo, grupos "quente" e "medio" do
`refresh.yaml` original) encontrou os achados #82 e #83** — exatamente o
trabalho que uma ferramenta de refresh automático deveria expor mais cedo ou
mais tarde, só que mais cedo. `refresh.yaml` foi ajustado depois: `quente` sem
`protocolos-geral` (#83) e sem `field-agenda` (#82), restando as 6 queries
baratas medidas ao vivo (~11s somados); `medio` sem alteração (~24s ao vivo,
perto dos ~35s do full-fetch por SQL isolado). `npm test`: 1549/1549.

**Não feito nesta sessão:** a tarefa do Agendador de Tarefas do Windows em si
(criar uma tarefa agendada é mudança persistente no sistema operacional, fora
do escopo de uma sessão que só devia mexer no repositório sem confirmação
explícita); cadência para as 7 fontes não medidas (dbMaria/gsheets/web,
ACHADOS #80); e `field-agenda`/`protocolos-geral` continuam de fora até #82/#83
serem resolvidos.

## #85 — A hipótese do #82 (processo compartilhado) estava ERRADA para `field-agenda`: isolar por coluna piorou o total em 18%

**02/09/2026, mesma sessão do #82/#83/#84.** O #82 apontava `materializaColunas`
como "a mesma classe de defeito dos achados #66/#67" — o avaliador de DAX
perdendo desempenho por compartilhar processo entre colunas — e propunha a
mesma correção que resolveu aquele caso: um processo por coluna calculada
(`congelaIsolada()`, já provado em `calculadas.ts`). Foi construído: `mysql2`
fix e `protocolos-geral` deixados de lado (#83), e a extensão da isolação para
o caminho de query (`materializaColunasDaTabela`, novo, em
`tools/snapshot/src/index.ts`) — um modo neto (`--coluna-tabela=`) que
calcula UMA coluna calculada isolada, lendo linhas físicas de um arquivo de
entrada que o processo pai escreve antes de spawnar os filhos.

**Validado como CORRETO antes de medir o ganho.** `FIELD AGENDA` tem colunas
calculadas que citam colunas-irmãs da mesma tabela —
`RankAtualProtocolo` lê `RankDataProtocolo`, `CategoriaProdutividade` lê
`ClassificacaoRelato` — e isolar por processo só é seguro se isso continuar
funcionando sem as duas estarem juntas. Confirmado em `evaluator.ts:275-329`:
`columnValue` resolve dependência entre colunas calculadas da MESMA tabela
**recursivamente e sob demanda**, memorizando por linha, com guarda de ciclo
(`columnStack`) — não depende de ordem de cálculo nem de as duas estarem no
mesmo processo. Dois testes novos em
`packages/snapshot/test/colunas-calculadas.test.ts` cobrem isto, e um teste
ao vivo contra o DAX real de `RankAtualProtocolo`/`RankDataProtocolo` (3
linhas sintéticas) confirmou o valor certo vindo de um processo que nunca
calculou a coluna-irmã explicitamente.

**Um bug real pego a tempo pelo teste, antes de rodar ao vivo em escala.** A
primeira versão do merge só escrevia a coluna calculada de volta em `rows` sob
a chave NORMALIZADA (`row['turno']`). Mas `columns` — a lista que o
`escreve()` final usa para gravar — recebe o NOME DE EXIBIÇÃO
(`row['Turno']`), que é como o caminho não isolado sempre gravou. Sem a
correção, toda coluna isolada sairia `null` no arquivo final — o defeito
"plausível e errado" do #54, de novo. Pego por um smoke test de CLI com
arquivo sintético antes de gastar 19 minutos contra o banco.

**A medição ao vivo, com tudo correto, refutou a hipótese.** `field-agenda`
hoje tem 643.797 linhas (não 1,46 milhão — o dado encolheu desde o #46
original). Isolado (`--isolar-colunas`, todas as 7 colunas em processos
próprios):

```
FIELD AGENDA: 7 coluna(s) calculada(s) em 643.797 linha(s) — um processo por coluna
  [Data] 12.548 ms
  [RankDataProtocolo] 105.201 ms
  [RankAtualProtocolo] 863.634 ms      <- 76% do total, sozinha
  [ClassificacaoRelato] 25.635 ms
  [CategoriaProdutividade] 28.531 ms
  [Turno] 11.860 ms
  [Status SLA] 15.143 ms
7 coluna(s) calculada(s) em 1.134.756 ms
```

Total isolado: **1.135 s.** Total compartilhado, documentado no #82 (linhagem
comparável): **958 s.** Isolar piorou em **18%** — o oposto do #66/#67.

**A causa real: uma coluna com custo intrínseco ao próprio DAX, não ao
processo.** `RankAtualProtocolo` sozinha, num processo que não fez mais nada,
custou 864s — mais que os 958s do caminho INTEIRO compartilhado. A expressão é
`CALCULATE(MAX('FIELD AGENDA'[RankDataProtocolo]), FILTER('FIELD AGENDA',
[protocolo] = ProtocoloAtual))`: por linha, filtra a tabela inteira pelo mesmo
protocolo e agrega `MAX` sobre uma OUTRA coluna calculada (que por sua vez
also faz `FILTER` da tabela inteira) para cada linha do subconjunto. O custo
é de algoritmo — quadrático ou pior em cima de grupos —, não de quantas
colunas dividem o processo. Isolar não tem como ajudar isto; só um DAX
diferente (ou uma pré-agregação em JS fora do avaliador) resolveria.

**Decisão: a isolação fica no código, mas OFF por padrão.** Ligar por padrão
(como `calculadas.ts` faz) regrediria o refresh normal de `field-agenda` em
18% sem ganho nenhum. Virou `--isolar-colunas` — opt-in explícito,
`Args.isolarColunas` em `tools/snapshot/src/index.ts` — para o dia em que
valer medir de novo contra outra tabela (candidata natural: `protocolos-geral`,
13 colunas calculadas, que estoura heap em 8 GB — ACHADOS #83. Isolar É um
mecanismo de MEMÓRIA além de tempo: cada filho nasce, calcula uma coluna e
morre, o que limita o pico de heap a "uma tabela + um avaliador" em vez de
"uma tabela + N avaliadores". Isto NÃO foi testado — `protocolos-geral` nem
chega a terminar a busca para alcançar esta etapa).

**Achado incidental, não corrigido: `daxSha` nunca chega ao arquivo final
neste caminho.** `materializa()` acumula um `Map<coluna, sha>` ao longo do
laço de tabelas, mas o `escreve()` do arquivo final não recebe esse mapa como
5º argumento — só `columns` e `rows`. Conferido no `field-agenda.jsonl`
gerado nesta sessão: as 7 colunas calculadas têm `nulos` plausíveis (não é o
defeito do #54), mas nenhuma tem `daxSha` no cabeçalho. O guarda de DAX
desatualizado (`carrega.ts`, o mesmo que os testes de `colunas-calculadas.ts`
cobrem para tabela calculada) não está armado para coluna calculada de QUERY
— mudar o DAX no Power BI e reextrair não seria detectado aqui. Pré-existente
a esta sessão; fora de escopo, registrado para decisão própria.

`npm test`: 1553/1553 (2 testes novos).

## #86 — `field-agenda` de 958s para 21s: a causa era o grão duplicado (relato × skill), não o processo. `RankDataProtocolo`/`RankAtualProtocolo` calculadas por grão reduzido

**02/09/2026, resposta ao #85.** O #85 fechou dizendo que o custo de
`RankAtualProtocolo` (864s sozinha) era "intrínseco ao próprio DAX" e que "só
um DAX diferente... resolveria". Isso era verdade sobre o DAX rodando no
CONJUNTO ERRADO de linhas — não sobre o DAX em si.

**O que já estava escrito e não tinha sido lido até agora:**
`docs/DECISAO-GRAO-FIELD-AGENDA.md` (12/08/2026) já tinha mapeado que os
`LEFT JOIN`s de `reports`/`people`/`skills` multiplicam cada **slot** por
(**relato** × **skill**) — é esse join, não o volume de histórico, que infla
a tabela para 643-645 mil linhas. E o documento já provava, coluna por
coluna, que `Turno`/`Status SLA` "saem de `vsdspi` (grão de slot)". Nunca foi
aplicado às duas colunas mais caras porque o documento tratava de OUTRO
problema (agregação para os VISUAIS, passo 4 da `DECISAO-DESEMPENHO`) — a
pergunta desta sessão era sobre COLUNAS CALCULADAS, e ninguém tinha cruzado
os dois antes de medir.

**A prova, coluna por coluna.** Das 7 calculadas de `FIELD AGENDA`, 5 só
citam campos de origem `vsdspi` (o lado SEM os joins): `Data`
(`DATEVALUE([Slot Agenda])`), `RankDataProtocolo`/`RankAtualProtocolo`
(`[Protocolo]`+`[Slot Agenda]`), `Turno` (`[Slot Agenda]`), `Status SLA`
(`[Prazo SLA]`). Só `ClassificacaoRelato`/`CategoriaProdutividade` citam
`[Relato]`, que vem de `reports` — essas continuam precisando do grão fino.

**Por que calcular uma vez por slot e copiar é EXATO, não aproximado.**
Duas linhas iguais em toda coluna de origem `vsdspi` são, por construção do
`LEFT JOIN`, a MESMA linha de origem antes dos joins — qualquer DAX que só
cite essas colunas dá o mesmo valor nas duas, sempre. E as duas colunas mais
caras têm uma segunda garantia, agora comprovada por medição (não só
argumento): `RankDataProtocolo` passa as linhas por `DISTINCT` antes do
`RANKX` — duplicar uma linha do grupo filtrado não muda o `DISTINCT` — e
`RankAtualProtocolo` agrega com `MAX`, que é idempotente sob duplicação.

**Construído:** `materializaColunasPorGrao()`
(`packages/snapshot/src/colunas-calculadas.ts`) — agrupa linhas por uma
CHAVE de colunas físicas, chama `materializaColunas` só na primeira linha de
cada grupo, copia o valor para as demais. `tools/snapshot/src/index.ts`
ganhou `GRAO_REDUZIDO_DE`, um `Map` explícito (não inferido por AST — uma
lista errada aqui produz número errado calado, e "confira à mão contra o
SQL" é mais seguro que "confie na análise automática" quando o preço de
errar é esse) declarando, para `field-agenda`, a chave (as 14 colunas de
`vsdspi`) e as 5 colunas elegíveis. Roda ANTES do caminho normal
(`materializaColunasDaTabela`), que continua computando o resto
(`ClassificacaoRelato`/`CategoriaProdutividade`) sobre a tabela inteira —
sem filtro nenhum passado a ele, porque `columnValue` já devolve as 5
grão-reduzidas na hora (memoizadas), de graça.

**Um bug pego pelo próprio teste antes da medição ao vivo.** `Dataset.
adotaTabela()` erra alto se qualquer linha tiver chave não normalizada
(`dataset.ts:78-97` — "sem isso o avaliador não acharia a coluna e
devolveria BLANK, calado"). A primeira versão do broadcast escrevia a chave
de EXIBIÇÃO (`row['Data']`) além da normalizada, e como as representantes
SÃO as próprias linhas de `rows` (mesma referência, para não copiar 645 mil
linhas), essa chave vazava para o array inteiro — e a chamada seguinte
(`materializaColunasDaTabela`, que revisita a tabela inteira para as duas
colunas de grão fino) quebrava o `adotaTabela` com "a chave 'Data' não está
normalizada". Reproduzido ao vivo primeiro (a mensagem de erro é literal),
corrigido apagando a chave de exibição das representantes logo após
calculá-las — quem repõe, para TODAS as linhas de uma vez, é a passada
seguinte, que sempre roda depois. Um teste novo reproduz exatamente esta
sequência (`depois de materializaColunasPorGrao, uma segunda passada não
quebra`) para não voltar.

**Validado em duas camadas antes de confiar no número:**

1. **Sintético, com o padrão real de DAX** — `FILTER`+`DISTINCT`+`RANKX` e
   `CALCULATE`+`MAX`, a MESMA forma de `RankDataProtocolo`/
   `RankAtualProtocolo` — comparando `materializaColunasPorGrao` contra
   `materializaColunas` no conjunto INTEIRO duplicado. Resultado idêntico,
   não só argumentado (`colunas-calculadas.test.ts`).
2. **No dado real, pós-materialização** — amostra de 300 protocolos
   (17.731 linhas) do `field-agenda.jsonl` recém-gravado, recalculando
   `RankDataProtocolo`/`RankAtualProtocolo` por FORÇA BRUTA
   (`materializaColunas` direto, sem grão) e comparando contra o valor que
   o grão reduzido gravou. **Zero divergências.**

**O número, medido ao vivo (não o mesmo dia do #85 — o dado mudou, 645.664
linhas contra 643.797, mas a ordem de grandeza do ganho é o que importa):**

```
5 coluna(s) calculada(s) por grão reduzido em 4.621 ms
7 coluna(s) calculada(s) em 16.539 ms          <- as 2 de grão fino + revisita grátis das 5
```

Total das colunas calculadas: **21.160 ms** — contra os **958.194 ms**
(quase 16 min) do #82, e os **1.134.756 ms** (pior ainda) da isolação por
processo do #85. **~45× mais rápido que o caminho original, sem nenhum
processo a mais** — é ganho de algoritmo (varrer ~11 mil protocolos em vez
de 645 mil linhas), não de paralelismo. `field-agenda` inteira (busca + M +
colunas + escreve): **79.290 ms** — contra os ~22 minutos documentados no
#82.

**Isto não substitui o mecanismo do #85** (`--isolar-colunas`, agora
provavelmente sem uso para `field-agenda` — o gargalo que ele mirava
sumiu). Continua disponível para `protocolos-geral` ou outra tabela onde a
causa seja de fato processo compartilhado, não grão duplicado — e vale
checar SE `protocolos-geral` tem o mesmo padrão de joins multiplicadores
antes de tentar isolar por processo de novo: se tiver, `GRAO_REDUZIDO_DE`
é provavelmente o remédio certo lá também.

`npm test`: 1556/1556 (4 testes novos).

---

## #87 — `FIELD AGENDA` deixou de carregar 645 mil linhas em TODA abertura de página: arquivo trocado por baixo conforme o pedido precisa ou não de coluna de relato

**02/09/2026, continuação do #86.** O #86 corrigiu o pior sintoma (colunas
calculadas recalculando por linha duplicada), mas não mexeu na causa: **toda
carga de `agendamento-field` continuava lendo as 645 mil linhas inteiras**,
mesmo quando o visual pedido só usava colunas de grão de slot
(`Protocolo`, `Status Protocolo`, `Turno`, `Status SLA`...). `carrega()` não
tinha nenhuma redução de LINHA — só a de coluna (`sob_demanda`, vazio desde
24/08).

**Por que não virou duas tabelas no modelo.** A primeira ideia — uma tabela
`FIELD AGENDA SLOT` própria — foi desenhada e descartada depois de um Plan
agent achar o custo real: ~20 medidas de `field-agenda.measures.yaml` citam
`'FIELD AGENDA'` por nome dentro do DAX (nome de medida é global, teriam de
duplicar), `specs/_catalog/relationships.yaml` é um arquivo só sem lugar para
uma segunda aresta, e a página `visao-geral` filtra por
`'FIELD AGENDA'[Data]` num card que nem lista a tabela em `entities_used`.
Reapontar visual não seria trocar `entity`; seria auditar medidas,
relacionamento e filtro de página em pelo menos 3 telas.

**O desenho que ficou: UMA tabela, ARQUIVO trocado por baixo, por pedido.**
Nenhuma spec de dashboard, medida ou relacionamento mudou. O que muda é qual
arquivo de snapshot alimenta `FIELD AGENDA` numa carga específica:

- **Nova query `field-agenda-slot`**
  (`specs/_catalog/queries/field-agenda-slot.spec.yaml`, à mão — não existe
  no PBIP, registrada em `docs/SPEC-DRIVEN.md`): mesmo SQL de `field-agenda`
  em `v_service_desk_slots_productivity_informative`, mesma janela de 3
  meses, mas troca o `LEFT JOIN reports/people/skills` por
  `EXISTS (SELECT 1 FROM reports r WHERE r.assignment_id = ... AND r.title
  NOT LIKE ...)` — preserva a EXISTÊNCIA da linha (o "LEFT JOIN que na
  prática é INNER JOIN" que `docs/DECISAO-GRAO-FIELD-AGENDA.md` já
  documentava) sem multiplicar por relato nem skill.
- **`specs/_catalog/projecao.yaml` ganhou `grao_reduzido`** (mesmo arquivo
  mantido à mão do `sob_demanda`, mesma validação "erra alto se faltar
  campo"): declara, para `FIELD AGENDA`, `query_padrao: field-agenda-slot`,
  `query_completa: field-agenda`, e as 7 `colunas_gatilho` que só existem no
  lado com join (`ClassificacaoRelato`, `CategoriaProdutividade`,
  `Descrição`, `Relato`, `Data Relato`, `Relator`, `Skill`).
- **`carrega()`** (`packages/snapshot/src/carrega.ts`) resolve, por tabela
  com entrada em `model.graoReduzido`, qual arquivo ler: `queryPadrao` por
  padrão, `queryCompleta` só quando a tabela está no novo
  `opts.precisaFormaCompleta`. `Dataset`/`Evaluator` não sabem que grão
  existe — recebem uma tabela com menos linhas e menos colunas físicas,
  exatamente como já tratam qualquer coluna omitida.
- **`apps/api/src/servidor.ts`** decide por pedido: `sobDemandaDoVisual`
  passou a varrer `v.fields` **e `v.filters`** (antes só fields — lacuna
  real) contra `colunasGatilho`, e um novo `tabelasCompletasDaPagina` varre
  filtro de PÁGINA. As tabelas que precisam da forma completa entram na
  CHAVE DE CACHE junto com as colunas liberadas — sem isso, dois pedidos com
  o mesmo `libera` mas grão diferente colidiriam no mesmo `Carregado` (bug
  concreto, não hipotético, que a mudança fecha de graça).
- **Erro alto preservado, mensagem melhor.** `Evaluator.columnValue`
  (`packages/measure-engine/src/evaluator.ts`) já lançava `DaxEvalError`
  para coluna do modelo ausente nos dados — confirmado por teste antes de
  mexer em qualquer coisa. Só ganhou uma segunda frase citando
  `grao_reduzido` quando a tabela tem entrada lá, para quem for debugar em
  produção não precisar redescobrir o mecanismo.

**Um gap real que só apareceu ao vivo.** `tools/snapshot/src/calculadas.ts`
também chama `carrega()` — sem `precisaFormaCompleta`, passou a receber a
forma enxuta por padrão e quebrou `Status Protocolo Dia`'s `Base Dia`
(lê `'FIELD AGENDA'[Relato]`) com o `DaxEvalError` novo. O plano só previa
`servidor.ts`; auditar os OUTROS chamadores de `carrega()` não estava na
lista. Corrigido com um helper novo, `todaFormaCompleta(model)`
(`carrega.ts`), aplicado a `calculadas.ts`, `layout/extrai.ts`,
`layout/golden.ts`, `paridade/index.ts`, `paginas/index.ts` e
`powerbi/index.ts` — todos ferramentas em lote sem contexto de pedido, que
precisam de correção, não de velocidade. `tools/bench/src/carga.ts` foi
deliberadamente deixado de fora (confirmado por grep: nunca avalia visual,
só mede o tempo do próprio `carrega()` — é ele quem deve continuar medindo a
forma rápida, que é a realidade nova).

**Falso positivo pego por disciplina, não por sorte.** A primeira
verificação `field-agenda-slot` vs. `field-agenda` (chave `Protocolo`+`Slot
Agenda`) achou 77+24 chaves divergentes e 12 diferenças em
`RankAtualProtocolo`. Em vez de concluir que o `EXISTS` estava errado,
testei a hipótese de deriva de tempo — as duas materializações rodaram horas
separadas contra um banco vivo, cada uma com sua própria janela deslizante
de 3 meses. Rematerializando as duas de novo, ~65s uma da outra: **zero
divergências** em tudo. O SQL nunca esteve errado; a comparação é que
precisa ser feita perto no tempo.

**Os números, medidos ao vivo (`agendamento-field`, banco real):**

```
carrega() forma padrão .... 484 ms  |   41.853 linhas
carrega() forma completa .. 3.156 ms | 648.821 linhas
```

~6,5× mais rápido e ~15,5× menos linhas no caminho comum — mais linhas que
os ~30 mil estimados no plano (a estimativa era um teto de slots distintos,
não a contagem real pós-`EXISTS`; o número medido é este, não aquele).
Através do HTTP de verdade (`servidor.ts`, sessão real via
`POST /auth/interno`):

```
página inteira, sem ?visual= (fria após invalidar cache) ... 2,13 s
mesmo pedido, quente ......................................... 45 ms
visual 815c0959 (Protocolo, sem gatilho) ..................... 45 ms quente
visual 084be384 (ClassificacaoRelato/Relato/Descrição) ....... 3,09 s fria, resolve certo, 42 ms quente
```

E o aquecedor de produção mediu `agendamento-field` em **0,70s a frio** no
arranque — contra os "~2 min" que o próprio comentário de
`apps/api/src/aquecedor.ts` registrava como o custo histórico da página sem
reaquecimento.

**Efeito colateral encontrado e corrigido, não regressão.** Rematerializar
`field-agenda`/`field-agenda-slot` avançou o carimbo de "materialização mais
recente das tabelas de origem" para o snapshot inteiro, e duas páginas sem
relação nenhuma com `FIELD AGENDA` (`visao-geral`, `relatorio-do-mes`)
passaram a responder 409 — `CALENDARIO CRIADO`/`CALENDARIO AGENDAMENTO`
congeladas antes desse carimbo. É a guarda de idade (`confereIdadeDaCalculada`)
funcionando exatamente como projetada: falha alta em vez de servir dado
velho calado. Corrigido rodando
`node tools/snapshot/src/calculadas.ts --todas`.

**Verificação em navegador de verdade** (`npm run tela -- --pagina=agendamento-field`,
Playwright + `/auth/interno`, o mesmo login sem Google que `tools/subir`
usa): 8 combinações (2 temas × 4 resoluções), **0 problemas** — nenhum card
mais alto que a tela, nenhuma rolagem horizontal, nenhum contraste abaixo de
4,5:1.

`npm test`: 1562/1562 (6 testes novos).

**Fora de escopo, registrado para não esquecer:** `field-agenda`/
`field-agenda-slot` em `specs/_catalog/refresh.yaml` (cadência automática);
`PROTOCOLOS GERAL` como candidata ao mesmo padrão de grão reduzido (13
colunas calculadas, achados #83/#85) — não investigado se tem o mesmo join
multiplicador.

---

## #88 — O "dado desatualizado" de `agendamento-field` não era o #87: era `clima-tempo` travada há 27 dias, e o benchmark de carga estava quebrado

**03/09/2026.** Pergunta direta: *"como está a velocidade de carregamento e por
que estamos com essa mensagem [dado desatualizado — 07/08/2026]"*. As duas
respostas vieram de lugares diferentes do que o #87 mexeu.

**A mensagem não é sobre `FIELD AGENDA`.** `dadoDe` de uma página é a
materialização **mais antiga** entre as tabelas que ela usa
(`packages/snapshot/src/carrega.ts`, comentário próprio: *"a tela promete que
nada ali é mais velho que a data mostrada"*). Lendo o manifesto de verdade
(`leManifesto`, campos `query`/`geradoEm`, não os que eu tinha suposto de
memória na primeira tentativa) para as 7 tabelas de `agendamento-field`:

```
clima-tempo         -> 2026-08-07T19:12:54.718Z   <- a mais antiga de TODO o snapshot
capacidade-equipe   -> 2026-08-24T18:00:34.742Z
protocolos-geral    -> 2026-08-25T20:30:11.053Z
hora-atualizado     -> 2026-09-02T14:22:22.733Z
field-agenda(-slot) -> 2026-09-02T21:00:30/53Z    <- rematerializada no #87, no dia anterior
```

`FIELD AGENDA` está fresca. Quem carimba a página é `Clima/ Tempo`.

**Por que `clima-tempo` parou.** Não é falta de cadência (embora também não
tenha — é uma das "7 fontes nunca medidas isoladamente" que `refresh.yaml`
deixa de fora de propósito). É um bug de verdade: `--refazer` reproduziu em
6,5s um erro do nosso interpretador de M, correto por sinal —
`if [Precipitacao_mm] = 0` com `Precipitacao_mm` nulo (a API `open-meteo`
devolve isso para algum dia) dá `null`, não `false`, e `if` exige lógico. É o
mesmo erro que o Power BI real acusaria com essa expressão — o M original
sempre teve esse risco, só não tinha sido pego porque nenhum dia tinha vindo
nulo antes de 07/08. Consertado com uma guarda de nulo antes da classificação
(`Table.TransformColumns`, nulo vira 0), registrado em `docs/SPEC-DRIVEN.md`.
Depois do conserto: `clima-tempo` materializa em 6,46s, 1.827 linhas — é uma
query "web" contra uma API pública, não tem nada a ver com o custo de
`FIELD AGENDA`. `dadoDe` do snapshot inteiro saiu de `07/08` para `12/08`
(a nova mais antiga é `apuracao-premiacao`, gsheets, mesma categoria "nunca
medida isoladamente" — fora do escopo de hoje, mas fica registrado).

**Achado colateral, meu, não de produção**: testei o conserto rodando dois
`--refazer` em paralelo (`clima-tempo` numa janela, o grupo `quente` de
`refresh.yaml` noutra) para economizar tempo. Os dois dispararam o
recongelamento automático de `Status Protocolo Dia` ao mesmo tempo, e as duas
instâncias de `calculadas.ts` colidiram no mesmo nome de arquivo temporário em
`snapshot/_parciais/` — uma delas morreu com `ENOENT`. Resolvido rodando
`calculadas.ts --todas` de novo, sozinho. `tools/refresh/src/index.ts` já
documenta que ticks não rodam em paralelo por design (é o agendador externo
quem garante isso); o risco só existe para quem roda `--refazer` à mão em duas
janelas ao mesmo tempo, como eu fiz. Não é conserto de código — é aviso para o
próximo.

**O benchmark oficial do projeto (`npm run bench:carga --paginas`) estava
quebrado**, e não por causa do #87. `tools/bench/src/carga.ts` importa
`aplicaTiposDeclarados` de `carrega.ts` e `decodifica` de `formato.ts` — duas
funções que existem e são usadas internamente há tempos, mas que em algum
ponto perderam o `export` (confirmado por `git log`: não foi o commit do #87,
que nem toca essas linhas). Ninguém tinha rodado a ferramenta desde então para
notar. Devolvido o `export` nas duas — mudança mecânica, sem efeito em
comportamento, `npm test` seguiu 1562/1562 depois.

**Os números, medidos ao vivo agora, com a ferramenta consertada:**

```
npm run bench:carga -- --paginas --pagina=agendamento-field --repete=5
  agendamento-field: 7 tabelas, 115.306 linhas, 463 ms (forma padrão / grão de slot)
```

Contra o HTTP de verdade (`servidor.ts`, sessão via `/auth/interno`), no mesmo
processo que o #87 usou ontem:

```
página inteira, sem ?visual= — fria (cache invalidado pela rematerialização) .. 1,60 s
mesma página, quente .......................................................... 45 ms / 19 ms
visual 815c0959 (sem gatilho) — fria .......................................... 7,33 s*
visual 815c0959, quente ....................................................... 16 ms
visual 084be384 (gatilho de relato, escala p/ forma completa) — fria ......... 3,83 s
visual 084be384, quente ....................................................... 3 ms
```

\* mais alto que o esperado para um visual sem gatilho — o aquecedor automático
do processo de desenvolvimento estava reaquecendo outras páginas ao mesmo
tempo (contenção real, não regressão do #87; a leitura fria de página inteira,
sem essa contenção, ficou em linha com o padrão de ontem).

**A leitura honesta para "melhorou pro realtime?"**: a CARGA ficou
mensuravelmente melhor e continua estável um dia depois (463 ms hoje contra os
484 ms do #87 ontem, mesma ordem de grandeza) — mas carga rápida não é a
mesma coisa que dado fresco. `FIELD AGENDA` nunca teve, e continua sem ter,
cadência automática (21min49s de materialização não cabe em nenhum intervalo
de `refresh.yaml`, achado #82) — ela só atualiza em passe manual. E
`tools/refresh/src/index.ts` é, por desenho, "um tick por disparo externo, sem
daemon 24/7" — não há Agendador de Tarefas configurado batendo nele hoje
(confirmado: nenhum processo `tools/refresh` rodando). Ou seja, o "realtime" de
`agendamento-field` hoje depende de alguém rodar `npm run snapshot`/`npm run
refresh` à mão; nada nas mudanças de código de hoje ou do #87 automatiza isso
— o que os dois consertos garantem é que, quando o dado FOR atualizado, abrir
a página custa milissegundos, não minutos, e que o snapshot não vai mentir
sobre a própria idade.

`npm test`: 1562/1562 (2 esperados atualizados: `cobertura.test.ts` — o corpus
de M ganhou 1 passo com a guarda de nulo, 330→331 — nenhum novo teste
precisou ser escrito, os dois consertos são de re-exportação e de guarda de
tipo já cobertas por teste existente).

---

# Achados abertos de 25–27/08/2026 — os que ainda não têm conserto

> **Por que esta seção está separada e no fim.** Os achados #1 a #76 acima são a memória
> numerada do projeto: o resto da documentação os referencia por número, e eles
> descrevem **comportamento**, sob a decisão vigente de replicar fielmente. Os quatro
> abaixo são de outra natureza — são **defeitos localizados e ainda não corrigidos**,
> com a medição que os isolou e o que já foi descartado, e nasceram num arquivo que
> tinha sido recriado do zero.
>
> **O que aconteceu com este arquivo.** Entre 19 e 26/08/2026 nada foi commitado, a
> árvore de trabalho foi apagada duas vezes por outro agente, e a reconstrução devolveu
> este documento com **217 linhas onde tinha 5.808** — os achados #1 a #76 sumiram
> inteiros. Foram restaurados de `5ce7c20` em 27/08/2026, **fundindo**: nada do que a
> reconstrução escreveu foi descartado, e é o que está abaixo. A história completa está
> em [RECUPERACAO-27-08.md](RECUPERACAO-27-08.md).
>
> Eles ainda não receberam número porque numerar exige saber que nenhum dos 76 acima já
> os cobre — e essa conferência é trabalho, não carimbo.

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
