# Agregar `FIELD AGENDA`: o que a medição refutou, e o que sobra

> **12/08/2026.** O passo 4 da `DECISAO-DESEMPENHO` diz: agregar `FIELD AGENDA` ao
> grão `(protocolo, slot)` no SQL, 1.458.244 linhas → 30.252. Este documento existe
> porque a análise de quem consome a tabela **refuta essa versão do passo**, e o
> caminho que sobra é diferente do que estava escrito.

## Por que a tabela tem 1,46 milhão de linhas

A query é, em uma linha:

```sql
FROM v_service_desk_slots_productivity_informative vsdspi
LEFT JOIN reports r ON vsdspi.assignment_id = r.assignment_id
LEFT JOIN people p  ON p.id = r.person_id
LEFT JOIN skills s  ON s.id = ps.skill_id
```

O grão real é **(slot, relato)**, não (protocolo, slot). Cada agendamento tem vários
relatos, e é o `LEFT JOIN reports` que multiplica.

E o corte é limpo, o que é a boa notícia deste documento:

| origem | colunas | grão |
|---|---|---|
| `vsdspi` | Protocolo, Tipo de Protocolo, Status Protocolo, Base, Instalador, Data Criado, Prazo SLA, **Slot Agenda** | **slot** |
| `r`, `p`, `s` | **Descrição**, **Relato**, **Data Relato**, Relator, Skill | **relato** |

As colunas calculadas herdam o grão da origem: `Turno` e `Status SLA` saem de
`vsdspi` (grão de slot); `ClassificacaoRelato` e `CategoriaProdutividade` saem do
texto do relato (grão de relato).

## O que cada visual precisa — e é aqui que o passo 4 cai

Levantado das especificações extraídas, não de leitura de DAX à mão:

| visual | custo | colunas cruas | grão exigido |
|---|---|---|---|
| `e2d5549b` | **24,5 s** | Slot Agenda, Turno, Tipo de Protocolo, Base, RankDataProtocolo, Status Protocolo | **slot** ✅ |
| `084be384` | **8,8 s** | Protocolo, Data Relato, Descrição, CategoriaProdutividade, ClassificacaoRelato | **relato** ❌ |
| `815c0959` | (sob demanda) | + Relato | **relato** ❌ |
| `0c0223c6` | 1,9 s | Status SLA | slot ✅ |
| `ae5871aa` | 1,5 s | Protocolo, `max(ClassificacaoRelato)` | agregável ✅ |
| `670ac661`, `6ffe2103`, `dde5aa90` | slicers | CategoriaProdutividade, ClassificacaoRelato, Descrição | **relato** ❌ |
| `e7998ec5` | slicer | Status Protocolo | slot ✅ |
| `116ebf72`, `4ed2f950`, `a88b3232`, `bc2c33d2` | cards | só medidas (`DISTINCTCOUNT`) | qualquer ✅ |

**O maior visual, o de 24,5 s, precisa só do grão de slot.** O segundo, de 8,8 s,
precisa do grão de relato. Agregar a tabela inteira serve o primeiro e **apaga** o
segundo — o passo 4, como está escrito, troca uma lentidão por um número errado.

## Por que "só desligar as colunas de relato" não resolve

O mecanismo de coluna sob demanda já existe (`liberaSobDemanda`, usado hoje para
`Relato`, 350 MB). Mas ele governa **coluna**, não **linha**: sem carregar
`Descrição`/`Relato`, o arquivo continua com 1.458.244 linhas — as mesmas linhas,
com menos campos. A economia é de memória, não de varredura.

E deduplicar na carga, quando as colunas de relato não vêm, **muda número em
silêncio** — que é a única classe de erro que este projeto não aceita:

- `DISTINCTCOUNT('FIELD AGENDA'[Protocolo])` sobrevive à deduplicação;
- `Protocolo:count` de `0c0223c6` e `084be384` é **contagem de linha**, e cai junto.

Ou seja: deduplicar em silêncio faz `Protocolos Manhã` continuar certo e
`Qtd` mudar, sem aviso. É exatamente o tipo de conserto que o ACHADOS #58 acabou de
mostrar quanto custa.

## O que sobra, então

Duas linhas de ação, nesta ordem:

### 1. Grão sob demanda, não só coluna sob demanda

Extensão do que já existe: a query passa a ter **duas formas**, e qual delas roda
depende de o pedido tocar ou não coluna de grão de relato.

- forma **slot** (padrão): `vsdspi` sem o join de `reports` → ~30 mil linhas
- forma **relato** (sob demanda, por `?visual=`): a query de hoje, inteira

Isso serve `e2d5549b` (24,5 s), `0c0223c6`, `e7998ec5` e os quatro cards — a maior
parte do custo — e deixa `084be384` e os três slicers pagando o grão fino, que é o
que eles de fato precisam.

O roteamento por visual **já existe** (`sobDemandaDoVisual`, `servidor.ts:491`), e a
chave de cache já inclui o conjunto de colunas liberadas (`servidor.ts:465`). O que
falta é a query saber responder em dois grãos.

### 2. Onde o SQL escrito à mão vai morar

`specs/_catalog/queries/*.spec.yaml` é **sobrescrito** por `npm run extract`
(regra 2). A forma agregada é decisão humana e não pode morar lá. Vai em
`specs/_catalog/sql-override.yaml`, no mesmo molde de `cache-policies.yaml` e
`divergencias.yaml`, com `original_sha` da expressão M que ela substitui — sem isso,
alguém mexe no Power Query, a extração traz a versão nova, e o override continua
aplicando um SQL decidido contra outra consulta.

## Antes de escrever qualquer SQL: medir de novo

O ACHADOS #58 consertou o fuso, e o snapshot foi rematerializado em 12/08. Isso muda
o custo de `agendamento-field` de um jeito que **não dá para prever pelo sinal**:

- a junção `CALENDARIO INSTALADO` × `PROTOCOLOS GERAL` estava **morta** (zero datas em
  comum) e voltou a casar — mais linhas casando pode custar **mais**, não menos;
- `Turno` deixou de jogar 1,46 milhão de linhas num único balde, o que muda o
  comportamento do índice de igualdade.

Os 24,5 s e 8,8 s deste documento são de **antes** da rematerialização. Remedi-los
sem remedir seria repetir o erro que o #59 registra três vezes: *medir a parte que se
suspeita não é medir onde o tempo vai.*
