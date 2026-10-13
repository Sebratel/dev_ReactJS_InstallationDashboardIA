import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { queryClient } from './services/queryClient.ts';
import { App } from './App.tsx';
import { ProvedorModo } from './context/ModoContext.tsx';
import { applyInitialTheme } from './utils/theme.ts';
// A fonte é a do sistema (Segoe UI), como no COM · Gestão Comercial: nada a baixar
// antes do primeiro quadro. A Inter (`@fontsource/inter`) saiu em 13/10/2026.
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
      {/* O estado da tela (página, filtros, clicados) é a URL — ver `useEstadoDaTela`. */}
      <BrowserRouter>
        <ProvedorModo>
          <App />
        </ProvedorModo>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
