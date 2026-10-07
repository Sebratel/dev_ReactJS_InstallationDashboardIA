# Design System — Analytics Platform (bordô Sebratel)

Referência da interface desta plataforma. O `CLAUDE.md` (regra 4) e o cabeçalho de
`frontend/src/estilo.css` apontam para cá.

> **Este arquivo se chamava "HUBBI v2", e o nome era o começo do problema.** O HUBBI
> é outro design system, real, com paleta própria (âmbar `#F59E0B`). Esta plataforma
> diverge dele **de propósito** — a primária é o bordô `#880F17`, escolha do dono do
> relatório. Enquanto o título disse HUBBI, a tabela de tokens abaixo carregou valores
> do HUBBI enquanto a tela rodava em bordô, e quem lia o documento reintroduzia a cor
> errada de boa-fé. Corrigido em 27/08/2026 medindo token por token contra o
> `estilo.css`.

---

## 0. Por que esta seção existe: a paleta trocou duas vezes num dia

**Hoje a primária é o bordô `#880F17`, com o dourado `#D9B300` como par.** Os neutros,
o verde e o vermelho são do HUBBI. A história abaixo importa porque ela é o motivo da
forma dos tokens.

**Até 26/08/2026** o `frontend` já estava em bordô — mas por engano. O cabeçalho do
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

Definidos **uma vez**, em `frontend/src/estilo.css`: o valor claro no `:root`, o escuro
no `.dark`, com a medição de contraste ao lado. O `@theme inline` só dá nome de
utilitário a cada papel (`bg-pbi-primary`, `text-pbi-muted`) — compila para
`var(--pbi-primary)`, então o utilitário acompanha o tema escuro sem `dark:`.

