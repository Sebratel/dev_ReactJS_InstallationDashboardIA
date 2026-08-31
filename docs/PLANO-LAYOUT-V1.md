# Plano — o layout da v1, orientado a spec

> Escrito em 28/08/2026, a pedido do Erick: *"vamos montar um plano com spec driven
> development para você não quebrar nada, temos que ajustar todo o layout e seguir com
> sua ordem, pode inventar gráficos e layouts que você quiser sempre aplicando as
> melhores práticas de carregamento dos dados"*.
>
> A ordem é a de [CONTINUACAO.md](CONTINUACAO.md) §9 e [DEPLOY.md](DEPLOY.md) §6, com o
> trabalho de tela encaixado nela. O que este documento acrescenta é **o contrato**: como
> mexer em toda a tela sem que "não quebrou nada" seja opinião.

## Checkpoint

```
Item zero (§2)  [DONE]  28/08/2026 — 3 testes de cross-filter (fixture com role
                        errado) + doc/teste de cromo reconciliados (867px) +
                        _dbg.test.ts removido. 1403/1403, build verde.
Fase L1 (§3)    [DONE]  28/08/2026 — tools/layout/ (extrai/valida/golden) +
                        specs/layout/*.layout.yaml (14) + specs/golden/layout/
                        (14). 1410/1410, build verde, bundle idêntico.
Fase L2 (§4)    [DONE]  28/08/2026 — tools/tela/ (Playwright) rodou 112 combinações
                        (14 páginas × 4 resoluções × 2 temas): zero cartão maior que
                        a viewport, zero rolagem horizontal, zero v-auto, zero linha
                        divergente. Achou 5 pares de contraste abaixo de 4,5:1 (1
                        claro, 4 escuro) — corrigidos no mesmo dia (--pbi-gold-600
                        escurecido no claro; --pct-*-bg e 3 "-texto" com override em
                        .dark). Reconfirmado: 112/112 sem problema. 1425/1425, build
                        verde.
Fase L3 (§5)    [DONE]  28/08/2026 — régua 14px e --chrome medido já estavam feitos
                        (achado, não refeito). Causa raiz achada e corrigida:
                        .v-matriz/.v-tabela/.v-grafico dividem --util por TIPO de
                        faixa em vez de reivindicar sozinhas (usaAlturaDasFaixas
                        Largas). Zero regressão em 112/112; diario-instalacao 1,7→
                        1,0 tela, premiacao-instalacao 2,5→2,2, agendamento-field
                        4,7→3,4 (aceito como exceção — pisos de legibilidade, 8
                        faixas largas, mais que o dobro de qualquer outra página).
                        1432/1432, build verde.
Fase L4 (§6)    [DONE]  31/08/2026 — nova rota GET /api/dashboards/:id/layout;
                        VisualGridSection e KpiGridSection passam a ler layout.kpis/
                        layout.faixas por id, nenhum lê mais v.dados para decidir
                        posição. heuristica-grade.ts saiu do bundle web e virou
                        tools/layout/src/heuristica-original.ts (só layout:extrai usa).
                        Faixa virou grid de 12 colunas com span declarado; a distinção
                        pool-vs-fração-fixa do L3 sobrevive, agora por contagem de
                        colunas da faixa (contaFaixasLargasPorAltura). tela 112/112
                        limpo (após reaquecer — virada de dia invalidou o cache no meio
                        da sessão, não é defeito). MEDIDAS-TELA.md sem regressão de
                        telas em nenhuma página. 1437/1437, build verde.
Fase L5 (§7)    [DONE]  31/08/2026 — R3+R2: usaVisualSobDemanda (hook
                        cancelável/single-flight, retry corrigido) +
                        EsqueletoDaPagina (esqueleto lê layout, sem salto). R4
                        completo: ?visual= vira lista (getAll, chave ordenada);
                        idsIniciais corta kpis+2 faixas; VisualNaDobra dispara por
                        IntersectionObserver (200px, não 100% — a de 100% carregava
                        toda faixa "perto" de mais em página curta, medido em
                        agendamento-field). tools/tela/src/perf.ts (novo) mede
                        docs/PERF-CARGA.md. R5: paginasVistas (Map por urlDaPagina,
                        teto de 30 por ordem de inserção em cache-pagina.ts) mostra o
                        snapshot velho síncrono antes do fetch, que sempre revalida
                        atrás. R6: hover >180ms sobre aba pronta pré-aquece layout+
                        página (guarda pointer:fine); cancela se o mouse sai antes.
                        Dois achados DURANTE a verificação de R5/R6, corrigidos nesta
                        fase (não deixados para depois, por serem causados por R4):
                        (1) escolhe() zerava `pagina` mas deixava `layout` (estado)
                        apontando para a página ANTERIOR por um render — toda coluna
                        do layout velho ficava sem par em porId e piscava esqueleto
                        rotulado com os ids da página ERRADA a cada troca de aba;
                        corrigido lendo layoutsVistos (ref) no mesmo lote que zera
                        pagina. (2) o aquecimento (aquecedor.ts e tools/subir/
                        aquece.ts) sempre pediu /api/dashboards/:id SEM ?visual= —
                        que desde R4 enche a chave de cache '*', que o navegador
                        NUNCA pede mais (ele sempre lista idsIniciais). O servidor
                        anunciava "quente" sem aquecer a chave que a tela de fato
                        usa; ambos agora buscam /layout primeiro e aquecem com os
                        MESMOS ?visual= do navegador (tools/layout/src/corte-eager.ts,
                        fonte única, reexportada por carga-progressiva.ts), com
                        fallback para a URL antiga se o layout não responder.
                        Achado à parte, ainda fora de escopo: carrega() (servidor.ts)
                        tem cache single-flight por dash.id sem tratar aborto — só
                        reproduzido de propósito ao navegar para outra aba enquanto
                        os visuais sob-demanda de uma página pesada ainda calculam em
                        segundo plano (não ao abrir uma página já assentada); pode
                        prender a página seguinte por vários segundos porque o
                        servidor é um processo só. Documentado, não corrigido nesta
                        fase. 1461/1461, build verde, tela 112/112.
Fase L6 (§8)    [PARCIAL] 31/08/2026 — 1 de 6 visuais: rosca com centro numérico
                        (Rosca.tsx, novo). Mesmo DadosDeTabela que Tabela.tsx já lia
                        (zero requisição, zero campo novo) — só troca o desenho: a
                        coluna marcada `chave` vira categoria, a primeira numérica
                        que sobrar vira valor, corDaSerie/corNoTema dão a MESMA
                        identidade de cor que o resto da tela já usa para a mesma
                        categoria. A troca é DECLARADA (layout.yaml `render: rosca`
                        + `improvements:` com `numero_muda: false`), nunca decidida
                        por cardinalidade em tempo de render — mesma disciplina
                        anti-heurística da Fase L4. Piloto em agendamento-field: Turno
                        e Status SLA (ff38eddc.../0c0223c6...), as duas tableEx de
                        composição pequena que o §8 cita como exemplo. VisualPronto
                        ganhou o prop `render` (a forma de layout.yaml), threadado por
                        Visual/SobDemanda/VisualNaDobra até o funil único de
                        VisualPronto — cobre os três caminhos de carregamento (direto,
                        sob demanda, fora da dobra) com uma mudança só. `usaCaixa`
                        (o AutoSizer do Grafico.tsx) extraído para usa-caixa.ts,
                        compartilhado — Rosca precisa da mesma medida, e duplicar
                        divergiria no primeiro ajuste feito só de um lado. Verificado
                        no navegador (Playwright), claro e escuro: rosca desenha com
                        a paleta e o total certos, mesma altura de card que a tableEx
                        que substituiu. tela 112/112 (duas tentativas pegaram um
                        timeout de .selo isolado, em página SEM rosca — diario-
                        instalacao e depois manutencao-inicial, cada vez numa página
                        diferente — refeito limpo; carga de sistema, não regressão).
                        1461/1461, build verde. Faltam 5 visuais: sparkline no KPI,
                        bullet, heatmap de calendário, data bar na matriz, ranking-
                        barra — cada um seu próprio commit, mesmo padrão.
Fase L7 (§9)    [TODO]  decisão do chart SDK (recomendação: sem biblioteca)
```

