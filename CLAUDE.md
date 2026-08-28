# GUIDELINES PARA IA (CLAUDE / AGENTS) — ANALYTICS PLATFORM

Este repositório contém a **Plataforma Corporativa de Analytics da Sebratel**, uma
aplicação web nativa em **React 19 + Vite + Node.js (TypeScript)** que substitui o
relatório Power BI `INST - Relatório Instalação`.

> **É o de INSTALAÇÃO, não o "INSTALAÇÃO GERENCIAL".** São dois relatórios
> diferentes (Erick, 27/08/2026), e o repositório carrega os dois nomes: o
> `README.md` da extração em `../QUERIES-DASHBOARD-INSTALACAO/` diz que saiu do
> `INST - Relatório Instalação Gerencial`. Trocar um pelo outro não dá erro — dá
> gabarito de paridade errado. Ver `docs/SPEC-DRIVEN.md`, "Qual relatório é o
> original", e a seção do token abaixo.

> **Este arquivo não é versionado.** Ele já foi apagado uma vez, por outro agente, e
> não havia como recuperá-lo do git. Se você o alterar, vale a pena versioná-lo.

---

## 🎯 Arquitetura e contexto essencial

1. **Aplicação web nativa standalone**
   - **NÃO existem arquivos do Power BI (`.pbip`, `.pbix`)** no repositório.
   - O diretório `specs/` (`queries`, `tables`, `measures`, `dashboards`) é o
     **catálogo nativo de metadados** e a única fonte da verdade.

2. **Servidor e performance**
   - Os dados agregados são servidos de **snapshots colunares** em disco
     (`packages/snapshot/`).
   - A API responde a quente em sub-10ms com ~200MB de RAM.
   - Para materialização pesada (+1,4M linhas), use `--max-old-space-size=8192`
     (ou `--memoria=8192`).

3. **Stack**
   - **Frontend (`apps/web`)**: React 19, Vite, TypeScript, TailwindCSS, Zustand,
     TanStack React Query.
   - **API (`apps/api`)**: Node.js (`node:http`), somente-leitura, porta 3000/3100.
   - **Engines (`packages/`)**: `measure-engine` (DAX em TypeScript),
     `widget-engine` (cards, tabelas, gráficos, matrizes), `query-engine`
     (PostgreSQL `dbVoalle` e MariaDB `dbMaria`), `snapshot` (cache colunar).

---

## 🚀 Comandos principais

```bash
npm test                    # a suíte inteira, e ela tem de passar verde
npm run doctor              # diagnóstico de conexões e ambiente
npm run api                 # API standalone lendo os snapshots (porta 3000)
npm run web                 # Vite em 5173 com proxy para a API
npm start                   # build da tela + API, com pré-aquecimento

npm run snapshot -- --pagina=diario-instalacao --memoria=8192
npm run snapshot -- --todas --incremental --memoria=8192

npm run powerbi -- --pagina=diario-instalacao
npm run powerbi -- --pagina=diario-instalacao --paridade --refaz --grava
```

### ⚠️ A janela de dados é obrigatória ao comparar com o Power BI

O modelo publicado carrega **mais história** do que a plataforma materializa: em
25/08/2026, `PROTOCOLOS PRODUTIVIDADE` tinha 187.534 linhas lá e 70.868 aqui, porque o
SQL corta em `a.created >= '2026-01-01'`. Comparar sem equalizar produz divergências de
20%+ que **não são defeito** — são janelas diferentes.

`specs/_catalog/paridade-janela.yaml` declara o predicado DAX que reproduz a nossa
fatia, com a contagem que prova cada um, e lista as tabelas em que nenhum predicado
equaliza (aí o card é **recusado** em vez de receber palpite).

**Armadilha registrada:** o piso corta por `DATA CRIADO`, mas quase toda medida agrega
por `DATA INSTALAÇÃO`. Protocolo criado em 2025 e instalado em 2026 existe lá e não
aqui — 328 casos, concentrados na primeira semana de janeiro. Antes de chamar qualquer
diferença de "bug", verifique se a data do corte é a mesma da agregação.

---

## 🎨 Design System — bordô Sebratel

A fonte da verdade é [`apps/web/src/estilo.css`](apps/web/src/estilo.css) (blocos
`@theme` e `:root`), documentada em [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md).
**Se este arquivo divergir daquele, ele é que está velho.**

