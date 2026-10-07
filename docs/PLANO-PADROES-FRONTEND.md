# Adequação do `frontend` aos padrões de frontend da Sebratel

Referência: skill `padroes-frontend` (documento oficial "Padrões de Desenvolvimento
Front-End", 2026). A paleta continua a bordô `#880F17` de `estilo.css`, e não a do
boilerplate `nexaview-web`.

Uma fase por sessão, cada uma com commit próprio. Cada fase termina com `npm test`,
`npm run typecheck` e `npm run web:build` verdes, e com a tela aberta no navegador.

## Fase 1 — fundação (FEITA, branch `feature/padroes-frontend`)

- Estrutura de pastas oficial: `components/{ui,layout,visuais,filtros,auth,capa}`,
  `services/`, `hooks/`, `utils/`, `context/` e `store/`. As pastas `componentes/` e
  `atomic/` deixaram de existir. Os arquivos foram movidos com `git mv`, então o
  histórico se mantém.
- Nomenclatura: util e service em camelCase (`cachePagina.ts`, `dashboardService.ts`),
  hook com prefixo `use` (`usaModo` passou a `useModo`, `usaJanela` a `useJanela` etc.).
  O prefixo `use` é o que as regras de hooks do ESLint (fase 5) reconhecem.
- Rede só em `services/`: `dashboardService.ts` (o antigo `api.ts`), `authService.ts`
  (as três trocas de credencial por sessão e o logout, que antes eram `fetch` dentro
  de `Login.tsx`), `eventosService.ts` (o SSE, que antes era um `EventSource` dentro de
  `App.tsx`), `googleIdentity.ts` e `firebaseAuth.ts`.
- `config.ts` é o único arquivo que lê `import.meta.env`.
- Tema: `utils/theme.ts` aplica o tema antes do render (`main.tsx`) e, quando não há
  escolha salva, segue `prefers-color-scheme`. O estado passou para uma store Zustand
  (`store/themeStore.ts`).
  - **Defeito corrigido:** `useThemeStore` era um `useState` por chamada. Cada gráfico
    tinha a sua cópia do tema, e trocar o tema não repintava as séries até o componente
    remontar.
  - A chave do localStorage continua `sebratel-tema-escuro`, para quem já escolheu o
    escuro não perder a escolha.
- `utils/cn.ts` (clsx + tailwind-merge). Por enquanto só `Cartao` e `AppShell` usam.
- Dependências novas: `zustand`, `clsx`, `tailwind-merge`.

## Fase 2 — estado do servidor no React Query (FEITA, `ac55c74`, 05/10/2026)

**Como ficou** (ACHADOS #178): as chaves são `['pagina', id, url]` e não `['pagina', url]`,
para o aviso do servidor invalidar toda combinação da página de uma vez; os visuais abaixo da
dobra e os valores de segmentação também entraram (`['valores', id, …]`), e o
`VersaoDosDadosContext` e o `utils/cachePagina.ts` saíram. Medido: entrada 326–528 ms (antes
518–547), troca/volta mais rápidas e 14–24 pedidos em vez de 26–29, sem "carregando" novo. **O
zod não entrou** — fica para quando houver resposta de serviço a validar de verdade.

O plano original:

Substituir os caches manuais de `App.tsx` (`layoutsVistos`, `paginasVistas`,
`emVooHoverBarra`, o `useState` da saúde):

- query keys centralizadas em `dashboardService`: `['dashboards']`, `['layout', id]`,
  `['pagina', url]`, `['saude']`;
- os prefetches (aba sob o cursor, barra sob o cursor, páginas de fundo) passam a usar
  `queryClient.prefetchQuery`;
- o SSE e o auto-refresh passam a chamar `invalidateQueries`;
- `placeholderData` mantém a página anterior na tela enquanto a nova é recalculada.

**Restrição:** nada de "carregando…" a mais ao entrar ([[feedback-tudo-pre-carregado]]).
Medir antes e depois o número de pedidos e o tempo até a página ficar pronta.

## Fase 3 — URL e divisão do `App.tsx` (FEITA, `0ac2923`, 05/10/2026)

**Como ficou** (ACHADOS #180):
- O estado da tela (página, filtros, clicados) **é** a URL, lida pelo `react-router`
  (`hooks/useEstadoDaTela.ts`). Saíram o `pushState`/`replaceState`, o ouvinte de `popstate` e
  o `useRef` que dizia de onde vinha cada mudança. A regra continua: o clique cruzado empilha,
  seletor e aba substituem. As ações leem a URL na hora, não o estado do último render.
- Marcador novo **`limpo=1`**: URL sem `filtro` continua sendo o padrão da página (todo link
  antigo), e quem limpa fica limpo. Antes, voltar no histórico para um estado padrão caía em
  "sem filtro".
- A sessão já estava numa store Zustand desde a fase 2 (`store/sessaoStore.ts`).
- `App.tsx` (660 linhas) virou o portão de login e a rota (34). A página é
  `pages/dashboard/DashboardPage.tsx` (183); a lógica, `useEstadoDaTela`, `useTempoReal` e
  `usePreCargas`; a barra, `components/filtros/BarraDeFiltros.tsx`; o recorte das
  segmentações, `utils/segmentacoesDaTela.ts` (a vizinhança usa o mesmo).
- Custo: o bundle cresceu 38 kB (12 kB com gzip), o `react-router`.

O plano original:

- Filtros, clicados e página atual passam para `searchParams` do `react-router`, no
  lugar de `leRota`/`escreveRota`/`popstate` feitos à mão. A regra atual continua: o
  clique empilha no histórico e os seletores substituem.
- A sessão (`logado`) vai para uma store Zustand de auth.
- `pages/dashboard/DashboardPage.tsx` fica fino. A barra de filtros, o cabeçalho e o
  corpo viram componentes; a lógica vira hooks.

## Fase 4 — componentes acima de 200 linhas (FEITA, `edb8308`, 05/10/2026)

**Como ficou** (ACHADOS #181): `Grafico` (627), `Tabela` (397), `Matriz` (298),
`RankingBarra` (284), `SegmentacaoDataHierarquia` (264), `AppShell` (249) e `Capa` (243)
divididos; o maior componente agora tem 197 linhas.
- Peças únicas no lugar de cópias: `ui/PaginadorDeJanela` (gráfico, ranking e matriz),
  `hooks/useCliqueNoEixo` (gráfico e ranking), `utils/csv` (tabela e matriz),
  `ui/MarcaSebratel` (topo e capa).
- Partes: `visuais/grafico/` (desenho, colunas, eixo X, linhas, faceta, legenda, zoom,
  geometria), `visuais/ranking/LinhaDoRanking`, `visuais/tabela/CorpoDaTabela`,
  `filtros/ArvoreDeDatas` e `NoDaArvore`, `layout/NavDeTelas` e `AcoesDoCabecalho`,
  `capa/HistoricoDeVersoes`, `hooks/useOrdemDaTabela`.
- Contas puras em `utils/` com teste: `graficoEixo`, `tabelaDados`, `matrizDados`,
  `capaConteudo`.
- Corrigido de passagem: `Tabela` e `Matriz` chamavam hooks depois do `return` de "sem dados".
- Prova visual: a mesma tela pixel a pixel e HTML a HTML (ver o achado).

O plano original:

`Grafico` (627), `Tabela` (397), `Matriz` (298), `RankingBarra` (284),
`SegmentacaoDataHierarquia` (274) e `AppShell` (248).

## Fase 5 — qualidade (FEITA, `5daf037`…`fa6dbb5`, 06/10/2026)

**Como ficou** (ACHADOS #182):
- `npm run lint` (ESLint com `react-hooks`), `npm run format` (Prettier, commit isolado
  `6ae3a3a` no `.git-blame-ignore-revs`), pre-commit com Husky e lint-staged no frontend.
- `npm test` roda o backend em `node:test` e o frontend em Vitest (`npm run test:web` só o
  frontend); os primeiros testes de componente com Testing Library.
- `npm run e2e`: 8 testes de navegação com Playwright contra a stack no ar (uma execução por
  minuto, pelo rate limit).
- Contorno: o ESLint aponta o `ts-api-utils` para o TypeScript do frontend (a raiz está no 7).
- Pendência: `useJanela` para o React Query (a única exceção do ESLint).
- Achado de passagem: o prefetch ganhou balde próprio no rate limit de `/api` (`fc42c96`).

O plano original:

- ESLint (com `react-hooks`), Prettier, Husky e lint-staged. A formatação do Prettier
  entra num commit isolado, quando não houver outro trabalho aberto em `frontend`.
- Vitest e Testing Library para os testes do web (hoje são 11 em `node:test`). O
  `npm test` da raiz continua chamando todos.
- E2E com Playwright, aproveitando `backend/tools/tela`.

## Fase 6 — design system (EM ANDAMENTO: 6a, 6b e 6c feitas, 06/10/2026)

**Escopo decidido com o Erick: híbrido** (ACHADOS #183). Peças simples e repetidas viram
utilitário com token e `cn`; a conta de altura, a grade, os SVG, as animações e o layout
medido ficam em CSS. Prova de cada passo: régua de estilo computado (HAR, 14 páginas,
claro/escuro, 1366/1920/1024/390, `:hover` forçado), sem diferença além do ruído medido.
- 6a (`c47ef83`): `@theme inline` sobre os papéis do `:root` — uma fonte só.
- 6b (`dee94c9`): `ui/Selo`, `ui/Botao`, `Erro`/`Aviso`; ferramentas em `[data-selo]`.
- 6c (`73779c3`): cabeçalho do `Cartao`, `ui/IdVisual`, `visuais/kpi/partes` (KPI,
  sparkline, bullet, calendário); `varre` em `[data-visual]`. A régua pegou a `.grid` do
  CSS sequestrando o utilitário `grid` (ACHADOS #184).
- A régua virou ferramenta: `npm run tela:regua -- grava|mede|compara` (`8044190`).
- Próximos: estados (vazio, esqueleto, sob demanda); casca (topo, abas, botões de
  ícone); barra de filtros, chips e diálogo; capa.

O plano original:

Levar os ~1250 linhas de classes semânticas de `estilo.css` para tokens no `@theme` do
Tailwind e utilitários com `cn`, mantendo os tokens de papel (cor cheia é fundo, cor
escurecida é letra). A validação é por screenshot, claro e escuro, nas três resoluções
de referência.

## Desvios mantidos de propósito

- **`fetch`, não axios.** O padrão dispensa a migração de projeto que já usa fetch.
  `pega()` tem teto, novas tentativas e abort cobertos por teste. Trocar só se o Erick
  pedir.
- **`VisualErrorBoundary` é class component.** O React não tem error boundary em hook,
  e o `console.error` dele é o registro do erro capturado.
- **`estilo.css` mantém o nome.** `CLAUDE.md` e `casca.test.ts` o citam como fonte da
  verdade da paleta.
- **Formulários.** A tela não tem formulário com campo: o login é só botão. Por isso
  react-hook-form fica para quando houver um. O zod entra na fase 2, para validar
  respostas em `services/`.
