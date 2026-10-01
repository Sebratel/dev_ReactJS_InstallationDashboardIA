# Agregar `FIELD AGENDA`: o que a medição refutou, e o que sobra

> ## ✅ DECIDIDO E ENTREGUE — 02/09/2026
>
> **Este documento termina em "a escolha é do Erick", e a escolha já foi feita há
> muito.** Ficou assim por treze dias, e quem o abrisse em 15/09/2026 leria uma
> decisão aberta que não existe mais — por isso este cabeçalho.
>
> **Escolhida a saída A**, numa forma melhor do que a descrita lá embaixo: não são
> cinco visuais sob demanda, é **uma tabela do modelo com dois arquivos de snapshot
> trocados por baixo**, com escalada automática por coluna-gatilho. `FIELD AGENDA`
> abre em `field-agenda-slot` e passa para `field-agenda` quando um visual toca uma
> das 7 colunas-gatilho.
>
> * commit `7521cc3`, [ACHADOS](./ACHADOS.md) #87
> * `specs/_catalog/queries/field-agenda-slot.spec.yaml` — a query nova, com o
>   `EXISTS` exatamente como este documento exigiu (ver *o `LEFT JOIN` que é `INNER`*)
> * `specs/_catalog/projecao.yaml`, bloco `grao_reduzido` — `decidido: '2026-09-02'`
> * fiação: `packages/semantic-model/src/projecao.ts`, `packages/snapshot/src/carrega.ts`,
>   `apps/api/src/servidor.ts` (`amarraGraoReduzido`)
>
> **O `specs/_catalog/sql-override.yaml` que este documento mandava criar não
> existe, e não deve existir** — a solução foi uma spec de query própria, que é
> melhor: o SQL fica onde toda query mora, e não num arquivo de exceção.
>
> **Auditado contra o disco em 15/09/2026.** O fator não expirou: hoje são **48,30x**
> (639.427 linhas, 13.238 pares `(protocolo, slot agenda)` distintos). Colhidos
> **15,4x** (639.427 → 41.505). Os **3,14x** restantes são inalcançáveis sem mudar
> número, e a razão é exatamente a que este documento previu: `Instalador` (1,875x),
> `Reagenda` (1,985x) e `Base` (1,064x) variam DENTRO do par. O único resíduo é
> limpeza — `Inicio relato` e `Fim relato` não são lidos por visual nem medida
> nenhuma, e valem 1,07x.

> **12/08/2026.** O passo 4 da `DECISAO-DESEMPENHO` diz: agregar `FIELD AGENDA` ao
> grão `(protocolo, slot)` no SQL, 1.458.244 linhas → 30.252. Este documento existe
> porque a análise de quem consome a tabela **refuta essa versão do passo**, e o
> caminho que sobra é diferente do que estava escrito.

## Por que a tabela tem 1,46 milhão de linhas

A query é, em uma linha:

```sql
FROM v_service_desk_slots_productivity_informative vsdspi
LEFT JOIN reports r       ON vsdspi.assignment_id = r.assignment_id
LEFT JOIN people p        ON p.id = r.person_id
LEFT JOIN person_skills ps ON ps.person_id = p.id
LEFT JOIN skills s        ON s.id = ps.skill_id
```

O grão real tem **três** níveis: **(slot, relato, skill)** — não (protocolo, slot), e
não (slot, relato) como uma primeira leitura deste documento dizia. Cada agendamento
tem vários relatos, e cada relator com 8 skills cadastradas multiplica **cada relato
dele por 8**.