---

## 0. A ideia central, em um parágrafo

Hoje **o layout é derivado do dado em tempo de renderização**. `VisualGridSection.tsx`
conta `v.dados.pontos.length` para decidir se um gráfico é largo, e `v.dados.colunas.length`
para decidir se uma tabela cabe lado a lado. Consequência: **a mesma página tem forma
diferente conforme o filtro** — um recorte que deixa 20 categorias põe o gráfico lado a
lado, 25 o põem sozinho na linha, e ninguém pediu isso. É também a leitura que estoura
(`Cannot read properties of undefined (reading 'pontos')`) nos três testes vermelhos de
hoje.

O plano troca isso por uma **spec de layout declarada, versionada e validada**: a forma da
tela deixa de ser efeito colateral do recorte e passa a ser contrato. É isso que permite
mexer em tudo sem quebrar — a mudança vira um diff revisável, não uma surpresa na tela.

---

## 1. O que é gerado, o que é escrito à mão, e o que nasce agora

| camada | quem escreve | pode editar à mão? |
|---|---|---|
| `specs/dashboards/*.spec.yaml` | `tools/extractor`, a partir do PBIP | **não** — é o registro do original |
| `specs/_catalog/{measures,tables,queries}` | extractor + revisão humana | só com registro em `SPEC-DRIVEN.md` |
| `specs/paridade/*.yaml` | humano | sim — é o gabarito |
| **`specs/layout/*.layout.yaml`** | **humano — nasce neste plano** | **sim, é a fonte da verdade da tela** |
| `specs/golden/layout/*.json` | gerado por `npm run layout:golden` | **não** — é a linha de base |

