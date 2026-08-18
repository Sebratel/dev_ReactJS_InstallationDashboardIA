// Vite — o passo de build que este repositório não tinha.
//
// **Metade de uma espera terminou; a outra metade continua.** O `CONTINUACAO.md` §6
// dizia "não migre para Fastify/React/Vite ainda". A parte do **React/Vite** caiu em
// 11/08/2026: a tela de uma página só não dava para validar o relatório contra o
// Power BI, que é o passo que trava o projeto. A parte do **Fastify** continua de pé —
// a API segue em `node:http`, e a condição de revisão dela (Permission Engine, corpo
// de requisição, WebSocket) não foi atingida. Ver `docs/DECISAO-TELA.md`.
//
// O `proxy` é o que mantém a regra de somente-leitura visível: em desenvolvimento o
// navegador fala com o Vite, e todo `/api` vai para a API de leitura sem passar por
// nenhum servidor que escreva.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** A API de leitura. `PORT` do `npm run api` manda aqui também. */
const API = `http://localhost:${process.env.PORT_API ?? '3100'}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // `api.ts` importa o codec de filtro de `packages/widget-engine`, que está fora
    // da raiz deste app. Sem isto o dev server recusa servir o arquivo — e a
    // alternativa, copiar o codec para cá, é a duplicação que `api.ts` explica evitar.
    fs: { allow: ['..', '../..'] },
    proxy: {
      '/api': {
        target: API,
        changeOrigin: true,
      },
    },
  },
  build: {
    // A API serve `apps/api/web/` como estático. O build cai aqui dentro para que
    // `npm run api` sozinho sirva a tela React em produção — um processo, uma porta.
    outDir: '../api/web/dist',
    emptyOutDir: true,
  },
});
