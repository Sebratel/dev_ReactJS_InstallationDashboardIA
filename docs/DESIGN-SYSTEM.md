# Design System — HUBBI v2

Referência da interface desta plataforma. O `CLAUDE.md` (regra 4) e o cabeçalho de
`apps/web/src/estilo.css` apontam para cá.

---

## 0. Por que esta seção existe: a paleta trocou duas vezes num dia

**Hoje a primária é o bordô `#880F17`, com o dourado `#D9B300` como par.** Os neutros,
o verde e o vermelho são do HUBBI. A história abaixo importa porque ela é o motivo da
forma dos tokens.

**Até 26/08/2026** o `apps/web` já estava em bordô — mas por engano. O cabeçalho do
`estilo.css` justificava a cor dizendo que era *"herdada do relatório que esta tela
substitui"*, e não era: aquelas são as cores do dashboard **COM · Gestão Comercial**,
que é o *exemplo* da skill `padrao-frontend-dashboards`, não a origem desta tela (o
`INST - Relatório Instalação`). Vieram copiadas junto com o padrão. O comentário ainda
se contradizia sozinho — citava o dashboard Comercial no título e "esta tela" no corpo
— e apontava a justificativa para a seção 0 **deste arquivo, que não existia**.

**Em 26/08/2026, primeira troca:** para o âmbar `#F59E0B` do HUBBI, a pedido do Erick,
por ser o padrão oficial.

**Em 26/08/2026, segunda troca:** de volta ao bordô, também a pedido dele. A escolha
visual é de quem é dono do relatório, e não precisa de justificativa técnica.

**As duas lições, e elas são diferentes:**

1. **Paleta se herda da marca, não se copia do exemplo.** Ao replicar um relatório,
   extraia as cores dele (no PBIP, `ThemeDataColor` no JSON). Se não der, pergunte —
   não preencha com o que estiver à mão. Esse foi o erro original.
2. **O documento tem de acompanhar a tela.** O que tornou o primeiro erro caro não foi
   a cor: foi haver, em dois arquivos, uma justificativa formal que não correspondia a
   nada. Ao trocar a paleta, troque `CLAUDE.md`, este arquivo e o cabeçalho do
   `estilo.css` no mesmo movimento.

---

## 1. Tokens

Definidos **duas vezes de propósito** em `apps/web/src/estilo.css`:

- em `@theme`, para virar utilitário do Tailwind (`bg-pbi-primary`, `text-pbi-muted`);
- em `:root`, para o CSS puro do arquivo e para o `style` dos SVG.

| Papel | Token | Valor |
|---|---|---|
| Primária — cabeçalho de visual, navegação ativa | `--pbi-primary` | `#F59E0B` |
| Hover da primária, bordas | `--pbi-primary-dark` | `#D97706` |
| Fundo suave da primária | `--pbi-primary-soft` | `color-mix` 8% |
| Sucesso / ativo | `--pbi-green` | `#10B981` |
| Erro / alerta | `--pbi-critico` | `#EF4444` |
| Texto principal | `--pbi-ink` | `#111827` |
| Texto secundário, rótulo de eixo | `--pbi-muted` | `#6B7280` |
| Bordas e divisores | `--pbi-borda` / `--pbi-grid` | `#E5E7EB` |
| Fundo geral | `--pbi-fundo` | `#F4F4F5` |
| Superfície de card | `--pbi-superficie` | `#FFFFFF` |
| Sem dado / "Outros" | `--pbi-neutro` | `#D1D5DB` |