A separação não é burocracia: o `spec.yaml` gerado tem `position: {x, y, width, height}`
em coordenadas de Power BI (tela fixa de 2800×2130). Ele diz **onde estava**, e é insumo.
O `layout.yaml` diz **onde fica**, e é decisão.

### O formato do `layout.yaml`

```yaml
# MANTIDO POR HUMANOS — a forma da tela. O número continua vindo da spec gerada.
pagina: visao-geral
base: specs/dashboards/visao-geral.spec.yaml   # todo id abaixo tem de existir aqui

kpis:
  - visual: 2ce6f3783f48638594d6
    enfase: alta          # alta = card grande da esquerda; normal = o resto
    tendencia: 8ab3...    # opcional: sparkline lida de um gráfico JÁ calculado na página

faixas:
  - titulo: "Gráficos e tendências"
    altura: grafico       # uma das classes de --util; nunca pixel solto
    colunas:
      - { visual: 103b7a8a, span: 8, render: colunas }
      - { visual: 23c5a9bf, span: 4, render: rosca }   # improvement — ver §8
  - titulo: "Análise detalhada"
    altura: matriz
    colunas:
      - { visual: 7f2c..., span: 12 }

ocultos:
  - visual: e3e8acb8
    porque: "carimbo de refresh; a faixa de status do topo já mostra"

improvements:
  - visual: 23c5a9bf
    original: barChart
    virou: rosca
    porque: "4 categorias de STATUS; a barra gastava 8 colunas para 4 valores"
    numero_muda: false      # se virar true, precisa de entrada em divergencias.yaml
```

