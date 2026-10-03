# Decisão: SDK de gráficos — continuar sem biblioteca

> **Critério de saída de [CONTINUACAO.md](CONTINUACAO.md) §9.2** e Fase L7 de
> [PLANO-LAYOUT-V1.md](PLANO-LAYOUT-V1.md) §9: *"uma `docs/DECISAO-CHART-SDK.md`
> registrada (qual biblioteca, medida contra o quê, o que ela substitui) **e** os 16
> gráficos continuando a passar a paridade depois da troca."* Registrada em
> 01/09/2026. **Quem destrava: ninguém — é decisão técnica**, nas palavras do próprio
> critério (§9.2), adiada de propósito até existir número para embasá-la. Este
> documento é esse número.

**Recomendação: nenhuma biblioteca.** Continuar com o renderizador SVG próprio.

- **Biblioteca:** nenhuma.
- **Medida contra:** o bundle de produção atual (`npm run web:build`, medido
  01/09/2026) e o tamanho publicado (bundlephobia, consultado 01/09/2026) das
  bibliotecas de gráfico React mais citadas.
- **O que ela substitui:** nada — os 7 componentes de desenho já em produção
  continuam.

---

## A pergunta

`ACHADOS.md` #5 e `CONTINUACAO.md` §9.2 registraram, ainda em agosto, que a tela
desenha gráfico em SVG/HTML de propósito, e que escolher uma biblioteca de passagem
"seria decidir por uma peça que tem dono" sem número em mãos. Depois da Fase L6, o
renderizador cresceu de 3 formas (as do PBIP original) para 7 componentes de desenho,
cobrindo os **16 gráficos** que a base tem hoje mais 6 usos novos (rosca, sparkline,
bullet, calendário, data-bar em matriz, ranking) — o momento de decidir com número é
agora, não antes.

A pergunta é literal: trocar o renderizador próprio por uma biblioteca pronta (React +
canvas/SVG) reduz código, risco ou peso de bundle o bastante para justificar uma
dependência nova?

## O que já existe hoje, em número

Contagem exata dos 16 gráficos (`conteudo: grafico`) nos 14 `backend/specs/golden/layout/*.json`,
por tipo original do PBIP:

| tipo (PBIP) | quantos |
|---|---|
| `lineStackedColumnComboChart` | 6 |
| `columnChart` | 3 |
| `lineChart` | 2 |
| `clusteredBarChart` | 2 |
| `clusteredColumnChart` | 1 |
| `hundredPercentStackedColumnChart` | 1 |
| `barChart` (hoje `ranking-barra`, Fase L6/6) | 1 |
| **total** | **16** |

Todos os 16 passam por `Grafico.tsx` ou, quando `layout.yaml` declara um `render:` de
melhoria, por um dos 6 componentes novos da Fase L6 (`RankingBarra.tsx`) — sem trocar o
número, só o desenho (ver checkpoint da Fase L6 em `PLANO-LAYOUT-V1.md` §8). Os 7
componentes de desenho hoje no bundle, todos SVG/HTML próprio, zero dependência de
gráfico:

| componente | forma | conteúdo original |
|---|---|---|
| `Grafico.tsx` | colunas, linhas, barra horizontal | `grafico` |
| `RankingBarra.tsx` | barra horizontal com rótulo dentro | `grafico` (melhoria) |
| `Rosca.tsx` | rosca com centro numérico | `tabela` (melhoria) |
| `Sparkline.tsx` | linha de tendência no KPI | `card` (melhoria) |
| `Bullet.tsx` | realizado × meta | `card` (melhoria) |
| `Calendario.tsx` | heatmap de calendário | `card` (melhoria, resumo de matriz) |
| `Matriz.tsx` + `magnitude.ts` | barra de dados na célula | `matriz`/`tabela` (melhoria) |

Bundle de produção medido agora (`npm run web:build`, 01/09/2026):

| arquivo | bruto | gzip |
|---|---|---|
| `assets/index-*.js` (React 19 + app inteiro) | 279,40 kB | **89,32 kB** |
| `assets/index-*.css` | 34,37 kB | 7,68 kB |

**89,32 kB gzip é o app inteiro** — servidor de estado, roteamento, todos os 14
dashboards, todos os componentes, e os 7 desenhistas de gráfico acima. Não é o custo
do desenho isolado; é o teto contra o qual qualquer biblioteca nova precisa se medir,
porque ela se soma a isto, não o substitui por igual.

## Medido contra as bibliotecas candidatas

Tamanho publicado no bundlephobia (a biblioteca sozinha, gzip, ESM/UMD conforme o
pacote expõe), consultado em 01/09/2026:

| biblioteca | pacote medido | gzip | versão |
|---|---|---|---|
| Chart.js + `react-chartjs-2` | `chart.js` + `react-chartjs-2` | 68,4 + 1,0 = **69,4 kB** | 4.5.1 / 5.3.1 |
| Victory | `victory` | **107,8 kB** | 37.3.6 |
| Recharts | `recharts` | **147,5 kB** | 3.10.1 |
| Nivo (só o núcleo) | `@nivo/core` | **~147 kB**¹ | 0.99.0 |
| ApexCharts | `apexcharts` | **260,5 kB** | 7.1.0 |
| visx (primitivas, não formas prontas) | `@visx/shape` + `@visx/scale` | 10,7 + 17,5 = **28,2 kB**² | 4.0.0 |

