import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './services/queryClient.ts';
import { App } from './App.tsx';
import { ProvedorModo } from './context/ModoContext.tsx';
import { applyInitialTheme } from './utils/theme.ts';
// A fonte vem junto com a tela, e não do Google Fonts. O `@import` do Google em
// `estilo.css` bloqueava o CSS — e, atrás dele, o JS e os pedidos de dados — até
// buscar dois arquivos na internet: ~420–520 ms dos ~900 ms da entrada da
// `agendamento-field` (medido em 05/10/2026, `PLANO-CARREGAMENTO.md` etapa 1). Os
// mesmos pesos de antes (400–800); o pacote já declara `font-display: swap`.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import './estilo.css';

// Antes do primeiro render: com a classe aplicada só num efeito, quem usa o escuro via
// um quadro claro a cada carga.
applyInitialTheme();

const raiz = document.getElementById('raiz');
// Erra alto: uma raiz que não existe daria uma tela branca sem nada no console.
if (!raiz) throw new Error("index.html precisa de um elemento com id='raiz'.");

createRoot(raiz).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ProvedorModo>
        <App />
      </ProvedorModo>
    </QueryClientProvider>
  </StrictMode>,
);
