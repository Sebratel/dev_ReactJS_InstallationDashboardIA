// Rótulos de visual.
//
// Aqui morava também `sigla()`, que espremia o nome da página em duas letras para
// caber no ícone da barra lateral FECHADA (62px). Essa barra não existe mais — a
// navegação é a faixa de topo, com o rótulo inteiro visível — e a função ficou sem
// chamador, mas COM quatro testes passando. É a pior forma de código morto: a suíte
// dizia que estava coberto, e o comentário dos testes descrevia uma tela que ninguém
// pode mais abrir. Removida junto com `apps/web/test/rotulos.test.ts`.

/** Título humano para visuais calculados */
export function tituloDoVisual(visual: { spec?: { name?: string; id?: string }; id?: string; titulo?: string }): string {
  if (visual.titulo) return visual.titulo;
  if (visual.spec?.name) return visual.spec.name;
  if (visual.spec?.id) return visual.spec.id;
  if (visual.id) return visual.id;
  return 'Visual';
}
