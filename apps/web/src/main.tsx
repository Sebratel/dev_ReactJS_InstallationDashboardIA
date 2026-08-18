import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './estilo.css';

const raiz = document.getElementById('raiz');
// Erra alto: uma raiz que não existe daria uma tela branca sem nada no console.
if (!raiz) throw new Error("index.html precisa de um elemento com id='raiz'.");

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
