// Estado global do tema. A persistência e a classe no `<html>` são de `utils/theme.ts`;
// aqui só mora o valor que os componentes leem (`Grafico.tsx` repinta as séries com
// ele) e a ação que o troca.
//
// Era um `useState` dentro de um hook comum: cada componente que chamava
// `useThemeStore()` tinha a SUA cópia do tema, e só o `AppShell` via a troca — os
// gráficos seguiam pintados para o tema anterior até remontar.

import { create } from 'zustand';
import { getPreferredTheme, setTheme } from '../utils/theme.ts';

type ThemeState = {
  isDark: boolean;
  toggleTheme: () => void;
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  isDark: getPreferredTheme() === 'dark',
  toggleTheme: () => {
    const isDark = !get().isDark;
    setTheme(isDark ? 'dark' : 'light');
    set({ isDark });
  },
}));
