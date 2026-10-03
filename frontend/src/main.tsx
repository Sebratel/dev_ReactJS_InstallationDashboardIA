import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ProvedorModo } from './context/ModoContext.tsx';
import { applyInitialTheme } from './utils/theme.ts';
import './estilo.css';

// Antes do primeiro render: com a classe aplicada só num efeito, quem usa o escuro via
// um quadro claro a cada carga.
applyInitialTheme();

const raiz = document.getElementById('raiz');
// Erra alto: uma raiz que não existe daria uma tela branca sem nada no console.
if (!raiz) throw new Error("index.html precisa de um elemento com id='raiz'.");

createRoot(raiz).render(
  <StrictMode>
    <ProvedorModo>
      <App />
    </ProvedorModo>
  </StrictMode>,
);
