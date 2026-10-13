// O ESCOPO DE DADO de quem pede — o que a chave do cache precisa saber sobre a
// identidade, e nada além disso.
//
// **O defeito que este arquivo conserta (ACHADOS #102).** Até 06/09/2026 a chave
// carregava o `usuario` cru. Enquanto todo mundo era `local` isso não separava
// nada; desde o login (01/09) ele carrega o e-mail de verdade — e o aquecedor, que
// se identifica como `aquecedor-interno` (`servidor.ts`), passou a encher uma
// partição que **nenhuma pessoa lê**. Medido no compose em 06/09: 35 chaves
// `resp:*` sob `aquecedor-interno`, nenhuma sob e-mail de gente, e a primeira
// abertura de `visao-geral` custando 6.134 ms de cálculo com o `/api/saude`
// dizendo `aquecimento: pronto`. Cada pessoa pagava a primeira abertura de cada
// página, por dia e por carimbo.
//
// **Por que não basta tirar a identidade da chave.** O campo existe para que, no
// dia do recorte por linha, a página do gestor A não vá para o gestor B — cache
// virando vazamento é o modo de falha mais caro de `cache-resposta.ts`. Então o
// campo fica. O que muda é o **valor**: não "quem pediu", e sim "que linhas essa
// pessoa pode ver". Duas identidades que enxergam exatamente as mesmas linhas
// podem — e devem — dividir a mesma entrada.
//
// **Hoje o escopo é constante, e isso é uma afirmação sobre o modelo, não um
// atalho.** `backend/specs/_catalog/permissoes.yaml` decide QUAIS abas cada conta
// abre (`permissoes.ts`, barrado antes do cache), mas traz `linhas: {}` vazio: dentro
// de uma aba, todo mundo que a abre vê as mesmas linhas. No dia em que essa afirmação deixar de valer,
// quem avisa é `backend/api/test/escopo-cache.test.ts` — ele lê o YAML, não a
// intenção de quem o editou.

import type { Identidade } from './identidade.ts';

/**
 * O escopo único de hoje: todo mundo vê todas as linhas.
 *
 * O nome entra na chave (`resp:v1:todos:...`), então mudá-lo invalida o cache
 * inteiro de uma vez — o que é o comportamento certo se o significado mudar.
 */
export const ESCOPO_TODOS = 'todos';

/**
 * O escopo de dado de uma identidade.
 *
 * A identidade entra como parâmetro **e é ignorada** — de propósito, e é a linha
 * que este arquivo inteiro justifica. Quando `permissoes.yaml` ganhar recorte por
 * linha, é aqui que ele entra, e a assinatura já está no lugar: nenhum chamador
 * muda.
 */
export function escopoDoCache(_identidade: Identidade): string {
  return ESCOPO_TODOS;
}
