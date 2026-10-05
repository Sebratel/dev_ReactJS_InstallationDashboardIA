// O estado da tela — página, filtros e campos clicados — lido da URL pelo react-router
// (fase 3 de `docs/PLANO-PADROES-FRONTEND.md`).
//
// **A URL é a fonte, não uma cópia.** Até a fase 2 o estado morava em três `useState`
// do `App.tsx` e a URL o seguia por um efeito, com `pushState`/`replaceState` e um
// ouvinte de `popstate` escritos à mão — e um `useRef` dizendo de onde veio cada mudança
// para decidir entre empilhar e substituir. Agora voltar e avançar não precisam de
// ouvinte nenhum: o roteador muda a localização e o estado é ela.
//
// **O clique EMPILHA; o resto SUBSTITUI.** Filtragem cruzada é exploração: a pessoa
// clica em cinco categorias seguidas e espera que voltar desfaça. Os seletores da barra
// e a troca de aba não empilham — ali o valor muda a cada caixa marcada, e o histórico
// viraria uma pilha de passos que ninguém quer desfazer um a um.
//
// **As ações leem a URL NA HORA** (`window.location`), e não o estado do último render:
// duas mudanças seguidas antes do render seguinte (marcar duas caixas depressa) leriam
// a mesma seleção velha, e a segunda apagaria a primeira.

import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { FiltroDaTela, Valor } from '../services/dashboardService.ts';
import { filtrosPadrao } from '../utils/filtrosPadrao.ts';
import {
  alternaAlvos,
  aplicaSelecao,
  chaveDeCampo,
  escreveRota,
  filtrosDaRota,
  leRota,
  type AlvoDeFiltro,
  type CampoClicado,
} from '../utils/rota.ts';

export interface EstadoDaTela {
  /** A página aberta; `null` até a lista chegar, quando a URL não traz uma. */
  atual: string | null;
  filtros: FiltroDaTela[];
  clicados: CampoClicado[];
  /** Filtros da URL que não decodificaram. A tela avisa em vez de calar. */
  invalidos: string[];
  /** Troca de aba: o filtro padrão da página nova, sem clicados. Substitui. */
  escolhe: (id: string) => void;
  /**
   * A URL não trouxe página: abre esta, mantendo o filtro que o link trouxe (ou o
   * padrão dela, se não trouxe nenhum). Substitui.
   */
  iniciaEm: (id: string) => void;
  /** Um seletor mudou (ou o chip saiu). Tira a marca de clique daquela coluna. Substitui. */
  mudaFiltro: (tabela: string, coluna: string, valores: Valor[], nivel?: string | null) => void;
  /** O clique num visual: aplica a tupla inteira, ou a desfaz se já estiver valendo. Empilha. */
  aoFiltrarAlvos: (alvos: readonly AlvoDeFiltro[]) => void;
}

/** O estado na URL de AGORA — ver o cabeçalho. */
function agora() {
  const r = leRota(window.location.search, window.location.pathname);
  return { pagina: r.pagina, filtros: filtrosDaRota(r), clicados: r.clicados };
}

/**
 * O que um clique num visual faz com os campos marcados como clicados: as colunas do
 * alvo que CONTINUAM filtradas depois da alternância entram; as que saíram (o segundo
 * clique, que desfaz) saem. Sem isto, desfazer deixaria a coluna marcada e o visual
 * seguiria auto-excluindo um filtro que já não existe. Exportado para a previsão do
 * clique (`usePreCargas`) fazer a mesma conta.
 */
export function aplicaClique(
  filtros: readonly FiltroDaTela[],
  clicados: readonly CampoClicado[],
  alvos: readonly AlvoDeFiltro[],
  padrao: readonly FiltroDaTela[],
): { filtros: FiltroDaTela[]; clicados: CampoClicado[] } {
  const depois = alternaAlvos(filtros, alvos, padrao);
  const aindaFiltradas = new Set(depois.filter((x) => x.valores.length > 0).map(chaveDeCampo));
  const mapa = new Map(clicados.map((c) => [chaveDeCampo(c), c]));
  for (const a of alvos) {
    const k = chaveDeCampo(a);
    if (aindaFiltradas.has(k)) mapa.set(k, { tabela: a.tabela, coluna: a.coluna });
    else mapa.delete(k);
  }
  return { filtros: depois, clicados: [...mapa.values()] };
}

/** O que mexer num seletor faz: a seleção nova, e a coluna deixa de ser "clicada". */
export function aplicaSeletor(
  filtros: readonly FiltroDaTela[],
  clicados: readonly CampoClicado[],
  tabela: string,
  coluna: string,
  valores: Valor[],
  nivel?: string | null,
): { filtros: FiltroDaTela[]; clicados: CampoClicado[] } {
  return {
    filtros: aplicaSelecao(filtros, tabela, coluna, valores, nivel),
    // A escolha passou a ser do controle, e controle recorta tudo — inclusive o visual
    // que desenha a coluna. Deixar a marca faria o gráfico ignorar o próprio seletor.
    clicados: clicados.filter((c) => chaveDeCampo(c) !== chaveDeCampo({ tabela, coluna })),
  };
}

export function useEstadoDaTela(): EstadoDaTela {
  const { search, pathname } = useLocation();
  const navigate = useNavigate();
  const rota = useMemo(() => leRota(search, pathname), [search, pathname]);
  const filtros = useMemo(() => filtrosDaRota(rota), [rota]);

  // Sempre para `/`: um link antigo com a página no caminho (`/visao-geral`) continua
  // abrindo, mas a página seguinte vai no parâmetro — com as duas na URL, o caminho
  // venceria (`leRota`) e trocar de aba não trocaria nada.
  const vai = useCallback(
    (pagina: string, f: readonly FiltroDaTela[], c: readonly CampoClicado[], empilha: boolean) =>
      navigate({ pathname: '/', search: escreveRota(pagina, f, c) }, { replace: !empilha }),
    [navigate],
  );

  const escolhe = useCallback((id: string) => vai(id, filtrosPadrao(id), [], false), [vai]);

  const iniciaEm = useCallback(
    (id: string) => {
      const r = leRota(window.location.search, window.location.pathname);
      vai(id, r.filtros.length > 0 || r.limpo ? r.filtros : filtrosPadrao(id), r.clicados, false);
    },
    [vai],
  );

  const mudaFiltro = useCallback(
    (tabela: string, coluna: string, valores: Valor[], nivel?: string | null) => {
      const a = agora();
      if (!a.pagina) return;
      const d = aplicaSeletor(a.filtros, a.clicados, tabela, coluna, valores, nivel);
      vai(a.pagina, d.filtros, d.clicados, false);
    },
    [vai],
  );

  const aoFiltrarAlvos = useCallback(
    (alvos: readonly AlvoDeFiltro[]) => {
      const a = agora();
      if (!a.pagina) return;
      // O `filtrosPadrao` é o piso do desfazer — ver `alternaAlvos`.
      const d = aplicaClique(a.filtros, a.clicados, alvos, filtrosPadrao(a.pagina));
      vai(a.pagina, d.filtros, d.clicados, true);
    },
    [vai],
  );

  return {
    atual: rota.pagina,
    filtros,
    clicados: rota.clicados,
    invalidos: rota.invalidos,
    escolhe,
    iniciaEm,
    mudaFiltro,
    aoFiltrarAlvos,
  };
}