Regras que o validador impõe (§3): `span` soma 12 por linha; toda `altura` é uma classe
que existe; todo visual da spec gerada aparece **exatamente uma vez** — numa faixa ou em
`ocultos` com motivo. **Não existe visual que sumiu sem alguém escrever por quê.**

---

## 2. Item zero — a árvore limpa (bloqueia tudo)

Nada deste plano começa com 18 arquivos soltos e 4 testes vermelhos.

1. Fechar a auto-exclusão de cross-filter — os 3 testes de `apps/api/test/calcula.test.ts:513-565`
   estouram em `dados.pontos` porque o visual clicado volta sem `dados`. É implementação
   incompleta, não teste errado.
2. Reconciliar os **867px** medidos pelo cromo novo com o `DESIGN-SYSTEM.md` §3, que ainda
   diz ~950 — `apps/web/test/casca.test.ts:156` reprova de propósito quando o documento
   fica para trás. **Mover o documento é a correção**, não afrouxar o teste.
3. Apagar `apps/api/test/_dbg.test.ts` (depuração).
4. Commit em `staging`, validar, `main`.

- **Critério de saída:** `npm test` = 1373/1373 e `git status --short` vazio.

---

## 3. Fase L1 — o contrato, sem mexer em um pixel

A fase mais importante e a menos visível: **gerar o `layout.yaml` de cada página a partir
do que a tela faz hoje**, e provar que ela continua idêntica.

1. `tools/layout/src/extrai.ts` — lê a spec gerada + as heurísticas atuais
   (`LIMIAR_LARGO=24`, `LIMIAR_ESTREITA=3`, `porPosicao`) e **escreve** os 14
   `specs/layout/*.layout.yaml` com a forma de hoje. A heurística vira dado, uma vez, e
   morre em seguida.
2. `tools/layout/src/valida.ts` — as regras do §1. Roda dentro do `npm test`, sem navegador.
3. `npm run layout:golden` — resolve cada página em **três recortes** (sem filtro, mês
   padrão, um clique de cross-filter) e grava faixa/span/altura/forma de cada visual em
   `specs/golden/layout/`.

- **Critério de saída:** os três recortes produzem **golden idêntico** — a prova de que a
  forma parou de depender do dado. Hoje eles divergem, e essa divergência é o defeito.
- **Por que antes de qualquer mudança:** sem linha de base, "não quebrou nada" é memória.

---

## 4. Fase L2 — o arnês de medição

Invariante que não é comando é intenção. `tools/tela/` (playwright já é dependência):

```bash
npm run tela                      # 14 páginas × 4 resoluções × 2 temas = 112 combinações
npm run tela -- --pagina=visao-geral --largura=1366 --altura=768 --tema=claro
```

> "9 páginas" era o número de 26-27/08 (`docs/RECUPERACAO-27-08.md`, "11 telas" /
> "9 páginas × 4 resoluções"), antes de várias páginas existirem. Hoje há **14**
> `specs/dashboards/*.spec.yaml` — o mesmo conjunto que a Fase L1 já extraiu — e o
> `tools/tela/` roda contra as 14 por padrão.

Reprova quando: algum cartão for mais alto que a viewport; a **página** rolar na
horizontal; sobrar `v-auto`; um par texto/fundo dos tokens ficar abaixo de 4,5:1; ou dois
gráficos da mesma linha terminarem com alturas diferentes. Emite `docs/MEDIDAS-TELA.md`
com os números.

