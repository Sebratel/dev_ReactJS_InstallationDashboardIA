// O tema claro/escuro — e a classe que o liga.
//
// **A CLASSE É `dark`, EM INGLÊS, E ISSO NÃO É DESCUIDO.** Ela é o contrato do
// Tailwind: o `@custom-variant dark (&:where(.dark, .dark *))` do `estilo.css`
// resolve as utilidades `dark:` do `VisualGridSection.tsx`, e o
// bloco de tokens `.dark` troca a paleta inteira. Só este arquivo escreve a classe;
// o resto do código nunca a cita.
//
// Aqui estava escrito `tema-escuro`, e o resultado era pior que tema quebrado:
//   - nenhuma regra de CSS respondia, então a página ficava CLARA;
//   - mas `Grafico.tsx` lê `isDark` e repinta as séries com `corNoTema`, que troca
//     bordô e tinta por bordô CLARO e quase-branco.
// Ou seja, quem tivesse `dark` no localStorage via um dashboard claro com as séries
// pintadas para fundo escuro — o mesmo desaparecimento de série que o `NO_ESCURO`
// existe para impedir, agora causado por ele. Falha silenciosa: nenhum erro, nenhum
// teste, só o gráfico mostrando menos do que diz mostrar.

import { useState, useEffect } from 'react';

const CHAVE_TEMA = 'sebratel-tema-escuro';
/** O nome vem do Tailwind, não da nossa convenção de idioma. Ver o cabeçalho. */
const CLASSE = 'dark';

export function useThemeStore() {
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CHAVE_TEMA) === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle(CLASSE, isDark);
    try {
      localStorage.setItem(CHAVE_TEMA, isDark ? 'dark' : 'light');
    } catch {
      // localStorage indisponível (janela privada): o tema ainda vale nesta sessão.
      // A classe já foi aplicada acima, FORA do try — era o contrário, e um
      // localStorage bloqueado deixava a tela sem tema nenhum.
    }
  }, [isDark]);

  const toggleTheme = () => setIsDark((prev) => !prev);

  return { isDark, toggleTheme };
}
