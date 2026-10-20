// A tela: o portão de login e a rota única do dashboard.
//
// Até a fase 2 este arquivo era a tela inteira (~660 linhas: estado da URL, dados,
// tempo real, pré-carregamentos e a barra de filtros). Na fase 3
// (`docs/PLANO-PADROES-FRONTEND.md`) a página foi para `pages/dashboard/DashboardPage.tsx`
// e a lógica para hooks; aqui fica só o que decide QUAL tela aparece.

import { useEffect } from 'react';
import { Route, Routes } from 'react-router';
import { useSessaoStore } from './store/sessaoStore.ts';
import { Login } from './components/auth/Login.tsx';
import { DashboardPage } from './pages/dashboard/DashboardPage.tsx';
import { guardaDestino, retiraDestino } from './utils/destinoDoLogin.ts';

export function App() {
  // Otimista: assume logado até o primeiro 401 de verdade, em QUALQUER consulta — quem
  // fica sabendo é o `QueryCache` (`services/queryClient.ts`).
  const logado = useSessaoStore((s) => s.logado);

  // O login não mostra `?pagina=` na barra: o destino espera guardado e volta depois
  // de logar (`utils/destinoDoLogin.ts`).
  useEffect(() => {
    if (!logado) guardaDestino();
  }, [logado]);

  // Sem sessão válida, a tela inteira vira o login — nenhum outro estado (esqueleto,
  // erro, dashboard) faz sentido enquanto isso for verdade, e recarregar depois de
  // logar é de propósito: mais simples e mais confiável do que tentar reencaixar cada
  // efeito que já falhou.
  if (!logado) {
    return <Login aoLogar={() => window.location.replace(retiraDestino())} />;
  }

  // Uma rota só, e o `*` é de propósito: onde o servidor entrega a tela num caminho
  // (`/visao-geral` no Vite; o estático da API responde 404 nele, e sempre respondeu),
  // `leRota` lê a página do caminho, e a navegação seguinte volta para `/` com a página
  // no parâmetro (`useEstadoDaTela`).
  return (
    <Routes>
      <Route path="*" element={<DashboardPage />} />
    </Routes>
  );
}
