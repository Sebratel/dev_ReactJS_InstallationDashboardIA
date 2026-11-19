# Plano de ajustes das telas (19/11/2026)

Origem: lista de pedidos do Erick de 19/11/2026 (os gestores usam a tela para **tirar
print e mandar no grupo** — é esse uso que manda nas decisões de legibilidade abaixo).

**Escopo: todas as telas MENOS as do Misael.** Ficam de fora `insights-operacao`
("Operação ao vivo") e `insights-previsoes` ("Previsões"), de
`frontend/src/components/insights/` — commit `a788317`, 18/11/2026. Elas entram aqui só
como **referência de layout** (item T-3).

Nada neste plano toca banco, consulta ou medida, com UMA exceção marcada (F-1, a coluna
`"."`), que muda o que a tabela MOSTRA e por isso tem gate de paridade.

---

## 0. O que já foi feito (branch `trabalho/layout-graficos`)

| # | Tela | Mudança | Arquivo |
|---|---|---|---|
| ✅ E-1 | RELATÓRIO DO MÊS | 4 faixas de gráfico de largura cheia → 2. BACKLOG e PROTOCOLOS GERADOS dividem a mesma faixa (`span: 6`) | `backend/specs/layout/relatorio-do-mes.layout.yaml` |
| ✅ E-2 | RELATÓRIO DO MÊS | PROTOCOLOS REALIZADOS desceu para logo abaixo de HISTÓRICO E PREVISÃO DO TEMPO, com `eager: true` | idem |
| ✅ E-3 | INSTALAÇÃO REINCIDENTE | REINCIDÊNCIA POR MÊS e MANUTENÇÃO INICIAL POR MÊS lado a lado (`span: 6`) | `backend/specs/layout/instalacao-reincidente.layout.yaml` |
| ✅ T-1 | todas | número em cima em toda forma de gráfico — regra extraída para `utils/graficoRotulos.ts`, com teste por porta | `Grafico.tsx`, `ColunasDoGrafico.tsx`, `LinhasDoGrafico.tsx` |
| ✅ T-2 | todas | o passo do eixo passa a consultar o rótulo real; mês deixa de ser pulado | `utils/graficoEixo.ts`, `EixoXDoGrafico.tsx` |
| ✅ T-3a | todas | P/M/G (densidade) removido; o paginador fica | `Grafico.tsx`, `estilo.css` |
| ✅ P-1…P-4 | PREMIAÇÃO | Resumo no topo, duplicata e apuração de maio para `ocultos`, detalhamento renomeado via `titulo:` novo no layout | `premiacao-instalacao.layout.yaml`, `schema.ts`, `VisualGridSection.tsx`, `VisualNaDobra.tsx` |
| ✅ F-1 | 6 tabelas | a coluna `"."` sai no MOTOR, com teste provando que as linhas não mudam | `backend/packages/widget-engine/src/tabela.ts` |

**Por que E-1 resolve o branco.** Faixa de UMA coluna entra no pool de altura
(`frontend/src/hooks/useAlturaMedida.ts`): a fração de `--util` do tipo `grafico` é
dividida pelo NÚMERO de faixas largas daquele tipo. Com quatro, todas caíam no piso de
273px — quatro gráficos baixos, cada um com a largura inteira da tela para poucas
categorias. Faixa de VÁRIAS colunas não entra no pool: usa a fração fixa do
`estilo.css` (clamp 273–430px). Os dois gráficos ficaram **mais altos** ocupando metade
da largura.

**Por que o `eager: true` em E-2.** O KPI `d914bdf23072848ca977` desenha a sparkline com
os pontos de PROTOCOLOS REALIZADOS (`kpis[].tendencia`), e `idsIniciais`
(`backend/tools/layout/src/corte-eager.ts`) só pede KPI, segmentação, as 4 primeiras
faixas e quem declara `eager`. Sem a marca, qualquer faixa nova acima empurra o visual
para fora do corte e a sparkline nasce vazia — **sem nenhum teste vermelho**.

