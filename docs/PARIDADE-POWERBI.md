# Paridade com o Power BI original — auditoria (20/08/2026)

> Pergunta do Erick: "temos todos os dados e funcionalidades iguais ao dashboard
> antigo de instalação?". Esta é a resposta com evidência — comparando o **bruto da
> definição** do PBIP (`INST - Relatório Instalação Gerencial.Report` +
> `.SemanticModel`) contra a nossa implementação (specs + engine + app React).
>
> **O que esta auditoria NÃO cobre:** conferência do *valor renderizado* visual por
> visual dentro do Power BI Desktop aberto. Isso depende de abrir o aplicativo (feito
> por fora, ex. Claude do desktop). Aqui está a paridade estrutural, de dados, de
> medidas e de funcionalidade — mais o que já está provado por valor.

## Resumo

| Eixo | Situação | Nota |
|---|---|---|
| Visuais (estrutura) | ✅ 100% | Contagem por página bate 1:1 com o PBIP |
| Dados (tabelas/entidades) | ✅ Completo | 22/22 entidades no snapshot; 14/14 páginas prontas |
| Medidas (DAX) | ✅ 78/78 | Interpretador DAX real; valor provado em 53 cards |
| Funcionalidades interativas | 🟡 Quase | 2 gaps reais: cross-filter completo e bookmarks |

## 1. Visuais — 100% estrutural

Cada página tem no nosso spec exatamente o mesmo número de visuais do PBIP:

| Página | PBIP | Spec |
|---|---|---|
| CAPA | 30 | 30 |
| VISÃO GERAL | 28 | 28 |
| AGENDAMENTO FIELD | 39 | 39 |
| RELATÓRIO DO MÊS | 36 | 36 |
| RELATÓRIO DO ANO | 14 | 14 |
| PREMIAÇÃO INSTALAÇÃO | 21 | 21 |
| DIÁRIO INSTALAÇÃO | 22 | 22 |
| PROTOCOLOS DETALHADOS | 19 | 19 |
| TELEFONIA & OUVIDORIA | 24 | 24 |
| MANUTENÇÃO INICIAL | 41 | 41 |
| INSTALAÇÃO/ REINCIDENTE | 29 | 29 |
| L.INST / L.TEC / L.MAPA | 1 / 1 / 1 | 1 / 1 / 1 |

Nenhum visual foi perdido na extração.

## 2. Dados — completo, com 1 defasagem de data

- **22 entidades reais** usadas por visuais; **todas** materializadas no snapshot.
- **24 tabelas** do modelo semântico (7 nascidas de DAX viram `calc.*.jsonl`, 17 de M
  viram queries) — nenhuma ficou de fora.
- **14/14 páginas prontas** (toda entidade que referenciam existe em disco).

**Ressalva única — FIELD AGENDA desatualizado.** O `field-agenda.jsonl` (~1 GB) está de
**12/08**, enquanto o resto do snapshot é de **18–19/08**. Uma re-materialização em
19/08 falhou com `ECONNRESET` após ~38 min (Postgres `dbemp00100`), deixando um
`.parcial` de 0 byte (`snapshot/field-agenda.erro.log`). Efeito: as 3 páginas que usam
essa tabela (**VISÃO GERAL, AGENDAMENTO FIELD, RELATÓRIO DO MÊS**) mostram agenda de
campo de 12/08. Não é página vazia — é divergência temporal. Ação pendente:
reprocessar só essa tabela.

## 3. Medidas (DAX) — 78/78

- **78 medidas** no modelo, com o **DAX íntegro** preservado em
  `specs/_catalog/measures/*.measures.yaml`.
- A API roda um **interpretador DAX próprio** (`packages/measure-engine/`:
  tokenizer → parser → evaluator) sobre o snapshot — não reimplementa por nome nem usa
  valor pré-calculado. O `calcula.ts` só formata.
- Cobertura de linguagem: **todas as ~60 funções usadas implementadas** (CALCULATE,
  FILTER, ALL, RANKX, AVERAGEX, TREATAS, SWITCH, ISINSCOPE, DATESBETWEEN/DATESMTD/
  ENDOFMONTH, LOOKUPVALUE…). Filosofia "falha alto": função não suportada → erro, nunca
  palpite.

**3 medidas quebradas — e já quebradas no PBIP original:** `# AA MÉDIA EQUIPES`,
`# AA MÉDIA GERAL`, `# AA TOTAL EQUIPES` referenciam tabelas inexistentes
(`CAPACIDADE INSTALAÇÃO`, `GESTORES`). No nosso lado dão erro; **conferir no Power BI se
lá também aparecem vazias** (se sim, somos idênticos, inclusive no defeito).

**Divergências de propósito** (`specs/_catalog/divergencias.yaml`): as colunas PESO de
dias úteis (sáb/dom = 0,5) foram alteradas de propósito — muda toda medida de dias
úteis / projeção / média mensal. É governado, não bug.

