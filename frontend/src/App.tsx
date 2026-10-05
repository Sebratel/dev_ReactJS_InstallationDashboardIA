// A tela: escolhe a página, aplica as segmentações e desenha os visuais em formato Dashboard Sebratel.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  chavesDeConsulta,
  ehAbortError,
  ehErroDeSessao,
  type FiltroDaTela,
  type Valor,
} from './services/dashboardService.ts';
import {
  consultaDaAbertura,
  preCarregaAbertura,
  useDashboards,
  useLayout,
  usePaginaAberta,
  useSaude,
} from './hooks/useDadosDaTela.ts';
import { useSessaoStore } from './store/sessaoStore.ts';
import { useVizinhanca } from './hooks/useVizinhanca.ts';
import { sai } from './services/authService.ts';
import { assinaEventos } from './services/eventosService.ts';
import { avaliaSaudeQueries } from './utils/avisoSaude.ts';
import { dataHora, duracao, inteiro } from './utils/formato.ts';
import { useAlturaMedida, useEspacoSemVisual } from './hooks/useAlturaMedida.ts';
import { dataDaPagina, filtrosPadrao } from './utils/filtrosPadrao.ts';
import {
  alternaAlvos,
  aplicaSelecao,
  chaveDeCampo,
  escreveRota,
  leRota,
  selecaoDe,
  type AlvoDeFiltro,
  type CampoClicado,
} from './utils/rota.ts';
import { AppShell } from './components/layout/AppShell.tsx';
import { Capa } from './components/capa/Capa.tsx';
import { Erro } from './components/ui/Cartao.tsx';
import { EsqueletoDaPagina } from './components/layout/EsqueletoDaPagina.tsx';
import { Login } from './components/auth/Login.tsx';
import { Segmentacao } from './components/filtros/Segmentacao.tsx';
import { SegmentacaoChips } from './components/filtros/SegmentacaoChips.tsx';
import { SegmentacaoDataHierarquia } from './components/filtros/SegmentacaoDataHierarquia.tsx';
import { useModo } from './context/ModoContext.tsx';
import { ActiveFilterPill } from './components/filtros/ActiveFilterPill.tsx';
import { KpiGridSection } from './components/visuais/KpiGridSection.tsx';
import { VisualGridSection } from './components/visuais/VisualGridSection.tsx';
import { RefreshCw } from 'lucide-react';

/** De quanto em quanto a página aberta busca de novo sozinha, além do aviso do
 *  servidor — a rede de segurança para um aviso perdido numa reconexão do SSE.
 *  Fixo: era um seletor por pessoa ("Auto") até 05/10/2026. */
const ATUALIZA_SOZINHA_S = 60;