**`--red` (#E30613) é exclusivo do texto da logo.** Erro é `--pbi-critico` (#EF4444).
Confundir os dois é o erro que a regra 4 do `CLAUDE.md` nomeia.

### 1.1 A regra que faltava: **cor CHEIA é FUNDO, cor ESCURECIDA é LETRA**

Foi a troca para o âmbar que revelou isto, e vale para qualquer primária. **Trocar
uma primária escura por uma clara — ou o contrário — inverte o foreground de toda a
interface.** Medido no dia:

| | contraste | veredito |
|---|---|---|
| branco sobre bordô | 9,87:1 | ok |
| **o mesmo branco sobre âmbar** | **2,15:1** | reprova, abaixo até do mínimo 3,0 de texto grande |
| âmbar claro sobre âmbar (subtítulo) | 1,72:1 | reprova |
| **âmbar como letra sobre branco** | **2,15:1** | reprova |
| verde #10B981 como letra no selo | 2,31:1 | reprova (já era 4,07 antes — sempre foi ruim) |
| vermelho #EF4444 como letra no selo | 3,35:1 | reprova |

Atingiu de uma vez cabeçalho de card, de tabela, de diálogo, a aba ativa, os controles
de zoom, o KPI em destaque e os selos de estado. A causa raiz não é a cor: é o
foreground estar **escrito à mão em cada regra** em vez de vir de um papel.

Com os tokens por papel, a volta ao bordô custou trocar valores num lugar só — contra
77 substituições espalhadas na ida.

| papel | token | valor (bordô) | contraste |
|---|---|---|---|
| texto sobre a primária | `--pbi-sobre-primary` | `#FFFFFF` | 9,87:1 (11,07 na ponta escura do gradiente) |
| subtítulo sobre a primária | `--pbi-sobre-primary-fraco` | `#F0E199` | 7,49:1 |
| a primária como letra | `--pbi-primary-texto` | `#880F17` | 9,87:1 no branco, 8,98 no fundo geral |
| o dourado como letra | `--pbi-gold-600` | `#8A6600` | 4,80:1 |
| verde como letra | `--pbi-green-texto` | `#047857` | 4,99:1 |
| vermelho como letra | `--pbi-critico-texto` | `#B91C1C` | 5,75:1 |

Duas armadilhas que a medição pegou:

- **`--pbi-sobre-primary` não deriva da primária nem de `--pbi-ink`.** São papéis
  independentes, e é essa independência que faz a próxima troca ser barata.
- **`--pbi-gold-600` valia `#D49F00`**, herdado, e era descrito como "texto sobre fundo
  claro" — mas media **2,18:1** no fundo geral. Nunca serviu para o que dizia servir.

**No tema escuro**, `--pbi-primary-texto` vira o dourado: o bordô como letra mede
1,80:1 sobre `#111827`. A **superfície** bordô, porém, não muda — ver § 1.3.

### 1.3 Um bordô só, nos dois temas

Contra o corpo escuro do card, o bordô mede 1,80:1: o bloco do cabeçalho não se
destaca. A saída óbvia seria clarear a primária no escuro — o único valor que fecha
3:1 é `#C42A38`. **Não foi o caminho**, por duas razões medidas:

1. **a separação já existe e é melhor:** o cabeçalho tem `border-bottom: 2px` em
   dourado, que mede **8,78:1** contra o corpo escuro. Separar por traço é mais forte
   que separar por preenchimento;
2. **em `#C42A38` o texto perde folga:** branco cai de 9,87 para 5,62 e o subtítulo
   dourado para 4,27 — abaixo do mínimo. Trocaríamos um bloco mais visível por um
   texto pior.

E dois bordôs seriam duas verdades sobre qual é a cor da marca.

### 1.2 Reset de elemento vai em `@layer base` — e isso não é estilo, é cascata

`@import "tailwindcss"` põe as utilidades em `@layer utilities`. Na cascata,
**declaração fora de camada vence qualquer declaração dentro de camada,
independente de especificidade**. Enquanto `button, select, input { background:
var(--superficie) }` esteve solto no `estilo.css`, todo `bg-*`, `text-*` e
`border-*` aplicado a `<button>` na aplicação inteira era descartado em silêncio.

Foi esse o bug de "clico na aba e ela não fica marcada": a aba ativa pedia
`bg-pbi-primary text-white` e renderizava branca com texto escuro, idêntica às
inativas. Conferido no CSS gerado — `.bg-pbi-primary` em `@layer utilities`,
`button,select,input` em profundidade 0.

**Padrão:** reset de elemento em `@layer base`; classe de componente
(`.primario`, `.cartao`) fica solta de propósito, para continuar vencendo utilidade.

**Nenhum hexadecimal fora do `:root`.** Uma exceção, consciente e documentada:
`apps/web/src/grafico-forma.ts`, porque cor de série vai para atributo SVG (`fill`,
`stroke`) e atributo não lê variável de CSS. Se mudar aqui, mude lá junto.

> **Sobre os nomes dos tokens.** Com a volta ao bordô, `--pbi-gold` voltou a valer
> dourado de verdade (`#D9B300`) — o nome descreve a cor de novo. Sobra `--pbi-orange`
> (`#111827`) e `--pbi-orange-soft` (`#6B7280`), que hoje são tinta e cinza: esses dois
> mentem. Renomear são poucos usos, mas nenhum comportamento muda; fica como dívida
> registrada, não esquecida.
>
> Vale a observação geral: **nome de token deve dizer o PAPEL, não a cor.**
> `--pbi-primary` sobreviveu a duas trocas de paleta sem virar mentira; `--pbi-gold`
> só está certo hoje por coincidência da paleta ter voltado.

---

## 2. Séries de gráfico

Ordem fixa em `grafico-forma.ts`. A cor segue a **identidade** da série, nunca a
posição no ranking — filtro que tira uma série não pode repintar as que ficaram.

Separação medida em OKLab (×100). Piso: **15** em visão normal, **8** em daltonismo.

| par | normal | deutan | tritan |
|---|---|---|---|
| bordô × dourado | **41,4** | 38,0 | 56,8 |
| bordô × cinza | 22,3 | 17,8 | 97,5 |
| dourado × cinza | 29,1 | 30,2 | 131,5 |

Nenhum par vizinho fica abaixo de **15,6**, e o pior caso em daltonismo é **17,8** —
mais que o dobro do piso. A separação vem de **luminância** (bordô escuro, dourado
claro, cinza no meio), e luminância sobrevive a qualquer dicromacia.

**Isto não é a rampa bordô/dourado antiga**, que media 17,7 em visão normal e
despencava para **5,4 em tritanopia**, com o 4º par em 4,0. Aquela punha `gold` e
`orange` lado a lado — dois quentes de luminância parecida; esta alterna
escuro/claro/médio.

**O dourado tem só 2,0:1 contra o branco do card, e isso é aceito.** A série é uma
área *preenchida*, não um traço fino, e o mínimo de 3:1 do WCAG 1.4.11 vale para o
contorno de gráfico essencial. Uma barra sólida se enxerga bem a 2:1 — o que não se
enxerga é texto, e por isso o dourado de letra é outro token (`--pbi-gold-600`).

Ainda assim vale a contrapartida do padrão: **legenda sempre presente** com 2+ séries e
rótulo direto no extremo da linha. Identidade nunca fica só na cor.

**Verde e vermelho não entram na rampa de séries.** São cores de estado; usá-las como
"série 5" faz o leitor ler significado onde não há.

### Os slots que somem no tema escuro

Uma cor de série cuja luminância bate com a do fundo escuro não fica discreta: ela
**desaparece**, sem erro no console e sem teste falhando.

Visto na tela em 26/08/2026, ainda na paleta âmbar: o slot da tinta valia `#111827`,
que é **exatamente** `--pbi-superficie` dentro de `.dark` — 1,00:1 —, e a série
`CAPACIDADE TARDE` não existia no AGENDAMENTO FIELD, nem na legenda nem nas colunas.
O gráfico mostrava metade do dado que dizia mostrar.

Com o bordô o problema muda de dono mas não some: o próprio bordô mede **1,80:1**
sobre `#111827`. A troca é **mínima de propósito** — só os três slots que reprovam;
mudar os outros faria a mesma série trocar de cor entre temas sem motivo:

| slot | claro | → escuro | contraste no escuro |
|---|---|---|---|
| 0 bordô | `#880F17` (1,80) | **`#E08B94`** | 7,00 |
| 6 tinta | `#374151` (1,72) | **`#F4F4F5`** | 16,14 |
| 7 "Outros" | `#D1D5DB` | **`#4B5563`** | 2,35 — recessivo de propósito |
| 1 dourado | `#D9B300` | — | 8,78 |
| 2 cinza | `#6B7280` | — | 3,67 |
| 3 bordô claro | `#C9707A` | — | 5,14 |
| 4 dourado claro | `#F0E199` | — | 13,46 |
| 5 cinza claro | `#9CA3AF` | — | 6,99 |

Mantendo a ordem, a separação entre vizinhos continua a da rampa clara, exceto nos
pares que tocam os trocados — remedidos: 0×1 = 18,2, 5×6 = 25,4, 6×7 = 52,2.

O slot 7 abaixo de 3:1 **não é desvio novo**: no tema claro ele mede 1,47:1
(`#D1D5DB` sobre branco). "Outros" nunca carrega categoria de verdade.

A tradução vive em `corNoTema(cor, escuro)` e é aplicada **na renderização**, não em
`corDaSerie` — aquela é pura e a suíte fixa o resultado dela por índice. Tema é
decisão de tela, não de forma.

### A exceção medida: o mapa de estado

`POR_SIGNIFICADO` (produtivo / inconclusivo / improdutivo / sem ação) usa cores
próprias, **fora** do HUBBI, e isso é deliberado. Com o verde e o vermelho do HUBBI, o
par `Produtivo` × `Improdutivo` mede **8,9 em deuteranopia** — passa raspando do piso
de 8 e é pior que os **10,6** de hoje. A ordem da pilha (`Inconclusivo` entre os dois)
é parte da correção. Remedido em 26/08/2026.

---

## 3. A conta que faz a tela caber

Altura de card **nunca** é pixel chutado: é fração da área útil.

```css
--chrome: calc(var(--h-topbar) + var(--h-nav) + var(--h-filtros) + 34px);  /* 170px */
--util:   calc(100vh - var(--chrome));
```

As duas frações **têm de somar 1** — com `(util - gap) * 1 + gap = util`, duas faixas
cabem exatamente numa tela. E a fração do gráfico precisa ficar **acima do piso dele**
na resolução de referência, senão o piso vence e reempurra a soma para fora.

Corrigido em 26/08/2026: estava `0,52 + 0,545 = 1,065`, e a tela de duas faixas rolava
em **toda** resolução de referência — 46px além em 1440×900, 58px em 1920×1080 — que é
exatamente o que esta conta existe para impedir. Três comentários no código já diziam
"somam uma tela"; só a implementação discordava.

Hoje: **0,473 + 0,527**.

| resolução | útil | gráfico | tabela | soma | |
|---|---|---|---|---|---|
| 1366×768 | 598 | 340 | 310 | 660 | rola 62px (pisos vencem, deliberado) |
| 1440×900 | 730 | 341 | 379 | **730** | cabe |
| 1920×1080 | 910 | 426 | 474 | **910** | cabe |

Em 1366×768 a rolagem é escolha: abaixo dos pisos o visual fica ilegível, e o padrão
manda preferir rolar a comprimir.

---

## 3.1 Gráfico não rola: ele pagina

**Regra desta tela: nenhum gráfico rola.** Se as categorias não cabem com largura
legível, o gráfico mostra uma janela e oferece um paginador — nunca uma barra de
rolagem horizontal.

O que havia antes: largura fixa por categoria (`nCat * 58px`) dentro de um contêiner
com `overflow-x: auto`. Medido na AGENDAMENTO FIELD, **87 categorias = 5.154px de
desenho num card de 1.660px**: 32% visível, 3 telas de arraste.

E um segundo defeito, silencioso: o `<svg>` levava `height="100%"` com `viewBox` de
altura fixa 360. Sem `preserveAspectRatio` explícito, o padrão `xMidYMid meet`
**encolhe o desenho pelo eixo mais apertado** (250/360 = 0,69) e o **centraliza** —
colunas em 69% do tamanho e duas faixas mortas de ~790px. Era essa a área vazia.

Como é agora:

- a caixa do desenho é **medida** (largura e altura), com `getBoundingClientRect` em
  `useLayoutEffect` + ouvinte de `resize` — não `ResizeObserver`, que no dashboard de
  referência não disparou e deixou gráficos invisíveis sem erro no console;
- `viewBox` == caixa, escala exatamente 1:1;
- **nenhum piso de altura.** Um piso de 200px fazia o `<svg>` ficar 2px mais alto que
  a caixa em 1366×768 e devolvia a rolagem, agora vertical. Quem cede é a margem de
  baixo, não o desenho;
- `P/M/G` deixou de esticar o desenho: escolhe **quantas categorias por página**
  (banda mínima 24 / 40 / 64px). Num plot de ~1.550px isso dá ~64, ~38 e ~24;
- abre na **última** página — categoria de gráfico operacional é quase sempre tempo,
  e o que interessa é o presente;
- o **teto do eixo Y sai de todas as categorias**, não da página. Reescalar por
  página faria duas páginas com colunas de altura igual valerem números diferentes;
- `Ampliar` passou a ser útil de verdade: caixa mais larga cabe mais categoria por
  página, então mostra **mais dado**, não o mesmo dado maior.

Verificado em 1366×768, 1440×900 e 1706×1000: escala 1:1, sem rolagem em nenhum eixo,
console limpo.

### O rótulo do eixo: monte do fim para o começo

Numa hierarquia de data o rótulo é `"julho / 15"`, e cortar pelos primeiros N
caracteres devolvia **"julho /…"** — cortava justamente o dia, a única parte que
distingue uma coluna da vizinha. Vinte rótulos idênticos são piores que nenhum,
porque parecem informar.

Monte começando pelo **nível mais específico** e acrescente os anteriores enquanto
couberem, com `/` apertado: com 8 caracteres de orçamento, `"julho / 15"` vira
**"julho/15"**. E o orçamento conta a banda **vezes o passo** — um rótulo desenhado a
cada 2 dispõe do espaço das duas bandas.

## 3.2 A matriz pagina nas DUAS direções

As linhas já paginavam no servidor (200 por janela). As colunas, não — e as duas
paginações são independentes, então paginar linha e deixar coluna solta ainda
multiplica. Medido na DIÁRIO INSTALAÇÃO: matriz **167 × 198**, **80.265 nós no DOM e
33.936 células**, sete vezes a segunda tela mais pesada.

Com janela de 24 colunas: **11.815 nós e 4.872 células** — queda de 85%.

Duas coisas que a janela não pode mudar:

- **o CSV sai inteiro**, não a janela. "Exportar" que exporta só a tela é a armadilha
  clássica de tabela paginada; está dito no `title` do botão.
- **a escala da barra de dado sai de todas as células**, não da página — senão duas
  barras do mesmo tamanho em páginas diferentes valeriam números diferentes.

E a régua da barra é **por medida**, corrigido junto: a matriz de 3 medidas tinha
`REALIZADOS` 1..9234, `DIAS` 1..183 e `MÉDIA` 0,5..62,8 numa escala só — a barra de
`MÉDIA` ficava em 0,5% da largura. Medida diferente é outra régua, pelo mesmo motivo
que um gráfico nunca tem dois eixos Y.

**Aberto, e é do dado, não da tela:** a matriz de 197 colunas tem medida única `QTD.`
com mínimo 1, **máximo 8834 e média 5,2**. Há um agregado no meio do detalhe, então
toda barra real fica em 0,06% e a barra de dado não comunica nada nessa matriz.
Resolver isso é decidir se aquela linha/coluna de total deve estar no corpo — decisão
de spec, não de CSS.

## 3.3 Rolagem contida é permitida; vazamento não

A regra, dita pelo Erick em 26/08/2026: *"alguns pode deixar rodando, porém não pode
destruir o layout da tela."* Ou seja, a linha não passa entre "tem rolagem" e "não
tem" — passa entre **contida** e **vazando**:

| | o que é | veredito |
|---|---|---|
| **rolagem contida** | um elemento com `overflow: auto/scroll` rolando dentro da própria caixa: a matriz larga dentro de `.rolagem`, a lista longa dentro do card | **pode** |
| **vazamento** | conteúdo passando da janela sem nenhum ancestral que role ou corte; a **página** rolando na horizontal; card mais alto que a tela | **não pode** |

O gráfico é a exceção que continua valendo: ele **nunca** rola (§ 3.1). Rolagem
contida é para tabela e matriz, onde varrer muitas linhas é o próprio trabalho.

Auditado em 26/08/2026 nas 11 telas × 3 resoluções: **zero vazamentos, zero rolagem
horizontal de página**, e o card mais alto mede 688px numa janela de 1000 — nenhum
passa da tela.

**Ao auditar isto, cuidado com o falso positivo que eu mesmo produzi:** checar
`getBoundingClientRect().right > innerWidth` acusa toda tabela larga dentro de
`.rolagem`, que é justamente o caso legítimo. É preciso subir pelos ancestrais e só
acusar quando **nenhum** deles tem `overflow` `auto`/`scroll`/`hidden`/`clip`.

## 4. Antes de dizer que está pronto

1. Abra no navegador — build que passa não garante tela que renderiza.
2. Nenhum **card** mais alto que a janela — é o que a conta de `--util` garante.
3. Sem rolagem horizontal **de página** (`documentElement.scrollWidth > clientWidth`),
   e nenhum vazamento — ver § 3.3 para a diferença entre contido e vazando.
4. Provoque os três estados: carregando, vazio, erro.
5. Console limpo, sem aviso de `key` nem de prop inválida.
6. Clique **dentro** de cada aba e diálogo, não só na navegação.
7. `grep -rn "#[0-9a-fA-F]\{6\}" apps/web/src --include=*.tsx` deve voltar vazio.
