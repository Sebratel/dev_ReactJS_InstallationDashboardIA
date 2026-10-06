// Vitest do frontend — fase 5 de `docs/PLANO-PADROES-FRONTEND.md`.
//
// Separado do `vite.config.ts` de propósito: aquele lê o `.env` da raiz e monta o proxy
// da API, e teste nenhum precisa disso. O ambiente padrão é o Node (as contas puras); o
// teste de componente pede o DOM no próprio arquivo, com `// @vitest-environment jsdom`.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