export function App() {
  const { conferencia } = useModo();
  const qc = useQueryClient();
  // `--h-filtros` valia 50px fixos e a barra mede 71px na maioria das telas — 110px
  // na MANUTENÇÃO INICIAL em 1366x768, que tem 13 controles e quebra em três linhas.
  // A conta de `--util` errava por até 60px, e o efeito era card mais alto do que
  // cabe, em toda página, sem nada acusando. Quando a página não tem filtro nenhum
  // (a CAPA), o `ref` fica vazio e o hook publica `0px` — a faixa que não existe
  // devolve o espaço.
  const barraFiltrosRef = useAlturaMedida<HTMLDivElement>('--h-filtros');
  // E `--util` também precisa descontar o que a página gasta e NÃO é card: a faixa de
  // indicadores (56px, 121px ou 187px conforme a página), o título de seção antes da
  // primeira faixa (`--h-antes`) e o outro título, entre as duas faixas (`--h-entre`).
  // Sem esses dois termos a conta media uma tela que o card não tem pela frente — ver
  // `useEspacoSemVisual`.
  const antesDosVisuaisRef = useEspacoSemVisual<HTMLDivElement>('--h-antes', '--h-entre');
  const inicial = useMemo(() => leRota(window.location.search), []);
  const [atual, setAtual] = useState<string | null>(inicial.pagina);
  // FILTRO PADRÃO: a página abre PRÉ-FILTRADA, como o relatório original.
  //
  // Era o gap nº1 da auditoria de paridade (`docs/PARIDADE-POWERBI.md` §6), e o
  // `filtros-padrao.ts` que o resolve estava aqui desde 20/08 — mas **sem chamador**.
  // Medido em 27/08/2026 na VISÃO GERAL: sem filtro a tela abre com 35.166
  // protocolos; com jul/2026, com 3.238, que é o número do relatório. Onze vezes de
  // diferença, sem nada na tela dizendo por quê.
  //
  // Só semeia na ABERTURA (URL sem filtro) e na troca de tela. Quem limpa o filtro
  // fica limpo: nenhum efeito reaplica o padrão a cada render. O preço é que
  // recarregar a página traz o padrão de volta — igual ao original, que também abre
  // no default.
  const [filtros, setFiltros] = useState<FiltroDaTela[]>(
    inicial.filtros.length > 0 ? inicial.filtros : filtrosPadrao(inicial.pagina),
  );
  // QUAIS COLUNAS NASCERAM DE CLIQUE. Não dá para derivar dos filtros: um recorte por
  // CIDADE tem a mesma cara vindo de clique ou de seletor, e a auto-exclusão só vale
  // para o primeiro. Mora na URL junto com os filtros, senão recarregar (ou abrir o
  // link) transformaria um destaque em colapso sem ninguém tocar em nada.
  const [clicados, setClicados] = useState<CampoClicado[]>(inicial.clicados);
  // Otimista: assume logado até o primeiro 401 de verdade, em QUALQUER consulta — quem
  // fica sabendo é o `QueryCache` (`services/queryClient.ts`). A tela de login
  // substitui o dashboard inteiro enquanto isto for `false` (ver o `return` abaixo).
  const logado = useSessaoStore((s) => s.logado);
  const expirou = useSessaoStore((s) => s.expirou);
  // Horário da última atualização (aviso do servidor, relógio ou "Atualizar").
  const [horaRealtime, setHoraRealtime] = useState<string | null>(null);

  // **O estado do servidor mora no React Query** (fase 2 de
  // `docs/PLANO-PADROES-FRONTEND.md`): a lista de páginas, a forma de cada uma, a
  // abertura e a saúde. Eram quatro caches feitos à mão aqui (`layoutsVistos`,
  // `paginasVistas`, o conjunto de pedidos em voo do hover e o `useState` da saúde),
  // cada um com a sua regra de validade. Ver `hooks/useDadosDaTela.ts`.
  const dashboardsQ = useDashboards();
  const paginas = useMemo(() => dashboardsQ.data ?? [], [dashboardsQ.data]);
  const layoutQ = useLayout(atual);
  const layout = layoutQ.data ?? null;
  const paginaQ = usePaginaAberta(atual, layoutQ.data, filtros, clicados);
  const pagina = paginaQ.data ?? null;
  const saude = useSaude().data ?? null;
  // Erro que a tela mostra: o de sessão vira login (no `QueryCache`), e pedido
  // cancelado não é erro — é o pedido seguinte fazendo o trabalho certo.
  const erroDeConsulta = [dashboardsQ.error, layoutQ.error, paginaQ.error].find(
    (e) => e && !ehErroDeSessao(e) && !ehAbortError(e),
  );
  const erro = erroDeConsulta ? (erroDeConsulta instanceof Error ? erroDeConsulta.message : String(erroDeConsulta)) : null;

  const marcaHora = useCallback(() => {
    setHoraRealtime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }, []);

  // O efeito do SSE roda uma vez por sessão de login — ler `atual` fresco de um
  // ref evita reabrir a conexão a cada troca de aba (senão perderia evento no
  // meio da troca, e reconectar sem necessidade é o oposto do que R6 já evita
  // para o `fetch` normal).
  const atualRef = useRef(atual);
  useEffect(() => {
    atualRef.current = atual;
  }, [atual]);

  // AUTO-REFRESH PERIÓDICO EM SEGUNDO PLANO: a rede de segurança para um aviso do
  // servidor perdido numa reconexão do SSE. Invalidar a página aberta faz a abertura E
  // os visuais abaixo da dobra buscarem de novo, mantendo o número atual na tela.
  useEffect(() => {
    if (!logado || !atual) return;
    const interval = setInterval(() => {
      if (!atualRef.current) return;
      marcaHora();
      void qc.invalidateQueries({ queryKey: chavesDeConsulta.pagina(atualRef.current) });
      void qc.invalidateQueries({ queryKey: chavesDeConsulta.saude });
    }, ATUALIZA_SOZINHA_S * 1000);
    return () => clearInterval(interval);
  }, [logado, atual, qc, marcaHora]);

  // ACHADOS #89/#90 — poller de quase-realtime: o servidor empurra por SSE quando
  // detecta mudança no Voalle. Nenhum dado chega pelo evento em si (só o id da
  // página). Toda combinação daquela página fica velha; a que está na tela busca de
  // novo na hora, e as outras quando voltarem a ser abertas.
  useEffect(() => {
    if (!logado) return;
    return assinaEventos((afetados) => {
      for (const id of afetados) void qc.invalidateQueries({ queryKey: chavesDeConsulta.pagina(id) });
      if (atualRef.current && afetados.includes(atualRef.current)) {
        marcaHora();
        void qc.invalidateQueries({ queryKey: chavesDeConsulta.saude });
      }
    });
  }, [logado, qc, marcaHora]);

  // A página inicial, quando a URL não trouxe uma: a primeira pronta da lista.
  useEffect(() => {
    const lista = dashboardsQ.data;
    if (!lista || atual) return;
    const escolhida = lista.find((d) => d.pronta)?.id ?? lista[0]?.id ?? null;
    setAtual(escolhida);
    setFiltros((f) => (f.length > 0 ? f : filtrosPadrao(escolhida)));
  }, [dashboardsQ.data, atual]);

  // Pré-carregamento em segundo plano, sequencial, das outras páginas prontas —
  // depois de a página inicial abrir, para não disputar a API com ela. Uma vez por
  // carga da tela.
  const fundoIniciado = useRef(false);
  useEffect(() => {
    const lista = dashboardsQ.data;
    if (!lista || fundoIniciado.current) return;
    fundoIniciado.current = true;
    const paginaInicial = inicial.pagina ?? lista.find((d) => d.pronta)?.id ?? lista[0]?.id ?? null;
    void (async () => {
      // Pequena pausa para a página em exibição carregar com prioridade máxima
      await new Promise((resolve) => setTimeout(resolve, 800));
      for (const d of lista) {
        if (!d.pronta || d.id === paginaInicial) continue;
        try {
          await preCarregaAbertura(qc, d.id, filtrosPadrao(d.id));
          // Intervalo leve entre páginas de fundo para manter a API responsiva
          await new Promise((resolve) => setTimeout(resolve, 300));
        } catch {
          // Pré-carregamento em background silencioso
        }
      }
    })();
  }, [dashboardsQ.data, inicial.pagina, qc]);

  // DE ONDE VEIO A MUDANÇA, para decidir o que fazer com o histórico.
  //
  // **O clique EMPILHA; o resto SUBSTITUI.** Filtragem cruzada é exploração: a pessoa
  // clica em cinco categorias seguidas e espera que voltar desfaça. Os seletores da
  // barra não podem empilhar — ali o valor muda a cada caixa marcada e a cada tecla da
  // busca, e o histórico viraria uma pilha de passos que ninguém quer desfazer um a um.
  //
  // Até 28/08 TUDO passava por `replaceState`, o clique junto: `history.length` não se
  // mexia, e não havia como voltar de um recorte que esvaziava a tela.
  const origemDaMudanca = useRef<'clique' | 'historico' | 'outro'>('outro');

  // VOLTAR E AVANÇAR TÊM DE LER A URL DE VOLTA. Sem este ouvinte o `pushState` abaixo
  // só mexeria na barra de endereço: o navegador restauraria a URL antiga e a tela
  // continuaria mostrando o recorte novo, agora divergindo do link.
  useEffect(() => {
    const aoAndarNoHistorico = () => {
      const r = leRota(window.location.search);
      origemDaMudanca.current = 'historico';
      if (r.pagina) setAtual(r.pagina);
      setFiltros(r.filtros);
      setClicados(r.clicados);
    };
    window.addEventListener('popstate', aoAndarNoHistorico);
    return () => window.removeEventListener('popstate', aoAndarNoHistorico);
  }, []);

  // A URL acompanha a tela. Era um pedaço do efeito que buscava a página; a busca agora
  // é do React Query, e o histórico ficou com o que é dele.
  useEffect(() => {
    if (!atual) return;
    const origem = origemDaMudanca.current;
    origemDaMudanca.current = 'outro';
    if (origem === 'historico') return;
    const rota = escreveRota(atual, filtros, clicados);
    if (origem === 'clique') window.history.pushState(null, '', rota);
    else window.history.replaceState(null, '', rota);
  }, [atual, filtros, clicados]);

  // Trocar de aba: a forma e a abertura já pré-carregadas saem do cache na hora.
  const escolhe = useCallback((id: string) => {
    setAtual(id);
    setFiltros(filtrosPadrao(id));
    setClicados([]);
  }, []);

  // FASE L5, R6 — prefetch da aba sob o cursor. Nunca mexe em estado visível
  // (`atual`/`filtros`): só deixa a forma e a abertura no cache, para o clique achá-las
  // prontas.
  const timeoutHover = useRef<number | null>(null);

  const cancelaPrefetch = useCallback(() => {
    if (timeoutHover.current !== null) {
      window.clearTimeout(timeoutHover.current);
      timeoutHover.current = null;
    }
  }, []);

  const prefetchaPagina = useCallback((id: string) => {
    // Em touch, hover e clique chegam quase juntos — sem esta guarda, todo toque
    // dispararia DOIS pedidos (o prefetch e o da abertura de verdade) em vez de um.
    if (!window.matchMedia('(pointer: fine)').matches) return;
    cancelaPrefetch();
    // "Intenção de hover": só adianta o pedido se o mouse ficar parado ali um
    // instante — um mouse só de passagem por cima de várias abas (indo para outro
    // lugar da tela) não pode disparar uma rajada de prefetch, um por aba.
    timeoutHover.current = window.setTimeout(() => {
      timeoutHover.current = null;
      // Prefetch é otimização: falhar aqui não pode aparecer em lugar nenhum visível.
      // O clique real tenta de novo e, se falhar, é ELE que mostra o erro.
      preCarregaAbertura(qc, id, filtrosPadrao(id)).catch(() => undefined);
    }, 60);
  }, [cancelaPrefetch, qc]);

  const mudaFiltro = useCallback(
    (tabela: string, coluna: string, valores: Valor[], nivel?: string | null) => {
      setFiltros((f) => aplicaSelecao(f, tabela, coluna, valores, nivel));
      // Mexer no seletor (ou apagar o chip) TIRA a marca de clique daquela coluna: a
      // escolha passou a ser do controle, e controle recorta tudo — inclusive o visual
      // que desenha a coluna. Deixar a marca faria o gráfico ignorar o próprio seletor.
      setClicados((antes) => antes.filter((c) => chaveDeCampo(c) !== chaveDeCampo({ tabela, coluna })));
    },
    [],
  );

  // O clique num visual: aplica a tupla inteira, ou a desfaz se já estiver valendo.
  // O `filtrosPadrao` é o piso do desfazer — ver `alternaAlvos`.
  const aoFiltrarAlvos = useCallback(
    (alvos: readonly AlvoDeFiltro[]) => {
      origemDaMudanca.current = 'clique';
      const padrao = filtrosPadrao(atual);
      setFiltros((f) => {
        const depois = alternaAlvos(f, alvos, padrao);
        // A marca de "clicado" acompanha o filtro: as colunas do alvo que CONTINUAM
        // filtradas depois da alternância entram; as que saíram (o segundo clique,
        // que desfaz) saem. Sem isto, desfazer deixaria a coluna marcada e o visual
        // seguiria auto-excluindo um filtro que já não existe.
        const aindaFiltradas = new Set(
          depois.filter((x) => x.valores.length > 0).map(chaveDeCampo),
        );
        setClicados((antes) => {
          const mapa = new Map(antes.map((c) => [chaveDeCampo(c), c]));
          for (const a of alvos) {
            const k = chaveDeCampo(a);
            if (aindaFiltradas.has(k)) mapa.set(k, { tabela: a.tabela, coluna: a.coluna });
            else mapa.delete(k);
          }
          return [...mapa.values()];
        });
        return depois;
      });
    },
    [atual],
  );

  // HOVER-PREFETCH DO CLIQUE CRUZADO — mesma ideia de `prefetchaPagina` (R6, hover de
  // ABA), um nível mais fundo: aqui é o hover de uma BARRA/CATEGORIA clicável dentro de
  // um gráfico já aberto, não o de uma aba da barra lateral.
  //
  // Pedido do usuário em 09/09/2026: clicar num técnico (94 categorias no ranking)
  // media ~1,5 s de resposta — sempre, e só no PRIMEIRO clique naquele técnico. A causa
  // não é o gráfico: é que `CacheDeResposta` (servidor) guarda por combinação EXATA de
  // filtro+clicado, então toda combinação nova é sempre um miss que recalcula a página
  // inteira. Não dá para aquecer as 94 de uma vez (94 recomputações completas só por
  // abrir a tela — mais caro que o problema que resolve), mas o intervalo entre o mouse
  // pousar numa barra e o clique de verdade é sobra suficiente para adiantar exatamente
  // a combinação que a pessoa está mirando, e só essa. O React Query já junta o pedido
  // que está a caminho com o do clique (era o `emVooHoverBarra`).
  //
  // O mesmo vale para os FILTROS (05/10/2026, ACHADOS #179): o clique de um valor só já
  // sai pronto do servidor (#163 pré-calcula as segmentações de até 40 valores), mas o
  // segundo filtro em cima do primeiro é combinação nova, ~1 s a frio. O mouse sobre o
  // chip ou sobre a opção do seletor adianta exatamente essa combinação.
  const timeoutHoverBarra = useRef<number | null>(null);

  const prefetchaPrevisao = useCallback(
    (prever: () => { filtros: FiltroDaTela[]; clicados: { tabela: string; coluna: string }[] }) => {
      // Mesma guarda de `prefetchaPagina`: em touch não existe "pairar antes de
      // clicar", então isto dispararia um pedido a mais por toque, não um adiantado.
      if (!window.matchMedia('(pointer: fine)').matches) return;
      if (!atual || !layout) return;
      if (timeoutHoverBarra.current !== null) window.clearTimeout(timeoutHoverBarra.current);
      // "Intenção de hover", igual a `prefetchaPagina`: só adianta se o mouse ficar
      // parado ali um instante — uma passada rápida por várias barras do ranking (a
      // caminho de outra coisa) não pode virar uma rajada, uma por barra.
      timeoutHoverBarra.current = window.setTimeout(() => {
        timeoutHoverBarra.current = null;
        const p = prever();
        void qc.prefetchQuery(consultaDaAbertura(atual, layout, p.filtros, p.clicados));
      }, 150);
    },
    [atual, layout, qc],
  );

  // A previsão de cada um repete a conta do clique de verdade (`aoFiltrarAlvos`,
  // `mudaFiltro`): uma conta diferente daria outra URL, e o pré-carregamento encheria
  // uma chave que o clique nunca lê.
  const aoPreverAlvos = useCallback(
    (alvos: readonly AlvoDeFiltro[]) =>
      prefetchaPrevisao(() => {
        const filtrosPrevistos = alternaAlvos(filtros, alvos, filtrosPadrao(atual));
        const aindaFiltradas = new Set(
          filtrosPrevistos.filter((x) => x.valores.length > 0).map(chaveDeCampo),
        );
        const mapa = new Map(clicados.map((c) => [chaveDeCampo(c), c]));
        for (const a of alvos) {
          const k = chaveDeCampo(a);
          if (aindaFiltradas.has(k)) mapa.set(k, { tabela: a.tabela, coluna: a.coluna });
          else mapa.delete(k);
        }
        return { filtros: filtrosPrevistos, clicados: [...mapa.values()] };
      }),
    [prefetchaPrevisao, atual, filtros, clicados],
  );

  const aoPreverFiltro = useCallback(
    (tabela: string, coluna: string, valores: Valor[], nivel?: string | null) =>
      prefetchaPrevisao(() => ({
        filtros: aplicaSelecao(filtros, tabela, coluna, valores, nivel),
        clicados: clicados.filter((c) => chaveDeCampo(c) !== chaveDeCampo({ tabela, coluna })),
      })),
    [prefetchaPrevisao, filtros, clicados],
  );

  const paginaValida = pagina && pagina.id === atual ? pagina : null;

  const dataDaTela = dataDaPagina(atual);

  // A segmentação de hierarquia da coluna de data sai da lista: a árvore ocupa o
  // lugar dela. O motor marca aquela como `naoFiltra` ("controle de drill... a
  // escolha ali é um caminho, não um conjunto de valores de um nível"), então ela
  // desenhava um botão que dizia "todos" com a página filtrada em julho. Deixar os
  // dois seria oferecer dois controles para a mesma coluna, um deles morto.
  const segmentacoes = (paginaValida?.visuais ?? []).filter(
    (v) =>
      v.segmentacao &&
      !(
        dataDaTela !== null &&
        v.segmentacao.tabela === dataDaTela.tabela &&
        v.segmentacao.coluna === dataDaTela.coluna
      ),
  );

  // TIPO DE PROTOCOLO vira fileira de chips, não dropdown — é o "TIPO DE
  // SOLICITAÇÃO" do BY, poucos valores e sempre visíveis (ver
  // SegmentacaoChips.tsx). Casado por tabela+coluna, não por página: é o mesmo
  // padrão de `dataDaTela` acima, não uma config nova.
  const ehChipDeSolicitacao = (s: { tabela: string; coluna: string }) =>
    s.tabela === 'PROTOCOLOS GERAL' && s.coluna === 'TIPO DE PROTOCOLO';
  const segmentacaoDeChips = segmentacoes.find((v) => ehChipDeSolicitacao(v.segmentacao!));
  const segmentacoesDropdown = segmentacoes.filter((v) => !ehChipDeSolicitacao(v.segmentacao!));

  // Os estados a um clique de filtro deste, pré-carregados enquanto a pessoa lê — os
  // chips primeiro, que são o clique mais provável (ACHADOS #179).
  useVizinhanca(
    atual,
    layout,
    filtros,
    clicados,
    [...(segmentacaoDeChips ? [segmentacaoDeChips] : []), ...segmentacoesDropdown].map((v) => v.segmentacao!),
    paginaValida !== null && !paginaQ.isPlaceholderData && !paginaQ.isFetching,
  );

  // FILTRO SEM SEGMENTAÇÃO NA TELA É RECORTE INVISÍVEL.
  //
  // Nem todo filtro nasce de um slicer: clicar num card ou numa barra faz
  // filtragem cruzada, e a URL pode trazer um filtro de coluna que esta página
  // nem segmenta. Esses não apareciam em lugar nenhum — os números mudavam, a
  // causa não estava na tela e a única saída era recarregar. É a diferença entre
  // "o dashboard está com número errado" e "há um recorte aplicado".
  //
  // Os que TÊM slicer ficam de fora de propósito: o botão já mostra a seleção e a
  // contagem, e repetir a mesma informação em dois lugares vira ruído.
  const comSlicer = new Set(
    segmentacoes.map((v) => `${v.segmentacao!.tabela}.${v.segmentacao!.coluna}.${v.segmentacao!.nivel ?? ''}`),
  );
  // A árvore de data cobre TODOS os níveis da sua coluna (Ano, Mês, Dia) de uma vez —
  // por isso ela sai por coluna, não por nível, senão o mês padrão apareceria também
  // como pill ao lado do controle que já o mostra.
  const cobertoPelaArvore = (f: FiltroDaTela) =>
    dataDaTela !== null && f.tabela === dataDaTela.tabela && f.coluna === dataDaTela.coluna;
  const filtrosOcultos = filtros.filter(
    (f) =>
      f.valores.length > 0 &&
      !comSlicer.has(`${f.tabela}.${f.coluna}.${f.nivel ?? ''}`) &&
      !cobertoPelaArvore(f),
  );
  // A Fase L4 leu `.conteudo` aqui até virar `layout.kpis`/`layout.faixas` (lidos
  // dentro de `KpiGridSection`/`VisualGridSection`) — ver docs/PLANO-LAYOUT-V1.md §6.
  const visuais = paginaValida?.visuais ?? [];

  const nome = paginas.find((p) => p.id === atual)?.nome ?? 'Instalação';

  // O dado não se atualiza sozinho (DECISAO-REALTIME.md).
  // Avaliação de saúde das queries do snapshot (Marco A6): monitora atraso e falhas por query.
  const avisoSaude = avaliaSaudeQueries(saude?.refresh?.queries, paginaValida?.dadoDe);

  // Sem sessão válida, a tela inteira vira o login — nenhum outro estado
  // (esqueleto, erro, dashboard) faz sentido enquanto isso for verdade, e o
  // reload depois de logar é de propósito: mais simples e mais confiável do
  // que tentar reencaixar cada efeito que já falhou.
  if (!logado) {
    return <Login aoLogar={() => window.location.reload()} />;
  }

  return (
    <AppShell
      paginas={paginas}
      atual={atual}
      aoEscolher={escolhe}
      aoPassarMouse={prefetchaPagina}
      aoSairDoMouse={cancelaPrefetch}
      aoSair={() => {
        sai().finally(() => expirou());
      }}
      titulo={nome}
      sub={
        avisoSaude.temAviso
          ? avisoSaude.mensagem
          : paginaValida
            ? `dado de ${dataHora(paginaValida.dadoDe)}`
            : ''
      }
      subAviso={avisoSaude.temAviso}
      avisoSaude={avisoSaude}
      ultimaAtualizacaoRealtime={horaRealtime}
      acoes={
        // **Um botão só, e ele não recalcula nada no servidor** (Erick, 05/10/2026).
        // O intervalo do relógio e o enquadramento eram escolha de cada pessoa; agora
        // são da plataforma. "Atualizar" busca de novo o que o servidor já tem pronto —
        // a página, os visuais abaixo da dobra e as listas dos filtros —, mantendo o
        // número atual na tela até o novo chegar. O antigo "Recalcular" mandava
        // `?recalcula=1`: refazia a conta e regravava o cache de TODO MUNDO por um clique.
        <button
          className="secundario"
          onClick={() => {
            if (!atual) return;
            marcaHora();
            // A página (abertura e visuais abaixo da dobra), as listas dos filtros e a
            // saúde. Buscar de novo é pedir o que o servidor já tem pronto.
            void qc.invalidateQueries({ queryKey: chavesDeConsulta.pagina(atual) });
            void qc.invalidateQueries({ queryKey: chavesDeConsulta.valores(atual) });
            void qc.invalidateQueries({ queryKey: chavesDeConsulta.saude });
          }}
          disabled={!atual}
          title="Buscar de novo os números desta página"
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <RefreshCw size={14} className={paginaQ.isFetching ? 'girando' : undefined} aria-hidden="true" />
          Atualizar
        </button>
      }

    >
      {inicial.invalidos.length > 0 ? (
        <div className="aviso">
          {inicial.invalidos.length} filtro(s) da URL foram ignorados: {inicial.invalidos.join(' | ')}
        </div>
      ) : null}

      {erro ? <Erro>{erro}</Erro> : null}

      {segmentacoes.length > 0 || filtrosOcultos.length > 0 || dataDaTela ? (
        <div className="filtros" ref={barraFiltrosRef}>
          {/* A ÁRVORE DE DATA VEM PRIMEIRO: é o recorte que a página já traz aplicado
              ao abrir, então é o primeiro que alguém vai querer mexer. Ela existia
              desde 26/08 (com `hierarquiaData.ts` testado ao lado) e nunca foi
              montada em lugar nenhum. */}
          {dataDaTela ? (
            <SegmentacaoDataHierarquia
              pagina={atual!}
              tabela={dataDaTela.tabela}
              coluna={dataDaTela.coluna}
              rotulo="Período"
              filtros={filtros}
              aoMudar={(nivel, valores) =>
                mudaFiltro(dataDaTela.tabela, dataDaTela.coluna, valores, nivel)
              }
            />
          ) : null}
          {filtrosOcultos.map((f) => (
            <ActiveFilterPill
              key={`${f.tabela}.${f.coluna}.${f.nivel ?? ''}`}
              filtro={f}
              aoRemover={() => mudaFiltro(f.tabela, f.coluna, [], f.nivel)}
            />
          ))}
          {segmentacoesDropdown.map((v) => {
            const s = v.segmentacao!;
            return (
              <Segmentacao
                key={v.id}
                pagina={atual!}
                spec={s}
                selecao={selecaoDe(filtros, s.tabela, s.coluna, s.nivel)}
                aoMudar={(valores) => mudaFiltro(s.tabela, s.coluna, valores, s.nivel)}
                aoPrever={(valores) => aoPreverFiltro(s.tabela, s.coluna, valores, s.nivel)}
              />
            );
          })}
        </div>
      ) : null}

      {segmentacaoDeChips ? (
        <SegmentacaoChips
          pagina={atual!}
          spec={segmentacaoDeChips.segmentacao!}
          selecao={selecaoDe(
            filtros,
            segmentacaoDeChips.segmentacao!.tabela,
            segmentacaoDeChips.segmentacao!.coluna,
            segmentacaoDeChips.segmentacao!.nivel,
          )}
          aoMudar={(valores) =>
            mudaFiltro(
              segmentacaoDeChips.segmentacao!.tabela,
              segmentacaoDeChips.segmentacao!.coluna,
              valores,
              segmentacaoDeChips.segmentacao!.nivel,
            )
          }
          aoPrever={(valores) =>
            aoPreverFiltro(
              segmentacaoDeChips.segmentacao!.tabela,
              segmentacaoDeChips.segmentacao!.coluna,
              valores,
              segmentacaoDeChips.segmentacao!.nivel,
            )
          }
        />
      ) : null}

      {conferencia && paginaValida ? (
        <div className="faixa">
          <span className="selo">{paginaValida.resumo.calculados} calculados</span>
          {paginaValida.resumo.falharam ? (
            <span className="selo ruim">{paginaValida.resumo.falharam} com erro</span>
          ) : null}
          <span className="selo neutro">{paginaValida.resumo.semCalculo} sem número</span>
          {filtros.length ? (
            <span className="selo neutro">
              {filtros.length} segmentação(ões) aplicada(s)
            </span>
          ) : (
            <span className="selo apagado">sem filtro da tela</span>
          )}
          <span>{duracao(paginaValida.ms)} de cálculo</span>
          <span>{paginaValida.tabelas.map((t) => `${t.nome}: ${inteiro(t.linhas)}`).join(' · ')}</span>
        </div>
      ) : null}

      {atual !== null && !paginaValida && !erro ? (
        layout ? (
          <EsqueletoDaPagina layout={layout} />
        ) : (
          // Janela residual em que nem `layout` chegou ainda — tipicamente um
          // sub-frame (Fase L4: o endpoint é um mapa em memória). Sem a forma real
          // ainda para copiar, o bloco genérico de antes é o fallback.
          <div className="esqueleto">
            <div className="esqueleto-linha" />
            <div className="esqueleto-linha" />
            <div className="esqueleto-linha" />
          </div>
        )
      ) : null}

      <>
        {/* A CAPA é a única tela escrita à mão, e o motivo é medido: das 30 formas
            que a spec traz para ela, 28 não têm número — a tela gerada renderizava
            DOIS cartões de indicador num vazio. O componente que a substitui existia
            desde 26/08 e nunca foi importado; os dois KPIs são dado de verdade e
            continuam na tela, como selo da faixa da capa. */}
        {atual === 'capa' ? (
          <Capa dadoDe={paginaValida?.dadoDe ?? null} saude={saude} telas={paginas.length} visuais={visuais} />
        ) : null}

        {/* Faixa de KPIs em Grid Responsivo. Na CAPA os dois KPIs viram selo da faixa. */}
        {atual === 'capa' ? null : <KpiGridSection layout={layout} visuais={visuais} />}

        {/* Seção de Gráficos, Matrizes e Análise Detalhada.
            O `div` existe para medir: é dele que sai `--h-antes`, a distância do topo
            do conteúdo até o primeiro card. Ele não tem estilo — a grade continua
            sendo a do `VisualGridSection`. */}
        <div ref={antesDosVisuaisRef}>
          <VisualGridSection
            pagina={atual!}
            layout={layout}
            visuais={visuais}
            filtros={filtros}
            clicados={clicados}
            aoFiltrar={aoFiltrarAlvos}
            aoPrever={aoPreverAlvos}
          />
        </div>
      </>

      {paginaValida && visuais.every((v) => v.conteudo === null) ? (
        <div className="vazio-pagina">Esta página não tem visual com número.</div>
      ) : null}
    </AppShell>
  );
}
