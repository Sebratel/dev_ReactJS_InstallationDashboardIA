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
//
// **`applyInitialTheme()` roda no `main.tsx` ANTES do render.** Quando a classe só era
// aplicada num `useEffect`, quem usa o escuro via um quadro claro a cada carga.

export type ThemeMode = 'light' | 'dark';

/** A chave de antes da adequação ao padrão — trocar o nome apagaria a escolha de
 *  quem já usa o escuro. */
const CHAVE_TEMA = 'sebratel-tema-escuro';
/** O nome vem do Tailwind, não da nossa convenção de idioma. Ver o cabeçalho. */
const CLASSE = 'dark';

/** Preferência efetiva: a escolha salva ou, na falta dela, a do sistema. */
export function getPreferredTheme(): ThemeMode {
  try {
    const salvo = localStorage.getItem(CHAVE_TEMA);
    if (salvo === 'light' || salvo === 'dark') return salvo;
  } catch {
    // localStorage indisponível (janela privada): cai na preferência do sistema.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyInitialTheme(): ThemeMode {
  const modo = getPreferredTheme();
  document.documentElement.classList.toggle(CLASSE, modo === 'dark');
  return modo;
}

export function setTheme(modo: ThemeMode): void {
  // A classe vai FORA do try — era o contrário, e um localStorage bloqueado deixava a
  // tela sem tema nenhum.
  document.documentElement.classList.toggle(CLASSE, modo === 'dark');
  try {
    localStorage.setItem(CHAVE_TEMA, modo);
  } catch {
    // localStorage indisponível: o tema ainda vale nesta sessão.
  }
}