- **Critério de saída:** limpo nas 112 combinações, e o arquivo de medidas commitado.
  Rodado em 28/08/2026: **zero** cartão maior que a viewport, zero rolagem horizontal,
  zero `v-auto` e zero linha com alturas divergentes — nas 112. O que sobrou foi
  contraste: **5 pares abaixo de 4,5:1**, todos os "escurecidos como letra" (dourado,
  verde, vermelho) contra os fundos de estado (`--pbi-ok-bg`/`--pbi-erro-bg`/
  `--pbi-aviso-bg`) — 1 no tema claro (4,36:1) e 4 no escuro, o pior em **1,47:1**
  (dourado sobre o próprio aviso). Os números do `CLAUDE.md` (4,72:1 etc.) tinham sido
  medidos contra `--fundo`/`--superficie` no tema claro; nunca contra os fundos
  `color-mix()` de selo/badge, nem contra o tema escuro.

  **Corrigido no mesmo dia**, a pedido do Erick ("decide você"): `--pbi-gold-600`
  escureceu um degrau no claro (`#8A6600` → `#856200`); no escuro, o percentual de
  mistura dos três `-bg` virou variável (`--pct-ok-bg`/`--pct-erro-bg`/
  `--pct-aviso-bg`, redeclaradas em `.dark` para 12% — os 55% do claro produziam um
  midtom contra o qual nem branco puro alcançava o piso) e os três "-texto" ganharam
  override em `.dark` (`--pbi-gold-600` reaproveita `--pbi-gold`; `--pbi-green-texto`/
  `--pbi-critico-texto` ganharam tom novo). Reconfirmado com `npm run tela`: **112/112
  sem problema**. Ver `apps/web/src/estilo.css` (comentários ao lado de cada valor) e
  `docs/DESIGN-SYSTEM.md` §1.1.1 para a derivação completa.

---

## 5. Fase L3 — densidade (a Fase 2 da recuperação, que ficou aberta)

Agora com arnês, dá para refazer a passada de 26/08 **medindo**, e não reaplicando patch
às cegas (`RECUPERACAO-27-08.md` §3.2 explica por que o patch antigo não serve).

1. ✅ Régua raiz em 14px — **já estava feito** antes desta fase começar (`estilo.css:236`),
   achado ao investigar, não refeito.
2. ✅ `--chrome` recalibrado por medição — **também já estava feito**: `altura-medida.ts`
   já mede `--h-nav`/`--h-antes`/`--h-entre` em tempo de execução, de um jeito mais geral
   do que este item pedia (não é um número fixo recalibrado, é medido a cada render).
3. ✅ Preservado `@layer base` e os tokens de papel — nenhuma mudança nesta fase tocou neles.

**O que realmente faltava**, achado rodando `tools/tela` contra o app: `.v-grafico`/
`.v-tabela`/`.v-matriz` reservavam uma fração fixa de `--util` **por cartão**, cega para
quantos outros cartões de largura cheia existem na mesma página — `.v-matriz` em
particular pedia `var(--util)` inteiro, certo para uma página com uma matriz só, absurdo
para `agendamento-field` (3 matrizes) ou `premiacao-instalacao` (4 tabelas largas + 1
matriz). Corrigido com `usaAlturaDasFaixasLargas` (`altura-medida.ts`) + classe
`.filas-largas` (`VisualGridSection.tsx`, `estilo.css`): cada TIPO mantém sua fração de
sempre como um pool próprio (grafico 45,5%, tabela 54,5%, matriz 100% de `--util`) e só
DIVIDE esse pool quando há mais de uma faixa do mesmo tipo — com uma faixa só (o caso
comum, e o único que existia até esta fase) o resultado é idêntico ao de antes.

**Medido, antes → depois, a 1920×1080** (`npm run tela`, zero regressão nas 112
combinações — `l-inst`/`l-mapa`/`l-tec`/`visao-geral`/`telefonia-ouvidoria`, que tinham
0-1 faixa de cada tipo, ficaram bit-a-bit iguais):

| página | visuais | antes | depois |
|---|---|---|---|
| diario-instalacao | 7 | 1,7 tela | **1,0 tela** |
| premiacao-instalacao | 8 | 2,5 telas | **2,2 telas** |
| relatorio-do-mes | 22 | 2,7 telas | **2,2 telas** |
| instalacao-reincidente | 9 | 1,7 tela | **1,5 tela** |
| manutencao-inicial | 18 | 1,6 tela | **1,5 tela** |
| protocolos-detalhados | 4 | 1,1 tela | **1,0 tela** |
| **agendamento-field** | **21** | 4,7 telas | **3,4 telas** |