Até a fase 6 (06/10/2026) o `@theme` era uma segunda cópia em hexadecimal, e divergiu
sem ninguém ver (ACHADOS #183). O `casca.test.ts` agora barra valor copiado no `@theme`
e papel do `:root` sem utilitário.

Os valores abaixo foram **conferidos linha a linha contra o `estilo.css` em
27/08/2026**. Todos os que estavam aqui antes eram do HUBBI e nenhum batia com a tela.

| Papel | Token | Valor |
|---|---|---|
| Primária — cabeçalho de visual, aba ativa | `--pbi-primary` | `#880F17` |
| Ponta escura do gradiente do cabeçalho | `--pbi-primary-dark` | `#6b2328` |
| Fundo suave da primária (hover de aba, pill) | `--pbi-primary-soft` | `color-mix` 8% |
| Par histórico da primária, série 2, borda ativa | `--pbi-gold` | `#D9B300` |
| Sucesso / ativo | `--pbi-green` | `#0E9224` |
| Erro / alerta | `--pbi-critico` | `#b3261e` |
| Texto principal | `--pbi-ink` | `#252423` |
| Texto secundário, rótulo de eixo | `--pbi-muted` | `#605E5C` |
| Bordas / grade | `--pbi-borda` / `--pbi-grid` | `#E3E0DC` / `#E1DFDD` |
| Fundo geral | `--pbi-fundo` | `#F3F2F1` |
| Superfície de card | `--pbi-superficie` | `#FFFFFF` |
| Sem dado / "Outros" | `--pbi-neutro` | `#C8C6C4` |

Escuro — os MESMOS tokens, redefinidos no `.dark` (não há nome `escuro-*`):

| Papel | Token | Valor no `.dark` |
|---|---|---|
| Fundo geral | `--pbi-fundo` | `#1B1A19` |
| Superfície de card | `--pbi-superficie` | `#252423` |
| Borda / grade | `--pbi-borda` / `--pbi-grid` | `#3B3A39` |
| Texto principal | `--pbi-ink` | `#F3F2F1` |
| Texto secundário | `--pbi-muted` | `#A19F9D` |

**Não existe token `--red`.** A linha que estava aqui mandava reservar `--red`
(`#E30613`) para o texto da logo e citava a regra 4 do `CLAUDE.md` — mas esse token
não está no `estilo.css` e nunca esteve nesta plataforma; é do HUBBI. Erro é
`--pbi-critico` (`#b3261e`), e como LETRA é `--pbi-critico-texto`.

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

Remedido em 27/08/2026 (os valores anteriores desta tabela vinham de dois tokens que
a tela não usa — `#047857` e `#B91C1C` são do HUBBI):

| papel | token | valor (bordô) | contraste no branco | no fundo geral |
|---|---|---|---|---|
| texto sobre a primária | `--pbi-sobre-primary` | `#FFFFFF` | **9,87:1** | 11,07 na ponta escura do gradiente |
| subtítulo sobre a primária | `--pbi-sobre-primary-fraco` | `#f0e199` | **7,49:1** | — |
| a primária como letra | `--pbi-primary-texto` | `#880F17` | **9,87:1** | 8,83:1 |
| o dourado como letra | `--pbi-gold-600` | `#856200` | **5,61:1** | 5,02:1 |
| verde como letra | `--pbi-green-texto` | `#0B7A1E` | **5,50:1** | 4,92:1 |
| vermelho como letra | `--pbi-critico-texto` | `#b3261e` | **6,54:1** | 5,85:1 |

Duas armadilhas que a medição pegou:

- **`--pbi-sobre-primary` não deriva da primária nem de `--pbi-ink`.** São papéis
  independentes, e é essa independência que faz a próxima troca ser barata.
- **`--pbi-gold-600` valia `#D49F00`**, herdado, e era descrito como "texto sobre fundo
  claro" — mas media **2,18:1** no fundo geral. Nunca serviu para o que dizia servir.

### 1.1.1 A medição de 27/08 tinha um fundo que faltava — achado pelo `backend/tools/tela` em 28/08

A tabela acima mede contra `--pbi-superficie`/`--fundo`. Nenhuma das duas é o fundo
**de verdade** de um selo ou badge de status (hoje `ui/Selo.tsx`): esses usam `--pbi-ok-bg`/`--pbi-erro-bg`/
`--pbi-aviso-bg`, tons derivados por `color-mix()` — e a Fase L2 do
`PLANO-LAYOUT-V1.md` (arnês de navegador, `backend/tools/tela/`) mediu contra o fundo real pela
primeira vez. Achou dois defeitos:

1. **`--pbi-gold-600` contra `--pbi-aviso-bg` claro: 4,36:1** — abaixo do piso, por
   pouco. Corrigido escurecendo um degrau (`#8A6600` → `#856200`, linha da tabela
   acima já atualizada).
2. **No tema escuro, os três nunca tinham sido medidos contra o `-bg` de verdade.**
   `--pbi-ok-bg`/`--pbi-erro-bg`/`--pbi-aviso-bg` são herdados via `color-mix()` com
   `var(--pbi-superficie)`, que MUDA no `.dark` — mas o percentual de mistura (10/9/55%)
   foi calibrado para uma superfície branca. 55% de dourado claro sobre um fundo escuro
   não "aclara de leve": pesa a média inteira e produz um midtom (`#94865F`) contra o
   qual **até branco puro só alcançava 3,6:1**. Corrigido em duas partes: o percentual
   de mistura virou `--pct-ok-bg`/`--pct-erro-bg`/`--pct-aviso-bg`, redeclarado para
   12% dentro de `.dark` (a fórmula e a cor de base continuam as mesmas); e os três
   "-texto" ganharam override em `.dark` — `--pbi-gold-600` reaproveita `--pbi-gold`
   (8,61:1 no fundo escuro), `--pbi-green-texto` e `--pbi-critico-texto` precisaram de
   tom novo (`#10AE2B` a 4,64:1, `#E56B64` a 4,62:1, os dois contra o `-bg` escuro
   recalibrado). Ver `docs/MEDIDAS-TELA.md` para os 5 números originais e
   `frontend/src/estilo.css` para os comentários ao lado de cada valor.

**No tema escuro**, `--pbi-primary-texto` vira o dourado: o bordô como LETRA mede
**1,57:1** sobre a superfície escura `#252423`, e o dourado no lugar dele mede
**7,67:1**. A **superfície** bordô, porém, não muda — ver § 1.3.

### 1.3 Um bordô só, nos dois temas

Contra o corpo escuro do card (`#252423`), o bordô mede **1,57:1**: o bloco do
cabeçalho não se destaca. A saída óbvia seria clarear a primária no escuro — o único
valor que fecha 3:1 é `#C42A38`. **Não foi o caminho**, por duas razões medidas:

1. **a separação já existe e é melhor:** o cabeçalho tem `border-bottom: 2px` em
   dourado, que mede **7,67:1** contra o corpo escuro. Separar por traço é mais forte
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
(`.cartao`, `.aba`) fica solta de propósito, para continuar vencendo utilidade.

**O avesso da mesma regra: classe solta com nome de utilitário.** Uma `.grid` no
`estilo.css`, sem uso próprio, vencia o utilitário `grid` em todo elemento que o usava
— o calendário do KPI saiu com 10px de gap em vez de 2px (fase 6c, ACHADOS #184). O
`casca.test.ts` agora barra classe do CSS com nome de utilitário do Tailwind.

**Fase 6 (híbrido):** peças simples e repetidas viram utilitário sobre os tokens, com
`cn` (`ui/Selo`, `ui/Botao`, `Erro`/`Aviso`, `ui/IdVisual`, o cabeçalho do `Cartao`,
`visuais/kpi/partes`, os estados de `ui/Estado`); a conta de altura, a grade, os SVG e
as animações (o brilho do esqueleto, `.brilho`) ficam aqui.
Cada passo é provado por `npm run tela:regua` (estilo computado antes × depois).

**Nenhum hexadecimal fora do `:root`.** Uma exceção, consciente e documentada:
`frontend/src/grafico-forma.ts`, porque cor de série vai para atributo SVG (`fill`,
`stroke`) e atributo não lê variável de CSS. Se mudar aqui, mude lá junto.

> **Sobre os nomes dos tokens.** Com a volta ao bordô, `--pbi-gold` voltou a valer
> dourado de verdade (`#D9B300`) — o nome descreve a cor de novo. `--pbi-orange`
> (`#E66C37`) e `--pbi-orange-soft` (`#EB895F`) continuam laranja de verdade no
> `estilo.css`, mas **não entram na rampa de séries** (ver § 2): ficaram herdados do
> padrão e hoje não têm consumidor. Dívida registrada, não esquecida.
>
> Vale a observação geral: **nome de token deve dizer o PAPEL, não a cor.**
> `--pbi-primary` sobreviveu a duas trocas de paleta sem virar mentira; `--pbi-gold`
> só está certo hoje por coincidência da paleta ter voltado.

---

## 2. Séries de gráfico

Ordem fixa em `grafico-forma.ts`. A cor segue a **identidade** da série, nunca a
posição no ranking — filtro que tira uma série não pode repintar as que ficaram.

Separação medida em OKLab (×100). Piso: **15** em visão normal, **8** em daltonismo.

Os oito slots, na ordem de `SLOTS` em `grafico-forma.ts`: bordô `#880F17`, dourado
`#D9B300`, cinza `#605E5C`, bordô claro `#C9707A`, dourado claro `#f0e199`, cinza
claro `#A19F9D`, tinta `#252423`, neutro `#C8C6C4` ("Outros").

| par | normal | deutan | tritan |
|---|---|---|---|
| bordô × dourado | **41,4** | 38,0 | 56,8 |
| bordô × cinza | 17,0 | **10,8** | 89,6 |
| dourado × cinza | 33,3 | 34,1 | 126,5 |

Pior par vizinho da lista: **19,8**. Pior caso em daltonismo entre os três primeiros:
**10,8** — acima do piso 8, mas com bem menos folga do que esta tabela dizia antes
(ela trazia 22,3 / 17,8 / 29,1, que são de outra rampa). A separação vem de
**luminância** (bordô escuro, dourado claro, cinza no meio), e luminância sobrevive a
qualquer dicromacia.

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

Com o bordô o problema muda de dono mas não some: o próprio bordô mede **1,57:1**
sobre a superfície escura `#252423`, e a tinta do slot 6 **é** essa superfície —
1,00:1, invisível por construção. A troca é **mínima de propósito**; mudar os outros
faria a mesma série trocar de cor entre temas sem motivo. O mapa real é o `NO_ESCURO`
de `grafico-forma.ts`, com **quatro** entradas (remedidas em 27/08/2026):

| slot | claro | → escuro | no escuro |
|---|---|---|---|
| 0 bordô | `#880F17` (1,57) | **`#E08B94`** | 6,12 |
| 2 cinza | `#605E5C` (2,40) | **`#C8C6C4`** | 9,10 |
| 6 tinta | `#252423` (1,00) | **`#F3F2F1`** | 13,86 |
| 7 "Outros" | `#C8C6C4` (9,10) | **`#605E5C`** | 2,40 — recessivo de propósito |
| 1 dourado | `#D9B300` | — | passa |
| 3 bordô claro | `#C9707A` | — | passa |
| 4 dourado claro | `#f0e199` | — | passa |
| 5 cinza claro | `#A19F9D` | — | passa |

O slot 2 foi para `#C8C6C4` e **não** para o cinza médio óbvio (`#8A8886`) porque
aquele ficava a 11,2 em OKLab do bordô claro vizinho — abaixo do piso 15. Com
`#C8C6C4` os vizinhos medem 16,4 e 21,1.

O slot 7 abaixo de 3:1 **não é desvio novo**: no tema claro ele mede 1,70:1
(`#C8C6C4` sobre branco). "Outros" nunca carrega categoria de verdade.

### O tema escuro esteve DESLIGADO até 27/08/2026 — e isso era pior que não ter tema

Todo o parágrafo acima descrevia um caminho que não executava. O `useThemeStore`
gravava a classe **`tema-escuro`** no `<html>`; o `estilo.css` reage a **`.dark`**,
que é o contrato do `@custom-variant` do Tailwind e o seletor do bloco de tokens.
Nomes diferentes, nenhum erro, nenhum teste falhando. Resultado:

- a página ficava **clara**, porque nenhuma regra respondia;
- mas o `Grafico.tsx` lê `isDark` do mesmo store e repinta as séries com `corNoTema`
  — então quem tivesse `dark` no `localStorage` via um dashboard claro com as séries
  pintadas para fundo escuro. O bordô virava `#E08B94` sobre branco (2,4:1) e a
  tinta virava `#F3F2F1`, que **some** no card branco.

Ou seja: o mapa que existe para impedir série invisível passou a causá-la, no outro
tema. E não havia botão nenhum para sair — ver § 5.

**Só `useThemeStore.ts` escreve a classe, e ela se chama `dark`, em inglês, porque é
nome do Tailwind e não convenção nossa.**

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

> **Atualizado em 28/08/2026.** `--h-filtros` saiu do `--chrome` — a barra de filtros
> agora entra em `--h-antes` (ver abaixo), porque contá-la nos dois termos ao mesmo
> tempo descontaria a mesma faixa duas vezes. A tabela e o parágrafo "Medido no
> navegador em 27/08/2026" logo adiante ainda descrevem o cromo ANTERIOR a esta
> mudança — remedir é a Fase L2 de `docs/PLANO-LAYOUT-V1.md` (o arnês `backend/tools/tela/`),
> não um número para chutar aqui.

```css
--chrome: calc(var(--h-topbar) + var(--h-nav) + 50px);
--util:   calc(100vh - var(--chrome) - var(--h-antes) - var(--h-entre));
```

`--h-antes` é a distância medida (por `altura-medida.ts`) do topo do conteúdo da
`.area` até o primeiro card — inclui filtros, avisos, KPIs e título de seção. `--h-entre`
é a distância entre o primeiro par de cards empilhados. Os dois variam por página e por
resolução (61 a 300px medidos em 27/08/2026); é por isso que passaram a ser termo
medido, e não constante declarada — declarar um único valor era o mesmo erro que
`--h-nav`/`--h-filtros` já tinham custado duas vezes.

**Nenhum desses quatro números pode ser chutado, e três deles já foram.** Medido no
navegador em 27/08/2026, igual nas três resoluções de referência:

| termo | vale | como se sabe |
|---|---|---|
| `--h-topbar` | 52px | altura fixa da `.topo`, declarada |
| `--h-nav` | **74px** | MEDIDO: as 14 telas quebram em duas linhas |
| `--h-filtros` | **71px** | MEDIDO: 110px na MANUTENÇÃO INICIAL a 1366×768, que tem 13 controles |
| resto | **60px** | rodapé 32 + padding da `.area` 28 |

Os dois do meio são **publicados em tempo de execução** por `altura-medida.ts`: os
valores do `:root` (64 e 50) são só o chão, para o primeiro quadro não sair absurdo.

Duas correções que esta tabela representa, e as duas eram silenciosas:

- **`--h-filtros` valia 50px fixos contra 71px reais.** Uma barra com 10, 11 ou 13
  controles quebra em duas ou três linhas — a conta errava por 21px em toda página e
  por **60px** na pior.
- **o "resto" valia 34px, descrito como "cobre paddings e bordas", e esquecia o
  rodapé inteiro** (32px).

Somados, `--util` saía **26px otimista em toda resolução**. Otimismo aqui não é
arredondamento: é card mais alto do que a tela, que é exatamente o defeito que esta
conta existe para impedir.

As duas frações **têm de somar 1** — com `(util - gap) * 1 + gap = util`, duas faixas
cabem exatamente numa tela. E a fração do gráfico precisa ficar **acima do piso dele**
na resolução de referência, senão o piso vence e reempurra a soma para fora.

Corrigido em 26/08/2026: estava `0,52 + 0,545 = 1,065`, e a tela de duas faixas rolava
em **toda** resolução de referência. Três comentários no código já diziam "somam uma
tela"; só a implementação discordava. Hoje: **0,455 + 0,545 = 1**.

### O piso do gráfico é o limite de legibilidade, e a fronteira é sabida

Duas regras disputam a altura do gráfico, e é preciso saber qual está mandando:

- a **fração** (`0,455`) faz duas faixas caberem exatamente numa tela;
- o **piso** (`273px`, atualizado em 28/08/2026 — era `309px`) diz onde o visual
  deixa de comunicar.

Enquanto a fração ideal for maior que o piso, a igualdade vale. `frontend/test/casca.test.ts`
deriva o ponto de virada lendo `--h-topbar` do CSS e usando o cromo/gap como
`H_NAV_MEDIDO=74`, `H_FILTROS_MEDIDO=71`, `gap=10`, `+60` de rodapé/padding —
o mesmo cromo "antigo" da nota no topo desta seção, ainda não remedido para o
`--h-antes`/`--h-entre` novos:

```
273 / 0,455 + 10 (gap)  ->  util >= 610   ->   vh >= 610 + 257 = 867
```

**A igualdade vale de ~867px de altura de janela para cima** (era ~950px antes do piso
cair de 309 para 273 em 28/08/2026 — `frontend/test/casca.test.ts:156` é o teste que
prende os dois números juntos). Abaixo disso o piso vence e a página rola — e isso é
escolha, não descuido: abaixo do piso o visual fica ilegível, e o padrão manda preferir
rolar a comprimir.

> A tabela abaixo ("Medido no navegador em 27/08/2026") e o cálculo acima ainda usam o
> cromo de 257px de ANTES do `--h-antes`/`--h-entre` (nota no topo da seção). Remedir
> com o cromo novo é a Fase L2 do plano de layout — os números aqui continuam válidos
> como registro histórico, não como estado atual da tela.

**Medido no navegador em 27/08/2026**, na AGENDAMENTO FIELD:

| resolução | útil | gráfico | tabela | soma + gap | |
|---|---|---|---|---|---|
| 1366×768 | 511 | 309 | 280 | 599 | rola 88px (piso vence, deliberado) |
| 1440×900 | 643 | 309 | 345 | 664 | rola 21px (piso vence, deliberado) |
| 1920×1080 | 823 | 370 | 443 | **823** | cabe, ao pixel |
| 1920×1200 | 943 | 425 | 500 | 935 | cabe (a tabela bate no teto de 500) |

**Essa fronteira subiu porque o cromo cresceu, e vale saber por quê.** Com a navegação
LATERAL, `--h-nav` era 0: a barra gastava largura, não altura. Com a faixa no topo
(74px) mais a barra de filtros medida (71px), o cromo foi de ~178px para 257px. São
~79px que saíram da área de conteúdo — o preço de ter **230px a mais de largura**, que
é o que decide quantas categorias cabem por página de gráfico e de matriz.

Sobre o 309 em si: o piso anterior era 258px, calibrado com `--h-nav: 0`, e nesta
casca ele deixava **188px de desenho** dentro do card. 309px deixa ~240px, que é onde
o eixo girado a 45° ainda cabe.

> **Duas derivações erradas antes desta, e as duas pelo mesmo motivo.** Primeiro pus
> 330px sem conta nenhuma; depois 309px derivando de 1440×900 com o cromo de 231px.
> A segunda parecia rigorosa e não era — o erro não estava na álgebra, estava em
> `--h-filtros` mentir 21px. **Derivar de um número declarado é tão chute quanto
> chutar; a diferença é que parece cuidadoso.** Meça as faixas antes de usá-las numa
> conta.

**Página com muitas faixas rola, e isso não é defeito.** A invariante é sobre uma tela
de DUAS faixas e sobre nenhum card passar da janela. A AGENDAMENTO FIELD tem 18
visuais e mede ~6.300px: você rola entre faixas, mas cada card cabe inteiro e cada um
rola por dentro — ver § 3.3.

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

## 4. Interação: filtro que não aparece na tela é recorte invisível

Nem todo filtro nasce de um *slicer* da barra. Clicar numa barra do gráfico faz
**filtragem cruzada**, e a URL pode trazer um filtro de coluna que a página nem
segmenta. Até 27/08/2026 esses não apareciam em lugar nenhum: os números mudavam, a
causa não estava na tela, e a única saída era recarregar. É exatamente a diferença
entre alguém dizer *"o dashboard está com número errado"* e *"há um recorte
aplicado"* — a primeira frase vira chamado.

**Regra:** todo filtro em vigor tem de estar visível e ser removível.

O `App.tsx` compara os filtros com as segmentações que a página desenha e mostra uma
*pill* (`ActiveFilterPill`) para cada um **sem slicer próprio**, com o `x` que o
remove. Os que TÊM slicer ficam de fora de propósito: o botão já mostra a seleção e a
contagem, e repetir a mesma informação em dois lugares vira ruído.

Conferido na tela: na VISÃO GERAL o clique cai numa coluna que já tem slicer e
nenhuma pill aparece; na RELATÓRIO DO MÊS ele cai em `Data Agendado`, que não tem, a
pill aparece, e o `x` limpa o filtro e o parâmetro da URL.

### A página abre PRÉ-FILTRADA, e por isso precisa da árvore de data

O relatório original abre com um recorte de data aplicado — `jul/2026` na Visão Geral,
Agendamento, Diário e Protocolos; `2026` em Manutenção e Instalação/Reincidente. Era o
**gap nº 1** da auditoria de paridade, e `frontend/src/filtros-padrao.ts` o resolve
desde 20/08… mas ficou **sem chamador**. Medido em 27/08/2026 na VISÃO GERAL: sem
filtro a tela abre com **35.166** protocolos; com jul/2026, com **3.238**, que é o
número do relatório. Onze vezes de diferença, e nada na tela dizendo por quê.

O padrão é semeado **só na abertura e na troca de tela**. Quem limpa o filtro fica
limpo — nenhum efeito o reaplica a cada render. Recarregar traz o padrão de volta,
igual ao original.

**Abrir pré-filtrado obriga a ter o controle daquele recorte.** Sem ele, a única coisa
que o usuário pode fazer com o mês padrão é apagá-lo: não há como pedir junho. E o
controle não pode ser um seletor plano, porque o motor **recusa** reduzir aquela
segmentação a um nível — a spec diz, com todas as letras: *"segmentação de hierarquia
com 3 níveis ativos (Ano/Mês/Dia). Ela é um controle de drill, e a escolha ali é um
caminho, não um conjunto de valores de um nível — filtrar pelo primeiro aplicaria um
filtro que ninguém pediu."*

Por isso a barra monta a **árvore Ano > Mês > Dia**
(`SegmentacaoDataHierarquia.tsx`, com `hierarquia-data.ts` testado ao lado) **no lugar**
daquele controle, e não ao lado dele: o slicer marcado `naoFiltra` desenhava um botão
que dizia "todos" com a página filtrada em julho. Um controle que mente é pior que
controle nenhum.

A rota `/valores` precisou abrir para esse caso, e a abertura é estreita: só
segmentação de **hierarquia** (campo `niveis`, estrutural — não a frase em português do
`naoFiltra`) e só **sem `nivel`**, que são as datas cruas de que a árvore precisa para
saber quais meses cada ano tem. A trava que importa continua inteira — a coluna tem de
ser segmentação **desta** página. Levantado antes de mexer: as **seis** segmentações
`naoFiltra` do modelo inteiro são hierarquia de data, então não existe caso em que isto
alcance coluna com dado de cliente.

---

## 5. A casca: topo, navegação e os dois interruptores

O formato é o do padrão de dashboards — **topbar, faixa de navegação entre telas,
barra de filtros, área** —, não barra lateral. A lateral gastava 230px de LARGURA
permanentemente: 17% do horizontal em 1366px, fora do conteúdo. E largura é o que
gráfico e matriz mais precisam, porque é ela que decide quantas categorias cabem por
página. A faixa de topo cobra ~74px de ALTURA em troca, e altura é dividida entre
menos coisas.

**A faixa mede a própria altura.** Os 14 rótulos somam 1.511px só de texto e 2.113px
com ícone e respiro, contra 1.366px de tela: não cabe em uma linha. Ela usa
`flex-wrap` (aba escondida atrás de rolagem horizontal é aba que ninguém acha) e o
`AppShell` publica a altura real em `--h-nav`, porque `--util` a soma e todo card
depende dela. `useLayoutEffect` + `resize`, **não** `ResizeObserver` — mesma escolha
do medidor do gráfico, pelo mesmo motivo: no dashboard de referência o observer não
disparou e os visuais ficaram invisíveis, sem erro no console.

### Interruptor de estado global precisa de botão. Sempre.

O tema (claro/escuro) e o **modo conferência** gravam no `localStorage` e sobrevivem
ao F5 — de propósito: quem confere não quer reativar a cada recarga. Mas isso os
torna **armadilha** quando não há como desligá-los.

Foi o que aconteceu: os dois ficaram órfãos. O `useThemeStore` e o `alterna` do
`usaModo` eram lidos por componentes, mas **nenhum botão os chamava** — o cabeçalho
que os tinha (`HeaderSebratel.tsx`) nunca chegou a ser usado pelo `App.tsx`. Quem
caísse em conferência ou no escuro ficava lá, e no caso do tema o estado nem sequer
pintava a página (§ 2).

Hoje vivem no `grupo-acoes-cabecalho` do `AppShell`, com `aria-pressed` e `title` que
diz o estado atual **e** o que o clique faz. Regra que fica: **estado que persiste
precisa de controle visível na mesma tela**; se você adicionar um, o botão faz parte
da entrega, não do polimento.

### A marca é desenhada, não baixada

O topo tinha `<img src="/assets/logo-sebratel-circular.png">` e esse arquivo **nunca
existiu no repositório** — não há `frontend/public/`. Eram 404 em toda carga e o ícone
quebrado do navegador ao lado do nome da empresa. Hoje é um `<svg>` inline, que não
pede rede e acompanha a paleta. Se o arquivo oficial entrar em `frontend/public/`,
troque só aquele bloco do `AppShell.tsx`.

---

## 6. Antes de dizer que está pronto

1. Abra no navegador — build que passa não garante tela que renderiza.
2. Nenhum **card** mais alto que a janela — é o que a conta de `--util` garante.
3. Sem rolagem horizontal **de página** (`documentElement.scrollWidth > clientWidth`),
   e nenhum vazamento — ver § 3.3 para a diferença entre contido e vazando.
4. Provoque os três estados: carregando, vazio, erro.
5. Console limpo, sem aviso de `key` nem de prop inválida.
6. Clique **dentro** de cada aba e diálogo, não só na navegação.
7. `grep -rn "#[0-9a-fA-F]\{6\}" frontend/src --include=*.tsx` deve voltar vazio.
8. **Zero 404 na aba de rede.** Imagem quebrada em cabeçalho de relatório é a primeira
   coisa que alguém vê e a última em que confia — e não aparece no console como erro
   de JS, só como recurso ausente.
9. **Abra nos DOIS temas.** Tema que ninguém abre é tema que não existe: o escuro
   ficou desligado por uma classe com nome trocado, sem erro e sem teste falhando.
10. **Clique em cada interruptor que persiste, recarregue, e desligue.** Se ele grava
    no `localStorage` e não tem botão, você acabou de trancar o usuário lá dentro.
11. **Filtre clicando num visual** e confirme que o recorte aparece na tela e sai por
    um clique — ver § 4.
11b. **Abra a página e confira o recorte inicial.** Se ela abre pré-filtrada, tem de
    haver na barra um controle que MUDA aquele recorte, não só um que o apaga.
12b. **Meça as faixas de cromo (`.topo`, `.nav-telas`, `.filtros`, `.rodape`) contra
    os tokens.** Faixa que quebra em duas linhas e token que não acompanha é o defeito
    mais caro deste arquivo, e já apareceu três vezes.
12. **Meça a invariante das duas faixas** em 1440×900 e 1920×1080: `gráfico + tabela
    + gap` tem de dar `--util` exatamente. Piso acima da fração ideal quebra isso.
