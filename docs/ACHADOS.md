# Achados que precisam de decisão humana

Coisas descobertas ao ler a base atual que **não** são bug do código novo — são
comportamento do Power BI de hoje, ou dependências dele. Ficam aqui porque
`specs/` é sobrescrito por `npm run extract` e nenhuma decisão humana pode viver lá.

---

## 1. A tabela FERIADOS para em 2025

**Evidência.** Os feriados são dados embutidos no `.pbix` (não vêm de banco). O
extrator preservou o blob no `m_expression` de `specs/_catalog/queries/feriados.spec.yaml`.
Decodificando (Base64 → deflate raw → JSON): **85 linhas, de 01/01/2022 a
04/03/2025**. Nenhum feriado de 2026.

```bash
node --input-type=module -e "
import fs from 'node:fs'; import zlib from 'node:zlib'; import {parse} from 'yaml';
const s = parse(fs.readFileSync('specs/_catalog/queries/feriados.spec.yaml','utf8'));
const b64 = /Binary.FromText\(\"([^\"]+)\"/.exec(s.m_expression)[1];
console.log(JSON.parse(zlib.inflateRawSync(Buffer.from(b64,'base64')).toString()).length);
"
```

**Quem usa: 11 das 78 medidas.** Da primeira leitura eu tinha registrado uma só
(`# MEDIA CRIADOS`). O alcance real só apareceu quando o extrator passou a
extrair o DAX das colunas calculadas (ver achado 6): a coluna **`PESO`** —
que existe em `CALENDARIO INSTALADO` e em `CALENDARIO CRIADO` — consulta
FERIADOS, e oito medidas somam essa coluna.

```dax
// CALENDARIO INSTALADO[PESO]
VAR Feriado = NOT(ISBLANK(LOOKUPVALUE(FERIADOS[Feriado], FERIADOS[Data],
                                     'CALENDARIO INSTALADO'[DATA INSTALADO])))
RETURN IF(Feriado, 0, SWITCH('CALENDARIO INSTALADO'[DIA_SEMANA], "domingo", 0, 1))
```

Fecho transitivo, reproduzível por `npm run validate:model` + o script do fim
desta seção:

| Caminho | Medidas |
|---|---|
| Direto em FERIADOS | `# MEDIA CRIADOS` |
| Somam `[PESO]` | `# PROJEÇÃO`, `# MEDIA AGENDADO`, `# PROJEÇÃO AGENDADA FUTUROS`, `# PROJEÇÃO AGENDADA RESTANTE`, `# MEDIA INSTALADO BACKLOG`, `# MEDIA INSTALADO MENSAL`, `#DIAS_ÚTEIS_TRABALHADOS`, `DIAS_ÚTEIS_RESTANTES_NO_MÊS` |
| Via outra medida afetada | `# PROJEÇÃO AGENDADA TOTAL`, `# BACKLOG` |

**Por que importa.** Em 2026 nenhum feriado é reconhecido. Em `# MEDIA CRIADOS` o
feriado entra em `Dias_Uteis_No_Mes` como dia útil; em `PESO` o feriado recebe
peso 1 em vez de 0. Nos dois casos **o denominador infla e a média sai
subestimada** nos meses com feriado — e as projeções, que multiplicam a média
pelos dias restantes, herdam o erro. O número que a operação vê hoje já está
errado, e não por nossa causa.

**Decisão pendente (Erick).** Ao reimplementar as 11 medidas na Fase 2:

- **(a) replicar fiel**, feriados parando em 2025 — mantém paridade exata com o
  Power BI, inclusive no erro. É o default do projeto.
- **(b) corrigir**, carregando feriados 2026+ — o número vai **divergir** do
  Power BI de propósito, e a divergência precisa ser registrada para não parecer
  bug de paridade.

Enquanto não houver decisão, a Fase 2 segue **(a)** e marca as 11 como afetadas.
Vale também avisar quem usa o Power BI hoje: atualizar a tabela FERIADOS lá dentro
conserta o número atual independentemente da plataforma nova.