**Prova de valor** (`tools/paridade`): **53 cards** conferindo contra o Power BI, **22
ainda sem gabarito**, 18 marcados como divergência conhecida. O harness ainda só cobre
cards — tabelas/matrizes não têm gabarito de valor.

## 4. Funcionalidades interativas

| Recurso | Status | Nota |
|---|---|---|
| Slicers / segmentações | ✅ OK | `FilterBar`/`Segmentacao` renderizam qualquer `.segmentacao`; chiclet e busca textual viram dropdown-com-busca |
| Cross-filter | 🟡 Parcial | Só **gráfico** inicia filtro (persistente, com pill). **Cards KPI e tabelas não filtram**; não há realce transitório |
| Drillthrough | ➖ N/A | **Não existe no PBIP** (0 ocorrências) |
| Páginas-tooltip | 🟡 Ausente (baixo impacto) | L.INST/L.TEC/L.MAPA são páginas `Tooltip` **órfãs** — nenhum visual as usa nem no PBIP |
| Bookmarks / presets | 🟡 Ausente | 14 visões salvas de 1 clique no PBIP; só temos URL compartilhável como substituto |
| Navegação por abas | ✅ OK | `AppShell` + estado na URL |
| Export CSV | ✅ OK | Tabela e matriz, client-side com BOM |
| Ordenar / buscar / transpor | ✅ Supera | Busca dentro da tabela e transpor matriz — o PBI nativo não tem |
| Drill-down de hierarquia | 🟡 Ausente | **CORRIGIDO** (ver §6): o gráfico anual tem hierarquia DATA (Ano→Mês→Dia) e o original faz drill; nós achatamos num nível |

### Os gaps reais (revisado após conferência renderizada — §6)
1. **Filtro default não aplicado** — o maior. O original abre pré-filtrado
   (jul/2026 / 2026 / Status=Instalado); nossa app abre sem filtro. Números divergem
   por isso, não por cálculo.
2. **Cross-filter incompleto** — no PBI qualquer visual (inclusive **linha de tabela e
   nome de matriz**) realça/filtra os demais; aqui só gráfico vira filtro.
3. **Drill-down de data** — original expande Ano→Mês→Dia nos gráficos com hierarquia;
   nós mostramos um nível só.
4. **Bookmarks/presets nomeados ausentes** — as 14 visões salvas do PBIP não têm
   equivalente de 1 clique.

## Sobre as páginas L.INST / L.TEC / L.MAPA

Não são relatórios nem alvos de drillthrough — são **páginas de tooltip órfãs**, listas
cruas da tabela `PROTOCOLOS GERAL` (as mesmas colunas já presentes em PROTOCOLOS
DETALHADOS). O dashboard antigo as esconde da navegação. Recomendação: escondê-las da
barra lateral (specs permanecem no repo).

## 6. Reconciliação com a auditoria renderizada (Power BI Service, 20/08/2026)

Uma segunda auditoria foi feita **no Power BI Service ao vivo**, rolando cada página e
clicando visual por visual (refresh 20/08/2026 07:13:18). Cruzando com a auditoria do
bruto acima:

### Confirmado pelos dois lados
- **Drillthrough não existe** em nenhuma das 11 páginas. ✅
- **L.INST/L.TEC/L.MAPA** são páginas ocultas/listas cruas, **não** alvo de
  drillthrough. ✅ (nós: páginas `Tooltip` órfãs)
- **(TESTE) de clima** aparecem em **Relatório do Mês E Agendamento Field** (nós
  removemos as duas). ✅
- **Premiação** = importação manual/estática (a própria página avisa). ✅
- **Cards de "mês atual"/"últimos 30 dias" e KPIs de meta não reagem** a clique —
  nossa app também não os torna clicáveis, então aqui há paridade. ✅

### Achados novos do renderizado que a auditoria do bruto NÃO pegou

