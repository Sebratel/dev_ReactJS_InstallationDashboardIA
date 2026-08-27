# Recuperação — auditoria de 27/08/2026

> Levantamento feito lendo **as 31 sessões do Claude Code deste projeto**
> (`~/.claude/projects/c--Users-erick-azambuja-Desktop-DASHBOARD---Instala--o/*.jsonl`,
> 04/08 a 27/08) e cruzando cada arquivo escrito com o que está hoje no disco e no git.
>
> Conclusão em uma frase: **nada é irrecuperável**, o repositório está íntegro e
> publicado, e o que falta é **uma coisa só de verdade** — o sistema de alturas do
> front-end nunca chega aos gráficos.

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

### 3.1 O defeito de verdade — o sistema de alturas não alcança os gráficos

`Cartao.tsx` faz `props.altura ?? 'auto'`, e `v-auto` é `height: auto`. Quem **não**
passa `altura` cai fora de `--util`, dos `clamp` e da regra "duas faixas = uma tela":

| chamador | passa `altura`? |
|---|---|
| `Matriz.tsx:155` | sim (`"matriz"`) — e o comentário da linha 143 avisa da armadilha |
| `Tabela.tsx:224` | sim (`"tabela"`) |
| **`Grafico.tsx:306` e `:313`** | **não** |
| `SobDemanda.tsx:48,60`, `VisualPronto.tsx:24` | não (estados de carga/erro) |

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

### Fase 1 — devolver a altura aos gráficos  *(a de maior efeito visual)*

1. `Grafico.tsx:306,313`: passar `altura="grafico"` e remover `largo`.
2. Decidir o que fazer com `SobDemanda` e `VisualPronto` — hoje um cartão "carregando"
   tem altura diferente do gráfico que vai substituí-lo, e a tela pula.
3. Medir antes/depois com o `medir.mjs` do scratchpad, em 1366×768, 1440×900,
   1706×1000 (o viewport real: 2560×1600 a 150%) e 1920×1080.
4. **Critério de saída:** a página deixa de ter 8.460px e passa a caber, ou a rolar
   por decisão registrada; nenhuma rolagem horizontal.

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
