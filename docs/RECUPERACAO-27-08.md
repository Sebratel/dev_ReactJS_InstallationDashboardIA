# Recuperação — auditoria de 27/08/2026

> Levantamento feito lendo **as 31 sessões do Claude Code deste projeto**
> (`~/.claude/projects/c--Users-erick-azambuja-Desktop-DASHBOARD---Instala--o/*.jsonl`,
> 04/08 a 27/08) e cruzando cada arquivo escrito com o que está hoje no disco e no git.
>
> Conclusão em uma frase: **nada é irrecuperável**, o repositório está íntegro e
> publicado, e o que falta é **uma coisa só de verdade** — o sistema de alturas do
> front-end nunca chega aos gráficos.
>
> **Atualização de 27/08, mais tarde:** as duas frentes mais urgentes fecharam. A
> memória numerada voltou (Fase 0: `ACHADOS.md` com os #1 a #76, e mais três documentos)
> e os gráficos ganharam altura (Fase 1, medida). Ficam abertas a **Fase 2**
> (densidade) e a **Fase 3** (os ~81 testes de 26/08). E ficou registrado um terceiro
> episódio: entre 21 e 26/08, quatro comportamentos que só existiam na árvore de
> trabalho foram **documentados como prontos** no `README.md` e no `ARCHITECTURE.md` —
> corrigido no mesmo dia.

---

## 1. O que aconteceu

| quando | o quê |
|---|---|
| 26/08 09:46–10:09 | Sessão `dc2c82e3` faz a **passada de densidade** (raiz 14px, `--chrome` recalibrado, `largo` removido dos gráficos). Medida, buildada, **não commitada**. |
| 26/08 (tarde) | A árvore de trabalho é apagada. **A causa não fomos nós:** em 27/08 você relatou *"O GEMINI REVERTEU TUDO QUE FIZEMOS"* — outro agente/IDE desfez o trabalho não commitado. O `git reset --hard` que aparece no reflog é da reconstrução, não da destruição. |
| 26/08 18:56–19:23 | Sessão `6a29c9f8` reconstrói o dia 26 a partir do **próprio** transcript — 8 commits (`0aae15c`…`ec4aa1a`). Ela não enxergava a sessão `dc2c82e3`, então a densidade ficou de fora. |
| 27/08 09:35–09:52 | Mais 2 commits de restauração (`33f460a`, `561e2ec`), incluindo o SQL de dois ramos do `protocolos-produtividade`. |
| 27/08 ~10:03 | Um `checkout -f` (reflog: `checkout: moving from main to main`) apaga o que ainda estava solto. |
| 27/08 10:13 | Sessão `6a29c9f8` descobre que **todo cartão recebe `v-auto`** e que a página tem 8.460px. Investigação interrompida aí. |

**A causa da perda não foi o reset — foi trabalho fora do git.** Tudo que estava
commitado sobreviveu a ambos os episódios, sem exceção.

---

## 2. O que sobreviveu (verificado, não presumido)

- Árvore limpa em `561e2ec`. `main` == `staging` == `origin/main` == `origin/staging`
  — **está tudo publicado**, não há mais nada em risco.
- `npm test`: **1357 testes, 1357 verdes, 0 falhas**.
- `npm run web:build` (`tsc --noEmit && vite build`): verde, 1843 módulos.
- Das **278 arquivos do repositório** que as sessões escreveram, só 2 não existem:
  - `apps/web/src/atomic/atoms/Button.tsx` — nunca foi importado por ninguém e nunca
    entrou em commit nenhum. Foi tentativa descartada, não perda.
  - `packages/query-engine/src/connectors-datahub.ts` — idem, e coerente com a decisão
    já tomada de tirar o DataHub do caminho dos protocolos.
- Trabalho de 26/08 à tarde/noite: **presente**. `@layer base` (3x),
  `--pbi-primary-texto` (11x), os `clamp` das faixas (5x), `paginaColunas` na Matriz,
  `tetoDasAreas`, `janela.ts` + `janela.test.ts` + `Paginacao.tsx`.
- `notificaInvalida` não existe no repositório, mas **isso não é perda**: o único
  vestígio nas sessões era um *comentário* dizendo que o método se chamaria
  `avisaClientes`, e `docs/DECISAO-REALTIME.md` (11/08) decidiu **não construir**
  realtime — a API lê snapshot em disco, invalidar cache não deixaria número mais fresco.

---

## 3. O que falta

### 3.1 ✅ O sistema de alturas não alcançava os gráficos — CONSERTADO em 27/08

> **Fechado.** `Grafico.tsx` passou a mandar `altura="grafico"`, `largo` saiu das duas
> chamadas e os cartões de espera (`SobDemanda`, ramo de erro do `VisualPronto`) nascem
> com a altura do visual que vão substituir, por `alturaDoConteudo()`. O diagnóstico
> abaixo fica como registro, com **duas correções que a medição impôs**:
>
> **1. Os 8.460px eram de antes do conserto da matriz.** Aquele número foi medido quando
> as matrizes estavam em `v-auto` (2.386px e 2.123px); o conserto delas já estava
> commitado quando este começou. Medido com playwright, `agendamento-field` a 1366×768
> estava em **5.564px** e ficou em **5.133px**; `visao-geral`, de **1.727px** para
> **1.343px**.
>
> **2. `largo` estava inerte, não somando.** `.largo` é `grid-column: 1 / -1`, e só faz
> efeito dentro de um pai `display: grid` — quem posiciona os gráficos é o
> `VisualGridSection`, que usa **flex**. Nenhum gráfico ocupava uma linha inteira por
> causa dele; o lado a lado dos compactos sempre veio de lá. Removê-lo foi tirar um
> controle que não controlava nada.
>
> **E o ganho maior não foi a página mais curta.** Em `visao-geral`, os três gráficos
> mediam **475px, 475px e 112px** — em `auto`, a moldura vem do conteúdo, e um gráfico de
> poucas categorias nascia ilegível ao lado de dois grandes. Agora os três têm 283px.
> Uma linha de gráficos só parece uma linha quando eles têm a mesma altura.
>
> Nenhuma das 3 páginas × 2 resoluções medidas tinha cartão maior que a tela, `v-auto`
> remanescente ou rolagem horizontal.

`Cartao.tsx` faz `props.altura ?? 'auto'`, e `v-auto` é `height: auto`. Quem **não**
passa `altura` cai fora de `--util`, dos `clamp` e da regra "duas faixas = uma tela":

| chamador | passa `altura`? |
|---|---|
| `Matriz.tsx:155` | sim (`"matriz"`) — e o comentário da linha 143 avisa da armadilha |
| `Tabela.tsx:224` | sim (`"tabela"`) |
| **`Grafico.tsx:306` e `:313`** | **não** → hoje sim (`"grafico"`) |
| `SobDemanda.tsx:48,60`, `VisualPronto.tsx:24` | não → hoje sim, por `alturaDoConteudo()` |

Como gráfico é a maioria dos visuais, o efeito é a página inteira: **8.460px**.
Some-se `largo` em todas as chamadas do `Grafico` (= `grid-column: 1 / -1`), e cada
gráfico ocupa uma linha inteira sozinho, com o desenho encolhido no canto.

`CLASSE_DE_ALTURA` já tem a entrada `grafico: 'v-grafico'` pronta — ela nunca foi usada.

### 3.2 A passada de densidade de 26/08 — perdida, mas reconstituível

Ausentes hoje: `html { font-size: 14px }`, `--h-kpis`, `--h-secoes`, o `--chrome`
recalibrado; e `largo` voltou às duas chamadas do `Grafico`.

**As fontes sobreviveram**, no scratchpad da sessão `dc2c82e3`:
`patch1..6.mjs` + `troca.mjs` (texto exato de cada troca), `medir.mjs`, `varre.mjs`,
`interage.mjs`, as capturas e o `testes.txt`.

⚠️ **Não dá para reaplicar às cegas.** Os patches foram escritos contra a `estilo.css`
de 26/08 de manhã (`--h-topbar: 49px`, `body font-size: 13px`); a de hoje é outra
(`52px`, e ganhou `@layer base` e `--pbi-primary-texto`, que são trabalho *posterior*
e devem ser preservados). Os scripts abortam com `NAO ENCONTRADO` em vez de corromper
— use-os como **especificação**, e re-meça.

### 3.3 A documentação de decisões — a maior perda, e recuperável

Achado depois da primeira versão deste plano, varrendo as 31 sessões. Entre 19/08 e
26/08 **nada foi commitado**, e a reconstrução devolveu os documentos muito menores:

| documento | 19/08 | hoje | perdido |
|---|---|---|---|
| `docs/ACHADOS.md` | 5.808 | 217 | **−5.591** |
| `docs/PROMPT-CONTINUACAO.md` | 659 | 143 | −516 |
| `docs/PERGUNTAS-NEGOCIO.md` | 654 | 254 | −400 |
| `docs/CONTINUACAO.md` | 738 | 408 | −330 |
| `docs/DECISAO-CAMADA-M.md` | 542 | 424 | −118 |
| `docs/DECISAO-GRAO-FIELD-AGENDA.md` | 211 | 110 | −101 |

O `ACHADOS.md` sozinho carregava os **achados #1 a #76** — a memória numerada que o
resto da documentação referencia. Foi **recriado do zero** em 25/08, por uma sessão que
constatou que o arquivo "não existia mais".

**As versões de 19/08 estão intactas no git, em `5ce7c20`.** Restaurar é fundir, não
sobrescrever: `README.md`, `DESIGN-SYSTEM.md`, `ARCHITECTURE.md` e
`DECISAO-DESEMPENHO.md` **cresceram** no mesmo período e a versão de hoje é a boa.

A camada de *decisão* do que se perdeu está resgatada em
[DECISOES-DAS-SESSOES.md](DECISOES-DAS-SESSOES.md).

### 3.4 Uma discrepância aberta

O suíte marcava **1438 testes (4 falhando)** na árvore pré-reset de 26/08 e marca
**1357 (0 falhando)** hoje. Os 87 arquivos `*.test.ts` existem e o glob do `npm test`
alcança todos. Então os ~81 testes de diferença foram acrescentados **dentro de
arquivos existentes** em 26/08 de manhã. Vale identificar quais antes de dar a
recuperação por encerrada.

---

## 4. Plano

Cada fase é uma sessão curta, com commit em `staging` no fim. **Nada fica solto na
árvore entre fases** — foi exatamente isso que causou as duas perdas.

### Fase 0 — restaurar a memória do projeto  *(a mais barata, e agora a mais urgente)*

1. `git show 5ce7c20:docs/ACHADOS.md` e comparar com o atual. Os 3 achados de 25/08 são
   novos e ficam; os #1–#76 voltam.
2. Mesma coisa para `PROMPT-CONTINUACAO`, `PERGUNTAS-NEGOCIO`, `CONTINUACAO`,
   `DECISAO-CAMADA-M`, `DECISAO-GRAO-FIELD-AGENDA` — **fundindo**, nunca sobrescrevendo.
3. Reconciliar com [DECISOES-DAS-SESSOES.md](DECISOES-DAS-SESSOES.md) o que foi decidido
   entre 20/08 e 26/08 e não está em lugar nenhum do git.
4. **Critério de saída:** nenhum documento referencia um achado que não existe, e a
   `CONTINUACAO.md` deixa de estar datada de 14/08.

### Fase 1 — ✅ devolver a altura aos gráficos — FEITA em 27/08

1. ✅ `Grafico.tsx`: `altura="grafico"` nas duas chamadas, `largo` removido (estava inerte).
2. ✅ `SobDemanda` e `VisualPronto` recebem a altura do visual que os substitui
   (`alturaDoConteudo()`), então a tela não pula quando a resposta chega.
3. ✅ Medido antes/depois com playwright em **1366×768 e 1920×1080**, em 3 páginas —
   revertendo só os 4 arquivos para medir o antes. As outras duas resoluções do plano
   (1440×900 e 1706×1000) **não** foram medidas: as duas medidas cercam a faixa, e o
   `clamp` é contínuo entre elas.
4. ✅ **Critério de saída atingido:** `agendamento-field` 5.564 → **5.133px**,
   `visao-geral` 1.727 → **1.343px**, zero cartões maiores que a tela, zero `v-auto`,
   zero rolagem horizontal. A página **continua rolando** — 6,7 telas em
   `agendamento-field` —, e isso é a decisão registrada: são 15 cartões, entre eles 3
   matrizes no clamp delas. Rolagem contida pode; cartão maior que a tela não.
   **O que falta para a página caber é a Fase 2** (densidade), não altura de cartão.

### Fase 2 — refazer a densidade sobre a base de hoje

1. Ler `patch1..6.mjs` como especificação — a justificativa de cada número está nos
   comentários que eles inserem.
2. Reaplicar a régua (raiz 14px) e **recalibrar `--chrome` medindo**, não copiando:
   a soma de 26/08 (312px) valia para a `estilo.css` daquele dia.
3. Preservar `@layer base` e `--pbi-primary-texto`.
4. **Critério de saída:** `varre.mjs` limpo nas 9 páginas × 4 resoluções, claro e
   escuro, com o diálogo de filtro, as abas e o modal "Ampliar" funcionando.

### Fase 3 — fechar a discrepância dos testes

Extrair dos transcripts de 26/08 os blocos `test(...)` escritos naquela manhã e
conferir um a um contra os arquivos de hoje. Repor os que faltarem.

### Fase 4 — impedir a terceira perda

1. Commitar em `staging` ao fim de **cada** fase; validar; só então `main`.
2. `git reset --hard` e `checkout -f` só depois de `git stash -u` ou de um commit
   descartável — nunca sobre árvore suja.

---

## 5. Como esta auditoria foi feita

Scripts em
`%TEMP%/claude/c--Users-erick-azambuja-Desktop-DASHBOARD---Instala--o/dc2c82e3-.../scratchpad/`:

- `audita.mjs` → `auditoria.txt`: as 31 sessões (janela, falas, arquivos escritos) e a
  linha do tempo de todo arquivo tocado.
- `sobreviveu.mjs` → `sobreviveu.txt`: para cada edição, testa se o texto ainda está no
  disco, ignorando as que edições posteriores consumiram.

**Ressalva sobre `sobreviveu.txt`:** ele tem falso-positivo alto — acusou 200 edições
perdidas, e a checagem dirigida mostrou que a maioria está lá, só reformatada
(`aquecedor.ts` acusou "vivas=0" e está íntegro). Sirva-se dele como **lista de
suspeitos**, nunca como veredito. Os números do §2 e §3 são todos de verificação
dirigida, não dele.

E ele **não enxerga** edições feitas por script via Bash — foi assim que a passada de
densidade foi aplicada, e é por isso que a sessão `dc2c82e3` aparece com só 2 arquivos.