1. **[FILTRO-DEFAULT] — gap nº1 — ✅ RESOLVIDO (20/08).** O original abre
   **pré-filtrado**: `jul/2026` em Visão Geral, Agendamento, Diário e Protocolos; `2026`
   em Manutenção e Instalação/Reincidente. Nossa app abria **sem filtro**. **Implementado**
   em `apps/web/src/filtros-padrao.ts` (+ `App.tsx`): as 4 páginas de mês abrem no
   **último mês fechado** (dinâmico, decisão do Erick — acompanha o tempo em vez de fixar
   julho); as 2 de ano no **ano corrente**. Verificado: Visão Geral cai de 34.025 → 3.238
   protocolos ao abrir; as 6 páginas aceitam o filtro sem erro.
   - **Sobre o "STATUS INSTALAÇÃO = Instalado"** que o desktop viu travado: **não existe**
     valor "Instalado" na coluna STATUS (os valores são Encerrado, Agendado…). É efeito do
     relacionamento de `CALENDARIO INSTALADO` (só protocolo instalado tem data de
     instalação), então filtrar pela data já restringe a "instalados" — não foi aplicado
     filtro de status (aplicá-lo zeraria a página).
   - **Resíduo de valor — DIAGNOSTICADO (20/08):** com jul/2026 nossa Visão Geral mostra
     **3.238**; o original mostrou **2.533**. **Não é dado desatualizado** — nosso snapshot
     é todo de 2026 e tem *mais* protocolos que o relatório (34.025 vs ~26.221 criados). A
     causa é **escopo de tipo de protocolo**: a query do modelo ao vivo filtra
     `it.id IN ('12','1014','1254','1255','1256','1136','249','268','1160','1015','279','15')
     AND a.created >= '2026-01-01'` com dedup (`ROW_NUMBER PARTITION BY protocolo` +
     `SELECT DISTINCT`), restringindo aos tipos de **instalação de fibra**; o nosso conjunto
     inclui também Troca de Endereço (5.549), Roteador Adicional (885), #HR Fibra (1.004),
     Suporte de Retorno (285) etc. — ~7.850, que casa com a diferença 34.025 − 26.221 = 7.804.
     (fonte: `SemanticModel/definition/tables/PROTOCOLOS GERAL.tmdl`, partição M).
   - **CONCLUSÃO (20/08, após diagnóstico profundo): NÃO há escopo a recortar — a nossa
     query é IDÊNTICA à do modelo original.** Comparado byte-a-byte:
     `specs/_catalog/queries/protocolos-geral.spec.yaml` (campo `sql`) × a partição M de
     `SemanticModel/.../PROTOCOLOS GERAL.tmdl` → **3.656 caracteres iguais, idênticas**
     (mesmo `it.id IN (12 tipos)`, mesmo `created >= 2026-01-01`, mesmo dedup
     `ROW_NUMBER … PERSONA1 = 1` + `SELECT DISTINCT`). Os cards usam contagem crua igual à
     do PBIP. Ou seja, a nossa base **já reflete a definição do original**; restringir mais
     nos faria *divergir*, não convergir.
   - **Então por que 34.025 (nosso) vs 26.221/19.270 (desktop)?** Só sobra **estado/ambiente
     de dado**. Nosso snapshot é de 18/08 e tem *mais* protocolos; o filtro é cumulativo
     (`created >= 2026-01-01`), então dado mais novo só pode ter ≥, nunca menos. O carimbo
     "20/08" do relatório publicado costuma ser o último acesso, não o último refresh do
     dataset. **Hipótese principal: o dataset publicado do Power BI é que está mais velho
     que o nosso snapshot** — o inverso do que se suspeitou. Confirmar exige ver a data real
     de refresh do dataset publicado (ou um lado a lado por card no mesmo estado).
   - **Ação:** nenhuma restrição de dado (seria regressão de fidelidade). O filtro default
     por período (implementado) permanece como a mudança correta desta frente.

2. **[INTERAÇÃO] Drill-down de data.** O gráfico anual "VISÃO GERAL"
   (`relatorio-do-ano`) tem **DATA INSTALADO 3× como Category** = hierarquia
   Ano→Mês→Dia; o original faz drill up/down. Nós achatamos num nível
   (`Grafico.tsx`). Corrige a conclusão anterior (§4) de que "não havia hierarquia".

3. **[INTERAÇÃO] Tabela/matriz como fonte de cross-filter.** Confirmado ao vivo:
   clicar **linha de tabela** (Visão Geral zera os gráficos) e **nome em matriz**
   (Diário filtra cards + tabela) filtra os demais. Nossa app só filtra a partir de
   **gráfico**. Confirma e amplia o gap de cross-filter.

### Onde batemos por acaso
- **HTML cru** em "Histórico de Relatos Completos" (Agendamento): o original mostra as
  tags `<b>/<br>/<p>` visíveis. Nossa `Tabela.tsx` renderiza texto escapado pelo React
  (`renderizaValor` devolve string, linha ~88) → as tags aparecem como texto igual.
  Paridade acidental. ✅

### Corroborações
- Desktop viu "**Total por Instalador Referência**" **vazio** na Visão Geral — bate com
  as medidas órfãs `# AA *` que dão erro/branco no nosso lado. Provável mesmo caso.

## O que ainda depende de conferência de valor (número a número)

1. Os **22 cards** sem gabarito — agora com os valores do renderizado (§ inventário do
   desktop, refresh 20/08) dá pra ditar o gabarito, **desde que aplicado o mesmo filtro
   default** (jul/2026 etc.).
2. Valor de **tabelas/matrizes** (harness ainda não cobre).
3. Alinhar a data: nosso snapshot é 18–19/08 (FIELD AGENDA 12/08); o renderizado é
   20/08 — diferenças em páginas de mês corrente são de data, não de erro.