¹ O próprio bundlephobia devolveu gzip (146.785 B) maior que o tamanho bruto
(142.990 B) para este pacote — inconsistência da fonte, não erro de leitura; mantido
aqui só para ordem de grandeza, e mesmo assim já maior que o app inteiro. Note também
que `@nivo/core` sozinho não desenha gráfico nenhum — cada tipo (`@nivo/bar`,
`@nivo/line`, `@nivo/pie`...) é pacote à parte, somado por cima.

² visx não é uma biblioteca de gráficos prontos — é um conjunto de primitivas de
desenho (geradores de path, escalas) que o Airbnb extraiu do D3, para quem vai
desenhar o próprio gráfico de qualquer jeito. Ver [Por que visx não conta como
"biblioteca pronta"](#por-que-visx-não-conta-como-biblioteca-pronta) abaixo.

## Por que qualquer opção pronta perde

Comparando com o app inteiro hoje (89,32 kB gzip), não com um orçamento "de gráfico":

- **Chart.js** sozinho já é **78% do app inteiro**. Somado, o bundle sobe para
  ~159 kB gzip — quase dobra — para redesenhar 16 gráficos que já funcionam.
- **Victory** e **Nivo** sozinhos já **ultrapassam** o app inteiro.
- **Recharts** e **ApexCharts** sozinhos custam **1,65x** e **2,9x** o app inteiro,
  respectivamente — mais pesados que toda a aplicação, só para trocar o desenho de um
  gráfico de barra.

Nenhuma dessas bibliotecas usa canvas de graça: as baseadas em SVG (Recharts, Victory,
Nivo, visx) resolvem o mesmo problema que `Grafico.tsx`/`usa-caixa.ts` já resolvem —
medir o contêiner, desenhar path, escalar eixo — e ainda assim custam de 30 a 165 kB
gzip a mais só pela abstração genérica por cima. Não é ineficiência das bibliotecas:
é o preço de servir qualquer gráfico que qualquer app possa querer, quando este app só
precisa de 7 formas conhecidas.

### Por que visx não conta como "biblioteca pronta"

visx é o único candidato mais leve que o app inteiro (28,2 kB gzip para
shape+scale), e é tentador chamá-lo de vencedor. Mas ele não entrega `<BarChart>` nem
`<LineChart>` — entrega `curveBasis`, `scaleLinear`, `Group`. Adotá-lo significa
continuar escrevendo exatamente o que `Grafico.tsx`, `grafico-forma.ts` e
`grafico-clique.ts` já escrevem hoje: o path do SVG, a escala do eixo, o clique que
vira filtro, a cor que respeita tema. A diferença seria trocar `d3-shape`/`d3-scale`
(via visx) pelo cálculo manual que já existe, testado e sem dependência — troca de
código por código, com uma dependência nova e zero capacidade nova.

## O que uma biblioteca pronta teria que resolver de novo

Nenhuma das bibliotecas acima resolve, de fábrica, o que este renderizador já resolve
e já tem teste em cima:

- **Clique-para-filtrar sobre eixo categórico com múltiplos níveis**
  (`grafico-clique.ts`, compartilhado por `Grafico.tsx` e `RankingBarra.tsx`).
- **Cor que muda por tema sem CSS estático** (`corNoTema`/`corDaSerie`,
  `grafico-forma.ts`) — a mesma série muda de hex entre claro e escuro, e o contraste
  do rótulo é recalculado por fórmula WCAG (`corDoRotuloSobre`), não por par fixo.
- **Gráfico não rola, pagina** — regra de `CLAUDE.md`: categoria demais vira
  paginador, nunca `overflow-x`. Nenhuma biblioteca de gráfico genérica decide isso
  por você; é comportamento de produto, escrito uma vez em `Grafico.tsx`/
  `RankingBarra.tsx`.
- **Medição de contêiner sem `ResizeObserver`** (`usa-caixa.ts`) — o próprio
  `padrao-frontend-dashboards` (skill deste projeto) registra que o
  `ResponsiveContainer` do Recharts **não disparou** em produção, silenciosamente,
  num dashboard anterior da mesma stack. Trocar de biblioteca não elimina esse risco;
  ele já foi medido e evitado aqui com um medidor de 20 linhas.

Adotar qualquer uma das cinco bibliotecas prontas significa reescrever essas quatro
peças por cima dela mesmo assim — o ganho nunca chegaria a "menos código", só a
"código diferente, mais peso".

## O que o critério de saída pede, satisfeito

> "e os 16 gráficos continuando a passar a paridade depois da troca"

Não há troca: os 16 gráficos e os 6 usos novos da Fase L6 continuam exatamente como
estão, com os mesmos testes (1461/1461 na Fase L6) e o mesmo golden
(`backend/specs/golden/layout/`). O critério fecha por não ter o que quebrar.

## Quando reabrir esta decisão

Não é definitivo — é "sem biblioteca **com os dados de hoje**". Vale medir de novo,
contra um pacote específico (não uma "SDK geral"), se aparecer uma forma que as 7
peças atuais não cobrem por natureza — por exemplo um grafo de rede, uma árvore
hierárquica grande, ou um mapa geográfico com projeção de verdade. Nenhum desses casos
existe hoje nos 16 gráficos da base; se um aparecer, a pergunta muda de "qual SDK
geral" para "qual pacote resolve exatamente isto", e o mesmo formato de tabela deste
documento (bundle antes/depois, medido) decide.