- **Critério de saída, em número:** nenhuma página passa de **3 telas** a 1920×1080, e as
  de até 8 visuais cabem em **1**. **Fechado para todas, exceto `agendamento-field`**
  (3,4 telas, não 3,0) — e a decisão, tomada com o número em mãos e não antes: **aceitar
  como exceção documentada**, não espremer mais. Os 3,4 telas vêm dos PISOS de
  legibilidade (273/280/360px), que a partir daqui dominam a conta porque a página tem 8
  faixas de largura cheia (2 gráficos + 3 tabelas + 3 matrizes) — mais que o dobro de
  qualquer outra página. Reduzir os pisos destrava o número, mas troca "página rola mais"
  por "pivot table difícil de ler" — inspecionado no navegador (1920×1080): as três
  matrizes no piso de 360px continuam com cabeçalho e linhas legíveis. Rolagem contida
  no cartão continua permitida; cartão maior que a tela, não —
  e nenhum cartão ultrapassa a viewport aqui, só a PÁGINA rola mais que as outras.

---

## 6. Fase L4 — a grade declarada substitui as heurísticas [DONE] 31/08/2026

`VisualGridSection.tsx` passa a **ler o layout spec** em vez de contar pontos. As
constantes `LIMIAR_LARGO` e `LIMIAR_ESTREITA` saem do código. A grade vira 12 colunas com
`span` declarado, e os pontos de quebra ficam num lugar só, global — não por página.

- **Critério de saída:** o golden dos três recortes fica **igual entre si e igual ao de
  L1**, `npm run tela` limpo, e nenhuma leitura de `v.dados` sobra em `apps/web/src/atomic/`.

### O que mudou

`GET /api/dashboards/:id/layout` é rota nova: `specs/layout/*.layout.yaml` carrega uma
vez na subida (`carregaLayouts`, `apps/api/src/servidor.ts`) e serve o `LayoutSpec` cru,
sem cálculo — por isso não depende do snapshot nem de filtro. `apps/web/src/App.tsx`
busca o layout da página num efeito próprio (chaveado só em `atual`, cache em memória
por sessão) e entrega o array inteiro de `visuais` para `KpiGridSection`/
`VisualGridSection`, que agora fazem sua própria busca por id em cima de `layout.kpis`/
`layout.faixas` — nenhum dos dois lê `.dados` para decidir posição, só para desenhar.

`heuristica-grade.ts` saiu de `apps/web/src/atomic/` (bundle de produção) e virou
`tools/layout/src/heuristica-original.ts`: só `npm run layout:extrai` ainda a usa, para
regenerar um `.layout.yaml` a partir da forma derivada quando alguém quiser. Rodar
`layout:extrai` de novo depois da mudança provou diff vazio (só a data do cabeçalho),
confirmando que a heurística não mudou de comportamento na mudança de endereço.

A faixa virou `<div class="faixa-grade">` (`display: grid; grid-template-columns:
repeat(12, ...)`), com cada coluna em `grid-column: span <n>`. A distinção
"compacto/estreita vs largo" do L3 (fração fixa vs pool por tipo) não morreu — só trocou
de fonte: uma faixa de **1 coluna só** ainda ganha a classe `.filas-largas` (participa do
pool de `usaAlturaDasFaixasLargas`); uma faixa de **várias colunas** usa a fração fixa,
sem pool. `contaFaixasLargasPorAltura` (`altura-medida.ts`) faz essa contagem a partir do
`layout.yaml` em vez de `largos.length`/`tabelasLargas.length`/`matrizes.length` — mesma
partição, fonte diferente, sem reabrir a conta de altura que o L3 mediu.

