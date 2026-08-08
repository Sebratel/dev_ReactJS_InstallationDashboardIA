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

- **Sem sidebar.** O `DESIGN-SYSTEM.md` v2 diz que esta página abre dentro do
  AppShell do HUBBI: a navegação principal e o header de 52px são de lá. Desenhar
  uma sidebar aqui seria inventar uma navegação que a plataforma real já tem.
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