Verificado: `npm run layout:valida` ✔ nas 14 telas · `npm run typecheck` ✔ ·
`npm test` ✔ (2.554 passam, 1 pulado; front 240 passam).

---

## 1. Transversal — legibilidade para print (prioridade alta)

### T-1 · Número em cima do gráfico, em todos os que hoje não têm

**Pedido:** "coloque números em cima dos resultados de gráficos igual agenda + capacidade";
"verifique os gráficos que não mostram os dados em cima … ex. relatório do ano … e até na
hora de passar o mouse é difícil".

**Diagnóstico (não é chute).** `frontend/src/components/visuais/Grafico.tsx:134`:

```ts
const comRotulos =
  !g.percentual &&
  areas.length > 0 &&
  (areas.length === 1 || g.empilha) &&
  g.categorias.length <= MAXIMO_COM_ROTULO;
```

Três portas fecham o rótulo:

1. **`areas.length > 0`** — gráfico só de LINHA não ganha chip nenhum. `LinhasDoGrafico.tsx`
   rotula apenas o MAIOR ponto de cada série. Atinge PROTOCOLOS REALIZADOS, PROTOCOLOS
   GERADOS e `ano-prazo-por-mes` (RELATÓRIO DO ANO).
2. **`areas.length === 1 || g.empilha`** — coluna AGRUPADA com 2+ séries não rotula.
   Atinge BACKLOG e `ano-instalados-por-mes` (RELATÓRIO DO ANO). É por isso que AGENDA +
   CAPACIDADE tem número (é empilhada) e o relatório do ano não tem.
3. **`!g.percentual`** — o 100% empilhado (TAXAS DE PRODUTIVIDADE, AGENDAMENTO FIELD)
   nunca rotula.

**Ação.**

- Rotular **ponto de linha** quando as categorias visíveis couberem
  (`<= MAXIMO_COM_ROTULO`) e houver uma série só; manter só-o-maior quando houver várias
  séries, senão vira sopa de número.
- Liberar **coluna agrupada** (`areas.length > 1 && !empilha`) quando
  `larguraDaFatia >= ~18px` — abaixo disso o chip não cabe, e `ColunasDoGrafico.tsx:147`
  já tem o guarda `cabe` para descartar caso a caso.
- No **percentual**, rotular a porcentagem (é o número que o gestor quer no print).
- `geometria.ts:53` já cresce a margem de topo (14 → 26px) quando há rótulo: a altura do
  plot encolhe. Conferir as telas de E-1/E-3 depois disto, não antes.

**Risco:** chip demais em gráfico apertado. Mitigação: o guarda `cabe` por marca e o teto
`MAXIMO_COM_ROTULO`. **Gate:** teste novo em `frontend/test/` para cada uma das 3 portas.

### T-2 · Mês no eixo sem precisar passar o mouse

**Pedido:** "manutenção inicial por mês colocar os meses fixos sem ter que passar o mouse".

**Diagnóstico.** `frontend/src/utils/graficoEixo.ts:54`:
`passoDoEixo(banda) = banda < 30 ? 3 : banda < 44 ? 2 : 1`. Em MANUTENÇÃO INICIAL os dois
gráficos estão em `span: 6`: o plot fica com ~740px e, com ~18 meses, a banda dá ~41px —
**passo 2, um mês sim, um mês não**. O mês existe no desenho; o rótulo é que não é escrito.

Mas o passo olha só a BANDA, e o orçamento real do rótulo já é calculado logo abaixo
(`orcamentoDoRotulo`): com banda de 41px, girado a 45°, cabem ~10 caracteres, e "outubro"
tem 7. **O passo é conservador demais para rótulo curto.**

