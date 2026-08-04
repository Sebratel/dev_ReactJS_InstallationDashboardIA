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

## 2. Quando o `.pbix` pode ser removido

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