### Medido

`npm run tela` limpo nas 112 combinações (14 páginas × 4 resoluções × 2 temas), depois
de reaquecer as páginas — o meio da sessão cruzou a virada do dia (30→31/08), e a chave
do cache de resposta inclui o dia UTC do cálculo (`diaDoCalculo`), então a primeira
rodada pós-virada recalculou tudo do zero e estourou o timeout de 15s do arnês em
páginas aleatórias — não é defeito desta fase, é o comportamento já documentado em
`specs/_catalog/cache-policies.yaml`. `npm run aquece` resolveu.

`docs/MEDIDAS-TELA.md` contra o commit da L3: nenhuma página mudou de "telas" de forma
que importe — as diferenças são de poucos pixels (deriva do dado do dia, não do
layout): `premiacao-instalacao` 2,5→2,4 tela (melhorou), `instalacao-reincidente` e
`relatorio-do-mes` variam <40px, `agendamento-field` continua em 3,4 (a exceção aceita
na L3, intocada). Inspeção visual em `visao-geral` (3 gráficos lado a lado, `span: 4`
cada) e `agendamento-field` (faixas de 3 e 4 colunas) em 1366×768 confirmou que a grade
de 12 colunas não deixou nenhuma coluna estreita demais para ler — mesma legibilidade de
antes do flex-wrap.

1437/1437 testes (+5 em `altura-medida.test.ts`, +2 em `servidor.test.ts` sobre os
1432/1432 herdados da L3, e a suíte já tinha crescido para 1432 antes desta fase), build
limpo (264,6 kB / 84,95 kB gzip, ante 263,6/84,6 da L3 — o custo do fetch de layout).

---

## 7. Fase L5 — carregamento: o contrato e o orçamento

Seis regras. As três primeiras corrigem defeito; as três últimas são ganho.

| # | regra | por quê |
|---|---|---|
| R1 | **Nenhuma decisão de layout lê o dado** | resolvido em L4; é o que faz a tela parar de mudar de forma a cada filtro |
| R2 | **O esqueleto nasce com a altura do visual que vai substituir** | já existe (`alturaDoConteudo`); estender a todo caminho de espera, para a tela não pular quando a resposta chega |
| R3 | **Todo pedido é cancelável e single-flight** | já existe no `App.tsx` (AbortController); falta no `SobDemanda`, que hoje não cancela |
| R4 | **Fora da dobra só calcula quando chega perto** | `IntersectionObserver` com margem de uma tela. Hoje a página inteira é **uma requisição só** (`App.tsx:139`): o tempo de abrir é o do visual mais lento, mesmo o que ninguém rolou até ver |
| R5 | **Cache de cliente stale-while-revalidate**, chave = `pagina + filtros + clicados` | voltar/avançar hoje refaz o pedido inteiro; o histórico já guarda o estado, falta guardar a resposta |
| R6 | **Prefetch da aba sob o cursor** | o servidor já tem cache de resposta; o custo é uma requisição que ia acontecer de qualquer jeito |

**Orçamento medido, antes e depois** (`npm run tela -- --perf`): primeiro pixel útil,
número de requisições, bytes transferidos e ms por visual, a frio e a quente. Sem esses
quatro números, "ficou mais rápido" não entra em nota de release — `DEPLOY.md` §1: *linha
sem comando não entra*.

**Nenhuma dependência nova de runtime.** O bundle de hoje é **263,6 kB (84,6 kB gzip)**
com React inteiro dentro; qualquer biblioteca entra só com esse número medido dos dois lados.

---

## 8. Fase L6 — os visuais novos (um por commit)

Cada um: forma nova, **número igual**. É a regra 4 do `SPEC-DRIVEN.md` — melhoria entra
como campo adicional, preservando o original para comparação. Se o número mudar, vira
entrada em `divergencias.yaml`, nunca um silêncio.