> **Corrigido em 22/09/2026 (`ACHADOS.md` #145), aviso de 01/10:** medido no arquivo em
> disco, **todo relator tem exatamente 1 skill** (182 relatores, mín = máx = 1) — o `LEFT JOIN
> person_skills` não multiplica nada. Quem multiplica é `reports`: o grão real é
> (slot, relato), ~13,4 relatos por solicitação.

> **Isto não é achado novo: é o `ACHADOS.md` #2, de 04/08/2026**, que já mediu a
> multiplicação e já tem decisão do Erick — **"replicar fielmente"** — mais a ressalva
> textual de que *"continua valendo perguntar se a granularidade por skill é
> necessária, mas como melhoria futura"*. Este documento não reabre a decisão; ele
> chega ao ponto que o #2 reservou, e por isso a pergunta abaixo é follow-up, não
> descoberta.

O que **é** novo aqui: **`Skill` e `Relator` não são usados por visual nenhum nem por
DAX nenhum.** Varredura em `specs/dashboards/` e `specs/_catalog/`: zero ocorrências de
`property: Skill`, `property: Relator`, `[Skill]`, `[Relator]`. As duas colunas que
justificam a multiplicação só existem no `SELECT`.

Isso **não** autoriza removê-las, e o motivo é o mesmo de sempre: `Qtd` de
`0c0223c6` e `084be384` é `aggregation: count` sobre `Protocolo` — **contagem de
linha** — e o Power BI conta sobre o grão multiplicado também. Tirar os dois joins
faz esses dois números caírem. Isso é **divergência**, não conserto, e o lugar dela é
`divergencias.yaml` com decisão de dono: *`Qtd` deve contar relato, ou (relato ×
skill)?* Registrado como pergunta #9 em `docs/PERGUNTAS-NEGOCIO.md`.

## A armadilha: aquele `LEFT JOIN` é um `INNER JOIN`

```sql
LEFT JOIN reports r ON vsdspi.assignment_id = r.assignment_id
WHERE ...
  AND ( r.title NOT LIKE 'Execução:%' AND r.title NOT LIKE 'Manutenção de Solicitação%' AND ... )
```

Com `r.title` nulo, `NOT LIKE` avalia para **NULL**, a cadeia de `AND` vira NULL, e o
`WHERE` rejeita a linha. **Slot sem relato qualificado não está na tabela.**

Consequência direta para o passo abaixo: a forma de slot **não pode** ser "a mesma
query sem o join de `reports`". Isso traria slots que hoje não existem — total maior,
plausível, sem aviso nenhum. Ela precisa preservar a existência:

```sql
AND EXISTS (
  SELECT 1 FROM reports r
   WHERE r.assignment_id = vsdspi.assignment_id
     AND r.title NOT LIKE 'Execução:%'
     AND ...   -- os seis filtros, idênticos
)
```

(Isso também é um fato de negócio que ninguém pediu: um agendamento sem relato é
**invisível** no relatório de hoje. Não é decisão nossa mudar; é decisão nossa avisar.)

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

O que decide não é a coluna, é **se o visual conta linha**. Um `tableEx` de colunas
puras agrupa pela tupla e é *provadamente* insensível à multiplicação; um
`aggregation: count` sobre `Protocolo` mede exatamente a multiplicação.

| visual | custo | o que ele faz | grão exigido |
|---|---|---|---|
| `e2d5549b` | **24,5 s** | `tableEx` de 9 colunas, **zero agregação** | **slot** ✅ |
| `084be384` | **8,8 s** | `count(Protocolo)` + Data Relato, Descrição, CategoriaProdutividade | **relato** ❌ |
| `0c0223c6` | 1,9 s | Status SLA + **`count(Protocolo)`** | **relato** ❌ |
| `815c0959` | (sob demanda) | + Relato | **relato** ❌ |
| `ae5871aa` | 1,5 s | Protocolo, `max(ClassificacaoRelato)` | agregável ✅ |
| `670ac661`, `6ffe2103`, `dde5aa90` | slicers | CategoriaProdutividade, ClassificacaoRelato, Descrição | **relato** ❌ |
| `e7998ec5` | slicer | Status Protocolo | slot ✅ |
| `116ebf72`, `4ed2f950`, `a88b3232`, `bc2c33d2` | cards | só medidas (`DISTINCTCOUNT`) | qualquer ✅ |

**O maior visual, o de 24,5 s, precisa só do grão de slot** — e a prova não é
"as colunas dele são de slot", é que ele **não agrega nada**: `tableEx` sem agregação
agrupa pela tupla, então três linhas idênticas de skill diferente já colapsam hoje,
dentro do avaliador, depois de terem sido carregadas e varridas. Servir a ele o grão de
slot devolve **o mesmo resultado** fazendo o colapso no Postgres.

`0c0223c6` mudou de lado nesta revisão: a coluna dele é de slot, mas o `Qtd` é
contagem de linha, e isso amarra o grão. São 1,9 s — cabe na forma de relato sem dor.

Agregar a tabela inteira serve `e2d5549b` e **apaga** os outros: o passo 4, como está
escrito, troca uma lentidão por um número errado.

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

- forma **slot** (padrão): `vsdspi` com `EXISTS` em `reports` — **não** "sem o join",
  pelo motivo da seção anterior — e sem `people`/`person_skills`/`skills` → ~30 mil linhas
- forma **relato** (sob demanda, por `?visual=`): a query de hoje, inteira

Isso serve `e2d5549b` (24,5 s), `e7998ec5` e os quatro cards — a maior parte do custo —
e deixa `084be384`, `0c0223c6` e os três slicers pagando o grão fino, que é o que eles
de fato precisam.

**Por onde os 24,5 s passam, lido no código e não suposto.** `calculaTabela`
(`packages/widget-engine/src/tabela.ts:99`) chama `agrupar`, e `e2d5549b` **não tem
campo agregado nenhum** — todos os 9 são chave. Então `valorDoCampo` nunca é chamado, e
o custo inteiro é `enumeraCombinacoes` (`grupos.ts:207`): uma varredura das 1,46 milhão
de linhas em que, para as chaves de `PROTOCOLOS GERAL` e `Status Protocolo Dia`, cada
linha ainda **atravessa relacionamento** pelo `Navegador`. Depois disso, cada combinação
guarda as linhas dela numa `Materializacao`.

Isso fecha o argumento: o visual produz as combinações distintas de 9 colunas, e o grão
de slot **já contém exatamente essas combinações** — a deduplicação hoje acontece
dentro do avaliador, depois de carregar e varrer tudo. A forma de slot faz a mesma
deduplicação no Postgres, antes. Mesma saída, 48× menos linha varrida e menos travessia
de relacionamento.

**O que faz a forma de slot ser conferível, e não uma aposta:** as duas formas têm de
concordar em tudo que não é contagem de linha. Como `e2d5549b` não agrega, o teste é
uma igualdade exata — a tupla de 9 colunas dele, no grão de slot, tem de ser **o mesmo
conjunto** que a de hoje. E `DISTINCTCOUNT('FIELD AGENDA'[Protocolo])` tem de dar
idêntico nas duas formas, porque protocolo distinto não vê multiplicação. São essas
duas afirmações que vão para o teste, não "ficou mais rápido".

**O preço, dito antes de alguém descobrir sozinho: cinco dos 39 visuais deixam de ser
calculados na abertura da página.** `084be384`, `0c0223c6` e os três slicers
(`670ac661`, `6ffe2103`, `dde5aa90`) precisam do grão fino; se a página abre na forma de
slot, eles aparecem como "sob demanda", igual ao `815c0959` de hoje. Três deles são
slicers, o que é ruim: slicer sob demanda é filtro que não está lá quando a pessoa
quer filtrar.

Isso torna a decisão **menos óbvia do que o passo 4 fazia parecer**, e é por isso que
existe uma segunda saída, mais caras de implementar e sem esse preço:

| saída | o que faz | preço |
|---|---|---|
| **A. duas formas, uma por pedido** | a página abre no grão de slot; quem precisa do fino pede | 5 visuais sob demanda, 3 deles slicers |
| **B. as duas formas na memória** | carrega slot (~30 mil) **e** relato (1,46 M); o avaliador redireciona o visual que pode | nada muda na tela; exige o avaliador saber redirecionar — é *user-defined aggregation* do Power BI, e errar nisso é justamente a classe de erro silencioso que este projeto não aceita |

B é o desenho certo e o trabalho maior. A é entregável até sexta. **A escolha é do
Erick**, e depende de quanto vale ter os três slicers ao abrir.

O roteamento por visual **já existe** (`sobDemandaDoVisual`, `servidor.ts:491`), e a
chave de cache já inclui o conjunto de colunas liberadas (`servidor.ts:465`). O que
falta é a query saber responder em dois grãos.

### 2. Onde o SQL escrito à mão vai morar

*(Plano original — não seguido; ver o aviso do topo.)*
`specs/_catalog/queries/*.spec.yaml` era **sobrescrito** por `npm run extract`
(regra 2; o script saiu em 27/08). A forma agregada é decisão humana e não pode morar lá. Vai em
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