**Ação.** `passoDoEixo` passa a receber também o comprimento do MAIOR rótulo (já conhecido:
`rotuloDoEixo(partes, rotulo, 999)` é calculado em `EixoXDoGrafico.tsx:21`) e só pula
categoria quando o rótulo inteiro realmente não couber na diagonal. Rótulo de mês passa a
sair em todas. **Gate:** `graficoEixo` já tem teste em `npm test` — estender.

### T-3 · Distribuição das telas no padrão "Operação ao vivo"

**Pedido:** "ver distribuição do front, coisas em branco"; "a densidade pode tirar e deixar
tudo ajustado o layout"; "poderíamos imitar o layout do operação ao vivo na distribuição".

Duas coisas distintas saíram desse bloco:

- **T-3a · tirar o controle de densidade (P/M/G).** É o `ControlesDeZoom.tsx` no cabeçalho
  de todo gráfico ("Densidade: quantas categorias por página"). Com T-2 resolvido e as
  faixas reequilibradas (E-1), ele vira mais um botão a explicar. Remover o controle e
  fixar o nível médio (`zoomIdx = 1`, que já é o padrão); o paginador continua.
  **Confirmar antes:** tirar o P/M/G tira a saída para o caso de 90 categorias.
- **T-3b · imitar a Operação ao vivo.** A diferença de fato é que `Operacao.tsx` monta a
  tela com blocos de tamanhos DIFERENTES (KPI largo, mapa alto, lista estreita), enquanto
  as telas do relatório empilham faixas de 12 colunas. O caminho é continuar o que E-1/E-3
  começaram: pares `span: 6` e trios `span: 4` onde o visual não precisa da largura
  inteira. **Isto é varredura, uma tela por vez — seção 3.**

---

## 2. Por tela

### RELATÓRIO DO MÊS — ✅ feito (E-1, E-2)

Sobrou conferir: com o chip de T-1 ligado, BACKLOG em `span: 6` ainda cabe?

### RELATÓRIO DO ANO — R-1

Faixas: `ano-instalados-por-mes` (coluna agrupada, `span: 12`), depois `ano-prazo-por-mes`
(linha) + `ano-cidades` (tabela), em `span: 6`. São **visuais novos**
(`backend/specs/visuais-novos/`), não vêm do PBIP. Nenhum dos dois gráficos tem número em
cima — cai inteiro em T-1, portas 1 e 2. Nada a fazer aqui além de T-1.

### PREMIAÇÃO INSTALAÇÃO — P-1 a P-4

Ordem hoje: `2º Ponto | Ponto Adicional` (lado a lado) → `Resumo` → `Apuração de Maio` →
`Relatório Detalhado Premiação` → `Detalhamento Ponto Adicional`.

- **P-1 · Resumo no topo.** "Premiação Instalação - Resumo" (`5b536b4ab2c996794f97`) sobe
  para a primeira faixa, largura cheia.
- **P-2 · Retirar "Instalação Ponto Adicional"** (`50d44b50c8a7c764fda7`). **Confere com o
  pedido:** os campos dos dois são INSTALADOR + contagem de N°PROTOCOLO sobre
  `PROTOCOLOS PRODUTIVIDADE`, recortados por TIPO DE PROTOCOLO — o "Relatório Instalação
  2º Ponto" (`e42420359d507de64376`) é o mesmo recorte com os nomes de coluna certos. Sai
  da grade para `ocultos`, com o porquê escrito (não apagar do spec, que é gerado).
- **P-3 · Ocultar "Apuração de Maio 01/05/2026 a 10/05/2026"** (`bb2892e77821cc094c8d`) —
  vai para `ocultos` com o motivo "apuração fechada; pode voltar em outro formato".
- **P-4 · Renomear o detalhamento.** "Detalhamento instalação Ponto Adicional"
  (`77ebfd004e4106f33165`) passa a acompanhar o nome do 2º Ponto.
  **O título vem do `title` da spec GERADA**, que não se edita à mão. O mecanismo limpo é
  um campo `titulo:` opcional na coluna do `layout.yaml`, lido por `tituloDoVisual`
  (`frontend/src/utils/rotulos.ts`) — serve para qualquer renomeação futura sem tocar na
  extração. Custo: schema + front + teste.

