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
import tailwind from '@tailwindcss/vite';

/** A API de leitura. `PORT` do `npm run api` manda aqui também. */
const API = `http://localhost:${process.env.PORT_API ?? '3100'}`;

export default defineConfig({
  // O PLUGIN DO TAILWIND NÃO É OPCIONAL, e a falta dele falha em silêncio.
  //
  // O `estilo.css` abre com `@import "tailwindcss"`. Sem este plugin, o Vite
  // resolve esse import como CSS comum e o `@tailwind utilities;` de dentro dele
  // vai INTEIRO para o pacote, como texto — o navegador ignora, e toda classe do
  // Tailwind na aplicação deixa de existir. Nada quebra, nada avisa: só o layout
  // desmonta.
  //
  // Foi o que se viu em 27/08/2026: `div.flex min-h-screen` computava
  // `display: block`, a barra lateral empilhava ACIMA do conteúdo em vez de ficar
  // ao lado, e a área de visuais começava em `top: 1052` — fora da tela. As cores
  // continuavam certas, porque vivem em `:root` como CSS puro; só o que dependia
  // de utilitário sumiu.
  plugins: [react(), tailwind()],
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
