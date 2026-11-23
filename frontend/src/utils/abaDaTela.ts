// Que ABA está aberta, e o que isso implica para a tela.
//
// Antes isto vivia como uma cascata de ternários aninhados dentro da `DashboardPage`
// (`naGestao ? … : nasMetas || nosInsights ? … : …`), repetida três vezes — uma para
// saber se a aba está liberada, outra para o título, outra para escolher o conteúdo.
// A cascata sozinha respondia por boa parte da complexidade cognitiva 63 que o SonarJS
// acusava no componente, e cada aba nova pedia um ternário a mais em cada uma das três.
//
// Aqui cada pergunta vira uma função pura, testável sem React: a aba se classifica uma
// vez (`classificaAba`) e o resto lê a classificação.

/** A aba CONFIGURAÇÕES. O id na URL continua `permissoes`: link e favorito antigos
 *  seguem abrindo a mesma tela. Não é tela do relatório — não tem layout, filtro nem
 *  snapshot, e só admin/dev a recebe na faixa. */
export const ABA_PERMISSOES = 'permissoes';

/** A aba METAS (12/11/2026). Também não é tela do relatório — edita o número que a
 *  medida `# META` lê. Quem a recebe vem do servidor (`eu.abasExtras`). */
export const ABA_METAS = 'metas';

/** As abas de INSIGHTS (18/11/2026): leem o Voalle ao vivo e mostram modelo. Chegam
 *  pelo `eu.abasExtras` como a Metas, e carregam sob demanda — o recharts e o leaflet
 *  só baixam para quem abre uma delas. */
export const ABA_OPERACAO = 'insights-operacao';
export const ABA_PREVISOES = 'insights-previsoes';

/**
 * O que a aba aberta É, do ponto de vista da tela:
 *
 * - `relatorio` — uma página do relatório: tem layout, filtros e dado de snapshot.
 * - `permissoes`, `metas`, `insights` — abas fora do relatório: nenhuma busca dado de
 *   página, e para todas elas layout, abertura, tempo real e pré-carga ficam parados.
 * - `nenhuma` — a URL ainda não trouxe aba e a lista não chegou para escolher a padrão.
 */
export type EspecieDeAba = 'relatorio' | 'permissoes' | 'metas' | 'insights' | 'nenhuma';

/** A espécie da aba aberta. Uma pergunta só, em vez de quatro booleanos soltos. */
export function classificaAba(abaAberta: string | null): EspecieDeAba {
  if (abaAberta === null) return 'nenhuma';
  if (abaAberta === ABA_PERMISSOES) return 'permissoes';
  if (abaAberta === ABA_METAS) return 'metas';
  if (abaAberta === ABA_OPERACAO || abaAberta === ABA_PREVISOES) return 'insights';
  return 'relatorio';
}

/** Abas de fora do relatório não têm dado de página para buscar. É um predicado de tipo
 *  para que o `else` de quem pergunta já saiba que sobraram só as três abas extras. */
export function ehAbaDoRelatorio(
  especie: EspecieDeAba,
): especie is Extract<EspecieDeAba, 'relatorio' | 'nenhuma'> {
  return especie === 'relatorio' || especie === 'nenhuma';
}

/** Uma aba identificada na faixa de navegação — tanto as do relatório quanto as extras. */
interface AbaNaFaixa {
  id: string;
}

/**
 * A aba aberta está liberada para esta conta?
 *
 * `null` enquanto a lista de páginas não chegou: até lá, uma aba vinda da URL pode ser
 * uma que a conta não abre, e a tela não tem como saber. A lista já vem só com as abas
 * desta conta (`permissoes.ts`, filtrado no servidor); a PERMISSÕES não está nela e vale
 * para quem pode gerir.
 */
export function abaLiberada(
  especie: EspecieDeAba,
  opcoes: {
    listaDePaginasChegou: boolean;
    podeGerir: boolean;
    paginasDoRelatorio: readonly AbaNaFaixa[];
    abasExtras: readonly AbaNaFaixa[];
    abaAberta: string | null;
  },
): boolean | null {
  if (!opcoes.listaDePaginasChegou) return null;
  if (especie === 'permissoes') return opcoes.podeGerir;
  if (especie === 'metas' || especie === 'insights') {
    return opcoes.abasExtras.some((aba) => aba.id === opcoes.abaAberta);
  }
  return opcoes.paginasDoRelatorio.some((pagina) => pagina.id === opcoes.abaAberta);
}

/** Uma aba com nome, para o título da casca. */
interface AbaComNome {
  id: string;
  rotulo?: string;
  nome?: string;
}

/** O título que a casca mostra para a aba aberta. */
export function tituloDaAba(
  especie: EspecieDeAba,
  opcoes: {
    paginasDoRelatorio: readonly AbaComNome[];
    abasExtras: readonly AbaComNome[];
    abaAberta: string | null;
  },
): string {
  if (especie === 'permissoes') return 'Configurações';
  if (especie === 'metas') return 'Metas';
  if (especie === 'insights') {
    const extra = opcoes.abasExtras.find((aba) => aba.id === opcoes.abaAberta);
    return extra?.rotulo ?? extra?.nome ?? 'Insights';
  }
  const pagina = opcoes.paginasDoRelatorio.find((p) => p.id === opcoes.abaAberta);
  return pagina?.nome ?? pagina?.rotulo ?? 'Instalação';
}