**⚠️ Ordem final a confirmar** (minha leitura da lista):
1. Premiação Instalação – Resumo · 2. Relatório Detalhado Premiação ·
3. Relatório Instalação 2º Ponto · 4. Detalhamento Instalação 2º Ponto.

### MANUTENÇÃO INICIAL — M-1 a M-3

- **M-1 · "outubro não aparece no gráfico".** Hipótese principal: é T-2 — com passo 2 o
  rótulo de outubro não é escrito e a coluna fica sem nome. Hipótese secundária:
  `ColunasDoGrafico.tsx` não desenha marca de valor `0` (`if (v === null || v === 0)
  return null`), então um outubro ZERADO some de vez — sem rótulo e sem coluna. Terceira:
  a janela de abertura termina na última categoria com valor ≠ 0 (`ultimaCategoriaComDado`,
  `Grafico.tsx:89`). **Reproduzir com o filtro que o Erick usava antes de corrigir** — as
  três têm correções diferentes.
- **M-2 · meses fixos** → T-2.
- **M-3 · "análise detalhada está muito feio, as colunas desalinhadas".** São TÉCNICOS
  OFENSORES e SOLUÇÕES em `span: 6`, mais duas tabelas largas. Revisar alinhamento por
  tipo (número à direita, texto à esquerda, data no mesmo formato) e a largura de coluna
  em `frontend/src/components/visuais/tabela/CorpoDaTabela.tsx`. **Vale para TODA tabela**
  — promover a transversal se o defeito for do componente e não da tela.

### INSTALAÇÃO REINCIDENTE — ✅ feito (E-3)

### AGENDAMENTO FIELD — F-1, F-2

- **F-1 · tirar a coluna `"."`.** Pedido: "remover o ponto que é o contador, avaliar se vai
  mudar algo em HISTÓRICO DE RELATOS COMPLETOS, e não ser mostrado para o usuário".
  **É uma coluna de verdade, não um enfeite:** `COUNT('FIELD AGENDA'[Protocolo])` com
  `name: "."`, herdada do Power BI. Aparece em **6 tabelas**:

  | Tela | Visual | Título |
  |---|---|---|
  | AGENDAMENTO FIELD | `084be384e4209a5a3674` | HISTÓRICO DE RELATOS |
  | AGENDAMENTO FIELD | `815c09598bc48c8da49a` | HISTÓRICO DE RELATOS COMPLETOS |
  | PREMIAÇÃO | `50d44b50c8a7c764fda7` | Instalação Ponto Adicional (sai em P-2) |
  | PREMIAÇÃO | `77ebfd004e4106f33165` | Detalhamento instalação Ponto Adicional |
  | PROTOCOLOS DETALHADOS | `ce6625eb09750a404bda` | Relatório detalhado Protocolos FTTx |
  | INSTALAÇÃO REINCIDENTE | `d93e5f330d5c60355c53` | PROTOCOLOS ABERTOS 30 DIAS APÓS INSTALAÇÃO |

  **Muda algo?** Pelo motor, não deve:
  `backend/packages/widget-engine/src/tabela.ts` documenta que as colunas CRUAS agrupam e
  as agregadas são calculadas — uma tabela sem nenhuma medida mostra as **combinações
  distintas** das colunas cruas, que é o mesmo conjunto de linhas de hoje. O que se perde
  é saber que uma linha repetia N vezes. **Gate obrigatório mesmo assim:** contagem de
  linhas e golden antes/depois das 6, porque "não deve" não é "não muda". `rotulos.ts` já
  descarta o `"."` do TÍTULO (`nomesUteis`) — falta descartá-lo da GRADE e do CSV
  exportado.