```css
:root {
  /* A marca desta tela */
  --pbi-primary: #880F17;        /* Bordô — cabeçalho de visual, navegação ativa */
  --pbi-primary-dark: #6b2328;   /* Hover, ponta escura do gradiente */
  --pbi-gold: #D9B300;           /* Dourado — o par do bordô; o traço que separa */
  --pbi-gold-light: #f0e199;     /* Subtítulo sobre a primária */

  /* Foreground POR PAPEL — é isto que sobrevive a uma troca de paleta */
  --pbi-sobre-primary: #FFFFFF;       /* Texto sobre a primária .......... 9,87:1 */
  --pbi-sobre-primary-fraco: #f0e199; /* Subtítulo sobre a primária ...... 7,49:1 */
  --pbi-primary-texto: #880F17;       /* A primária COMO LETRA ........... 9,87:1 */
  --pbi-gold-600: #856200;            /* O dourado COMO LETRA ............ 5,02:1 */
  --pbi-green-texto: #0B7A1E;         /* Verde COMO LETRA ................ 4,85:1 */
  --pbi-critico-texto: #b3261e;       /* Vermelho COMO LETRA ............. 5,63:1 */
}
```

* **A regra que mais custou caro: cor CHEIA é FUNDO, cor ESCURECIDA é LETRA.**
  Escrever a cor de marca direto num `color:` foi o que deixou cabeçalho de card, de
  tabela, de diálogo e a aba ativa ilegíveis quando a paleta trocou. Use o token do
  papel; nunca um hexadecimal solto.
* **Tema escuro**: `--pbi-primary-texto` vira o dourado — o bordô mede 1,57:1 sobre a
  superfície escura. A **superfície** bordô não muda: quem separa o cabeçalho do corpo
  é a borda dourada.
* **Antes de mudar qualquer cor, MEÇA.** Os números acima são contraste WCAG medido.
  Trocar uma primária clara por uma escura (ou o contrário) inverte o foreground de
  toda a interface.
* **Nenhum hexadecimal fora do bloco de paleta.** A única exceção documentada é
  `apps/web/src/grafico-forma.ts`: cor de série vai para atributo SVG, que não lê
  variável de CSS.
* **Skills de frontend**: use-as para estrutura de componentes, responsividade, grids
  e micro-animações — **sem** trazer a paleta do exemplo delas.

### Regras de tela que vieram de defeito real

* **Reset de elemento vai em `@layer base`.** As utilidades do Tailwind ficam em
  `@layer utilities`, e declaração fora de camada vence qualquer declaração dentro
  dela, independente de especificidade. Com o reset de `button` solto, todo `bg-*` /
  `text-*` aplicado a `<button>` era descartado em silêncio — era esse o bug de
  "clico na aba e ela não fica marcada".
* **Gráfico não rola: ele pagina.** A caixa do desenho é medida e o `<svg>` recebe
  exatamente a medida dela. Se as categorias não cabem com largura legível, mostra-se
  uma janela com paginador.
* **Rolagem contida pode; vazamento não.** Rolar dentro de um card é legítimo (é o
  trabalho de uma tabela larga). O que não pode é a **página** rolar na horizontal, ou
  um card ficar mais alto que a tela.
* **Paginador que não corta é pior que nenhum**: ele promete um custo que não paga.

---

## 🔁 Carga incremental e o token do Power BI

### A carga incremental está viva — e é ela que rebusca os relatos

`specs/_catalog/incremental.yaml` tem **uma** política: `protocolos-produtividade`.
As outras 21 queries não são incrementais, e isso não é falta — `--incremental`
simplesmente as busca inteiras.

Medido em 27/08/2026 rodando `decideIncremental` contra o cabeçalho real do
snapshot em disco:

```
cabeçalho real .......... linhas=70991  modo=completo  marca=2026-08-25T00:00:00Z
decisão hoje ............ { pode: true, desde: "2026-08-23" }
última carga completa ... 2026-08-25 19:34
--incremental recusa a partir de 2026-09-01 19:34   (idade_maxima_dias: 7)
```

**A janela dos relatos sai daí:** `desde = marca − margem_dias(2)`, com piso em
`2026-01-01`. Rodando todo dia, isso é uma janela de ~3 dias de relato. Hoje ela
abre em **23/08** e cobre 5 dias, porque a marca não avança há dois dias — a janela
é medida da MARCA, não do relógio.

**Os relatos entram por três ramos** no CTE `alvos` da costura, e cada um pega o que
os outros não pegam (medido em 25/08):

