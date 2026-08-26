import { useState, useEffect } from 'react';

const CHAVE_TEMA = 'sebratel-tema-escuro';

export function useThemeStore() {
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CHAVE_TEMA) === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_TEMA, isDark ? 'dark' : 'light');
      if (isDark) {
        document.documentElement.classList.add('tema-escuro');
      } else {
        document.documentElement.classList.remove('tema-escuro');
      }
    } catch {}
  }, [isDark]);

  const toggleTheme = () => setIsDark((prev) => !prev);

  return { isDark, toggleTheme };
}