- **F-2 · dois gráficos de largura cheia empilhados** (AGENDA + CAPACIDADE e TAXAS DE
  PRODUTIVIDADE). Candidatos a `span: 6` pelo mesmo motivo de E-1 — mas AGENDA +
  CAPACIDADE é o gráfico principal da tela e tem 2 séries por turno mais a linha de
  capacidade; em meia largura a fatia de cada turno encosta no mínimo de 3px
  (`geometria.ts`). **Decidir olhando a tela**, não no papel.

### VISÃO GERAL — V-1

A faixa de gráficos tem 3 colunas (`span: 4`): dois rankings e um columnChart. O
`layout.yaml` já documenta que o ranking de TÉCNICO (94 categorias) fica preso em 430px
(~15 linhas) porque `RankingBarra.tsx` fixa `altura="grafico"` por dentro e ignora o
`altura:` da faixa. **A decisão nunca foi tomada:** tirar TÉCNICO 1 para faixa própria
`span: 12` mostra as 94. Entra aqui porque é "coisa em branco" (T-3) com causa conhecida.

### TELEFONIA / OUVIDORIA, DIÁRIO INSTALAÇÃO, PROTOCOLOS DETALHADOS, CAPA, L-INST / L-MAPA / L-TEC

Não foram citados na lista. Entram na varredura da seção 3 — nenhum ajuste cego.

---

## 3. Varredura das telas não citadas

Uma tela por vez, com print do estado atual antes e depois. Para cada uma:

1. Faixa de 1 coluna que não precisa de 12 → vira par `span: 6` (E-1).
2. Gráfico sem número em cima → confere contra T-1.
3. Tabela com coluna desalinhada → confere contra M-3.
4. Coluna `"."` → F-1.
5. Nada muda de número; qualquer coisa que mude passa por paridade.

Ordem sugerida: TELEFONIA/OUVIDORIA (2 columnCharts em `span: 6`, a mais rápida) →
PROTOCOLOS DETALHADOS → DIÁRIO INSTALAÇÃO → L-INST/L-MAPA/L-TEC → CAPA.

---

## 4. Ordem de execução

| Fase | Itens | Situação |
|---|---|---|
| 1 ✅ | E-1, E-2, E-3 | feito |
| 2 ✅ | T-1, T-2, T-3a | feito |
| 3 ✅ | P-1, P-2, P-3 | feito |
| 4 | **M-1, M-3** | **a fazer** — M-2 já saiu junto com T-2; M-1 pode já estar resolvido (ver abaixo) |
| 5 ✅ | P-4 | feito, com `titulo:` novo em `ColunaDeFaixa` |
| 6 ✅ | F-1 | feito — gate cumprido por teste; falta a conferência na tela |
| 7 | **F-2, V-1** | **a fazer** — pedem a tela na frente |
| 8 | **seção 3** | **a fazer** — varredura |

## 5. Em aberto

As cinco perguntas de 19/11 foram respondidas com "sim" e já estão aplicadas: ordem da
premiação como em P-1…P-4, P/M/G removido, a coluna `"."` fora das **6** tabelas, e o nome
"Detalhamento Instalação 2º Ponto".

Fica de pé só o que depende de ver a tela:

1. **M-1, "outubro sumiu".** A correção de T-2 (o eixo deixa de pular mês) é a hipótese
   principal e já foi aplicada — **conferir na tela se resolveu**. Se não resolveu, as
   outras duas hipóteses continuam válidas e têm correções diferentes: coluna de valor `0`
   não é desenhada, e a janela de abertura termina na última categoria com valor ≠ 0
   (`ultimaCategoriaComDado`). A segunda NÃO foi mexida de propósito — ver ACHADOS #269.
   Para isso ainda preciso do filtro que estava na tela.
2. **M-3, "análise detalhada muito feia".** Falta decidir se o desalinhamento é do
   componente de tabela (vale para todas) ou da tela.
3. **F-2 e V-1** — pedem a tela na frente.
4. **Conferência de F-1 na tela:** as 6 tabelas sem a coluna `"."`, com a contagem de
   linhas igual à de antes.