**Melhoria sugerida (fora da paridade).** Feriado é dado que muda todo ano e hoje
mora dentro de um arquivo de 73 MB. Vale virar tabela de verdade (ou uma fonte
oficial) em vez de blob embutido — mas isso é evolução, não replicação.

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

**Decisão pendente.** Confirmar com quem usa o relatório se a coluna `Skill` é
realmente necessária nessa granularidade. Se for só para exibir, o caminho é
agregar (`string_agg`) em vez de multiplicar. Mas é mudança de comportamento —
não fazer sem decisão.

---

## 3. `base-categorias-field` tem data fixa no SQL

`where ai.beginning_service_date > '2026-01-01'` — data **hardcoded**, não
relativa. Em 2027 a query vai continuar trazendo tudo desde jan/2026 e crescendo
para sempre. Hoje são 233 mil linhas.

Mesma família de problema do achado 1 (FERIADOS): valor de calendário chumbado
no artefato. Vale revisar as 18 queries à procura de outros — mas como mudar o
filtro muda o resultado, entra como decisão, não como correção.

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
`'Tabela'[Coluna]` e `[Medida]` das 78 medidas e das 43 colunas calculadas
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

**Decisão pendente (Erick).** O default do projeto é replicar fielmente, mas não
há o que replicar: uma medida que referencia tabela inexistente não tem
resultado. Três caminhos:

- **(a) não reimplementar** e a Fase 2 entrega **75 medidas**, registrando as 3
  como mortas. É a recomendação.
- **(b) consertar**, apontando para `CAPACIDADE EQUIPE` — mas aí a plataforma
  passa a mostrar um número que o Power BI nunca mostrou, e alguém precisa
  validar se o número faz sentido para a operação.
- **(c) confirmar com quem manteve o relatório** se essas medidas eram de um
  painel descontinuado.

Vale avisar quem usa o Power BI: dá para apagar as três de lá também.

O teste `specs reais: só as 3 referências quebradas já conhecidas` em
`packages/semantic-model/test/model.test.ts` trava essa lista. Se uma quarta
aparecer no PBIP, o `npm test` falha e aponta para cá.

---

## 7. `PESO` e `# MEDIA CRIADOS` discordam sobre quanto vale um sábado

**Evidência.** Duas definições de "dia útil" convivem no modelo.

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

Isso empilha com o achado 1 **na mesma direção** — feriado contado como dia útil
*e* sábado contado como 1,5 — então `# MEDIA CRIADOS` é a medida mais subestimada
do modelo.

**Decisão pendente (Erick).** Qual das duas definições é a correta para a
operação? Enquanto não houver resposta, a Fase 2 replica as duas como estão
(default do projeto) e marca a divergência. É pergunta para quem usa o número,
não para o código.

---

## 8. O extrator estava perdendo DAX e relacionamentos (corrigido)

Não é decisão pendente — fica registrado porque explica por que as specs
mudaram de tamanho e porque os achados 1 e 7 só apareceram agora.

O TMDL delimita expressão multi-linha com ``` ``` ```. O extrator não removia a
cerca e não descia no corpo dela. Três consequências:

| Problema | Efeito |
|---|---|
| Cerca no DAX | 33 medidas e 11 colunas começavam e terminavam com ` ``` ` — parser de DAX morre na linha 1 |
| Corpo de coluna calculada descartado | **43 colunas calculadas** gravavam `calculated: true` e nenhuma expressão. `PESO`, que carrega a regra de dia útil de 8 medidas, tinha o DAX inteiro perdido |
| `relationships.tmdl` nunca lido | **22 relacionamentos** fora das specs. Sem eles não há como avaliar medida que cruza tabelas (`CALENDARIO INSTALADO` filtrando `PROTOCOLOS GERAL`) |

Corrigido em `tools/extractor/src/tmdl.mjs`, com teste para cada caso. O
`specs/_catalog/relationships.yaml` é novo, e as specs de tabela agora têm o
campo `dax` por coluna.

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
| DAX das colunas calculadas | ✅ 43 colunas (ver achado 8 — faltava até agora) |
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