| visual | onde entra | por que ganha do que está lá | custo de dado |
|---|---|---|---|
| **Rosca com centro numérico** | composições de ≤6 categorias (STATUS, TURNO, PRAZO SLA) | a barra gasta uma linha inteira para 4 valores | zero — mesmo `pontos` |
| **Sparkline no KPI** | faixa de indicadores | 12 pontos de contexto onde hoje há um número solto | **zero requisição nova**: lê um gráfico já calculado na mesma página |
| **Bullet (realizado × meta)** | KPIs que já têm medida de meta | a barra mostra o vão; dois números lado a lado não | zero |
| **Heatmap de calendário** | `diario-instalacao`, `agendamento-field` | 30 barras viram uma grade 5×7 que cabe em 1/3 da altura | zero |
| **Data bar na célula da matriz** | matrizes de ranking | densidade sem gastar mais espaço | zero |
| **Barra de ranking com rótulo dentro** | técnicos/equipes (o `RANKX` já existe) | elimina a coluna de rótulos, que hoje come ~30% da largura | zero |

**Todos com custo de dado zero, de propósito** — nenhum pede medida nova, tabela nova ou
requisição nova. Visual que precisa de dado novo é outra conversa, e entra depois da
paridade fechada.

A forma é declarada no `layout.yaml` (`render:`), com o tipo original do PBIP registrado ao
lado. Trocar a forma nunca troca o valor — e o teste de paridade, que compara **número**,
continua sendo a rede.

---

## 9. Fase L7 — fechar a Fase 3 do roadmap

`docs/DECISAO-CHART-SDK.md`, que é exatamente o critério de saída de `CONTINUACAO.md` §9.2.

**Recomendação: continuar sem biblioteca.** O renderizador SVG próprio já entrega as três
formas do PBIP e as seis novas do §8 sem um byte de dependência; o argumento de não
escolher uma peça de passagem (#33) continua valendo, e agora tem número — 84,6 kB gzip de
bundle inteiro é menos do que a maioria das bibliotecas de gráfico sozinha. A decisão fica
**registrada** em vez de adiada, que é o que o critério pede.

---

## 10. A ordem, com o resto do projeto

```
item zero (árvore limpa)  →  L1 contrato  →  L2 arnês  →  L3 densidade  →  L4 grade
   →  L5 carregamento  →  L6 visuais novos  →  L7 decisão do SDK
```

Em paralelo, sem depender da tela: os **~81 testes de 26/08** (`RECUPERACAO-27-08.md`
§3.4) e os **4 artefatos de infra** (`Dockerfile`, `docker-compose.prod.yml`, `nginx.conf`,
supervisão). Depois deles, a ordem original: snapshot completo → as 3 páginas relidas no
Power BI sem limpar filtro → `npm run paridade`.

**O que continua fora do alcance deste plano**, e vale repetir para não parecer esquecido:
o **login** (§9.4) é o bloqueio nº 1 da publicação e é decisão de produto. Nenhuma fase
aqui o destrava, e nenhuma delas é publicável sem ele — o `snapshot/` tem CPF, RG e
endereço de cliente.

---

## 11. Como este plano evita a terceira perda

As duas perdas de 26 e 27/08 foram de **trabalho solto na árvore**, não de trabalho
publicado. Então:

1. **Uma fase por sessão, commit em `staging` no fim de cada uma.** Nada atravessa a noite
   fora do git.
2. **Nenhuma fase começa com a árvore suja** — é o item zero, e ele vale de novo a cada fase.
3. **Golden e arnês antes da mudança, não depois.** L1 e L2 existem para que L3 a L6 sejam
   revisáveis: cada uma vira um diff de golden e uma tabela de medidas.
4. **Documentar só o que está commitado.** Quatro comportamentos já foram documentados como
   prontos a partir de uma árvore que não existia mais.
