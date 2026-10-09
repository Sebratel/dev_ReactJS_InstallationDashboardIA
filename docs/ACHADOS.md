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

## #89 — `field-agenda-slot` ganha cadência de verdade, e um "processo custando 4 minutos" que era erro de leitura, não de código

**03/09/2026, continuação do #88.** Ao investigar se dava para dar cadência
automática a `field-agenda-slot` (fora de escopo do #87), medi o custo real de
`--refazer` e o número bateu **4 minutos** onde a query isolada custava 14s.
A caça a essa diferença é o achado, e ela terminou em dois lugares — um erro
meu, e uma ineficiência real do sistema.

**O erro meu primeiro, porque quase virou um consertar-o-que-não-quebrou.**
Suspeitei de antivírus segurando handle de arquivo (risco que `DEPLOY.md` já
registra) e de overhead de `spawnSync` de processo Node. Medi os dois direto —
`node.exe` puro (~65ms) e importar o módulo inteiro de `calculadas.ts` (~200ms)
— e nenhum dos dois explicava nada. A causa: eu estava lendo `[Base Dia]
55.695 ms` como 55,7 milissegundos, quando é **55.695 milissegundos** (a
mesma formatação `.`-como-milhar que já tinha me confundido com "3.156 ms" no
#87). Confirmado batendo a conta contra o próprio "ms/linha" e "projeção"
que o programa já imprime — os dois só fecham se o primeiro número for
milhares, não unidades.

**A ineficiência real, depois de corrigir a leitura**: `calculadas.ts --todas`
não verifica se algo mudou antes de recalcular — todo `Status Protocolo Dia`
(4 colunas, ~50-65s de DAX real cada, achado #53/#67) é recomputado do zero
**sempre**, e `tools/snapshot/src/index.ts` chama isso automaticamente depois
de QUALQUER query que materialize com sucesso — não só as ligadas a
`FIELD AGENDA`. Confirmado rodando `calculadas.ts --todas` duas vezes seguidas
sem nada mudar de verdade: recalculou as 4 colunas as duas vezes. Consequência
prática: o custo real de um tick bem-sucedido de QUALQUER grupo de
`refresh.yaml` — inclusive `quente` e `medio`, que nunca rodaram de verdade
agendados — é a busca da própria query **mais ~4 minutos**, não só a busca. Os
"~11s"/"~35s" já documentados mediam certo, só que a coisa errada. Registrado
em `specs/_catalog/refresh.yaml` (comentário `ATENÇÃO`), não corrigido agora —
é ineficiência de recomputação redundante, não bug de segurança, e a decisão
de consertar antes ou depois de agendar foi explicitamente adiada.

**`field-agenda-slot` ganhou grupo próprio mesmo assim.** Medido ao vivo,
isolado da cascata (`--sem-calculadas`): 13,5s de busca+escrita, 41.348 linhas
— muito abaixo do teto de qualquer cadência razoável. Novo grupo `frio` em
`refresh.yaml`, 30 min (≥4× o custo real de ~4min15s incluindo a cascata, não
só a busca — aplicar a margem só sobre a busca teria sugerido um número
perigosamente pequeno). `field-agenda` (forma completa, 21min49s) continua de
fora, decisão inalterada. Verificado ao vivo: um tick real com os 3 grupos
(todos vencidos, por ser a primeira vez que `frio` existe) — `quente` ok em
323.209 ms (5min23s), `medio` ok em 268.723 ms (4min29s), `frio` ok em
241.903 ms (4min02s), `refresh-status.json` com os três `ok: true`. Rodando
`--plano` de novo logo em seguida, os três aparecem "não vencido" — confirma
que `estaVencido` respeita o intervalo de cada grupo, inclusive o novo.

**Kafka e Redis, investigados via Portainer a pedido do Erick** (achado
completo em `docs/DECISAO-REALTIME.md`, seção "O que existe hoje na infra"):
Redis já funciona (local, em uso real, `MemoryCache+RedisCache`). Kafka tem
só o broker de pé, e mal configurado para uso de fora da rede Docker dele
(`KAFKA_ADVERTISED_LISTENERS` aponta para `kafka:9092`, hostname que não
resolve fora do compose) — confirmado tentando conectar de verdade. Nem o
Kafka Connect com o conector Debezium, nem o slot de replicação no Voalle
(`pg_replication_slots` vazio, mesmo estado de 11/08) existem. Conclusão
igual à de `DECISAO-REALTIME.md`: infra existir não é o mesmo que o caminho
crítico precisar dela, e nenhum dos quatro elos que faltam muda a resposta —
CDC avisaria a tela mais rápido, não tornaria o snapshot mais fresco.

---

## #90 — Realtime sem Kafka: poller de `assignments.modified` + SSE, invalidação cirúrgica de três camadas de cache

**03/09/2026.** Pedido: "parecido com realtime", sem acesso de escrita/replicação
no Voalle (achado #89 já tinha fechado a porta do CDC). Construído
`apps/api/src/poller-realtime.ts`: um `SELECT ... WHERE a.modified >= :desde` a
cada 12s, cujo resultado nunca toca disco — fica num delta em memória, mesclado
com o snapshot só na hora de servir. A tela recebe um SSE (`GET /api/eventos`)
e troca o número sozinha, sem F5.

**Escopo de dado, restrito pelo que existe de verdade — não pelo que seria
ideal.** A candidata óbvia seria `FIELD AGENDA` (o assunto do resto desta
sessão), mas o `sql:` dela não seleciona nenhuma coluna de modificação —
só datas de criação/relato. A única query com `assignments.modified` exposto
E que materializa sem crash é `protocolos-auxiliares`
(`specs/_catalog/realtime-poll.yaml`, nova). `protocolos-geral` tem a mesma
coluna mas trava no achado #83 (M faz `Table.NestedJoin` com `GESTORES
EQUIPES`, dbMaria, `mysql2` ausente) — não tem nem snapshot base para o
poller sobrepor. `contratos`, `contratos-telefonia`, `consolidado-clientes`:
sem coluna de modificação nenhuma. Registrado, não escondido: o poller herda
o mesmo buraco que `incremental.yaml` já documenta para
`protocolos-produtividade` — ~84,2% das mudanças relevantes tocam
`assignments.modified`, o resto (alocação de patrimônio, RAUX) mora em outra
tabela do JOIN.

**Por que a marca é timestamp e não dia — e por que isto não é
`incremental.yaml`.** `costura()`/`mescla()` (`packages/snapshot/src/
incremental.ts`) são reaproveitadas tal como estão — são puras e já provadas.
Mas `desdeDe()`/`comoDia()` truncam em `YYYY-MM-DD`, certo para um refresh
por hora/dia, errado para um poller de 12 em 12 segundos (rebuscaria o dia
inteiro a cada volta). Por isso a config nova mora em
`specs/_catalog/realtime-poll.yaml`, não em `incremental.yaml`, com sua
própria margem em SEGUNDOS. Verificado com `costura()` de verdade antes de
confiar na âncora: bate exatamente 1 vez no SQL real (não suposto de
memória).

**O ponto mais perigoso do desenho, e por que o poller nunca escreve em
disco.** A chave do cache de resposta (`chaveDaResposta`) inclui um `carimbo`
que é hash sobre **todas** as tabelas do manifesto. Escrever no snapshot a
cada 12s reescreveria esse carimbo a cada 12s — e derrubaria o cache de
**todas** as páginas, não só a que mudou (a mesma armadilha que `DEPLOY.md`
já registra para rematerializar, rodando 75× mais rápido). A resposta: o
delta do poller fica só em memória do processo (`DeltaDeTabela`, chave de
grupo → última versão da linha), e `carrega()` ganhou um `overlay` novo —
uma função por tabela que mescla o disco com o delta, chamada só quando
existe. `Dataset`/`Evaluator` nunca sabem que overlay existe, mesmo desenho
do grão reduzido (achado #87).

**Invalidação cirúrgica, três camadas, nenhuma pelo carimbo global:**
`Servidor.aoTabelaMudar(tabela, queryId)` cruza `queriesForTable()`
(`registry.ts` — o comentário dela já dizia "usado pelo realtime", escrito
antes de existir usuário) com um mapa `dashboard → queries` pré-calculado na
subida, e só então apaga: `carregadas` (o avaliador em memória, por prefixo
de chave), `completos` (resultado inteiro de visual, `CacheDeVisual.
limpaPagina`, novo) e `cache` (resposta pronta, `CacheDeResposta.
apagaPagina`, novo — `SCAN` por `resp:v1:`, filtra pelo segmento da página,
já que o usuário vem antes dela na chave e impede prefixo puro). **O teste
que mais importa**: uma página que não usa a tabela mudada continua servindo
do cache depois de `aoTabelaMudar` — é o ponto que, se quebrado, derruba o
site inteiro a cada 12s em vez de só a página certa.

**O front não tem TanStack Query** — achado que corrige uma suposição errada
minha e desatualiza `CLAUDE.md`: o cache real de `apps/web/src/App.tsx` são
dois `useRef<Map>` (`paginasVistas`/`layoutsVistos`) escritos à mão. O
listener de SSE (`useEffect` em `App()`, uma conexão por sessão de login, lida
com `atualRef` para não reconectar a cada troca de aba) apaga a entrada certa
via `apagaPaginaDoCache` (novo, `cache-pagina.ts`) e dispara o MESMO efeito de
busca que já existe, através de um contador (`revalidar`) — sem inventar um
segundo caminho de fetch.

**Verificado ao vivo, não só em teste:** `PollerRealtime` rodado ~26s contra
o Voalle real via um script solto (sem crash, sem erro); `node
apps/api/src/index.ts` sobe e imprime "Realtime: poller ligado" com a
credencial real presente, e "desligado" sem ela ou com `--sem-poller`. A
correção de `carrega.ts`/`aplicaTiposDeclarados` do achado #88 (exports que
tinham perdido `export`) segue valendo — nada aqui precisou de novo hand-fix
de exportação.

**Fora de escopo, registrado:** `FIELD AGENDA` e as outras 3 queries sem
coluna de modificação — precisariam de hand-edit de SQL (mesmo padrão de
`field-agenda-slot`) pra ganhar isso, decisão separada. Os ~15,8% de mudança
fora de `assignments.modified` — mesmo gap que já existia, não um novo.

`npm test`: 1591/1591 (29 testes novos: `poller-realtime.test.ts` inteiro,
overlay em `carrega.test.ts`, `limpaPagina`/`apagaPagina` em
`cache-visual.test.ts`/`cache.test.ts`, `aoTabelaMudar`/SSE em
`servidor.test.ts`, `apagaPaginaDoCache` em `cache-pagina.test.ts`).

---

## #91 — O gatilho do Refresh Manager é `cron`, não Agendador de Tarefas — produção é Linux

**03/09/2026.** `docs/DEPLOY.md` (achado #84 em diante) sempre citou "Agendador
de Tarefas do Windows **ou** cron no host Linux" como as duas opções — mas
nunca fixou qual. Confirmado: produção é container/Linux
(`docker-compose.prod.yml` já existe, `Dockerfile` builda uma imagem `node:
24-slim`), não Windows. Windows Task Scheduler nunca foi a peça certa para lá.

Criado `tools/refresh/cron.sh` — o gatilho externo que `tools/refresh/src/
index.ts` já pedia desde o #84, agora para o alvo certo: `flock -n` contra
sobreposição (a mesma proteção que uma tarefa do Windows teria por
configuração, aqui é uma linha), log em `snapshot/refresh.log`. Instalação:
uma linha de crontab (`*/15 * * * * /caminho/do/repo/tools/refresh/cron.sh`).

**Por que roda de um checkout, não da imagem Docker.** A imagem de produção
(`Dockerfile`, stage `runtime`) é deliberadamente enxuta — só o que a API lê
precisa, sem `tools/snapshot/` nem `pg`/`mariadb`/gsheets (comentário do
próprio Dockerfile, item 3). Materializar exige o repo inteiro com `npm ci`
completo. O script assume um checkout de verdade no host, escrevendo no mesmo
`snapshot/` que `SNAPSHOT_DIR_HOST` aponta o container da API a ler — a mesma
divisão que `docker-compose.prod.yml` já desenhava desde antes desta sessão,
só faltava a peça que escreve.

**Não instalado nesta sessão** — editar o crontab do host de produção é
mudança persistente no SO, mesma régua já registrada para o Agendador de
Tarefas: fora do que uma sessão de repositório faz sem confirmação explícita
de quem tem acesso àquele host. Verificado o que dá para verificar sem esse
acesso: sintaxe do script (`bash -n`), resolução de caminho (`AQUI`/`RAIZ`
batem com o repo de verdade) e o comando que ele roda (`node tools/refresh/
src/index.ts --plano`, ao vivo, mostrando os 3 grupos corretos).

---

## #92 — Poller estendido de 1 para 5 queries — e por que as outras 19 do catálogo ficaram de fora, com evidência, não suposição

**03/09/2026.** Pedido do Erick: "extenda para todas" — o poller do achado #90
cobria só `protocolos-auxiliares`. Antes de escrever uma linha, medido ao vivo
contra `information_schema.columns` do Voalle real (schema `erp`, leitura
pura) quais das 24 queries do catálogo têm, na tabela que realmente tocam, uma
coluna de "isto mudou" — não suposto por nome de tabela. Resultado: quase toda
tabela-núcleo do ERP (`assignments`, `contracts`, `people`, `reports`,
`patrimonies`, `schedules`, `teams`, `incident_status`, `incident_types`...)
tem `created`/`modified`/`modified_by`; a exceção notável é
`assignment_incidents` (só tem `sap_modified_integration`, um timestamp de
integração SAP, não de edição de linha) e a view
`v_service_desk_slots_productivity_informative` (a base de `FIELD AGENDA` —
zero colunas de modificação, confirmado, não é falta de SELECT).

**Sete agentes em paralelo, um por query candidata, só leitura — nenhum editou
nada.** Cada um leu o `sql:` inteiro (não o `m_expression`, que é camada
posterior) de uma query que faz JOIN com `assignments`/`contracts`, e teve que
responder, com evidência: qual o alias da tabela-fonte, que CTEs a coluna
precisaria atravessar, o texto verbatim da âncora de `costura()`, se essa
âncora é única no arquivo, e — o mais importante — se existe uma chave de
linha de negócio de verdade. Dois agentes encontraram risco de **corrupção
silenciosa de dado**, não só "cobertura incompleta":

- **`instalacoes-reincidentes`**: `assignments` entra por dois `LEFT JOIN`
  independentes (um em `instalacoes`, outro em `manutencoes`). Ancorar
  `:desde` só no lado de `manutencoes` faria o poller **reescrever "SIM" por
  "NÃO"** em reincidência real e antiga a cada volta — `mescla()` apaga a
  linha antiga inteira quando a chave reaparece no lote novo, sem comparar
  campo a campo.
- **`reincidencia`**: duas CTEs particionam por `cst.id` (service tag), e cada
  partição cruza **múltiplos** registros distintos de `assignments`, cada um
  com seu próprio `modified`. Filtrar `:desde` ali faz o `ROW_NUMBER()`
  recalcular sobre um subconjunto e eleger a linha "primeira" **errada** —
  dado errado, não dado faltando.

Ambas exigiriam a mesma técnica que `incremental.yaml` já usa para
`protocolos-produtividade` (um CTE `alvos` com `UNION` de "ramo A mudou" e
"ramo B mudou", reentregando o grupo inteiro) — reescrita de SQL, decisão
separada, não coberta aqui.

Outras três ficaram de fora por **chave fraca ou ausente**, mesma classe de
risco (merge por chave errado), achada pelos agentes ao procurar um id único
na SELECT final:

- `contratos`: grão real é `authentication_contracts` (múltiplas linhas por
  contrato via tag/usuário), mas só `NUMERO CONTRATO` está na SELECT — não é
  único por linha.
- `contratos-telefonia`: mesmo problema, mais um agravante —
  `identidade()` (`poller-realtime.ts`) trata `null` como um único caractere;
  com `TELEFONE CONTRATO` nulo (LEFT JOIN), duas linhas distintas colapsam na
  mesma chave e uma desaparece em silêncio.
- `alocacao-patrimonio`: chave só dá para aproximar por heurística
  (`PATRIMONIO` + `DATA HORA SAIDA`) — a PK real (`patrimony_packing_list_items.id`)
  nunca é selecionada.

**As cinco que entraram — cada uma com o mesmo tratamento de
`protocolos-auxiliares`: `_MARCA_REALTIME` (coluna nova, hand-edit, quando a
query não expunha `modified` já) atravessando as CTEs certas, âncora
verificada com a `costura()` real (não copiada por suposição — peguei texto
de um `Read` humano uma vez e a âncora bateu 0 vezes por causa de indentação
de bloco YAML de-indentada diferente do que a tela mostra; corrigido lendo o
`spec.sql` já parseado, byte a byte) e execução ao vivo confirmada antes de
mexer em `realtime-poll.yaml`:**

| query | tabela | chave | marca | observação |
|---|---|---|---|---|
| `protocolos-telefonia` | PROTOCOLOS TELEFONIA | SOLICITACAO | DATA CRIADO, DATA ENCERRRADO (3 R, typo do PBIP preservado) | zero hand-edit — já selecionava `a.modified`, clone quase exato de `protocolos-auxiliares` |
| `troca-endereco` | TROCA ENDEREÇO | PROTOCOLO | _MARCA_REALTIME | `assignments` só era ponte de JOIN; cobertura NÃO comprovada — o filtro de negócio real é `reports.final_date`, não `assignments` |
| `tecnicos-auxiliares` | TECNICOS AUXILIARES | "PROTOCOLO:" | _MARCA_REALTIME | mais simples que os outros — 1 CTE + `SELECT *` |
| `retorno-prioritario` | RETORNO PRIORITARIO | "Protocolo Retorno Prioritário" | _MARCA_REALTIME | cobre só a CTE `retorno_prioritario`; `primeira_instalacao` fica de fora (evento estável, não o que dá nome à query) |

**Erro cometido e corrigido no caminho**: a primeira versão hand-editou
`AND a.modified >= :desde` direto no `sql:` base das 3 queries novas — o que
quebraria `npm run snapshot` (full-fetch não passa parâmetro `:desde`
nenhum). Corrigido revertendo essa parte e movendo a transformação inteira
para `costura.de`/`costura.para` em `realtime-poll.yaml`, aplicada só em
memória pelo poller — exatamente como `protocolos-auxiliares` já fazia. Só a
coluna `_MARCA_REALTIME` (sempre válida como SQL simples) ficou no `sql:`
base.

**Verificado ao vivo, com a classe real `PollerRealtime`** (não só a função
`costura()` isolada): `tentaAgora()` para as 5 queries, contra o Voalle real,
sem erro — `protocolos-telefonia` achou 624 linhas com `:desde` no passado
(prova que a âncora e a coluna existem de verdade), as outras confirmaram
`_MARCA_REALTIME` presente no resultado. Rodando com `:desde` = agora (o
estado normal de regime), as 4 novas queries responderam em 112–200ms —
o filtro `modified >= :desde` recente é seletivo o bastante para não pesar a
cada volta de 12s.

`npm test`: 1591/1591 (sem teste novo — mudança é dado de config +
`spec.sql`, já coberta pelos testes existentes de `costura()`/`PollerRealtime`
com fixtures).

**Fora de escopo, registrado — não decisão de negligência:**
`protocolos-geral`, `protocolos-produtividade` (sem snapshot base),
`instalacoes-reincidentes`, `reincidencia` (risco de corrupção, precisam de
reescrita tipo `alvos`), `contratos`, `contratos-telefonia`,
`alocacao-patrimonio`, `consolidado-clientes` (chave fraca/ausente),
`field-agenda`, `field-agenda-slot`, `base-categorias-field` (sem coluna de
modificação, verificado no schema real), `apuracao-premiacao`,
`capacidade-equipe`, `quadro-funcional`, `clima-tempo`, `feriados`,
`hora-atualizado` (sem SQL para costurar), `backlog-agendado-futuro`,
`backlog-instalacao`, `gestores-equipes` (dbMaria, nunca tiveram refresh
medido — achado #80). Comentário completo em
`specs/_catalog/realtime-poll.yaml`.

---

## #93 — Das 4 pendências do achado #92, 2 fechadas com reescrita segura, 1 medida e desviada pra refresh, 1 diagnosticada sem conserto rápido

**03/09/2026, mesma sessão do #92.** Erick pediu para destravar as 4 frentes que
o #92 tinha deixado em aberto: `protocolos-geral`/`field-agenda` (marcadas
"operacional quente" em `cache-policies.yaml`, mas tecnicamente bloqueadas),
as 2 queries dbMaria nunca medidas, e `instalacoes-reincidentes`/`reincidencia`
(risco de corrupção, precisavam da reescrita `alvos`). Antes de tocar em SQL de
produção, três investigações rodaram em paralelo (workflow, 3 agentes) — cada
uma só leitura, nenhuma editou arquivo:

**`backlog-instalacao`/`backlog-agendado-futuro` (dbMaria) — medidas, sem
candidata a realtime.** Ao vivo: 58ms/5.875 linhas e 60ms/93.083 linhas, sem
erro (confirma que o driver `mysql2` do achado #83 continua correto). Nenhuma
tem coluna de modificação por linha — só carimbo de LOTE de carga (`DATA
HOJE`/`data_carga`, poucos valores distintos para muitas linhas: 520 em 5.875
e 325 em 93.083). Entraram no grupo `quente` de `refresh.yaml` (custo somado
sobe de ~11s pra ~11,1s, irrelevante) — refresh normal, não poller.

**`protocolos-geral` — causa raiz confirmada, sem conserto rápido.** Contagem
manual do `m_expression`: 56 passos nomeados, 4 `Table.NestedJoin` + 4
`Table.ExpandTableColumn`. Lendo `packages/transform-engine` (`evaluator.ts`,
`value.ts`): o que fica retido na memória é **pior** do que "todo passo
inteiro" — cada `MTable` guarda toda linha como um `Map` próprio, e toda
função de transformação (`RenameColumns`, `AddColumn`, `NestedJoin`,
`Sort`...) constrói uma tabela nova via `.rows.map(...)`, nunca reaproveitando
o `Map` de uma linha entre passos. Resultado: memória viva ≈ 56 cópias
inteiras da tabela, cada célula dentro de um `Map` (overhead bem maior que
objeto plano) — custo multiplicativo (passos × linhas × colunas), não
proporcional aos ~36 MB do arquivo final. Confirmado 13 colunas calculadas
(`grep 'calculated: true'` em `specs/_catalog/tables/protocolos-geral.spec.yaml`),
todas `IF`/`COALESCE`/`DATEDIFF` linha-a-linha — nada tipo `RankAtualProtocolo`
do field-agenda. **Isolar por coluna calculada (o truque que resolveu FIELD
AGENDA nos achados #85/#87) não serve aqui**: o estouro é no motor de M
(busca+transformação), uma fase ANTES do DAX — confirmado ao vivo, `node
tools/snapshot/src/index.ts --query=protocolos-geral --refazer --memoria=8192`
falhou em 151.561ms sem eu precisar matar o processo (dentro do intervalo
129s/164s já documentado no achado #83), morrendo em `runQueries()`, nunca
chegando a calcular DAX. `snapshot/protocolos-geral.jsonl` (36 MB, 25/08) não
foi tocado — a escrita atômica protegeu o dado existente. **Conserto real: ou
(i) o motor de M para de reter todo passo — mudança em código compartilhado
por 24 queries — ou (ii) empurrar 3 dos 4 `NestedJoin` (ALOCAÇÃO PATRIMONIO,
TROCA ENDEREÇO, TECNICOS AUXILIARES — todas dbVoalle) para dentro do próprio
SQL via `LEFT JOIN`, eliminando 6 dos 56 passos** (`GESTORES EQUIPES` é
dbMaria, não dá pra inlinar, mas é tabela pequena). Não é tarde — é cirurgia
no motor compartilhado ou reescrita de SQL + revalidação completa, mais perto
de dias. Não implementado nesta sessão.

**`field-agenda`/`field-agenda-slot` — caminho viável achado, não
implementado.** `v_service_desk_slots_productivity_informative` expõe
`assignment_id`, e `field-agenda` já usa esse campo pra `LEFT JOIN reports r
ON vsdspi.assignment_id = r.assignment_id` — comprovadamente utilizável.
Testado ao vivo: `LEFT JOIN assignments a ON a.id = vsdspi.assignment_id` roda
sem erro, com `LIMIT 2000` e na janela completa de 3 meses (41.671 linhas), e
o tempo não piora (5894ms→5122ms e 4681ms→4525ms — dentro do ruído de medição,
esperado já que `assignments.id` é PK indexada). **Não implementado porque
apareceram duas complicações novas, mais sérias que "achar a coluna":** (1)
`field-agenda-slot.spec.yaml` declara `origin: table:FIELD AGENDA` — o
overlay do poller mira a tabela pelo NOME, então ele sobreporia a MESMA
"FIELD AGENDA" que carrega as colunas calculadas mais sensíveis do catálogo
(`Rank*`/`Categoria*`, achados #85/#86/#87), não uma tabela isolada; (2) rank é
relativo à PARTIÇÃO inteira — uma linha nova entrando via overlay não
recalcula o rank das linhas vizinhas da mesma partição, diferente do gap
"coluna calculada em branco" que se mostrou seguro para `TempoTotalDias`
abaixo. Decisão separada, deliberadamente fora desta sessão.

**`instalacoes-reincidentes`/`reincidencia` — fechadas com a reescrita
`alvos`.** As CTEs internas (`instalacoes`/`manutencoes` numa,
`primeira_instalacao`/`primeiro_suporte` na outra) ganharam uma coluna técnica
nova por ramo (`_marca_instalacao`, `_marca_manutencao`, `_marca_suporte` —
`assignments.modified`, threading igual ao achado #92) e passaram a rodar
**sempre sem filtro de `:desde`** — nunca veem um subconjunto parcial, então
`ROW_NUMBER()`/`PARTITION BY` sempre calcula sobre o grupo inteiro, igual
`incremental.yaml` já garante para `protocolos-produtividade`. Uma CTE nova,
`alvos` (UNION dos dois ramos), decide só QUAIS chaves saem no resultado final
— a costura inteira mora em `realtime-poll.yaml` (`costura.de`/`para`), nunca
no `sql:` base, mesma disciplina do achado #92.

**Verificado ao vivo antes de confiar** (não só a função `costura()` isolada):
rodei a query ORIGINAL sem costura nenhuma como baseline, depois a costurada
com `:desde` no passado (1970) — teve que bater **exatamente** com o
baseline — e com `:desde` = agora (deveria vir vazio). `instalacoes-reincidentes`:
baseline 21.938 linhas, costurada-passado 21.938 (bate), costurada-agora 0.
`reincidencia`: baseline 1.363, costurada-passado 1.363 (bate), costurada-agora
0. Confirmei também que as chaves de linha (`protocolo_instalacao`,
`service_tag`) não têm duplicata na amostra (`GROUP BY ... HAVING COUNT(*)>1`
vazio nas duas).

**Erro cometido e corrigido no processo**: a primeira tentativa de costura
esqueceu de repor o `)` que fecha a CTE `reincidencias`/`primeiro_suporte`
antes de inserir `alvos` — o texto substituído (`de`) incluía esse `)`, e o
texto novo (`para`) não o recriava, quebrando a sintaxe (`syntax error at or
near "("`). Corrigido fazendo `para` começar com `),` em vez de só `,`.

**Custo por volta: ~2-4s, não os ~200ms das outras 5 queries do
`realtime-poll.yaml`** — porque o filtro `alvos` só reduz a SAÍDA, nunca o
CÁLCULO (as CTEs internas sempre rodam completas). Por isso as duas usam
`intervalo_ms: 30000`, não 12000 — 30s ainda é ~40x mais rápido que os 20min
do refresh em lote, sem martelar o Voalle a cada 12s com uma consulta que
recomputa tudo de qualquer forma. Medido variável entre execuções (2,1s a
12,0s numa amostra de 2 rodadas) — o guard `#ocupado` de `poller-realtime.ts`
já impede sobreposição caso uma volta demore mais que o intervalo.

**Achado colateral que quase virou bug em produção**: `RETORNO PRIORITARIO`
(adicionada no #92) e `REINCIDÊNCIA` (adicionada agora) têm colunas
CALCULADAS de verdade (`specs/_catalog/tables/`: `TempoTotalDias` nas duas,
`TempoDifFormatado` só em REINCIDÊNCIA) — DAX simples de subtração de data,
mas computadas na materialização completa, não presentes numa linha trazida
pelo poller. Verificado antes de assumir que isso era seguro:
`packages/measure-engine` (`evaluator.ts`, `indice.ts`, `filter.ts`) já lê
valor de coluna com `row[coluna] ?? BLANK` / `key in row` em vários pontos —
uma linha sem a chave vira `BLANK`, não exceção. Consequência real: as duas
colunas calculadas ficam em branco nas linhas recém-trazidas pelo poller até
o próximo refresh completo recalculá-las — gap aceito e documentado, mesma
classe dos ~15,8%/84,2% já registrados, não erro.

**Crontab do Refresh Manager (achado #91) — continua sem acesso.** Verificado
nesta sessão: não há `~/.ssh/config`, e `~/.ssh/known_hosts` só tem
`github.com` — nenhuma evidência de acesso SSH a um host de produção a partir
desta máquina. Sem CI/CD (`.github/workflows/` vazio) nem outro mecanismo de
deploy automatizado encontrado no repositório. A linha de crontab
(`tools/refresh/cron.sh`, achado #91) continua pronta e não instalada —
depende de alguém com acesso ao host real rodar o comando.

`npm test`: 1591/1591 (sem teste novo — mudança é config + `spec.sql`, coberta
pelos testes existentes de `costura()`).

---

## #94 — `N_FAIXAS_EAGER` de 2 para 4: o aquecedor não cobria o que a tela mostra de cara em página densa

**03/09/2026.** Erick mandou um print de `AGENDAMENTO FIELD`: 8 cards presos em
"carregando…" — `tableEx`/`pivotTable`, os IDs do print batendo exatamente com
visuais reais da página. Investigado antes de mexer em qualquer coisa:

1. `/api/dashboards/agendamento-field` (a página inteira) respondia rápido e sem
   erro (1,7-2,3s frio, 5ms quente) — não é a rota que a Fase L5/R4 usa. O
   navegador nunca pede a página inteira; pede `?visual=<id>` um a um, disparado
   por `IntersectionObserver` (`VisualNaDobra.tsx`).
2. Testados os 8 IDs do print, um de cada vez (sequencial): todos voltaram em
   3-10ms, exceto um em 4,8s numa tentativa isolada — rápidos sozinhos.
3. **A causa não é velocidade por visual — é concorrência fria.** `apps/api/src/
   aquecedor.ts` só pré-calcula `idsIniciais(layout)`
   (`tools/layout/src/corte-eager.ts`): todo KPI mais as colunas das
   `N_FAIXAS_EAGER` primeiras faixas — **2**, até esta sessão. `agendamento-field`
   tem 10 faixas em 3714px; num monitor comum (1080px + a margem de 200px do
   observer) as faixas 3-6 já ficam "perto o bastante" **na própria abertura** —
   o comentário de `VisualNaDobra.tsx` já registrava isso. O primeiro visitante
   depois de um restart/refresh disparava 4+ tabelas/matrizes FRIAS ao mesmo
   tempo, competindo pela mesma thread síncrona do Node (`calculaPagina` é um
   `for` sem `await` — não há concorrência real, só fila).

**Por que 4 e não outro número — matemática, não achismo.** `altura-medida.ts`
(`calculaAlturasDeFaixa`/`PISO_TETO_FAIXA`) já mostra que faixas do MESMO tipo
dividem um pool de `--util` entre si; numa página com 2 grafico + 5 tabela + 3
matriz, dividir por 5 ou 3 empurra cada faixa para o PISO (grafico 273px,
tabela 280px, matriz 360px — não a fração "cheia"). Somando pelo piso: faixas
1-2 (grafico) = 546px, +2 tabelas = 1106px — dentro de 1080px+200px de margem
— e a 5ª (a primeira matriz, 360px) já estoura esse orçamento. **4 é onde a
conta de altura real para de caber na tela**, não um múltiplo arbitrário de 2.

**Por que um número fixo global, e não a conta de altura por página.**
`calculaAlturasDeFaixa` precisa de `utilPx` medido no DOM — não roda no
aquecedor (Node, sem navegador) sem introduzir uma sonda ou estimativa
duplicada. Registrado como refinamento futuro possível (corte por altura
estimada em vez de contagem fixa), não implementado por falta de necessidade
medida além do que os 4 resolvem hoje.

**Testes afetados**: `corte-eager.test.ts` (dos dois lados — `tools/layout` e o
reexport em `apps/web`), `aquece.test.ts`, `aquecedor-eager.test.ts` — todos
tinham layouts de 3 faixas fixados para demonstrar o corte em 2; ganharam
faixas extras para continuar demonstrando o corte, agora em 4, sem perder a
cobertura de "o que fica de fora".

**Verificado ao vivo antes de fechar**: reiniciei a API, aquecedor rodou
**35,1s para as 14 páginas** (primeira medição de verdade — as "0,1s" de
tentativas anteriores nesta sessão eram cache do Redis sobrevivendo aos
restarts, não um aquecimento frio real; não há um "antes" limpo com N=2 para
comparar por causa disso, registrado em vez de inventado). Depois do
aquecimento, os mesmos 8 IDs do print voltaram em 2-6ms cada — confirma que o
aquecedor agora cobre o que fica preso.

`npm test`: 1591/1591.

---

## #95 — O snapshot em disco cai 93% com gzip, e o teto do `bench` deixou de guardar por causa disso

`npm run snapshot` gravava `.jsonl` cru. O arquivo é JSONL **colunar de valor
repetido** (cidade, status, equipe, tipo de protocolo), e o gzip o come vivo.

Medido em 04/09/2026 sobre `snapshot/field-agenda.jsonl`, 448,2 MB:

| nível | tamanho | menor | gravar | ler |
|---|---|---|---|---|
| 1 | 26,8 MB | 94,0% | 0,9 s | 0,7 s |
| **6 (padrão do zlib)** | **14,6 MB** | **96,7%** | **1,7 s** | **0,7 s** |
| sem gzip | 448,2 MB | — | — | 0,4 s |

Nível 6 pelo dobro do tempo de gravação e metade do tamanho do nível 1; a leitura
custa os mesmos 0,3 s a mais nos dois. Não há nível a escolher: o padrão do zlib é o
que a tabela mede.

**O diretório inteiro, migrado: 723,9 MB → 50,3 MB (93,0% menor), 30 arquivos, 4,6 s.**
Os arquivos pequenos comprimem menos (`hora-atualizado` 37%, `calc.base-de-origem` 13%)
porque o cabeçalho é o grosso deles; os grandes ficam entre 75% e 96,7%.

Custo de leitura, `npm run bench:carga -- --paginas`, 1ª carga por página, antes e
depois:

| página | antes | depois |
|---|---:|---:|
| agendamento-field | 901 ms | 931 ms |
| visao-geral | 1.235 ms | 1.422 ms |
| relatorio-do-mes | 1.298 ms | 1.413 ms |
| l-mapa | 894 ms | 890 ms |

Entre +0% e +15%, **e na mesma ordem do ruído entre duas medições do MESMO arquivo
cru**: `manutencao-inicial` deu 758 ms e depois 1.085 ms sem nada ter mudado, nos dois
baselines. A API quente continua respondendo em 2 ms.

### As cinco coisas que isto poderia estragar em silêncio

1. **Os dois sufixos vivos ao mesmo tempo.** A leitura pegaria o `.gz` e as três
   varreduras que listam o diretório **por nome** (`snapshot:confere`, `bench:carga`, o
   carimbo do cache de resposta) poderiam pegar o outro, de outra carga: dois números,
   nenhum erro. `escreve()` apaga o gêmeo do outro sufixo depois do rename — dentro
   dele, não num passo separado, porque passo separado neste fluxo já foi esquecido
   duas vezes (#53, #78). `escolheGemeo` erra alto se o estado aparecer por outro
   caminho (cópia à mão).

2. **`arquivoDaQuery` decidindo onde GRAVAR.** Ele devolve o que está em disco, então
   um `.jsonl` já existente prenderia a query no formato velho para sempre. Quem grava
   chama `arquivoDeEscrita`, que não olha o disco.

3. **`leCabecalho` inflando o arquivo inteiro para ler a linha 1.** 448 MB inflados
   para ler ~2 KB, no caminho de `--incremental` e do manifesto. Agora infla uma janela
   de 128 KB com `Z_SYNC_FLUSH` (sem ele, inflar pedaço de gzip é *"unexpected end of
   file"* — o rodapé de CRC não chegou) e dobra a janela se o `\n` não estiver lá.

4. **O teto de `npm run bench:carga` deixou de guardar.** Ele barra arquivo acima de
   100 MB porque os degraus que retêm linha pedem ~8 GB de heap nesta máquina de 16 GB.
   Comprimido, `field-agenda` são 14,6 MB — e ele passou: as três páginas que o tocam
   (`agendamento-field`, `relatorio-do-mes`, `visao-geral`) deixaram de ser barradas e a
   2ª carga delas rodou. O guarda continuava lá, sem guardar nada. O teto agora compara
   `bytesDescomprimidos()` (campo ISIZE do rodapé do gzip), que é a grandeza que prediz
   heap. **É o defeito mais interessante desta mudança**: a otimização apagou a
   informação em que uma proteção se baseava, três arquivos longe.

5. **A escada do `bench` divergindo de `le()`.** Os degraus e1..e4 são réplica
   deliberada do laço de `le()` e abriam o arquivo à mão. Com gzip, os sete degraus
   erravam com `JSON.parse` engasgando em `�` — e o guarda `e5 < e4`, que existe
   justamente para pegar réplica divergente, **não pegou**, porque nenhum degrau chegava
   a medir. `fluxoDeLeitura` passou a ser exportada e a réplica a usa.

Toda leitura decide pelos **BYTES** (magia `1f 8b`), não pelo sufixo: arquivo renomeado
à mão continua legível em vez de falhar três camadas abaixo da causa.

`npm test`: 1.602/1.602 (11 novos). `snapshot:confere` lê os 30 `.gz` e reporta os
mesmos 3 erros de conteúdo de antes.

---

## #96 — `Status Protocolo Dia`: 211 s de 238 s do congelamento eram um `GROUP BY` escrito como DAX por linha

`npm run snapshot:calculadas -- --todas` custava **238 s**, e **211 s** (89%) eram UMA
tabela de **13.045 linhas**. Antes custava 26 min, e antes disso 14 h 28 min (#68) — o
que já tinha sido consertado era o *processo* (#67, um por coluna), nunca a *forma*.

A forma: as quatro colunas calculadas são todas

```
CALCULATE ( MAX ( 'FIELD AGENDA'[X] ),
            FILTER ( 'FIELD AGENDA', protocolo = P && TRUNC ( Slot Agenda ) = D ) )
```

avaliadas **uma vez por linha**: 13.045 × 647.909 = **8,45 bilhões de visitas de
linha**, por coluna, quatro vezes. A mesma resposta sai de UMA passada agrupando por
`(protocolo, TRUNC(Slot Agenda))`.

| | antes | depois |
|---|---|---|
| `Status Protocolo Dia` | 211.409 ms, 4 processos, 4 cargas de snapshot | **4.058 ms**, 1 processo, 1 carga |
| `snapshot:calculadas -- --todas` | 238 s | **35,5 s** |

### A fidelidade, que é o único ponto que importa

Reimplementar DAX em JavaScript é exatamente como se produz número plausível e errado —
é o argumento que fez as 78 medidas deste projeto **não** serem 78 funções TypeScript
(`DECISAO-CAMADA-M.md`). Três coisas seguram esta exceção:

1. **Conferido contra o dado real, célula a célula, por DUAS vias.**
   `npm run probe:status-dia` compara o cálculo com o arquivo do DAX: 13.045 linhas, 5
   colunas, **0 células divergentes**. E os dois **arquivos gravados** — o do avaliador
   e o da tradução, cada um passando pelo mesmo `paraGravacao` e o mesmo `escreve` —
   saem **idênticos célula a célula**, com o mesmo `tabelaSha` (`c9d50d2e4db53199`). A
   segunda via pega erro de *costura* (chave errada, coluna trocada de lugar), que a
   primeira não veria.

2. **A sonda IMPORTA a implementação.** Enquanto ela tinha a própria cópia da
   agregação, o "0 divergências" provava a **cópia** e não o código que roda no
   refresh; as duas divergiriam sem ninguém notar. Mesmo argumento do `normalizeName`
   importado em `formato.ts`.

3. **`shaConferido` trava a tradução ao DAX.** Mudou o `table_dax` ou o DAX de qualquer
   coluna ⇒ `shaDaCalculada` muda ⇒ o caminho nativo **se recusa**, cai no avaliador
   (lento e certo) e imprime `ATENÇÃO: o DAX mudou desde a conferência` com o passo para
   religar. É o guarda do #47 um nível acima: lá o hash pega coluna congelada obsoleta,
   aqui pega **tradução** obsoleta. Tem teste, e o teste confere que ele recusa.

### O que os 23 testes novos cobrem, e por quê

A borda que o dado de um dia qualquer pode não ter — que é onde tradução de DAX erra
calado: o desempate de `MAX` pelo collation pt-BR **devolvendo o valor original**, não o
normalizado; `TRUNC(BLANK())` = 0 caindo em 30/12/1899 em vez de se juntar a um dia de
2026; `skill` de texto **vazio** contando como preenchida (`ISBLANK` é só null); a
**ordem** do `SWITCH` (Produtivo > Improdutivo > Inconclusivo > Sem Ação); e a armadilha
central: os **dois eixos de data**. O corpo da tabela agrupa por `Slot Agenda` e os
contadores de status filtram por `Data Relato`. Juntá-los num índice só daria
"Improdutivo" num slot cujo relato improdutivo foi lançado noutro dia.

### Onde o desvio foi ligado, e por que não onde parecia

Primeira tentativa: `materializaCalculada` em `packages/snapshot/src/tabelas-calculadas.ts`.
**Essa função não tem nenhum chamador no repositório** — o congelamento roda um laço
inline em `tools/snapshot/src/calculadas.ts`. Ficou 10 minutos rodando o caminho lento
antes de a medição mostrar isso. Fica registrado: `materializaCalculada` é código morto.

E a tabela **sai da lista de `--isolar`**: a isolação por coluna existe porque avaliar
DAX coluna a coluna é 5-36× mais barato em processo próprio (#67), e uma tradução que
calcula todas as colunas numa passada não tem trabalho por coluna para dividir — isolar
pagava 4 cargas de snapshot para rodar 4 vezes o avaliador que a tradução existe para
não rodar. Medido: **194 s isolada contra 12,9 s nativa**. `--amostra=` não desvia, de
propósito: ela existe para medir ms/linha do avaliador.

Fonte vazia e coluna omitida pela projeção **erram alto**, em vez de gravar tabela vazia
ou coluna nula: um arquivo assim passaria pelo guarda de sha (o DAX não mudou) e a
página leria zero sem reclamar.

`npm test`: 1.625/1.625.

---

# Achados abertos — os que ainda não têm conserto

> **Por que esta seção está separada e no fim.** Os achados numerados acima são a
> memória do projeto: o resto da documentação os referencia por número, e eles
> descrevem **comportamento**, sob a decisão vigente de replicar fielmente. Os abaixo
> são de outra natureza — são **defeitos localizados e ainda não corrigidos**, com a
> medição que os isolou e o que já foi descartado. Os quatro primeiros são de
> 25–27/08/2026 e nasceram num arquivo que tinha sido recriado do zero; os cinco
> últimos são de 04/09/2026, e três deles **bloqueiam trabalho que já está pronto e
> medido** — leia-os antes de mexer em `protocolos-geral` ou na memória da API.
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

## #97 — `PROTOCOLOS GERAL` sorteava 10 colunas em 14,4% das solicitações; desempate decidido, e o `EXISTS` de 3,1x que ele travava entrou junto

Dois achados abertos ("`PROTOCOLOS GERAL` é NÃO DETERMINÍSTICA..." e "O `LEFT JOIN
financial_receivable_titles`...", registrados em 04/09/2026) descreviam o mesmo
bloqueio por dois lados. Fechados juntos, mesmo dia, porque a resposta de um
destrava o outro.

**O defeito.** `ROW_NUMBER() OVER (PARTITION BY a.title ORDER BY s.start_date DESC)`
decide qual endereço/contrato de autenticação representa o protocolo quando o
cliente tem mais de um, e não tinha critério de desempate. Rodando o SQL de
produção duas vezes no MESMO snapshot de transação (`REPEATABLE READ READ ONLY`):
**14.090 de 98.110 solicitações (14,4%) mudavam de valor** em USUÁRIO, CTO, PONTO
DE ACESSO, CODIGO, OLT, EQUIPAMENTO, SLOT, PORTA, LATITUDE, LONGITUDE.

**Correção a um achado anterior: `l-mapa` NÃO plota coordenada nenhuma.**
`specs/dashboards/l-mapa.spec.yaml` é um `Tooltip` oculto com 5 colunas
(INSTALADO POR, CONTRATO, PROTOCOLO, DATA, HR. ALOCAÇÃO) — nenhuma delas
LATITUDE/LONGITUDE. Conferido em 04/09/2026: **nenhuma das 14 specs de
dashboard referencia LATITUDE/LONGITUDE**, e o projeto não tem biblioteca de
mapa nenhuma (`grep` por leaflet/mapbox/google.maps em `apps/web` não acha
nada). O achado original (sessão anterior) errou ao supor, pelo nome da
página, que ela desenhava um mapa. O impacto real e verificado — rodando a
API com o snapshot de hoje e lendo `/api/dashboards/visao-geral` — é a tabela
da página **VISÃO GERAL** (uma das 14 páginas normais, ícone no menu): as
colunas `EQUIPAMENTO1` (de EQUIPAMENTO) e `CONEXÃO` (de USUÁRIO) aparecem lá,
lado a lado com `STATUS FINANCEIRO` (a coluna do `EXISTS`). Antes da correção
de hoje, essas três colunas mudavam de valor entre refreshes nessa tela real;
LATITUDE/LONGITUDE mudavam no banco mas não apareciam em lugar nenhum da UI.

**A pergunta que só o negócio respondia:** quando o cliente tem mais de um
endereço/contrato de autenticação, qual deles é o do protocolo? Erick decidiu em
04/09/2026: **`ACTIVE TRUE`** — preferir `authentication_contracts.active = true`.

**Medido antes de fechar a regra secundária.** Das 247.668 solicitações com
partição múltipla, **234.475 (94,7%) têm no máximo um ponto de acesso ativo** —
`active=true` resolve sozinho. As **13.193 (5,3%) restantes** têm mais de um
contrato simultaneamente ativo: achado ao vivo, um cliente com **4 contratos
`active=true` em 4 endereços diferentes**, acumulados de 2024 a 2026 (dado real do
ERP — o cliente mudou de endereço repetidas vezes e nenhum contrato antigo foi
desativado). Para esse resíduo, o desempate final é **`ac.created DESC`** — o
contrato ativo criado mais recentemente vence —, com `ac.id DESC` como piso de
determinismo total. É a parte assumida por mim, não confirmada explicitamente por
Erick; fica sinalizada em `docs/SPEC-DRIVEN.md` para revisão se alguém discordar.

**Por que o `EXISTS` estava preso ao mesmo desempate.** `EXPLAIN (ANALYZE)` do SQL
antigo: a consulta montava um intermediário de 13.719.336 linhas para devolver
98.108 — 77,1 s de `Seq Scan` em `financial_receivable_titles` (16,5 M linhas) só
para checar `frt.title IS NULL`. Medido: `frt.title` é **NULL em 0 de 16.563.491
linhas**, e 0 contratos têm título nulo e não nulo ao mesmo tempo — "não casou" e
"casou com nulo" não são estados distinguíveis nesta base, e `EXISTS` é
semanticamente exato. Mas o `LEFT JOIN` também multiplicava a partição do
`ROW_NUMBER`: tirá-lo, sem desempate, trocaria um sorteio por outro — motivo pelo
qual os 3,1x medidos ficaram parados em `docs/sql/protocolos-geral-exists.sql` até
hoje.

**Conferido.** `npm run probe:determinismo-pg` (novo, roda o SQL de produção duas
vezes na MESMA transação `REPEATABLE READ READ ONLY`): **0 solicitações
divergentes**, era 14.090. O caso mais extremo do banco (o cliente dos 4 contratos
ativos) escolhe o mesmo ponto de acesso em execuções repetidas.

### Correção em 04/09/2026 (mesmo dia, algumas horas depois): `ac.id DESC` NÃO era piso de determinismo, e os "0 divergentes" acima eram plano de consulta estável

**O erro é meu, e vale mais registrado que corrigido em silêncio.** O parágrafo
acima chama `ac.id DESC` de *"piso de determinismo total"*. Não é, e a prova
apareceu ao acrescentar um termo NOVO ao `ORDER BY`: a mesma sonda passou a
acusar **41 solicitações divergentes**, todas na coluna `CTO`.

Acrescentar termo a um `ORDER BY` só pode refinar — nunca desempatar menos. Se
divergência apareceu, ela **já estava lá**, escondida atrás de um plano de
consulta que o PostgreSQL escolhia de forma estável enquanto a chave não mudava.
Os "0 divergentes" mediram a estabilidade do plano, não a totalidade da ordem.

**Por que `ac.id` não fecha a partição.** `CTO` é `as2.title`, e a cadeia é
`ac → authentication_splitter_ports asp → authentication_splitters as2`: **um
contrato de autenticação tem várias portas de splitter.** Duas linhas com o
MESMO `ac.id` e `asp.id` diferente têm `CTO` diferente e chave de ordenação
idêntica. Mesma coisa em `schedules` (uma assignment tem vários) e em
`people_addresses` (quando `ac` não casa, todos os endereços do cliente empatam
com chave nula).

Medido, sobre os 98.205 protocolos do recorte:

| | protocolos |
|---|---:|
| **empatavam no topo** da chave (a chave nunca foi ordem total) | **17.663** |
| desses, com `CTO` diferente entre as linhas empatadas | **82** |
| distinguidos por `pa.id` (endereço) | 15.510 |
| distinguidos por `s.id` (schedule) | 2.408 |
| distinguidos por `asp.id` (porta de splitter) | 135 |

Os 15.510 de endereço não mudam nada visível (sem `ac`, o `CTO` é nulo em todas).
Os 82 são o dano real, e é deles que os 41 observados são subconjunto — só
divergem os que o plano efetivamente inverte entre duas execuções.

**O conserto:** `asp.id DESC NULLS LAST, s.id DESC NULLS LAST, pa.id DESC NULLS
LAST` no fim do `ORDER BY`. Medido: **0 empates no topo, 0 protocolos com `CTO`
ambíguo.** E `probe:determinismo-pg` de novo, com a chave completa: **0
solicitações divergentes** (98.205 linhas nas duas execuções).

**A lição que fica, e não é sobre este SQL.** "Duas execuções deram igual" não
prova ordem total — prova que o plano não mudou. O instrumento que prova é
contar empates no topo da chave (`RANK() = 1` com mais de uma linha), que é
independente de plano. A sonda de determinismo continua útil como alarme; ela
não é prova.

```
antes (LEFT JOIN, sorteando):        137,9 s
depois (EXISTS + desempate, estável): 56,0 s / 31,6 s (2ª execução com buffer quente)
```

**Onde ficou.** `sql:` de `specs/_catalog/queries/protocolos-geral.spec.yaml`,
registrado em `docs/SPEC-DRIVEN.md` (edição à mão em spec gerada, com o diff
completo). `docs/sql/protocolos-geral-exists.sql` marcado como incorporado.
`specs/golden/protocolos-geral.golden.json` regravado (`npm run validate:queries
-- --only=protocolos-geral`: 98.170 linhas, 34 colunas, sem falha).

**O snapshot em disco precisou de mais memória que o padrão — achado à parte,
pré-existente, e agora contornado.** `npm run snapshot -- --query=protocolos-geral
--refazer --memoria=8192` estoura o heap (*"O avaliador de M guarda todos os
passos vivos"*). **Não é o meu SQL**: revertido o `sql:` para o texto de ontem
(via `git stash`) e rodado o mesmo comando, o mesmo estouro acontece — só que
mais devagar (161 s até falhar, contra 80-99 s com o SQL novo, medido em três
tentativas com RAM livre diferente). O `m_expression` desta tabela tem 59
linhas de M sobre 34 colunas × ~98 mil linhas; se cada passo fica vivo inteiro
na memória, a conta bate. **Com `--memoria=12288` (12 GB) funcionou**: 93.580
linhas, 63 colunas (o M-layer soma colunas derivadas às 34 do SQL), 10 MB, 117 s
— e o recongelamento automático das 7 tabelas calculadas dependentes rodou
junto, sem erro (inclusive `Status Protocolo Dia` pela tradução nativa do #96,
4 s).

**Conferido na API de verdade, com o snapshot novo.** Subi a API local
(`GOOGLE_CLIENT_ID=` vazio só para este teste, sem tocar `.env`) e li
`/api/dashboards/visao-geral` duas vezes: mesma resposta byte a byte (só o
metadado `cache` mudou, de `miss` para `hit`). Nessa tabela, 200 linhas:
`EQUIPAMENTO1` 0 nulos, `CONEXÃO` (USUÁRIO) 59 nulos de 200 — esperado, é
`LEFT JOIN` — e `STATUS FINANCEIRO` só com o valor `'Cobrado'` na amostra, sem
`null`/erro. É a prova de que o snapshot regravado carrega e serve normal, além
da prova de determinismo do SQL em si (`probe:determinismo-pg`, direto no
banco).

## `INSTALADOR` tem 94 pessoas onde o Power BI tem 166

> **RESOLVIDO em 04/09/2026 — ver o achado #100, no fim deste arquivo.** A resposta
> não estava em nenhuma das variantes de precedência abaixo: `INSTALADOR` depende do
> **RAMO** do append. A cardinalidade fechou **exata** (166 × 166). Leia esta seção
> pelo que ela documenta (o método, e as seis variantes que NÃO funcionam), não pela
> conclusão — a instrução final dela, *"ler o passo M"*, foi cumprida e é o #100.

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

## Carga incremental em `protocolos-geral` compra 1,7x, não os 6x que o nome sugere — e a camada M a bloqueia

Medido em 04/09/2026, contra o dbVoalle:

| | linhas | solicitações | tempo |
|---|---:|---:|---:|
| completo (piso 2025-01-01) | 98.108 | 98.108 | **92,2 s** |
| janela de 7 dias | 1.546 | 1.546 | 54,3 s |
| janela de 30 dias | 5.184 | 5.184 | 36,8 s |

**1,6% das linhas custam 59% do tempo.** O motivo está no `EXPLAIN` do achado acima: a
janela recorta o CTE `PERSONALIZADO`, e o tempo está no `Seq Scan` de
`financial_receivable_titles`, que a janela não alcança. (`PLANOS_CONTRATO` sozinho:
8,0 s de 92 — não é ele.)

E há o bloqueio de forma, que `specs/_catalog/incremental.yaml` já declarava no próprio
cabeçalho antes desta medição: *"a camada M dela precisa ser LINHA A LINHA.
`protocolos-geral` não é (`Table.Distinct` e `Table.Sort` decidem sobre o conjunto
inteiro), então ela não entra aqui mesmo sendo pesada"*. `DECISAO-CAMADA-M.md`, fato
decisivo 3, é mais específico: o passo 53 (`Table.Distinct` por `SOLICITACAO`) escolhe a
primeira linha da ordem que um `Table.Sort` por `INSTALADO POR:` deixou **três passos
antes**, atravessando uma mescla com **`GESTORES EQUIPES`, que vem do dbMaria**. Mover
essa dedup para o PostgreSQL é impossível: o critério de desempate não existe no
PostgreSQL, ele vive em outro banco.

**Conclusão: incremental não é a alavanca desta query.** As duas alavancas que eram —
desempatar o `ROW_NUMBER` e a reescrita com `EXISTS` — já entraram; ver #97.

## A piscina de worker threads da API multiplica o snapshot em memória — 4 × 8 GB permitidos, 6,6 GB medidos — RESOLVIDO em 04/09/2026, e a HIPÓTESE ESTAVA ERRADA

> **Fechado no mesmo dia, e o diagnóstico abaixo está parcialmente errado — leia
> a correção antes de agir por ele.** O texto original culpa o heap das workers
> pelos 6,6 GB. Medindo com o teto delas apertado, o RSS quase não se move: quem
> consome é o **processo pai**. Correção completa, com a bisseção, em
> **#98**, no fim deste arquivo. O que continua verdadeiro aqui: o teto era
> implícito, `--max-old-space-size` do pai não limita worker, e a decisão de
> quantas workers é troca de RAM por latência de página fria.

`apps/api/src/piscina-workers.ts` cria `min(4, os.cpus().length)` worker threads, cada
uma com `resourceLimits: { maxOldGenerationSizeMb: 8192 }`. E
`apps/api/src/worker-calculador.ts` chama `carrega()` **por requisição**, cachando só o
`SemanticModel` — não as linhas.

Consequências medidas em 04/09/2026, API com `--max-old-space-size=4096`, depois de
carregar as 14 páginas uma vez:

```
heapUsed do processo pai .... 33 MB
RSS do processo ............ 6.625 MB
páginas retidas ............ 0
```

O pai não retém nada (33 MB de heap); os 6,6 GB são heap de worker, crescido e não
devolvido ao SO. **O `--max-old-space-size` do pai não limita as workers** — elas têm o
limite próprio de 8192 MB cada, o que autoriza até 32 GB numa máquina de 16 GB.

E o piso do processo, medido subindo a API com tetos diferentes e pedindo as 14 páginas:

| teto | resultado |
|---|---|
| 2048 MB | **morre** — 13 páginas passam, `visao-geral` estoura (`FATAL ERROR: Reached heap limit`, exit 134) |
| 4096 MB | as 14 páginas em HTTP 200 |

Ler `field-agenda` inteira e retê-la, sozinha, pede **~2,1 GB** (647.909 linhas × 26
colunas). O teto padrão do V8 nesta máquina é 4.288 MB, que é o que `npm run snapshot`
usa hoje (o script não passa `--max-old-space-size`).

**Isto é o que a proposta de "cair de 16 GB para menos de 1 GB" precisa endereçar, e
não os scripts de snapshot** — não existe `--max-old-space-size=16384` em nenhum lugar
do repositório. A decisão tem um trade-off real: a piscina existe porque calcular uma
página fria custa 10-20 s, e com a API numa thread só nada mais é servido nesse tempo.
Menos workers, ou um `maxOldGenerationSizeMb` que caiba no total, trocam latência de
página fria por RAM. É decisão de quem opera o servidor.

## Três páginas não carregavam: `HORA CRIADO` é declarada `dateTime` e o DAX devolvia texto — RESOLVIDO em 04/09/2026

`npm run bench:carga -- --paginas`, 04/09/2026:

```
diario-instalacao:     'PROTOCOLOS PRODUTIVIDADE'[HORA CRIADO] é declarada dateTime
premiacao-instalacao:   e o DAX devolveu o texto "20:23:18.533795".
protocolos-detalhados:
```

As outras 11 páginas carregavam. O erro acontecia porque `protocolos-produtividade` vem
do PostgreSQL via SQL de produção com `"DATA CRIADO"::time AS "HORA CRIADO"`. O driver `pg`
entrega colunas `time` como string textual (`"20:23:18.533795"`). Ao rodar
`aplicaTiposDeclarados`, a declaração `type: dateTime` da spec exigia conversão via
`aplicaTipo`, que só aceitava números de série e lançava `DaxEvalError` para qualquer string.

**Solução aplicada em `packages/measure-engine/src/calculated.ts`:**
`aplicaTipo` agora reconhece formato de hora pura (`HH:mm:ss[.SSSSSS]`) e converte para
`Date` sobre a época canônica OLE (1899-12-30 UTC) — idêntico ao que `toDatasetRows`
(`transform-engine/value.ts`) faz para `MTime`, e ao que o formatador do front-end
(`apps/web/src/formato.ts:65-67`) espera para campos de hora (`d.getUTCFullYear() <= 1900`).
Strings com data textual (`DD/MM/YYYY`) continuam errando alto para evitar ambiguidade de mês/dia.

**Medido após a correção:**
14 de 14 páginas carregando com sucesso (`npm run bench:carga -- --paginas`), todas em ~0,7s a 1,7s.
1.627 testes passando em verde (`npm test`).

## #98 — Os "6,6 GB de heap de worker" eram do PROCESSO PAI: 42 GB autorizados viraram 4,6 GB, e o teto da worker quase não importa

Fechado em 04/09/2026, porque o Erick decidiu o destino (**Portainer**) e pediu
*"o mais aceitável para não sobrecarregar nada e nem limitar dado"* — e essa frase
só tem resposta com número.

**O que estava autorizado.** `apps/api/src/piscina-workers.ts` criava
`min(4, cpus)` workers com `resourceLimits: { maxOldGenerationSizeMb: 8192 }`
escrito como **literal dentro do laço**, sob um pai de `--max-old-space-size=10240`
no `Dockerfile`. Numa máquina de 16 vCPU isso é **10240 + 4 × 8192 = 42.752 MB de
heap autorizado, em 15,7 GB de RAM.** Worker thread não obedece ao
`--max-old-space-size` do pai: ela carrega o `resourceLimits` dela.

**Por que RSS era o instrumento errado.** O achado anterior mediu 6.625 MB de RSS
depois das 14 páginas e concluiu *"os 6,6 GB são heap de worker"*. RSS é heap
**crescido e não devolvido ao SO** — com teto de 8192 MB por worker, o V8 não tem
motivo para coletar antes disso, então o RSS sobe até onde deixarem. Ele mede o
teto **autorizado**, não o **necessário**. E numa máquina que já pagina (esta:
1,7 GB livres de 15,7 GB) ele ainda mente para baixo, porque o SO tira páginas do
processo.

**O instrumento certo: apertar o teto e ver o que quebra.** `npm run
probe:memoria-api` (novo, `tools/probe/src/memoria-api.ts`) sobe a API com um par
(nº de workers, heap por worker), pede as 10 páginas do menu uma a uma e anota o
que falha. `ERR_WORKER_OUT_OF_MEMORY` não é medida de desempenho — é fato, e
sobrevive a paginação. O RSS pico sai de `GET /api/saude`, que a própria API já
expõe (`servidor.ts:489`) e que cobre pai **e** piscina, porque worker thread é
thread do mesmo processo.

**Medição 1 — o teto da worker, com o pai em 3072 MB:**

| config | páginas | RSS pico |
|---|---|---|
| 2w × **512 MB** | **10/10** | 3.528 MB |
| 2w × 1024 MB | 10/10 | 3.622 MB |
| 2w × 1536 MB | 10/10 | 3.467 MB |
| 2w × 2048 MB | 10/10 | 3.137 MB |

**Aqui a hipótese do achado anterior cai.** Com 512 MB por worker — **16× menos**
que os 8192 de antes — as 10 páginas passam e o RSS **não se move**. Se o consumo
fosse das workers, apertar 16× o teto delas teria derrubado o RSS. Não derrubou:
quem consome é o pai.

**Medição 2 — o teto do pai, com a piscina em 2 × 768 MB:**

| config | páginas | RSS pico |
|---|---|---|
| pai 1024 | **0/10** — estoura o heap na 1ª página | 1.198 MB |
| pai 1536 | **0/10** — estoura o heap na 1ª página | 1.730 MB |
| pai 2048 | **0/10** — estoura o heap na 1ª página | 2.270 MB |
| **pai 3072** | **10/10** | 2.938 MB |
| pai 4096 | 10/10 | 3.767 MB |

O RSS pico colado no teto em cada linha que falha é a assinatura: o pai enche o
próprio heap e morre. **O piso real está entre 2048 e 3072**, e 3072 é o menor
valor medido que serve. 4096 não compra nada — sobe o RSS para 3.767 MB e a
latência não melhora.

**A decisão, e a conta que o Portainer precisa:**

```
Dockerfile   --max-old-space-size=3072        3072 MB   (piso medido)
piscina      API_WORKERS=2 × API_WORKER_HEAP_MB=768   1536 MB
                                              -------
heap autorizado                               4608 MB
mem_limit: 6g                                 6144 MB
folga para o que NÃO é heap                   1536 MB   (buffers do .jsonl.gz,
                                                        runtime do Node, V8, pilhas)
```

RSS pico medido nessa configuração: **2.938 MB**. De 42.752 MB autorizados para
4.608 — **9,3× menos** — sem perder uma página.

**Por que 2 workers e não 4.** A piscina existe porque página fria custa 10–20 s e
com uma thread só nada mais é servido nesse tempo. Duas já atendem duas páginas
frias simultâneas, que é o caso real de dois usuários em telas diferentes. Quatro
dobram o heap autorizado para atender um terceiro simultâneo que ninguém mediu
existir. É troca de RAM por latência de página fria, e quem opera muda por
`API_WORKERS` sem tocar código.

**O defeito de forma que isto corrige, e que é o mais importante.** O número não
era alto — era **implícito**. `mem_limit` do compose (o "Memory limit" da stack no
Portainer) tem de ser **derivado** do teto do pai e do teto da piscina, e não se
deriva de um literal escondido num laço. Agora os três vivem em lugares nomeados
(`PADRAO_TAMANHO_POOL`, `PADRAO_HEAP_POR_WORKER_MB`, `CMD` do Dockerfile,
`mem_limit` do compose) e `apps/api/test/piscina-workers.test.ts` **falha** se
saírem de sincronia — inclusive se a folga para o não-heap cair abaixo de 1 GB.

---

## #99 — Três defeitos que só o container revela: o login falhava ABERTO, o `NODE_ENV` era rebaixado pelo `.env`, e o SSE ficava mudo atravessando o Nginx

**Data:** 04/09/2026
**Achado por:** subir `docker-compose.prod.yml` de verdade, pela primeira vez, e
pedir as páginas de fora do container.

O ponto de forma vem antes dos três defeitos: **nenhum deles aparece em `npm test`
nem em `docker build`.** A suíte roda do checkout, não da imagem; o build só
executa `COPY`. Os três só existem quando o processo sobe *dentro* do container,
com o `.env` real e o proxy no caminho. É a mesma família do defeito da imagem que
nunca havia iniciado em máquina nenhuma (registrado no commit `48fbdf7`): a
verificação que faltava era **executar**, não testar mais.

### 1. O login falhava ABERTO — e o log dizia isso, em português, e subia igual

Medido na stack de produção, sem sessão nenhuma:

```
GET /api/dashboards/visao-geral        -> 200
```

Duzentos. Com CLIENTE, TELEFONE e endereço no corpo, para quem alcançasse a URL.

A causa é uma corrente de decisões que cada uma parece razoável sozinha:

| passo | o que fazia |
|---|---|
| `.env` desta máquina | `GOOGLE_CLIENT_ID=` (vazia — o normal para desenvolver) |
| `index.ts` | só passava `googleClientId` ao `Servidor` se a variável fosse preenchida |
| `Servidor` sem `googleClientId` | usava a identidade `dev-local` e servia todo pedido |
| log de subida | *"Login: DESLIGADO — GOOGLE_CLIENT_ID ausente, /auth/google recusa todo token"* |

A frase do log é **verdadeira e inútil**: `/auth/google` de fato recusava todo
token, mas ninguém precisava de token. E ela sai uma vez, na subida, no meio de
seis outras linhas — num Portainer que ninguém lê depois do primeiro dia.

**Uma trava que degrada em silêncio não é trava.** O conserto é recusar a subir:
`apps/api/src/portao-login.ts` devolve três estados e um deles mata o processo.
Sem credencial e sem declaração explícita, `process.exit(1)`.

Conferido no container:

```
$ docker compose -f docker-compose.prod.yml run --rm --no-deps api
[login] RECUSANDO SUBIR: GOOGLE_CLIENT_ID está ausente ou vazia.
  ...
codigo de saida: 1
```

### 2. O `env_file:` SOBRESCREVE o `ENV` da imagem

O `Dockerfile` declara `ENV NODE_ENV=production`. Dentro do container, medido:

```
NODE_ENV=development
```

Porque `env_file: .env` vence o `ENV` da imagem (e `environment:` vence os dois).
A imagem se dizia produção e rodava em modo de desenvolvimento — **todo
comportamento condicionado a `NODE_ENV === 'production'` ficava desligado, sem erro
e sem log**. Inclusive `PiscinaWorkers`, que se desativa quando `NODE_ENV === 'test'`
e cuja decisão passa por essa mesma variável.

Conserto: `NODE_ENV: production` no bloco `environment:` do compose, onde vence.
E é por isso que a guarda do login **não** podia depender só do `NODE_ENV` — a
variável em que ela confiaria era exatamente a que estava errada.

### 3. O SSE atravessava o proxy, mas ficava mudo — e o navegador esconde isso

Duas metades, e cada uma era invisível sozinha.

**A metade do Nginx** já estava consertada em `48fbdf7` (o bloco
`location /api/eventos` com `proxy_buffering off`), e a medição agora prova que
funciona: três pedaços de 13 B chegando a **42 ms, 25.039 ms e 50.038 ms** de
conexão aberta. Com `proxy_buffering on`, os três chegariam juntos no fim.

**A metade da API não estava.** `GET /api/eventos` escrevia `: conectado` e depois
ficava mudo **até o poller achar mudança de verdade** — o que numa madrugada leva
horas. Conexão silenciosa é indistinguível de conexão morta para qualquer
intermediário: este repositório dá `proxy_read_timeout 1h`, mas o terminador de TLS
e o balanceador da infraestrutura não foram configurados por nós, e 60 s de
ociosidade é o padrão comum.

E o sintoma é dos piores de diagnosticar: **o `EventSource` reconecta sozinho.**
Nada aparece quebrado. O realtime só "às vezes não chega", e não há linha de log
nenhuma.

Conserto: batimento de 25 s (`Servidor.BATIMENTO_SSE_MS`) — comentário SSE (`:`),
que o navegador descarta sem disparar handler. 15 bytes por assinante a cada 25 s.
Liga no primeiro assinante, **desliga no último**: um `setInterval` vazado não muda
resposta nenhuma, então só um teste o pega (`batimentoLigado`).

### O que a assertividade local mediu depois dos três consertos

Pelo proxy na porta 80, imagem reconstruída, cache frio (Redis `FLUSHALL` + reinício
da API antes de cada passe):

```
forma da carga            páginas   RSS pico   folga de 6144 MB   OOMKilled
------------------------------------------------------------------------------
sequencial, 10 frias        10/10     4356 MB           1788 MB       false
concorrente, 10 frias       10/10     4321 MB           1823 MB       false
quente, 3 chamadas/página   10/10     2188 MB           3956 MB       false
```

`restarts=0` nas três. E as três chamadas por página quente devolveram **corpo
idêntico byte a byte** nas 10 — depois de tirar da comparação o campo `cache`
(`"miss"` na 1ª chamada, `"hit"` na 2ª), que é metadado da resposta. **Essa
armadilha vale registrar:** a primeira comparação acusou 10/10 corpos instáveis, e o
que estava instável era o cache, não o dado. Comparar o corpo cru de um endpoint que
declara o próprio cache mede o cache.

### O arquivo que existe para não mentir

`docker-compose.local.yml` declara `SEM_LOGIN=1` **e** `NODE_ENV=development`
juntos. A guarda recusa `SEM_LOGIN=1` com `NODE_ENV=production` de propósito — para
que ninguém desligue o login *fingindo* estar em produção. O override obedece à
regra em vez de furá-la: paga o preço de admitir que é desenvolvimento.

---

## #100 — `INSTALADOR` não era precedência: era o RAMO. 94 → 166 pessoas, exato

**Fechado em 04/09/2026** (`npm run probe:instalador-ramo`). Resolve o achado
"`INSTALADOR` tem 94 pessoas onde o Power BI tem 166", aberto desde 25/08 com **seis
variantes reprovadas** e a instrução de destravamento: *"ler o passo M do `INSTALADOR`
no PBIP original"*.

### O que o M diz, e que nenhuma variante podia adivinhar

`protocolos-produtividade.m` e `protocolos-auxiliares.m` são quase-clones. Diferença
de substância: **os dois últimos passos**, e o filtro de tipo.

```
produtividade:  rename "INSTALADO POR:" -> TECNICO            (o instalador)
                Table.Combine({este ramo, PROTOCOLOS AUXILIARES})
                join QUADRO FUNCIONAL; rename TECNICO -> INSTALADOR

auxiliares:     RemoveColumns({"TECNICOS AUXILIARES.TECNICO", "TECNICO"})
                                                              (DESCARTA o instalador)
                rename "TECNICOS AUXILIARES.AUXILIAR" -> TECNICO
```

Ou seja: **no ramo acrescentado o INSTALADOR é o AUXILIAR.** Não há coalesce, não há
precedência, não há preenchimento — há duas linhas para o mesmo protocolo, cada uma
com uma pessoa. Era por isso que as seis variantes de `COALESCE` erravam por 5× a 8×:
todas *preenchiam* onde o original *acrescenta*.

Duas consequências que caem de graça da mesma leitura:

- o join com `TECNICOS AUXILIARES` é **LeftOuter**, então protocolo sem auxiliar entra
  no ramo acrescentado com `INSTALADOR` **em branco** — é daí que vem o grupo EM
  BRANCO gigante, e não de dado faltando;
- `TECNICOS AUXILIARES.AUXILIAR` deixa de existir no ramo acrescentado (foi renomeada),
  e `Table.Combine` preenche com nulo — a assinatura medida no modelo publicado em
  25/08: **5.395 de 5.395 linhas (100%)** com a coluna vazia. Nosso SQL preenchia as
  duas, e agora zera no ramo `'A'`.

### Onde o defeito estava no nosso SQL, e por que era invisível

O `UNION ALL` de `unificado` **já reproduzia as linhas** dos dois ramos desde 25/08
(por isso 70.991 linhas batiam). O que faltava é que o `INSTALADOR` era calculado
**uma vez, depois da união**, igual para os dois ramos. A tabela tinha a forma certa e
a coluna errada — e nenhum teste podia pegar, porque contagem de linha estava certa.

O conserto é uma marca de ramo que **não é coluna de saída**: `'P'`/`'A'` no `UNION
ALL`, carregada adiante pelos `SELECT u.*` e nunca listada no `SELECT` final.

### O instrumento: datar a medição, porque o banco anda

Os alvos do achado são de 25/08 e hoje é 04/09 — o banco ganhou 3.042 linhas no
intervalo. Medir a regra nova sozinha não provaria nada: o número podia ter mudado
por dado. `probe:instalador-ramo` calcula as **duas regras sobre as mesmas linhas**, em
**duas épocas**, reconstruindo 25/08 a partir das colunas de saída (linha criada
depois do corte não existia; alocação/troca posterior ao corte ainda não tinha
acontecido, então nem a data nem o NOME de quem a fez eram conhecidos; e o `TODAY()`
do DAX de `DATA INSTALAÇÃO` era o corte).

**A regra antiga é o controle, e é ela que valida a máquina do tempo:**

| métrica | achado (25/08) | reconstruído | erro |
|---|---|---|---|
| linhas | 70.879 | 71.146 | +0,38% |
| grupos | 94 | 95 | +1,06% |
| linhas em branco | 17.486 | 17.610 | +0,71% |
| `Média Geral` | 4,3657 | 4,3943 | +0,66% |

Fiel a menos de 1,1%. Só então o confronto vale:

| métrica | regra antiga | **produção** | alvo Power BI | erro |
|---|---|---|---|---|
| grupos de `INSTALADOR` | 95 | **166** | **166** | **0,00%** |
| linhas em branco | 17.610 | **16.672** | 16.777 | −0,63% |
| razão do grupo em branco | 99,4176 | **63,4247** | 62,7891 | +1,01% |
| soma das razões | 417,462 | 665,0139 | 647,3748 | +2,72% |
| `Média Geral` | 4,3943 | **4,1050** | 3,8998 | +5,26% |

Contra as seis reprovadas, que davam 20,04 / 25,34 / 25,67 / 31,61 na `Média Geral`.

**Auto-conferência.** A sonda precisa *recalcular* a regra para poder datá-la, e
recalcular é reimplementar. Ela conta as linhas em que o seu recálculo diverge do
`INSTALADOR` que o SQL de produção devolve e **aborta** se não for zero — sem isso, as
tabelas acima mediriam a sonda, não a produção. Medido: **0 linhas**.

### O que NÃO fechou, e é a próxima pergunta

`Média Geral` fica em 4,1050 contra 3,8998 (+5,26%). A diferença tem duas partes
separáveis, e nenhuma delas é a regra do ramo:

1. **4 grupos sem razão.** `DIVIDE` por zero devolve BLANK e `AVERAGEX` pula BLANK, então
   o denominador é "grupos com ao menos uma `DATA INSTALAÇÃO`". Nós temos **162**; o
   Power BI tem **166** — os 166 distintos dele *todos* contribuem. Quatro instaladores
   nossos têm protocolo e nenhuma data de instalação.
2. **~2,7% na soma.** Mesmo dividindo por 166, sai 4,0061 — ainda 2,7% acima. Decompondo
   como o achado original fez: o grupo em branco bate (63,42 × 62,79), então o excesso
   está nos **nomeados**: 601,59 em 161 grupos (média 3,7366) contra 584,59 em 165
   (média 3,5429).

Os nomeados serem **menos grupos** e **média maior** aponta para atribuição de linha
por pessoa, não para pessoa faltando.

**Duas pistas já foram medidas e não sobrevivem — não as persiga de novo:**

1. **"O original expande vários auxiliares por protocolo."** Não expande.
   `tecnicos-auxiliares.m` termina em `where PERSONA = 1`, com
   `row_number() over (partition by r.tags order by a.final_date desc)` — **uma linha
   por protocolo**, igual à nossa CTE `auxiliar`. O `Table.NestedJoin` +
   `ExpandTableColumn` casa com uma linha só e não multiplica. Era a suspeita nomeada
   no achado original; está descartada.
2. **"Qual auxiliar vence é sorteio."** É, e o original também sorteia — aquele
   `row_number` não tem desempate, exatamente como o de `PROTOCOLOS GERAL`. Mas o
   sorteio é pequeno demais para explicar 2,7%: de **33.433** protocolos com auxiliar,
   **143** empatam em `final_date` e só **59 (0,18%)** empatam entre *pessoas
   diferentes* — empate com a mesma pessoa dá o mesmo `INSTALADOR`. Medido com
   `RANK() = 1`, não `ROW_NUMBER()`: `ROW_NUMBER` numera 1,2,3 no empate e esconde
   justamente o que se quer contar.

**O que a mesma descoberta fechou de quebra.** O achado original terminava dizendo que
*"a interseção mais estranha continua sem explicação — 10.550 linhas são do tipo troca
sem alocador, mas só 4.376 acabam com o nome do técnico de troca"*, contra **8.740**
do nosso lado. Aquele 8.740 somava os **dois ramos**: era a mesma cegueira, contada
por outro ângulo. Com a marca de ramo, o número comparável (só o ramo de
produtividade) é **4.880** contra os 4.376 deles — a diferença cai de 100% para 11,5%,
e parte disso é o banco ter andado dez dias.

> **Não repetir o erro que este achado corrigiu.** A tentação agora é testar variantes
> contra os 3,8998 até encaixar. Cardinalidade **exata** em 166 não se alcança por
> ajuste — ela veio de transcrever o M, e as seis variantes ajustadas erravam por 5× a
> 8×. A resposta que falta também está lá, ou no modelo publicado; não em busca
> empírica.

---

## #102 — O login desligou o aquecimento sem quebrar nada: 6.134 ms de cálculo com a saúde dizendo `aquecimento: pronto`

**Data:** 06/09/2026
**Achado por:** o Erick perguntar *"o nosso dash já está carregando rápido, pegando
filtros rápidos e sendo instantâneo em tudo?"* — e a resposta honesta exigir conferir
de onde vinham os números que diziam que sim.

O documento que dizia que sim é `docs/PERF-CARGA.md`, gerado em **31/08**. O login
entrou em **01/09**. Ninguém remediu depois, e a diferença entre as duas datas é este
achado inteiro.

### O mecanismo, em quatro linhas que sozinhas parecem certas

| onde | o que faz |
|---|---|
| `cache-resposta.ts` | a chave da resposta carrega um campo de identidade — de propósito, contra vazamento no dia do recorte por linha |
| `identidade.ts` (01/09) | esse campo deixou de ser sempre `local` e passou a carregar **o e-mail de verdade** |
| `servidor.ts:389` | o aquecedor se identifica como `aquecedor-interno` |
| `aquecedor.ts` | ele aquece fazendo o mesmo `GET` que o navegador faria — **como si mesmo** |

Resultado: o aquecedor enche uma partição de cache que **nenhuma pessoa lê**. E o
modo de falha é o mais caro de diagnosticar que existe — não há erro, não há log, o
número está certo. Só está lento, para todo mundo, sempre.

### Medido no compose, antes

```
chaves resp:* no Redis      35 aquecedor-interno · 6 dev-local · 3 ferramenta-interna
                            (zero sob e-mail de gente)
/api/saude                  aquecimento: { ativo: true, pronto: true }
visao-geral, chave do aquecedor    MISS — 6.134 ms de cálculo, 7.694 ms de parede
```

A saúde dizia `pronto: true` e `paginasCarregadas: []` ao mesmo tempo. As duas coisas
eram verdade e a contradição entre elas era o sintoma: aquecer por HTTP contra si
mesmo enche o cache **sem** carregar avaliador nenhum quando acerta o próprio cache
antigo. O laço se declarava pronto sem nada de útil ter sido feito.

Custo por pessoa, e não por instalação: cada conta pagava a primeira abertura de cada
página, por dia e por carimbo de snapshot. Com o `cache-visual` (512 MB, LRU) tendo o
mesmo campo na chave, o orçamento de memória medido no #98 e no #99 — **com uma única
identidade** — também não valia para duas pessoas ao mesmo tempo.

### O conserto: o campo não é *quem pediu*, é *o que essa pessoa pode ver*

Tirar a identidade da chave seria trocar um defeito de desempenho por um de
vazamento. O campo fica; muda o valor. `apps/api/src/escopo-cache.ts`:

```ts
export function escopoDoCache(_identidade: Identidade): string {
  return ESCOPO_TODOS;  // 'todos'
}
```

A identidade entra e é ignorada, e **essa linha é uma afirmação sobre o modelo, não
um atalho**: `specs/_catalog/permissoes.yaml` diz "ESTADO: DESENHO", com `paginas: {}`
e `linhas: {}` vazios. Toda conta autenticada vê todas as linhas — exatamente como via
antes de o login existir. Duas identidades que enxergam as mesmas linhas devem dividir
a mesma entrada de cache.

**A trava que substitui a proteção antiga.** `apps/api/test/escopo-cache.test.ts` lê o
YAML e reprova se `paginas`, `linhas` ou a lista de papéis deixarem de estar vazios —
obrigando o escopo a derivar da regra nova **antes** de a regra entrar. Isso é mais
forte do que o que havia: o teste anterior pegava quem *tirasse* o campo da chave, e
deixaria passar quem ligasse recorte por linha mantendo a chave como estava.

### O teste que foi invertido, e por que a inversão é a correção

`apps/api/test/cache.test.ts` exigia que **dois usuários não compartilhassem
resposta**. A intenção estava certa e o instrumento, não: enquanto todo mundo vê as
mesmas linhas, particionar por pessoa não protege ninguém e cobra o recálculo inteiro
de cada um. O teste agora exige o oposto — dois usuários no mesmo escopo
**compartilham** —, que é a condição de o aquecimento servir para alguém. A proteção
subiu para `escopo-cache.test.ts`, onde é verificável contra o YAML em vez de contra a
intenção de quem editou.

### Medido no compose, depois

Imagem reconstruída, aquecedor completo, pedido pelo proxy na porta 80:

| página | filtros padrão | chave do aquecedor | 1ª do navegador | 2ª |
|---|---:|---|---|---|
| `visao-geral` | 2 | **hit, 5 ms** (era miss, 7.694 ms) | miss, 1.525 ms | hit, 4 ms |
| `capa` | 0 | hit, 2 ms | hit, 2 ms | hit, 2 ms |
| `relatorio-do-mes` | 0 | hit, 2 ms | **hit, 2 ms** | hit, 2 ms |

E as partições no Redis passaram a incluir `todos`, que é a que o navegador lê.

### O que este achado NÃO fechou, e é o próximo

`visao-geral` continua fria na **primeira** abertura real, e a causa é outra, agora
isolada: o aquecedor monta a URL com `?visual=` e **sem `?filtro=`**
(`aquecedor.ts:219`), mas seis páginas abrem pré-filtradas
(`apps/web/src/filtros-padrao.ts`: `visao-geral`, `agendamento-field`,
`diario-instalacao`, `protocolos-detalhados`, `manutencao-inicial`,
`instalacao-reincidente`). A chave que a tela pede na abertura carrega um ou dois
filtros; a que o aquecedor enche, nenhum.

O preço disso caiu muito com o #102 — 206 ms de cálculo em vez de 6.134 ms, porque o
avaliador já está carregado quando o filtro chega —, mas a parede ainda foi de
1.525 ms, e essa diferença entre cálculo e parede não está explicada. As duas coisas
são trabalho separado: fazer o aquecedor abrir a página **como o navegador abre**
(o que exige `filtrosPadrao` acessível aos dois lados, hoje só em `apps/web`), e medir
o que acontece entre os 206 ms de cálculo e os 1.525 ms de parede.

> **A lição de forma, que é a mesma do #99.** Nenhum teste pegaria isto: a suíte não
> tem login, o cache acerta, e cada peça está correta isolada. O que revelou foi
> contar chave no Redis por partição — um comando — depois de desconfiar de um
> documento de desempenho por causa da **data** dele. Documento de medição sem data
> visível ao lado do número é uma armadilha; o `PERF-CARGA.md` tem a data, e foi ela
> que resolveu.

---

## #103 — A matriz de chuva de `agendamento-field` não podia ter dado em NENHUM mês: o filtro padrão pedia passado e o visual só tem futuro

Relatado da tela em 09/09/2026: a matriz **Último Probabilidade_Chuva_Formatada por
Cidade · Data** aparecia como `0 × 0 · 26 posição(ões) vazia(s) podada(s)`. Cabeçalho
`CIDADE` desenhado, corpo vazio, **nenhum erro** — nem na tela, nem na API, nem na
suíte.

### Não era o dado nem o motor

As duas primeiras suspeitas caíram na medição, e vale registrar as duas porque as
duas eram plausíveis:

- **A coluna calculada estava lá.** `Probabilidade_Chuva_Formatada` é uma das seis
  colunas que o extrator tinha perdido pelo `=` no fim da linha (ver o achado do
  TMDL). Está materializada no snapshot, `tipo: string`, **0 nulos**.
- **O motor calcula certo.** A **mesma** matriz na página `relatorio-do-mes` devolve
  7 × 10 com valor (`96%`, `2%`, `100%`…). Mesmo visual, mesmo snapshot, mesmo
  avaliador.

### Era a colisão de dois filtros, e a poda escondeu a colisão

| peça | o que ela diz |
|---|---|
| filtro do visual | `Clima/ Tempo[Tipo] = "Previsão"` (`agendamento-field.spec.yaml`) |
| filtro padrão da página | `calendar[Data]` = **último mês fechado** = agosto/2026 |
| o que existe de `Previsão` no snapshot | 112 linhas: 7 cidades × 16 datas, **todas de 02/09 a 18/09** |

Previsão é futuro por definição; mês fechado é passado por definição. A interseção é
vazia, toda célula sai BLANK, e aí `montaSemVazios` faz o que a matriz do Power BI
faz — poda linha e coluna inteiramente vazias — e derruba os **dois** eixos. As 26
podadas são as datas úteis da janela de agosto no `calendar` (domingo não entra:
31 − 5 = 26).

O que torna isto pior que um mês azarado: **nenhum mês fechado conterá previsão**. O
visual nunca teve dado desde que a página passou a abrir pré-filtrada, e nunca teria.

Medido, variando só o filtro de tela:

| filtro de tela | resultado | podadas |
|---|---|---|
| agosto/2026 (o padrão de então) | **0 × 0** | **26** |
| setembro/2026 | 7 × 10 com valor | 5 |
| sem filtro | 7 × 10 com valor | 81 |

A primeira linha reproduz a tela número por número, inclusive o 26.

### Os dois controles que fecharam o diagnóstico

- A matriz de clima **vizinha** na mesma página (`1a99bc9b`, a dos emojis de
  classificação) preenche 7 × 26 sob agosto. Ela não filtra `Tipo` — vê o histórico.
- A mesma matriz em `relatorio-do-mes` calcula: aquela página não trava data por
  padrão, e o filtro do próprio visual é "mês atual".

### Decisão do Erick (09/09/2026): `agendamento-field` abre no mês CORRENTE

`escopo: 'mes-corrente'` em `packages/widget-engine/src/filtros-padrao.ts`, com teste
que trava as duas coisas — que esta página abre em setembro e que `visao-geral`
continua abrindo em agosto.

**O preço, aceito junto com a decisão:** isto move o número de **todos** os visuais de
`agendamento-field`, não só o da chuva. A alternativa avaliada era isentar o visual de
previsão do filtro da página, que resolveria uma célula e espalharia um desvio do
Power BI por dois lugares.

Conferido de ponta a ponta contra o snapshot real depois da mudança: a matriz devolve
7 linhas × 10 colunas, e a vizinha continua em 7 × 12.

### O que este achado deixa aberto

O eixo de colunas de data sai **fora de ordem cronológica** (04/09, 05/09, 03/09,
08/09, 11/09, 09/09…). No Power BI um eixo de data ordena por data. É defeito
separado, e só ficou visível quando o visual voltou a ter dado — enquanto estava
vazio, não havia coluna para sair fora de ordem.

> **A lição de forma.** Um visual pode estar *estruturalmente* correto — spec fiel,
> coluna calculada presente, motor certo, suíte verde — e ainda assim ser impossível
> de preencher, porque a contradição não está em nenhuma das peças: está entre duas
> delas. O que apontou o dedo foi o `descartadas` que a `ValorDeMatriz` carrega de
> propósito. Sem esse número no resultado, "0 × 0" seria indistinguível de "não veio
> dado", e a caça teria começado no lugar errado — no dado, que estava bom.

---

## #104 — Mês é a caixa errada para previsão: o conserto do #103 só adiava o defeito por um mês

O #103 tirou a matriz de chuva do vazio trocando o filtro padrão de
`agendamento-field` do último mês fechado para o mês corrente. Erick apontou o furo
no mesmo dia, e ele é real: **mês corrente continua sendo uma caixa de mês.**

A previsão da Open-Meteo é uma janela de ~16 dias que anda **todo dia**. Em 28/09 a
previsão de 01/10 a 13/10 já existe no snapshot, e um filtro de "setembro" a joga
fora — a matriz encolhe dia a dia até a virada e depois abre quase vazia. O defeito
do #103 não era QUAL mês; era o mês.

Medido no mesmo dia, com a janela andando de verdade: o snapshot de 03/09 trazia
previsão de 03/09 a 18/09; depois do refresh de 09/09, de **09/09 a 24/09**. A caixa
é fixa e o conteúdo anda — foi essa a leitura que faltava no #103.

### O conserto: o visual sai do recorte de mês, e diz que saiu

`HORIZONTE_DE_PREVISAO` em `packages/widget-engine/src/filtros-padrao.ts` declara,
por página, quais visuais ignoram o filtro de data **da tela**;
`semDataDaTela` em `apps/api/src/calcula.ts` o aplica. Lista fechada, não heurística:
adivinhar "visual que filtra previsão" pela spec faria um visual novo passar a
ignorar o seletor sem ninguém decidir isso.

Três limites, todos com teste:

- **Só o filtro de DATA da página sai** (`dataDaPagina`), e **só se veio da tela**
  (`TIPO_DE_TELA`). Filtro da spec do relatório continua valendo — é desenho do
  relatório, não escolha de quem explora.
- **Só o visual declarado.** A matriz de clima vizinha (`1a99bc9b`, a dos emojis de
  classificação) mostra histórico e continua obedecendo o mês.
- **A isenção é por página + visual.** O mesmo id em `relatorio-do-mes` não herda
  nada.

E o visual **avisa**: a API devolve `nota` em `VisualCalculado` e `Matriz.tsx`
escreve `horizonte de previsão · ignora o mês do seletor` no cabeçalho, ao lado do
`7 × 7`. Um visual que desobedece o seletor em silêncio é pior que um visual vazio —
quem olha compara com os vizinhos e conclui que o número está errado.

Medido ponta a ponta contra o snapshot real, variando só o seletor:

| seletor da tela | matriz de PREVISÃO | matriz de CLASSIFICAÇÃO (vizinha) |
|---|---|---|
| julho/2026 | 7 × 7, datas de 09/09 a 19/09 | 7 × 27, datas de julho |
| agosto/2026 | 7 × 7, **as mesmas** | 7 × 26, datas de agosto |
| setembro/2026 | 7 × 7, **as mesmas** | 7 × 13, datas de setembro |

A previsão não muda com o seletor — é a propriedade que se queria. E a vizinha muda,
que é a prova de que a isenção não vazou.

### A outra metade: o dado também tem de rolar, e não estava rolando

Filtro certo com dado parado dá o mesmo vazio. `clima-tempo` **não tinha refresh
automático**: estava fora de todos os grupos de `specs/_catalog/refresh.yaml`, pela
regra da casa de não dar cadência a fonte sem custo medido. O arquivo em disco tinha
**6 dias** quando isto foi descoberto.

Ela é a única query da base cujo conteúdo **caduca sozinha**. As outras ficam
desatualizadas; esta fica vazia: parada 17 dias, não tem uma linha de `Tipo =
"Previsão"` e a matriz esvazia sem erro.

Medida ao vivo em 09/09/2026, que era o que faltava para ela poder entrar:
**7.267 ms**, 1.869 linhas, 14 chamadas HTTP à Open-Meteo. Entrou no grupo `frio`
(30 min), junto de `field-agenda-slot` — e não num grupo próprio, porque grupo novo
custa mais uma queda do cache de resposta inteiro por ciclo (docs/DEPLOY.md) e 7,3 s
dentro de um tick que já leva ~4min15s não muda a margem.

O preço, dito no yaml: ~672 pedidos/dia à Open-Meteo para um dado que muda poucas
vezes ao dia. Cabe folgado no limite do serviço; se um dia incomodar, o conserto é um
grupo de cadência horária, não tirar daqui.

### Um guarda que funcionou, e vale registrar

Rodei o refresh manual com `--sem-calculadas` e a abertura seguinte **recusou
carregar**: `calc.calendar` havia sido congelada 3 minutos ANTES da nova
materialização, e o guarda de idade (`confereIdadeDaCalculada`) disse exatamente
isso, com o comando do conserto. Sem ele, a página teria aberto com a tabela
calculada do dado antigo — "e o DAX igual não denuncia isso", como o próprio erro diz.

Isso também é o argumento a favor de a query estar num grupo: o encadeamento do
grupo já refaz as calculadas depois de cada materialização bem-sucedida. Foi o passe
manual que criou a inconsistência, não o automático.

### O que continua aberto

O eixo de colunas de data sai **fora de ordem cronológica** (11/09, 09/09, 14/09,
10/09, 15/09, 19/09, 12/09). Num visual que agora existe para mostrar "os próximos
dias", isso é grave — mas o conserto **não é aqui**: `grupos.ts` documenta que a
ordem é a de primeira aparição de propósito, porque a ordenação de um visual é
propriedade dele (`Table.Sort` do PBIP) e **ainda não foi extraída**. Inventar uma
ordem no motor esconderia essa lacuna. O caminho é extrair a ordenação do PBIP; se
Erick preferir, ordenar eixo de data cronologicamente é um desvio pequeno e
defensável, mas é desvio e precisa ser decidido, não presumido.

## #105 — `protocolos-produtividade` Bloqueio 1 (#81) consertado: M reduzido ao join de GESTOR; expõe golden desatualizado desde a migração de 25/08

**10/09/2026.** O achado #81 documentava dois bloqueios independentes para
`protocolos-produtividade` nunca materializar. Este achado resolve o primeiro —
o segundo (full-fetch estoura `statement_timeout` de 600s, medido em 681,6s)
continua aberto, é território de infra/banco e não foi tocado aqui.

**O conserto.** O `sql:` migrado em 25/08/2026 já entrega as 47 colunas prontas,
mas o `m_expression` nunca foi podado depois disso — ainda tentava recriar
`HORA CRIADO`/`HORA AGENDA`/`INSTALADOR` (entre outras) do zero, sem remover as
versões vindas do SQL primeiro. O avaliador parava sempre na primeira colisão.
`GESTOR` (Google Sheets, via `QUADRO FUNCIONAL`) é a ÚNICA coisa que o SQL não
traz — o resto dos ~60 passos morreu. Registrado em `docs/SPEC-DRIVEN.md` (edição
à mão em spec gerada).

**Verificado sem tocar o Voalle nem o Google Sheets**: `runQueries` real, M lido
do spec editado, `Fonte`/`QUADRO FUNCIONAL` substituídos por dado sintético.
Resultado: sem colisão, `GESTOR` casa por `INSTALADOR`/`upper_name` como antes
(`JOAO SILVA` → `Fulano de Tal`), e `LeftOuter` deixa `GESTOR` nulo em vez de
derrubar a query quando não casa (`MARIA SOUZA`, sem entrada correspondente).

**Efeito colateral bom:** a query deixa de depender de
`alocacao-patrimonio`/`troca-endereco`/`tecnicos-auxiliares`/`protocolos-auxiliares`
no M — cada uma era buscada de novo só para um join que o SQL já fazia sozinho.
Só `QUADRO FUNCIONAL` continua como dependência.

**Contagens de passos M do corpus, atualizadas onde eram só contagem mecânica**
(`packages/transform-engine/test/cobertura.test.ts`, `parser.test.ts`,
`tools/validate/test/mlayer.test.ts`): 331→274 passos totais, 303→246 e 306→249
nos dois pisos históricos — `protocolos-produtividade` caiu de ~60 passos para 3.
Sem relação com golden, e por isso corrigido nesta sessão.

**O que o conserto EXPÕE, e não corrigiu: o golden está preso a uma forma anterior
à migração de 25/08.** `specs/golden/protocolos-produtividade.golden.json` tem
33.750 linhas e ~33 colunas — a forma do SELECT **base** (`bruto`), sem
`DATA ALOCAÇÃO`, `TÉCNICO TROCA`, `DATA DA TROCA` nem `INSTALADOR`, que hoje saem
direto do `sql:` de 47 colunas. Provável explicação: a query está quebrada desde
antes disso (bloqueios #81/#83 anteriores), então `npm run validate:profile`
nunca rodou com sucesso depois que essas colunas passaram a existir no SQL.

Três testes dependem deste golden e ficam vermelhos até ele ser regravado:

- `tools/validate/test/mlayer.test.ts`: `nenhuma coluna citada pelo DAX fica sem
  explicação` — `DATA ALOCAÇÃO`, `TÉCNICO TROCA`, `DATA DA TROCA` e `INSTALADOR`
  caem em `sem-explicacao` (o golden não tem os nomes, `verificarTabela` não sabe
  que vêm do SQL). Consequência do MESMO fato, não um bug novo: essas colunas
  SEMPRE estiveram fora do golden — só ficou visível agora que o M parou de
  "explicá-las" por conta própria (ele as recriava, então `procedencia` batia em
  `m` antes de bater na colisão).
- `tools/validate/test/mlayer.test.ts`: `colunas nascidas em M` (56→41) — mesma
  causa, é a contagem que a lista acima afeta.
- `packages/transform-engine/test/runner.test.ts`: `as 24 queries do escopo
  executam os passos` — o fixture sintético desta query vem do MESMO golden
  (`colunasDoGolden`/`linhasDoGolden`), então `Table.NestedJoin` não acha
  `INSTALADOR` na tabela da esquerda.

**Por que não regravei o golden para fechar os três.** `wrapCount`/`wrapSample`
(`tools/validate/src/profile.ts`) rodam a query **inteira** por trás do
`count(*)`/`limit` — é o mesmo custo do Bloqueio 2 (681,6s medido, teto de 600s).
Regravar agora ou falha do mesmo jeito, ou exige subir o timeout do cliente sem
medir se o custo real parou de crescer — decisão de produção que não é read-only,
e que caiu para o mesmo lugar do Bloqueio 2: aguardando decisão de infra/banco.
Inventar as colunas que faltam no golden à mão (nome certo, estatística chutada)
resolveria os três testes e mentiria em `min`/`max`/`distinct` — pior que deixá-los
vermelhos com a causa nomeada.

**Não registrado em `ACHADO_CONHECIDO`** (`runner.test.ts`): faria o teste passar
ali, mas moveria a mesma falha para o piso `ok.length >= 24` do mesmo teste — não
é exceção de tipo de fixture, é o golden faltando 4 colunas de verdade.

### Tentativa de captura ao vivo: o Bloqueio 2 piorou, não é só "precisa de mais tempo"

**10/09/2026, mesma sessão.** Com autorização, tentei regravar o golden contra o
Voalle real (`createVoallePool` com `statementTimeoutMs` elevado só para esta
chamada — nenhum `.env` nem config commitada foi tocado). Não achei CLI pronto
para isso: `tools/validate/src/profile.ts`/`run.ts` viraram bibliotecas puras
(certo para testar sem banco), mas `package.json`'s `validate:profile` só faz
`node tools/validate/src/profile.ts` — sem argumento, sem I/O, sem golden
escrito. **`docs/SPEC-DRIVEN.md`'s `npm run validate:queries`/`validate:model`
não existem mais como scripts** (renomeados para `validate`/`validate:plan`/
`validate:profile` em algum refactor, docs não acompanharam). Script descartável
escrito na hora, reaproveitando `runQuery`/`buildGolden`/`createVoallePool` já
testados — apagado depois.

**900.000 ms (15 min) não foi suficiente — para NENHUMA das duas estratégias.**
`runQuery` tenta `wrapCount` (o `count(*)` por trás de subquery) e, se falhar,
cai para `direct` (SQL cru). As DUAS bateram no teto de 900s, uma depois da
outra: **1.800,6 s no total**, terminando em
`canceling statement due to statement timeout` nas duas tentativas.

Isto é pior do que o #81 registrou (681,6s, já 3,15× o baseline de 190,3s de
25/08) — agora nem 900s bastam, mais que o DOBRO do que já era 3× o esperado.
**Parei aqui de propósito, sem tentar de novo com um teto maior.** Continuar
escalando o timeout (30 min? 60 min?) sem entender POR QUE o custo está
crescendo é o mesmo tipo de aposta sem medição que o #80 já cometeu uma vez
com incremental.yaml — e prende uma conexão de produção por dezenas de minutos
a cada tentativa, para um resultado incerto. O padrão (custo subindo a cada
medição, não estabilizando) sugere algo além de "banco ocupado" — plano
mudando, estatística desatualizada, ou a tabela crescendo mais rápido que o
esperado — e isso pede `EXPLAIN ANALYZE` e decisão de DBA, não outro chute de
timeout maior.

**Golden continua o mesmo (não regravado).** Os 3 testes seguem vermelhos pela
razão já documentada acima. Decisão de como seguir — investigar o plano de
execução, aceitar um teto bem maior de propósito, ou deixar como está até o
Bloqueio 2 ser resolvido de outra forma — fica para quem decide infra/banco.

## #106 — A escada que mede a carga decompunha o caminho que a API NÃO usa; o caro é montar o dicionário, 58,1%

**14/09/2026.** `npm run bench:carga` existe para dizer onde o tempo de carregar um
snapshot vai, degrau por degrau — e é dele que sai a conta que decide se vale trocar
o formato do arquivo. Ele decompunha `le()`, o caminho de **objeto**. A API carrega
com `colunar: true` desde 13/09 (`servidor.ts`, `worker-calculador.ts`), então a
decomposição publicada descrevia um carregamento que ninguém faz mais.

**Não é purismo.** Os dois caminhos dão respostas diferentes sobre onde está o custo:

| etapa | caminho que RODA (colunar) | o que se media (objeto) |
|---|---:|---:|
| montar o dicionário (`Map.get` por célula) | **58,1%** | — |
| montar o objeto da linha | — | 31,8% |
| guardar as linhas no array | — | 21,3% |
| ler os bytes e decodificar utf-8 | 15,2% | 17,6% |
| decodificar cada célula | 14,3% | (dentro de "montar") |
| `adotaTabela` | 0,5% | 13,7% |
| `JSON.parse` | 7,0% | 6,2% |
| partir em linhas | 3,6% | 4,9% |
| conversão de tipo declarado | 1,0% | 4,5% |
| `VistaDeLinhas.todas()` | 0,3% | — |

22 arquivos abaixo de 100 MB: 36,6 MB, 788.225 linhas, 4.517 ms.

**O conserto:** `npm run bench:carga -- --colunar`. Compartilha e1..e3 com a escada
de objeto (mesmos bytes, mesmo `JSON.parse`) e troca o resto — `e4c decodif`,
`e5c dicion` (= `leColunar()` de verdade), `e6c tipos`, `e7c vista`, `e8c adota`. O
e5c é código de produção, e é ele que segura a escada honesta: como e5c ⊃ e4c, um
`e5c < e4c` só pode ser réplica divergente — e o programa reclama.

**O que a medida muda.** `docs/DECISAO-DESEMPENHO.md` fechava com uma pergunta em
aberto ("é essa medida que decide se o passo 5 vale alguma coisa"). A resposta é
**sim, e por um motivo diferente do que aquele documento supunha**: `JSON.parse`
continua sendo ~7% da carga, como ele dizia; o caro é reconstruir o dicionário a
cada abertura. Um arquivo gravado já codificado por dicionário dispensaria 83% da
carga. Registrado lá, na seção "O passo 5, medido".

**Armadilha registrada:** em arquivo de poucos milissegundos o guarda `e4c > e5c`
dispara por granularidade do relógio, não por divergência — com `--repete=9` ele
silencia. O aviso está certo em desconfiar: a decomposição daquele arquivo não vale.

**A lição geral, que não é sobre este arquivo:** uma ferramenta de medição envelhece
junto com o código que ela mede, e o sintoma é ela continuar respondendo — com o
número de ontem. Quando o caminho de produção troca, a instrumentação troca junto,
ou ela passa a ser uma fonte de conclusões erradas com cara de dado.

---

## #107 — O formato 2 nasceu 3x mais LENTO: o divisor de linhas era quadrático no comprimento da linha, e ninguém podia ter notado antes

**Data:** 15/09/2026

O snapshot em disco passou a ser uma linha por COLUNA, já codificada por
dicionário (`formato: 2`), pelo motivo medido no #106: reconstruir o dicionário a
cada abertura era 58,1% da carga. A conversão foi conferida célula a célula contra
os 30 arquivos reais, sem divergência, e o arquivo encolheu 26,4% — 51,2 MB para
37,7 MB.

E a primeira medição ponta a ponta deu **três vezes mais lento**, 4 pares de 4:

| par | formato 1 | formato 2 |
|---|---:|---:|
| 1 | 9.907 ms | 29.703 ms |
| 2 | 12.028 ms | 32.204 ms |
| 3 | 10.534 ms | 30.541 ms |
| 4 | 10.800 ms | 30.046 ms |

O cálculo, que o formato não toca, ficou parado nos 10–12 s nas oito execuções — o
grupo de controle disse que a máquina não estava derivando. A regressão era real.

**Onde estava.** `bench:carga -- --colunar` respondeu numa execução: `partir em
linhas (paraCadaLinha)` **90,4%**, 15.898 ms de 17.578 ms. A etapa que o #106 media
em 3,6%.

O divisor acumulava `resto + pedaco` e procurava o `\n` no ACUMULADO:

```ts
const s = resto + (pedaco as string);   // cons-string do V8: O(1)
let i = s.indexOf('\n', ini);           // ACHATA a cons-string: O(n)
```

O `+` do V8 não copia — devolve uma cons-string. Mas o `indexOf` a achata, e ele
roda a cada pedaço de 64 KB. Numa linha de 7 MB isso são ~110 achatamentos de 3,5
MB em média: **O(n²) no comprimento da linha**.

**Por que ninguém podia ter notado.** Enquanto o arquivo foi uma linha por LINHA da
tabela, nenhuma linha passou de alguns kB, e o laço interno nunca rodou duas vezes
sobre a mesma linha. O custo quadrático estava escrito ali desde sempre e valia
zero. O formato 2 tem 30 linhas de megabytes — a mesma função, o mesmo dado, três
vezes o tempo.

**O conserto** é guardar os pedaços numa lista e procurar o `\n` só no pedaço que
acabou de chegar; junta-se uma vez, quando a linha fecha. O `\r` do CRLF passa a
sair DEPOIS de juntar, porque um `\r` no fim de um pedaço com o `\n` abrindo o
seguinte é o caso que as duas versões tratam por caminhos diferentes — tem teste
agora (`packages/snapshot/test/para-cada-linha.test.ts`), inclusive com multibyte
partido na borda.

Medido depois, com a mesma escada: **17.578 ms → 1.111 ms**, e a decomposição
finalmente parecida com a que o #106 previa (io 41,8%, dicionário 23,9%,
`JSON.parse` 18,1%, linhas 9,7%).

E o A/B refeito, 4 pares de 4, com o cálculo de novo estável:

| par | formato 1 | formato 2 | razão |
|---|---:|---:|---:|
| 1 | 12.024 ms | 3.918 ms | 3,07x |
| 2 | 10.752 ms | 3.368 ms | 3,19x |
| 3 | 12.082 ms | 3.376 ms | 3,58x |
| 4 | 11.992 ms | 3.629 ms | 3,30x |

Carga das 14 páginas: **11,7 s → 3,6 s, 3,2x**.

**A lição, que não é sobre este divisor.** Uma complexidade assintótica ruim que
não custa nada hoje não é um problema resolvido: é um problema **agendado para
quando a forma do dado mudar**. O código não mudou; a distribuição de entrada
mudou, e a mesma função virou o gargalo inteiro. E o que separou o diagnóstico de
um dia de palpite foi a escada de etapas do #106 responder na primeira execução —
a instrumentação se pagou na primeira vez em que a conclusão era contraintuitiva.

**O corolário de método:** eu ia relatar o formato 2 como ganho porque a aritmética
dizia "remove 83% da carga". A aritmética estava certa sobre o que ele remove, e
errada sobre o total, porque ele também MUDA A FORMA da entrada de outra etapa.
Trocar a representação de um dado não é uma mudança local, ainda que o código que
lê continue compilando.

---

### Adendo (mesma data): a conversão deixou o MANIFESTO descrevendo os arquivos velhos

Subi a API para conferir o que nenhum teste tinha conferido — o servidor HTTP servindo
um snapshot em formato 2, com cache de resposta e aquecimento no caminho. Ela subiu, as
14 páginas aqueceram em 31,6 s, e `/api/saude` anunciou:

```
snapshot: 23 queries, 1.408.223 linhas, 53,6 MB      <- o disco tinha 37,6 MB
```

`snapshot/manifesto.json` guarda `bytes` por query, e `escreve()` o atualiza quando
materializa. **Minha ferramenta de conversão não o atualizava** — trocava os 30
arquivos e deixava as 23 entradas descrevendo os antigos. Nenhum erro: um número
plausível, 42% maior, na tela de saúde.

É exatamente a classe de defeito que este arquivo inteiro persegue, cometida por mim,
e nenhuma das três provas do formato 2 a pegaria: elas comparam o CONTEÚDO dos
arquivos, e o que estava errado era o que os **descreve**.

**O conserto reconcilia todas as entradas contra o disco**, e não só as que a execução
converteu — senão a ferramenta não alcançaria o estrago que ela mesma já tinha feito.
`linhas`, `colunas` e `geradoEm` não se tocam: converter muda a representação, não o
dado nem a data dele.

Depois do conserto, e com a API reiniciada:

```
snapshot: 23 queries, 1.408.223 linhas, 37,6 MB
página                   HTTP  1a resposta   visuais  erros   repetida  quente
visao-geral               200      2,37 s        28      0     idêntica  2,5 ms
relatorio-do-mes          200      1,18 s        36      0     idêntica  1,8 ms
diario-instalacao         200      0,90 s        22      0     idêntica  4,4 ms
instalacao-reincidente    200      2,12 s        29      0
protocolos-detalhados     200      1,89 s        19      0
```

A promessa de sub-10 ms a quente continua de pé, e a resposta é byte a byte a mesma
entre pedidos repetidos.

**A lição:** quando um formato muda, o que descreve o arquivo muda junto — manifesto,
cabeçalho de cache, contagem exibida. Provar que o conteúdo sobreviveu não prova que
os metadados sobreviveram, e é o metadado que aparece na tela.

**A lição de método:** eu tinha dado o formato 2 por fechado com três provas e a suíte
verde. Este defeito só apareceu quando **subi o servidor de verdade** — biblioteca
chamada direto não é o sistema. Vale subir o processo real antes de dizer "feito".

---

## #108 — A chave de identidade já existia por VALOR DISTINTO; recalculá-la por linha era 15% do cálculo

**Data:** 15/09/2026

Reperfilei o cálculo depois do formato 2 e `identityKey` era o item número 1 do
perfil — **14,9%**, quase três vezes o segundo. E espalhado: nenhum chamador passava
de um quarto dele.

```
identityKey ....... 2.117 ms  14,9%      por chamador:
                                           524 ms  rowKey
                                           451 ms  filtrosDe
                                           434 ms  IndiceDeIgualdade
                                           311 ms  DISTINCTCOUNT
```

**O que estava acontecendo.** Desde 13/09 as linhas são vistas sobre o armazenamento
colunar: a linha é um índice inteiro e a coluna é `(valores[], ids[])`. A chave de
identidade de uma célula depende só do VALOR — então ela tem tantos valores distintos
quanto o dicionário, e não tantos quantos linhas. `chavesDoDicionario` já memoizava
esse array por dicionário desde a sessão anterior, mas **só `leitorDeIdentidade` o
usava**. Os outros caminhos continuavam lendo a célula pelo acessor de protótipo e
chamando `identityKey`, que por dentro é um `Map` de string.

Trocar isso é trocar, por célula, um acessor mais um `Map.get` por **duas indexações
de array** — e a string devolvida é bit a bit a mesma, porque `chavesDoDicionario` é
`identityKey` aplicado aos mesmos valores.

### Os dois lugares, medidos em pares alternados

`IndiceDeIgualdade` (baldes de uma coluna) e `leitorDeChaveDeLinha` (chave de N
colunas, novo, no lugar de `rowKey` dentro de `filterFromTable`):

| par | índice: sem | com | | chave de linha: sem | com |
|---|---:|---:|---|---:|---:|
| 1 | 11.915 | 11.307 | +5,1% | 11.085 | 10.549 | +4,8% |
| 2 | 10.245 |  9.960 | +2,8% | 10.881 |  9.654 | +11,3% |
| 3 | 10.188 |  9.673 | +5,1% | 13.313 | 12.017 | +9,7% |
| 4 | 10.200 |  9.702 | +4,9% | 14.067 | 13.181 | +6,3% |

**4 de 4 em cada um**, com a carga como grupo de controle. A segunda bateria pegou a
máquina derivando para cima (10 s → 14 s no controle); a comparação é por par
adjacente justamente por isso, e os quatro pares concordam.

O perfil depois confirma que a mudança fez o que dizia: `rowKey` e `IndiceDeIgualdade`
**sumiram da lista de chamadores** de `identityKey`.

### O risco que bloqueava isto, e por que ele já não existe

Em 14/09 eu localizei este mesmo alvo e **não mexi**, registrando três consertos
possíveis e recusando os três: todos trocavam risco de número errado silencioso por
~2%. O que mudou não foi o apetite — foi o terreno:

1. **memoizar a chave na linha** congelaria o valor de uma coluna calculada antes de
   ela materializar (achado #50). Aqui não há memoização na linha: a chave vem do
   dicionário, que é do armazenamento;
2. **usar `tv.rows` como ponto de partida** mudaria o resultado com linha duplicada.
   Aqui o conjunto de linhas não muda — só o caminho até a chave de cada uma;
3. **identidade de objeto** pioraria o caso comum, que é o teste que falha. Aqui o
   caminho é o mesmo para quem passa e para quem não passa.

**A premissa que torna tudo isso seguro está escrita no `set` da vista**
(`packages/snapshot/src/linha-vista.ts`): escrever numa coluna FÍSICA de uma vista
**estoura**. Logo nenhuma propriedade própria — coluna calculada memoizada, por
exemplo — consegue sombrear o acessor de uma coluna que tem dicionário. Sem esse
`throw`, a vista e o armazenamento poderiam discordar e a chave sairia do lado velho,
calada. Há teste fixando isso em `packages/snapshot/test/chave-de-linha.test.ts`,
porque é premissa de dois caminhos quentes e não uma escolha local.

O outro guarda é o **molde**: uma linha de OUTRA vista também responde a
`indiceDaLinha` e indexaria o dicionário errado na posição dela — valor de outra
tabela, sem erro nenhum. Os dois testes novos montam duas tabelas com os mesmos
valores em posições TROCADAS, para que confundi-las mude a resposta.

### A lição

Um valor derivado que depende só do conteúdo da célula tem a cardinalidade do
**dicionário**, não a da tabela. Depois de trocar a representação para colunar, todo
cálculo por linha merece a pergunta "isto depende da linha ou do valor?" — e o
corolário incômodo: eu tinha montado a memoização certa (`chavesDoDicionario`) uma
sessão antes e a deixei servindo **um** consumidor. A peça existia; o que faltou foi
procurar quem mais precisava dela.

### O próximo alvo, localizado e NÃO mexido

Com os dois maiores fora, o topo de `identityKey` virou `filtrosDe` (590 ms) e
`DISTINCTCOUNT` (430 ms).

`filtrosDe` recalcula uma chave que `enumeraCombinacoes` **já tinha**: o `Map` de
combinações é indexado exatamente por `alvos.join(' ')`. Carregá-la em vez de refazer
exige guardar `alvos` na `Combinacao` e expô-la no `Grupo` — **mudança de interface
pública do `widget-engine`**, não um conserto local. A alternativa barata, memoizar
por identidade do array `valores`, é segura só enquanto ninguém mutar esse array, e
ele é exposto ao chamador. Fica para uma sessão que possa medir a decisão inteira.

---

## #109 — RESULTADO NEGATIVO: eliminei 7 milhões de `identityKey` com 100% de acerto e o tempo não mudou

**Data:** 15/09/2026

Depois do #108, o topo de `identityKey` era `filtrosDe` (`widget-engine/src/grupos.ts`)
com 590 ms. O raciocínio parecia fechado: `filtrosDe` roda uma vez por combinação de
eixo — numa matriz, por célula — e recalcula `valores.map(identityKey)` toda vez,
sobre um array que `enumeraCombinacoes` já tinha usado para indexar o mapa de
combinações. Chave pronta, jogada fora, refeita.

**Não valeu. Foi revertido.** Vale registrar porque a demonstração é forte: a
otimização funcionou exatamente como projetada e mesmo assim não apareceu no relógio.

### As quatro variantes, na ordem em que foram medidas

**B — memoizar por array + `Object.freeze` nos arrays de valores.** O `freeze` era
para tornar verificável a premissa que a memoização passava a carregar (mutar um
valor devolveria a chave velha). Resultado: **pior em 4 de 4 pares**.

**C — o mesmo, sem o `freeze`.** Contra B: **melhor em 4 de 4, de 2,7% a 9,0%**. Ou
seja, `Object.freeze` num array que o V8 vinha tratando como rápido custa isso — ele
perde a categoria de elementos, e `valores[i]` é lido por chave em cada célula. **Uma
salvaguarda barata de escrever pode ser cara de rodar**, e aqui ela sozinha comia mais
do que a otimização toda rendia.

Contra o original, porém, C ficou **misto: 1 de 5**. Instrumentei em vez de repetir o
A/B:

```
chamadas 986.369   acertos 77.720 (7,9%)   erros 908.649
```

**7,9%.** Eu tinha suposto que o caso dominante era a matriz reusando o mesmo array
célula a célula; o caso dominante é a **primeira** chamada de cada grupo, que erra
sempre. O memo pagava um `WeakMap` em 92% das chamadas para economizar em 8%.

**D — semear o memo no NASCIMENTO da combinação.** É onde as chaves individuais já
existem: `enumeraCombinacoes` acabou de produzi-las para montar o índice do mapa.

```
chamadas 986.369   acertos 986.369 (100,0%)   erros 0
```

Com ~7,08 valores por combinação, isso são **~7 milhões de `identityKey` e ~986 mil
`join(' ')` que deixaram de acontecer**. E o A/B, em **11 pares**: D ganhou 6, perdeu
5. Moeda.

### Por que não apareceu

`identityKey` já memoiza por valor num `Map` (`CHAVE_TEXTO`, `CHAVE_DATA`,
`CHAVE_NUMERO`). A chamada que o perfil contabiliza é, no caso comum, **um**
`Map.get`. Trocá-la por um `WeakMap.get` mais duas leituras de propriedade é trocar
uma busca em tabela de hash por outra. O perfil somava 590 ms de tempo próprio ali,
e o substituto custa a mesma ordem — sobra ~0.

**A lição, que é diferente das três anteriores desta campanha.** As outras três
reversões morreram da hipótese "isto aloca demais". Esta morreu de outra coisa:

> "O perfil diz que X ms são gastos aqui" **não é** "remover estas chamadas economiza
> X ms". Só é, quando o que entra no lugar é de outra ordem de grandeza. Tempo próprio
> num perfil é onde o tempo ESTÁ, não quanto se ganha tirando de lá.

O #108, na mesma sessão e no mesmo `identityKey`, ganhou 4/4 duas vezes — porque lá o
substituto era **indexação de array**, e não outra busca em hash. A diferença entre os
dois não é o alvo: é a ordem de grandeza do que ocupa o lugar.

**E a regra de método que salvou a conclusão:** quando o micro e o ponta a ponta
discordam, instrumentar em vez de repetir o A/B. Foi a contagem de 7,9% que explicou o
resultado misto de C — e foi ela que impediu de eu tratar o misto como ruído e
"arredondar para ganho". A mesma conta, depois, provou que D fazia o que prometia,
o que é o que torna este resultado negativo **definitivo**: não foi uma implementação
ruim que falhou, foi a ideia.

Ninguém precisa tentar isto de novo.

---

## #110 — Dimensionar antes de implementar: `DISTINCTCOUNT` custou 5,9 milhões de valores, mas em 438 mil chamadas de 13

**Data:** 15/09/2026

Depois do #108 e do #109, o que sobrava no topo de `identityKey` era `DISTINCTCOUNT`
(430 ms). O conserto parecia claro e do formato que o #108 provou ganhar: contar ids
de dicionário em vez de chaves de string — `Set<number>` no lugar de `Set<string>`,
que é mudança de ordem de grandeza e não troca de hash por hash.

**Antes de escrever uma linha, contei.** O A/B nesta máquina já estava custando 11
pares para não decidir nada (#109), e contador não depende de cronômetro:

```
DISTINCTCOUNT: 438.457 chamadas, 5.874.279 valores — 13 valores por chamada
```

**Treze.** Isso inverte o diagnóstico:

- **por valor** há 5,9 milhões de unidades, mas cada chamada pagaria o preparo do
  caminho colunar (achar o dicionário, conferir o molde) para amortizá-lo em 13
  valores — o preparo come o prêmio;
- **por chamada** há 438 mil de `valuesOfColumnRef` + dois `map` + um `Set`, e atacar
  isso é a hipótese "isto aloca demais" — **a mesma que já falhou três vezes nesta
  campanha**, em três lugares diferentes.

Ou seja: o alvo não tem a forma que o #108 ganhou nem a que sobrou é promissora.
**Não foi implementado**, e o custo da decisão foi uma execução instrumentada em vez
de meia sessão de A/B inconclusivo.

### O que ficou sem resposta, e é a pergunta melhor

**Por que `DISTINCTCOUNT` é chamado 438 mil vezes?** Treze linhas por chamada é uma
medida sendo avaliada dentro de um contexto que se repete — a família do #38 e do #43.
Tentei atribuir as chamadas à origem e o rótulo disponível é só o nome da função, sem
o visual nem a medida; ficaria no palpite. A pergunta certa não é "como deixar
`DISTINCTCOUNT` mais rápido" e sim "por que ele roda 438 mil vezes" — e respondê-la
exige carimbar a origem na avaliação, que é trabalho próprio.

### A lição

> **Dimensione o alvo antes de projetar o conserto.** Um perfil diz quanto tempo uma
> função consome; não diz se são poucas chamadas grandes ou muitas pequenas — e o
> conserto certo é diferente nos dois casos. Aqui a mesma soma de 5,9 milhões de
> valores aceitaria a solução do #108 se viesse em mil chamadas de seis mil, e a
> recusa se vier em 438 mil de treze.

Vale junto com o #109: os dois são decisões de **não** implementar, tomadas por
instrumentação, num dia em que a mesma decisão por cronômetro teria custado horas e
provavelmente saído errada.

---

## #111 — De onde vêm as 438 mil chamadas, e o erro que cometi na linha seguinte

**Data:** 15/09/2026

O #110 fechou dizendo que a pergunta certa não era "como acelerar `DISTINCTCOUNT`" e
sim **"por que ele roda 438 mil vezes"**, e que responder exigia carimbar a origem.
Carimbei.

### A resposta

O avaliador já tinha um `measureStack` privado. Exposto para diagnóstico, ele disse
que **99,5% das chamadas não têm medida nenhuma na pilha** — o que não significa "não
é medida", significa que aquele caminho não mantém a pilha. Uma amostra de pilha de
chamadas real fechou a questão, e as três amostras são idênticas:

```
DISTINCTCOUNT            functions.ts
Evaluator.evaluate       measure-engine/src/evaluator.ts:781
valorDoCampo             widget-engine/src/card.ts:161
(anônima)                widget-engine/src/tabela.ts:186   <- map por LINHA
calculaTabela            widget-engine/src/tabela.ts:178
tabelaCompleta           apps/api/src/calcula.ts:617
dadosDo                  apps/api/src/calcula.ts:574
```

Uma tabela visual avalia o campo de agregação **para cada linha do resultado**:

| página | chamadas | de onde |
|---|---:|---|
| `agendamento-field` | 292.967 | |
| `protocolos-detalhados` | 94.166 | = as linhas de `PROTOCOLOS GERAL`, uma por linha |
| `diario-instalacao` | 26.777 | |
| `instalacao-reincidente` | 22.401 | |

**E isso não é defeito, é projeto.** `tabelaCompleta` calcula a tabela inteira uma vez
e a memoiza; toda janela seguinte sai de um `slice`, e o comentário dela já explicava
que a varredura completa sempre esteve ali (o `tipoDaColuna` de cada coluna a exigia).
Em produção isso é pago no aquecimento — medido no mesmo dia: 14 páginas quentes em
31,6 s, e depois respostas de 1,8 a 4,4 ms.

**O que a descoberta muda na leitura do bench:** `bench:pagina-fases` mede o custo
FRIO, sem o memo. É um custo real (é o que o aquecimento paga, e o que um refresh
volta a cobrar), mas não é o que o usuário espera na tela.

### O erro, na linha seguinte

Em `card.ts` a agregação remontava o AST **a cada chamada** — `partesDaAgregacao`, um
`ColumnRefNode` e um `CallNode` — sempre igual, dependendo só do campo. 438 mil
reconstruções da mesma árvore. Forma clássica de "trabalho repetido", que é a
hipótese que GANHOU todas as vezes nesta campanha.

Memoizei por campo num `WeakMap`. Suíte verde. A/B: **2 pares de 5. Revertido.**

E o motivo estava escrito por mim no achado anterior, uma hora antes:

```
438.457 reconstruções x  50 ns =  22 ms = 0,24% do cálculo
438.457 reconstruções x 100 ns =  44 ms = 0,49%
438.457 reconstruções x 200 ns =  88 ms = 0,97%
```

**Contei as chamadas e não multipliquei pelo custo de cada uma.** O #110 diz, com
todas as letras, "dimensione o alvo antes de projetar o conserto" — e eu o apliquei a
`DISTINCTCOUNT` e não à linha de baixo. Uma contagem grande não é um alvo grande:
**438 mil é o número de vezes, não o tamanho**. Montar dois objetos custa nanossegundos
e avaliar a agregação custa microssegundos; o andaime era menos de 1% do que ele
embrulha.

### O que os três negativos seguidos dizem juntos

#109, a decisão do #110 e este apontam para o mesmo lugar: **o que sobra do cálculo é
trabalho de avaliação de verdade, não andaime em volta dele.** Memoizar chave, contar
id em vez de string, reaproveitar árvore — os três atacam a moldura. Ganho adicional
relevante agora exige mudança algorítmica: reaproveitar agrupamento entre linhas, que
é a família do #38 e do #43, e não micro-alvo.

---

## #112 — A Fase 3 não é "remover o `transform-engine`": ele não sai. E o mapa de cidades está escrito quatro vezes

**Data:** 15/09/2026

> **Corrigido pelo #114:** sao **cinco** blocos, nao quatro — o SQL de `protocolos-produtividade`
> encadeia a sequencia duas vezes. E a duplicacao deixou de ser silenciosa: `siglas-cidade.yaml`
> declara o mapa e um teste compara as cinco copias, nas duas linguagens.

O plano de desempenho descreve a Fase 3 como "remove o `transform-engine`". Fui medir
o que a camada M ainda faz, query por query, antes de começar.

### Ele não sai, e o motivo é de natureza, não de esforço

São **310 passos M em 25 queries** — e **8 delas não têm `sql:` nenhum**:

| query | fonte | passos |
|---|---|---:|
| `clima-tempo` | web (JSON) | **61** |
| `quadro-funcional` | Google Sheets | 7 |
| `capacidade-equipe` | Google Sheets | 6 |
| `apuracao-premiacao` | Google Sheets | 5 |
| `feriados` | inline | 3 |
| `hora-atualizado` | computed | 9 |
| `gestores-equipes` | odbc, **tem `sql:`** — ver correção abaixo | 9 |
| `backlog-agendado-futuro` | odbc, **tem `sql:`** — ver correção abaixo | 4 |

> **Correção, 15/09/2026 — as duas últimas linhas estavam erradas.** As duas queries
> **têm** `sql:`, as duas em `dbMaria`:
>
> ```
> gestores-equipes.spec.yaml:7        SELECT it.* FROM DB_Applicattion.Installation_Teams AS it
> backlog-agendado-futuro.spec.yaml:7 SELECT *FROM DB_Applicattion.Backlog_Schedules AS bs
> ```
>
> O que elas não têm é **SQL com trabalho dentro**: as duas são `SELECT *` de uma
> tabela só, então os 9 e os 4 passos de M não estão ali por falta de camada SQL —
> estão porque ninguém empurrou nada para dentro dela. Isso as move da coluna "não dá
> para empurrar" para a coluna "dá, e é barato": são duas tabelas pequenas (95.710 e
> 34.294 linhas) cujo SQL é uma linha, e reescrever essa linha não precisa de golden
> contra o banco real do jeito que `protocolos-geral` precisa.
>
> O total de 8 queries sem `sql:` cai para **6**, e todas as 6 são o que o parágrafo
> seguinte diz: planilha, API HTTP, inline e computed — essas de fato não têm para
> onde empurrar.

Uma planilha e uma API HTTP **não têm camada SQL para onde empurrar trabalho**. Enquanto
três planilhas e o `open-meteo` alimentarem o modelo, alguma coisa precisa fazer
`PromoteHeaders`, `Skip` e `Combine` — e é isso que o `transform-engine` é.

**O que a Fase 3 pode ser, de verdade:** encolher. A distribuição é muito torta — quatro
queries concentram **219 dos 310 passos**, e três delas são ODBC com `sql:` disponível:
`protocolos-geral` (56), `protocolos-auxiliares` (56), `protocolos-telefonia` (46). O
caminho já está provado: `protocolos-produtividade` saiu de ~60 passos para 3 em 10/09,
e o corpus caiu de 331 para 274.

### E o que a medição achou de quebra: o mesmo mapa, quatro vezes

As três grandes de ODBC têm **exatamente 16 `Table.ReplaceValue` cada**. Não é
coincidência de contagem — comparadas como conjunto, são **as mesmas 16, idênticas**:

```
'Canoas'          -> 'CAN'
'São Leopoldo'    -> 'SLE'
'Novo Hamburgo'   -> 'NHO'
'Sapucaia Do Sul' -> 'SPS'   ... e mais 12
```

E a quarta cópia está no **SQL** de `protocolos-produtividade` (duas vezes dentro do
arquivo, uma por ramo) — que é justamente a que migrou e hoje tem **zero**
`Table.ReplaceValue` no M.

**Consequência prática:** uma cidade nova, ou uma sigla corrigida, precisa ser editada
em quatro lugares, em duas linguagens. Esquecer um não dá erro — dá dois relatórios
discordando sobre a mesma cidade, com número plausível dos dois lados.

**Um quinto lugar, de outra natureza, que agrava:** as siglas também estão escritas à
mão no **DAX** de colunas calculadas de `PROTOCOLOS GERAL` — `"BASE (NHO/SLE/SPS)"`,
`"Equipe de Reparo NHO/SLE/SPS"`. Não é o mesmo mapa (ali a sigla é rótulo de
agrupamento, não tradução de cidade), mas **depende dele**: mudar a sigla de uma cidade
sem mexer nesses `IF` deixa o rótulo apontando para uma sigla que não existe mais.

### O que NÃO foi feito, e por quê

Nada. Mover 158 passos de três queries de produção para SQL exige regravar golden contra
o banco real e provar linha a linha — é sessão própria, e o risco de fazê-la pela metade
é alto. O valor deste achado é **impedir que alguém comece a Fase 3 pelo lado errado**:
a frase do plano manda remover um componente que não pode sair.

### A lição

> Um plano envelhece como uma ferramenta de medição envelhece (#106): continua
> respondendo, com a resposta de quando foi escrito. "Remover o `transform-engine`" era
> plausível antes de três planilhas e uma API entrarem no corpus. **Antes de executar
> uma fase de um plano, meça se a premissa dela ainda vale** — custou uma varredura de
> 25 arquivos e evitou uma sessão inteira empurrando uma porta trancada.

---

## #113 — O commit "restaurar 100% do estado" apagou um conserto decidido, e duas colunas voltaram a sair inteiras nulas por 20 dias

**Data:** 15/09/2026

`npm run snapshot:confere` acusa **três** colunas inteiras nulas que alguma página lê.
Eu li esse alarme três vezes hoje e o classifiquei como "problema de dado,
pré-existente" sem conferir. Na quarta, conferi.

### Duas das três têm conserto decidido, medido e registrado — que não estava rodando

`specs/_catalog/juncoes.yaml` declara, desde 13/08/2026, que duas mesclagens mortas
podem comparar a chave como inteiro. Cada entrada traz o número que a justificou:

```
backlog-agendado-futuro   0 de 88.143 casavam por especie; 60.425 (68,6%) como inteiro
protocolos-geral          0 de 33.459 casavam por especie; 25.707 (76,8%) como inteiro
```

O arquivo diz, com essas palavras: *"A materialização imprime que aplicou."* Ela não
aplicava.

| programa | roda a camada M | passa `reconcilia` |
|---|---|---|
| `tools/mrun` (diagnóstico) | sim | **sim** |
| `tools/snapshot` (**grava o que a API serve**) | sim | **não** |

### Quando, e como se perdeu

```
d2293e9  14/08/2026  "A mesclagem que nao casa nada fala, e so decisao registrada a conserta"
         + import { leJuncoes, reconciliadorDe }
         + const reconcilia = reconciliadorDe(leJuncoes(...))
         +       reconcilia,

0aae15c  26/08/2026  "feat(projeto): restaurar 100% do estado e desenvolvimento do dia 26"
         - import { leJuncoes, reconciliadorDe }
         - const reconcilia = reconciliadorDe(leJuncoes(...))
         -       reconcilia,
```

**O commit que prometia restaurar 100% do estado reverteu um conserto.** É o mesmo
episódio de `docs/RECUPERACAO-27-08.md`, e o README já lista "quatro coisas que este
README chegou a descrever e não existem no repositório". Esta é a quinta, e a única
que produzia número errado em vez de recurso faltando.

### O efeito, e por que ele não erra alto

Toda materialização desde 26/08 grava:

- `BACKLOG AGENDADO FUTURO['PROTOCOLOS GERAL.TIPO DE PROTOCOLO']` — 93.083 linhas,
  **100% nulas**, e a coluna é ponta de um relacionamento (`relationships.yaml`);
- `PROTOCOLOS GERAL['TECNICOS AUXILIARES.AUXILIAR']` — 94.166 linhas, **100% nulas**,
  lida por dois campos de `protocolos-detalhados`.

A tela mostra BLANK. Não há exceção, não há aviso: é um valor plausível para uma
coluna que simplesmente não tem dado. Pelos números de agosto, deveriam ser ~60.425 e
~25.707 linhas preenchidas.

**A terceira coluna nula NÃO é isto.** `PROTOCOLOS GERAL['TÉCNICO 2']` vem de
`GESTORES EQUIPES`, que lê uma tabela do dbMaria **que parou de ser alimentada em
junho de 2025** (achado #73). Nenhuma reconciliação a conserta, e ela está
corretamente fora do `juncoes.yaml`. Confundir as duas famílias seria trocar uma
junção morta por uma viva e errada — o que o motor recusa fazer sozinho, de propósito.

### O conserto, e o guarda que não existia

As três linhas voltaram para `tools/snapshot/src/index.ts`. E entrou o teste que
faltava (`packages/semantic-model/test/juncoes-ligadas.test.ts`): ele afirma que **as
duas** ferramentas que rodam a camada M montam e PASSAM o reconciliador.

Ele lê código-fonte, o que é grosseiro, e é escolha: os dois programas são CLIs que só
rodam com banco e credencial. Verificado que ele falha de verdade — removidas as três
linhas, o teste quebra (`1 de 2 ferramentas`). Se um dia a materialização puder rodar
contra fonte falsa, trocar por um teste que materialize e confira a coluna.

### ⚠ O dado em disco continua errado

Consertar o código não reescreve o snapshot. As duas colunas só voltam a ter valor na
**próxima materialização** dessas queries. Isso não foi feito aqui: exige o banco de
produção e mudaria o dado que ainda vai ser conferido na tela.

### As duas lições

> **Um alarme que toca há semanas vira paisagem.** `snapshot:confere` fez o trabalho
> dele todo dia; o defeito foi eu ler "3 erros" três vezes e classificar sem abrir. A
> pergunta que faltava não era "o que é isso?" e sim "desde quando?".

> **Decisão registrada sem teste é decisão que evapora.** O `juncoes.yaml` é exemplar —
> traz o número medido, a data, quem decidiu e o que reconferir. Nada disso impediu a
> ligação de sumir, porque nenhum teste afirmava que ela existia. Documento prova
> intenção; teste prova comportamento.

---

## #114 — O mapa de cidades: quatro cópias viraram cinco quando eu contei direito, e agora elas são comparadas por teste

**Data:** 15/09/2026

Continuação direta do #112, que achou o mapa `CIDADE -> SIGLA` repetido e **parou aí**.
Este fecha.

### Primeiro, a contagem estava errada — para menos

O #112 disse "quatro cópias". São **cinco blocos em quatro arquivos**: o SQL de
`protocolos-produtividade` encadeia a mesma sequência de nove `replace()` **duas**
vezes — uma para `SIGLA CIDADE` e outra dentro de `INDICE 2`, que é
`BAIRRO & "/" & SIGLA CIDADE` e por isso precisa traduzir de novo.

| onde | linguagem | blocos |
|---|---|---:|
| `queries/protocolos-geral.spec.yaml` | M (`Table.ReplaceValue`) | 1 |
| `queries/protocolos-auxiliares.spec.yaml` | M | 1 |
| `queries/protocolos-telefonia.spec.yaml` | M | 1 |
| `queries/protocolos-produtividade.spec.yaml` | SQL (`replace()` encadeado) | **2** |

### A ordem faz parte da definição, e quase passou batido

`Replacer.ReplaceText` substitui **substring**, não valor inteiro, e as nove chamadas
são encadeadas — cada uma recebe o resultado da anterior. Hoje nenhuma das nove cidades
é substring de outra, então a ordem não muda nada. Mas isso é propriedade **do dado**,
não do código: bastaria entrar uma cidade cujo nome contenha outra para a ordem passar a
decidir o resultado, e aí M e SQL teriam de encadear igual.

Quem escreveu o SQL sabia — o comentário lá diz *"A ordem é a do M"*. Por isso o teste
compara **lista ordenada**, não conjunto. Comparar conjunto passaria verde numa
divergência real.

### O que entrou

`specs/_catalog/siglas-cidade.yaml` — arquivo humano, na mesma prateleira do
`juncoes.yaml`. **Nenhum motor o lê**, e isso é deliberado: as substituições continuam
onde o Power Query as escreveu. O que ele é: a declaração de que as cinco cópias são a
mesma coisa.

`packages/semantic-model/test/siglas-cidade.test.ts` — 11 testes que extraem o mapa dos
cinco blocos, nas duas linguagens, e comparam com a declaração. Mais três guardas de
vizinhança:

- as duas correções literais de `INDICE 2` (`'Centro - Assentamento /NSR'` e
  `'Duque De Caxias /SLE'`, que existem porque o bairro de origem tem espaço sobrando)
  andam junto com o mapa e são comparadas junto;
- `protocolos-produtividade` **não pode voltar a ter `Table.ReplaceValue`** — ela migrou
  para SQL em 10/09 e ter os dois seria ter duas respostas para a mesma pergunta;
- toda sigla escrita à mão no DAX de `PROTOCOLOS GERAL` (`"BASE (NHO/SLE/SPS)"`,
  `"Equipe de Reparo EIO/CAN"`) tem de existir no mapa, e toda cidade comparada em
  `EQUIPES TEMPORARIAS` tem de ser cidade do mapa.

### Verificado que falha

Trocar `"Triunfo","TRF"` por `"TRI"` no M de `protocolos-telefonia` **e**
`'Esteio','EIO'` por `'EST'` no SQL de `protocolos-produtividade`:

```
✖ protocolos-telefonia: a camada M traduz as cidades exatamente como o catálogo
    no M:        ... Esteio->EIO, Triunfo->TRI, Porto Alegre->POA
    no catálogo: ... Esteio->EIO, Triunfo->TRF, Porto Alegre->POA
✖ protocolos-produtividade: os dois ramos do SQL encadeiam o mesmo mapa, na mesma ordem
    o ramo "SIGLA CIDADE" do SQL divergiu do catálogo

pass 9   fail 2
```

Pega nas duas linguagens e nomeia o par divergente. Um guarda que não se viu falhar não
é guarda — foi exatamente essa a lição do #113.

### O que NÃO foi resolvido

A duplicação continua lá. O certo é as cinco lerem do catálogo, e isso é reescrever
`m_expression` de três queries de produção com regravação de golden contra o banco real —
a mesma sessão que o #112 já reservou para encolher os 158 passos. **O teste não
substitui essa sessão; ele compra tempo para ela.**

E há um sexto lugar que nenhum teste protege: em `GRUPO`, o `IF` compara com o **nome da
equipe** (`"Equipe de Reparo EIO/CAN"`), que é string livre cadastrada no Voalle. Se lá
alguém renomear a equipe, o `IF` para de casar e o protocolo cai em `"OUTROS"` — em
silêncio, do lado de fora deste repositório. Está registrado no cabeçalho do YAML para
não ser descoberto duas vezes.

### A lição

> **Quando não dá para remover a duplicação, dá para tirar o silêncio dela.** A escolha
> não é entre "refatorar" e "deixar como está": entre as duas existe *declarar qual é a
> verdade e afirmar por teste que as cópias concordam com ela*. Custa uma tarde, não
> toca em query de produção, e converte um defeito que produz número plausível num
> vermelho no `npm test`. A dívida continua — mas para de render juros em silêncio.

---

## #115 — Metade do README era o mesmo texto repetido: 761 de 1.487 linhas

**Data:** 15/09/2026

Em 14/09 eu tirei do README **21 linhas de tabela** byte a byte idênticas, resíduo da
recuperação de 26/08, e dei o assunto por encerrado. Hoje, indo atualizar a contagem de
testes, medi o arquivo inteiro em vez de olhar a região que eu já conhecia.

### O tamanho

```
linhas do README ................ 1.487
linhas duplicadas ................. 761   (51%)
blocos exatos de 10+ linhas ........ 12
maior bloco ....................... 155 linhas
### Widget Engine (Fase 3) ......... 3 vezes, o cabeçalho inteiro
```

Os quatro maiores são recortes sobrepostos do mesmo trecho da seção **Measure Engine
(Fase 2b)** — 155, 130, 104 e 93 linhas —, o que tem a cara de uma colagem feita mais de
uma vez com limites diferentes, não de um `cat` acidental.

### Por que ninguém viu

Um README de 1.487 linhas não é lido de ponta a ponta: é lido por busca. Quem procura
"propagação por relacionamento" acha, lê, e vai embora — e não tem como perceber que o
mesmo parágrafo está três telas abaixo. **A duplicação de documento é invisível por
construção para quem consulta, e só aparece para quem mede.** Foi exatamente o que
aconteceu comigo em 14/09: eu vi as 21 linhas porque estavam *consecutivas*, e por isso
parei nelas.

E há o dano ativo: um documento que se repete **envelhece em pedaços**. Corrigir um
número numa das cópias deixa as outras duas dizendo o antigo, e aí o README passa a se
contradizer sem que nenhuma edição tenha sido errada.

### O conserto, e a trava que o tornou seguro

Remoção do maior bloco exato repetido, mantendo sempre a **primeira** ocorrência, até
não sobrar bloco de 10 linhas ou mais. O limite de 10 não é arbitrário: dez linhas
consecutivas idênticas de prosa não são coincidência, e abaixo disso começa a haver
repetição legítima (cabeçalho de tabela, cerca de código).

**A verificação é que fez isto ser seguro**, e ela é de uma linha: o multiconjunto de
linhas do resultado tem de conter toda linha não vazia do original. Se alguma sumisse
por completo, o programa recusava gravar. Sumiram **zero**.

```
1.487 -> 728 linhas   |   759 removidas   |   0 linhas únicas perdidas
cabeçalhos: 16 -> 13 (as três cópias de 'Widget Engine (Fase 3)' viraram uma)
cercas de código: 10 (par)   tabelas: 15   linhas em branco triplas: 0
```

### A lição

> **"Eu já olhei esse arquivo" não é o mesmo que "eu medi esse arquivo".** Ontem eu
> removi 21 linhas duplicadas do README e registrei como resolvido. Estavam ali outras
> 740, no mesmo arquivo, pelo mesmo motivo, e eu não as vi porque olhei onde o sintoma
> aparecia em vez de perguntar o tamanho do problema. É o mesmo erro do #110 — contar a
> ocorrência que saltou aos olhos e não dimensionar o conjunto — aplicado a documento em
> vez de a desempenho. **Dimensionar antes de consertar vale para prosa também.**

---

## #116 — 35 milhões de chamadas para perguntar 446 coisas, e o grupo de controle que não era controle

**Data:** 15/09/2026

A página mais cara do relatório é `agendamento-field`: **7,1 s de cálculo**, 39% do
custo das 14 juntas. O perfil de CPU apontou para `normalizeName`, com 618 ms (7,1%).

### A hipótese escrita no código estava errada, e o contador disse isso

`normalizeName` **já era memoizada**, com teto de 4.096 nomes, e o comentário dela
dizia: *"atingi-lo já é sinal de que alguém está passando dado aqui"*. Ninguém tinha
conferido. Instrumentei:

```
chamadas ...... 35.398.107
acertos ....... 35.397.661   (100,00%)
distintos ..............446
sem cache ................0   (teto de 4.096 NUNCA atingido)
```

Não havia dado nenhum passando por ali — era tudo nome de catálogo. **O memo estava
perfeito.** O desperdício era chamá-lo 35 milhões de vezes para perguntar 446 coisas, a
17,5 ns cada.

E isso fecha uma porta: baratear a chamada não tinha nada a ganhar. Vale a lição já
medida nesta campanha — trocar um `Map.get` por um `WeakMap.get` não ganha nada; só um
substituto de outra ordem de grandeza ganha. **Aqui o substituto era não chamar.**

### Onde estavam as chamadas

94,5% delas vinham de dois lugares, e o primeiro é o mesmo que liderava o tempo próprio:

```
indice        @ expansao.ts   1.451 ms  16,6%   (56,3% das normalizeName)
columnValue   @ evaluator.ts    109 ms          (38,2% das normalizeName)
```

`Navegador.indice(tabela, coluna)` é um memo — e montava a **chave do próprio memo** a
cada chamada:

```ts
const chave = `${normaliza(tabela)}[${normaliza(coluna)}]`;   // 2x normalizeName
const pronto = this.indices.get(chave);                        // string NOVA a hashear
```

A string é instância nova em toda linha, então o hash que o V8 guarda dentro da string
não serve: ele recalcula. Tudo isso para achar um índice que estava pronto desde a
primeira linha. E `segue()` faz isso **por linha, por aresta do caminho**.

### O conserto: o idioma que o próprio projeto já tinha

`Evaluator.leitorDeColuna` e `leitorDeIdentidade` existem exatamente para isto — tabela
e coluna fixas, laço sobre linhas, resolve o nome uma vez. `Navegador` era o único sítio
quente que ficara de fora. Entraram `preparaCaminho` e `leitorDeValor`, e
`enumeraCombinacoes` passou a montar os leitores **antes** do laço, como o ramo de tabela
única já fazia.

Ansioso ali e **preguiçoso** em `filtrosDaChave`, e a diferença não é gosto: aquele laço
percorre todas as linhas da âncora sempre, então o preparo se paga na primeira; o `keep`
do filtro pode nunca rodar — e a versão ansiosa lá já tinha sido **medida e perdido** em
14/09.

### O resultado, página por página, cada uma no seu processo

| página (isolada) | sem | com | ganho | pares |
|---|---:|---:|---:|---|
| `agendamento-field` | 7.495 ms | 5.297 ms | **+29,3%** | 4/4 |
| `relatorio-do-ano` | 125 ms | 96 ms | **+23,2%** | 4/4 |
| `protocolos-detalhados` | 939 ms | 841 ms | **+10,4%** | 4/4 |
| `l-inst` | 448 ms | 413 ms | +7,7% | 3/4 |
| `premiacao-instalacao` | 1.005 ms | 997 ms | +0,8% | 2/4 — ruído |

Relatório inteiro: **19.448 ms -> 17.749 ms (+8,7%)**.

E o resultado não mudou: **306 de 306 SHAs de visual idênticos** nas 14 páginas, pelo
`npm run paginas:shas` que entrou junto — ver a seção abaixo.

### ⚠ O grupo de controle no MESMO processo não é grupo de controle

A primeira leitura do A/B, medindo as 14 páginas numa execução só, dizia isto:

```
agendamento-field  +29,3%  4/4        <- o alvo
l-inst             -20,2%  0/4        <- "controle" piorou, consistentemente
premiacao          -13,6%  1/4
protocolos-detal.   -6,5%  0/4
```

Quatro páginas piorando 0/4 e 1/4 é sinal, não ruído — e teria condenado a mudança. Mas
as 14 rodam **no mesmo processo, em ordem alfabética**, e `agendamento-field` é a
primeira. Na variante rápida ela gasta 2,2 s A MENOS aquecendo o JIT para todas as
seguintes. O "controle" herda o estado do tratamento.

Medidas isoladas, as três perdas viraram ganho ou empate — `protocolos-detalhados` foi de
-6,5% para **+10,4%, 4/4**, uma inversão de 17 pontos.

### As duas lições

> **Um comentário que afirma um número é uma hipótese até alguém contá-la.** O teto de
> 4.096 vinha com a explicação pronta do que significaria atingi-lo — e o teto nunca foi
> atingido. A explicação apontava para o lugar errado ("tem dado passando aqui") e, se eu
> tivesse acreditado nela, teria ido procurar vazamento de dado em vez de contar chamada.

> **Grupo de controle que compartilha processo com o tratamento não é grupo de controle.**
> Aqui o vazamento foi por JIT e GC, e o sinal que ele produziu era forte e consistente —
> 0/4 em duas páginas. A regra que sobra é simples: quando A e B trocam de estado por
> algum canal, **cada medida no seu processo**, ou não é medida.

---

## #117 — Tirei três alocações por linha do laço mais quente da página mais cara e não ganhei nada

**Data:** 15/09/2026

> **Refeito na régua certa (#118), e o resultado MUDOU de sinal.** A medição abaixo
> está em armazenamento de objeto; a API usa colunar. Em colunar o buffer não empata —
> ele **perde 8,4% em 4 de 4 pares** (`map` 4.767 ms contra `buffer` 5.168 ms). A
> conclusão "não ganha" sobrevive e fica mais forte, mas o "2 de 4, dentro do ruído"
> não vale: o número bom é o de colunar, e está no comentário de `grupos.ts`.

Depois do #116, o perfil de `agendamento-field` mudou de dono: `enumeraCombinacoes`
passou a liderar com **18,1% do tempo próprio**. Fui atrás.

### O que parecia — e era mesmo — desperdício

```ts
for (const linha of base.filter.rowsOf(plano.ancora)) {
  guarda(chaves.map((c, j) => projetaNivel(c, leitores[j]!(linha), onde)), linha);
}
```

Por linha da âncora isto aloca **três objetos**: um fecho novo (a seta captura `linha`,
então não dá para içá-la), o array que o `map` devolve, e — dentro de `chaveDeValores` —
um segundo array, do `valores.map(identityKey)`. Três objetos para produzir uma string.
E os grupos são muito menos que as linhas, então quase todos eram descartados sem
ninguém ler. O ramo de tabela única **já evitava isso**, e o comentário dele diz por quê.

Troquei por um `Array` reusado, com `slice()` só quando o grupo é novo, e a chave
concatenada sem o array intermediário. Zero alocação por linha.

### O resultado

```
agendamento-field, isolada, 4 pares com ordem alternada
  sem   5064  5621  4890  5265     média 5.210 ms
  com   4965  5292  5076  5560     média 5.223 ms
  2 de 4 pares
```

**Nada.** Dentro do ruído, e do lado errado dele na média.

### Por que isso não é surpresa, e por que eu tentei assim mesmo

É a **terceira** confirmação nesta campanha da mesma lei: no V8, *alocação efêmera não é
o custo; trabalho repetido é*. Objeto que morre jovem sai no primeiro *scavenge* e o
coletor nem copia — é quase de graça, e o perfil que mostra 11,1% em `(garbage
collector)` não está dizendo que esses três objetos custam caro.

O contraste com o #116, no mesmo arquivo e no mesmo laço, é o que dá a regra:

| | o que era | ganho |
|---|---|---|
| #116 | remontar a **chave de um memo** por linha — normalizar dois nomes e hashear uma string nova para achar algo pronto | **+29,3%, 4/4** |
| #117 | alocar três objetos jovens por linha | **nada, 2/4** |

Os dois são "por linha". Um é repetir uma **resposta que já se tinha**; o outro é gerar
lixo. Só o primeiro paga.

**E tentei assim mesmo de propósito:** o perfil apontava 18,1% ali, e "eu já sei que
alocação não custa" é exatamente o tipo de convicção que precisa continuar sendo medida.
O custo de descobrir foi uma tarde; o custo de *não* descobrir seria este parágrafo não
existir, e alguém tentar de novo daqui a um mês.

### O que ficou

O laço voltou ao `map`, que é mais claro — e levou junto a nota do que foi medido e
recusado, com o número, na própria linha onde a ideia ocorre. O que sobreviveu da
empreitada é o que se sustenta sem ganho de tempo:

- **`SEPARADOR_DE_CHAVE`**, uma constante. O formato da chave de combinação estava
  escrito com o literal `' '` em três lugares, e três cópias de um literal é como uma
  muda sozinha e dois grupos que deviam ser o mesmo viram dois — com um número menor em
  cada, na tela, sem erro.
- **`packages/widget-engine/test/grupos-chave.test.ts`** (14 testes): as duas formas de
  montar a chave concordam, inclusive em zero valores, um valor, `BLANK` no meio, e os
  dois casos que tornam o separador seguro — `['a b']` não pode colidir com `['a','b']`.
- O comentário de `leitorDaChave` estava **órfão sobre a função errada**
  (`leitorDeIdentidadeDaChave`), desde antes desta sessão. Num projeto em que comentário
  é carga, isso não é cosmético.

### A lição

> **Um perfil diz onde o tempo está, não o que é removível.** `enumeraCombinacoes` com
> 18,1% era verdade; a conclusão "logo, tirar as alocações dali ganha tempo" era palpite.
> A pergunta que separa as duas é *qual pedaço daqueles 18% é trabalho que já foi feito
> antes?* — e a resposta aqui era: nenhum. **Percentual alto é permissão para investigar,
> nunca resposta sobre o que fazer.**

---

## #118 — A régua da campanha media o armazenamento que a API não usa, e um atalho inteiro estava morto: 0 de 47.767.560

**Data:** 15/09/2026

Terminado o #117, fui perfilar o relatório inteiro para achar o próximo alvo.
`identityKey` liderava com **3.802 ms, 14,3%** — e 34,1% dessas chamadas vinham de
dentro de `Evaluator.leitorDeIdentidade`, que existe **justamente para não chamar**
`identityKey`. O atalho estava sendo usado ao contrário.

### O contador

```
chamadas ............... 47.767.560
caminho rápido (dic) ... 0          (0,0%)
sem dicionário ......... 47.767.560 (100,0%)
  ...travou à toa ...... 0          (a linha TINHA dicionário)
molde diferente ........ 0          (0,0%)
```

**Zero.** Não uma fração pequena — zero. E `travou à toa` em 0 elimina a explicação
mais provável (a decisão do leitor é tomada na primeira linha e fica travada): o
dicionário não existia em linha nenhuma.

### A causa, e é a mesma família de erro que este repositório já registrou uma vez

`Evaluator.leitorDeIdentidade` tira a chave direto do dicionário da coluna, e
**dicionário só existe no armazenamento colunar**. A API carrega colunar
(`servidor.ts` e `worker-calculador.ts`, `colunar: true`). `tools/paginas` — a régua
com que esta campanha inteira mediu — carregava em **modo objeto**, por omissão.

Era a repetição do commit `468c39f`, *"a escada media o caminho que a API NÃO usa"*,
noutra ferramenta e um dia depois.

**A nota que autorizava isso existia, e eu a li errado.** `servidor.ts` diz que
"ferramenta em lote continua em objeto, de propósito" — e o motivo declarado ali é o
**materializador**: ele grava, e escrever coluna física numa vista tem de errar alto.
`tools/paginas` não grava nada; ela lê e calcula, exatamente como a API. A nota
cobria uma ferramenta e eu a apliquei a duas.

### O que isso custou, e o que não custou

O que **não** custou: nada do que foi commitado está errado. Refeito o A/B no
armazenamento certo, o ganho do #116 é **maior**, não menor:

| página, colunar, 4 pares alternados | sem | com | ganho | |
|---|---:|---:|---:|---|
| `agendamento-field` | 7.322 ms | 4.896 ms | **+33,1%** | 4/4 |
| `relatorio-do-ano` | 123 ms | 84 ms | **+31,9%** | 4/4 |
| `protocolos-detalhados` | 845 ms | 781 ms | **+7,5%** | 4/4 |

Em objeto eram +29,3%, +23,2% e +10,4%. Faz sentido que cresça: `preparaCaminho` usa
`leitorDeIdentidade`, e é em colunar que o atalho dele existe de verdade.

O que **custou**: o alvo seguinte. `identityKey` com 14,3% era o gargalo do caminho
que a API não executa. Eu estava a um passo de otimizar um problema que produção não
tem — e o perfil, sozinho, jamais diria isso.

### O conserto

`npm run paginas` e `npm run paginas:shas` passaram a carregar **colunar por padrão**,
com `--objeto` para o outro lado. Em colunar o relatório inteiro sai de **7.817 para
4.586 ms de carga** e de 15.676 para 14.297 ms de cálculo.

A troca é conferida, não suposta: os **306 SHAs das 14 páginas são idênticos nos dois
armazenamentos** — só a linha de banner do npm difere entre as duas saídas. É a mesma
pergunta que `npm run bench:colunar-paridade` responde, agora ao alcance de um `diff`.

### A lição

> **Uma ferramenta de medição tem uma configuração, e a configuração é parte da
> medida.** Eu conferi o relógio (#106), a metodologia (par a par, ordem alternada), o
> grupo de controle (#116) e a equivalência do resultado (306 SHAs) — e não conferi se
> a ferramenta estava ligada no mesmo modo que produção. O sintoma disso não é um
> número errado: é um número **certo sobre a coisa errada**, que é bem mais difícil de
> desconfiar.

> **Uma nota que autoriza uma exceção precisa dizer a QUEM ela se aplica.** "Ferramenta
> em lote fica em objeto" parecia cobrir `tools/paginas`; o motivo escrito logo abaixo
> ("é ela que GRAVA") só cobria o materializador. Duas frases, dois escopos diferentes,
> e quem lê rápido junta os dois.

---

## #119 — O `gunzip` entregava o snapshot em 4.033 pedaços de 16 KB, e a régua que mediria isso tinha três defeitos

**Data:** 15/09/2026

`DECISAO-DESEMPENHO.md` apontava: *"a próxima medida honesta é sobre `io`, que virou a
maior fatia (41,8%)"*. Fui medir, e a primeira coisa que a medição achou foi a régua.

### Os três defeitos da escada

**1. `e1io` media o `io` sem o utf-8.** Ele iterava `fluxoDeLeitura` sem `setEncoding`,
e num arquivo comprimido o pedaço chega como `Buffer` — então o degrau media disco +
gunzip, e a decodificação utf-8 inteira era cobrada do degrau seguinte, que se chama
`linhas`. A legenda do `io` sempre disse *"e decodificar utf-8"*: ela descrevia o ramo
do arquivo **cru**, que nenhum snapshot em disco usa desde que a compressão entrou.
Medido em `field-agenda.jsonl.gz`: 225 ms como `Buffer` contra 338 ms como texto.

**2. `decodif` era um degrau fantasma no formato 2.** `e4cDecodifica` só existia na
forma do formato 1 — `JSON.parse(texto) as unknown[]` e `valores[i]` —, e a linha do
formato 2 é um **objeto** `{c,w,d,b}`. Toda célula decodificava `undefined`. A coluna
saía `decodif 0,00`, e o trabalho real caía no degrau de baixo.

Isto refuta uma frase do plano: os **23,9% do `dicion` não eram o `ConstrutorDeTabela`
do bench** — no formato 2, `leColunar` nem chega a instanciá-lo (faz `new TabelaColunar`
+ `poe`, O(1) por coluna). Consertado, os 23,9% se partem em `decodif` 15,3% e `dicion`
14,0%, e os dois são custo de produção.

**3. O modo `--paginas` chamava `carrega` sem `colunar`.** Era o #118 sobrevivendo
dentro do mesmo arquivo: os degraus mediam colunar e a carga ponta a ponta, impressa na
mesma saída, media objeto.

### E a régua se acusou sozinha no meio do conserto

Escrito o novo `e4c` com `new Array(n)` e escrita indexada, ele ficou **mais caro que o
e5c** — que faz tudo o que ele faz e mais os ids — e as duas notas de *"a réplica
divergiu de `leColunar()`"* apareceram na saída. `new Array(n)` nasce HOLEY no V8 e cada
escrita paga a transição; `leColunas` usa `map`, cujo resultado sai empacotado. Trocado
por `map`, as notas sumiram e o total da escada caiu de 1.591 para 1.288 ms.

**A checagem `e5 < e4` funcionou exatamente como foi desenhada para funcionar**, e o que
ela pegou não foi o código de produção: fui eu.

### O alvo, depois de nomeado direito

```
io       43,3%   (dizia 41,8%, e faltava o utf-8)
parse    17,8%
decodif  15,3%   (dizia 0,00)
dicion   14,0%   (dizia 23,9%)
linhas    3,9%
```

Composição do `io` nesta máquina: **gunzip 75,4%, utf-8 20,7%, disco 3,9%.** Disco não é
o problema, e nunca foi.

### Os três consertos

**a) A coluna omitida pagava o `JSON.parse` da linha inteira.** O comentário de
`leColunas` promete que *"a coluna omitida nem é decodificada"*, e era verdade pela
metade: o `d` e o `b` não viravam valor nem id, mas o parse já tinha acontecido — e no
formato 2 a linha de uma coluna é o **dicionário inteiro dela**. Em produção `carrega`
omite 45 das 107 colunas.

A conferência de nome não podia cair junto, porque ler uma coluna pela outra dá a coluna
certa com o nome errado e nenhum erro depois disso. Ela virou um teste de **prefixo**,
exato porque `corpoDoFormato2` serializa `{c,w,d,b}` por literal de objeto, nessa ordem,
e é o único escritor deste corpo.

**b) O mesmo cabeçalho era inflacionado três vezes por tabela.**
`preservaEspecieDeJuncao` já lê o cabeçalho de toda tabela do plano e guarda num `Map`;
o laço relia cada um para `omissiveis`, e `leColunar` relia uma terceira vez só para
escolher o caminho pelo `formato`. Cada leitura é um `gunzipSync` de 128 KB — 30,3 ms
para uma passada nos 30 arquivos, e o relatório são 54 cargas de tabela.

**c) O `chunkSize` do zlib.** `fluxoDeLeitura` abria os dois fluxos sem opção nenhuma, e
os padrões do Node são 64 KB no `fs` e **16 KB no zlib**. Quem entrega o texto de um
`.gz` é o `gunzip`, então o que mandava era o 16 KB:

```
64 KB fs / 16 KB zlib (padrão) .... 139 ms   4.033 pedaços
1 MB fs  / 16 KB zlib ............. 134 ms   3.926 pedaços
64 KB fs / 1 MB zlib ..............  96 ms     176 pedaços
1 MB fs  / 1 MB zlib ..............  87 ms      69 pedaços   −37%
4 MB fs  / 4 MB zlib ..............  80 ms      17 pedaços
```

Subir o `fs` sozinho não faz quase nada; subir o zlib faz quase tudo. O custo que some é
o `for await` por pedaço — **o mesmo custo que tirou o `readline` de `paraCadaLinha`**,
uma camada acima, no dia anterior. A mesma falha, duas camadas, dois dias.

### A armadilha que quase deixou quatro testes verdes e vazios

`test/para-cada-linha.test.ts` fixava `65536` à mão e construía os quatro casos de
**borda** a partir dele — `\r` na borda, linha maior que o pedaço, multibyte partido,
`.gz`. Subir o pedaço para 1 MB os deixaria passando e **sem tocar em borda nenhuma**:
enchimento de 64 KB no meio de um pedaço de 1 MB não atravessa nada.

Teste que passa por ter parado de testar é pior que teste que falha, porque ninguém
volta a olhar. A constante virou `PEDACO_DE_LEITURA`, exportada de `formato.ts`, e o
teste a importa.

> Nota de quem escreveu: o `65536` estava comentado como *"o pedaço padrão de
> `fs.createReadStream`"* — e nem isso era verdade para os arquivos que a suíte lê, que
> são `.gz` e chegam pelo `gunzip`, cujo padrão é 16 KB. Um número mágico com um
> comentário errado ao lado é mais perigoso que um número mágico sozinho.

### O resultado, e onde isto para

```
npm run paginas, 14 páginas, colunar

carga ..... 4.734 ms  ->  2.895 ms     -38,8%
cálculo .. 14.808 ms  -> 13.595 ms
```

A/B do (c) sozinho: 8 pares com a ordem alternada, venceu em 7 — a única perda foi o
par 1, com a máquina fria; dos pares 3 ao 8 são 6/6, mediana 3.744 → 2.820 ms, −24,7%.
`npm test` 1924/1924 em cada passo, e os **306 SHAs das 14 páginas idênticos** aos de
antes nos dois commits de produção.

**Na escada, o `io` ainda é 37,1% — acima do portão de 25% que o plano tinha escrito. E
o portão estava medindo a fatia errada.** A carga inteira é hoje **17,6% do relógio**,
então 37,1% dela são 6,5% do total. O que sobrou do `io` também é trabalho intrínseco —
descomprimir e decodificar —, não desperdício. `zstd` e um formato 3 ficam registrados
como **não recomendados**: mudam o formato do arquivo para disputar 6,5%.

### A lição

> **Uma fatia percentual só significa alguma coisa junto com o denominador dela.** "O
> `io` é 41,8%" foi verdadeiro e útil enquanto a carga era o número grande. Ficou
> verdadeiro e **inútil** no instante em que a carga caiu para 17,6% do relógio — e
> nada na frase avisa quando isso aconteceu. Um portão de decisão escrito em % de uma
> fatia é um portão que se abre sozinho.

> **Quando dois números discordam, o mais provável é que a régua esteja errada — e ela
> tem três lugares para estar errada: o que mede, o que NÃO mede, e o que o rótulo diz
> que ela mede.** Aqui foram os três de uma vez, e o mais caro foi o terceiro: o `io`
> tinha a legenda certa sobre o laço errado, e o `decodif` tinha o laço certo para um
> formato que não existe mais.

---

## #120 — O próximo alvo, dimensionado: 1,75 milhão de chaves de 163,6 caracteres montadas para descobrir, em 62% dos casos, que o grupo já existia

**Data:** 15/09/2026

Fechada a frente `io` (#119), a carga virou 17,6% do relógio e o cálculo, 82%. Este
achado **não implanta nada** — ele mede o alvo seguinte e deixa o desenho decidido,
porque a metade cara deste trabalho é a medição, e a outra metade mexe no **formato da
chave de agrupamento**, que é onde errar não dá erro.

### O perfil, em colunar (a régua certa — #118)

`agendamento-field` sozinha, `--cpu-prof`. Cálculo 4.657 ms, dos quais 3 `tableEx`
concentram 3.895 ms (84%).

| self | % | função |
|---:|---:|---|
| 1.277 ms | 20,6% | `enumeraCombinacoes` @ `grupos.ts:456` |
| 636 ms | 10,3% | `(garbage collector)` — não é função, e o #117 já registrou que % aqui não quer dizer que o lixo custe caro |
| 394 ms | 6,4% | fecho de `leitorDeColuna` @ `evaluator.ts:354` |
| 384 ms | 6,2% | `identityKey` @ `value.ts:291` |
| 321 ms | 5,2% | `filtrosDe` @ `grupos.ts:275` |

Inclusivo: `enumeraCombinacoes` **2.534 ms, 51,6% do cálculo da página**.

**A régua estava certa desta vez:** o atalho do dicionário de
`Evaluator.leitorDeIdentidade` dispara em **78,5%** das chamadas, contra os
**0 de 47.767.560** que o #118 pegou em modo objeto. `identityKey` cai para 6,2% do
perfil, contra os 14,3% do artefato.

### O que já está fechado, e não deve ser proposto de novo

| alvo | achado | veredito |
|---|---|---|
| laço da **âncora**, tirar as 3 alocações por linha | **#117** | NEGATIVO, e refeito em colunar: perde 8,4%, 4/4 |
| remontar chave de memo por linha no `Navegador` | **#116** | positivo, **já implantado** (+33,1% nesta página) |
| memoizar `valores.map(identityKey)` em `filtrosDe` | **#109** | NEGATIVO, 4 variantes, *"ninguém precisa tentar isto de novo"* |
| fecho de `leitorDeColuna` | — | já está em **16,6 ns/chamada**, dos quais 7,1 ns são o acessor da vista colunar. Não há ordem de grandeza a ganhar |

O #117 diz, com todas as letras, que *"o ramo de tabela única já evitava isso"* — ele
nunca foi o sujeito de experimento nenhum. **É o que sobra aberto.**

### O alvo, contado (não amostrado)

Contador instrumentado no ramo de tabela única com **mais de uma** chave, 14 páginas:

```
chamadas ...................... 20
linhas varridas ........ 1.753.980
combinações distintas .... 663.019      (maior chamada: 147.566)
taxa de acerto ............. 62,2%
comprimento médio da chave . 163,6 caracteres
chaves por chamada ......... [5,6,3,2,3,5,3,8,16,2,2,2,3,2,3,3,3,3,31,23]
```

São **1,75 milhão de strings de ~164 caracteres** montadas por concatenação, cada uma
achatada e hasheada por um `Map.get`, para descobrir em **62% dos casos** que a
combinação já existia.

**E o custo é de trabalho repetido, não de alocação** — que é o teste que matou o #117.
As parcelas saem do dicionário **internadas**, então já têm hash em cache no V8; a
concatenação joga esse hash fora e produz uma string nova por linha, que o `Map.get`
precisa achatar e rehashear. É a assinatura do #116 (remontar por linha a chave de um
memo), não a do #117.

### O desenho, e a alternativa que a medição REFUTOU

A ideia óbvia — **`Map` aninhado**, uma camada por chave, descendo pelas strings
internadas — ganha bonito num ensaio de 5 chaves (2,7x) e **está fora**. Duas das 20
chamadas têm **31 e 23 chaves**, e 663.019 combinações distintas: seriam até 1,5 milhão
de `Map` intermediários vivos. Memória é exatamente o que a mudança colunar comprou
(3.378 → 324 MB); gastá-la de volta aqui é desfazer o trabalho.

O que sobra é **encurtar a chave, não trocar a estrutura**: uma tabela de internamento
por coluna, por chamada, dando um inteiro pequeno a cada identidade distinta, e a chave
da combinação virando um caractere por parte (`String.fromCharCode`). Troca-se *montar,
achatar e hashear 164 caracteres* por *K `Map.get` em strings com hash em cache, mais
uma string de K caracteres*. Ensaiado sobre a forma real: **−35%** no laço, mesmo no
pior caso, em que toda linha é uma combinação nova e a inserção domina.

Estimativa sobre o relógio TOTAL (16.490 ms): **−3,0% a −4,2%**.

### Por que isto não foi implantado hoje, e não é falta de tempo

**O formato da chave é um contrato entre duas funções.** `enumeraCombinacoes` a
escreve e `filtrosDe` a lê — `combinacoes.get(alvos.join(SEPARADOR_DE_CHAVE))` —, e as
duas precisariam passar a codificar igual, compartilhando as tabelas de internamento. O
ramo da âncora, que hoje entra pelo `chaveDeValores`, teria de vir junto: **duas
codificações no mesmo `Map` seriam um defeito calado**.

E calado é a palavra. Uma chave de agrupamento errada não levanta exceção: ela junta
linhas que não deviam se juntar, ou separa as que deviam, e devolve **um número menor e
plausível**. É a classe de falha que este repositório recusa por escrito. Implantar
isso pede o protocolo inteiro a cada passo — `npm run paginas:shas` com os 306 SHAs
conferidos por `diff`, A/B em processos separados com 4 pares de ordem alternada, em
colunar — e não a cauda de uma sessão que já mexeu na carga.

### A lição

> **Dimensionar o alvo é metade do trabalho, e é a metade que não estraga nada se
> estiver errada.** Foram dois ensaios sintéticos descartados antes de o terceiro
> servir: o primeiro gerou 1.800 combinações onde o real tem 663.019, e o segundo fez
> toda linha ser distinta. Os dois teriam autorizado o `Map` aninhado — que os números
> reais (31 chaves, 663 mil combinações) refutam por memória. **A cardinalidade do
> ensaio é parte do ensaio**, do mesmo jeito que o modo de armazenamento é parte da
> régua (#118).

---

## #121 — Três ferramentas não rodavam há onze dias, e a suíte não tinha como saber

**Data:** 15/09/2026

Fui medir a camada M para começar a migração dos 158 passos de M para SQL (#112), e **a
ferramenta que mede a camada M não arranca**. Não dá resultado errado: morre no
carregamento do módulo, antes da primeira linha de código.

### Uma causa, três programas, quatro formas

O commit `0aae15c` — *"restaurar 100% do estado e desenvolvimento do dia 26"* — colou
pedaços de duas versões diferentes por cima dos mesmos arquivos.

| programa | o que a restauração fez | efeito |
|---|---|---|
| `run:mlayer` | `import { isTable }` duas vezes | SyntaxError |
| `run:mlayer` | cópia **inline** de `Args`/`parseArgs`, a versão anterior à extração | SyntaxError |
| `run:mlayer` | `queryDependencies` em uso, `import` sumiu | ReferenceError |
| `run:mlayer` | bloco de 31 e de 17 linhas duplicado | saída repetida |
| `probe:gsheets` | `import { explicaErroSheets }` três vezes | SyntaxError |
| `probe:gsheets` | bloco de 74 linhas três vezes | 3 redeclarações |
| `probe:gsheets` | bloco de credencial da versão **pré-OAuth** | ReferenceError |
| `powerbi` | 3 funções chamadas e **nunca trazidas** | ReferenceError |
| `powerbi` | `else if (k === '--refaz')` duas vezes | ramo morto |

A cópia inline de `parseArgs` é a pior, e não pelo SyntaxError: era a versão **anterior
à extração** para `args.ts`, sem o campo `segundos`. Se tivesse carregado, o resto do
arquivo lê `args.segundos` e o `statement_timeout` viraria `NaN` — em silêncio. O
`--timeout=` documentado no cabeçalho do próprio arquivo não existia no parser que ele
usava.

`planoDeAgregacao`, `agregacaoComJanela` e `refDeColuna` **não existem em commit
nenhum**: a restauração trouxe as chamadas sem as definições. Reescritas em `janela.ts`,
ao lado das irmãs de medida.

### Por que nada disso apareceu por onze dias

`npm test` não carregava nenhum desses arquivos. `test:mlayer` exercita
`tools/mrun/src/args.ts` — o módulo extraído, testado, correto — e **não** o `index.ts`
que morria. A suíte estava verde o tempo todo, e estava certa: ela nunca afirmou nada
sobre aqueles arquivos.

E havia sintoma visível que ninguém leu: a saída do `run:mlayer` imprimia *"── Onde o
tempo vai ──"* **duas vezes**. Eu mesmo li essa saída nesta sessão, capturei o número
que queria e segui adiante. Quem lê uma saída longa não conta seções.

### A rede nova, e o que ela deliberadamente NÃO faz

`tools/validate/test/codigo-carrega.test.ts` roda o `tsc` sobre os 371 arquivos e
reprova **quatro** diagnósticos, todos da família *"este código não pode rodar"*:

```
TS2304  Cannot find name .......... nome usado, nunca importado nem declarado
TS2300  Duplicate identifier ...... o mesmo nome declarado duas vezes
TS2451  Cannot redeclare .......... idem, para const/let
TS2305  No exported member ........ importa nome que o módulo não exporta
```

Erro de **tipo** não reprova nada. O repositório é strip-only de propósito e não tem
`tsconfig.json`; o teste monta um em disco temporário, fora da árvore, e não cobra do
projeto uma disciplina que ele não adotou. Cobra só que o arquivo consiga executar.
Custa 420 ms.

> **Por que um verificador de tipos e não um `import()` de fumaça:** carregar um CLI
> executa o CLI — ele lê `process.argv`, abre pool de banco e escreve em disco. E dois
> dos quatro defeitos nem são de carregamento: são `ReferenceError` dentro de funções
> que só rodam contra o banco de verdade. Nenhum teste de fumaça razoável chegaria lá.

### O TS2305 entrou por medição, e é a parte que vale guardar

Ao conferir que o teste **reprova** o defeito original, a primeira tentativa reverteu só
**metade** dele — o `import` novo com o módulo velho — e **o teste passou**. Meia
reversão não dá *"cannot find name"*, dá *"no exported member"*, que o filtro não tinha.
Depois de incluído, conferido contra as quatro formas do dano, uma a uma: reprova as
quatro. E achou de quebra um import errado que ninguém via — `EngineEvent` pedido a
`types.ts`, onde nunca esteve (mora em `engine.ts`); era `import type`, então o Node
apagava a linha antes de ligar o módulo.

### A lição

> **Um teste que você não viu falhar não é um teste, é uma opinião.** A versão inicial
> deste passava tanto no código consertado quanto no quebrado, e eu teria commitado as
> duas coisas juntas — o conserto e a rede furada — com a consciência tranquila de quem
> viu verde. Só reprovar o defeito ORIGINAL, inteiro, prova alguma coisa.

> **Cobertura não se mede em número de testes, mas em arquivos que alguém carrega.**
> 1.924 testes verdes conviveram onze dias com três programas que não arrancavam. O
> ponto cego não era um ramo do código: era o arquivo inteiro, e ele estava do lado de
> fora da suíte — do jeito mais invisível possível, porque o módulo VIZINHO tinha teste.

---

## #122 — Duas colunas de `visao-geral` estão 100% vazias porque a fonte parou de ser alimentada em julho de 2025

**Data:** 15/09/2026
**⚠️ ISTO É AUDITORIA DE DADO, E A DECISÃO É DO ERICK.**

Com o `run:mlayer` de volta (#121), a primeira execução de `protocolos-geral` abriu com
um aviso que ela imprime e que ninguém lia há onze dias:

> `Table.NestedJoin 'INSTALADO POR:' + 'DATA FINAL' × 'TÉCNICO 1' + 'DATA': nenhuma das
> 29694 linhas de chave completa casou (…) esquerda de 2026-01-02 a 2026-09-15, direita
> de 2025-01-01 a 2025-07-16. Nenhuma reconciliação de tipo casaria: não existe par
> possível.`

### Medido, e é o caso extremo

No snapshot em disco, `protocolos-geral`, 95.075 linhas:

| coluna | valores distintos no dicionário | linhas com valor |
|---|---:|---:|
| `TÉCNICO 2` | **1** (o nulo) | **0** |
| `GERENTE/SUPERVISOR` | **1** (o nulo) | **0** |
| `TÉCNICO 1` | 96 | 28.560 |
| `EQUIPE` | 33 | 95.075 |

Na fonte, `DB_Applicattion.Installation_Teams` (dbMaria), consultada só por agregado:

```
linhas ............... 10.795
DATA até ............. 2025-07-15
por ano: 2024 → 5.153   2025 → 5.642   2026 → nenhuma
```

**A tabela parou de receber linha em julho de 2025** — há quatorze meses. O join é por
`DATA`, e todo protocolo da janela atual é de 2026. Não casa nenhum, e não vai casar.

### Onde isso chega na tela

* `specs/dashboards/visao-geral.spec.yaml:371, 468, 491` — `TÉCNICO 2` é campo de
  visual, e uma das três é uma **contagem** dele
* `specs/_catalog/measures/protocolos-geral.measures.yaml:159, 163` — duas medidas DAX
  filtram `GESTORES[GERENTE/SUPERVISOR]` por **dois nomes de pessoa específicos**

Uma contagem de coluna 100% nula dá **zero**, e zero é um número plausível. As duas
medidas dão zero pelo mesmo motivo. Nada erra alto em lugar nenhum.

### O que isto NÃO é

Não é defeito da plataforma, e não é defeito da camada M: o `Table.NestedJoin` fez o que
lhe pediram e **avisou** que a faixa das duas pontas não se toca. O aviso existe desde
que alguém o escreveu, e funcionou — ficou onze dias sem ser lido porque a ferramenta
que o imprime não arrancava (#121).

### O que precisa de decisão

1. `Installation_Teams` deve voltar a ser alimentada? (é cadastro de escala de equipe;
   se parou porque o processo mudou, o join é que está obsoleto)
2. Se não voltar: os três campos de `visao-geral` e as duas medidas mostram zero de
   propósito, ou saem da tela?

Enquanto isso não se decide, **o relatório mostra zero onde deveria mostrar ou um
número ou uma recusa**. A plataforma tem um jeito de recusar em vez de chutar — é o que
`paridade-janela.yaml` faz com tabela sem equalização —, e este caso se parece com
aquele.

> **A lição:** um aviso que ninguém lê é igual a um aviso que não existe. Este estava
> certo, específico, com os dois intervalos de data impressos lado a lado — e ficou
> onze dias invisível porque a ferramenta que o imprime estava quebrada. Diagnóstico
> bom morre junto com a ferramenta que o carrega.

---

## #123 — A régua da camada M estava fora do modo de produção, e os dois números que justificavam a migração de M para SQL eram dela, não da plataforma

**Data:** 15/09/2026

A migração dos 158 passos de M para SQL (#112) começa medindo a camada M. Antes de
escrever a primeira linha de SQL, fui conferir **o que ela compra** — e a régua estava
medindo outro programa.

### A omissão

`packages/transform-engine/src/runner.ts` recebe `guardaPassos`, e a omissão vale
`true`. `tools/snapshot` — quem materializa de verdade — passa **`false`** desde
09/09/2026, com o motivo escrito no próprio `avaliaQuery`:

> **`guardaPassos` é a diferença entre 9,8 GB e caber em 8 GB, medida em 09/09/2026.**
> […] mantendo as 56 tabelas intermediárias de `protocolos-geral` vivas ao mesmo
> tempo, 94.165 linhas × 63 colunas cada.

`tools/mrun` — a ferramenta de MEDIR a camada M — omitia a chave. Media um avaliador
que retém as 56 tabelas contra uma materialização que as libera assim que a última
citação é gasta.

### O que isso fez com os números

Mesma query, mesmas flags, só a chave:

```
protocolos-geral --colunas --timeout=1800

                         régua velha        régua em produção
heap ................... estourou em 8 GB   roda em 8 GB
total .................. 155.594 ms          67.131 ms
  banco ................ 128.731 (83%)       56.114 (84%)
  avaliação de M ....... 26.860 (17%)        11.013 (16%)
```

**Os dois números que eu tinha registrado como linha de base eram os dois falsos.**

1. *"`--memoria=8192` ESTOURA; é preciso 13.312 MB numa máquina de 16 GB. Esse estouro
   é, por si, metade do argumento da migração."* — **Não existe esse requisito.** Era da
   ferramenta. A materialização de produção roda em 8 GB e sempre rodou, desde 09/09.
2. *"avaliação de M: 26.860 ms"* — são **11.013 ms**. A régua inflava o alvo em **2,4×**.

(Parte da queda do total é o banco quente, não a mudança. O número que a mudança move
é o de M, e ele é 2,4× menor porque o avaliador passou a fazer estritamente menos
trabalho.)

### O que sobra da justificativa

A migração continua valendo — por outro motivo:

| argumento | estado |
|---|---|
| "a camada M precisa de 13 GB" | **caiu**, era da régua |
| "M é 17% da materialização" | é **16%**, de 11 s — e empurrar passo para o SQL move trabalho para dentro dos 84% que já são banco |
| "destrava `protocolos-geral` no refresh.yaml" | **não destrava**: ela está fora por `mysql2`, e o join de `GESTORES EQUIPES` fica em M de qualquer jeito |
| colapsar as 5 cópias do mapa CIDADE→SIGLA (#114) | **de pé** |
| 158 passos → ~6 | **de pé** |

**É uma migração de manutenção e de fonte única da verdade, não de desempenho.** E não
toca no relatório em momento nenhum: a tela lê o snapshot, nunca a camada M.

### A lição

> **A régua tem de estar no modo de produção — e "produção" inclui as chaves que a
> ferramenta de produção passa, não só o armazenamento que ela usa.** Esta é a segunda
> vez nesta campanha: em #118 a régua media objeto onde a API usa colunar, e agora ela
> media `guardaPassos: true` onde o materializador passa `false`. As duas vezes o
> sintoma foi o mesmo — um alvo maior do que é, e uma justificativa construída em cima
> dele.

> **O diagnóstico errado é mais caro que a ausência dele.** Sem medição nenhuma eu teria
> ido medir. Com a medição errada eu tinha uma linha de base, um arquivo de memória e um
> plano — e ia gastar uma sessão inteira migrando 158 passos para ganhar um número que
> não existia.

---

## #124 — O aquecimento de fundo enchia a chave errada, e errava 100% justamente na página que ele existia para consertar

**Data:** 15/09/2026

O pré-carregamento dos visuais abaixo da dobra (commit `15c0da6`) pedia `?visual=X` e
mais nada. Mas `filtros` faz parte de `ChaveDeResposta`, e a rolagem manda os filtros
com que a página abriu.

### Medido contra os 14 layouts reais

| página | visuais abaixo da dobra | filtro padrão | acertava? |
|---|---:|---|---|
| `agendamento-field` | **6** | SIM (mês corrente) | **NÃO** |
| `relatorio-do-mes` | 2 | não | sim |
| `premiacao-instalacao` | 1 | não | sim |
| as outras 11 | 0 | — | — |

Funcionava nas duas páginas com **3 visuais somados**, e errava 100% na única com peso:
`agendamento-field`, 10 faixas, a página que motivou o corte eager inteiro (#94) e que
leva ~2 min a frio. Ela abre travada no mês corrente, a rolagem pede
`?filtro=<mês>&visual=X`, e o aquecedor enchia `?visual=X`.

### Por que nada acusou

O topo de `corte-eager.ts` já avisava, em 2026, com o incidente que o gerou:

> Aquecer a chave errada não é lentidão, é aquecimento que **não aquece nada**; foi
> assim que um clique em rajada bateu 17s numa página que o próprio `npm start` tinha
> acabado de reportar "quente".

E o topo de `aquecedor.ts` promete que isso é impossível: *"Fazendo o mesmo GET que o
navegador faz, é impossível encher a chave errada."* A promessa é do arquivo; o código
novo saiu dela.

A suíte ficou verde: 1927/1927. E não por falta de teste — `aquecedor-eager.test.ts`
tem um `throw new Error('URL não esperada')` no `fetch` falso, exatamente para policiar
isto. O `catch {}` novo, de fundo, **engolia o throw**. Um teste que erra alto para
dentro de um `catch` genérico é um teste desligado.

### O conserto

* `#aquece` pede cada visual de fundo com os filtros da ABERTURA
  (`filtrosRecentes(pagina)[0]`), um GET por visual — `VisualNaDobra.tsx` pede um por
  vez, e pedir os seis juntos encheria a chave `[a..f]`, que ninguém lê. Só o recorte
  de abertura, e não os meses anteriores: cada item aqui é um visual pesado.
* `idsRestantes` virou a **diferença de conjuntos** contra `idsIniciais` nas três
  fontes (kpis, segmentações, faixas). A versão anterior omitia as segmentações de
  `todos`: correto hoje, e silenciosamente errado no dia em que o corte eager mudar de
  forma pela terceira vez — ele já mudou duas.
* Seis testes novos. O dos filtros foi conferido contra a versão anterior: reprova, e
  só ele.

### A lição

> **Um `catch` genérico dentro de um teste não é tolerância a falha: é uma tesoura no
> fio do alarme.** O `throw` que policiava as URLs do aquecedor estava lá, certo, e
> virou letra morta porque o código novo passou a engolir tudo o que o `fetch` falso
> levantasse. Quem escreve um `catch {}` de fundo está, sem querer, escolhendo também o
> que os testes daquele caminho ainda conseguem ver.

---

## #125 — `PROTOCOLOS TELEFONIA` e `PROTOCOLOS AUXILIARES` devolviam valor diferente a cada materialização, e ninguém tinha olhado: o conserto de 04/09 foi aplicado só à irmã do meio

**Data:** 15/09/2026
**⚠️ ISTO MUDA NÚMERO NA TELA. A conferência é do Erick.**

Achado **por acidente**, e é essa a parte que vale guardar. Fui construir o instrumento
de verificação da migração de M para SQL (#123) — um comparador que põe duas
materializações da mesma query lado a lado, coluna por coluna. Para provar que o
comparador funcionava, rodei-o com dois arquivos que **tinham** de ser idênticos: duas
materializações de `protocolos-telefonia` com o mesmo código, com um minuto de
diferença.

Onze das 42 colunas divergiram.

### Medido na fonte, com o banco congelado

O comparador podia estar acusando a vida do banco. Não estava. `npm run
probe:determinismo-pg` roda o mesmo SQL **duas vezes dentro de uma transação
`REPEATABLE READ READ ONLY`** — nenhuma linha nova pode entrar entre as duas:

```
protocolos-telefonia ..... 372 de 655 chaves (56,8%) mudaram de valor
  TÍTULO RECEBÍVEL .......... 312 de 655  47,6%
  USUÁRIO ................... 121 de 655  18,5%
  CTO ....................... 109 de 655  16,6%
  PONTO DE ACESSO / CODIGO .. 108 de 655  16,5%
  OLT ....................... 107 de 655  16,3%
  EQUIPAMENTO/SLOT/PORTA .... ~95 de 655  14,6%
  LATITUDE / LONGITUDE ....... 87 de 655  13,3%

protocolos-auxiliares .... 7.125 de 38.254 chaves (18,6%) mudaram de valor
  as mesmas 10 colunas, de USUÁRIO (18,6%) a LONGITUDE (13,8%)

troca-endereco ........... ✅ determinística
tecnicos-auxiliares ...... ✅ determinística
```

### A causa, e por que é a MESMA de onze dias atrás

```sql
ROW_NUMBER() OVER (PARTITION BY a.title ORDER BY s.start_date DESC)
```

Os `LEFT JOIN` de `authentication_*` multiplicam a partição — um contrato de
autenticação tem várias portas de splitter, uma assignment tem vários schedules, um
cliente tem vários endereços, um contrato tem 78,57 títulos recebíveis. Com o critério
de ordem empatado, o PostgreSQL escolhe **uma linha qualquer**, e outra na execução
seguinte. O `WHERE PERSONA1 = 1` guarda essa, e LATITUDE, CTO, OLT e PONTO DE ACESSO
mudam sozinhos.

**Isto já tinha sido achado, medido e decidido — em `protocolos-geral`.** 14.090 de
98.110 solicitações (14,4%), Erick decidiu o desempate em 04/09/2026, e ele foi
invertido em 13/09 quando se mediu que o casamento de contrato decide 4.013 casos
contra 5 do `active`. O `sql:` dela carrega o desempate e um comentário de 25 linhas
explicando cada termo.

**As duas irmãs ficaram para trás.** Mesma estrutura de `FROM`, mesmos aliases, mesmas
colunas, mesmo defeito — e nenhuma linha de conserto. Não por decisão: por ninguém ter
perguntado se o problema era só de uma.

### O conserto

O **mesmo** bloco de `ORDER BY` de `protocolos-geral`, literal, nas duas — mais
`frt.id`, que geral não precisa (ela tirou `financial_receivable_titles` do `FROM` e o
consulta por `EXISTS`).

Provado nos dois sentidos:

```
probe:determinismo-pg, depois do conserto
  protocolos-telefonia ..... ✅ 32 colunas, 0 divergência
  protocolos-auxiliares .... ✅ 32 colunas, 0 divergência

duas materializações seguidas de protocolos-telefonia (o caminho de produção inteiro)
  antes do conserto ........ ❌ 11 de 42 colunas divergiam
  depois do conserto ....... ✅ as 42 batem em todas as 640 chaves
```

### O que muda na tela, e por que "mudou muito" não é má notícia

Comparando a materialização anterior com a nova, **11 colunas mudam em 14% a 52% das
640 linhas de telefonia**. Parece enorme, e é — mas o valor anterior não tinha direito
nenhum a estar certo: era um sorteio, refeito a cada refresh. A comparação honesta não
é "o conserto mudou 331 linhas", é "o conserto escolheu uma linha diferente daquele
sorteio específico, em 331 casos".

O que Erick precisa conferir é se a linha escolhida agora é a certa — e o critério é o
que ele já decidiu para `protocolos-geral`: o contrato **daquele protocolo**.

### As duas lições

> **O instrumento de medir achou o defeito antes de medir qualquer coisa.** O
> comparador foi escrito para validar uma migração que ainda não começou; o primeiro
> uso dele foi um teste de sanidade — dois arquivos que tinham de ser iguais — e foi aí
> que o defeito apareceu. Vale gastar a primeira execução de um instrumento novo num
> caso onde a resposta é conhecida: é a única vez em que uma surpresa é informação
> pura.

> **Conserto aplicado a uma query não é conserto aplicado à família.** Em 04/09
> alguém achou, mediu e consertou a não-determinismo de `PROTOCOLOS GERAL`, e a
> pergunta "as outras duas têm o mesmo `ROW_NUMBER()`?" custava um `grep`. Ficou onze
> dias sem ser feita. Quando um defeito nasce de um padrão copiado — e aqui as três
> queries são cópias uma da outra —, o achado tem de terminar com a varredura das
> irmãs, não com o conserto da que doeu.

---

## #126 — `Text.AfterDelimiter(_, "-", 1)` aceitava o terceiro argumento e o jogava fora: CTO saía do campo errado em 99,1% da população, e as duas metades da plataforma discordavam entre si

**Data:** 16/09/2026
**⚠️ ISTO MUDA NÚMERO NA TELA. A conferência é do Erick.**

Achado ao migrar `protocolos-telefonia` de M para SQL. Antes de escrever a primeira
linha de SQL fui conferir o que cada passo de M faz **no nosso avaliador** — não no
Power Query, que é outro programa. O passo `CTO` é este:

```m
Text.BeforeDelimiter(Text.AfterDelimiter(_, "-", 1), "-")
```

Lido em voz alta: *depois da SEGUNDA ocorrência do hífen, até a próxima* — o terceiro
campo. Perguntado ao avaliador:

```
Text.AfterDelimiter("A-B-C-D", "-", 1)                            => "B-C-D"   (esperado "C-D")
Text.BeforeDelimiter(Text.AfterDelimiter("A-B-C-D", "-", 1), "-") => "B"       (esperado "C")
```

### A causa, em uma linha

As duas funções declaravam `maxArgs: 3` e desestruturavam `([v, delim])`. O terceiro
argumento passava pela conferência de aridade — e evaporava. Sem erro, sem aviso.

### O tamanho

```
authentication_splitters (a fonte de CTO nas quatro queries de protocolo)
  linhas ....................................... 26.534
  em que o 2º campo difere do 3º ............... 26.283   (99,1%)

protocolos-telefonia, medido na fonte viva em 16/09
  linhas com CTO não-nulo ...................... 550 de 655
  em que o valor MUDA com o conserto ........... 550       (100%)
```

### E a plataforma discordava de si mesma

`protocolos-produtividade` migrou para SQL em 10/09 e escreve
`NULLIF(split_part("CTO", '-', 3), '')` — o campo **certo**, porque quem migrou leu o
passo de M e o traduziu pelo que ele diz, não pelo que o avaliador fazia. As outras
três (`geral`, `telefonia`, `auxiliares`) continuaram em M, com o campo errado.

Resultado: para o mesmo protocolo, `PROTOCOLOS PRODUTIVIDADE`.CTO e
`PROTOCOLOS GERAL`.CTO devolviam coisas diferentes. Nenhuma das duas acusava nada —
as duas são texto plausível, com a cara de um nome de CTO.

### O conserto

`ocorrenciaDe(s, d, idx, fn)` em `packages/transform-engine/src/functions.ts`, usada
pelas duas funções. `0` (ou omitido) é a primeira ocorrência, `1` a segunda; ocorrência
que não existe cai na convenção que já existia para delimitador ausente — texto vazio,
não o texto inteiro. A forma `{n, RelativePosition.FromEnd}` **não** é adivinhada: erra
alto, porque adivinhá-la seria repetir exatamente o defeito que este parágrafo conserta.

Onze asserções novas em `avaliador.test.ts`, incluindo o encadeamento do passo `CTO`.

### A lição

> **Argumento aceito e ignorado é pior que argumento recusado.** A aridade foi
> conferida — `minArgs: 2, maxArgs: 3` — e essa conferência é justamente o que deu
> confiança de que o argumento fora recebido. Quem escreveu o passo estava certo; a
> plataforma discordou em silêncio e por quinze dias ninguém teve como saber. Se uma
> função aceita um parâmetro que não implementa, o caminho honesto é recusá-lo.

> **Ler o passo de M não é ler o que o M faz.** A migração ia traduzir
> `Text.AfterDelimiter(_, "-", 1)` para `split_part(..., 3)` — a leitura correta do
> passo — e o comparador teria acusado 550 de 550 linhas divergindo. Eu teria olhado
> para o resultado certo e concluído que a MIGRAÇÃO estava errada, porque a régua era
> a saída atual. Foi perguntar ao avaliador, antes de escrever SQL, que separou as
> duas coisas.

### O alcance na tela, medido

`npm run paginas:shas` antes e depois de rematerializar `protocolos-telefonia` com o
avaliador corrigido — o resto do snapshot intocado:

```
14 páginas, 306 visuais, 117 com conteúdo hasheado
mudou: 1 visual
  telefonia-ouvidoria  e5ffac48  tableEx  1 linha(s)
```

E o alcance total é esse mesmo, porque `CTO` é citado em **um** dashboard
(`telefonia-ouvidoria`) e em **nenhuma** medida ou coluna calculada — procurar por
`[CTO]` em `specs/_catalog/tables/` e `measures/` não devolve nada. As colunas `CTO`
de `PROTOCOLOS GERAL` e `PROTOCOLOS AUXILIARES` também mudam de valor quando forem
rematerializadas, mas não aparecem em tela nenhuma.

**É uma tabela, de uma página.** Erick confere um protocolo de telefonia cuja CTO ele
saiba de cabeça: até 15/09 a tela mostrava o segundo campo do nome do splitter, e
agora mostra o terceiro — o mesmo que `PROTOCOLOS PRODUTIVIDADE` já mostrava.

---

## #127 — O internamento da chave (#120) foi implantado, provado inócuo e REVERTIDO: a premissa tinha virado em um dia, e 80% das linhas não repetem nada

**Data:** 16/09/2026
**RESULTADO NEGATIVO.** O código foi revertido; fica a medição — e ela desautoriza o
desenho do #120 sobre o corpus de hoje.

O #120 deixou o alvo dimensionado e o desenho decidido, de propósito: *"a metade cara
deste trabalho é a medição, e a outra metade mexe no formato da chave de agrupamento,
que é onde errar não dá erro"*. Implantei o desenho, cumpri o protocolo que ele pedia,
e o resultado foi negativo — **não por defeito da implementação, mas porque os números
que autorizavam o desenho deixaram de valer entre 15 e 16/09.**

### O que foi implantado

Um codificador **por chamada de `prepara`**, com uma tabela de internamento por
POSIÇÃO da chave, dando um inteiro pequeno a cada identidade distinta. A chave da
combinação deixa de ser as identidades concatenadas e passa a ser um número fixo de
unidades de código por parte.

A parte que o #120 avisou ser perigosa — *"o formato da chave é um contrato entre duas
funções"* — foi resolvida com **uma instância só**, criada em `prepara` e compartilhada
por quem escreve (`enumeraCombinacoes`) e por quem lê (`filtrosDe`). Duas instâncias
dariam códigos diferentes para a mesma identidade e o `combinacoes.get` erraria em
silêncio. `filtrosDe` recebeu um `busca` que **não interna**: identidade que a
varredura não viu não tem grupo a encontrar, e internar ali encheria a tabela a cada
célula de matriz.

### O protocolo foi cumprido, e a inocuidade está provada

| conferência | resultado |
|---|---|
| `npm run paginas:shas`, colunar, mesmo snapshot | **306 de 306 SHAs idênticos** |
| `npm test` | **1.932 verdes, 0 falhando** |
| testes novos sobre o codificador | 11, incluindo a equivalência contra `chaveDeValores` |

A troca é **inócua no resultado**: nenhum dos 306 visuais mudou um byte. O que ela não
é, é mais rápida.

### O desvio do desenho do #120 — e por que não é ele o culpado

O #120 desenhou **uma** unidade de código por parte (`String.fromCharCode` do código).
Implantei **duas**, e isso não é preciosismo: uma unidade tem teto de 65.536 identidades
distintas por coluna, e acima dele `fromCharCode` trunca em módulo — dois valores
diferentes com o mesmo caractere, **dois grupos fundidos num, sem erro nenhum**. Não é
hipotético: quatro chamadas deste corpus têm **95.157 identidades distintas numa única
coluna**. O teste `mais de 65.536 identidades distintas numa coluna não colidem` (70.000
valores, 0 colisões) é o que separa os dois desenhos.

**E o desvio não explica o resultado.** O custo que domina é o `Map.get` + `Map.set` por
parte e por linha, idêntico nos dois desenhos; o que muda entre eles é o comprimento de
uma string de 6 contra 3 caracteres.

### A premissa virou — o mesmo contador do #120, um dia depois

Mesmo instrumento, mesmas 14 páginas, mesmo ramo (tabela única, mais de uma chave):

| | #120 (15/09) | hoje (16/09) |
|---|---:|---:|
| chamadas | 20 | **20** |
| chaves por chamada | `[5,6,3,2,3,5,3,8,16,2,2,2,3,2,3,3,3,3,31,23]` | **idêntico** |
| linhas varridas | 1.753.980 | **476.494** (−73%) |
| combinações distintas | 663.019 | 383.409 |
| **taxa de acerto** | **62,2%** | **19,5%** |

As chamadas são **as mesmas** — mesma quantidade, mesma forma, mesmas chaves por
chamada. O que mudou foi o dado por baixo delas. E a taxa de acerto é exatamente a
grandeza de que o desenho vivia: o ganho prometido era *descobrir barato que a
combinação já existia*.

### Onde as linhas estão hoje, e por que o internamento não tinha como ganhar

| página | chamadas | linhas | distintas | acerto | chave (car.) |
|---|---:|---:|---:|---:|---:|
| agendamento-field | 3 | 13.101 | 90 | 99,3% | 19,5 |
| instalacao-reincidente | 1 | 259 | 9 | 96,5% | 14,9 |
| **l-inst** | 1 | **95.157** | **95.157** | **0,0%** | 45,4 |
| **l-mapa** | 1 | **95.157** | **95.157** | **0,0%** | 40,0 |
| **l-tec** | 1 | **95.157** | **95.157** | **0,0%** | 28,0 |
| manutencao-inicial | 4 | 2.349 | 1.716 | 26,9% | 215,7 |
| premiacao-instalacao | 3 | 77.324 | 238 | 99,7% | 26,0 |
| relatorio-do-mes | 4 | 2.193 | 88 | 96,0% | 21,5 |
| telefonia-ouvidoria | 1 | 640 | 640 | 0,0% | 442,7 |
| **visao-geral** | 1 | **95.157** | **95.157** | **0,0%** | 348,6 |

**Quatro chamadas com taxa de acerto 0,0% concentram 380.628 das 476.494 linhas — 80%.**
Ali cada linha é um grupo novo: o `Map` não funde nada, ele só insere.

E é aí que o internamento é **prejuízo puro**. A 0% de acerto, toda identidade é
inédita, então cada parte paga um `Map.get` que falha MAIS um `Map.set` que hasheia a
string e aloca entrada — K inserções por linha —, e no fim ainda se monta a chave e se
paga o `get`/`set` da combinação. O código antigo pagava **uma** concatenação e **um**
par `get`/`set`. Troquei 1 hash por K+1 hashes para não reaproveitar nada.

O corpus é bimodal, e as duas pontas são hostis ao desenho: onde há repetição
(99,3%, 99,7%, 96,0%) as chaves são **curtas** (19 a 26 caracteres) e as linhas poucas —
há pouca concatenação a poupar; onde há linha em volume, **não há repetição nenhuma**.

### O A/B, e o que ele diz

Processos separados, ordem alternada a cada par, colunar — o protocolo do #120.

```
corpus inteiro (14 páginas), 4 pares
  velho  9155  8598  8757  10434   média 9236 ms
  novo   8617  8761  9957  10505   média 9460 ms
  o novo ganhou 1 de 4 pares            média +2,4% (mais lento)

as quatro chamadas de acerto 0,0% (l-inst, l-mapa, l-tec, visao-geral), 6 pares
  velho  3286  2539  2638  3033  3115  3588   média 3033
  novo   3445  3008  3045  3419  3146  3141   média 3201
  o novo ganhou 1 de 6 pares            média +5,5% (mais lento)
```

**2 de 10 pares.** O desenho é uma perda.

### A assinatura que confirma o mecanismo, e não depende do relógio

O A/B do corpus, por página, ordena a perda quase exatamente pelo **inverso do
comprimento da chave antiga** — que é o que a teoria manda, já que a economia da
concatenação cresce com o comprimento e o custo do internamento é constante por parte:

| página | chave antiga | efeito |
|---|---:|---:|
| l-tec | 28,0 car. | **+16,5%** |
| l-mapa | 40,0 car. | +7,8% |
| l-inst | 45,4 car. | +9,2% |
| visao-geral | 348,6 car. | +2,5% |

Quanto mais curta a chave que se deixou de montar, pior o negócio. É o mecanismo
falando, não a variância — ainda que `l-mapa` e `l-inst` estejam trocados dentro do
ruído.

### ⚠ A régua estava suja, e registrar isso faz parte do achado

**Outro agente trabalhava na MESMA árvore durante toda esta medição.** Descoberto ao
conferir `git status` antes de reverter: `specs/_catalog/queries/protocolos-telefonia.spec.yaml`,
`tools/refresh/test/daemon.test.ts` e uma dúzia de arquivos em `scratch/` mudaram sem
que eu os tocasse, e um diretório foi criado **cinco segundos** antes de eu olhar. No
meio da sessão o HEAD andou (`a4bf894`), e com ele um teste novo.

Duas consequências, e as duas importam:

1. **Um número meu ficou explicado, e a minha primeira explicação estava errada.** A
   suíte saiu de 1.934 para 1.932 e eu atribuí a diferença a contenção de CPU no
   baseline. Não era: o meu arquivo de teste caiu de 14 para 11 casos (−3) e o outro
   agente acrescentou 1 (`1934 − 3 + 1 = 1932`). Contenção não cria nem destrói teste;
   foi preguiça de diagnóstico, e o `git log` respondia em um comando.
2. **O ruído do A/B é grande e a máquina derivou** (8.598 a 10.434 ms no MESMO código
   velho — 21%). A ordem alternada existe para espalhar deriva nos dois lados, e a
   conclusão não se apoia só no relógio: ela se apoia na **contagem** (0,0% de acerto
   em 80% das linhas), que independe de quem mais está na máquina.

Verificado que `packages/widget-engine/src/grupos.ts` é **byte a byte igual** em
`16b7e62` e no HEAD de agora, então o lado "velho" do A/B foi o mesmo o tempo todo.

### A lição

> **Alvo dimensionado tem prazo de validade, e o prazo pode ser de um dia.** O #120 fez
> tudo certo — contou em vez de amostrar, descartou dois ensaios sintéticos, refutou o
> `Map` aninhado por memória — e mesmo assim autorizou um desenho que, 24 horas depois,
> só podia perder. Não porque a medição estivesse errada: porque **a taxa de acerto não
> é propriedade do código, é propriedade do dado**, e o dado tinha mudado.
>
> O que deveria ter vindo antes de escrever a primeira linha era **repetir o contador**,
> que custa um `--pagina=` por página e responde em dois minutos. Repetir a medição que
> autoriza o trabalho é mais barato que o trabalho — e aqui teria poupado a implantação
> inteira.
>
> Fica registrado, como o #109 e o #117: **ninguém precisa tentar isto de novo** sem
> antes recontar a taxa de acerto. Se ela voltar aos 62%, o desenho volta à mesa — e
> com duas unidades de código por parte, não uma.

## #128 — A instrução de dimensionar o refresh mandava reservar ~4 min de recomputação que tinham virado 9,8 s doze dias antes, no commit do dia seguinte

**Data:** 16/09/2026
**Não é bug: é premissa vencida.** Nenhum número ficou errado na tela, nenhum intervalo
ficou curto demais. O que ficou errado foi a **regra de dimensionamento** que governa
todo intervalo novo de `specs/_catalog/refresh.yaml` — e ela errava por 24×, sempre a
favor da segurança, que é exatamente o tipo de erro que ninguém vai atrás.

### O que o arquivo mandava

O bloco `ATENÇÃO (03/09/2026, ACHADOS #89)` media que `calculadas.ts --todas` — que
qualquer grupo bem-sucedido dispara em seguida — recomputava as quatro colunas de
`Status Protocolo Dia` do zero a ~50-65 s cada, e fechava com a instrução:

> *"ao dimensionar qualquer intervalo novo, use o tempo de busca MAIS esses ~4 min, não
> só o primeiro."*

Os comentários de `frio` obedeciam: `field-agenda-slot` estava contabilizada como
"13,5s de busca + os ~4 min = **~4min15s reais por tick**", e a folga do intervalo de
30 min era justificada contra esse total.

### O que ele custa hoje

`npm run snapshot:calculadas -- --todas`, contra o snapshot em disco, processo inteiro
cronometrado de fora em **10.309 ms** (relatório interno: 9.852 ms):

| tabela calculada | tempo | linhas |
|---|---:|---:|
| BASE DE ORIGEM | 6 ms | 3 |
| calendar | 12 ms | 13.099 |
| **CALENDARIO AGENDAMENTO** | **3.787 ms** | 730 |
| CALENDARIO CRIADO | 6 ms | 365 |
| CALENDARIO INSTALADO | 12 ms | 713 |
| PROTOCOLOS | 2 ms | 10 |
| **Status Protocolo Dia** | **2.934 ms** | 13.099 |

`Status Protocolo Dia` sai por `[tradução nativa]` e **não avalia uma linha de DAX**. A
maior fatia do encadeamento deixou de ser ela: passou a ser `[DATA VIGENTE?]` de
`CALENDARIO AGENDAMENTO`, 3.671 ms para 730 linhas.

### A causa, e por que é o tipo de defeito mais fácil de deixar passar

O conserto existe desde **04/09/2026** — commit `9083221`,
`packages/snapshot/src/nativas.ts`, cujo próprio docstring de abertura diz o número:
*"Congelar `Status Protocolo Dia` custa 211 s dos 238 s de `npm run
snapshot:calculadas -- --todas`"* e a agregação levou aquilo *"para 4,6 s, 57× mais
rápido"*.

Ou seja: a medição correta foi feita, escrita e commitada **um dia depois** do bloco
que ela invalidava. Ela só foi escrita **no arquivo que mudou**, e o arquivo que
carregava a *instrução* baseada nela ficou intocado por doze dias. Nada os liga: o
`nativas.ts` não cita `refresh.yaml`, e o `refresh.yaml` não citava `nativas.ts`.

O efeito prático não é teórico. O `frio` foi dimensionado sob a conta antiga, e o
comentário dele explicitamente rejeitava a conta certa — *"30 min dá ~7× de margem
sobre esse total — não sobre só a busca, que sozinha sugeriria um número
perigosamente pequeno"*. O total real de um tick de `frio` medido hoje é **190 s**, e a
quase totalidade é a busca de `protocolos-produtividade` (~162 s), justamente o item
que aquela frase mandava não usar como referência.

### O conserto

`specs/_catalog/refresh.yaml`, três blocos: o `ATENÇÃO` passa a carregar a tabela acima,
a data em que o número caiu e a nova regra — **some ~10 s, não ~4 min** — e os dois
comentários de `frio` que citavam "~4min15s" passam a citar os 190 s medidos.

### A lição

> **Uma otimização conserta o custo no arquivo dela; não conserta a instrução que
> alguém escreveu em cima do custo antigo.** O `nativas.ts` fez tudo certo — mediu,
> provou fidelidade célula a célula, travou a tradução por sha. O que faltou foi um
> `grep` pelo número que ele acabava de derrubar.
>
> Aqui errou-se para o lado seguro, então o preço foi só orçamento parado. O mesmo
> descolamento para o outro lado é um intervalo dimensionado contra um custo que
> cresceu — e aí o tick seguinte começa antes do anterior terminar.
>
> **Ao derrubar um número que está escrito em algum lugar, procure onde ele está
> escrito.** `grep -ran "4 min\|211 s\|238 s" specs docs` custa segundos.

## #129 — A stack ficou 3h43 fora do ar sem nada avisar, e o `refresh-status.json` teria apagado o rastro de qualquer jeito: o daemon ganhou quem o ressuscite e onde deixar história

**Data:** 16/09/2026
**Observado ao vivo, não deduzido.** Às 14:04 não havia processo `node` nenhum da
plataforma na máquina — nem `npm start`, nem a API, nem o daemon. O último tick tinha
sido às 10:25. Três horas e quarenta e três minutos de dado parado, e nada em lugar
nenhum tinha mudado de cor.

```
processos node da plataforma às 14:04 .... nenhum
último sucesso por grupo (refresh-status.json)
  quente  2026-09-16T13:21:01Z   idade  223,1 min   (intervalo declarado: 15 min)
  medio   2026-09-16T13:22:20Z   idade  221,8 min   (intervalo declarado: 20 min)
  frio    2026-09-16T13:25:30Z   idade  218,6 min   (intervalo declarado: 30 min)
daemon --so-plano --so-uma-vez ........... quente/medio/frio: os três vencidos
falhasConsecutivas ....................... 0, 0, 0
```

A última linha é a que importa: **o arquivo de status dizia que estava tudo bem.** Ele
não tem como dizer outra coisa — `falhasConsecutivas` só sobe quando um tick roda e
falha, e aqui não havia tick nenhum rodando. Ausência não é falha, e a única estrutura
de observabilidade do refresh não distingue as duas.

### O repositório já tinha previsto, por escrito

O docstring de `tools/refresh/src/index.ts`, ao justificar o modelo de *tick* curto
contra o de daemon 24/7:

> *"Um daemon 24/7 fora da API funcionaria, mas o Windows não tem PM2/systemd hoje
> (docs/DEPLOY.md, tabela de prontidão) — **viraria um processo que ninguém reinicia
> sozinho se cair no meio de um ciclo**. O modelo 'tick' tem raio de explosão
> estritamente menor."*

O daemon veio assim mesmo, e em 16/09 virou o padrão do `npm start` — pela razão certa
(o gatilho externo que o modelo de tick pressupõe nunca foi criado nesta máquina), mas
sem o "alguém que reinicia" que o próprio arquivo dizia faltar. A previsão estava no
repositório o tempo todo; o que faltava era alguém reler a própria objeção depois de
contorná-la.

### O segundo defeito, que só aparece quando o primeiro é consertado

Suponha o daemon supervisionado e de pé. Uma falha às 03:00 seguida de um sucesso às
03:15 deixa `refresh-status.json` assim:

```
falhasConsecutivas: 0        (zerada pelo sucesso)
erro:                        (sobrescrito, some)
ultimaTentativa: 03:15       (a das 03:00 não existe mais)
```

**Zero rastro.** O arquivo guarda UM registro por grupo e cada tick o sobrescreve. E o
daemon não escrevia em lugar nenhum: `npm start` o sobe com `stdio: 'inherit'`, então as
linhas dele viviam no terminal de quem digitou o comando e morriam junto com ele.
Fechado o terminal, o que o agendador fez de madrugada era irrecuperável por construção.

A prova por acidente estava no próprio diretório: `snapshot/protocolos-geral.erro.log`,
de 02/09, era o **único** erro que sobreviveu em disco em catorze dias — e sobreviveu por
um caminho de código diferente (`guardaErro`, em `tools/snapshot/src/index.ts`), não
pelo refresh.

> **Esse arquivo foi apagado em 17/09/2026**, depois de confirmado que a carga que ele
> registrava já tinha sido resolvida (falta de `mysql2`; o `manifesto.json` traz
> `protocolos-geral` com 95.442 linhas, materializada no mesmo dia). Ele era resíduo,
> não estado — mas o achado acima continua valendo inteiro, e é por isso que o
> histórico do refresh existe: sem ele, o rastro de uma falha some no próximo tick.

### O conserto

**1. Supervisão com teto** — `tools/subir/src/supervisao.ts`, novo. `decideRessurreicao`
é pura: recebe quanto o processo viveu e quantas mortes rápidas houve antes, devolve se
ressuscita e quanto esperar. Espera crescente `5s → 15s → 45s → 2min → 5min`; no teto,
desiste em voz alta imprimindo o comando de diagnóstico.

Duas decisões que não são detalhe:

- **O teto existe para não esconder defeito determinístico.** `.env` quebrado ou
  `refresh.yaml` inválido matam o daemon igual nas próximas mil vezes; respawn sem
  limite transformaria uma falha legível num terminal rolando para sempre, e o operador
  perderia justamente a mensagem que diz o que consertar.
- **A vida mínima (60 s) mede falha em *se sustentar*, não falha alguma vez.** Sem ela,
  cinco quedas isoladas em semanas diferentes esgotariam o orçamento de um daemon que
  nunca deu problema.

**2. Histórico** — `tools/refresh/src/historico.ts`, novo, escrevendo
`snapshot/refresh-historico.log`. Uma linha por evento (`arranque`, `grupo`,
`erro-de-ciclo`), lida com `node tools/refresh/src/daemon.ts --historico`.

Três decisões:

- **`.jsonl`, não outro `.json`.** Acrescentar é `appendFileSync` — sem ler, sem
  mesclar, sem read-modify-write. É a mesma razão pela qual os grupos rodam em série
  (ver `tick.ts`): dois escritores num JSON que precisa ser lido antes de ser escrito se
  apagam em silêncio. Aqui não há o que mesclar.
- **A gravação é por GRUPO, não por tick.** `executaTick` já persiste o status depois de
  cada grupo para que um tick morto no meio não perca o que terminou; o histórico segue
  a mesma regra, embrulhando `roda` em vez de varrer `resultados` no fim.
- **Nunca derruba o daemon.** Toda operação é `try/catch` mudo, e `leHistorico` pula
  linha ilegível em vez de lançar. Um histórico que impede o refresh de rodar seria pior
  que nenhum: o trabalho é o refresh, a observabilidade é o acessório.

**2b. O sufixo `.log`, e não `.jsonl` — um defeito achado antes de existir.** O arquivo
mora dentro de `snapshot/`, e `.jsonl` é o sufixo de TABELA de snapshot (`SUFIXO_CRU`,
em `packages/snapshot/src/formato.ts`). Três varreduras reconhecem tabela pelo nome sem
abrir arquivo nenhum — `tools/snapshot/src/confere.ts`, `tools/snapshot/src/converte.ts`
e `tools/bench/src/carga.ts`. Medido, não suposto:

```
ehArquivoDeSnapshot('refresh-historico.jsonl') .... true   <- entraria como query
ehArquivoDeSnapshot('refresh-historico.log') ..... false
ehArquivoDeSnapshot('protocolos-geral.erro.log') . false
ehArquivoDeSnapshot('refresh-status.json') ....... false
```

É o mesmo cuidado que `guardaErro` já registra em `tools/snapshot/src/index.ts` — *"o
nome termina em `.erro.log` para não ser confundido com tabela por `leManifesto`"*. O
aviso estava escrito a três arquivos de distância, e foi preciso ir procurá-lo: o teste
`o nome do arquivo NÃO pode ser confundido com tabela de snapshot` é o que impede a
próxima pessoa de reintroduzir isso por achar `.jsonl` mais descritivo.

**3. O arranque entra no histórico com o PID.** É o que separa *"o daemon está parado
desde as 03:00"* de *"o daemon esteve ressuscitando a noite toda"* — sem essa linha, o
respawn é invisível e o sintoma dos dois casos é idêntico.

### O que continua faltando, e é preciso dizer

O que ressuscita o daemon é o próprio `npm start`. **Se ELE morrer, ou se a máquina
reiniciar, não há nada** — e foi exatamente isso que aconteceu hoje.

A linha de cima virou `tools/subir/agenda-no-windows.ps1`, o análogo Windows de
`tools/refresh/cron.sh` um nível acima (lá se agenda um *tick*, aqui a *stack*). Ele
registra, remove, e tem `-Simular` que imprime o que faria sem tocar no Agendador. **A
tarefa NÃO foi registrada** — registrar exige Administrador e é uma mudança na máquina,
não no repositório; o comando está em `docs/DEPLOY.md` §2.3.

Duas decisões dele que não são detalhe:

- **O gatilho padrão é "ao fazer logon", não "ao iniciar o sistema".** `npm start`
  precisa do `.env` do repositório e de `~/.secrets/powerbi-token.json`, que são do
  perfil do usuário — uma tarefa como SYSTEM não os enxerga. E "ao iniciar o sistema"
  com a identidade do usuário exige senha guardada no Agendador, ou `-LogonType S4U`,
  que roda sem console na sessão 0. Numa estação de trabalho onde alguém faz logon todo
  dia, nenhum dos dois paga o que custa. `-AoIniciarOSistema` registra a variante S4U
  para o caso de máquina ligada sem ninguém logado.
- **O arquivo precisa de BOM.** O Windows PowerShell 5.1 lê `.ps1` sem BOM como ANSI da
  página de código do sistema: as mensagens saíram com "só" virando "sÃ³" na primeira
  execução. A regra 5 do `CLAUDE.md` — toda mensagem em português — não sobrevive a um
  editor que "limpe" o BOM, e não dá erro nenhum ao quebrar. Está escrito no topo do
  script.

A tabela de prontidão de `docs/DEPLOY.md` foi corrigida para dizer "meio caminho" em vez
de "não existe", que era o que ela dizia, e "pronto", que é o que a linha do refresh
dizia logo acima.

### A lição

> **Um sistema que não sabe distinguir "não falhou" de "não rodou" reporta saúde
> perfeita justamente quando está morto.** `falhasConsecutivas: 0` em três grupos era
> verdade literal e informação inútil: ninguém tinha tentado nada.
>
> E quando o próprio repositório escreve a objeção — *"viraria um processo que ninguém
> reinicia sozinho"* — contornar o desenho sem resolver a objeção não a apaga. Ela fica
> esperando, em geral até a primeira noite em que ninguém está olhando.

## #130 — A tabela que alimenta 12 das 14 telas não tinha refresh nem poll, por um bloqueio que morreu em 09/09 — e o commit que o matou tem o nome dela no título

**Data:** 16/09/2026
**É o #128 outra vez, e caro.** Lá, uma instrução de dimensionamento ficou doze dias
apontando para um custo que já não existia; o preço foi orçamento parado. Aqui, a mesma
mecânica — a correção escrita só no arquivo que mudou — deixou `PROTOCOLOS GERAL` **sem
cadência nenhuma**.

### O que foi encontrado

Seis queries materializadas não pertencem a grupo nenhum de `specs/_catalog/refresh.yaml`.
Quatro por razões vivas. Duas não:

```
materializadas, sem grupo de refresh, em 16/09/2026 às 14:2x
  protocolos-geral .......... 95.278 linhas    12 de 14 telas   SEM poll
  backlog-agendado-futuro ... 95.949 linhas     1 de 14 telas   SEM poll
  protocolos-auxiliares ..... 38.087 linhas     0 de 14 telas   poll de 12 s
  field-agenda .............. 643.176 linhas    3 de 14 telas   (achado #82, legítimo)
  capacidade-equipe ......... 10.835 linhas     2 de 14 telas   (nunca medida, #80)
  apuracao-premiacao ........ 73 linhas         0 de 14 telas   (nunca medida, #80)
```

`protocolos-geral` é a linha que importa. Ela não tem refresh automático **e** está
excluída do poll de quase-realtime: o arquivo em disco só mudava quando alguém digitava
o comando. Em 16/09 estava com 20 horas.

### A premissa, e as duas vezes que ela morreu

`refresh.yaml` dizia, na entrada 3 das exclusões:

> *"`protocolos-geral` — o M dela faz `Table.NestedJoin` com `GESTORES EQUIPES`
> (dbMaria), e o pacote `mysql2` não está instalado nem declarado em package.json …
> **Fora daqui até o pacote existir**."*

```
02/09  6391988  "troca mariadb (nunca importado) por mysql2 (o que o código usa)"
                -> bloqueio 1 morre no MESMO DIA em que o achado #83 o registrou
02/09           o #83 registra um bloqueio NOVO: estoura o heap com 8192 MB
09/09  af82774  "perf(m): guardar todos os passos do let custava 9,8 GB --
                 protocolos-geral volta a caber em 8 GB"
                -> bloqueio 2 morre, e o título do commit NOMEIA a query
15/09           materializada em disco: 95.157 linhas, 63 colunas
16/09           refresh.yaml ainda diz "Fora daqui até o pacote existir"
```

A condição de saída escrita no arquivo — *"até o pacote existir"* — foi cumprida com
**catorze dias** de antecedência. A do bloqueio que a sucedeu, com **sete**. Nenhuma das
duas correções voltou ao arquivo que as esperava.

### A exclusão que só existia por causa de outra

O comentário do grupo `quente` dizia que `backlog-agendado-futuro` ficava fora *"porque
seu passo M faz Table.NestedJoin com PROTOCOLOS GERAL (que está fora de refresh até
otimização SQL/M)"*. Uma exclusão derivada: ela não tinha problema próprio nenhum.
Quando a premissa da primeira caiu, esta caiu junto, e ninguém percebeu porque ninguém
estava olhando para a primeira.

### O terceiro arquivo com a mesma premissa

`specs/_catalog/realtime-poll.yaml` exclui `protocolos-geral` e
`protocolos-produtividade` com *"sem snapshot base nenhum (heap OOM / nunca
materializa)"*. As duas têm snapshot base em disco hoje, e `protocolos-produtividade`
está no grupo `frio` do `refresh.yaml` **desde 13/09**, materializando em 162 s — o
arquivo ao lado já contradizia este há três dias.

É por isso que `protocolos-geral` não tinha nem uma coisa nem outra: **a mesma frase
morta estava escrita em dois lugares**, e cada um deles parecia ter a cobertura do
outro.

### Medido ao vivo, 16/09/2026

`--refazer --sem-calculadas`, uma query por processo, cronometrado de fora:

| query | tempo | linhas × colunas |
|---|---:|---:|
| `protocolos-geral` | **79.966 ms** | 95.278 × 63 |
| `protocolos-auxiliares` | **60.127 ms** | 38.087 × 46 |
| `backlog-agendado-futuro` | **32.524 ms** | 95.949 × 4 |

Nenhuma estourou heap. Nenhuma saiu com código diferente de 0. `protocolos-geral`
devolveu **121 linhas a mais** que o arquivo de 15/09 — a prova de que o dado estava
velho, e não de que ninguém precisava dele.

### O conserto

`protocolos-geral` e `backlog-agendado-futuro` entraram no grupo **`medio`** (20 min).

**E aí a medição pegou o próprio autor deste achado estimando.** A escolha foi feita
somando os custos isolados: 48,6 s do grupo + 80 s + 33 s = ~162 s, 13,5% do ciclo de
1.200 s. O grupo foi então rodado de verdade, como `rodaGrupo` o dispara — um processo,
`--refazer` — e deu **81 s**:

| query | isolada | dentro do grupo |
|---|---:|---:|
| `protocolos-geral` | 79.966 ms | **25.485 ms** |
| `backlog-agendado-futuro` | 32.524 ms | **23.094 ms** |
| as outras sete + calculadas | — | 32 s |
| **total do grupo** | soma: ~162 s | **81 s — 6,8% do ciclo** |

A soma superestimava por um fator de 2. **Um grupo é UM processo**, e as duas queries
novas fazem `NestedJoin` com a MESMA `GESTORES EQUIPES`, buscada uma vez só; some-se o
pool de conexão reusado e o processo que não nasce três vezes. `protocolos-geral`
sozinha custa 80 s; dentro do grupo, 25,5 s.

**Ao dimensionar um grupo, meça o grupo.** Somar medições isoladas erra, e aqui errou
para o lado caro — o que é sorte, não método: a mesma aritmética aplicada a queries que
não compartilham dependência erraria para o lado barato, e aí o tick seguinte começa
antes de o anterior terminar.

A decisão não mudou com o número certo, só ganhou margem. `quente` existe para ser
barato o bastante para rodar de 15 em 15 min; o que se compraria apertando são cinco
minutos de frescor numa tabela de protocolo de instalação, que não é operação minuto a
minuto. Quem quiser contestar: meça o `quente` **com ela dentro**, porque o efeito de
compartilhamento acima depende de quem está junto. `backlog-agendado-futuro` vai junto **de propósito**:
o M dela faz `NestedJoin` com PROTOCOLOS GERAL, e grupos diferentes dariam a ela um lado
direito sistematicamente mais velho ou mais novo que o próprio arquivo, conforme a ordem
dos ticks.

**O poll NÃO foi mexido, e isso é decisão.** Um bloco novo em `realtime-poll.yaml` exige
escolher `chave` e `marca` — e a primeira entrada de exclusão daquele mesmo arquivo é
sobre o que acontece quando se erra a chave: `identidade()` colapsa linhas distintas **em
silêncio**. `protocolos-geral` alimenta 12 das 14 telas; é a pior tabela do catálogo para
descobrir uma chave errada em produção. O comentário foi corrigido para dizer que o
caminho está aberto; a implantação fica para quem provar a chave contra o arquivo real
primeiro. A urgência caiu junto: ela já não está sem cadência nenhuma.

### A lição

> **Uma condição de saída escrita num arquivo não se cumpre sozinha.** "Fora daqui até o
> pacote existir" é uma frase que parece um plano e funciona como um esquecimento: o
> pacote passou a existir no mesmo dia, e a frase continuou governando por catorze.
>
> O agravante é que o commit que matou o segundo bloqueio **tem o nome da query no
> título** — *"protocolos-geral volta a caber em 8 GB"*. Não faltou registro, faltou o
> caminho de volta. É a mesma lição do #128, e ela agora tem preço medido: lá foi
> orçamento parado, aqui foi a tabela de 12 telas servindo dado de ontem.
>
> O hábito que resolve os dois é um só, e é barato: **ao derrubar um bloqueio, procure
> quem estava esperando por ele.** `grep -ran "<nome-da-query>" specs docs` responde em
> segundos, e teria achado três arquivos desta vez.

## #131 — A migração de ontem reindentou uma linha e matou o poller de quase-realtime de PROTOCOLOS TELEFONIA; a guarda gritou a cada 12 s para um terminal vazio

**Data:** 17/09/2026
**Encontrado por subir o programa e olhar.** Não por teste, não por revisão de diff: a
suíte inteira passava verde, os 2.014 testes, enquanto o poller falhava em toda volta.

### O que aconteceu

O commit `ec53ca3` (16/09) migrou `protocolos-telefonia` de 46 passos de M para 5. O
`where` da fonte virou o fecho de uma CTE, e com isso a última linha mudou de

```
\t\tand a.created >= '2026-01-01')
```

para

```
\tand a.created >= '2026-01-01'),
```

Um tab a menos e uma vírgula a mais. **Nenhuma letra do que a consulta faz mudou.**

`specs/_catalog/realtime-poll.yaml` declara, para cada query polada, uma `costura.de` —
um recorte **literal** do SQL, que `costura()` troca por uma versão com `and a.modified
>= :desde`. A âncora continuou pedindo dois tabs. Diferença medida: o SQL casa os
primeiros **161 de 192** caracteres da âncora, e para exatamente ali.

### A guarda funcionou. O que faltou foi alguém lendo

`packages/snapshot/src/incremental.ts` documenta a regra — *"uma âncora tem de casar
exatamente uma vez"* — e `apps/api/src/poller-realtime.ts:422` a invoca de propósito:

> *"`costura()` já valida a âncora — erra alto se o SQL da spec mudou embaixo desta
> config, em vez de poluir silenciosamente com a query inteira."*

Ela errou alto, como prometido:

```
[poller] PROTOCOLOS TELEFONIA: a âncora da costura incremental aparece 0 vez(es)
no SQL, esperado exatamente 1. (…) — tenta de novo na próxima volta
```

A cada 12 segundos. Para o terminal de um processo que não estava no ar — e que, quando
estava, ninguém olhava. **É o #129 em miniatura**: um sinal correto, no lugar errado.
Lá era o daemon morrendo sem quem avisasse; aqui é uma guarda acertando sem quem leia.

### Alcance: uma, e foi verificado, não suposto

As sete queries de `realtime-poll.yaml` foram validadas contra o `sql:` real de cada
spec, pelo caminho de produção (`leConfigDePoll` + `costura`):

```
protocolos-auxiliares ...... OK       retorno-prioritario ....... OK
protocolos-telefonia ....... QUEBRADA instalacoes-reincidentes .. OK
troca-endereco ............. OK       reincidencia .............. OK
tecnicos-auxiliares ........ OK
```

### O conserto, e por que a âncora foi RECORTADA e não redigitada

`apps/api/test/ancora-do-poll.test.ts` (novo): um teste por query, chamando
`leConfigDePoll` e `costura()` — as **mesmas** funções que o poller chama, nunca uma
cópia. A partir de agora, migrar um `sql:` sem acertar a âncora reprova na suíte em vez
de gritar num terminal.

A âncora de `protocolos-telefonia` foi reconstruída por recorte programático do SQL da
spec, não digitada à mão. Redigitar é como ela quebrou.

### O teste que eu quase deixei no arquivo, e estava errado

Escrevi junto uma asserção proibindo espaço no fim de linha dentro das âncoras, achando
que fosse higiene. Ela reprovou `instalacoes-reincidentes`, cuja âncora tem `    CASE `
com espaço final — **porque o SQL da spec tem**.

> Âncora não é texto bem-formatado, é **recorte literal**: tudo o que está no SQL tem de
> estar nela, espaço invisível incluído. O teste teria reprovado configuração correta e
> empurrado a próxima pessoa a "limpar" a âncora até ela parar de casar — ou seja, teria
> fabricado exatamente o defeito que existia para impedir.

Foi removido, e a razão ficou escrita no lugar dele.

### A guarda já existia — para o OUTRO arquivo

Depois de escrever o teste, fui ver se `specs/_catalog/incremental.yaml` — que usa o
**mesmo** mecanismo de âncora, importando a **mesma** `costura()` — tinha o mesmo
problema. Não tinha, e o motivo é o que transforma este achado de "faltava um teste" em
algo mais útil:

```
26/08/2026  0aae15c  packages/snapshot/test/incremental.test.ts ganha
                     "a política de verdade do catálogo carrega e costura o SQL
                      de produção" — valida TODA âncora de incremental.yaml
                      contra o `sql:` real da spec

03/09/2026  6b8c97e  nasce specs/_catalog/realtime-poll.yaml — segundo consumidor
                     do MESMO mecanismo, importando a MESMA costura()
                     ... e sem herdar a guarda

16/09/2026  ec3853c  a migração de protocolos-telefonia reindenta a linha
17/09/2026           o poller está morto ha um dia; a suite, verde
```

O comentário daquele teste de 26/08 até descreve o medo exato que se realizou aqui:
*"alguém edita o SQL da spec, a âncora some, e ninguém descobre até a próxima carga
incremental rodar em produção"*. A frase estava certa e o teste funcionava — só que
guardando metade da superfície.

Verificado hoje: as duas âncoras de `incremental.yaml` casam 1× cada e `costura()`
completa. Aquele arquivo nunca esteve quebrado.

### A lição

> **Duas metades de um contrato em arquivos diferentes, e nada ligando as duas, é uma
> quebra esperando o próximo commit.** O `sql:` da spec muda por migração; a âncora muda
> por decisão de quase-realtime. Nada no editor liga uma à outra, e o custo de esquecer
> é um poller morto que a suíte declara saudável.
>
> Mas a lição que paga mais é a de cima: **quando um mecanismo frágil ganha um segundo
> consumidor, a proteção do primeiro não vem junto.** Ela não é herdada por importar a
> função — é escrita à mão, uma vez por consumidor, e o segundo quase sempre é escrito
> por quem está pensando no recurso novo, não na armadilha velha. Ao adicionar um
> consumidor a qualquer coisa que já tenha um teste de invariante, a pergunta é: *esse
> teste enxerga o meu caso?*
>
> E o corolário do #129: **uma guarda que erra alto num lugar que ninguém lê é uma guarda
> que não existe.** Esta agora erra na suíte, que é onde alguém olha.

## #132 — A prova de que o gabarito de paridade é possível valia para uma query que foi reescrita três vezes desde então; agora o sha da query trava a prova

**Data:** 17/09/2026
**O arquivo que existe para impedir palpite estava sustentando dois.** E ele não é
comentário: `tools/powerbi/src/index.ts:359` chama `carregaJanelas`, e o que sai dali
decide qual medida do Power BI vira gabarito em `specs/paridade/*.yaml`.

### O que `paridade-janela.yaml` promete

Está escrito no topo dele, e a frase é boa:

> *"REGRA DO CAMPO `verificado`: só entra aqui predicado que, aplicado no Power BI,
> devolve a contagem de linhas que temos em disco."*

> *"Um gabarito impossível não detecta regressão — ele ensina a ignorar o alarme."*

Duas tabelas tinham predicado com `verificado`, ambos provados em **25/08/2026**.

### O que a prova não cobre, e ninguém tinha percebido

Uma prova é sobre **um predicado aplicado a um conjunto de linhas**. O predicado é
estável — está escrito ali. O conjunto de linhas não: ele é o que a query produz, e a
query é outro arquivo, que muda por motivos que nada têm a ver com paridade.

```
                          prova (25/08)   disco (17/09)    razão
PROTOCOLOS GERAL              34.978         95.442        2,73x
PROTOCOLOS PRODUTIVIDADE      70.868         77.452        1,09x
```

`PROTOCOLOS PRODUTIVIDADE` a 1,09× em 23 dias é acúmulo. `PROTOCOLOS GERAL` a **2,73×**
não é — e a causa tem nome: `8b1fd19` (04/09) reescreveu o desempate do `ROW_NUMBER` e
destravou um `EXISTS`; o título do commit diz *"3,1x"*. A lista `it.id IN (...)` do SQL
nunca mudou, então o predicado de corte por data continua plausível. **O que ninguém
sabe é se o lado do Power BI ganhou as mesmas linhas.** Enquanto não se souber, todo
gabarito dali sairia medido sobre ~35 mil linhas e comparado com 95 mil.

### Por que contar linhas não é o guarda certo

Foi a primeira ideia, e está errada: **as duas pontas acumulam.** Divergir com o tempo é
o comportamento normal de um predicado que funciona. Qualquer limiar ou envelhece (em um
ano, 1,09× vira 2×) ou não pega nada. Um guarda que precisa de limiar aqui é um guarda
que vai ser desligado.

### O guarda que serve já existia neste repositório

`packages/snapshot/src/nativas.ts` resolveu o mesmo problema com `shaConferido`:

> *"Se alguém mudar o `table_dax` ou o DAX de qualquer coluna, `shaDaCalculada` muda, o
> sha deixa de casar e o caminho nativo **se recusa** — cai no avaliador, lento e certo,
> com uma nota dizendo por quê."*

O mesmo desenho, um andar acima: `verificado` passa a declarar o `shaDaQuery` da spec no
dia da prova — `sha256` do `sql:` mais o `m_expression:`. `carregaJanelas` recalcula e,
quando falta ou não bate, **manda a tabela para `bloqueadas`** em vez de erguer exceção.
Isso é deliberado: `bloqueadas` já significa exatamente "card que dependa disto não
recebe número automático", então o resto do catálogo segue funcionando e só o que perdeu
a prova para de produzir gabarito.

**O sha ignora espaço em branco**, por `shaDeDax`. Reindentar o SQL não invalida uma
prova — e se invalidasse, a manutenção normal do arquivo treinaria quem cuida dele a
recarimbar o sha sem medir nada, que é o pior desfecho possível para um guarda assim.
(Ironia registrada: é exatamente o oposto do #131, onde reindentar **era** o defeito. Lá
a âncora é recorte literal e o espaço importa; aqui a prova é sobre semântica e não.)

### O que isto custa hoje, dito sem enfeite

**As duas tabelas ficaram bloqueadas.** Nenhuma das duas provas declara sha, e nenhuma
pode ser demonstrada como feita sobre a definição de hoje:

- `PROTOCOLOS GERAL` — bloqueio **com evidência** de que o conjunto mudou.
- `PROTOCOLOS PRODUTIVIDADE` — bloqueio **por falta de prova**, não por defeito
  conhecido. A query foi migrada de M para SQL em 10/09 e ganhou o desempate de endereço
  em 14/09; a prova é de 25/08 e nada registra que alguém remediu. É o caso em que
  desbloquear provavelmente só confirma o que já estava lá.

Carimbar o sha de hoje nas duas para manter tudo verde era a saída fácil e seria
mentira: o campo diz "alguém provou sobre esta definição", e eu não provei. Limpar cada
bloqueio custa **uma consulta DAX** contra o Power BI, e a receita está no próprio
arquivo.

Aproveitado no caminho: o bloqueio de `FIELD AGENDA` mandava *"resolver a carga antes de
tentar equalizar"*, citando `snapshot/field-agenda.erro.log` (ECONNRESET, 19/08). Aquele
arquivo não existe, e o manifesto traz 643.176 linhas de 15/09 — a instrução mandava
refazer trabalho já feito. O bloqueio continua (o fator de 15 foi raciocinado sobre 41
mil linhas e hoje há 643 mil, ou seja, a divergência não foi remediada, foi remexida),
mas agora pelo motivo certo.

### O teste que eu tive de trocar, e por que não é trapaça

`tools/powerbi/test/janela.test.ts` afirmava `j.tabelas.has('PROTOCOLOS PRODUTIVIDADE')`
e `has('PROTOCOLOS GERAL')` — ou seja, fixava a **configuração** de um dia. Com o guarda,
reprovou.

Reescrever um teste para ele voltar ao verde é precisamente o defeito que
`packages/snapshot/test/incremental.test.ts` documenta em outro contexto: *"alguém
reancorou a costura para casar com ela, e a suíte continuou verde"*. Então ele não foi
reescrito para a lista nova — foi trocado pelo **invariante**, que não depende de qual
tabela está de que lado: *toda tabela declarada sai como janela provada OU como bloqueio
com motivo; nunca some no meio do caminho.* Mais seis testes cobrem o guarda, incluindo o
de que reindentar não invalida e o de que tabela sem spec de query não é travada.

### A lição

> **Uma prova é sobre um objeto, e o objeto tem de estar identificado na prova.**
> "Conferido em 25/08" responde *quando*, e é a pergunta fácil. A que decide é *sobre o
> quê* — e sem ela a prova sobrevive intacta à reescrita daquilo que ela provava.
>
> O corolário prático, que vale além deste arquivo: **onde houver um número conferido à
> mão, guarde junto a identidade daquilo que foi conferido.** Um sha custa uma linha e
> transforma "envelheceu em silêncio" em "recusa e diz o que fazer".

## #133 — Rodar o MESMO código duas vezes divergiu mais do que rodar códigos diferentes: sem grupo de controle, a migração de `protocolos-auxiliares` teria sido reprovada por 17 colunas que estavam certas

**Data:** 17/09/2026

`protocolos-auxiliares` era a terceira das quatro queries grandes ainda presas à camada
M (#112). Os 56 passos viraram o `sql:` da spec e sobrou **1** — o `Fonte`, que é só o
ponteiro. É a primeira query do corpus a chegar no mínimo possível.

O que vale registrar não é o SQL. É que a **prova** quase deu o veredito errado, e o
motivo tem nome.

### A primeira medição disse que 17 colunas divergiam

A receita de `protocolos-telefonia` (#112) é materializar com a spec anterior, depois
com a nova, e comparar coluna a coluna sobre as chaves em comum. Lá deu `640 de 640`
limpo. Aqui, com uma chave composta que identifica linha (0 repetições dos dois lados),
saiu isto:

```
em comum ......... 38.264 chaves
❌ responsável        7 de 38.264      ❌ pop, slot, porta, cto        2 cada
❌ estagio contrato   5 de 38.264      ❌ olt, equipamento, usuário    2 cada
❌ equipe, status, telefone, latitude, longitude, ponto de acesso,
   status contrato                     2 cada
❌ numero patrimônio  1 de 38.264
```

Dezessete colunas. Nenhuma delas com um padrão que se pareça com erro de tradução — um
`initcap` errado erra em milhares de linhas, não em duas — mas "0,02%" também não é
zero, e a regra desta migração é *o valor não muda*. A tentação, no ponto em que a coisa
já está a horas de trabalho, é aceitar 99,98% e escrever "dentro da tolerância".

Não existe tolerância. Existe **grupo de controle**.

### O controle: materializar o mesmo código duas vezes

Quatro materializações intercaladas, alternando as duas specs, com cerca de um minuto
entre cada uma. Se a divergência for da tradução, ela aparece só nos pares que trocam de
linguagem. Se for da base viva, aparece em todos.

| par | janela | linhas idênticas (46 colunas) | colunas que divergem | pior coluna |
|---|---|---|---|---|
| **M(t) × SQL(t+1)** — linguagens diferentes, adjacentes | ~1 min | 38.268 de 38.269 — **99,997%** | **1** | `telefone`, 1 de 38.269 |
| SQL × SQL — **mesmo código** | ~5 min | 38.256 — 99,966% | 9 | `responsável`, 4 |
| M × M — **mesmo código** | ~5 min | 38.241 — 99,929% | 20 | `responsável`, 9 |

O par que troca a linguagem inteira da query é **o mais limpo dos três**. As duas
execuções do mesmo código, do mesmo lado, divergem em 9 e em 20 colunas — inclusive nas
mesmas `responsável`, `estagio contrato`, `latitude`, `longitude`, `pop`, `cto` que a
primeira medição tinha listado como suspeitas da tradução.

As 17 colunas eram `dbVoalle` vivendo: um responsável é reatribuído, um contrato muda de
estágio, um protocolo novo entra. A divergência é **proporcional à janela de tempo**, e
não à mudança de código. O número que prova a migração não é "17 colunas divergiram", é
**o par que troca de linguagem divergir menos do que o par que não troca nada**.

### O que isso significa para a receita de migração

A prova de `protocolos-telefonia` foi honesta e deu `640 de 640` — mas ela tem 640
linhas e uma fonte que quase não se move. Com 38.269 linhas de uma tabela operacional a
deriva da fonte é maior que o efeito que se quer medir, e **comparar duas materializações
sem um terceiro ponto não distingue as duas coisas**. A ferramenta já separa chave nova
de chave divergente (`compara-materializacao` chama isso de "deriva, não divergência"),
mas ela não tem como enxergar a linha que existe dos dois lados e mudou de valor entre
uma execução e outra. Essa só o controle pega.

Fica a regra: **em query grande a prova é de três execuções, não de duas** — e o critério
não é "zero divergência", é "a divergência entre linguagens ≤ a divergência entre duas
execuções da mesma linguagem".

### O segundo achado, que estava escondido na coluna 46

A coluna `TECNICO` de `PROTOCOLOS AUXILIARES` está **inteira nula**, e está assim no
snapshot de produção de hoje:

```
producao: linhas=38.087   colunas=46   TECNICO nulos=38.087   tipo declarado=vazia
```

Ela é `TECNICOS AUXILIARES.AUXILIAR`, vinda de um `Table.NestedJoin` entre
`{"N°PROTOCOLO"}` e `{"PROTOCOLO:"}`. O join não casa nada porque `ai.protocol` é
`bigint` e o driver o entrega como **texto**, enquanto `tecnicos-auxiliares` termina em
`Table.TransformColumnTypes(Fonte,{{"PROTOCOLO:", Int64.Type}})` e entrega **número**.
`chaveDe` (functions.ts) põe a espécie na chave de igualdade de propósito, e o motor se
recusa a reconciliar sozinho — reconciliar é decisão humana, registrada em
`specs/_catalog/juncoes.yaml`.

**O arquivo já tem duas entradas para exatamente este defeito**: `backlog-agendado-futuro`
(0 de 88.143 casavam; 68,6% casam como inteiro, decidido em 13/08) e `protocolos-geral`
(0 de 33.459; 76,8%, mesmo dia, **com a mesma ponta direita** — `tecnicos-auxiliares`,
`PROTOCOLO:`). `protocolos-auxiliares` tem o mesmo defeito, contra a mesma tabela, com a
mesma chave, e **não tem entrada**. Medido hoje, seriam **28.833 de 37.248 (77,4%)** — o
mesmo patamar da irmã que foi decidida no mesmo dia.

Não liguei a junção nesta sessão, e a razão é a promessa desta migração: *o valor não
muda*. Encher uma coluna que está vazia há meses, no meio de uma troca de linguagem,
misturaria duas mudanças numa medição só — e ainda divergiria do relatório publicado
(regra 9) sem decisão registrada. O SQL escreve `NULL::text` e diz por quê em onze linhas
de comentário. O lugar de mudar isso é `juncoes.yaml`, com o 77,4% ao lado, e aí passa a
valer para o M e para o SQL ao mesmo tempo.

### O que NÃO melhorou, dito sem enfeite

**Desempenho não é o ganho.** As quatro materializações desta sessão:

```
M   ..... 88.123 ms (fria)   58.145 ms
SQL ..... 53.647 ms          55.366 ms
```

Tirando a execução fria, são ~58 s contra ~55 s: 5%, dentro do ruído. O custo dominante é
a consulta de base, que é a mesma nos dois caminhos — só o `count(*)` embrulhado sobre ela
leva 34 s. É o mesmo aviso de #123: a régua que dizia que migrar M para SQL era ganho de
desempenho estava fora do modo de produção. Migrar vale por outra coisa — uma fonte da
verdade em vez de duas, e o `rowCount` do golden voltando a significar a contagem da
tabela (golden regravado: 33 → 46 colunas, `rowCount` 32.574 → 38.271, parado desde
06/08/2026).

E o `m_expression` que saiu **já estava desatualizado**: o desempate do `ROW_NUMBER`
decidido em 15/09 (#125) está no `sql:` e nunca chegou à cópia de ~5.000 caracteres que
morava dentro do `Odbc.Query`. Duas fontes da verdade para a mesma consulta, sendo que
uma nunca rodava. Essa é a razão real da migração.

### A lição

> **Uma prova contra fonte viva mede duas coisas somadas, e só o grupo de controle as
> separa.** A pergunta "o código novo dá o mesmo resultado?" não tem resposta observável
> sozinha: o que se observa é "o código novo dá o mesmo resultado, a menos do que a fonte
> mudou no meio". Rodar o código ANTIGO duas vezes custa uma execução e dá o piso de
> ruído — e sem esse piso não dá para dizer se 0,02% é defeito ou é terça-feira.
>
> O corolário incômodo: **se você não mediu o piso, "quase idêntico" é um palpite com
> cara de número.** Foi por pouco que este aqui não virou "17 colunas divergem, a tradução
> está errada" — e a conclusão oposta, "99,98% é bom o bastante", teria sido igualmente
> indefensável.

## #134 — O orçamento de refresh que eu medi ontem estava 4,5× errado hoje, e o defeito não era a medição: era medir uma vez uma coisa que não é nossa

**Data:** 17/09/2026

Ontem escrevi no `specs/_catalog/refresh.yaml`, com tabela e tudo: *"**Ao dimensionar
um grupo, meça o grupo** — somar medições isoladas erra"*. O grupo `medio` tinha sido
medido em 81 s, contra ~162 s que a soma das partes dava, e a lição parecia fechada.

Hoje o mesmo grupo, com as mesmas nove queries, levou **361 s** na minha passada e
**430 s** na do daemon. A lição estava certa e era insuficiente.

### O sinal que não depende de nenhuma escolha minha

`medio` mudou de composição ontem (entraram `protocolos-geral` e
`backlog-agendado-futuro`), então ele sozinho não prova nada — eu mexi nele. O `quente`
não. Mesma lista de sete queries desde 06/09, conferida commit a commit:

```
16/09 17:18 .....  28.611 ms   (refresh-historico.log)
17/09 16:45 .....  94.082 ms   (refresh-historico.log)
17/09 17:27 ..... 105.697 ms   (cronometrado de fora)
17/09 17:29 .....  81.000 ms   (cronometrado de fora)
```

3,3× em vinte e três horas, sem um caractere de diferença em nenhuma das sete specs.
Isso não é um erro de medição: é o sistema medindo outra coisa a cada vez.

### Onde o tempo está — e é aqui que a explicação óbvia morre

`contratos` sozinha respondeu por 58.224 ms dos 81 s. O comentário do grupo dizia
"2,9s", número que entrou com o primeiro commit do Refresh Manager (`77529a8`, 02/09) e
nunca mais foi refeito. A explicação natural — *a query cresceu*, ou *o plano degradou* —
é falsa nas duas metades, e dá para provar as duas.

Escrevi `tools/probe/src/custo-contratos.ts`, que roda quatro formas do MESMO SQL para
separar plano, transporte e ordenação:

```
plano do servidor ........    232 ms
transporte das linhas ... 16.621 ms
ordenação ............... 10.628 ms
```

**O banco faz o join inteiro em 232 ms.** Não há plano degradado: há 87.907 linhas
pesadas atravessando alguma coisa devagar. E a query não cresceu — contando o próprio
resultado por `CRIADO`, ela tinha **86.395 linhas em 02/09 contra 87.907 hoje: +1,7%**.
A spec está intocada desde o primeiro commit do repositório.

### A medição que fecha o caso

Se é transporte, quanto o link entrega? Medido com payload sintético, sem tocar em
tabela de negócio:

```
ida e volta (select 1) ................ mediana 12 ms, pior 98 ms
10 MB gerados e NÃO entregues .........     72 ms  =  139 MB/s
10 MB entregues, numa linha só ........  6.926 ms  =  1,44 MB/s
50 MB entregues, 50 mil linhas ........ 43.278 ms  =  1,16 MB/s
```

A terceira linha é a que decide. **Dez megabytes numa ÚNICA linha de uma única coluna**
— o driver não monta objeto por linha, não converte campo, não faz nada além de receber
bytes. Ainda assim: 1,44 MB/s. Não é o `pg`, não é o nosso código, não é o plano. É o
fio. E 12 ms de ida e volta dizem que esse fio não é uma rede local.

Ele também varia: a mesma sonda deu 2,24 MB/s uma hora antes e 0,62 MB/s no meio de
uma carga. **Um fator de 3,6 entre duas medições do mesmo dia** — que é, dentro da
margem, exatamente o fator que apareceu no `quente`.

### A assinatura que identifica o problema sem adivinhar

O `medio` de hoje contra o de ontem, query a query:

```
base-categorias-field ....   1.736 ->  58.670 ms    33,8x     226.688 linhas
protocolos-geral .........  25.485 -> 158.516 ms     6,2x      95.442 linhas
instalacoes-reincidentes .   2.096 ->   8.938 ms     4,3x      23.056 linhas
backlog-agendado-futuro ..  23.094 ->  86.735 ms     3,8x      96.168 linhas
tecnicos-auxiliares ......     848 ->   2.884 ms     3,4x      35.119 linhas
alocacao-patrimonio ......   2.246 ->   5.238 ms     2,3x      25.089 linhas
reincidencia .............   7.699 ->  13.076 ms     1,7x       1.454 linhas
retorno-prioritario ......   5.925 ->   9.647 ms     1,6x         271 linhas
troca-endereco ...........   1.265 ->   1.541 ms     1,2x       5.410 linhas
```

**Não é degradação uniforme.** Quem quase não mudou é pequeno; quem explodiu é grande.
É o termo proporcional a bytes multiplicando enquanto o termo fixo fica parado — e essa
forma é o que separa "o link caiu" de "alguém quebrou uma query". Uma regressão de
código não escolhe as vítimas por tamanho de resultado.

(As exceções aparentes confirmam: `reincidencia` tem 1.454 linhas de SAÍDA mas busca
muito mais para produzi-las, e `backlog-agendado-futuro` faz `NestedJoin` com
`PROTOCOLOS GERAL` — o que atravessa o fio não é o que sobra no disco.)

### A regra que substitui todas as estimativas daquele arquivo

```
custo de um grupo  ≈  bytes que ele traz  ÷  banda do momento (~1 a 2 MB/s)
```

Disso decorre o que adianta e o que não adianta, e a segunda lista é a que economiza
tempo: **não adianta** reescrever SQL (o plano é 232 ms), trocar driver (o custo aparece
igual com uma linha só), aumentar memória, criar índice. **Adianta** trazer menos bytes
— e só isso. Nesta ordem: coluna que ninguém lê (`CONTRATOS[CIDADE2]` é `ac.city` pedido
duas vezes no mesmo SELECT, registrado no #47 e ainda pago a cada 15 min), política em
`incremental.yaml` (existe uma, para 22 queries), e afrouxar cadência por último,
porque se paga em frescor.

### O que isso faz com a cadência, que é a parte com dente

Um tick que vence os três grupos custa hoje **94 + 361 + 209 = 664 s**, e os grupos
rodam em série (`tick.ts`, e por um motivo: dois processos fariam read-modify-write no
manifesto). A janela é de 900 s. Com os números que o próprio daemon registrou
(94 + 430 + 209), **733 s — 81% da janela.**

> **CORREÇÃO (18/09/2026), e ela é do mesmo defeito que este achado descreve.** Os dois
> números acima — 664 s e 733 s — eu obtive **somando amostras**, que é exatamente o que
> o parágrafo de abertura condena. O `refresh-historico.log` tem os ticks reais, porque
> o daemon voltou a rodar às 19:27 de 17/09 e deixou seis deles gravados:
>
> ```
> tick 1 (16/09)  quente  29s + medio  49s + frio 209s = 286 s   32% da janela
> tick 2 (17/09)  quente  94s + medio 430s .......... = 524 s   58%
> tick 3 (17/09)  quente 102s + medio 309s + frio 189s = 601 s   67%   <- o pior
> tick 4 (17/09)  quente  88s ....................... =  88 s   10%
> tick 5 (17/09)  medio  284s + frio 205s + quente 59s = 547 s   61%
> tick 6 (17/09)  medio  306s ....................... = 306 s   34%
> ```
>
> **O pior tick observado é 601 s: 67%, não 81%.** Eu exagerei em 14 pontos, e da
> maneira mais previsível possível — somando o pior caso de cada grupo como se eles
> acontecessem juntos. A folga real é menor do que a média sugere e maior do que a minha
> soma sugeria; nenhuma das duas descreve o sistema, e o histórico descreve.
>
> Registro isto aqui em vez de editar o número acima porque o erro é mais útil que a
> correção: eu escrevi o parágrafo certo sobre somar amostras e, seis linhas depois,
> somei amostras. **A regra que se sabe não é a regra que se aplica** — o que aplica é
> o instrumento. O histórico existe desde ontem (#129) e responde a pergunta em um
> comando: `npm run refresh:daemon -- --historico`.

Quando estoura, o daemon pula o disparo seguinte. E aqui está o buraco:

> **Pular não é falhar.** `estaVencido` mede a idade do último SUCESSO, então o grupo
> roda no ciclo seguinte e nada fica vermelho. `refresh-status.json` continua com
> `falhasConsecutivas: 0`. A cadência real cai pela metade e **não há uma única linha
> de alarme em lugar nenhum** — o único registro era um `console.log` num terminal que
> ninguém lê.

É literalmente o #129 outra vez, em outro disfarce: lá a stack estava morta com o status
verde; aqui ela está viva, verde, e entregando metade da cadência prometida. Por isso o
histórico ganhou hoje o evento `ciclo-pulado`, com há quanto tempo o ciclo atropelado já
rodava, e `--historico` passou a imprimir a contagem com a explicação do que fazer.

### O que eu não fiz, e por quê

**Não tirei o `order by p.name asc` de `contratos`**, que sozinho custa 10,6 s por tick
— 96 ticks por dia, ~17 min diários de servidor para uma ordenação que o snapshot
colunar não preserva nem promete. Parece dinheiro no chão, e provavelmente é. Mas ordem
de linha neste repositório já foi semântica escondida mais de uma vez (o desempate
"contrato antes de active" das queries de protocolo é um achado inteiro), e um
`NestedJoin` que resolva por primeira ocorrência mudaria de resultado em silêncio.
Remover custa cinco minutos; **provar que ninguém depende dela é o trabalho**, e é ele
que falta.

**Não sei o que mudou no fio entre 02/09 e hoje**, e não vou inventar. Pode ser rota,
VPN, saturação, horário. O que ficou medido é o que a plataforma consegue medir sozinha,
e a sonda está commitada para que a próxima pessoa não precise redescobrir nada:
`npm run probe:custo-contratos -- --banda`.

### A lição

> **"Meça o grupo" resolveu somar partes erradas. Não resolve medir uma vez.**
>
> Quando o termo dominante de um custo é um recurso que não é seu — um link, um disco
> compartilhado, uma API de terceiro — uma medição não é uma constante: é uma
> fotografia, e ela envelhece na velocidade daquele recurso, não na do seu código. A
> minha envelheceu em vinte e quatro horas, dentro de um arquivo cujo bloco anterior
> (#128) existia precisamente para contar que um número ali tinha ficado doze dias
> errado.
>
> O que sobrevive não é o número: é **a razão dele**. `81 s` não se defende sozinho;
> `bytes ÷ banda` se defende, diz por que envelheceu, e diz onde medir de novo. Por
> isso o que entrou no arquivo foi a divisão, com a sonda que a refaz — e não uma
> tabela mais nova, que daria o mesmo problema amanhã.

## #135 — A tabela com o poll mais rápido da plataforma era a única sem refresh nenhum, e o poll não cobre o que falta: 495 linhas existiam no banco e em lugar nenhum aqui

**Data:** 18/09/2026

`protocolos-auxiliares` tem poll de quase-realtime a cada **12 segundos** — a cadência
mais apertada do repositório. E até hoje ela era a única das seis queries polidas que
**não estava em nenhum grupo de refresh**. O snapshot dela em disco era de 16/09 14:32
e não tinha quem o avançasse.

Isso parece cobertura de sobra, e é a armadilha: **o poll não substitui o refresh, e a
razão está na primeira linha de `inicia()`.**

### O mecanismo, em uma linha de código

```ts
this.#deltas.set(cfg.query, novoDelta(agora));   // poller-realtime.ts
```

O poller produz um **overlay** por cima do snapshot, e a janela dele começa **no
arranque da API** — não na marca do arquivo que ele está cobrindo. Então há uma faixa
de tempo que não pertence a ninguém:

```
   snapshot gravado            API sobe                     agora
   16/09 14:32 ────────────────► 17/09 13:49 ───────────────►
                    ▲                          ▲
             ninguém olha aqui          overlay do poll
        (nem o arquivo, nem o overlay)
```

Uma linha criada ou alterada dentro daquela faixa, e não tocada depois, não está no
arquivo (é posterior a ele) nem no overlay (é anterior à janela). Ela existe no banco e
em lugar nenhum aqui.

O docstring do poller diz que *"o delta é a verdade completa (nenhuma volta é pulada sem
repetir a mesma janela)"*, e isso é verdade — **dentro da vida do poller**. A frase é
sobre a costura entre voltas consecutivas. A costura que faltava é outra: a da entrega
entre o snapshot e a primeira volta.

### Por que só esta tabela sofria

Para as outras cinco queries polidas a fresta existe igual, e **se fecha sozinha**: o
grupo de refresh refaz o arquivo em 15 a 30 minutos e a marca alcança o arranque. A
fresta é real, dura minutos e some.

Sem grupo, ela não se fecha nunca. Ela cresce um dia por dia.

### O tamanho dela, contado e não estimado

Contando o próprio resultado da spec pelo mesmo par de colunas que o poll usa como marca
(`DATA CRIADO`, `DATA ENCERRADO`), com os dois instantes reais de hoje:

```
total no banco .......................... 38.350
na fresta (16/09 14:32 → 17/09 13:49) ....   495
depois do arranque (coberto pelo poll) ...    71
no arquivo em disco ..................... 38.087
```

**495 linhas.** Delas, 263 são o que o arquivo simplesmente não tem (38.350 − 38.087):
linhas novas, ausentes. As outras ~232 são linhas que o arquivo tem com o valor velho —
foram alteradas na fresta e a alteração não chegou. As duas metades são o mesmo defeito
dito de duas formas: **sobre 495 linhas, o arquivo está errado, e nada no sistema sabe
disso.**

E o número é de uma janela de vinte horas. A spec foi materializada pela última vez em
16/09; sem a mudança de hoje, amanhã seriam mais.

### O conserto, e por que `frio` e não `quente`

`protocolos-auxiliares` entrou no grupo **`frio`** (30 min). A escolha não é sobre custo,
é sobre quem faz o quê:

> **Quem dá frescor é o poll. O grupo só precisa fazer a marca alcançar o arranque.**

Para isso 30 minutos bastam de sobra, e é o grupo com mais folga dos três. Medido em
18/09, o grupo inteiro com ela dentro, um processo, `--refazer`:

```
protocolos-produtividade .. 143.711 ms      carga ...........  4.070 ms
protocolos-auxiliares .....  33.913 ms      calculadas ...... 11.970 ms
field-agenda-slot .........  13.532 ms      ------------------------------
clima-tempo ...............   6.860 ms      TOTAL do grupo .. 213 s
```

213 s em 1.800 s: **11,8%**. Sem ela o grupo media 209 s. Pôr no `quente` teria custado
34 s a cada 15 min para comprar um frescor que o poll de 12 s já entrega.

### A guarda, que é a parte que sobrevive a mim

Um grupo a mais numa lista YAML não impede a próxima pessoa de declarar um poll novo e
esquecer o refresh — que foi exatamente o que aconteceu aqui. Então
`apps/api/test/ancora-do-poll.test.ts` ganhou o invariante:

> *toda query com poll de quase-realtime tem um grupo de refresh atrás dela*

Ele reprovou de primeira, nomeando `protocolos-auxiliares`, e a mensagem de falha
explica o mecanismo e sugere o `frio` — porque uma guarda que só diz "falhou" manda a
próxima pessoa redescobrir tudo isto.

É a mesma família do #131, um andar acima. Lá, o `sql:` da spec e a âncora de costura
moravam em arquivos diferentes e nada os conferia junto; o teste que faltava ligava as
duas pontas. Aqui as duas pontas são `realtime-poll.yaml` e `refresh.yaml` — dois
arquivos que se editam por motivos completamente diferentes, mantidos por decisões
diferentes, e cuja combinação errada não produz erro nenhum: produz um arquivo
silenciosamente incompleto.

### O que ficou em aberto, dito com todas as letras

**A fresta não foi consertada — foi tapada.** O conserto estrutural seria o poller abrir
a janela na MARCA DO SNAPSHOT em vez de em `agora`, e aí ela não existiria para query
nenhuma, nem nos minutos entre um refresh e outro. Não fiz, por duas razões:

1. Muda o comportamento de todas as seis queries polidas de uma vez, e a primeira volta
   depois de um arranque passaria a buscar tudo desde a marca — que numa stack parada
   desde ontem é uma consulta bem maior que as de 12 s.
2. `podaDelta` apara o overlay em **48 horas**. Um snapshot mais velho que isso não
   seria coberto nem com a mudança — então ela reduz a fresta, não a elimina, e o grupo
   de refresh continua sendo obrigatório de qualquer jeito.

Com grupo em todas as seis, a fresta máxima passa a ser o intervalo do grupo mais lento:
30 minutos. Dá para viver com isso, e agora está escrito quanto é.

### A lição

> **Duas coberturas parciais somadas não fazem uma cobertura, e a soma é onde ninguém
> olha.** O snapshot cobre até a marca dele; o poll cobre a partir do arranque. Cada um
> tem docstring, teste e dono. O vão entre eles não tinha nada — porque um vão não é
> um componente, e a revisão de código lê componentes.
>
> O sintoma disso é sempre o mesmo e é sempre reconfortante: *"essa tabela tem poll de
> 12 segundos, é a mais fresca que temos"*. Era a mais fresca **e** a única com 495
> linhas erradas. Quando um mecanismo novo parece deixar o antigo desnecessário,
> pergunte de que instante até que instante cada um vale — a resposta costuma não ser
> "do começo".

## #136 — Toda subida da plataforma anunciava "TODO pedido é servido sem sessão", e era mentira: o comportamento estava certo, o relato é que tinha vencido

**Data:** 18/09/2026

Subi a stack para conferir que ela voltava ao ar depois de um dia fora, e pedi seis
páginas à API. Seis 401. Fui ver por quê, e o banner da subida dizia o contrário:

```
  Login: DESLIGADO por SEM_LOGIN=1/--sem-login — TODO pedido é servido sem sessão
```

**A frase é falsa, e é falsa sobre segurança.** As duas coisas ao mesmo tempo — "servido
sem sessão" no log e `401` em toda rota `/api/*` — não podem ser verdade, e a que estava
errada era a impressa.

### O comportamento estava certo. Isto é importante antes de qualquer coisa.

`apps/api/src/portao-login.ts` é um módulo inteiro sobre falhar fechado, e ele existe
porque a coisa já falhou aberta: em 04/09/2026 a stack de container serviu
`GET /api/dashboards/visao-geral → 200` **sem sessão nenhuma** — CLIENTE, TELEFONE e
endereço a quem alcançasse a URL. A lição que ficou escrita lá é a melhor frase do
arquivo:

> *"Uma trava que degrada em silêncio não é trava."*

Depois disso o portão do `Servidor` passou a só cair para a identidade `dev-local`
quando **nenhum** provedor está configurado. Com `FIREBASE_PROJECT_ID` preenchida — o
arranjo normal desde 16/09 — ele exige sessão. É o que ele fez comigo: 401, seis vezes,
corretamente.

### Então o que estava quebrado

Duas peças que combinavam em 04/09 e deixaram de combinar em 16/09:

1. **`tools/subir/src/index.ts` passava `--sem-login` INCONDICIONALMENTE**, com um
   comentário explicando por quê: naquela época nenhum provedor estava configurado,
   `decideLogin` recusava subir sem a declaração, e sem a bandeira `npm start` não
   funcionava. Verdade em 04/09.

2. **`decideLogin` devolve `sem-login-declarado` sempre que a bandeira aparece**, sem
   olhar se há provedor. Ele não precisa olhar: a função decide se o PROCESSO PODE
   SUBIR, não se os pedidos são autenticados. Para o que ela responde, está certa.

Quando o Firebase foi configurado, a bandeira virou desnecessária — mas continuou sendo
passada, e `apps/api/src/index.ts` continuou imprimindo a linha que ela implica. Ninguém
mentiu; duas afirmações verdadeiras em contextos diferentes se encontraram e produziram
uma falsa.

### Por que um log errado aqui é caro, e não cosmético

Um banner que diz "aberto" quando está fechado custa em dois sentidos opostos, e os dois
são ruins:

- **Quem vai auditar** lê aquilo, acredita, e vai procurar um buraco que não existe — ou
  abre um chamado de incidente. Tempo gasto contra um fantasma.
- **Quem vai operar** lê aquilo e conclui que a API está exposta. No dia em que ela
  estiver de verdade, a linha vai estar lá igual, e ninguém vai reagir. **Um alarme que
  toca sempre é um alarme desligado** — é o mesmo mecanismo do #131, onde a guarda
  gritava a cada 12 s para um terminal que ninguém lia.

O #129 e o #131 foram sobre alarme que ninguém vê. Este é o grau seguinte: alarme que
todo mundo vê e que está errado.

### O conserto, e o erro que ele me custou no meio do caminho

A correção é não passar a bandeira quando ela não é necessária —
`tools/subir/src/portao.ts`, com a MESMA condição que `decideLogin` usa (`Boolean` e não
`!== undefined`, porque string vazia é o caso real deste `.env` e foi exatamente ela que
falhou aberta em 04/09).

**A primeira versão não mudou nada, e o motivo é bonito.** Ela consultava
`process.env.FIREBASE_PROJECT_ID`, que naquele ponto é `undefined` — porque `subir` chama
`applyDotEnv` deliberadamente TARDE, dentro de `buscaAutenticado()`, muito depois do
spawn da API. O comentário lá explica, e é uma boa razão:

> *carregar o `.env` antes do `spawnSync('npm run web:build')` faz o Vite herdar
> `NODE_ENV=development` e sair sem minificar — 281 kB viraram 563 kB, medido*

Ou seja: o processo FILHO enxerga a variável (ele chama `applyDotEnv` por conta própria),
o PAI não. A correção certa lê o arquivo sem aplicá-lo (`loadDotEnv`), com a mesma
precedência de `applyDotEnv` — ambiente vence arquivo. Se as duas precedências
divergirem, elas voltam a discordar, só que em outro ponto.

Rodei, e o banner passou a dizer o que acontece:

```
  Login: Firebase (projeto installation-dashboard-307fd), domínio sebratel.com.br
```

### O teste que amarra os dois arquivos

`tools/subir/test/portao.test.ts` não testa `precisaDeclararSemLogin` sozinha — ela é
trivial demais para errar isolada. Testa **as duas decisões sobre os mesmos sete
ambientes**, exigindo que concordem: onde declaramos a bandeira, `decideLogin` sem ela
tem de `recusa`r; onde não declaramos, tem de `exige-credencial`. Foi a divergência entre
duas condições parecidas em dois arquivos que produziu isto, então o que o teste guarda é
a concordância, não cada lado.

Mais um teste afirma a coisa concreta: **o `.env` real deste repositório tem provedor,
logo `npm start` não declara** — se alguém esvaziar a variável, ele pega.

### A lição

> **Uma bandeira é uma afirmação sobre o ambiente, e ambiente muda.** `--sem-login`
> nasceu verdadeira, foi escrita como constante, e ficou. O código que a passa e o código
> que a interpreta estavam ambos certos, cada um sobre o seu pedaço — e é por isso que
> nenhuma revisão de arquivo único acharia isto.
>
> O corolário operacional: **o que a subida IMPRIME é parte do produto.** Não é depuração
> — é o único relato que alguém lê sobre o estado de segurança de um processo que ninguém
> vai inspecionar. Ele merece o mesmo teste que o comportamento, e neste repositório
> agora tem.

## #137 — A API caiu e eu não consegui descobrir por quê: o instrumento que eu construí ontem registra tudo do daemon e nada da metade que derruba a stack

**Data:** 18/09/2026

Ontem, no #129, a queixa era que a stack tinha ficado 3h43 fora do ar sem deixar rastro,
e o conserto foi um histórico durável: `snapshot/refresh-historico.log`, com arranque,
grupo, duração e falha. Hoje a stack caiu de novo — às 12:32:21 — e eu abri aquele
arquivo esperando a resposta.

O arquivo estava certo e não tinha a resposta. **Ele registra o daemon. Quem morreu foi a
API.**

O que existia sobre a morte dela era uma linha:

```ts
console.error(`\nA API saiu (código ${codigo ?? '?'}).`);
process.exit(codigo ?? 1);
```

E ela vive no terminal de quem digitou `npm start` — que é exatamente o que não existe
mais quando alguém pergunta por que a plataforma caiu. **É o #129 inteiro, palavra por
palavra, na metade que eu não olhei.**

### O que eu consegui reconstruir, e onde parei

Juntando o relógio dos processos com o histórico do daemon:

```
12:08:10   subir sobe API + daemon
12:08:10   medio  ......................... 176 s
12:11:06   frio   ......................... 203 s
12:14:30   frio termina
12:29:30   quente .........................  72 s
12:32:21   a API sai com código 1  <-- e aqui a trilha acaba
12:32:47   um subir NOVO aparece
```

Os dois caminhos que a API tem para sair com 1 são o `decideLogin` recusando (só na
subida, e ela tinha subido) e `EADDRINUSE` (idem). Nenhum dos dois explica uma morte às
12:32 numa API viva desde 12:08. Não houve exceção no log. **Não sei o que aconteceu, e
não vou inventar** — a máquina tem outro agente operando a mesma stack, e "outro `npm
start` tomou a porta" é tão plausível quanto qualquer coisa. Que eu não consiga decidir
entre duas hipóteses banais com todos os logs na mão **é o achado**.

### O que entrou, e o que deliberadamente NÃO entrou

Entrou um evento `api-morreu` no histórico, com o código de saída e **quanto tempo ela
viveu** — que é o campo que decide o diagnóstico:

> **Vida curta (segundos) aponta configuração. Vida longa aponta causa externa.**

Uma API que morre 8 s depois de subir morreu de si mesma; uma que morre depois de 8 h
morreu de alguma coisa que passou. Sem esse campo, os dois casos são a mesma linha.

**NÃO entrou ressurreição, e a diferença importa.** Seria a simetria óbvia — o daemon
ganhou `supervisao.ts` ontem, com espera crescente e teto; por que não a API? Porque a
morte mais provável dela é **outra instância tomando a porta 3100**, e `subir` tem esse
caminho e derruba o ocupante. Ressuscitar ali poria duas instâncias brigando pela porta
para sempre, cada uma matando a outra, num laço que só termina quando alguém percebe.

> O que faltava não era **reerguer**. Era **saber**.

Registrar é barato e não tem modo de falha; ressuscitar é caro e tem um modo de falha
pior que o problema. Elas parecem a mesma decisão e não são.

### A parte que me deixa menos confortável

Eu escrevi o `historico.ts` ontem, com um docstring longo sobre como o
`refresh-status.json` esquecia quase tudo e como um terminal fechado torna a madrugada
irrecuperável. Escrevi o argumento certo, implementei metade dele, e não notei a outra
metade até ela me custar exatamente o que o argumento previa — **em menos de vinte e
quatro horas.**

O motivo é que eu estava consertando *o refresh*, e o arquivo se chama
`refresh-historico.log`. O nome do arquivo delimitou o meu pensamento. A pergunta que
teria pego isto não é sobre refresh:

> *Quais processos compõem esta stack, e qual deles pode morrer sem deixar rastro?*

São três — API, daemon e supervisor. Eu instrumentei um.

### A lição

> **Instrumentar "o que eu estou consertando" deixa de fora o que compartilha o
> destino.** O daemon ganhou histórico porque o defeito de ontem era dele. A API derruba
> a stack inteira quando cai — ela tem MAIS consequência, e tinha MENOS instrumento.
>
> O teste barato, e que não depende de lembrar desta história: **liste os processos, não
> os defeitos.** Para cada um, pergunte o que sobra dele depois que o terminal fecha. Se
> a resposta for "um `console.error`", não sobra nada.

## #138 — A tarefa que faria a plataforma subir sozinha ficou um dia sem ser registrada por uma guarda que eu inventei: o Windows nunca exigiu Administrador

**Data:** 18/09/2026

O #129 terminou com um script — `tools/subir/agenda-no-windows.ps1` — que registra a
plataforma no Agendador do Windows para ela subir sozinha. Ele foi escrito, commitado, e
**não foi usado**, porque a primeira coisa que ele faz é isto:

```powershell
if (-not (Ehadministrador)) {
  Write-Host 'Registrar a tarefa exige PowerShell como Administrador.'
  exit 1
}
```

Então a pendência ficou registrada como "precisa do Erick, exige Administrador", e a
plataforma continuou dependendo de alguém digitar `npm start` — que é literalmente o
problema que aquele arquivo existe para resolver.

### Eu nunca testei

`Register-ScheduledTask`, com `-LogonType Interactive`, `-RunLevel Limited` e `-User` no
próprio usuário, rodado sem privilégio nenhum:

```
REGISTROU SEM ADMIN: ZZ-teste-permissao-claude  estado=Ready
```

O Windows exige elevação para tarefa que roda como **outro principal** ou **fora da
sessão do usuário** — que é o caso de `-AoIniciarOSistema` (S4U/AtStartup), e só dele.
Para "ao fazer logon deste usuário, como este usuário", qualquer conta registra a sua
própria tarefa.

A guarda estava certa sobre um caminho e aplicada aos dois. Um `if` no lugar errado
segurou por um dia a única coisa que impedia a stack de depender de memória humana.

### Quanto isso custou, medido

A stack esteve fora do ar de **17/09 20:42 até 18/09 12:08** — mais de quinze horas — e
ninguém soube, porque ninguém estava lá para digitar o comando. O #129 mediu 3h43 e
construiu o histórico; o #137 mediu a morte sem rastro da API. Este é o terceiro da
mesma família, e o mais bobo dos três: **o conserto já existia, escrito e testado, e
estava atrás de uma condição que eu não conferi.**

### A ironia que vale registrar

O `portao-login.ts`, neste mesmo repositório, tem a frase que descreve exatamente o que
eu fiz — escrita sobre outra guarda, no contexto oposto:

> *"Trava que atrapalha o caso certo acaba desligada."*

Ela foi escrita porque olhar só o `GOOGLE_CLIENT_ID` faria a guarda de login recusar
subir uma stack perfeitamente autenticada. É a mesma forma de erro: uma condição
verdadeira para um cenário, aplicada a todos. No caso do login, o autor viu e corrigiu
antes de doer. Aqui doeu — e doeu do jeito mais silencioso possível, porque uma guarda
que recusa não quebra nada: ela só faz o trabalho não acontecer, e isso não aparece em
teste nenhum.

### O que mudou

O privilégio passou a ser exigido **só** para `-AoIniciarOSistema`, com a mensagem
dizendo o que fazer sem ele (rodar o script sem argumento nenhum, que é o caso comum). A
guarda de `-Remover` saiu inteira: quem registrou pode remover, e se a tarefa for S4U o
próprio `Unregister-ScheduledTask` recusa — com a mensagem do Windows, que é mais precisa
que um palpite meu.

A tarefa está registrada:

```
estado ......... Ready
principal ...... erick.azambuja  logon=Interactive  nivel=Limited
gatilho ........ ao fazer logon, com 60 s de atraso
```

**E foi provada ponta a ponta, sem reiniciar a máquina** — `Start-ScheduledTask` é o
mesmo caminho que o logon dispara. A tarefa compilou a tela, achou a porta 3100 ocupada
pela stack que estava no ar, derrubou o ocupante e subiu a sua:

```
10:04:43  a tarefa dispara
10:04:47  subir           (PID 6616)
10:05:07  API             (PID 32748)   Login: Firebase (projeto …), domínio sebratel.com.br
10:05:13  daemon refresh  (PID 30416)   arranque no refresh-historico.log
          /api/saude -> ok, 23 queries, 1.421.105 linhas
```

Registrar sem provar seria repetir o #136 num nível acima: uma tarefa que existe, aparece
como `Ready` e falha no logon é pior que nenhuma, porque a pendência sai da lista sem o
trabalho sair do lugar. O que continua sendo do Erick é só o critério final de
`docs/DEPLOY.md` §2.2 — a máquina reinicia de verdade, ninguém digita nada, e a idade em
`/api/saude` volta a cair sozinha.

### A lição

> **Guarda por suposição é trabalho que não acontece, e trabalho que não acontece não
> aparece em lugar nenhum.** Um `if` que recusa cedo demais não deixa stack trace, não
> falha teste e não tem sintoma — ele só produz uma pendência plausível, que alguém
> anota e repassa.
>
> O teste é de dez segundos e eu não o fiz porque a suposição era *razoável*: mexer no
> Agendador do Windows soa como coisa de administrador. **Razoável é exatamente o
> adjetivo que impede a verificação** — ninguém confere o que já parece certo. Onde a
> guarda decide se o trabalho acontece, prove a condição em vez de deduzi-la.

## #139 — Uma página recusa 24% do ciclo, e não é defeito: é o preço que o guarda de idade avisou que cobraria, medido pela primeira vez

**Data:** 18/09/2026

Subi a stack e aquecí as páginas. Oito das quatorze responderam **409**. Fui atrás, e a
mensagem já explicava tudo:

```
Snapshot desatualizado: 'calendar' foi congelada em 2026-09-18T12:10:56Z, antes da
materialização mais recente das tabelas de origem (2026-09-18T12:11:28Z). As linhas
em calc.calendar.jsonl.gz são as do dado antigo, e o DAX igual não denuncia isso.
Rode: npm run snapshot:calculadas -- --tabela="calendar"
```

É `confereIdadeDaCalculada`, em `packages/snapshot/src/carrega.ts`, e ele está **certo**.
O docstring dele diz por que existe (*"a página serve o número de anteontem com cara de
hoje"*) e, o que importa aqui, **já avisa o que vai custar**:

> *"O critério é conservador de propósito. Compara com a materialização de query mais
> recente do plano, não com as dependências apuradas do DAX. (…) **O preço é um falso
> positivo quando se rematerializa uma query que a tabela não usa.**"*

Ninguém tinha medido o preço.

### A medição, e ela corrigiu o que eu tinha concluído antes

A primeira leitura foi durante um tick, com a sessão morrendo no meio, e me levou a
escrever que "a tela recusa durante o refresh" — como se fosse geral. **Está errado.**
Medindo um ciclo inteiro, 124 amostras de 8 em 8 segundos, relogando em 401:

```
visao-geral ............ 409 em   0/124    0%
diario-instalacao ...... 409 em   1/124    1%
relatorio-do-mes ....... 409 em   1/124    1%
agendamento-field ...... 409 em  30/124   24%
```

Não é a plataforma. É **uma página**, e as 30 amostras (~240 s) coincidem com a duração
do grupo `frio` naquele ciclo (12:52:26 → 12:56:41, 255 s).

### Por que só ela — a cadeia inteira

`agendamento-field` é a única das quatorze telas que usa a entidade **`Clima/ Tempo`**. E
a query `clima-tempo` está no grupo **`frio`**, que é o mais longo dos três.

O plano dessa página junta, então:

| o que ela usa | onde mora |
|---|---|
| `Clima/ Tempo` | query `clima-tempo`, grupo **`frio`** |
| `calendar`, `Status Protocolo Dia` | tabelas **calculadas** (`calc.*`) |
| `PROTOCOLOS GERAL`, `CAPACIDADE EQUIPE` | grupo `medio` |
| `FIELD AGENDA` | fora de todo grupo (21min49s, #82) |

Durante o `frio`, `clima-tempo` é rematerializada nos primeiros 7 segundos. A partir daí
o `geradoEm` dela é mais novo que o congelamento de `calendar`, que aconteceu no fim do
grupo anterior. O guarda dispara — e continua disparando até o `frio` terminar e
recongelar as calculadas, **255 segundos depois.**

`visao-geral` não usa nada do `frio`, e por isso ficou em 0%.

### O número é um PISO, não um teto

A janela que observei não incluiu nenhum `medio`. Como `PROTOCOLOS GERAL` e
`CAPACIDADE EQUIPE` também estão no plano dessa página, ela dispara no `medio` também —
que mede 190 a 286 s, a cada 20 min. **24% é o que eu medi, não o que acontece.** Dizer
o total exigiria uma janela que cobrisse os três grupos, e eu não a tenho.

### Por que eu NÃO mexi no guarda

A saída óbvia é comparar a idade da calculada só com as queries de que ela realmente
depende, em vez de com a mais recente do plano. O docstring recusa isso explicitamente, e
a razão é boa:

> *"Apurar dependência erraria para o lado permissivo se a leitura do DAX falhasse — e o
> lado permissivo aqui é servir número velho calado."*

Trocar um 409 honesto por um número plausível e errado é o negócio ruim que este
repositório inteiro existe para não fazer. **Um guarda que erra para o lado de recusar é
caro; um que erra para o lado de servir é indetectável.** Afrouxá-lo por causa de uma
página seria decidir sozinho uma troca que não é minha, e por isso ela fica escrita aqui
em vez de implementada.

Mover `clima-tempo` de grupo também não resolve, e vale dizer por quê antes que alguém
tente: a página dispararia no grupo de destino em vez do `frio`, e continuaria
disparando no `medio` de qualquer jeito. **O gatilho não é qual grupo — é ter qualquer
query do seu plano em qualquer grupo**, que é o caso de toda página viva.

### A lição

> **Trade-off documentado não é trade-off medido.** O docstring dizia "o preço é um falso
> positivo", e a frase estava certa e era inútil para decidir qualquer coisa: "às vezes
> recusa" e "recusa um quarto do tempo" pedem respostas diferentes, e só a segunda é um
> fato.
>
> Vale para o que eu mesmo escrevo: quando um comentário admite um custo sem quantificá-lo,
> ele não está documentando a decisão — está adiando a conta. **A frase que descreve o
> preço é o lugar onde o número deveria estar.**

---

## #140 — O preço que o #139 mediu e não pagou: a dependência apurada tira o grupo `frio` de TODAS as páginas, e o guarda continua fechado onde importa

**Data:** 18/09/2026

O #139, de hoje mais cedo, mediu o custo de `confereIdadeDaCalculada` pela primeira vez
(`agendamento-field` em 409 durante 24% do ciclo) e terminou escrevendo por que **não**
mexeu no guarda:

> *"Afrouxá-lo por causa de uma página seria decidir sozinho uma troca que não é minha,
> e por isso ela fica escrita aqui em vez de implementada."*

A decisão foi tomada: Erick aprovou, em 18/09/2026, o plano de 4 dias cuja primeira
frente é fechar a janela de refresh. Este achado é a execução dela — e registra o que
foi medido antes e depois, porque a troca só é defensável com número dos dois lados.

### O que mudou, em uma linha

`confereIdadeDaCalculada` comparava a idade da calculada com **a query mais recente do
plano da página**. Agora compara com **as queries de que aquela tabela nasce**
(`calculatedTableSourceTables`, em `packages/measure-engine/src/calculated.ts`).

### Por que isto não é o "lado permissivo" que o docstring temia

O docstring recusava a apuração de dependência com uma razão boa:

> *"Apurar dependência erraria para o lado permissivo se a leitura do DAX falhasse — e o
> lado permissivo aqui é servir número velho calado."*

A objeção é sobre **falha de leitura**, e é ela que a implementação trata: a apuração
devolve `null` — e quem chama volta à régua antiga, inteira — em três casos, todos de
ignorância e nenhum de conveniência:

1. o DAX não faz parse;
2. a recursão encontra uma calculada sem `table_dax`;
3. a varredura não resolve tabela nenhuma (DAX que não referencia tabela é DAX que esta
   função não entendeu, não DAX sem dependência).

**Permissivo só onde se sabe, nunca por omissão.** A varredura é sobre a AST
(`walk` + `parseDax`), não sobre texto, e segue coluna calculada adentro **e** tabela
calculada adentro — o DAX de `CALENDARIO INSTALADO` referencia `[DATA INSTALAÇÃO]`, que
é ela própria calculada, e parar nas referências diretas veria menos do que existe.

### A medição — as 7 calculadas nascem de TRÊS queries

Apurado contra o modelo real (`specs/`), não suposto:

| tabela calculada | origens |
|---|---|
| `BASE DE ORIGEM` | `PROTOCOLOS GERAL` |
| `calendar` | `FIELD AGENDA` |
| `CALENDARIO AGENDAMENTO` | `PROTOCOLOS GERAL` |
| `CALENDARIO CRIADO` | `PROTOCOLOS GERAL`, `PROTOCOLOS TELEFONIA` |
| `CALENDARIO INSTALADO` | `PROTOCOLOS GERAL` |
| `PROTOCOLOS` | `PROTOCOLOS GERAL` |
| `Status Protocolo Dia` | `FIELD AGENDA`, `PROTOCOLOS GERAL` |

Dessas três queries, `protocolos-geral` está no grupo `medio`, `protocolos-telefonia` no
`quente`, e `field-agenda` **não está em grupo nenhum**. O grupo `frio`
(`field-agenda-slot`, `clima-tempo`, `protocolos-produtividade`,
`protocolos-auxiliares`) não alimenta calculada nenhuma — e invalidava as 7.

### O efeito, página a página, pelo plano real

Antes, toda página com calculada era invalidada pelos **três** grupos: a régua olhava o
plano inteiro, e o plano de toda página viva tem query de mais de um grupo (é a própria
conclusão do #139: *"o gatilho não é qual grupo — é ter qualquer query do seu plano em
qualquer grupo"*). Depois:

```
agendamento-field ........ medio
capa ..................... NENHUM
diario-instalacao ........ medio
instalacao-reincidente ... medio
manutencao-inicial ....... medio
premiacao-instalacao ..... medio
protocolos-detalhados .... medio
relatorio-do-ano ......... medio
relatorio-do-mes ......... medio, quente
telefonia-ouvidoria ...... quente, medio
visao-geral .............. quente, medio
```

**`frio` some de DEZ das onze** — e a exceção é `agendamento-field`, pelo motivo que a
tabela acima não enxergava. Ver a correção logo abaixo, medida ao vivo no mesmo dia.

### CORREÇÃO, medida ao vivo às 13:41-13:49 — a tabela acima erra em uma linha

A tabela foi montada mapeando tabela→query por `t.queryRef`, e isso **ignora o grão
reduzido**. `specs/_catalog/projecao.yaml` declara que `FIELD AGENDA` tem duas queries:
`query_padrao: field-agenda-slot` e `query_completa: field-agenda`, e a padrão é a que
`carrega()` usa quando o pedido não toca coluna-gatilho. **`field-agenda-slot` está no
grupo `frio`.** Então `calendar` e `Status Protocolo Dia` *são* invalidadas pelo `frio`,
de verdade — e `agendamento-field` é a única página que as usa.

Não é defeito do conserto: `confereIdadeDaCalculada` compara com o `geradoEm` da tabela
que foi **de fato carregada**, seja qual for a query que a alimentou. O que estava errado
era a minha previsão estática, não o comportamento.

**A medição.** Ciclo completo, 290 amostras nas 11 páginas de 15 em 15 s, com os três
grupos em sequência (condição de arranque, o pior caso):

```
grupos: quente 13:41:33->13:42:25 (52s)  medio 13:42:25->13:45:37 (192s)  frio 13:45:37->13:49:15 (217s)

capa ..................... 0/27    0.0%   | quente 0/2  medio 0/11  frio 0/13
9 paginas ................ 1/26    3.8%   | quente 0/2  medio 1/11  frio 0/13
agendamento-field ........ 2/27    7.4%   | quente 0/2  medio 1/11  frio 1/13
```

Os onze 409 do ciclo inteiro caem em **dois instantes**, não espalhados:
`13:45:28-33` (dez páginas, fim do `medio`) e `13:49:02` (`agendamento-field`, fim do
`frio`). O cache serve o resto — é a mesma observação do #139.

**A janela real, pelos carimbos dos arquivos** (medida melhor que a amostra):

| | antes | depois |
|---|---|---|
| `medio`, calculadas de `PROTOCOLOS GERAL` | 13:42:32 → 13:45:37 = **185 s** | 13:44:57 → 13:45:37 = **40 s** |
| `frio`, as 10 páginas sem `FIELD AGENDA` | 217 s | **0 s** |
| `frio`, `agendamento-field` | 192 s | **192 s** (dependência real, não falso positivo) |

No `medio` a régua antiga disparava já em `apuracao-premiacao` (13:42:32, a primeira do
grupo); a nova só dispara em `protocolos-geral` (13:44:57). **185 s → 40 s, e os 40 s que
sobram são verdadeiros.**

### A frente seguinte ficou mais barata do que eu tinha escrito

Com este dado, a publicação por geração deixa de ser o próximo passo óbvio. Os 192 s de
`agendamento-field` no `frio` existem porque `field-agenda-slot` é materializada às
13:46:02 e o recongelamento das calculadas só roda no fim do grupo, às 13:49:05 —
esperando `protocolos-produtividade`, que sozinha leva 2 min. **Recongelar logo após a
última query que alimenta calculada**, em vez de no fim do grupo, cortaria esses 192 s
sem tocar em nada da publicação. É ordem de execução, não arquitetura.

### Feito e medido no mesmo dia, 17:06-17:19

`tools/snapshot/src/index.ts` passou a congelar as calculadas **logo após a ÚLTIMA query
daquela execução que as alimenta**, em vez de no fim de tudo. Quem responde "quais são
essas queries" é `queriesQueAlimentamCalculada`, em
`packages/snapshot/src/tabelas-calculadas.ts` — e ela **olha `graoReduzido`**, que é o
erro corrigido acima. Se a origem de qualquer calculada não for apurável
(`seguro: false`), o congelamento volta a ser no fim: o atalho fica amarrado à mesma
condição de solidez da régua.

O log do daemon, nos dois grupos que importam:

```
'protocolos-geral'   era a última desta execução que as alimenta. As 4 restante(s) não são origem de nenhuma.
'field-agenda-slot'  era a última desta execução que as alimenta. As 2 restante(s) não são origem de nenhuma.
```

O congelamento em si, cronometrado pelo próprio processo: **12.985 ms** no `medio`,
**13.197 ms** no `frio`. Nos dois casos as queries restantes só começaram depois dele.

| janela | antes | com dependência apurada | + congelamento antecipado |
|---|---|---|---|
| `medio`, as 10 páginas com calculada | 185 s | 40 s | **13 s** |
| `frio`, `agendamento-field` | **350 s** | 350 s | **13 s** |
| `frio`, as outras 10 páginas | 217 s | **0 s** | 0 s |

Os 192 s que eu tinha estimado para o `frio` eram **350 s** na medição: `field-agenda-slot`
gravou às 17:11:25 e `protocolos-produtividade` só terminou às 17:17:02. Errei a
estimativa para menos — mais uma razão para não publicar previsão como se fosse medida.

### O que esta sessão quebrou, e vale mais que o conserto

Editei `tools/snapshot/src/index.ts` em dois passos — o uso primeiro, o `import` depois —
com o daemon no ar. O tick das **14:04:15** pegou o arquivo no meio e matou o grupo
`quente` com `ReferenceError: calculatedTableSourceTables is not defined`, código 1 em
319 ms. Entrou como `ok:false` em `snapshot/refresh-historico.log`.

> **Com o daemon no ar, cada GRAVAÇÃO tem de deixar a árvore válida — não cada edição.**
> O daemon relê `tools/snapshot/src/index.ts` do disco a cada 15 min, num processo novo.
> `import` antes do uso, declaração antes da chamada, ou o arquivo inteiro numa gravação
> só. A janela de inconsistência que eu passei o dia fechando no snapshot eu abri no
> código-fonte, pelo mesmo motivo: publicar em dois tempos o que é lido de uma vez.

### O portão de 24 h não é alcançável nesta máquina

Entre 14:04 e 16:59 a máquina suspendeu por ~2h30. Um `quente` ficou pendurado
8.653.240 ms e morreu; na volta, três grupos falharam com
`EHOSTUNREACH 186.219.128.248:5432` — rede ainda fora. Nenhum deles tem a ver com a
plataforma, e os quatro grupos seguintes rodaram `ok:true`.

O portão proposto para o deploy — *24 h de histórico sem um `ok:false`* — mede o sono do
notebook, não a estabilidade do refresh. Ou ele roda no servidor (`docker-compose.prod.yml`
já existe), ou o critério precisa excluir falha de rede logo após arranque. **Um portão
de estabilidade medido numa máquina que dorme não prova o que promete.**

### O que NÃO foi resolvido, e é o maior pedaço

O grupo `medio` continua invalidando as dez páginas que têm calculada, porque
`PROTOCOLOS GERAL` é origem de 6 das 7 e mora nele. São ~284 s medianos, 2x por hora.

Isso não se conserta apurando dependência melhor — a dependência é real. Conserta-se
**publicando o conjunto de uma vez**: materializar em área de espera e virar um ponteiro
de geração, com query e calculada trocando juntas. Metade já existe
(`packages/snapshot/src/escrita-atomica.ts` resolve o arquivo); falta o nível do
conjunto. Fica registrado aqui como a frente seguinte, não como pendência esquecida.

### Uma correção ao que eu mesmo disse hoje

Antes de achar o #139 eu havia relatado a janela como *"~34% do relógio em que um pedido
frio a qualquer página que toque calculada responde 409"*. Os 34,3% (699,5 s de
materialização em 2.038 s, `refresh-historico.log`) medem a **largura da janela de
inconsistência**, e não a taxa de recusa: o #139 amostrou o ciclo de verdade e achou
`visao-geral` 0%, `diario-instalacao` 1%, `agendamento-field` 24%. O cache serve a
maioria dos pedidos, e só o **frio** cai no guarda. Largura de janela e taxa de recusa
são números diferentes, e eu usei um no lugar do outro.

### A lição

> **A objeção registrada tem um alvo, e vale conferir se o conserto acerta o alvo ou
> passa longe dele.** O docstring recusava apurar dependência *"se a leitura do DAX
> falhasse"* — uma objeção sobre **falha**, não sobre a ideia. Lida como veto à ideia,
> ela congelaria o defeito para sempre; lida como requisito, ela vira o `null` que
> devolve a régua antiga e torna a troca segura.
>
> O #139 fez a parte difícil: mediu, e escreveu a objeção em vez de contorná-la calado.
> Sem aquele texto eu teria implementado isto sem saber que havia um motivo para não o
> fazer — e sem saber, portanto, o que precisava provar.

---

## #141 — A paridade não estava quebrada: estava sem endereço. Confirmar o relatório derrubou 5 dos 6 bloqueios, e a única divergência que sobrou sem causa era um espaço no fim de um texto

**Data:** 18/09/2026

O `CLAUDE.md` avisava havia semanas que ninguém registrava contra qual relatório os
números de `pbi:` tinham sido medidos, e que as tabelas em `bloqueadas` falhavam todas
com a mesma cara — *"definições diferentes"*, *"formas incompatíveis"* — que é
exatamente o sintoma de consultar o relatório errado.

Custou **um comando** descobrir: `npm run powerbi -- --tabelas`. O token renovou-se
sozinho pelo `refresh_token` (ninguém precisava de navegador) e a ferramenta imprimiu
o alvo antes de qualquer consulta:

```
nome       INST - Relatório Instalação      <- o CERTO, não o "Gerencial"
relatório  f12d1205-62d7-4bc3-b300-ea7268076dd4
dataset    39382a2c-a349-4cce-8c4a-9703c9fa4364
```

A hipótese que travava tudo estava **errada**, e bastava perguntar. A procedência foi
para o cabeçalho de `specs/_catalog/paridade-janela.yaml`, com o comando que a
reconfere.

### O que caiu quando o endereço ficou conhecido

| tabela | pbi | nós | como |
|---|---|---|---|
| `BACKLOG AGENDADO FUTURO` | 96.384 | 96.384 | sem recorte |
| `PROTOCOLOS GERAL` | 95.679 | 95.686 | sem recorte |
| `RETORNO PRIORITARIO` | 273 | 273 | `data_instalacao >= 2026` |
| `Base Categorias Field` | 228.568 | 228.570 | `beginning_service_date >= 2026` |
| `PROTOCOLOS TELEFONIA` | 650 | 650 | `DATA CRIADO >= 2026` |
| `PROTOCOLOS PRODUTIVIDADE` | 78.144 | 78.284 | `DATA CRIADO >= 2026` |

E as outras nove tabelas do modelo batem exato **sem predicado nenhum**.

**Em `PROTOCOLOS GERAL` o predicado antigo não estava vencido: estava ERRADO.** Ele
era `[DATA CRIADO] >= DATE(2026,1,1)` e derruba o lado do Power BI para 38.652 contra
os nossos 95.686 — 60% a menos. Os dois lados convergiram quando o commit 8b1fd19
destravou um `EXISTS`, e ninguém voltou para apagar o filtro. Aplicá-lo hoje produziria
exatamente o gabarito impossível que o arquivo existe para impedir.

Isso exigiu uma mudança de esquema: `carregaJanelas` recusava entrada sem `dax`, com
uma razão boa — *"janela sem predicado não filtra nada"*. Mas a recusa tornava
**"medi e não precisa" indistinguível de "esqueci de preencher"**. Entrou
`sem_recorte: true`: uma afirmação, com prova obrigatória, e erro alto se vier junto
com `dax` (são afirmações opostas, e escolher uma seria adivinhar qual foi medida).

### O comparador produzia dez falsos positivos por varredura

`Data mais recente` aparecia como divergência em **todas** as páginas que a têm,
mostrando `2026-09-18T00:00:00` de um lado e `2026-09-18` do outro — o mesmo instante.
A causa, em `compara()`:

```js
return String(p) === String(nosso)
```

O Power BI devolve data como **texto** no JSON da API; nós devolvemos **`Date`**.
`String(new Date(...))` dá `"Thu Sep 18 2026 …"`, então **nunca** casava.

Agora compara como instante, lido componente a componente com `Date.UTC` — e não com
`new Date(texto)`, que aplicaria o fuso do runtime e faria a paridade depender de onde
o processo roda. `Hora mais recente` **continua** divergindo, e deve: são instantes
diferentes de verdade, o carimbo de refresh de cada lado.

`compara` estava sem teste nenhum porque mora num script que faz `await pegaToken()` na
carga — importá-lo num teste tentaria autenticar. Saiu para `tools/powerbi/src/compara.ts`
com 6 testes. O cabeçalho de `test/api.test.ts` anunciava cobrir *"a fronteira de saída
e a comparação"* e cobria só a primeira.

### A última divergência sem causa era um espaço

Sobraram 4 cards em `relatorio-do-mes`, todos ~2,4% acima do nosso lado. O método que
resolveu: **rodar a NOSSA fórmula no dado DELES.** Deu 79.285 — idêntico à medida
publicada. Fórmula igual ⇒ a diferença está no dado.

Comparando os valores distintos de `TIPO DE PROTOCOLO`, um único diferia:

```
Power BI:  "TEC - Instalação de Roteador Adicional"
Nós:       "TEC - Instalação de Roteador Adicional "
```

O `NOT(TIPO IN {...})` da medida não excluía aquelas linhas. `TRIM(it.title)` no SQL,
rematerialização, e `# TOTAL MÊS ATIVO` foi de 81.204 para 79.290 contra 79.285.

Mexer no SQL mudou o sha e **derrubou sozinha a prova de janela gravada três horas
antes** — o guarda de `provaVencida` funcionando exatamente como projetado, contra quem
o escreveu no mesmo dia.

`# META` era outra coisa: constante de negócio digitada à mão. Nossa spec tinha 2928,
medido em 25/08; o relatório vivo passou a devolver **2865**. O comentário de lá já
antecipava — *"se a meta mudar de novo, ela muda AQUI"* — e agora diz para confirmar
com quem define a meta, porque isto é decisão de negócio e não medição.

### O que fica, e por quê

| card | causa |
|---|---|
| `Hora mais recente` (×11) | carimbo de refresh de cada lado, instantes diferentes |
| `Primeiro Classificacao` (×2) | previsão do tempo, atualiza sozinha |
| 4 de `FIELD AGENDA` | bloqueada: 1.739.231 contra 41.584, definição diferente |
| `# MEDIA INSTALADO BACKLOG` | `MIN([DATA INSTALAÇÃO])` é 2025-01-02 lá e 2025-01-18 aqui; o calendário fica 16 dias menor e o divisor encolhe |

**Nenhuma divergência sem causa escrita.** Eram 7 em `DEPLOY.md §2.4`.

### Dois bloqueios que mudaram de natureza

`REINCIDÊNCIA` saiu de "prova vencida" para algo que o arquivo não previa: **a coluna
do corte não existe do outro lado.** Nosso SQL corta por `created`; a tabela publicada
só tem `data_instalacao`, `data_suporte` e `Data`. Filtrar por `data_instalacao` dá
1.410 dos dois lados — bate bonito — mas o nosso conjunto tem 1.461.

`INSTALAÇÕES REINCIDENTES` foi reconferida e o bloqueio ficou **mais forte**: 24 dias
depois, `reincidente_30d = "SIM"` continua em exatamente **444**, com data máxima
**2026-04-13**. E a armadilha que isso revela vale mais que o caso: **a contagem da
tabela bate EXATO** (23.255 dos dois lados), porque as linhas "NÃO" seguem entrando.
Uma conferência que olhasse só `COUNTROWS` declararia a tabela equalizada e
preencheria o gabarito com o número regredido.

### A lição

> **Antes de explicar uma divergência, confirme que os dois lados são os dois lados.**
> Cinco bloqueios sobreviveram semanas com explicações plausíveis — "formas
> incompatíveis", "a base congelou", "definições diferentes" — e o que faltava era um
> comando de dez segundos dizendo contra o que estávamos medindo. Explicação plausível
> é o disfarce mais confortável de uma pergunta que ninguém fez.
>
> E o corolário, que resolveu o último card: **quando a fórmula é a mesma, rode a sua
> no dado do outro.** Se o número dele sair, a fórmula está inocente e sobra o dado —
> que foi onde estava o espaço.


## #142 — a divergência de 2 linhas era um protocolo reclassificado no meio do caminho

**Quando:** 19/09/2026, varredura de paridade das 11 páginas contra o alvo confirmado.

**O placar:** 46 batem, 21 diferem, 0 ausentes, 0 erros. Ontem era 49/18. As três que
mudaram de lado: duas de previsão do tempo (API externa, muda de hora em hora) e
`PROTOCOLOS RETORNOS` de `manutencao-inicial` — 275 lá contra 273 aqui, depois de
bater exato (273/273) no dia anterior.

**Por que valia investigar:** a direção estava errada. O nosso lado é o MAIS NOVO —
`Hora mais recente` marca 11:57 aqui contra 10:09 lá, 6.466 s de diferença — e mesmo
assim o lado velho tinha MAIS linhas. Atraso de carga explica o contrário disso, nunca
isso. Um lado velho com mais linhas significa que alguma coisa SAIU do nosso conjunto.

**O caminho, e as duas hipóteses que caíram antes da certa:**

1. *A fresta entre as datas.* A janela de `RETORNO PRIORITARIO` corta por
   `data_instalacao`, mas o nosso SQL corta por `a.created` (`data_abertura`) — é a
   armadilha que o `CLAUDE.md` registra. Medido: `data_instalacao >= 2026` dá 275,
   `data_abertura >= 2026` dá 275, as duas juntas dão 275, a fresta dá 0. **Caiu.**
2. *Dois cancelamentos recentes.* O SQL exclui `is2.title <> 'Cancelado'`, e há 37
   linhas em `Cancelado` hoje. Se duas tivessem sido canceladas entre 10:09 e 12:01, o
   Power BI ainda as teria. **Não deu para provar nem negar:** `assignment_incidents`
   não tem coluna de atualização (só `sap_*_modified_integration` e
   `feedback_last_email_sent`, todas zeradas no conjunto).
3. *Contar protocolos em vez de linhas.* Aqui abriu. 273 linhas nossas são **250
   protocolos distintos** — a expansão de `ALOCAÇÃO PATRIMONIO` no passo de M duplica
   23. Do outro lado: 275 linhas, **251 protocolos**. A diferença não era "2 linhas",
   era **1 protocolo** que a expansão conta duas vezes.

**O culpado:** protocolo `1821701`, presente lá e ausente aqui — e no resto somos
superconjunto exato (`só aqui: []`). No banco ele é `incident_type_id = 1268`
(`TEC-ACESSO-CLI-RETORNO-PRIORITARIO`), e o nosso SQL filtra `= 1160`
(`TEC - Suporte de Retorno Prioritário`).

**A tentação, e por que ela estava errada.** O tipo 1268 nasceu em 23/04/2026 e já tem
16 protocolos, o último hoje: parece exatamente um tipo novo que o nosso SQL não
acompanhou, e o conserto óbvio seria trocar `= '1160'` por `IN ('1160','1268')`. Duas
medidas impediram o erro:

- a extração original em `../QUERIES-DASHBOARD-INSTALACAO/m/retorno-prioritario.m` diz
  `incident_type_id = '1160'` — o nosso SQL é fiel;
- e perguntando ao próprio modelo publicado quais tipos a tabela dele contém:
  `SUMMARIZECOLUMNS('RETORNO PRIORITARIO'[protocol_type], ...)` devolve **uma linha
  só**, `TEC - Suporte de Retorno Prioritário`, 405 linhas. **O Power BI também não
  conhece o 1268.**

**Então o que aconteceu:** o protocolo foi aberto HOJE (`a.created` = 19/09) como 1160,
o modelo publicado o capturou às 10:09, e alguém o **reclassificou para 1268** antes da
nossa carga das 12:01. O Power BI carrega um retrato de um protocolo que já não é
aquilo. **O número certo é o nosso.**

**O que isto ensina, e é o que vale guardar:**

> Antes de mudar uma definição para "acompanhar" o outro lado, **pergunte ao outro lado
> o que ele contém.** Uma linha a mais lá parece regra nova; era estado velho de uma
> linha. O teste custa uma consulta `SUMMARIZECOLUMNS` e teria evitado alargar o nosso
> filtro para um tipo que o gabarito também rejeita — divergência que só apareceria
> depois, invertida, e sem esta pista.

E o corolário operacional: **contar linha não é contar entidade.** Em toda tabela que
passa por `Table.ExpandTableColumn`, a primeira pergunta diante de uma diferença
pequena é quantas ENTIDADES distintas ela representa. Aqui, 2 linhas eram 1 protocolo,
e procurar "as duas linhas que faltam" nunca teria achado nada.

**As 21 de hoje, todas com causa:** 11 `Hora mais recente` (carimbo de carga; somos os
mais novos), 4 de `FIELD AGENDA` (bloqueada, definição diferente), 4 de previsão do
tempo (API externa), 1 `PROTOCOLOS RETORNOS` (este achado), 1
`# MEDIA INSTALADO BACKLOG` (`CALENDARIO INSTALADO` 729 contra 713, já em #141).
**Zero sem explicação.**


---

## #143 — "cargas falharam" em onze queries, e nenhuma delas tinha defeito: o notebook dormiu 2h14min no meio da carga

**Quando:** 21/09/2026, a partir de um banner de 19/09 que dizia
`cargas falharam: alocacao-patrimonio, apuracao-premiacao, backlog-agendado-futuro,
base-categorias-field, capacidade-equipe, instalacoes-reincidentes, protocolos-geral,
reincidencia, retorno-prioritario, tecnicos-auxiliares, troca-endereco (saiu com
código 1)`.

**Os onze nomes são o grupo `medio` inteiro**, e a leitura natural do banner é que
onze queries quebraram ao mesmo tempo. Nenhuma quebrou.

**A assinatura que denuncia, e ela está no próprio histórico:**

```
{"evento":"disparo-coalescido","quando":"2026-09-19T18:51:48.519Z","grupo":"medio","emCursoHaMs":8105361}
{"evento":"disparo-coalescido","quando":"2026-09-19T18:51:48.522Z","grupo":"quente","emCursoHaMs":0}
{"evento":"disparo-coalescido","quando":"2026-09-19T18:51:48.533Z","grupo":"frio","emCursoHaMs":0}
{"evento":"grupo","quando":"2026-09-19T18:54:36.070Z","grupo":"medio","ok":false,"duracaoMs":8272913,"erro":"saiu com código 1"}
```

Três relógios de **15, 20 e 30 minutos** disparando com **14 ms** entre si. Isso não
acontece por coincidência: é o Windows liberando de uma vez tudo que venceu enquanto o
processo estava congelado. E `duracaoMs: 8272913` são 2h17min num grupo cujo custo
medido é 286 s (`specs/_catalog/refresh.yaml`).

**A confirmação, ao segundo,** cruzando o histórico (UTC) com o log de energia do
Windows (local, UTC−3):

| UTC | local | evento |
|---|---|---|
| 16:36:43 | 13:36:43 | `medio` começa |
| 16:37:11 | 13:37:11 | **Windows entra em espera — 28 s depois** |
| 18:51:48 | 15:51:48 | os três relógios disparam juntos |
| 18:51:50 | 15:51:50 | evento de retomada do kernel |
| 18:54:36 | 15:54:36 | `medio` morre com código 1 |

`powercfg /a` diz qual é o modo: **`Espera (S0 Ocioso com Baixo Consumo) Conectado via
Rede`**. Ele congela o processo Win32 e **mantém a rede de pé** — então o filho dormiu
com os sockets do Postgres abertos e, ao acordar, o exit 1 foi o driver relatando que
a conexão tinha morrido no sono. `STANDBYIDLE` está em `0x0` nos dois modos: não foi
tempo de tela, foi tampa fechada ou suspensão manual.

**E o caso isolado não era isolado.** Varrendo as 25 falhas registradas entre 18 e
21/09/2026 contra os eventos 506/507 do kernel, elas se separam em **três** populações:

| população | quantas | evidência |
|---|---|---|
| atravessaram o sono | 5 | duração de 2h17min, 2h24min, 3h05min, 6h16min, **10h46min** |
| nasceram na retomada | ~8 | terminaram de **1 s a 110 s** depois de um `ACORDOU` |
| máquina acordada | ~5 | 20/09, 12:49–13:15 local — **sem causa conhecida** |

Exemplos da segunda coluna, e é ela que muda o conserto: `frio` falhou **1 s** depois
de acordar (20/09 03:08:22 contra `ACORDOU` 03:08:21); `medio` falhou **no mesmo
segundo** (09:27:30); `frio` **2 s** (12:32:25 contra 12:32:27); `quente` **10 s**
(14:31:59 contra 14:31:49). Essas têm duração NORMAL — não dormiram: nasceram cedo
demais, com a pilha de rede ainda subindo.

**Taxa de falha acumulada do agendador quando isto foi medido: 16 em 56 — 28,6%.**

**O que foi feito:**

1. **Detector de suspensão por batimento** (`apps/api/src/agendador.ts`). Um
   temporizador de 60 s que não faz trabalho nenhum: só confere se o relógio de parede
   andou mais do que ele deveria ter deixado andar. Passou de 3× a cadência, a máquina
   congelou. *A tentação era comparar um relógio monotônico com o de parede — na
   Espera S0 o contador de ticks continua andando e a comparação não acusaria nada. O
   sintoma direto, e o único que não depende de detalhe de plataforma, é o
   temporizador não ter disparado.*
2. **A carga congelada é morta, não esperada.** O filho não percebe o sono: fica
   bloqueado num socket morto. `rodaGrupoAssincrono` passou a aceitar `AbortSignal` e
   mata com `SIGKILL`. Sem isso, `quente` e `frio` esperaram 2h17min atrás de um
   processo que já estava morto por dentro.
3. **Suspensão não é falha.** Vira evento próprio (`carga-interrompida`),
   `falhasConsecutivas` não sobe, o `refresh-status.json` não fica vermelho, e o grupo
   volta para a **frente** da fila — ele perdeu a vez inteira, os outros só esperaram.
   *O alarme que importa continua de pé: `estaVencido` mede idade do último SUCESSO,
   então dormir três dias continua acendendo "vencida", com razão. O que sumiu foi a
   palavra "falharam".*
4. **Carência de 60 s depois de acordar**, para a segunda população. Ao retomar, os
   relógios de TODOS os grupos batem de uma vez — sem carência, o primeiro trabalho do
   agendador ao voltar é disparar tudo no pior momento possível. O preço é um atraso de
   60 s uma vez por retomada.
5. **O `stderr` do filho passou a ser guardado** (`tools/refresh/src/executa-grupo.ts`).
   `stdout` continua herdado; `stderr` é canalizado, reescrito no nosso `stderr` e as
   5 últimas linhas entram no resumo da falha.

**O item 5 é o que mais dói, e é o mais barato.** Com `stdio: 'inherit'` nos dois, tudo
que sobrava de uma falha era `saiu com código 1`. Descobrir a causa exigiu cruzar o
histórico com o log de energia do Windows. A cauda do `stderr` teria dito
`Connection terminated unexpectedly` na primeira linha. **E é por isso que a terceira
população continua sem causa:** para aquelas cinco falhas de 20/09 não existe log
nenhum a recuperar — o instrumento não estava lá.

**O relatório também estava dando o conselho errado.** `npm run refresh:daemon --
--historico` imprimia `quente 1x, já rodava há 0s` e mandava afrouxar a cadência do
`quente`. O `quente` não estava rodando: estava **na fila**, atrás do `medio`
congelado. Descarte com o grupo rodando e descarte com o grupo na fila têm conselhos
opostos, e o relatório os confundia — `esperandoNaFila` agora separa os dois.

**O que isto NÃO conserta, e é a parte importante.** Nada aqui impede a máquina de
dormir. Em produção a cadência vive no contêiner e o problema não existe; nesta
máquina, um número que sobe em `suspensoes` no `/api/saude` é a resposta de que o
problema não tem conserto em código — tem em política de energia, ou em mudar de host.
O que mudou foi que a plataforma passou a **dizer isso**, em vez de acusar onze queries
inocentes.

**Testes:** 12 novos (4 em `tools/refresh/test/executa-grupo.test.ts`, 4 em
`apps/api/test/agendador.test.ts`, 4 em `tools/refresh/test/historico.test.ts`).
Suíte: 2.105 passando.


---

## #144 — A API não tinha guarda de processo, e já tinha morrido por isso: `codigo: 1` era tudo que sobrava

**Quando:** 21/09/2026, ao revisar o risco que o #143 introduziu.

**O que mudou o risco.** Desde 19/09 a cadência do refresh vive DENTRO do processo da
API (`apps/api/src/agendador.ts`), e não mais num daemon separado. Isso trocou o preço
de uma exceção solta: antes ela derrubava um daemon e o refresh parava; hoje ela
derruba **a tela**, e a operação fica sem trabalhar.

**Procurei a rede embaixo disso e ela não existia.** `grep -rn "uncaughtException|
unhandledRejection" apps/api/src/` devolvia **zero**. Os únicos `process.on` do
repositório são os `SIGINT`/`SIGTERM` de `tools/subir/src/index.ts`.

**E não é hipotético — está no log.** `npm run refresh:daemon -- --historico`:

```
MORTES DA API: 3
  2026-09-18T13:21:24.544Z  código 3221226505  depois de 85 s no ar
  2026-09-18T13:41:31.988Z  código 1  depois de 1125 s no ar      <- exceção não tratada
  2026-09-19T00:28:35.795Z  código 3221226505  depois de 7.1 h no ar
```

Código 1 em Node é exceção não tratada. A API morreu depois de 18 minutos no ar e
**não há como saber por quê**: nem mensagem, nem pilha, nem qual pedido a provocou. É
o mesmo defeito de forma do #143 — o instrumento não estava lá quando foi preciso.

*(Os outros dois, `3221226505` = `0xC0000409`, são `abort()` do próprio Node — outra
causa, fora do alcance desta guarda.)*

**A decisão difícil, e por que ela é esta.** O conselho de manual depois de um
`uncaughtException` é sair, porque o estado pode estar corrompido. Ele vale para um
servidor que ESCREVE. Esta API é estritamente somente-leitura (regra 2 do CLAUDE.md):
lê snapshot de disco e devolve JSON. O "estado" que poderia corromper é cache —
descartável por construção. Entre servir dado de um minuto atrás e **não servir nada**,
a tela é o produto. É o mesmo raciocínio que `#recusa` no agendador já aplicava:
*"derrubar a API por causa disso trocaria dado velho por tela nenhuma"*.

**Mas não a qualquer preço.** Erro não tratado em RAJADA não é um pedido azarado: é um
processo quebrado, e insistir nele serve respostas que ninguém entende. Dez em sessenta
segundos e a guarda desiste com código diferente de zero — que é o que faz um
supervisor subir instância limpa. A janela é **deslizante por reinício, não cumulativa**:
um erro a cada dez minutos nunca chega ao teto, e esse é justamente o caso que a guarda
existe para NÃO derrubar.

**O que passou a aparecer no `/api/saude`:**

```json
"guarda": { "total": 0, "naJanela": 0, "ultimo": null }
```

Sem isso, "a API está de pé" e "a API está de pé e já engoliu 7 erros" são
indistinguíveis de fora — e a segunda precisa aparecer antes de virar a terceira.

**Os temporizadores do agendador também foram blindados.** Um `throw` dentro de
`setInterval` não tem quem o pegue: não há pilha de chamador, então vira
`uncaughtException` direto. Os três relógios (cadência de grupo, batimento, fim da
carência) passam por `#semDerrubar`, que registra qual relógio produziu o erro e segue.
A guarda de processo é a rede embaixo desta; esta é para o erro nunca chegar lá.

**O teste que faltava, e é o que a operação de fato precisa.** Nada guardava a
propriedade que justifica o desenho inteiro: *a API continua atendendo enquanto um
refresh roda*. `apps/api/test/api-sob-refresh.test.ts` sobe a API de verdade com o
agendador de verdade e mede:

- 20 pedidos a `/api/saude` com um grupo preso em voo — todos 200, pior caso < 1 s;
- três grupos falhando seguidos (um deles LANÇANDO, não devolvendo erro) não derrubam
  a tela nem param a cadência;
- **com o executor REAL e um filho REAL**, o laço de eventos continua girando.

O último é deliberadamente o único que não injeta `roda`: os outros provam a
integração, mas uma promessa já resolvida passaria por todos eles — eles **não**
pegariam alguém trocando `spawn` por `spawnSync`, que é exatamente o conserto distraído
que transformaria "o refresh travou" em "a tela saiu do ar". Ele usa uma query
inexistente de propósito: o materializador recusa no Query Registry e sai em ~0,4 s,
sem tocar banco, sem tocar o manifesto e sem imprimir dado de cliente.

**Suíte: 2.116 passando** (2.105 → 2.116; 7 da guarda, 4 da API sob refresh).

---

## #145 — `field-agenda` ficou 20 dias fora de cadência por um número que o achado seguinte já tinha matado

**22/09/2026.** A página `agendamento-field` mostrava dado de **6,8 dias** em 6 dos
seus 40 visuais. Fui atrás do custo que justificava a exclusão e ele não existe mais.

**A entrada 4 do bloco de exclusões de `refresh.yaml` mandava manter `field-agenda`
fora de qualquer grupo, citando os 21 min 49 s do #82.** O #86 — **do mesmo dia**,
três achados abaixo, no mesmo arquivo — derrubou esse número para 79 s calculando
`RankDataProtocolo`/`RankAtualProtocolo` por grão reduzido. A condição de saída
estava cumprida desde 02/09 e ninguém voltou para apagar a frase. É exatamente o que
a entrada de `protocolos-geral`, dez linhas acima na mesma lista, já denuncia de si
mesma: *"a condição de saída foi cumprida duas vezes e ninguém voltou"*.

### O custo de hoje, medido ponta a ponta

```
busca no banco          226.954 ms   86,8%     <- o gargalo agora é este
avaliação de M            2.768 ms    1,1%
toDatasetRows               674 ms    0,3%
7 colunas calculadas     26.001 ms    9,9%     (eram 958.194 ms)
escreve()                 4.574 ms    1,7%
                        ----------
TOTAL                   261.454 ms   4 min 21 s      634.351 linhas × 26 colunas
```

**O perfil inverteu.** Quando o #82 mediu, o cálculo era 73% e o banco 1,4%. Hoje o
banco é 86,8% e o cálculo 9,9%. Qualquer plano montado sobre a repartição antiga
ataca o lado errado.

### Duas coisas que a narrativa deste repositório erra sobre esta query

**1. O `LEFT JOIN person_skills` não multiplica nada.** O #2, o #86 e
`DECISAO-GRAO-FIELD-AGENDA.md` atribuem a inflação da tabela ao produto
relato × skill. Medido no arquivo em disco: `skill` tem **2 valores distintos e
422.177 nulos** em 634.351 linhas, e **todo relator tem exatamente 1 skill**
(182 relatores, max = mediana = min = 1). Tirar o join economizaria zero. Quem
multiplica é `reports` — o relato —, que é o que os 6 visuais querem ver. O grão real
é produto cruzado por `assignment_id`: 41.284 linhas da view × ~13,4 relatos.

**2. A coluna cara não são os `Rank`.** Eles eram 85% do custo no regime antigo e
hoje somam 4,3 s (**7%**). A cara é `ClassificacaoRelato` — 17,3 s, os 45
`CONTAINSSTRING` sobre 634 mil textos, 77% do orçamento de coluna calculada. Se um
dia valer otimizar, `Relato` tem 54.578 valores distintos em 634.351 linhas (11,6× de
repetição) e a coluna é função pura do texto: memoizar por valor distinto colapsaria
17,3 s em ~1,5 s. Não feito — o cálculo inteiro é 9,9% do relógio.

**E a hipótese de O(n²) caiu.** A forma do DAX (`FILTER` na tabela inteira por linha)
sugere quadrático, mas a curva medida em n = 5k/10k/20k/40k dá expoente **~1,0–1,2**:
o índice de igualdade (#44/#50/#59) resolve o `FILTER` em O(partição). O custo é
`Σ|partição|²` com constante alta, e as partições são gordas (média 58,5 linhas por
protocolo, p99 319, máx 1.113).

### O que foi feito

* `field-agenda` entrou no grupo `frio`. 213 s (o grupo) + 261 s = **474 s em
  1.800 s: 26%** — a margem deste grupo continua sendo a maior dos três.
* A materialização de hoje foi promovida para `snapshot/`, com o manifesto acertado
  junto, e `calculadas.ts --todas` recongelou as sete tabelas calculadas em 12,6 s
  (`Status Protocolo Dia` lê `'FIELD AGENDA'[Relato]` — trocar o arquivo sem
  recongelar deixaria a calculada derivada de dado velho).
* A entrada 4 de `refresh.yaml` foi reescrita com a medição e com o registro do erro.

**O risco que fica é a banda de rede, não o cálculo.** A busca variou 18% entre duas
medidas do mesmo dia (226.954 ms dentro do materializador, 192.467 ms isolada, ~360 MB
nas duas). Com o espectro que `refresh.yaml` já registra (0,62 a 3,52 MB/s), a carga
desta query é uma **banda de ~130 s a ~900 s**. No pior caso ela sozinha come metade
do intervalo. O remédio está desenhado e não foi implementado: incremental por
`assignment_id` (**35 s medidos**, contra 227 s da completa), que exige antes o
`piso_de_janela` em `mescla()` — ver #146.

**Correção em 22/09/2026, no mesmo dia (#148).** O risco de banda deixou de ser
hipótese na primeira execução real dentro do grupo. No tick das 16:49, com os três
grupos vencidos, `field-agenda` foi cancelada pelo banco em **603.341 ms**: *"canceling
statement due to statement timeout"* — o teto de 600 s da materialização. A CPU do
processo somou 12 s em 10 min: era espera de rede, não cálculo, que é o que a
repartição acima previa. O grupo `frio` durou 874 s e saiu `falhou`; as outras quatro
queries dele passaram, e o arquivo de `field-agenda` ficou o anterior (intacto — a
falha é na busca, antes de qualquer escrita).

Consequência prática: nos dias de banda ruim, o grupo `frio` paga ~600 s de busca
cancelada a cada 30 min e acende `falhou` na saúde, com o resto do grupo em dia. Não
tirei `field-agenda` do grupo — é decisão com custo dos dois lados (20 dias de dado
velho, que era o defeito deste achado, contra uma consulta pesada repetida no banco
de produção). O remédio de verdade continua sendo o incremental por `assignment_id`.

---

## #146 — A carga incremental congela a coluna calculada da linha velha e **zera a da nova**, e nada erra alto

**22/09/2026**, achado ao desenhar o incremental de `field-agenda`.

O comentário do ramo incremental de `materializa()`
(`tools/snapshot/src/index.ts`) afirmava:

> *"`linhasAntigas` já tem qualquer coluna calculada de execuções passadas;
> `materializaColunas` roda de novo sobre o conjunto inteiro logo abaixo, então elas
> saem recalculadas também — mesma garantia de sempre: todo o arquivo compartilha o
> mesmo `AGORA`."*

**Isso é falso, e o estrago é duplo.** `mescla()` devolve um conjunto MISTO: as linhas
antigas vêm de `le()`, que as entrega com a calculada preenchida sob a chave
normalizada; as novas vêm da busca, sem nenhuma. Medido com uma antiga e uma nova:

```
sem apagar   valor=3 DOBRO=999 (o valor VELHO)   |   valor=5 DOBRO=null
apagando     valor=3 DOBRO=6                     |   valor=5 DOBRO=10
```

1. **A linha antiga mantém o valor de antes** — `columnValue` devolve o que já está na
   linha sem reavaliar (`evaluator.ts`: `if (ck in row) return row[ck]`). Fatal para
   `Status SLA`, que é função de `NOW()`: "Dentro do Prazo" congelaria para sempre.
   É a única coluna de `FIELD AGENDA` que toca relógio (1 ocorrência de `NOW()` na
   spec, conferida).
2. **A linha NOVA sai `null`**, e este é o pior. `Dataset.adotaTabela` monta as
   colunas físicas como a **união** das chaves de todas as linhas: basta UMA linha
   antiga trazer `dobro` para a coluna virar física, e aí o avaliador devolve BLANK
   para toda linha que não a tenha.

**Por que ninguém viu.** O guarda de `adotaTabela` (*"a chave 'DOBRO' não está
normalizada"*) parece cobrir isto e não cobre: ele pega a chave de EXIBIÇÃO, e `le()`
devolve a NORMALIZADA. Com a chave certa, o defeito passa calado.

**Não produziu número errado em produção** porque nenhuma query roda com
`incremental: true` — os três grupos de `refresh.yaml` trazem `incremental: false`.
Era defeito **latente** na única política que existe (`protocolos-produtividade`, 3
colunas calculadas, uma delas citando `NOW()`/`TODAY()`), e `incremental.yaml`
descreve ligá-la como *"barato"*. **Não é: ligar hoje acende isto.**

### O conserto

`esqueceCalculadas()` (`packages/snapshot/src/colunas-calculadas.ts`) apaga, de
**todas** as linhas, o valor gravado de toda coluna materializável — nas duas formas
de chave, porque `materializaColunas` grava as duas e apagar só uma deixaria a outra
reabastecendo a primeira. Chamado no ramo incremental de `materializa()`, logo depois
de `mescla`.

**Apagar de TODAS, não só das antigas** — deixar a coluna em qualquer linha basta para
zerar as outras.

Recalcular tudo é mais caro que reaproveitar, e é deliberado: **correto primeiro**.
Reter o que não mudou continua possível e agora tem base segura, mas exige distinguir,
coluna a coluna, o que é função do relógio (`Status SLA`) e o que é por partição
(`RankDataProtocolo`/`RankAtualProtocolo`, por `protocolo` — meia partição dá Rank
errado e calado). Reter sem essa distinção é o congelamento que este conserto desfaz.

**4 testes novos** em `packages/snapshot/test/colunas-calculadas.test.ts`, um deles
documentando o comportamento errado para que o conserto tenha contra o que ser medido.

---

## #147 — Um refresh de QUALQUER tabela jogava fora o dataset de TODAS as páginas: a chave da resposta era por página desde 09/09, o dado carregado não

**Trabalho de 21–22/09/2026, registrado em 22/09.** O código ficou pronto e testado na
árvore, sem achado escrito — este é o registro. **Os números abaixo são os que a sessão
de 21/09 mediu e deixou nos comentários** de `servidor.ts` e `worker-calculador.ts`; não
foram remedidos hoje.

**O defeito.** `carimboDaPagina` escopa a chave do cache de RESPOSTA por página desde
09/09: um refresh de tabela que a página não lê não a invalida. As duas camadas de baixo
não acompanharam. `Servidor.carrega()` comparava `identidadeAtual()` — global — e fazia
`carregadas.clear()`; a worker recebia a mesma identidade global e fazia
`cacheDeCarga.clear()`. Resultado: qualquer tabela rematerializada esvaziava o dataset
de TODAS as páginas, em TODAS as threads.

```
mudanças de carimbo, API no ar sem ninguém na tela ..... 4 em 6 min (1 a cada 1,5 min)

visao-geral   servida do cache ...................      2 ms
              recalculada, tabelas em memória ....    219 ms   <- o cálculo
              recalculada, relendo o disco .......  2.250 ms   <- o que o descarte cobrava
```

~90% do custo de uma página "fria" era releitura de disco que a invalidação não
precisava causar, e quem pagava era a próxima pessoa a abrir qualquer página.

**O conserto.** `identidadeDaPagina(dash)` — o carimbo das tabelas que AQUELA página lê,
mais o dia — substitui a global nos dois lados: `identidadeDasCarregadas` (thread
principal) e `identidadePorPagina` (worker) guardam uma identidade por página, e só a
página cuja identidade avançou é descartada. **O dia continua global** de propósito: a
meia-noite muda a identidade de todas, que é o que as 32 chamadas a `TODAY()` exigem.
Página de dependência indeterminada cai na identidade global — na dúvida, invalidar
demais é seguro.

### Duas coisas que o descarte global escondia, e que escopar teria destampado

1. **`aoTabelaMudar` não limpava `cacheValoresDistintos`.** Não aparecia porque a
   vassoura global passava a cada 1,5 min. Sem ela, a lista de uma segmentação
   envelheceria sem prazo: cidade nova entra no dado e nunca aparece no seletor. Os dois
   caminhos de invalidação passaram a chamar a MESMA função (`esqueceAPagina`, uma em
   cada lado), e a chave dos valores (`chaveDeValores`) passou a carregar o frescor da
   página — a rota `/valores` lê o mapa ANTES de `carrega()`, então sem o frescor na
   chave um acerto nunca passaria por verificação nenhuma.
2. **O `clear()` global era também o único limite de memória de `carregadas`.** Escopar
   tirava o limite junto. `guardaCarregada` poda por ordem de inserção com
   `TETO_CARREGADAS = 6`, o mesmo número de `TETO_CACHE_POR_WORKER`.

**6 testes novos**: 4 da chave de valores (`servidor.test.ts`) e o par em
`cache-de-carga-worker.test.ts` — refresh de tabela que a página NÃO lê a deixa de pé, e
refresh de tabela que ela LÊ a derruba. O par só vale junto: sem o segundo, apagar a
invalidação inteira passaria no primeiro.

**Suíte: 2.126 passando** (2.116 → 2.126: estes 6 e os 4 do #146).

---

## #148 — Uma stack Docker de 09/09 religou sozinha no boot e passou o dia regravando o `snapshot/` com as specs de 09/09, por cima do host

**22/09/2026.** A plataforma do host estava fora do ar (ver #149) e, mesmo assim,
`/api/saude` na porta 80 respondia — com **16 das 23 queries em `falhou`** e as 14
páginas em **409**. Quem respondia não era a plataforma do repositório: era a stack de
`docker-compose.prod.yml` (+ `docker-compose.local.yml`), subida pelo Docker Desktop no
boot, às 08:45, por causa do `restart: unless-stopped`.

```
imagem api ......... 10/09/2026 09:00      container criado 10/09
imagem refresh ..... 09/09/2026 13:18      container criado 09/09
último commit ...... 21/09/2026 11:05
```

O `snapshot/` do host entra nela como volume **com escrita**. O container `refresh`
rodava a cada 15 min com o código e as **specs de 09/09**:

1. materializava as queries do seu grupo e gravava o arquivo em **formato 1** — o
   formato 2 entrou em 15/09 (`1f55b22`);
2. no passo seguinte, congelar as calculadas, lia um arquivo que o host tinha escrito
   em formato 2 e morria: *"formato de snapshot 2, esperado 1"*. **18 falhas seguidas.**

A falha era no SEGUNDO passo, então o primeiro já tinha escrito. Quando parei a stack,
**16 dos 30 arquivos** em disco estavam em formato 1, saídos de specs anteriores a
consertos de 15–21/09 — telefonia do #125, os 46→5 e 56→1 passos de M, o TRIM de
`f8f2230` em `alocacao-patrimonio`, `base-categorias-field` e
`instalacoes-reincidentes`. Tinham idade zero e conteúdo de 13 dias antes.

**Não foi só hoje.** O log do container, com data:

```
09/09  14 ciclos      15/09   9 ciclos, 13 grupos falhando
10/09  26 ciclos      16/09  16 ciclos, 20 grupos falhando
11/09  19 ciclos      22/09  18 ciclos, 53 grupos falhando
```

Nos dias em que o Docker Desktop subiu, a stack subiu junto. **Em 15, 16 e 22/09 ela já
estava incompatível com o formato do host e escrevia junto com ele** — são dois
agendadores no mesmo `manifesto.json`, que é exatamente o que `DEPLOY.md` §2.2 proíbe.
Achado de 15 e 16/09 que dependa de ter lido o `snapshot/` naqueles dias pode ter lido
arquivo escrito pela imagem velha. **Não reavaliei cada um**; fica registrado para quem
voltar a eles.

A exposição, além do dado: a API do container rodava com `SEM_LOGIN=1`, escutando em
`0.0.0.0:80`.

### O que foi feito

* Os quatro containers foram parados com `docker stop`. Com `unless-stopped`, container
  parado à mão **não** volta no boot seguinte.
* O `snapshot/` foi refeito pelo caminho da própria plataforma — um tick de
  `npm run refresh` com os três grupos vencidos (1.260 s). **22 das 23 queries**
  rematerializadas com o código de hoje e as calculadas recongeladas; conferido
  depois: **30 de 30 arquivos em formato 2**. A que falhou foi `field-agenda`, por
  `statement_timeout` (ver a correção no #145) — o arquivo dela continuou sendo o das
  13:26, que o host gravou com as specs de hoje; a imagem velha nunca escreveu nessa
  query.
* `docker-compose.prod.yml` ganhou `pull_policy: build` em `api`, `refresh` e
  `snapshot-diario`: `up` sem `--build` passa a reconstruir, em vez de reaproveitar a
  imagem que houver.

**O que o `pull_policy` não cobre**, e está escrito no cabeçalho do compose: o boot não
passa por `up`. Numa estação de trabalho, quem sobe a stack de container para testar
tem de derrubá-la (`down`) antes de voltar ao `npm start`. A defesa de código que
faltou — um materializador recusar escrever num `snapshot/` com formato mais novo que o
dele — só protegeria a PRÓXIMA troca de formato (a imagem de 09/09 não a teria), e não
foi feita.

---

## #149 — `0xC0000409` não é estouro de heap nem `abort()` do Node, e a morte da API passou a deixar o motivo

**22/09/2026.** A API do host morreu às 10:35, depois de 21,9 h no ar, e ninguém a
reergueu: seis horas de plataforma parada. É a quarta morte com o mesmo código:

```
18/09 13:21  3221226505  depois de 85 s
19/09 00:28  3221226505  depois de 7,1 h
21/09 13:50  3221226505  depois de 1,4 h
22/09 13:35  3221226505  depois de 21,9 h
```

O #144 anotou esse código como *"`abort()` do próprio Node"*. **Medido, não é.** Neste
Node (v24.15, Windows), lançando o filho por `spawn` como o `npm start` faz:

```
estouro de heap (--max-old-space-size=24) ....... código 134
process.abort() ................................. código 134
exceção não tratada ............................. código 1
worker estourando resourceLimits ................ o processo SEGUE (ERR_WORKER_OUT_OF_MEMORY)
```

Nenhum caminho do Node dá `0xC0000409`. O código é `__fastfail` do Windows — um
`abort()` NATIVO (asserção de C/C++, CRT) que passa por fora do tratamento do Node. A
hipótese mais óbvia para uma morte depois de 21,9 h, "o heap encheu", **cai**: estouro
de heap sairia 134. O Log de Eventos do Windows não ajudou — nenhum evento 1000/1001 de
`node.exe` desde 17/09.

**E não havia como saber mais**, porque o motivo de um abort nativo vai para o stderr
(`Assertion failed: …, file …, line …`), e o stderr da API era herdado: existia só no
terminal de quem subiu. O `npm-start.log` da tarefa agendada parou em 21/09 10:50 — as
subidas seguintes vieram de outro lugar.

### O que mudou

`tools/subir/src/diagnostico.ts`, ligado em `tools/subir/src/index.ts`:

* **A API sobe com `--report-on-fatalerror`**, relatório em `snapshot/diagnostico/`.
  Pega o estouro de heap — medido: `trigger: "OOMError"`, pilha JS e estatística de
  heap. Não pega `__fastfail`, que mata o processo antes do Node.
* **O stderr passa pelo `npm start` em vez de ser herdado.** Continua saindo no
  terminal igual; os últimos 64 KiB ficam em memória e, se a API morrer com código
  diferente de zero, vão para `snapshot/diagnostico/api-stderr.<quando>.log`. É isto que
  pega o abort nativo.
* **`api-morreu` ganhou `motivo`, `relatorio` e `stderr`**, e
  `npm run refresh:daemon -- --historico` os mostra.

**O cuidado que não pode sair:** o relatório vai com `--report-exclude-env`. O processo
da API carrega o `.env`, e sem a flag a seção `environmentVariables` grava a senha do
banco em texto puro. O teste que prova isto sobe um Node de verdade, planta um valor no
ambiente, estoura o heap e confere que o valor não está no arquivo.

**Dois efeitos colaterais, aceitos de propósito:**

1. `exit` pode chegar antes de o stderr escoar, e a linha que explica um abort é a
   última. O registro espera o fim do fluxo, com teto de 1,5 s (um filho da API pode
   segurar o mesmo pipe por minutos). Nesse intervalo `esperaSaude` chamaria
   `encerra(1)` e cortaria o registro — `registrandoMorte` impede.
2. Se o próprio `npm start` morrer, a API perde o leitor do stderr e cai no erro de
   escrita seguinte, em vez de ficar órfã segurando a porta 3100 sem supervisão.

**O que continua aberto:** a causa. A próxima morte deixa o motivo; esta não deixou.
E nada reergue a API no host — a tarefa do Windows dispara ao fazer logon, e `npm start`
não ressuscita a API, de propósito (#137).

**10 testes novos** (8 em `tools/subir/test/diagnostico.test.ts`, 2 em
`tools/refresh/test/historico.test.ts`). **Suíte: 2.136 passando.**

## #150 — `Qtd Protocolos Base` 32.170 x 10.953 não é divergência nova: o bloqueio de `FIELD AGENDA` não descia para `Status Protocolo Dia`

**25/09/2026.** A paridade ao vivo (`npm run powerbi`) apontou `DIFERE` em `Qtd Protocolos Base`
(agendamento-field: 32.170 no Power BI x 10.953 aqui) e em `Protocolo` (relatorio-do-mes: 36.513
x 12.997) — fator de ~2,9x, com cara de achado novo. Não é. A medida é
`DISTINCTCOUNT('Status Protocolo Dia'[protocolo])`, e `Status Protocolo Dia` é um `DISTINCT`
sobre `FIELD AGENDA`, bloqueada em `paridade-janela.yaml` desde 25/08 porque as duas
definições diferem (o nosso SQL filtra região e título de relato; o modelo publicado não) —
remedido em 18/09: 2,7x de linhas. É a mesma divergência vista de outra tabela.

**Dois defeitos em `tools/powerbi/src/janela.ts`:**

1. Bloqueio não herdava. `carregaJanelas` passa a estender o bloqueio a toda tabela cujo
   `table_dax` cite uma bloqueada (transitivo; coluna calculada não conta; janela declarada
   não salva). Nas specs de hoje herdam `Status Protocolo Dia` e `calendar` (ver o fim desta entrada).
2. `planoDeAgregacao` buscava a entidade sem normalizar, contra chaves em maiúsculas. Tabela
   de nome em caixa mista (`Status Protocolo Dia`, `Base Categorias Field`) nunca casava:
   agregação sobre ela saía sem janela e sem bloqueio. **Efeito:** agregações de
   `Base Categorias Field` passam a ser perguntadas COM o recorte declarado — o número
   do Power BI pode mudar na próxima rodada, e é o certo.

**Não confirmado:** que o `Protocolo` de relatorio-do-mes é agregação sobre `Status Protocolo
Dia` — o fator bate, mas a próxima rodada de `npm run powerbi -- --pagina=relatorio-do-mes`
é que diz (tem de sair `JANELA`).

**5 testes novos** em `tools/powerbi/test/janela.test.ts`. **Suíte: 2.141 passando.**

**Confirmado no mesmo dia** (`npm run powerbi -- --pagina=relatorio-do-mes`): `Protocolo` saiu `JANELA`, mas
via `calendar`, e não via `Status Protocolo Dia`. Apesar do nome, `calendar` é `DISTINCT` de (protocolo,
data) sobre `FIELD AGENDA`, não um calendário. São duas tabelas herdando, e não uma. As medidas
da página saíram com os mesmos 12 vereditos de antes: a herança não tirou nenhuma medida do jogo.

## #151 — PROTOCOLOS INSTALADOS 68.533 x 29.962: a diferença inteira é 2025, que as nossas alocação e troca cortam

**25/09/2026, medido ao vivo no modelo publicado** (Execute Queries, só agregados):

```
'PROTOCOLOS GERAL'          Power BI     nós
  linhas                       96.589   96.631
  DATA INSTALAÇÃO preenchida   68.533   29.962
    com ano 2025               38.620        0
    com ano 2026               29.913   29.962   <- bate (0,16%, horário de carga)
  DATA ALOCAÇÃO mínima     2025-01-02
```

**Causa:** os cortes de data não são os mesmos entre as três queries daqui. `protocolos-geral`
corta em `a.created >= '2025-01-01'`, mas `alocacao-patrimonio` (`plis.out_date >= DATE_TRUNC('year',
CURRENT_DATE)`) e `troca-endereco` (`DATE(r.final_date) >= DATE_TRUNC('year', CURRENT_DATE)`) só
trazem 2026. Protocolo de 2025 fica sem DATA INSTALAÇÃO aqui. No modelo publicado, a alocação
vai até 2025-01-02, então lá ele acha.

**A extração também corta em 2026** (`plis.out_date > '01/01/2026'` em
`QUERIES-DASHBOARD-INSTALACAO/sql/alocacao-patrimonio.sql`). Ou seja: a reimplementação é
fiel à extração, e o modelo publicado tem hoje outro corte. Isso fecha a pergunta aberta de
09/09 (28k x 66k): não era refresh antigo nem ramo desconhecido.

**Não corrigido de propósito:** alinhar é decisão de negócio e de custo de carga (#148, "corte
escrito onze vezes" em PERGUNTAS-NEGOCIO #12). Pendente com o Erick.

## #152 — alocação e troca alinhadas em 2025: PROTOCOLOS INSTALADOS vai de 30 mil para 68,7 mil (Power BI: 68,5 mil)

**25/09/2026, decidido pelo Erick** depois do #151. `alocacao-patrimonio` e `troca-endereco`
passam a cortar em `'2025-01-01'`, o mesmo literal de `protocolos-geral`, em vez de
`DATE_TRUNC('year', CURRENT_DATE)`. A costura de `troca-endereco` em `realtime-poll.yaml` acompanha
(o `de:` é texto literal do SQL; conferido que continua casando).

**Medido no dbVoalle** (READ ONLY, a mesma união de três ramos do #151):

```
          linhas aloc   linhas troca   instalados   tempo
  antes        25.910          5.558       30.021   14,0 s
  depois       60.545         11.634       68.732   11,5 s    <- Power BI 68.533 (carga das 14:09)
```

Carga 2,3x maior em linhas nas duas tabelas, o que é pouco (são pequenas), sem custo de tempo.
Também desarma a bomba de janeiro de 2027: com o corte no ano corrente, a alocação passaria a
trazer só 2027 e os instalados de 2025–2026 sumiriam.

**Armadilha evitada:** o comentário da mudança fica em linha PRÓPRIA. Posto no fim da última
linha do `sql:` (a de alocação), ele comentava o `)` de quem embrulha a query como subconsulta —
medido: erro de sintaxe na primeira sonda.

**Fora do escopo, de propósito:** os outros cortes no ano corrente (`protocolos-produtividade`,
`protocolos-auxiliares`, `instalacoes-reincidentes`, `reincidencia`, `retorno-prioritario`,
`tecnicos-auxiliares`, `base-categorias-field`, `protocolos-telefonia`, `incremental.yaml`,
`realtime-poll.yaml`) têm a mesma bomba de 2027, e fica com o Erick decidir (PERGUNTAS-NEGOCIO
#12). A tela só muda depois da próxima carga das duas queries. **Suíte: 2.141 passando.**

## #153 — primeira subida da stack no Docker local (25/09): a API nunca tinha subido pelo compose, e a autonomia funciona

Etapa 0 de `docs/PLANO-AUTONOMIA.md`, com o `npm start` parado (regra 5).

**Dois defeitos impediam a stack de subir — os dois de empacotamento, nenhum de código:**

1. `api` e `refresh` não tinham `target:` no compose, e o último estágio do `Dockerfile` é o
   `cron` (desde cf39f4f, 10/09). As duas imagens subiam o entrypoint do cron: a API reiniciava
   em laço com exit 127. No Portainer seria igual. Corrigido com `target: runtime` (3aa0b1e).
2. Com `core.autocrlf=true`, `docker/cron/entrypoint.sh` e o crontab iam para a imagem com CRLF
   (`#!/bin/sh\r` → "not found"). Num clone Linux não aparece; em build a partir do Windows,
   sempre. Corrigido com `.gitattributes` (LF em `*.sh`, `docker/cron/*`, `Dockerfile`).

**Medido depois do conserto:**

| teste | resultado |
|---|---|
| API morta por SIGKILL vindo de fora do container | voltou `healthy` em ~8 s (`restart: unless-stopped`) |
| `docker desktop restart` (≈ reboot do host) | os 5 containers de volta em 21 s, `/api/saude` 200 pelo proxy |
| cron do `snapshot-diario` | `cron -f` de pé, `.env.cron` gerado |
| 1º ciclo do daemon | 650 s; `quente` OK; `medio` e `frio` FALHOU |
| memória (amostra a cada 15 s no ciclo) | pico `refresh` 3,87 GB, `api` 2,84 GB; **somado 4,94 GB** contra 28,5 GB de `mem_limit` |

**Armadilhas do próprio teste:** `docker kill` conta como parada manual e o `unless-stopped`
não religa — não serve para simular queda. E `SIGTERM` de dentro do container é ignorado: a
API é PID 1 e não registra handler para ele, então `docker stop` espera os 10 s e mata. A
queda de verdade foi simulada com `docker run --pid=host ... process.kill(<pid>, 'SIGKILL')`.

**A falha de `medio`/`frio` tem uma causa só:** `apuracao-premiacao`, `capacidade-equipe` e
`protocolos-produtividade` param em `GOOGLE_APPLICATION_CREDENTIALS aponta para ... que não
existe` — o `.env` traz o caminho do host e o arquivo não é montado no container. Todas as
outras queries carregaram. Enquanto isso não for montado, o daemon roda os dois grupos
inteiros de novo a cada 15 min (~9 min de carga por ciclo) para falhar igual — o caso
exato da etapa 1 (espera crescente).

## #154 — tetos de memória do compose trocados pelo medido: 28,5 GB → 18,5 GB, e o `refresh` ganhou folga

Os `mem_limit` somavam 28,5 GB contra 4,94 GB de pico somado medido (#153). Dois estavam errados,
não só altos: o `refresh` autorizava 8192 MB de heap num teto de 8g (zero folga de não-heap: quem
matava era o cgroup, sem mensagem) e o `snapshot-diario` (14g, `--memoria=12288`) vinha de
"protocolos-geral precisa de 12 GB", que caiu em 09/09 (af82774).

| serviço | antes | depois |
|---|---|---|
| `api` | 6g | 6g — contrato medido de 04/09, travado em `piscina-workers.test.ts` |
| `refresh` | 8g, pai 8192, filho 8192 | **6g**, pai 1024, filho 4096 (`REFRESH_MEMORIA_MB`, novo) |
| `snapshot-diario` | 14g, `--memoria=12288` | **6g**, `--memoria=4096` |

**Medido com os tetos novos (ciclo de 21:10, 507 s):** as 13 queries de `medio`/`frio` que não
dependem da credencial Google carregaram, `protocolos-geral` e `field-agenda` inclusive; nenhum
OOM, zero reinício; pico do `refresh` 3,57 GB, somado 4,85 GB. `protocolos-geral` levou 107 s
contra 73 s no ciclo anterior com 8 GB — pode ser pressão de GC com heap menor ou variação do
banco; uma amostra não separa as duas. Se repetir, subir o filho para 5120 cabe no teto.

`apps/api/test/imagem-runtime.test.ts` trava agora o contrato (heap do filho + do pai + 1 GB de
folga ≤ `mem_limit`, e o mesmo para o cron) no lugar da asserção literal `mem_limit: 8g`.
Conferido que o teste falha com o filho de volta em 8192. O `npm start` não muda: sem
`REFRESH_MEMORIA_MB`, o padrão de `executa-grupo.ts` (8192) segue valendo. Suíte: 2.142 passando.

## #155 — tipos, CI e o que só quebrava no Linux (27/09)

**Nada conferia tipo fora de `apps/web`**: o Node executa `.ts` apagando as anotações. Com um
`tsconfig.json` strict na raiz, o back-end (~57 mil linhas) tinha 39 erros — pouco para quem
nunca rodou o verificador, e três eram defeito de verdade em ferramenta: `tools/probe/src/gsheets.ts`
usava `PLANILHAS` (inexistente, quebrava ao rodar) e chamava `explica()` sem o e-mail;
`reaquecimento-pos-evento.ts` passava um argumento que `reaquece()` não tem mais. O resto era
tipo que mentia (`Servidor.opts` como `Required<>` com quatro `estadoDo*` opcionais de fato,
`isBlank` sem ser type guard, `ioredis` pelo default). Agora `npm run typecheck`: 0 erros.

**O CI (`.github/workflows/ci.yml`) foi simulado antes de existir**, num `node:24` limpo a
partir de `git archive` — sem `.env`, sem `snapshot/`. `npm ci` e tipos verdes; **4 testes
vermelhos que o Windows nunca mostrou**:

| teste | causa |
|---|---|
| `porta.test` linha de comando acentuada | o `ps` de contêiner sem locale troca acento por `?`; agora lê `/proc/<pid>/cmdline` |
| `reaquecimento.test` dois eventos seguidos | o leitor de SSE do teste supunha um evento por `read()` |
| `manifesto`/`status` "não corrompe leitura aberta" | provam a semântica de rename do Windows; `skip` fora do `win32` |

Depois: Linux 2.140 + 2 pulados, Windows 2.142, 0 falhas.

**O job de imagens constrói pelo compose** (`docker compose -p ci ... build`) e confere com
`tools/ci/confere-imagens.sh` que cada serviço recebeu o estágio certo. Um `docker build
--target runtime` na mão teria escondido o defeito do #153 (compose sem `target`). Provado:
tirando o `target` da `api`, o script sai 1 com "a imagem não é a runtime". **Ainda não rodou
no GitHub** — nada foi enviado.

## #156 — o refresh para de insistir no que falha, e a tela aguenta a API sumir por segundos (27/09)

Itens B e C da avaliação de 27/09.

**B — espera crescente (`tools/refresh/src/tick.ts`, `proximaTentativa`).** Uma falha: tenta no
próximo ciclo, como antes (soluço se resolve ali). Da segunda seguida em diante espera
`intervalo × 2^(falhas-1)` desde a última tentativa, teto 4 h; o primeiro sucesso zera. Vale
no daemon (Docker, via `estaVencido`) e no agendador da API (`npm start`, no relógio de
cadência); `POST /api/refresh` passa por cima. Cada adiamento é `grupo-adiado` no histórico
e sai no `--historico`. Com a credencial Google ausente do #153, `medio` a 20 min passa de 3
cargas por hora para 20 → 40 → 80 → 160 → 240 min entre tentativas. Um teste antigo travava a
política velha ("vencido mesmo com 3 falhas") e foi reescrito, não apagado.

**C — `pega()` da tela (`apps/web/src/api.ts`).** Teto de 90 s por GET (antes: nenhum — API
travada = "carregando" eterno) e nova tentativa com espera de 1/3/6 s só para rede caída e
502/503/504 do proxy (~10 s, cobre o reinício de ~8 s medido no #153). 500, 4xx, teto
estourado e cancelamento não repetem. O teto vira erro comum, nunca `AbortError`, porque a
tela engole cancelamento em silêncio. Conferido com `fetch` real contra servidor local:
503, 503, 200 → dado em 3 pedidos; servidor que não responde → "não respondeu"; abort → `AbortError`.
Requer `AbortSignal.any` (Chrome 116+, Firefox 124+, Safari 17.4+).

Os testes novos (6 do refresh, 6 do `pega`) foram conferidos por mutação: com a regra
desligada, falham. Suíte: 2.153 passando; typecheck 0 erros.

## #157 — a API desliga em ordem, se derruba quando trava, e a credencial Google chega ao contêiner (27/09)

Itens D e E da avaliação de 27/09.

**A API era o PID 1 do contêiner, e isso anulava duas coisas.** O Linux não entrega ao PID 1
sinal sem tratador: sem tratar SIGTERM, `docker stop` esperava a cortesia e matava. E um
vigia dentro do processo não conseguiria se matar. `init: true` no compose (`api`, `refresh`,
`snapshot-diario`) põe o `tini` no PID 1 — conferido: `/proc/1/cmdline` = `docker-init`.

**Desligamento** (`apps/api/src/desligamento.ts`): SIGTERM/SIGINT param vigia, agendador,
poller, aquecedor, HTTP (3 s de folga para pedido em curso, depois corta — o SSE nunca fecha
sozinho) e a piscina; teto 8 s; segundo sinal sai na hora; uma linha antes de cada passo.
Medido: `docker stop` em 0,5–0,8 s com saída 0 (antes: SIGKILL).

**A armadilha do teste: o Compose v5.1.3 desta estação criava TODOS os contêineres com
`StopTimeout=1`.** Duas paradas logo depois de um recarregamento de snapshot saíram 137 com os
passos já rodando. Não era o vigia (nenhum `api-travou`, nenhuma linha `[vigia]`), nem OOM
(pico 2,8 de 6 GB) — `docker events` mostrou `kill 15` e, 1 s depois, `kill 9` do próprio
Docker: com pedido do reaquecimento em curso, a folga de 3 s do HTTP passava do 1 s que o
Docker dava. `stop_grace_period: 15s` agora é explícito nos três serviços, e o contrato do
compose (`imagem-runtime.test.ts`) exige mais que os 8 s do teto. O `redis` segue com 1 s
(cache; nada a perder que não se recalcule).

**Vigia de travamento** (`apps/api/src/vigia-travamento.ts` + worker): o laço principal
carimba um batimento por segundo em memória compartilhada; a worker confere e, parado além de
`VIGIA_TRAVAMENTO_S` (compose: 120), grava `api-travou` no histórico e em `diagnostico/` e
mata o processo — o `restart` religa. Se o próprio vigia atrasou, foi suspensão da máquina,
não trava (19/09). Desligado no `npm start`. Provado com processo real (Windows e Linux): laço
preso num `while` morre em ~2 s com o motivo gravado; laço saudável além do limite não morre.

**Credencial Google (E):** montada só-leitura em `/run/secrets/google-sa.json` a partir de
`GOOGLE_CREDENCIAL_HOST`; `GOOGLE_APPLICATION_CREDENTIALS` aponta para lá; sem a variável o
compose recusa subir. Conferido no contêiner: legível, escrita recusada. **Ciclo completo às
00:53: `quente`, `medio` e `frio` OK** — `apuracao-premiacao`, `capacidade-equipe` e
`protocolos-produtividade`, que falhavam desde o #153, carregaram.

## #158 — `servidor.ts` perde 462 linhas sem mudar comportamento (27/09)

Item F da avaliação de 27/09, primeira etapa. O arquivo tinha 2.694 linhas: a classe
`Servidor` (~2.100), a interface de opções (~200) e utilitários soltos. Saiu o que tinha
pouco acoplamento, para módulos próprios em `apps/api/src/`:

| módulo | o que é | linhas |
|---|---|---:|
| `opcoes-servidor.ts` | `ServidorOptions` (só tipos) | 206 |
| `http-util.ts` | `responde`, `leCorpo`, `parseJsonSeguro`, `tokensIguais`, `comStatus`, `inteiro` | 102 |
| `valores-segmentacao.ts` | chave do cache, valores distintos por nível, ordem do seletor | 128 |
| `estatico.ts` | arquivos da tela e `/legado` | 53 |

`servidor.ts` ficou com 2.232 e reexporta o que exportava — nenhum dos 15 importadores
mudou. Conferido: typecheck 0 erros, suíte 2.163 + 1 pulado, e a API real no Docker servindo
`/`, o JS do build, `/legado`, `/api/saude` (200) e o 401 do portão de login; caminho com `..`
codificado dá 404 direto na API (400 já no nginx).

**A armadilha da extração por script:** para podar imports sem uso, a primeira versão tirava
comentários antes de contar — e um `//` com `specs/layout/*.layout.yaml` abria um "bloco"
que engolia código até o próximo `*/`, apagando três imports ainda usados. O typecheck pegou
na hora. A versão final conta sem tirar comentário (erra para o lado de sobrar import) e os
imports falsos foram removidos à mão, conferidos fora de comentário.

**O que fica para a próxima etapa:** `pagina()` (437 linhas) e `carrega()` são o miolo do
cálculo e merecem sessão própria; as rotas de `/auth/*` e o corpo de `/api/saude` são os
próximos candidatos de baixo risco.

**#157, confirmação (27/09):** com `stop_grace_period: 15s`, `docker stop` logo depois de um
recarregamento de snapshot — o cenário que dava 137 — levou 3,6 s e saiu **0**: o passo `http`
usou a folga inteira de 3 s com o reaquecimento em curso, e `docker events` mostrou só `kill 15`.

## #159 — trava de escrita do snapshot: um materializador por vez (28/09)

Etapa 2 de `docs/PLANO-AUTONOMIA.md`. Todo materializador termina em `leManifesto` → mescla →
`escreveManifesto`. A escrita é atômica, mas dois processos juntos são read-modify-write: o
segundo a terminar regrava o índice sem as tabelas do primeiro, sem erro. A fila do agendador
evita isso dentro de um processo; entre processos não havia nada — `refresh`, `snapshot-diario`
das 3h, `npm run snapshot` manual e, no pior caso, `npm start` e Docker no mesmo diretório (#148).

**`packages/snapshot/src/trava.ts`:** `snapshot/.materializando.trava` criado com `wx`, com o
dono (PID, host, desde, comando). O dono renova a hora de modificação a cada 30 s. Quem chega:
PID morto no mesmo host → toma na hora; sem batimento há 10 min → toma (de outro contêiner só o
relógio vale); viva → espera dizendo de quem, até 30 min, e desiste com o caminho do arquivo.
Tomar é `rename` para nome único — de dois que chegam juntos, só um vence. Os filhos (`--uma=`,
as calculadas) herdam por `SNAPSHOT_TRAVA_HERDADA`. Ligada em `tools/snapshot/src/index.ts`
(depois do `--plano`) e em `tools/snapshot/src/calculadas.ts` quando roda sozinha.

**O batimento exigiu tirar um `spawnSync`:** o congelamento das calculadas prendia o laço do pai
pelo tempo todo, e sem laço não há batimento — outro processo poderia achar a trava abandonada
no meio. `congelaCalculadas` virou `spawn` com `await`.

**Medido:** dois processos fazendo 15× ler→somar→gravar cada: com a trava, 30; sem ela, **16**
(14 atualizações perdidas). Ponta a ponta com o materializador real (`feriados`, inline, sem
banco): com a trava segurada por outro processo, ele escreveu "snapshot em uso por PID … —
esperando a vez", entrou 5 s depois, terminou 0 e apagou a trava. Suíte: 2.172 + 1 pulado.

O `snapshot-diario` fica: não tinha como ser removido sem saber se a carga completa noturna
ainda pega alteração retroativa que o incremental perde — mas agora não pisa no `refresh`.

**#159, confirmação no `npm start` real (28/09):** o próximo grupo do agendador (`frio`) rodou
já com o código novo — cada grupo é um processo novo, então não foi preciso reiniciar. Durante
a carga, a trava estava lá com o materializador do grupo como dono; no fim foi apagada;
execuções 8 → 11, falhas 0 → 0.

## #160 — "parado" passa a ser medido pelo intervalo do grupo, e o `/api/saude` diz se está degradado (28/09)

Etapa 3 de `docs/PLANO-AUTONOMIA.md`. A faixa da tela já existia (Marco A6, `aviso-saude.ts`);
as réguas que a alimentavam (`montaStatusDeRefresh`) é que não serviam:

| | antes | depois |
|---|---|---|
| `falhou` | 1 falha do grupo | **2 falhas seguidas** — 1 é soluço, e é da 2ª que a espera crescente começa (#156) |
| `vencida` (query em grupo) | idade > **2 dias** | último sucesso do grupo > **2× o intervalo** (quente 30 min, medio 40, frio 1 h) |
| `vencida` (fora de grupo) | 2 dias | igual |

A query ganhou `grupo` e `paradaDesde`; o `/api/saude` ganhou `degradacao: { degradado, motivos }`,
um motivo por grupo — e **continua 200**: dado parado não se conserta reiniciando a API, e um 503
faria o healthcheck derrubá-la. A faixa diz "dados parados desde dd/mm HH:MM: a, b, c e mais N"
e, com um grupo falhando pelo mesmo erro, o erro uma vez só. A tela passou a buscar a saúde a cada
2 min por conta própria: com o "Auto" desligado ela nunca rebuscava, e uma página aberta nunca
veria o dado PARAR — parado é justamente não chegar evento.

**Pego no dado real no mesmo dia.** Aplicada ao snapshot do `npm start` às 11:19 UTC, a régua nova
disse: os três grupos parados desde ~03:05 UTC. Era verdade — o histórico tem `maquina-suspensa`
de 5h50min (4 suspensões desde a subida); a máquina acordou às 11:17 e o agendador estava
recuperando. **A régua antiga dizia `ok` para as 23 queries**: 8 horas de dado velho sem aviso,
o #129 de novo. Testes novos conferidos por mutação (réguas antigas → 2 falham). Suíte 2.178 + 1.

Aviso para fora (e-mail/Chat) segue esperando o destino.

## #161 — no `npm start` as páginas esfriavam a cada refresh, e a API morta não voltava (28/09)

Relato do Erick: "entrei na plataforma e tive que esperar vários minutos"; "no Docker tudo é
instantâneo". Os números da própria API (`/api/saude` → `realtime.duracoes`, desde 01:50 UTC):
`get_pagina_ms` p50 10 ms e máx **21,5 s**; fila de cálculo até **17,6 s**; e
`primeiro_get_pos_evento_miss` = **9** — nove vezes o primeiro pedido depois de um refresh achou
a página fria.

**Causa:** o `tools/subir` passava SEMPRE `--sem-aquecer` à API. É sobra de 13/08 (`6ebab2b`),
quando a API ainda não tinha aquecedor (veio em 17/08); o `aquecimento.ts` do próprio `subir` já
tinha sido escrito para ESPERAR o aquecedor da API, e a flag o anulava. Sem aquecedor na API não
há reaquecimento pós-evento: cada grupo (15–30 min) deixava as páginas frias. No Docker a API
sobe sem a flag — daí a diferença. Agravantes da manhã: a máquina dormiu 5h50, acordou com 6
grupos seguidos para recuperar, e tinha 1,1 GB livres de 15,7 GB (API 2,4 GB + materializador
3,0 GB + Chrome/Claude/IDE). **Conserto** (`a48a1b4`): a flag só vai quando pedida. Medido: 11
páginas em ≤ 0,01 s; depois do refresh de 12:36, `primeiro_get_pos_evento_miss` 0 → 0.

**No caminho, a API caiu** às 12:11 UTC com `0xC0000409` — a 8ª vez desde 18/09 (#149), as
anteriores com o aquecedor DESLIGADO; causa nativa ainda aberta (o Windows não registrou módulo no
log de eventos). O que doía era outro: o `npm start` não religava, e a plataforma ficava fora até
alguém notar. **Agora religa** (`82587d2`) com `decideRessurreicao` (`supervisao.ts`: 5 tentativas,
5 s → 5 min, 1 min de vida zera). O motivo antigo de não religar — outra instância tomando a porta —
é conferido na hora: porta tomada, não religa. Saída 0 e 2 não religam. `api-religada` no
histórico. Provado derrubando a API à força: de volta em **7 s**.

## #162 — a página abre inteira: sem "carregando…" de visual fora da dobra (28/09)

Print do Erick: faixas de `agendamento-field` em "carregando…" ao rolar, com o id no título.
"Preciso que tudo já esteja carregado"; "pode gastar o que for preciso". A abertura pedia só as 4
primeiras faixas (`N_FAIXAS_EAGER`, ACHADOS #94); o resto vinha por `IntersectionObserver`
(`VisualNaDobra`), e o aquecedor só o adiantava com o filtro de abertura — de propósito, para não
fazer 18 cálculos por passada. Trocar de filtro e rolar caía em cálculo frio.

**Agora `N_FAIXAS_EAGER` = todas** (`cbc5e93`): a abertura pede a página inteira, na chave que o
aquecedor já enche para a abertura e os períodos recentes (`filtrosRecentes`). O corte segue
parâmetro (`idsIniciais`/`idsRestantes(layout, n)`, `Aquecedor.nFaixasEager`) e os testes do
mecanismo passam 4. Medido: `agendamento-field` 26 → **32** visuais na abertura, todas as páginas
em acerto de cache.

**"Todos os filtros" ao pé da letra não cabe:** contados na API local, são **546.791** valores de
segmentação (um filtro por vez, sem combinar) — cliente 74.734, protocolo 96.802, contrato, datas
avulsas. Cada um é um cálculo de página de 1–5 s. O que cabe é a baixa cardinalidade (≤ ~40 valores
por filtro: status, tipo, cidade, equipe, turno, categorias…): ~420 cálculos por passada.

## #163 — filtros de poucos valores pré-calculados, e uma worker sempre livre para quem usa (28/09)

Pedido do Erick: "sempre pré carregue todos os filtros, pode gastar o que for preciso". Dúvida
dele antes de ligar: "esses filtros vão travar a operação… impossibilitando o usuário de usar?".

**Não travar:** a fila da piscina já era por prioridade (interactive > prefetch > warmup), mas
prioridade só ordena o que ESPERA — um cálculo de fundo já despachado não é interrompido, e com as
duas workers ocupadas por aquecimento um clique esperava um cálculo inteiro (fila de 17,6 s, #161).
Agora o fundo usa no máximo `workers − 1` (`processaFila` + `FilaDePrioridade.saiAte`); com uma
worker só não há reserva. Teste com worker lenta: 4 aquecimentos de 400 ms na fila, um clique sai
em < 250 ms; sem a reserva o teste falha ("o fundo só pode ocupar workers − 1").

**Pré-calcular:** "todos" são 546.791 valores (#162) — não cabe. Cabem os de até 40 valores, sem
data (período já é `filtrosRecentes`): depois do `pronto`, o aquecedor pede, para cada valor, a URL
exata do clique — página inteira + filtro de abertura + aquele valor (`aplicaSelecao` troca só a
coluna; `normalizaFiltros` ignora a ordem). Rodada nova (reaquecimento, snapshot novo, `para()`)
encerra a anterior no próximo passo. `AQUECE_FILTROS_ATE` regula (0 desliga).

**Medido no `npm start` real, 12 min depois do aquecimento:** 489 recortes na rodada; amostra de
um valor por filtro em cada página — **41 de 41 do cache, 1–38 ms**.

**O que as mesmas métricas mostram e não pode sumir:** desde o reinício das 13:35 UTC,
`calculo_ms_interactive` máx **133,6 s** (p95 10 s) e `calculo_ms_warmup` máx **304,7 s** (p95 30 s).
Os extremos são dos primeiros minutos, com tudo frio, a página inteira num pedido só (#162) e a
estação com ~1 GB livre. Quente, é instantâneo; frio, nesta máquina, pode ser muito lento. O
servidor do Portainer é o lugar disto.

**E um incidente meu no caminho:** o reinício das 13:24 travou no `vite build` (processo vivo,
2 s de CPU em 10 min, provável `esbuild` órfão do `taskkill /T` anterior) e a API não subiu —
**plataforma fora de 13:24 a 13:35 UTC**. Matar a árvore e subir de novo resolveu em segundos.

## #164 — nunca esperar cálculo numa pergunta já respondida: a última versão pronta sai na hora (28/09)

Print do Erick às 10:59 local (13:59 UTC): `agendamento-field` inteira em esqueleto, "calculando…".
"TUDO TEM QUE ESTAR PRÉ-CARREGADO AO ENTRAR". O histórico explica: o grupo `medio` terminou às
**13:59:00**. A chave da resposta leva o carimbo da página (`carimboDaPagina`) e o dia; o refresh
trocou o carimbo, a resposta pronta sumiu da vista NA HORA, e até o reaquecimento terminar não havia
o que servir — o pedido dele calculou a página inteira a frio (`get_pagina_ms` máx **214 s** naquela
hora). Aquecer mais não fecha isso: a cada refresh reabre uma janela sem nada pronto, e nesta
máquina ela dura minutos.

**O conserto (`b4569ff`):** toda resposta calculada também é guardada numa chave SEM carimbo e sem
dia ("a última pronta desta pergunta", 7 dias; no cache em memória é a mesma referência, não dobra).
Faltou a versão atual e existe a anterior: ela sai na hora (`cache: 'anterior'`, com o `dadoDe`
DELA — a tela mostra a hora do dado que está servindo) e a atual é calculada em fundo, no mesmo
`vooUnico` da chave nova. O aquecedor não recebe a anterior (é ele quem prepara a nova). O
recálculo de fundo vai como `prefetch`: passa na frente do pré-cálculo de filtros que ninguém pediu
e continua fora da worker reservada (#163).

Três testes travavam a política velha ("depois do refresh é `miss`", "a virada do dia invalida",
"o voo não sobrevive ao snapshot") e foram reescritos, não apagados: a anterior sai na hora e o
número novo chega logo depois, num cálculo só — a garantia "não ficar preso no número velho"
continua de pé. Mutação (sem o caminho novo): os três falham.

**Medido no `npm start` real:** no segundo em que o refresh `quente` terminou (14:31:57 UTC), três
páginas pedidas como usuário saíram em **17–34 ms** (`anterior`); 2 min depois, `agendamento-field`
já era `hit` na versão nova. Com o recálculo como `warmup`, `visao-geral` e `diario-instalacao`
ainda estavam na anterior — daí o `prefetch`.

**O que ainda pode esperar:** a API recém-reiniciada (npm start sem Redis: nada em memória por ~1
min; no Docker o Redis guarda, e o carimbo é o mesmo) e uma pergunta nunca feita antes (filtro de
busca novo). **E uma falha intermitente:** numa rodada da suíte, o processo de
`servidor.test.ts` morreu aos 3 s sem teste vermelho (faltaram 67); o arquivo não passa pelo caminho
novo (não troca snapshot no meio), passou 3× sozinho e na suíte seguinte — mesma família da
`0xC0000409` (#149, #161).

**Correção (30/09) ao #161:** as mortes `0xC0000409` entre 18 e 28/09 foram **7**, não 8 (18, 19,
21, 22/09, duas em 25/09 e 28/09, contadas em `snapshot/refresh-historico.log`); as outras duas
do período saíram com código 1. O texto do #161 e a mensagem do commit `82587d2` dizem 8.

## #165 — `field-agenda` incremental: o `piso_de_janela`, e a prova contra a carga completa na mesma hora (01/10)

**01/10/2026.** O remédio desenhado no #145 (incremental por solicitação, "35 s
medidos") e travado no #146 (faltava o `piso_de_janela`) foi feito, medido e ligado
no Docker — só nela. Estado e roteiro em `docs/PLANO-CARGA.md`.

**Por que agora.** A carga completa de hoje levou **375 s** às 12:41 UTC (282 s na
madrugada, 250 s às 13:20). A banda de ~130–900 s do #145 continua valendo: o custo
é rede (~360 MB), não cálculo.

### O desenho, e o que o banco disse antes de escrever uma linha

Lido de `pg_get_viewdef('v_service_desk_slots_productivity_informative')`: a linha
muda por cinco caminhos — `assignments`, `assignment_incidents` (status),
`fsm_attendance_history` (com `lag`/`first_value`/`max` **por solicitação**: um evento
novo muda todas as linhas dela), `reports` e `service_desk_slots`.

- **Duas fontes não têm data de modificação:** `assignment_incidents` (onde mora o
  status) e `fsm_attendance_history` (só datas de evento). Troca de status só é vista se
  `assignments.modified` acompanhar — era o risco a medir.
- **`assignments` e `reports` têm 7 e 8,5 GB e nenhum índice em `modified`.** Por isso
  `alvos` começa nas solicitações que JÁ estão na janela, pelo histórico de atendimento
  (240 MB), e só então olha as datas de cada fonte pelo id (índices de `assignment_id`).
- **Chave `Protocolo`:** 1:1 com a solicitação na janela (22.547 de cada, nenhum
  protocolo com duas). Recortar por solicitação entrega a partição inteira do Rank.
- **Marca:** `Data Criado`, `Inicio relato`, `Fim relato`, `Data Relato` — zero valores
  futuros no arquivo de 01/10. `Prazo SLA` (7.515 futuros) e `Slot Agenda` (1.940)
  fariam `decideIncremental` recusar ("marca no futuro").
- **Cada coluna da marca tem de estar coberta por um ramo de `alvos`.** `mescla` apaga
  como "sumida" a linha antiga com marca na janela que não voltou; se o ramo não a
  trouxer, some meia solicitação. Foi o que pôs `r.beginning_date` (`Data Relato`) no
  ramo 3, que no rascunho olhava só `created`/`modified`.

### O `piso_de_janela`

A completa recorta `begin_date_slot >= CURRENT_DATE - INTERVAL '3 months'`. A
incremental não reentrega quem só envelheceu — sem o piso, a linha ficaria para sempre.
`mescla` agora descarta das ANTIGAS a linha com `Slot Agenda` abaixo do piso ou nula
(`expiradas`); as novas já vieram recortadas pelo relógio do banco. `pisoDaJanela`
reproduz o `CURRENT_DATE` do dbVoalle (`TimeZone = localtime`, -03, medido) e a conta
de mês curto do Postgres (31/05 − 3 meses = 28/02). `costura` erra alto se o SQL deixar
de citar `INTERVAL '3 months'`.

### Ligar só ela

O `frio` tem duas queries com política; `protocolos-produtividade` segue desligada de
propósito. `refresh.yaml` passou a aceitar `incremental: [lista]` (validada contra as
queries do grupo) e o snapshot, `--incremental=a,b`; nome sem política derruba em vez
de ir inteiro calado.

### A prova

Carga completa A às 12:41 num diretório isolado (cópia do `snapshot/`, nunca o da
plataforma). Às 13:20, a partir de cópias de A, incremental e completa **ao mesmo
tempo**, comparadas por protocolo com `npm run probe:compara-incremental` (nova):

```
custo da SQL costurada (sonda custo-incremental --costura):
  janela de 2 dias   41.288 linhas   28,7 s
  janela de 7 dias   75.890 linhas   36,7 s

ponta a ponta: incremental 69,6 s  ×  completa 250,1 s
mesclagem: +42.439 novas, 41.768 substituídas
linhas: 631.803 × 631.803
protocolos: 10.842 iguais de 10.848 — 0 só de um lado
  5  data ultimo play app + fim relato
  1  base + instalador + data ultimo play app + fim relato
(colunas calculadas incluídas; só `Status SLA` fora, por ser função do relógio)
```

**Os 6 são atendimento em andamento entre as duas leituras, não perda:** a diferença é
`Fim relato` nulo de um lado e preenchido do outro (a contagem de nulos dobra entre os
dois arquivos naqueles protocolos), e a incremental seguinte os reentrega porque o
histórico de atendimento deles mudou. **Nenhum status divergiu** — na janela medida,
`assignments.modified` acompanhou toda troca de status. É uma janela; a hipótese
continua sendo a coisa a vigiar (`PLANO-CARGA.md` §4).

`npm test`: 2.197 + 1 pulado; `npm run typecheck` verde. Commit `6eab328`, na
`staging`. No Docker, a primeira rodada (13:29 UTC) é completa — o arquivo era de antes
da política, sem marca —; a incremental começa na seguinte.

### No Docker: as seis primeiras rodadas (etapa 1.1b, 01/10)

Lidas às 18:01 UTC com
`docker logs --timestamps --since 2026-10-01T13:00:00Z dev_reactjs_installationdashboardia-refresh-1 2>&1 | grep -E "field-agenda… ok|incremental: \+"`:

```
UTC    modo         tempo   novas   substituídas  sumidas  mantidas  linhas
13:34  completa    281,8 s      —        —           —         —     632.040
14:09  incremental  66,8 s  44.035   43.312          0    588.728    632.763
14:59  incremental  46,4 s  45.532   44.817          3    587.943    633.475
15:39  incremental  51,5 s  46.299   45.820          0    587.655    633.954
16:31  incremental  78,5 s  46.906   46.419          0    587.535    634.441
17:09  incremental  60,0 s  47.478   46.906          0    587.535    635.013
18:00  incremental  57,5 s  48.126   47.505          0    587.508    635.634
```

**Critérios da 1.1b atendidos:** todas abaixo de 90 s (46–79 s, contra 282 s da
completa) e linhas subindo ~500–700 por rodada, o crescimento do dia — nenhum salto.
**A conta fecha exata em todas:** `linhas = mantidas + novas`, e as substituídas de uma
rodada são as novas da anterior mais o que saiu das mantidas (17:09 → 18:00: 47.478 + 27
= 47.505, e as mantidas caem 27). Nenhuma `expirada da janela` ainda: a primeira vem
quando o piso virar o dia.

O que a série mostra e não é defeito: as novas crescem ao longo do dia (44 → 48 mil),
porque a marca é por dia (`marca até 2026-10-01`) e a janela reentrega tudo o que mudou
desde o piso. O intervalo real entre rodadas foi 38–52 min, não os 30 do `frio`; a causa
não foi investigada.

## #166 — VISÃO PRODUTIVA em tempo real: onde está o custo da `field-agenda`, medido (02/10)

**Pedido do Erick (02/10):** "visão produtiva tem que ser realtime", com escolha explícita
pelo poller de segundos, não por encurtar o grupo do refresh. Medido no banco de produção,
somente leitura, antes de escrever código.

**A costura incremental atual não serve para poller.** Com `:desde` de 1 minuto a 10
minutos, ela custa **11–12,7 s por volta, fixos**: 28 linhas (1 min), 2.556 (10 min),
7.124 (1h20). O preço não está no volume. Ele vem de duas partes:

| parte | custo | por quê |
|---|---|---|
| achar quem mudou (`alvos`, 4 ramos) | ~2 s | `assignments` sem índice em `created`/`modified`: seq scan de 830 ms |
| buscar as linhas pela view | ~5 s, **igual para 1 id ou 400** | `v_service_desk_slots_productivity_informative` calcula as janelas sobre 459 mil linhas de `fsm_attendance_history` antes de qualquer filtro; `assignment_id = ANY(...)` não entra na view |

**Os dois cortes que resolvem, medidos:**

1. **Busca com a view reproduzida e o recorte antes das janelas.** Todas as partições da
   view (`first_value`/`lag`/`min`/`max`), o `GROUP BY`, o `DISTINCT ON` e o `EXISTS`
   são por `reserved_assignment_id`, então filtrar por solicitação nas duas leituras de
   `fsm_attendance_history` dá o mesmo resultado. **Paridade: 6.736 × 6.736 linhas, 0
   divergentes** contra a view, para 400 solicitações. Custo: 1 id 67 ms, 400 ids 2,6 s
   (a view: 5 s e 7,8 s). O texto da view é lido do banco (`pg_get_viewdef`) e recortado
   por âncora — se o Voalle mudar a view, a âncora some e erra alto.
2. **Detecção pelo índice de `id`.** As solicitações da janela viram um array
   (`MATERIALIZED`) e cada ramo usa `= ANY(ids)` no índice da própria tabela, no lugar do
   `JOIN` que o planejador resolvia com seq scan: **~0,7 s** a quente (2 s antes).

**Por volta:** ~0,7 s sempre + 0,1–0,5 s quando há mudança (28–36 solicitações por
minuto às 9h). A cada 15 s, o banco fica ocupado ~5–8% do tempo com isto, contra ~75%
se fosse a costura atual.

**Cuidado de fuso, que custou uma medida:** `:desde` com `Z` contra `timestamp` sem fuso
ignora o `Z` — `2026-10-02T12:20:00Z` vira 12:20 **local**, três horas no futuro, e a
busca volta 0 linhas sem erro. Passar hora local, sem sufixo.

**O que falta para a tela, e não está feito:**

- o delta do poller guarda **uma linha por chave** (`porChave`); a FIELD AGENDA tem várias
  por protocolo (slot × relato) — tem de virar grupo por chave, como a `mescla` já faz;
- as 7 colunas calculadas da FIELD AGENDA vêm prontas do disco. Todas são da própria linha
  ou do protocolo (`RankDataProtocolo` filtra pelo mesmo protocolo), e o poller traz o
  protocolo inteiro — então `materializaColunas` sobre as linhas novas dá o mesmo valor;
- `Status Protocolo Dia` é congelada em disco: com overlay na FIELD AGENDA, a carga tem de
  recalculá-la pela tradução nativa (`nativas.ts`) em vez de ler o arquivo;
- **"Produtivo" vem de `PROTOCOLOS GERAL[DATA INSTALAÇÃO]`**, que não está no poller (grupo
  `medio`, 20 min). Sem ela, uma instalação concluída aparece como Inconclusivo até o
  refresh seguinte. Custo dela no poller: não medido.

## #167 — "Produtivo" em tempo real: não é a `PROTOCOLOS GERAL`, é a alocação de patrimônio — e ela chega ~40 min depois do campo (02/10)

Continuação do #166. O "Produtivo" da VISÃO PRODUTIVA é `PROTOCOLOS GERAL[DATA INSTALAÇÃO]`
no dia (`nativas.ts`). Essa coluna é DAX sobre `DATA ALOCAÇÃO` (ou `DATA DA TROCA` na troca
de endereço), e as duas entram pela camada M — mesclas com `ALOCAÇÃO PATRIMONIO` e
`TROCA ENDEREÇO`, mais `Table.Distinct`/`Table.Sort` sobre o conjunto. **Pôr a
`PROTOCOLOS GERAL` no poller não é o caminho:** a M dela não é linha a linha (o mesmo
motivo de ela não ter política em `incremental.yaml`), e a única informação que a VISÃO
PRODUTIVA tira dela é o par (protocolo, dia da instalação).

**A fonte desse par é barata em tempo real.** `alocacao-patrimonio`, medida em produção:

| corte | linhas | tempo |
|---|---|---|
| inteira (desde 2025) | 61.041 | 8,4 s |
| `created >= :desde`, 1h30 | 6 | 147 ms |
| `GREATEST(created, modified) >= :desde`, 1h30 | 9 | 236 ms |
| `GREATEST(created, modified) >= :desde`, 1 dia | 230 | 239 ms |

Sem índice em `created`/`modified` de `patrimony_packing_list_items`, mas a tabela é
pequena: ~0,2 s por volta. `TROCA ENDEREÇO` já está no poller.

**O achado que muda a conversa: o processo atrasa mais que a carga.** Em 01/10, para os
141 protocolos que tiveram relato PRODUTIVA e alocação no mesmo dia, a alocação foi
registrada **41 min depois do relato (mediana), 74 min (p90)**; só 2 antes. Então, mesmo
com poller perfeito, uma instalação concluída aparece como **Inconclusivo** (tem relato
técnico, não tem instalação) por ~40 min antes de virar Produtivo. Isso não é atraso da
plataforma: é a definição de "Produtivo" do relatório (equipamento alocado) encontrando o
tempo que o processo leva para dar baixa. O Power BI tem o mesmo comportamento.

## #168 — o poller de tempo real ficava cego 3 h depois de cada subida da API (02/10)

Medido em `/api/saude` 40 min depois de recriar a API, às 9h de um dia útil: **824
voltas, 0 mudanças, 0 rebuscas** nas 7 queries vigiadas — nenhuma linha devolvida.

**Causa:** a vigília partia de `agora()`, o instante REAL do processo. O pool lê
`timestamp` sem fuso com os dígitos em UTC (`parseSemFuso`, `connectors-sql.ts`): "09:45 no
banco" vira `09:45Z`. Nessa convenção, o instante real 12:45Z significa "12:45 de parede" —
três horas no futuro —, e a busca não achava nada até o relógio do banco alcançar esse
ponto. Antes de 02/10 isso não aparecia porque a API ficava de pé por dias: só as 3
primeiras horas de cada subida eram cegas. Depois da primeira linha encontrada, `desde`
avançava pela marca da linha (já na convenção certa) e o poller se acertava sozinho.

**Correção:** (1) a vigília parte de `LOCALTIMESTAMP`, perguntado ao banco na primeira volta
de cada query (`#semeia`); (2) `:desde` vai como os dígitos UTC sem `Z`
(`paraParametroSemFuso`) — a mesma convenção do `parseSemFuso`, nos dois sentidos. Testes
em `TZ=UTC` e `TZ=America/Sao_Paulo`.

*Errata do mesmo dia:* a primeira versão desta correção usava getters LOCAIS para o
`:desde`, presumindo que o driver lia `timestamp` como hora local. Só acertava em processo
UTC (o container); num `npm start` no host (−03) recuaria 3 h a cada volta. Corrigido antes
de subir, ao ler o pool da API.

## #169 — tabela calculada com origem em tempo real: recálculo parcial por protocolo (02/10)

O overlay do poller entra nas tabelas FÍSICAS; uma calculada lida de disco continuava com
as linhas da última carga. Para a VISÃO PRODUTIVA isso são duas: `Status Protocolo Dia`
e `calendar` — que neste modelo **não é calendário**, é `DISTINCT(Protocolo, Data)` da
FIELD AGENDA, o eixo de colunas da matriz (congelada, agenda nova em dia novo não viraria
coluna).

**Recalcular inteira não cabe:** a tradução nativa de `Status Protocolo Dia` sobre as
632 mil linhas custa 5,8–7,5 s na vista colunar. **Parcial cabe:** as duas traduções
dependem só das linhas do mesmo protocolo (`particao` em `nativas.ts`), então `carrega`
recalcula os protocolos do overlay e junta com o resto do arquivo. As linhas do overlay
são as sem `indiceDaVista` — a distinção que a conversão de tipo já usava.

Medido sobre o snapshot de 02/10, overlay de 132 protocolos (5.007 linhas):

| carga | tempo | Status Protocolo Dia | calendar |
|---|---|---|---|
| congelada | 0,89 s | 12.987 | 12.987 |
| parcial | 1,28 s | 0 divergências | 0 divergências |
| inteira (nativa) | 6,3 s / 0,25 s | 0 divergências | 0 divergências |

A comparação inteira × congelada do `calendar` é a conferência do `shaConferido` dele
(`f0851493f7a3ef8b`). Arquivo velho em relação às origens, modo objeto ou fonte sem
coluna de partição caem no recálculo inteiro — base velha misturada com dado novo seria
o número plausível e errado.

**Defeito que a prova pegou no caminho:** a conferência de colunas da tradução nativa
usava `Object.keys(linha)`, que devolve VAZIO para a linha colunar (as colunas físicas
moram no protótipo, `linha-vista.ts`). Recusava toda linha colunar como "chegou sem
protocolo, slot agenda, …". Nunca tinha aparecido porque `snapshot:calculadas` carrega em
modo objeto. Trocado por `in`.

## #170 — FIELD AGENDA no poller em dois passos: a VISÃO PRODUTIVA em tempo real (02/10)

Fecha a etapa 1 do pedido do Erick ("visão produtiva tem que ser realtime"), com o desenho
medido no #166 e o recálculo parcial do #169.

**O que roda a cada 30 s** (`realtime-poll.yaml`, entrada `field-agenda`):

1. relógio do banco (`LOCALTIMESTAMP`);
2. `alvos` — as solicitações da janela que mudaram desde `:desde` (4 ramos, array
   materializado, busca por índice);
3. só se houver alvo: `busca_por_ids` — o `sql:` da spec com a view do Voalle trocada pela
   definição dela recortada por solicitação (`busca-por-ids.ts`; a definição é lida do banco
   uma vez por subida, e as âncoras erram alto se o Voalle mudar a view);
4. as 7 colunas calculadas sobre as linhas buscadas, na MESMA sequência do snapshot — grão
   reduzido primeiro (`GRAO_REDUZIDO_DE`, que saiu de `tools/snapshot` para
   `packages/snapshot/src/grao-reduzido.ts` para as duas pontas usarem a mesma declaração),
   depois o resto;
5. o delta guarda GRUPOS por protocolo (o grão é slot × relato), e a carga da página recalcula
   `Status Protocolo Dia` e `calendar` só nesses protocolos (#169).

**Medido contra o banco de produção, pelo caminho de produção (02/10, ~10h):**

| volta | alvos | busca | colunas | total |
|---|---|---|---|---|
| 1ª (15 min de atraso) | 957 ms, 49 ids | 718 ms | 146 ms | 1,9 s |
| seguintes | 800–1.400 ms, 5–6 ids | 67–75 ms | 32–57 ms | 0,9–1,6 s |

As colunas calculadas custavam **7,5 s** na thread principal da API antes do grão reduzido
(RANKX por protocolo sobre cada linha duplicada pelos relatos). Carga da AGENDAMENTO FIELD
com o overlay: 1,3–1,4 s, 21 de 21 visuais calculando. Efeito no dado, 15 min de manhã: 5
(protocolo, dia) de hoje passaram de Sem Ação para Inconclusivo, todos dentro dos protocolos
do overlay.

**Mudanças de comportamento que valem para as 7 queries antigas do poller:**

- o delta é por GRUPO de chave — para chave de uma linha, idêntico ao de antes;
- a poda olha QUANDO o grupo foi buscado, não a marca da linha. Uma linha de data antiga que
  a busca acabou de trazer acabou de mudar; podar pela marca a tirava do overlay na mesma
  volta, e a tela voltava ao valor velho do disco. Sem registro de busca, a marca decide
  como antes;
- grupo visto antes do início da última carga em lote da tabela (`geradoEm` do manifesto
  − 10 min) já está no disco e sai do delta — é o que impede o overlay da FIELD AGENDA de
  crescer o dia inteiro.

**Fica para a etapa 2:** "Produtivo" (alocação de patrimônio no poller, #167) e o aviso
"N visitas com relato produtivo aguardando baixa de equipamento" (opção (a) do Erick).

## #171 — detecção da FIELD AGENDA só nas agendas recentes: ~780 ms → ~140 ms (02/10)

Depois de subir o #170, a detecção (`alvos`) ficou em 1,2–2,1 s por volta na stack, com
um pico de 11,3 s. Medido por ramo: o custo é o tamanho da lista — as 23.191 solicitações
com agenda nos últimos 3 meses, conferidas nas quatro tabelas (relatos é o maior, ~340 ms).

| detecção | solicitações | tempo |
|---|---|---|
| agendas de 3 meses | 23.191 | ~780 ms |
| agendas de 7 dias + futuras | 2.220 | ~140 ms |
| 7 dias, lista guardada entre voltas | 2.220 | ~100 ms |

**O preço, medido:** nas últimas 24 h mudaram 817 solicitações, 815 dentro dos 7 dias;
desde a manhã de 01/10, 964, 956 dentro (99,2%). As de fora chegam pelo refresh em lote
(30 min, janela de 3 meses) — atraso, não perda. Aprovado pelo Erick. A lista guardada
entre voltas ficou de fora: 40 ms a mais de ganho por uma decisão de renovação em que uma
agenda nova poderia ficar invisível até renovar.

## #172 — snapshot de madrugada + poller: o que a primeira noite mediu (02/10)

O Erick pediu o modelo "um snapshot completo de madrugada e incremental/poller de dia".
Antes de ligar, cada peça foi medida ou provada. Seis achados, em ordem:

**1. O poller era a maior carga do banco** (commit `070b354`, `/api/saude` → `porQuery`).
Quinze minutos às 22:12, sem nenhuma mudança na fonte:

| query | intervalo | por volta | banco por hora |
|---|---|---|---|
| `reincidencia` | 30 s | 5,9 s | 12,0 min |
| `protocolos-auxiliares` | 12 s | 1,5 s | 7,7 min |
| `instalacoes-reincidentes` | 30 s | 3,2 s | 6,6 min |
| as outras 5 | 12–30 s | 0,4–0,7 s | 12,3 min |
| **total** | | | **38,6 min/h** |

O refresh inteiro custa ~21 min/h. Nenhuma volta foi pulada: as 6.266 voltas em ~7 h
(contra ~13.000 pelos intervalos) vieram da queda de rede da tarde, não de consulta
lenta. Cada volta recalcula a query inteira para descobrir que nada mudou. Paliativo
(`2622764`): `reincidencia` e `instalacoes-reincidentes` 30 s → 2 min, `protocolos-auxiliares`
12 s → 30 s, ~19,6 min/h estimados. O conserto é a sentinela (PLANO-CARGA 1.3).

**2. Reiniciar a API apagava o dia das tabelas do poller** (`1dc5ee3`). A vigília partia
de `LOCALTIMESTAMP`; com o snapshot só de madrugada, uma API reiniciada às 14h mostraria
as 8 tabelas como às 03h. A primeira busca agora parte do `geradoEm` do manifesto, no
relógio do banco, com teto de 26 h. O `corte` de `mescla()` continua sendo a subida.
Recuar o corte apagaria do disco a linha que mudou e não voltou na busca em dois passos,
e há um teste guardando isso.

**3. O "snapshot das 3h" rodava à meia-noite** (`055d9c1`). O contêiner é UTC
(`/etc/localtime -> Etc/UTC`); `0 3 * * *` = 00:00 de Brasília. Agora `0 6`. E
`protocolos-produtividade` entrou na lista: estava fora por um motivo que caiu em 13/09.
Há um teste que exige que o crontab cubra toda query do `refresh.yaml`.

**4. `protocolos-produtividade` incremental: bateu nas colunas usadas, mas tem buraco.**
Prova de 22:31 (incremental × completa ao mesmo tempo, base das 22:01): 82.421 linhas nas
duas, **40.758 de 40.762 protocolos iguais**, 36,7 s × 192,3 s. Os 4 diferem só em
`STATUS CONTRATO`, e nos 4 a incremental ficou com o valor da BASE: o contrato mudou e a
solicitação não, e os `alvos` (solicitação, alocação, RAUX) não veem. Nenhuma tela lê essa
coluna da `PROTOCOLOS PRODUTIVIDADE`, mas `DATA AGENDA`, `EQUIPE`, `GESTOR` e `TÉCNICO TROCA`
vêm de outras tabelas e a janela noturna não as exercitou. **Não ligada**: repetir de dia.

**5. Recriar a API derrubava a tela pelo proxy** (`a8b8178`). O Nginx resolvia `api` uma vez
na subida: API recriada de 172.18.0.4 para .3, 502 em toda página até `nginx -s reload`.
Agora `resolver 127.0.0.11` + `proxy_pass $api`. Prova: API forçada para um IP novo (.7,
com um contêiner descartável ocupando o antigo) e a porta 80 seguiu 200, sem reload.

**6. Docker Desktop travado num diálogo** (tarde de 02/10): ver `PLANO-CARGA.md` §4.

**Efeito colateral aceito:** o `frio` passou a 60 min, então as agendas de fora dos 7 dias
da detecção da FIELD AGENDA (#171, ~0,8%) chegam em até 1 h, e não mais em 30 min.

## #173 — a primeira madrugada disparou na hora e falhou sem credencial; o tempo real chega, mas é quase todo ruído (04/10)

**O notebook hibernou por bateria** de 02/10 23:18 a 04/10 01:03 ("Motivo da Suspensão:
Battery"; os tempos de suspensão já eram "nunca"). Por ~26 h não houve refresh, poller nem o
snapshot das 03:00 de 03/10. Ao acordar, tudo voltou sozinho: o `refresh` retomou ~12 min
depois (o temporizador anda no relógio monotônico, que para na suspensão) e o poller teve 8
erros de rede/VPN subindo, e se recuperou.

**O cron de 04/10 disparou às 06:00:02 UTC (03:00 de Brasília, a correção do #172 valeu) e
falhou nas 24 queries em 40 s:** "falta no .env VOALLE_HOST, VOALLE_DATABASE…". O
`entrypoint.sh` grava `VAR='valor'` sem `export`; no `sh`, `. arquivo` não passa nada ao
`node` filho. A execução manual por `docker exec` passava porque herda o ambiente do contêiner,
e é por isso que ninguém tinha visto (o comentário do entrypoint previa exatamente esta falha).
Simulado com `env -i`: sem `set -a`, SEM credencial; com `set -a`, OK. Corrigido em `529a4b0`.
Prova no contêiner novo: a linha EXATA do cron, com `env -i` e só `--query=feriados`, carregou
e gravou.

**Duas execuções manuais completas** (04/10 01:07 e 15:45 de Brasília): 25 de 25 ok, ~11 min
cada. A trava serializou o snapshot com o `refresh` nas duas (256 s e 437 s de espera).

**O tempo real chega à tela, mas é quase todo ruído.** Ouvindo `/api/eventos` como o navegador,
5 min num domingo às 15:46: **31 avisos, 28 deles `manutencao-inicial` a cada ~12 s e 3
`instalacao-reincidente` a cada 2 min**. São as mudanças fantasma de `RETORNO PRIORITARIO` e
`REINCIDÊNCIA` (PLANO-MESTRE R.0): uma chave "muda" em toda volta sem o dado mudar, e cada aviso
recalcula a página. Nenhum aviso das páginas principais no período (pouca operação no domingo).
A comparação ignora ordem e trata `Date`, e no snapshot os campos de intervalo chegam como
número ou nulo. A coluna culpada ainda não foi achada.

## #174 — o modelo "ano às 03h, 2 meses a cada 30 min, 5 dias em tempo real", medido (05/10)

Pedido do Erick em 05/10. Medido na segunda de manhã (09:00–09:11 de Brasília), dia útil, um
pedido por vez, só leitura (`default_transaction_read_only`), SQL pura sem o M. A SQL é a da
spec, com o recorte de data trocado (`DATE_TRUNC('year', CURRENT_DATE)` e `'2025-01-01'` → hoje
menos N dias; a janela de 3 meses da `field-agenda` → N dias).

| query | hoje | 60 dias | 5 dias |
|---|---|---|---|
| `protocolos-produtividade` | 163,3 s · 114 MB | **12,1 s** · 24 MB | 1,8 s |
| `field-agenda` | (o script estourou a memória dele, não o banco) | **106,6 s** · 372 MB | 14,6 s |
| `protocolos-geral` | 43,3 s · 101 MB | **6,3 s** · 8,6 MB | 2,0 s |
| `protocolos-auxiliares` | 30,2 s · 54 MB | 9,2 s · 11 MB | 1,6 s |
| `base-categorias-field` | 12,8 s · 56 MB | 2,9 s | 0,3 s |
| `alocacao-patrimonio` | 7,6 s · 37 MB | 1,6 s | 0,3 s |
| `protocolos-telefonia` | 6,8 s | 2,3 s | 0,3 s |
| `retorno-prioritario` | 4,4 s | 2,1 s | **9,9 s** (o plano piora com a janela curta) |
| `reincidencia` | 4,1 s | 3,4 s | 1,8 s |
| `instalacoes-reincidentes` | 3,8 s · 16 MB | 1,1 s | 0,2 s |
| `tecnicos-auxiliares` | 2,6 s | 0,5 s | 0,1 s |
| `troca-endereco` | 1,3 s | 0,8 s | 0,8 s |

As 12 outras não têm recorte de data e custam igual em qualquer janela. Só uma pesa:
`backlog-agendado-futuro`, 64–70 s (B.5). `contratos` custa 17–19 s.

**O que os números dizem:**
1. **Ano às 03:00: viável.** O snapshot completo levou ~15 min (25 de 25, 05/10 08:45–09:00).
2. **2 meses a cada 30 min: viável, ~8 min/h de banco** (contra ~15 do `refresh.yaml` atual).
   Exceção: a `field-agenda`, cuja janela de 60 dias custa MAIS que a incremental que já roda
   (106 s × 43–66 s). Fica na incremental. A `backlog-agendado-futuro` continua inteira até a B.5.
3. **5 dias em tempo real: viável por tabela, não para todas de uma vez.** Rebuscar os 5 dias de
   todas custa ~34 s por rodada, ou seja, a 30 s o banco nunca descansaria. Mas para várias tabelas
   a janela de 5 dias é MAIS BARATA que a volta atual do poller, que recalcula o ano inteiro e só
   filtra a saída: `reincidencia` 5,9 s por volta → 1,8 s; `instalacoes-reincidentes` 3,2 s →
   0,2 s. O desenho certo é: janela de 5 dias dentro da SQL do poller, mais a sentinela (B.1b)
   para só buscar quando algo mudou.
4. **Recorte por CRIAÇÃO não é recorte por ATIVIDADE.** Este teste cortou pela data em que a
   query já corta (criação, na maioria). Um protocolo criado há 70 dias e instalado hoje fica fora
   da janela de 60 dias e só atualiza às 03:00. Decisão do Erick: "2 meses" de quê?

**Experiência do usuário durante a carga (mesma manhã, 6 rodadas no navegador enquanto o snapshot
rodava):** `capa`, `diario-instalacao` e `telefonia-ouvidoria` sempre < 1,4 s. As piores são as
duas que o aviso fantasma recalcula sem parar: `manutencao-inicial` até 54 s e
`instalacao-reincidente` sem abrir em 60 s numa rodada. Depois vêm `visao-geral` (0,6–27 s),
`agendamento-field` e `relatorio-do-mes` (até > 60 s). A frequência das cargas não resolve isso;
o plano é `PLANO-CARREGAMENTO.md`, e a R.0 (fantasma) sobe de prioridade.

**Adendo, mesma manhã: quanto tempo um protocolo leva da criação à instalação** (snapshot em disco,
só contagens; o que instalou/encerrou nos últimos 30 dias):

| desde a criação | instalações (`protocolos-geral`, 2.940) | encerramentos (`protocolos-produtividade`, 9.533) |
|---|---|---|
| ≤ 5 dias | 88,7% | 57,2% |
| ≤ 15 dias | 99,7% | 97,4% |
| ≤ 30 dias | 100% | 99,1% |
| ≤ 60 dias | 100% | 99,9% |

Por isso 5 dias é curto para o tempo real: deixaria fora 11% das instalações e 43% dos
encerramentos do dia. E o custo da janela de **15 dias**, na mesma medição (12:15 UTC): `geral` 2,7 s,
`produtividade` 3,0 s, `auxiliares` 2,5 s, `reincidencia` 1,9 s, `retorno-prioritario` 1,7 s (com
5 dias eram 9,9 s), `alocacao` 0,5 s, o resto ≤ 0,7 s; `field-agenda` 32,3 s (fica nos dois passos
que já roda, ~0,6 s por volta).

**Modelo recomendado ao Erick a partir disto** (`PLANO-CARREGAMENTO.md`, etapa 8):
03:00 o ano inteiro; a cada 30 min os últimos 60 dias pela criação (~8 min/h); ao vivo, os
últimos 15 dias, a cada 60 s nas tabelas dos números principais (`geral`, `alocacao`,
`produtividade`, ~6 min/h) e a cada 2 min nas demais (~5 min/h). Total ~19 min/h, contra ~35 hoje
(refresh + poller), e o número principal ao vivo em ~1 min em vez de 30.

---

## #175 — etapa 1 do PLANO-CARREGAMENTO: o que trava a API é o tempo real recalculando páginas inteiras (05/10)

**Instrumento.** Uma sonda pediu `GET /` (estático servido pela API, resposta trivial) a cada
500 ms por 20 min (12:43–13:03 UTC), cruzada com o log da API, o do refresh e `/api/saude`.
Demora ali = laço principal da API ocupado.

**Sonda:** 2.368 pedidos, 49 acima de 200 ms (48 até 1 s, 1 até 5 s, nenhum acima). O único
trecho denso (12:45:53–12:46:15, até 1.038 ms) coincide com o refresh regravando a
`field-agenda` (81 s, +19.853/−18.838 linhas incrementais) enquanto a API recalculava; o Redis
deu `Command timed out` às 12:46:10 pelo mesmo motivo. Nenhum `[worker] caiu para cálculo em
linha`: o cálculo não volta para a thread principal.

**O peso de verdade aparece em `/api/saude` (desde o reinício das 12:31):**

| medida | valor |
|---|---|
| CPU da API com o refresh parado (`docker stats`) | 136% |
| `FIELD AGENDA mudou` | 31 em ~18 min (uma a cada ~35 s); cada uma invalida 3 páginas (`agendamento-field`, `relatorio-do-mes`, `visao-geral`) |
| `worker_ms` / `calculo_ms_warmup` | p50 ~5 s, máx. 22 s por página |
| `rewarm_ms` | p50 ~30 s, máx. 100 s; 142 pedidos, 74 adiados (o reaquecedor nunca alcança) |
| `primeiro_get_pos_evento` | 24 miss × 12 hit; quem chega depois do evento espera p50 ~5 s, máx. 19 s |
| `fila_ms_interactive` | máx. 10,6 s (o clique atrás do reaquecimento) |
| `atrasoDoFato` da `field-agenda` | mediana 7,8 s (o tempo real em si chega rápido) |

**Causa.** `aoTabelaMudar` (`servidor.ts`) descarta a página inteira (`esqueceAPagina` +
`piscina.invalidaPagina`) a cada mudança: 3–5 linhas novas obrigam a recarregar as ~620 mil
linhas da `field-agenda` e a refazer `calendar` / `Status Protocolo Dia` (~115 chaves, "tradução
nativa") em cada worker, por página. Com mudança a cada ~35 s e recálculo de 15–30 s por lote, a
API fica ocupada o tempo todo: é por isso que a `agendamento-field` às vezes abre em 4,8 s ou mais
mesmo sem carga nenhuma. Os picos do laço principal são secundários.

**Também nesta etapa: Google Fonts fora do caminho crítico** (`868dcbc`, no ar às 13:05). Antes:
`html` 267–936 ms, `pronta` 482–1.245 ms. Depois (5 rodadas): `html` 57–97 ms, `pronta`
293–420 ms quando o cache acerta; uma rodada de 4.777 ms foi miss pós-evento (a causa acima). As
fontes vêm de `/assets/inter-latin-*.woff2` (só o subconjunto latino, pelo `unicode-range`), sem
erro de CSP e sem pedido a `fonts.googleapis.com`.

**Resíduo visto pelo instrumento:** os chips de filtro (`SegmentacaoChips`) só pedem os valores
depois que a página aparece, e mostram "carregando…" por ~16 ms. Entra na etapa 7 (filtros
pré-carregados).

---

## #176 — etapa 1b: quem abre a VISÃO PRODUTIVA depois de uma mudança já não espera (05/10)

Quatro commits no staging (`ec3e6c1`, `6a63a58`, `2276715`, `40de26d`; instrumento em `80bd472`),
cada um subido na stack de teste e medido antes do seguinte. O plano escrito na etapa 1 (aplicar
a mudança linha a linha no dataset) caiu com a primeira medição. Recarregar a página do zero com
um overlay de 5 mil linhas custa ~0,5 s na `agendamento-field`, ~1,5–2,5 s na `relatorio-do-mes`
e ~3,5–4,5 s na `visao-geral`. O peso estava em quatro outros lugares:

1. **Valores de segmentação na thread que atende** (57 cargas em ~23 min, #175) → agora na
   piscina, com voo único por chave e geração por página.
2. **Cada mudança da `field-agenda` derrubava três páginas** → só a `agendamento-field` é
   avisada na hora; as demais juntam as mudanças numa rodada a cada 2 min
   (`avisoDasPaginas`, `API_REALTIME_DEMAIS_MS`).
3. **A worker carregava o dataset por RECORTE** (a chave levava os ids dos visuais pedidos):
   um reaquecimento eram várias cargas da mesma página, e com os valores na piscina a CPU foi a
   ~400%. Agora a carga é a da página inteira, como a thread principal sempre fez. Medido com
   `worker_cargas` (log `[worker N] … carregou do disco`): uma carga por evento.
4. **A invalidação do tempo real apagava também a "última pronta" do #164**, então o
   servir-o-anterior nunca valia no caso frequente → agora ela fica; o GET sai na hora com ela,
   a nova é calculada por baixo e a página servida velha recebe um segundo aviso SSE quando a
   nova sai.

**De quebra, um defeito antigo dos filtros:** sem visual amarrado, a lista de valores caía no
grão reduzido da `FIELD AGENDA` (`projecao.yaml`), onde as colunas-gatilho não estão
inteiras. No snapshot real, `ClassificacaoRelato` listava 14 de 36 valores e `Descrição` 6 de 28,
enquanto os visuais da mesma página usam a forma completa. Agora a lista usa a forma completa
que os visuais da página pedem. **Falta o Erick conferir as duas listas contra o Power BI.**

**Antes × depois** (stack de teste, horário de operação, 20 min cada):

| medida | antes (10:05–10:29 RS) | depois (11:16–11:37 RS) |
|---|---|---|
| sonda do laço: pedidos > 200 ms | 49 de 2.368 (máx. 1.038 ms) | **0 de 2.368** |
| cargas de dataset na thread principal | 48 em 20 min | **0** |
| 1º GET depois de uma mudança | 9 prontos / 17 calculando, média 7,8 s, máx. 36 s | **18 prontos / 0**, média 2 ms |
| `agendamento-field` pronta (`tela:entrada`, 1/min) | 482–1.245 ms quando acertava; 4,8–16 s depois de evento | **294–1.003 ms** em 18 de 18 |
| `worker_fallback` / `valores_fallback` | 0 / — | 0 / 0 |
| CPU da API | 73–174% | ~100% na maior parte; 250–495% nos picos |

**O que ainda não fecha a etapa:**
- **CPU < 50% não foi atingido.** O reaquecimento da `agendamento-field` ainda leva ~20 s
  (abertura, 10 segmentações, períodos recentes e cada visual abaixo da dobra) e recomeça a
  cada mudança (~35 s): uma worker fica ocupada o tempo todo. O usuário já não sente isso (a
  worker de quem usa fica reservada, e a última pronta cobre o intervalo), mas é máquina gasta.
- **O pior cenário não caiu na janela.** O grupo `quente` rodou às 11:23 (é a rodada de
  1.003 ms, com a CPU em 494%), mas a gravação da `field-agenda` (grupo `frio`, a do pico de 1 s
  no #175) não. Repetir a sonda numa janela com ela.
- 5 das 18 rodadas tiveram "carregando…" por ~16 ms nos chips de filtro (o resíduo do #175,
  etapa 7).

---

## #177 — o filtro TURNO travava a agendamento-field: um contexto por linha, cada um de cache vazio (05/10)

**Sintoma.** Aplicar `PROTOCOLOS GERAL[TURNO]` na `agendamento-field` passava de 60 s pela tela
(e derrubava o worker de 768 MB). No snapshot real, a abertura com esse filtro levou **257 s e
6 GB**, quase tudo num visual só: a `tableEx` "PROTOCOLOS DISTINTOS"
(`Status Protocolo Dia[protocolo]`, ~10 mil linhas).

**Causa.** Uma tabela agrupada cria um contexto de filtro filho por linha ("protocolo = X"), e
cada filho nascia de cache vazio. A propagação TURNO → `PROTOCOLOS GERAL` → `Status Protocolo
Dia` era refeita por linha, e o conjunto de chaves permitidas (~50 mil linhas da origem) era
remontado por linha também.

**Correção (`44aaf97`, `measure-engine/src/filter.ts`).**
- O filho reaproveita do pai o array de linhas visíveis de toda tabela cuja travessia de
  relacionamentos (feita a seco sobre o grafo, que não muda) não passa por tabela nenhuma cujos
  filtros mudaram. Só predicado muda resposta; as materializações são atalho.
- As chaves permitidas ficam em cache por (array de origem, relacionamento).
- Uma heurística de "varrer o destino quando ele é menor" foi tentada e **retirada**: deixava a
  página sem filtro ~30% mais lenta (A/B alternado) e mudava ordem de linha, o que a prova de
  paridade acusou (`04979b`, caso 2).

**Medido.** TURNO na abertura: 257 s → ~10 s no snapshot; na API do Docker, 1º clique 8 s
(antes > 60 s ou travava), 2º 9 ms. Os outros filtros: 0,2–1,7 s.

**Paridade (`npm run bench:filtro-pai-paridade`).** Cada cálculo num processo próprio, hash por
visual, as 14 páginas sem filtro e com os 2 primeiros valores das 2 primeiras segmentações:
**49 casos iguais, 0 divergências**. No caso do TURNO o motor antigo não termina a página
inteira; visual por visual, 38 iguais e 1 sem base (o próprio "PROTOCOLOS DISTINTOS", que o
motor antigo não termina em 180 s).

**O que sobrou nos ~8 s.** Três `tableEx` grandes da `agendamento-field` ("HISTÓRICO DE RELATOS
COMPLETOS", "VISÃO GERAL", "HISTÓRICO DE RELATOS"), 1,5–3 s cada, com ou sem filtro: o perfil põe
o custo em `enumeraCombinacoes` (620 mil linhas × 6–12 colunas, uma chave de texto por linha) e na
coleta de lixo. É o próximo alvo para filtro em milissegundos.

---

## #178 — fase 2 do frontend: o estado do servidor no React Query (05/10)

`ac55c74`. Os quatro caches feitos à mão do `App.tsx` viraram consultas
(`hooks/useDadosDaTela.ts`, chaves em `chavesDeConsulta`): lista, forma, abertura, saúde,
valores de segmentação e os visuais abaixo da dobra. O SSE, o relógio de 60 s e o "Atualizar"
usam `invalidateQueries`; os três pré-carregamentos usam `prefetchQuery`. `staleTime: Infinity`
— quem diz que mudou é o servidor.

**Antes × depois** (stack de teste, `agendamento-field`, 3 rodadas, contexto novo cada):

| medida | antes | depois |
|---|---|---|
| entrada até pronta | 518–547 ms | 326–528 ms |
| pedidos na entrada | 31 | 25–31 |
| troca de aba / volta | 110–352 / 97–178 ms | 89–153 / 73–107 ms |
| pedidos na troca + volta | 26–29 | 14–24 |
| "carregando" na volta | até 1 | 0 |

Nenhum "carregando" novo; 0 erro no console (conferido no dev server com filtro, rolagem até
os visuais abaixo da dobra e "Atualizar"). O bundle cresceu 30 kB (9 kB com gzip).

---

## #179 — filtro em milissegundos: o que já era, o que o motor ganhou e o que o mouse adianta (05/10)

Pedido do Erick: "filtros em milissegundos". Medido antes de mexer, na API do Docker:

| clique | tempo |
|---|---|
| um valor de uma segmentação de até 40 valores | **2–10 ms** (já pré-calculado, #163; `anterior` depois de um evento) |
| dois filtros, combinação nunca pedida (`agendamento-field`) | **0,9–2,1 s** |
| a mesma combinação de novo | 3–10 ms |

Ou seja: o clique simples já era milissegundo. O que sobra é a **combinação nova**, e nela o
tempo é difuso — 32 visuais da abertura, ~25 ms cada, nenhum acima de 500 ms; o perfil põe o
grosso em `linhasVisiveis` dos cards (`FILTER` linha a linha) e na montagem de índice de
igualdade a cada contexto novo. Não há um gargalo que leve 1 s a 10 ms.

**1. O motor: agrupar por número, não por texto (`grupos.ts`).** As três `tableEx` de relato
(`815c09`, `084be3`, `e2d554`) agrupam a FIELD AGENDA (~620 mil linhas) por 6 a 12 colunas, uma
delas o texto do relato, e saem com 144 mil, 129 mil e 13,7 mil grupos. A chave de cada linha era
a concatenação das identidades — uma string nova do tamanho do relato, por linha, achatada e
"hasheada" inteira pelo `Map`. Agora `NumeradorDeCombinacoes` dá a cada identidade um inteiro
(da coluna colunar, o código do dicionário canonizado uma vez por código, via o novo
`Evaluator.leitorDeCodigo`) e combina os pares numa tabela de hash própria sobre `Int32Array`;
`filtrosDe` acha a combinação pelo array `valores` (é o mesmo objeto) e só monta a chave de
texto se alguém pedir por um array de fora.
- Uma primeira versão com `Map<number, number>` e chave `g * 2^26 + id` **não ganhou**: a chave
  passa de 2^31, vira número alocado no heap, e `junta` ficou com 2 s de tempo próprio.
- Medido (mínimo de 5 rodadas por visual, 3 pares de processos alternados, a API do Docker a
  100% de um núcleo ao lado): as três tabelas **3,5–3,9 s → antes 4,6–6,6 s**, 3/3 para a nova.
- `grupos-chave.test.ts` trocou a forma "concatenação incremental" (que não existe mais) por:
  o numerador separa 2 mil linhas sorteadas (caixa diferente, `'1'` vs `1`, BLANK, a mesma data
  em dois objetos) exatamente como `chaveDeValores`, com número denso na ordem de aparição; e a
  tabela de pares cresce sem perder número. Mutação (`junta` ignorando a combinação anterior):
  2 testes falham.

**Paridade** (o mesmo cálculo no motor anterior e no novo, cada um num processo, hash por
visual, as 14 páginas sem filtro e com os primeiros valores das primeiras segmentações):
**42 casos iguais, 0 divergências** (`paridade-grupos`, rascunho fora do repositório; o filho é o de `bench:filtro-pai-paridade`). Na própria
`agendamento-field`, numa rodada só: sem filtro **18,9 s → 10,8 s**, com o 1º filtro 10,6 s → 7,0 s —
é o cálculo que o tempo real refaz a cada evento. Nas páginas pequenas a diferença é ruído (a
`visao-geral` com filtro, 4 pares alternados: antes 105–153 / 144–430 ms, depois 116–207 / 137–178).

**2. A tela: o próximo clique já está pronto quando a pessoa clica.**
- **O mouse sobre um filtro** (`App.tsx`, `Segmentacao*.tsx`): o mesmo pré-carregamento que já
  existia para a aba e para a barra (R6, 150 ms de intenção), agora no chip e na opção do
  seletor, pela conta do clique (`aplicaSelecao`). Medido: o pedido sai ~250 ms antes do clique
  — pouco contra o 1–3,7 s da combinação fria logo depois de reiniciar a API.
- **A vizinhança** (`hooks/useVizinhanca.ts`, `utils/vizinhanca.ts`): com a página parada 1 s, a
  tela pede em sequência cada estado a UM clique de filtro deste — chips primeiro, depois os
  seletores de até 40 valores, no máximo 40 estados —, com `origem=prefetch` (atrás dos cliques
  na fila e fora da worker reservada, #163). Estado novo interrompe; vizinho que já está no
  cache da tela, mesmo velho, não é pedido de novo (o aviso do servidor invalida a página
  inteira, e senão cada evento custaria 40 pedidos por pessoa). Uma ideia anterior, a
  vizinhança no servidor disparada pelo pedido do usuário, foi descartada: o mouse sobre um
  chip também é pedido, e cada passada de mouse reiniciaria a vizinhança de um estado que a
  pessoa nem escolheu.
- O teste (`vizinhanca.test.ts`) compara a URL de cada vizinho com a do clique de verdade.

**Medido na stack de teste (Playwright, `agendamento-field`):** chip 1 → 8 s lendo → chip 2.
Em 10 rodadas, **6 a 11 dos 7 a 12 vizinhos ficaram prontos** durante a leitura (o que faltava
era o frio, 1,1–6,3 s). No segundo clique a combinação **sai do cache da tela, sem esperar
rede**; quando um aviso de tempo real a envelheceu nesses 8 s, ela aparece igual e se atualiza
por baixo em 9–49 ms (a URL pedida era a do vizinho pré-carregado — a chave bate). Antes: a
mesma combinação, fria, 1,1–3,7 s.

**O que continua frio:** clicar antes de a vizinhança chegar ao valor (são ~1 s por vizinho
frio, em fila); o terceiro filtro em diante (a vizinhança é de um passo); segmentações com mais
de 40 valores; e o período (árvore de data), que tem o seu próprio pré-cálculo
(`filtrosRecentes`).

---

## #180 — fase 3 do frontend: a URL é o estado, e o `App.tsx` dividido (05/10)

**O que mudou.** Página, filtros e campos clicados passaram a SER a URL, lida pelo
`react-router` (`hooks/useEstadoDaTela.ts`), em vez de três `useState` que a URL seguia por um
efeito com `pushState`/`replaceState`, um ouvinte de `popstate` e um `useRef` de origem. O
`App.tsx` (660 linhas) ficou com o portão de login e a rota; o resto foi para
`pages/dashboard/DashboardPage.tsx`, três hooks (`useEstadoDaTela`, `useTempoReal`,
`usePreCargas`) e `BarraDeFiltros`. Plano em `PLANO-PADROES-FRONTEND.md`, fase 3.

**Um defeito que a mudança expôs, e o marcador que o fecha.** `escreveRota` omite o filtro
quando ele é o padrão da página, então a URL sem `filtro` queria dizer duas coisas: "o padrão"
e "a pessoa limpou tudo". Com o estado na memória isso passava quase despercebido — só o voltar
do navegador lia a URL, e caía em "sem filtro" num estado que era o padrão. Com a URL como
fonte, limpar o filtro devolveria o padrão na hora. Agora `escreveRota` grava `limpo=1` quando
não há filtro numa página que tem padrão, e `filtrosDaRota` resolve: URL sem filtro e sem
marcador é o padrão (todo link antigo continua valendo). `estado-da-tela.test.ts` cobre os
casos; sem a linha do marcador, 1 teste falha.

**Conferido no navegador** (dev server da worktree contra a API do Docker, modo conferência):
abre no padrão com a URL limpa; chip entra na URL e substitui no histórico; limpar o chip volta
à URL limpa; clique cruzado entra com `clicado` e empilha; voltar desfaz e a tela acompanha
(2 filtros), avançar refaz; recarregar mantém (3 filtros); `limpo=1` abre sem filtro e continua
dizendo limpo; aba troca a página e substitui; o link pelo caminho `/diario-instalacao` abre a página no Vite
e a aba seguinte volta para `/?pagina=…` (na stack ele dá 404 do estático da API, como sempre
deu — o estático não tem fallback de SPA); sem página na URL abre a primeira pronta; a
vizinhança (#179) segue pré-carregando (13 de 14 vizinhos em 8 s); "Atualizar" busca a página e
as 11 listas de filtro e marca a hora; 0 erro no console.

A mesma conferência na stack (porta 80, depois do build): os mesmos itens, menos o do caminho.

**Custo:** o bundle cresceu 38 kB (12 kB com gzip), o `react-router`.

---

## #181 — fase 4 do frontend: nenhum componente acima de 200 linhas, e a prova de que a tela não mudou (05/10)

**O que mudou.** Os sete componentes acima de 200 linhas foram divididos (o maior agora tem
197); o que se repetia virou peça única (paginador de janela em três visuais, clique no eixo em
dois, CSV em dois, a marca em dois) e as contas puras foram para `utils/` com teste. Detalhe em
`PLANO-PADROES-FRONTEND.md`, fase 4.

**Um defeito corrigido de passagem.** `Tabela` e `Matriz` chamavam `useState`/`useMemo`
DEPOIS do `return` de "sem dados". Se um visual recebesse dado num quadro e não no seguinte (ou
o contrário), o React derrubaria a árvore com "Rendered more hooks than during the previous
render". Agora todo hook vem antes. O teste `visuais-seguros.test.ts` fixa a forma literal da
guarda (`if (!d || !d.colunas || !d.linhas)`), e ela foi mantida.

**Como se prova que uma refatoração não mudou a tela, com dado em tempo real.** Comparar
capturas da tela viva não serve: o número muda entre as duas. A régua (rascunho fora do
repositório, apagada depois) fez assim:
- gravou num HAR, uma vez, as respostas de `/api` de um roteiro fixo contra o build antigo;
- reproduziu o roteiro, só do HAR, contra o build antigo duas vezes e contra o novo uma vez,
  sempre na MESMA origem (o HAR casa host e porta — servir o build novo em outra porta abortou
  todo pedido e deu 157 "diferenças" falsas);
- relógio do navegador fixo, SSE cortado, relógio de 60 s desligado, sem cursor fino (desliga
  hover-prefetch e vizinhança, que pedem fora de ordem);
- roteiro: as 14 páginas nos dois temas, rolando até o fim e voltando, mais 10 interações no
  claro (mouse sobre coluna, página anterior do gráfico, zoom, ordenar a tabela duas vezes,
  página da tabela, transpor a matriz, histórico da capa, abrir a árvore de período e clicar
  num dia de um mês não marcado).

**Resultado: 78 capturas, HTML idêntico em todas.** Nas imagens, 8 PNGs das páginas `l-*`
diferem em 7 a 15 pixels nos cantos arredondados dos cards (x 12 e 1353): o MESMO ruído de
antialiasing que as duas reproduções do build antigo já tinham entre si, nos mesmos 8 arquivos.

**E a fase 3 conferida no caminho.** O clique num dia de um mês não marcado gera duas mudanças
de nível (Dia e Mês), chamadas em sequência; as duas chegaram à URL (`Dia [6]`,
`Mês [julho, outubro]`). É a prova de que as ações de `useEstadoDaTela` leem a URL já escrita
pela anterior, como o cabeçalho delas promete.

**Fora da régua:** o paginador de colunas da matriz (nenhuma página abre com mais de 30
colunas no estado padrão); ele é a mesma `PaginadorDeJanela` exercitada pelo gráfico.

## #182 — fase 5 do frontend: ESLint, Prettier, pre-commit, Vitest e E2E; e o rate limit que a vizinhança tinha estourado (06/10)

**O que entrou.** Detalhe em `PLANO-PADROES-FRONTEND.md`, fase 5.
- **ESLint** (`frontend/eslint.config.js`) com `react-hooks` recomendado. Prova de que serve:
  sobre a `Tabela` de antes da fase 4 (`1410f67`), `rules-of-hooks` acusa 7 erros — o defeito
  do #181. O código atual passa sem aviso, com uma exceção explícita (abaixo).
- **Prettier** (100 colunas, aspas simples) num commit só de formatação (`6ae3a3a`, listado
  em `.git-blame-ignore-revs`). O JavaScript gerado ficou idêntico byte a byte, salvo um
  `{' '}` numa frase de JSX que dá o mesmo texto na tela.
- **Pre-commit** (Husky + lint-staged): `*.{ts,tsx}` do frontend passa por Prettier e por
  `eslint --max-warnings=0`; violação de hooks barra o commit. Fora do frontend, nada roda.
- **Vitest** para os testes do frontend (os 15 arquivos de `node:test` migrados) e os
  primeiros de componente (Testing Library, jsdom): a `Tabela` sobrevive a perder e recuperar
  dados (com a `Tabela` antiga o teste cai em "Rendered fewer hooks"), duas `mudaFiltro`
  seguidas ficam as duas, seletor substitui e clique empilha no histórico, chips e paginador.
  `npm test` da raiz roda backend (`node:test`) e frontend (`vitest run`).
- **E2E** (`npm run e2e`, `backend/tools/tela/e2e/`), fora do `npm test` porque depende da
  stack no ar: 8 testes de navegação no Chromium.

**O contorno dos dois TypeScripts.** A raiz usa o TypeScript 7 (nativo) e o frontend o 5.9.
O `ts-api-utils` (dependência do `typescript-eslint`) fica içado na raiz e resolvia o 7, que
quebra ("reading 'Intrinsic'"). `overrides` não resolve dependência *peer*; o
`eslint.config.js` registra um gancho de resolução (`module.registerHooks`) que aponta o
`typescript` pedido de dentro do `ts-api-utils` para o do frontend. Sai quando o
`typescript-eslint` suportar o 7.

**A exceção que ficou.** `useJanela` liga o `carregando` dentro do efeito que dispara a busca
(`set-state-in-effect`). A busca É o efeito; a saída de verdade é levar o hook para o React
Query, que cuida do carregando sozinho. Pendência, marcada no código com este número.

**O defeito que o E2E achou: a vizinhança gastava a cota de quem clica.** A API limita
`/api/*` a 300 pedidos/min por IP, num teto descrito como "só contra abuso grosseiro — não
deve incomodar uso normal". Medido numa abertura da `agendamento-field`: ~40 pedidos com
`origem=prefetch` (a vizinhança do #179), ~20 de pré-carga das outras 10 abas e ~15 da
própria página. No balde único, cinco aberturas num minuto já negavam layout, valores e SSE:
a aba não carregava. Corrigido em `fc42c96`: `origem=prefetch` conta num balde próprio
(600/min). O especulativo negado não custa nada a quem clica, e o teto continua finito —
declarar `prefetch` só rebaixa o pedido na fila. Teste em `seguranca.test.ts`, que falha sem
o balde.

**O que continua aberto (decisão do Erick).**
- A pré-carga das outras abas sai como pedido INTERATIVO (sem `origem`), ~20 por abertura.
  Marcá-la `prefetch` tira esses pedidos da cota de quem clica, mas também os põe atrás dos
  cliques na fila — mexe na decisão de prioridade de 08/09.
- **`CONFIA_PROXY` não está no `.env`.** Sem ele, a API conta pelo IP do socket; atrás de um
  nginx, todo mundo é o IP do nginx e divide os mesmos 300/min — umas 8 aberturas de página
  por minuto para a empresa inteira. Precisa estar ligado onde houver proxy reescrevendo
  `X-Real-IP` (o nginx de produção é do Misael).
- O próprio E2E gasta ~280 dos 300 interativos numa execução (janela fixa de um minuto, e
  na stack local todo navegador é o mesmo IP): uma execução por minuto, sem outra aba aberta.

## #183 — fase 6 do frontend (6a e 6b): tokens com uma fonte só, as primeiras primitivas em utilitário, e a régua de estilo computado (06/10)

**A decisão de escopo (Erick, 06/10): híbrido.** A raiz da tela é 14px (a régua da
densidade, `estilo.css`), então a escala do Tailwind não bate com os valores medidos
(`p-2` dá 7px, as fontes são 0,66rem, 0,7rem…). Converter tudo idêntico encheria as
classes de valor arbitrário e tiraria do CSS os comentários de medição; normalizar na
escala mudaria a tela inteira em 1–2px. Fica assim:
- **viram utilitário com token e `cn`** as peças simples e repetidas (selos, badges,
  botões, caixas de mensagem, cartão, estados, faixas);
- **ficam em CSS, de propósito,** a conta de altura (`--util`, `--h-*`), a grade das
  faixas, os gráficos SVG, as animações e as regras de layout medidas.

**6a — o `@theme` era uma cópia que divergiu.** Os tokens estavam em dois lugares: em
hexadecimal no `@theme` e nos papéis `--pbi-*` do `:root`/`.dark`. Nenhum componente usava
os utilitários do `@theme`, e a cópia divergiu sem ninguém ver: `gold-600` era `#8a6600` lá
e `#856200` no `:root` (o valor corrigido por contraste em 28/08); o escuro tinha nomes
próprios (`escuro-*`) em vez de redefinir os papéis. Agora o `@theme inline` só dá nome a
cada papel: `bg-pbi-primary` compila para `var(--pbi-primary)` e acompanha o `.dark` sem
`dark:`. CSS compilado idêntico byte a byte; o `casca.test.ts` barra valor copiado no
`@theme` e papel sem utilitário (as duas mutações falham).

**6b — selos, botões e caixas de mensagem.** `ui/Selo.tsx` (selo da faixa de
conferência e badge de status da tabela), `ui/Botao.tsx` (primário e secundário), `Erro` e
`Aviso` no `Cartao.tsx`; 116 linhas saíram do `estilo.css`. As ferramentas deixaram de
depender de classe de estilo: o sinal de "página pronta" de `entrada`, `perf`, `varre` e do
E2E passou de `.selo` para `[data-selo]`.

**A régua da fase 6.** Na fase 4 a prova era o HTML idêntico; aqui o HTML muda de propósito
(as classes). A prova é o **estilo computado**: com as respostas da API gravadas num HAR
(sem 429 — a gravação espaça as páginas por causa do limite do #182), cada elemento da
tela, identificado pela posição na árvore e não pela classe, tem todas as propriedades
computadas comparadas antes e depois, mais `::before`/`::after`, mais o `:hover` forçado
(CDP) em todo elemento com cursor de mão. 14 páginas × claro/escuro × 1366, 1920, 1024 e
390 de largura (as duas últimas exercitam os `@media` que as resoluções de referência não
alcançam), o diálogo de filtro aberto, e a tela de login medida à parte.

Resultado da 6b: **226.712 elementos, nenhuma diferença** além de duas já conhecidas:
- `rounded-full` é raio "infinito"; o `999px` de antes dava a mesma pílula;
- a altura medida do cartão de tabela das páginas `l-*` varia entre execuções — duas
  medições do build ANTIGO já diferem entre si nos mesmos elementos (e nas mesmas capturas).

Dois tropeços da própria régua, para não repetir: (1) o comparador casava o hover por
caminho num `Map`, mas o hover registra a subárvore, e o mesmo caminho aparece várias vezes
em estados diferentes — acusou 7 mil diferenças falsas; compara-se par a par, na ordem.
(2) Parar o `vite preview` em segundo plano matou a shell e não o processo: o "depois" foi
servido com o build antigo até se liberar a porta 4173 à mão — conferir o nome do pacote
servido antes de medir.

## #184 — fase 6c: a régua pegou uma classe do CSS sequestrando um utilitário, e virou ferramenta (06/10)

**O que entrou.** O cabeçalho do `Cartao` (faixa, título, subtítulo, ações e os controles
que cada visual põe nelas), `ui/IdVisual` e `visuais/kpi/partes` (moldura, nome, valor,
linha de origem/filtros), com `Sparkline`, `Bullet` e `Calendario`; 237 linhas saíram do
`estilo.css`. A moldura `.cartao`, as alturas `.v-*` e `.cartao-corpo` ficaram: são a
conta de altura, e `useAlturaMedida` procura a classe. O `varre` passou a achar visuais
por `[data-visual]`/`[data-id-visual]`.

**O defeito que a régua achou.** O calendário do KPI (`diario-instalacao`) saiu com 10px
entre os dias em vez de 2px, e os dias encolheram de 29,5 para 22,6px — o que mudava a
altura da faixa de indicadores inteira. Causa: o `estilo.css` tinha uma classe `.grid`
solta (`gap: var(--gap)`, e `.grid > * { min-width: 0 }`), com o mesmo nome do utilitário
`grid` do Tailwind. Classe fora de camada vence utilitário (`DESIGN-SYSTEM.md` § 1.2): o
`gap-[2px]` perdia. A `.grid` não tinha mais uso próprio — as `.linha-*` e a
`.faixa-principal` que a usavam já tinham morrido —, então o bloco saiu, e o
`KpiGridSection` e o esqueleto, que dependiam por acaso do `min-width: 0` dos filhos, o
declaram (`*:min-w-0 *:min-h-0`). O `casca.test.ts` barra classe do CSS com nome de
utilitário (a mutação falha).

**Prova:** 122 medições (com a tela de login), 226.744 elementos idênticos à 6b, exceto
o ruído medido — a altura do cartão de tabela das páginas `l-*` a 390px, que troca nos
dois sentidos, e o selo "ao vivo" da capa, que uma segunda medição da 6b também não tem.

**A régua virou ferramenta** (`npm run tela:regua`, `8044190`), com o que esta rodada
ensinou:
- **um contexto de navegador por largura sobrescrevia o HAR** (o Playwright escreve ao
  fechar o contexto): sobrava só a última largura, 15 MB em vez de 63. A medição da 6b
  (#183) usou esse HAR dos dois lados — a comparação foi justa, mas pedidos de outras
  larguras podem ter sido abortados nos dois. Agora é um contexto só, e a medição conta
  os pedidos fora do HAR;
- **a API reiniciou no meio de uma gravação** (`docker restart` às 17:59, de fora desta
  sessão; as sessões são em memória) e tudo depois virou 401, gravado em silêncio. A
  gravação agora falha com qualquer 401 ou 429;
- equivalências conhecidas, com teste: `rounded-full` × `999px`, e `background-position`
  quando não há imagem de fundo.

## #185 — fase 6d: os estados viraram componente, e a régua passou a forçá-los (07/10)

**O que entrou.** `ui/Estado.tsx`: `Esqueleto` (com `titulo` se anuncia — `aria-busy`,
"Carregando X…"; sem, é `aria-hidden`), `EsqueletoLinha` e `MensagemDeEstado` (o "sem
dados", o vazio da tabela e o "não carregou" com erro e botão; `como="div"` quando leva
bloco dentro). Saíram `.vazio-pagina`, `.sob-demanda`, `.esqueleto`, `.esqueleto-linha` e
`.kpi-esqueleto-linha`; ficou no CSS só o brilho que varre a barra (`.brilho::after`, com
o corte de `prefers-reduced-motion`), porque é animação. Teste de componente para o que a
régua não mede: quem se anuncia e com que tag sai a mensagem.

**A régua não via os estados.** Ela mede a tela já carregada, e o esqueleto e o "não
carregou" só existem antes dela ou quando algo falha. Pior: a abertura de hoje pede TODOS
os visuais de uma vez (`N_FAIXAS_EAGER = Infinity`, decisão "tudo pré-carregado"), então
`VisualNaDobra` não aparece nunca, e `SobDemanda` só quando o catálogo de projeção marca
uma tabela — nenhuma página do snapshot atual. Agora `mede` força, a 1366 e nos dois
temas, para as 14 páginas:
- `abrindo`: o pedido da página fica em voo → o esqueleto da página inteira, KPIs inclusive;
- `carregando`: a abertura responde RECORTADA (`recortaAbertura`, com teste: a segunda
  metade das faixas sai e o primeiro visual vira sob demanda) e o resto fica em voo →
  esqueleto do visual fora da dobra e do sob demanda, antes e depois de rolar;
- `falhou`: o resto responde 500 → "não carregou" com o `Erro` e o botão.

**Prova:** 234 medições, 269.022 elementos; todos os elementos de estado idênticos. As 51
diferenças são o ruído já conhecido (#184): a altura do cartão de tabela das páginas `l-*`
(280 ↔ 354px, nos dois sentidos — o MESMO build medido duas vezes dá 50 diferenças
iguais) e o selo "ao vivo" num diálogo.

**De passagem:** a suíte completa teve 4 falhas de tempo em `porta`, `prioridade-http` e
`reaquecimento` enquanto um `vite build` rodava junto; sozinhos, os 31 testes passam.
A API local estava degradada (os três grupos de atualização falhando seguido, servindo o
snapshot) — ligada fora desta sessão; não mexi.

## #186 — fase 6e: a casca em utilitários; a régua aprendeu que borda sem largura não desenha (07/10)

**O que entrou.** O topo (marca, título da tela, subtítulo e o aviso de dado velho), as
abas, o rodapé, o banner de saúde e a tela de login viraram utilitário em `AppShell`,
`NavDeTelas` e `Login`; as ações do topo e o fechar do diálogo de filtro usam
`ui/BotaoDeIcone` (`tom="primaria"` no diálogo: sem hover, como a regra
`.dialogo-topo .btn-icone` fazia ao vencer `.btn-icone:hover` por vir depois no arquivo).
As variantes de largura são `[@media(max-width:900px)]`, e não `max-[900px]`, que o
Tailwind traduz por `width < 900px` e mudaria a tela em exatamente 900px. A aba ativa não
leva o hover (antes `.aba.ativo` vencia `.aba:hover`). Ficaram no CSS a `.nav-telas` (a
altura dela é medida em `--h-nav`), o selo "ao vivo" e o giro do "Atualizar" (animações).

**CSS duplicado e morto.** `.cabecalho-titulo`, `.cabecalho-sub` e `.cabecalho-sub-aviso`
estavam declarados DUAS vezes, com valores diferentes (o subtítulo era 0,68rem na casca
e 0,72rem no bloco "cabeçalho", e o aviso vermelho num, dourado no outro); valia o que
vinha depois, e é ele que o componente reproduz. Saíram sem uso: `.cabecalho`,
`.carimbo-cabecalho` (e `.rot`/`.val`), `.selo-realtime`, `.ponto-pulso` e o `@keyframes
pulso`.

**Ferramentas.** A régua espera o login pelo texto, e o E2E acha as abas pelo papel
(`navigation` "Telas do relatório" → `button`), não pela classe. Nova equivalência, com
teste: cor e estilo de um lado de borda com largura zero dos dois lados não contam
(`border: 0` deixa `none`, `border-0` deixa `solid`; e `border-b border-pbi-borda` pinta
a cor nos quatro lados), inclusive pelos nomes lógicos (`border-block-start-*`).

**Prova:** 234 medições, 269.064 elementos; idênticos exceto 60 — a altura do cartão de
tabela das páginas `l-*` e o que a segue (área, rodapé), o ruído de #184/#185. As abas
com `:hover` forçado, o diálogo e o login: idênticos.

**Visto de passagem, sem mexer:** a 390px o selo "ao vivo" continua visível com o título
escondido e fica por cima dos botões do topo. A regra de 640px só escondia título e
subtítulo, nos dois builds — é anterior a esta fase.

## #187 — abaixo de 640px o topo fica só em ícone: o selo "ao vivo" e a página vazavam (07/10)

**O defeito, medido** (página `l-inst`, "Atualizar" clicado para o selo aparecer —
`useTempoReal.atualiza` marca a hora): o texto do selo "Ao vivo • hh:mm:ss" não quebra
linha, e a caixa dele encolhia com o título da tela; o texto passava por cima dos botões
do topo de 360 a ~520px. E, mesmo SEM o selo, o topo não cabia: a página rolava 34px na
horizontal a 390px e 64px a 360px (marca com texto + "Atualizar" com texto + cinco
botões). Os dois vêm de antes da fase 6: a regra de 640px só escondia título e subtítulo.

**A correção** segue o que as abas já faziam: abaixo de 640px a marca vira o círculo, o
selo vira o ponto verde e o "Atualizar" o ícone (`SO_ICONE` em
`components/layout/soIcone.ts`, `sr-only` por variante de mídia — o texto continua para
o leitor de tela, e o botão continua se chamando "Atualizar"). Medido depois: nenhuma
sobreposição e nenhuma rolagem horizontal de 360 a 1366px; de 641px para cima, as
posições são as mesmas de antes.

**Régua** (`visao-geral` e `l-inst`, as 4 larguras, os estados): só 390px tem estilo
diferente (44 elementos, os da marca, do selo e do botão); 1024, 1366 e 1920 idênticos,
com um elemento a mais em cada medição — o `span` do texto do "Atualizar".

## #188 — fase 6f: os filtros em componentes; régua e E2E sem classe de estilo (07/10)

**O que entrou.** `filtros/GatilhoDoFiltro` (o nome em cima e o botão com resumo e
contador — `Segmentacao` e `SegmentacaoDataHierarquia` repetiam os dois),
`ui/Dialogo` (fundo, faixa bordô com o fechar, corpo que rola, rodapé; também repetido
nos dois), `ui/Nota` (a nota pequena dos filtros, da paginação e da tabela), os chips
(agora `role="group"` com o nome do filtro e `aria-pressed` em cada chip), a pílula de
filtro sem segmentação e a árvore de datas. Saíram 350 linhas do CSS; ficou a `.filtros`,
que é sticky e tem a altura medida (`--h-filtros`). Detalhes que o CSS fazia por cascata e
o componente diz: o chip marcado e o dia marcado não levam o hover (a regra deles vinha
depois); o botão de remover da pílula tem `line-height: 0`; a caixa do dia some com `clip`
e não com o `sr-only` do Tailwind, que usa `clip-path`.

**Ganchos das ferramentas.** A régua e o E2E clicavam em `.filtro-botao`, `.dialogo`,
`.chip`, `.arvore-*`. Agora: `button[aria-haspopup="dialog"]`, `role="dialog"`, o
`group` do filtro de chips, `data-nivel="mes"`/`"dias"` na árvore e `aria-expanded` na
seta. A régua passou a medir, com `:hover` forçado a 1366, três diálogos em vez de um: o
de período como abre, o mesmo com um mês aberto (a grade de dias) e o de lista (busca,
opções, rodapé). Antes só o primeiro era medido, e sem hover.

**Prova:** 250 medições, 318.401 elementos; os filtros, chips, diálogos (com hover) e a
árvore, idênticos. As 54 diferenças são ruído: a altura do cartão de tabela das `l-*`
(#184) e o selo "ao vivo", que aparece num lado e não no outro nas medições de diálogo —
o SSE cortado pela régua reconecta sozinho e marca a hora em tempo variável; as medições
de diálogo, agora mais longas, o pegam mais. A pílula não aparece em nenhuma abertura de
página (só depois de um clique cruzado): medida à parte, com o clique cruzado nos dois
builds contra a API, nos dois temas e com o hover do remover — idêntica. E2E: 8 de 8.

## #189 — fase 6g: a capa em utilitários; a régua passou a abrir o histórico de versões (07/10)

**O que entrou.** A capa inteira — faixa com o gradiente e a marca, o selo de números
(que abaixo de 700px vira grade 2×2), os três blocos, a tabela das fontes, o histórico
de versões e o rodapé — saiu das 280 linhas `.capa*` do `estilo.css` para utilitário
sobre os tokens. Nada da capa tem altura medida, então nada dela ficou no CSS. Peças
internas do `Capa.tsx`: `NumeroDoSelo`, `Bloco` e `Lista`. O que o CSS fazia por cascata
e o componente agora diz: a última linha da tabela e a última versão não levam a borda e
o recuo de baixo (pelo índice, no lugar de `:last-child`); o `<b>` do corpo dos blocos sai
na cor de letra da primária (`[&_b]:`); o fio só aparece quando há versão seguinte. O halo
da versão-marco é `[box-shadow:…]` e não `shadow-[…]`: o utilitário de sombra do Tailwind
empilha camadas vazias e o estilo computado mudaria sem a tela mudar.

**A régua não via o histórico.** Ele abre recolhido, e o conteúdo de um `<details>`
fechado não tem caixa: a linha do tempo inteira (pontos, fios, selos de versão) ficava
fora de toda medição. A régua agora mede a capa também com o histórico aberto (`-versoes`),
com o hover a 1366.

**Prova.** Os dois CSS gerados, comparados regra a regra: saíram só regras `.capa*` e
entraram só utilitários que nenhum outro arquivo usava (se usasse, já estariam no build
anterior) — as outras páginas não mudam por construção, então a régua mediu só a capa
(`REGUA_PAGINAS=capa`): 26 medições (4 larguras × 2 temas, como abre e com o histórico
aberto, os estados forçados e o login), 8.618 elementos, todos idênticos; ruído da capa
(antes × antes): zero. A régua não mede `::marker`: conferido à parte, o marcador das
listas sai dourado e em disco nos dois temas, como antes.

**De passagem.** Dois arquivos de teste do backend que sobem worker ou servidor
(`overlay-worker`, `seguranca`) caíram inteiros numa rodada completa e passaram sozinhos
e na rodada seguinte — a mesma família de teste sensível a carga de `porta`,
`prioridade-http` e `reaquecimento`.

## #190 — `useJanela` no React Query; a tabela voltava ao começo ao cruzar a fronteira da fatia (07/10)

**A pendência da fase 5 (#182).** O hook da paginação de tabela e matriz guardava à mão um
contador de sequência (resposta atrasada não pinta por cima da nova), "de qual termo é o
que está na tela" e um efeito que pedia ao ver o termo mudar — com dois `eslint-disable`.
Agora cada janela é uma chave sob `['pagina', id]`: a resposta fica na chave dela, o pedido
de uma chave abandonada é cancelado pelo `signal` (digitar a busca cancela as buscas do
meio), voltar a uma janela já vista não pede de novo, e o aviso do servidor invalida as
janelas junto com a página. A primeira janela sem busca continua sendo a própria resposta
da página — nenhum pedido. De passagem, um 401 numa janela agora leva ao login, como em
todo o resto (antes virava mensagem de erro dentro da tabela). O frontend ficou sem
nenhum `eslint-disable`.

**O defeito antigo.** A `Tabela` desenha 20 de cada 200 linhas e voltava a página local
ao começo sempre que a fatia de 200 mudava — inclusive quando quem pedira a fatia era ela.
"anterior" a partir da linha 201 mostrava 1–20, e não 181–200; e, enquanto a fatia nova
não chegava, a tela já pulava para o começo da fatia velha. Reproduzido com o hook antigo
e com o novo antes de corrigir. Agora a tabela guarda onde quer cair e aplica quando a
fatia chega; até lá, as linhas atuais ficam.

**O que a tela pegou e o teste não.** Na primeira versão, o pedido que perdia a validade
(o termo mudou) era só ignorado; quando o termo voltava ao de antes — limpar a busca —, ele
ressuscitava e a tabela voltava à linha 201. Pego na tela, contra a API (`protocolos-
detalhados`, 3.160 linhas); agora o pedido é descartado no render, e virou teste.

**Prova.** `test/janela-consulta.test.tsx` (5 testes do hook com `fetch` falso: abertura
sem pedido, janela seguinte mantendo a atual até chegar, busca abandonada cancelada e sem
pintar por cima, página recalculada e busca limpa voltando ao começo) e o teste da
fronteira na `componentes-tabela`. Na tela, contra a API: 10× "próxima" → 201–220;
"anterior" → 181–200; "próxima" de novo sem pedido; busca, busca sem acerto ("Nenhuma linha
para esta busca."), busca limpa → 1–20; nenhum erro no console.

## #191 — falha de rede virava dado parado; a stack ficou 24 h só com a `api` (07/10)

**O que se viu.** VISÃO PRODUTIVA sem nada novo em 07/10, `medio` e `frio` "falhando seguido
— saiu com código 1" em `/api/saude`, e 2.280 linhas `Redis desligado do caminho` no log da
API. `docker ps`: só a `api` de pé; `refresh`, `redis`, `proxy` e `snapshot-diario` parados
havia 24 h.

**A cronologia (horário RS; o log do Docker Desktop é a prova das paradas).**
- 06/10 16:32 e 17:08: `quente` falha — `contratos` com `Connection terminated unexpectedly`
  no meio da query; depois `connect ETIMEDOUT` e `fetch failed` (Google) **no mesmo minuto**.
  `medio` e `frio` passam entre as duas: era a rede da estação, não uma query.
- 17:53–18:21: tudo falha com `ECONNREFUSED 186.219.128.248:5432` **em 21 s** — o SYN sem
  resposta do Windows, não uma recusa do Postgres. A `api` falhou igual no poller. Com 2–3
  falhas seguidas, a espera crescente adiou os grupos (teto 4 h).
- 18:29: `ContainerStopComposeLinux` ×5 — um `docker compose stop` deliberado. **A queda do
  banco não derrubou nada.**
- 07/10 08:45: `ContainerStartOthersLinux` ×1 — só a `api` religada (botão Start do Docker
  Desktop ou `docker start`). Esses caminhos ignoram `depends_on`: o `redis` ficou de fora.
- 07/10 18:36: `docker compose start`; Voalle respondendo de dentro da rede do compose; o
  `quente` passou na primeira volta.

**Os defeitos de código, e o que mudou.**
1. *Uma conexão cortada derrubava o grupo.* O materializador repete uma vez, depois de 15 s,
   a query que falhou por rede (`ehFalhaTransitoria`, `backend/packages/snapshot/src/erro.ts`).
2. *Falha de rede entrava na espera crescente.* Ela existe para defeito que se repete igual
   (#153); para banco inalcançável, o teto de 4 h seria dado parado DEPOIS da rede voltar.
   Quando TODA falha da execução é de rede, o materializador sai com **75** (`EX_TEMPFAIL`),
   o resultado do grupo leva `transitoria`, e `proximaTentativa` não freia: tenta todo ciclo.
   A decisão é pelo código de saída, não por texto do log.
3. *O daemon de produção perdia a causa.* Tinha executor próprio (`spawnSync`, `stdio:
   'inherit'`) e gravava só `saiu com código 1` — o defeito que a API consertou em #129. O
   daemon e o `npm run refresh` agora usam `rodaGrupoAssincrono`, o mesmo da API.
4. *"Falhando seguido" com o agendador morto.* Um grupo fora da espera crescente que não
   tenta há mais de 2× o intervalo agora sai **parado desde** o último sucesso — que é a
   pista certa: ninguém está rodando.
5. *Uma linha por abertura do disjuntor.* Com o Redis parado, o circuito reabre a cada sonda
   de 10 s. Agora é uma linha por queda e uma na volta; a contagem fica em `/api/saude`.

**O que NÃO é código, e fica com quem opera.** Parar a stack e religar um contêiner só, pelo
Docker Desktop ou pelo Portainer, pula `depends_on`. Religar é sempre `docker compose -f
docker-compose.prod.yml start` (ou `up -d`), nunca o botão de um contêiner. O defeito 4 é o
que faz isso aparecer em `/api/saude` em até 2× o intervalo, e não em `docker ps`.

**Prova.** Testes novos em `erro.test.ts` (as quatro mensagens literais de 06/10 são de rede;
statement timeout, heap, M e senha errada não são), `tick.test.ts`, `executa-grupo.test.ts`
(75 → `transitoria`), `status.test.ts` (o `refresh-status.json` real de 07/10 sai "parado
desde 19:43 UTC"; na espera crescente continua "falhou") e `cache-disjuntor.test.ts` (o teste
antigo afirmava uma linha por abertura — o defeito). Materializador contra porta fechada:
`FALHOU (1246 ms, rede) — de novo em 15s… FALHOU`, saída 75; com variável faltando no `.env`,
saída 1 e sem repetir. Um ciclo real do daemon (`--so-uma-vez`, numa worktree sem `.env`, Voalle
numa porta fechada): `frio`, só Voalle, saiu 75 e gravou `transitoria: true` com a causa no
`refresh-status.json`; `quente` e `medio`, com falha de configuração do dbMaria e do Google
misturada, saíram 1 e sem `transitoria` — falha mista continua freada.

## #192 — o "Produtivo" ao vivo entra só na `Status Protocolo Dia`, e só soma (09/10)

**PLANO-MESTRE §A.1.** O "Produtivo" é `PROTOCOLOS GERAL[DATA INSTALAÇÃO]`, DAX sobre
`DATA ALOCAÇÃO` (#167). Pôr a PG no poller foi descartado de novo: SQL + quatro junções em M
(uma no MariaDB) + `Table.Distinct`, 95 mil linhas, e ela alimenta 12 das 14 páginas.

**O desenho.** `alocacao-patrimonio` entra no poller como tabela que **não existe no modelo**:
nenhuma página a carrega, nenhum overlay físico a recebe. A tradução nativa de `Status
Protocolo Dia` declara `aoVivo: ALOCAÇÃO PATRIMONIO` (`nativas.ts`) e o `carrega.ts` a lê
chamando o mesclador com o disco vazio. O par ao vivo só **soma**: preenche protocolo que a
carga conhece **sem** data de instalação; protocolo já instalado na carga, ou fora dela
(cancelado), fica como a carga diz. A carga de 30 min continua sendo a verdade. Por isso a
chave fraca da alocação (vários itens por solicitação, o motivo de ela ter ficado fora do
poller) não erra linha: o overlay nunca é mesclado em tabela. Troca de endereço sai na
costura (`it.id <> '15'`), porque nela vale `DATA DA TROCA`.

**Roteamento.** `planeja` lista só a query que vira tabela, e `alocacao-patrimonio` entra na
PG pelo M: medido, ela está no fechamento de **0 de 14** páginas. Sem roteamento próprio o
aviso não chegaria a tela nenhuma. `calculadasAlimentadasAoVivo` liga a tabela à calculada,
e o servidor entrega o overlay e invalida só quem carrega `Status Protocolo Dia`: hoje, a
`agendamento-field`.

**Custo, medido em 09/10 (só leitura).** A consulta costurada leva **~1 s** (964–1195 ms), o
mesmo com janela de 1 h ou 24 h: sem índice em `created`/`modified`, é varredura — o #167
tinha 0,2 s. Intervalo de **60 s**: o processo já atrasa a alocação ~41 min depois do relato
(#167), então 30 s a mais não aparecem, e o banco ganha 1 min/h. Efeito no mesmo minuto: 13
min depois da carga das 10:42 RS, 115 protocolos com alocação em 24 h, **4** ainda sem data
na carga — esses ganham a instalação na hora (viram Produtivo no slot do mesmo dia).

**Prova.** `nativas.test.ts` (soma onde a carga não sabe; não mexe no instalado nem no
cancelado; vários itens vale a primeira saída; item sem data não cria par),
`carrega-parcial.test.ts` (recalcular só as chaves ao vivo dá a tabela inteira com elas) e
`aviso-das-paginas.test.ts` (a mudança da alocação avisa só `agendamento-field`; a da PG,
mais de 5 páginas). Costura validada contra o SQL da spec (âncora única, cita `:desde`).
**Falta a §A.3:** ligar na stack e conferir contra a carga completa da mesma hora.

## #193 — o grupo de 15 min rodava a cada 30: o sucesso contava do fim (09/10)

**O que se viu.** `/api/saude` acusando "grupo quente parado desde 14:06" às 14:37 UTC, sem
falha nenhuma. O log: `quente` terminou às 14:06:16, 52 s depois do tick das 14:05:23; no
tick das 14:20:23 faltavam **53 s** para 15 min desde esse fim, e o grupo foi pulado — só
rodou às 14:35. Cada execução empurrava a seguinte para depois do próximo tick: o `quente`
(15 min) rodava a cada 30, e o `medio` (30 min, ~11 min de carga) a cada ~45. O alarme de
"parado" (2× o intervalo) ficava piscando exatamente na borda.

**Correção (`tick.ts`).** `ultimoSucesso` passa a ser o **início** da execução (fim menos
duração): o dado é a fonte de quando a leitura começou. E `estaVencido` ganha uma folga de
60 s (`FOLGA_DE_VENCIMENTO_MS`): o tick dispara a cada intervalo contado do tick e o grupo
começa alguns ms depois dele, então no tick seguinte faltariam esses ms. `ultimaTentativa`
continua no fim — a espera crescente segue contando da tentativa. O agendador da API usa o
mesmo `proximoStatus` e herda a correção.

**Prova.** `tick.test.ts`: o caso de 09/10 (grupo de 52 s começando 5 ms depois do tick)
vence no tick seguinte, e 13 min depois continua não vencido.

**De passagem, achado e NÃO corrigido aqui.** Com overlay do tempo real, o pedido da página
inteira **sem** `?visual=` carrega o grão reduzido da `FIELD AGENDA` (`projecao.yaml`), a
tradução nativa de `Status Protocolo Dia` recusa por falta de `data relato`,
`categoriaprodutividade` e `skill`, e a worker cai para o cálculo em linha (thread
principal): `[worker] caiu para cálculo em linha` às 14:37:40 UTC, uma vez em 40 min. É o
mesmo defeito que `calculaValores` já fechou unindo os visuais da página (comentário em
`servidor.ts`); o caminho da página ainda não. Não é da §A.1 (a `FIELD AGENDA` ao vivo já
disparava), e a correção muda a carga do aquecedor nas 14 páginas — precisa de medida de
memória antes.

## #194 — o visual da VISÃO PRODUTIVA voltava como erro: grão reduzido com recálculo ao vivo (09/10)

**Medido na stack, 14:45 UTC.** `GET /api/dashboards/agendamento-field?visual=04979b00e5329b67f349`
(só a VISÃO PRODUTIVA — é como a tela pede o que está abaixo da dobra) devolveu o visual com
**erro**, três vezes seguidas, em 3–8 s: `Status Protocolo Dia (nativa): 'FIELD AGENDA' chegou sem
data relato, categoriaprodutividade, skill`. A página inteira sem `?visual=` servia a "última
pronta" de 14:00 (Produtivo 37) às 14:45, com o arquivo da carga das 14:39 já em 52 — o cálculo
novo daquela chave falhava pelo mesmo motivo.

**A causa.** A forma completa de um pedido é a que os visuais PEDIDOS amarram. A VISÃO PRODUTIVA
não lê a `FIELD AGENDA` direto (lê `Status Protocolo Dia`), então ela vinha no grão reduzido
(`projecao.yaml`), sem as colunas que a tradução nativa lê. Com o tempo real tocando uma fonte
da calculada, a tradução recusa — corretamente — e o visual cai.

**A §A.1 (#192) piorou.** Antes, só o overlay da `FIELD AGENDA` disparava o recálculo, e ele é
podado a cada carga (`cobertoAte`): havia janelas sem overlay, em que a calculada vinha do
arquivo. O overlay da alocação só é podado pelo teto de 48 h — o recálculo passou a disparar
sempre, e a falha também.

**Correção (`servidor.ts`).** Página que carrega calculada com recálculo ao vivo
(`recalculosAoVivo`, de `nativas.ts`) leva as fontes dela na forma completa, em todo pedido.
**Sem depender de haver overlay naquele instante:** a forma completa entra na chave do cache, e
variar com o overlay daria duas chaves para a mesma página. Alcance medido: `agendamento-field`
(`calendar` e `Status Protocolo Dia` → `FIELD AGENDA` e `PROTOCOLOS GERAL`; a maioria dos pedidos
dela já carregava a `FIELD AGENDA` completa) e `relatorio-do-mes` (`calendar` → `FIELD AGENDA`),
que tinha o mesmo defeito latente. Fecha também o "de passagem" do #193.

**Prova.** `valores-na-worker.test.ts`: `?visual=` da VISÃO PRODUTIVA manda `FIELD AGENDA` e
`PROTOCOLOS GERAL` na forma completa. Na stack, depois do deploy das 14:55 UTC: o mesmo
`?visual=` saiu **sem erro** — 5,2 s frio, depois 10–63 ms em cache —, com Produtivo de 09/10 em
**59** contra 52 do arquivo das 14:39 (alocações que chegaram depois). `agendamento-field`: 39
visuais, 0 com erro; `relatorio-do-mes`: 36, 0 com erro, carga fria de 3,0 s já na forma
completa; 0 quedas para cálculo em linha; RSS 2.383 MB, `/api/saude` sem degradação.
