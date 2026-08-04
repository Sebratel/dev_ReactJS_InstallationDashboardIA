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

**Quem usa.** Uma medida, confirmada: **`# MEDIA CRIADOS`** em
`specs/_catalog/measures/protocolos-geral.measures.yaml` (tabela `PROTOCOLOS GERAL`).
Ela exclui domingos e feriados dos dois lados da divisão:

```dax
VAR Total_Criados     = ... WEEKDAY(...) <> 7 && NOT([DATA CRIADO] IN 'FERIADOS'[Data])
VAR Dias_Uteis_No_Mes = ... WEEKDAY(...) <> 7 && NOT([DATA CRIADO] IN 'FERIADOS'[Data])
```

**Por que importa.** Em 2026 nenhum feriado é reconhecido, então um feriado em que
alguém tenha criado protocolo entra em `Dias_Uteis_No_Mes` como dia útil. O
denominador infla e **a média de protocolos criados por dia útil sai subestimada**
nos meses com feriado. O número que a operação vê hoje já está errado — e não por
nossa causa.

**Decisão pendente (Erick).** Ao reimplementar `# MEDIA CRIADOS` na Fase 2:

- **(a) replicar fiel**, feriados parando em 2025 — mantém paridade exata com o
  Power BI, inclusive no erro. É o default do projeto.
- **(b) corrigir**, carregando feriados 2026+ — o número vai **divergir** do
  Power BI de propósito, e a divergência precisa ser registrada para não parecer
  bug de paridade.

Enquanto não houver decisão, a Fase 2 segue **(a)** e marca a medida como afetada.
Vale também avisar quem usa o Power BI hoje: atualizar a tabela FERIADOS lá dentro
conserta o número atual independentemente da plataforma nova.

**Melhoria sugerida (fora da paridade).** Feriado é dado que muda todo ano e hoje
mora dentro de um arquivo de 73 MB. Vale virar tabela de verdade (ou uma fonte
oficial) em vez de blob embutido — mas isso é evolução, não replicação.

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

## 5. Quando o `.pbix` pode ser removido

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
| Paridade provada contra dados reais | ⏳ depende de `npm run validate:queries` |
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
