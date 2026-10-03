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

## Fase 2 — estado do servidor no React Query

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

## Fase 3 — URL e divisão do `App.tsx` (866 linhas)

- Filtros, clicados e página atual passam para `searchParams` do `react-router`, no
  lugar de `leRota`/`escreveRota`/`popstate` feitos à mão. A regra atual continua: o
  clique empilha no histórico e os seletores substituem.
- A sessão (`logado`) vai para uma store Zustand de auth.
- `pages/dashboard/DashboardPage.tsx` fica fino. A barra de filtros, o cabeçalho e o
  corpo viram componentes; a lógica vira hooks.

## Fase 4 — componentes acima de 200 linhas

`Grafico` (627), `Tabela` (397), `Matriz` (298), `RankingBarra` (284),
`SegmentacaoDataHierarquia` (274) e `AppShell` (248).

## Fase 5 — qualidade

- ESLint (com `react-hooks`), Prettier, Husky e lint-staged. A formatação do Prettier
  entra num commit isolado, quando não houver outro trabalho aberto em `frontend`.
- Vitest e Testing Library para os testes do web (hoje são 11 em `node:test`). O
  `npm test` da raiz continua chamando todos.
- E2E com Playwright, aproveitando `backend/tools/tela`.

## Fase 6 — design system

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
