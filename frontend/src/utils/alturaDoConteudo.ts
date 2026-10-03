// A classe de altura que um visual tem, a partir só do `conteudo` — sem JSX, para
// `backend/tools/layout/src/extrai.ts` (um script Node puro) poder importar a MESMA função que
// `Cartao.tsx` usa, em vez de reimplementá-la num segundo lugar. `node
// --experimental-strip-types` (como `backend/tools/*` roda) apaga tipos mas não transforma JSX,
// então esta lógica não pode morar num `.tsx` se algo fora do bundle do front precisa
// dela — ver docs/PLANO-LAYOUT-V1.md §1 (Fase L1).

import type { VisualCalculado } from '../services/dashboardService.ts';

/** As faixas do padrão. `grafico` + `tabela` somam exatamente uma tela. */
export type AlturaDeVisual = 'grafico' | 'tabela' | 'meia' | 'matriz' | 'auto';

/**
 * A altura que um visual VAI ter quando terminar de carregar.
 *
 * O cartao de "carregando" e o de "nao calculou" precisam da **mesma** altura do
 * visual que os substitui. Sem isso a tela pula quando a resposta chega — e pula uma
 * vez por visual sob demanda, que e justamente o caso em que a espera e longa e a
 * pessoa esta olhando. `card` fica em `auto` de proposito: KPI tem altura propria.
 */
export function alturaDoConteudo(conteudo: VisualCalculado['conteudo']): AlturaDeVisual {
  switch (conteudo) {
    case 'grafico':
      return 'grafico';
    case 'tabela':
      return 'tabela';
    case 'matriz':
      return 'matriz';
    default:
      return 'auto';
  }
}