| ramo | o que cobre |
|---|---|
| 1. a própria solicitação mudou | 100% dos relatos — todo relato novo marca a solicitação-pai |
| 2. alocação de patrimônio | os 15,8% que o ramo 1 NÃO pega |
| 3. relato de técnico auxiliar (RAUX) | mora na solicitação FILHA; o ramo 1 nunca a alcançaria |

Ganho: **238 s → 67 s** ponta a ponta. Não mexa na costura sem reler as duas
armadilhas em `packages/snapshot/src/incremental.ts`.

> ⚠️ `packages/snapshot/src/incremental.ts` tem um **byte NUL** no byte 14460, dentro
> do literal que marca "campo nulo" na chave composta. Consequência prática: `grep`
> trata o arquivo como binário e **não acha nada dentro dele** — use `grep -a`.

### O token: qual relatório ele acessa

O token existe, em `~/.secrets/powerbi-token.json` (gravado em 25/08 17:25), por
device code — o login é do Erick, e o acesso é exatamente o dele.

**É o `INST - Relatório Instalação`. NÃO é o `INST - Relatório Instalação Gerencial`
— são dois relatórios** (Erick, 27/08/2026). Apontar para o errado não gera erro:
gera número plausível e diferente, que entra em `paridade-janela.yaml` como se fosse
gabarito.

**E o repositório não registra para onde ele aponta.** `POWERBI_URL`,
`POWERBI_REPORT_ID` e `POWERBI_TENANT_ID` são lidos do `.env`
(`tools/powerbi/src/index.ts:180-183`) e **não estão no `.env`** — só no
`.env.example`, vazios, desde 27/08. Enquanto ficarem vazios:

* `npm run powerbi` exige `--url=` a cada chamada;
* nenhum número de `pbi:` em `specs/_catalog/paridade-janela.yaml` diz de onde veio.

**Por que isso é suspeito e não burocracia.** As três tabelas em `bloqueadas` daquele
arquivo falham todas com a mesma cara — *"as duas tabelas têm definições diferentes"*,
*"formas incompatíveis"*, *"a base congelou"*. Consultar um relatório diferente do
nosso produz exatamente esse sintoma. Confirme o alvo antes de tratar qualquer uma
delas como defeito da plataforma.

A garantia de somente-leitura **não** está no escopo do token (ele pede `.default`,
que devolve escrita também): está em `assertSomenteEvaluate` em
`tools/powerbi/src/api.ts`, que recusa DAX que não comece por `EVALUATE`.

---

## 📂 Estrutura

```
apps/
  web/             -> Frontend React 19 + Vite
  api/             -> API HTTP somente-leitura (3000 / 3100)
packages/
  measure-engine/  -> Avaliador de medidas em TypeScript
  widget-engine/   -> Cards, gráficos, tabelas e matrizes
  query-engine/    -> PostgreSQL e MariaDB
  snapshot/        -> Snapshots colunares em disco
specs/             -> Catálogo nativo de metadados
docs/              -> Decisões, achados e paridade
```

---

## ⚠️ Regras invioláveis

1. **Nunca procurar ou exigir arquivos `.pbip`.** Toda a estrutura de metadados vive
   em `specs/`.
   *Ao investigar paridade, porém, a **extração** do relatório original (que não é um
   `.pbip`) está em `../QUERIES-DASHBOARD-INSTALACAO/` — `m/` traz os passos de Power
   Query, `sql/` o SQL e `dax/` as medidas. Consulte antes de testar hipóteses contra
   a API: os passos de M fazem o que o SQL não mostra (`Table.Combine` acrescenta
   linhas, `Table.ExpandTableColumn` multiplica).*
2. **Somente-leitura.** A API é estritamente `GET`/`HEAD`. Nunca modifique os bancos
   operacionais (`dbVoalle` / `dbMaria`).
3. **Respeitar os testes.** Nenhuma alteração deve quebrar a suíte (`npm test`).
4. **Fidelidade visual.** Manter os tokens em CSS (`var(--pbi-primary)`, `var(--fundo)`).
5. **Idioma.** Toda documentação, mensagem e log em **Português**.
6. **`snapshot/` contém dado de cliente** (CLIENTE, TELEFONE, endereços; QUADRO
   FUNCIONAL tem CPF/RG). Ferramenta de diagnóstico imprime id, contagem, nome de
   coluna e tempo — **nunca valor de linha**.
