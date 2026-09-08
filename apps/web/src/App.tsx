// A tela: escolhe a página, aplica as segmentações e desenha os visuais em formato Dashboard Sebratel.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ehAbortError,
  ehErroDeSessao,
  listaDashboards,
  pegaLayout,
  pegaPagina,
  pegaSaude,
  sai,
  urlDaPagina,
  type DashboardDaLista,
  type FiltroDaTela,
  type LayoutSpec,
  type PaginaCalculada,
  type RespostaSaude,
  type Valor,
} from './api.ts';
import { avaliaSaudeQueries } from './aviso-saude.ts';
import { dataHora, duracao, inteiro } from './formato.ts';
import { usaAlturaMedida, usaEspacoSemVisual } from './altura-medida.ts';
import { apagaPaginaDoCache, guardaPaginaVista } from './cache-pagina.ts';
import { idsIniciais } from './carga-progressiva.ts';
import { dataDaPagina, filtrosPadrao } from './filtros-padrao.ts';
import {
  alternaAlvos,
  aplicaSelecao,
  chaveDeCampo,
  escreveRota,
  leRota,
  selecaoDe,
  type AlvoDeFiltro,
  type CampoClicado,
} from './rota.ts';
import { AppShell } from './componentes/AppShell.tsx';
import { Capa } from './componentes/Capa.tsx';
import { Erro } from './componentes/Cartao.tsx';
import { EsqueletoDaPagina } from './componentes/EsqueletoDaPagina.tsx';
import { Login } from './componentes/Login.tsx';
import { Segmentacao } from './componentes/Segmentacao.tsx';
import { SegmentacaoDataHierarquia } from './componentes/SegmentacaoDataHierarquia.tsx';
import { usaModo } from './modo.tsx';
import { ActiveFilterPill } from './atomic/molecules/ActiveFilterPill.tsx';
import { KpiGridSection } from './atomic/organisms/KpiGridSection.tsx';
import { VisualGridSection } from './atomic/organisms/VisualGridSection.tsx';

export function App() {
  const { conferencia } = usaModo();
  // `--h-filtros` valia 50px fixos e a barra mede 71px na maioria das telas — 110px
  // na MANUTENÇÃO INICIAL em 1366x768, que tem 13 controles e quebra em três linhas.
  // A conta de `--util` errava por até 60px, e o efeito era card mais alto do que
  // cabe, em toda página, sem nada acusando. Quando a página não tem filtro nenhum
  // (a CAPA), o `ref` fica vazio e o hook publica `0px` — a faixa que não existe
  // devolve o espaço.
  const barraFiltrosRef = usaAlturaMedida<HTMLDivElement>('--h-filtros');
  // E `--util` também precisa descontar o que a página gasta e NÃO é card: a faixa de
  // indicadores (56px, 121px ou 187px conforme a página), o título de seção antes da
  // primeira faixa (`--h-antes`) e o outro título, entre as duas faixas (`--h-entre`).
  // Sem esses dois termos a conta media uma tela que o card não tem pela frente — ver
  // `usaEspacoSemVisual`.
  const antesDosVisuaisRef = usaEspacoSemVisual<HTMLDivElement>('--h-antes', '--h-entre');
  const inicial = useMemo(() => leRota(window.location.search), []);
  const [paginas, setPaginas] = useState<DashboardDaLista[]>([]);
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
  const [pagina, setPagina] = useState<PaginaCalculada | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [enquadrado, setEnquadrado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Otimista: assume logado até o primeiro 401 de verdade. Vira `false` em
  // QUALQUER chamada a `/api/*` que volte sem sessão — a tela de login
  // substitui o dashboard inteiro enquanto isto for `false` (ver o `return`
  // mais abaixo). Não existe estado "ainda não sei": antes do primeiro
  // pedido responder, o esqueleto de carregamento de sempre cobre a espera.
  const [logado, setLogado] = useState(true);
  // A FORMA da página (Fase L4): não depende de filtro nem de clique, só de qual
  // página está aberta — por isso vive num efeito à parte, e não no de `pegaPagina`
  // abaixo. Cache por página nesta sessão: o arquivo não muda em runtime, e refazer o
  // pedido a cada volta a uma página já vista seria trabalho à toa.
  const [layout, setLayout] = useState<LayoutSpec | null>(null);
  const layoutsVistos = useRef<Map<string, LayoutSpec>>(new Map());
  // FASE L5, R5 — stale-while-revalidate de `pagina`, por URL (a mesma chave que
  // já vai para a rede: page+filtros+visuais+clicados). Diferente de `layoutsVistos`
  // (que nunca revalida — layout não muda em runtime), aqui a rede SEMPRE roda atrás;
  // o cache só evita mostrar o esqueleto de novo numa combinação já vista nesta
  // sessão. Teto simples por ordem de inserção: sem ele, uma sessão de filtragem
  // cruzada longa (`aoFiltrarAlvos` acima) acumula uma chave por combinação de
  // filtro+clique sem nunca podar.
  const paginasVistas = useRef<Map<string, PaginaCalculada>>(new Map());
  // Sobe a cada evento de `/api/eventos` que atinge a página ABERTA — é o único
  // jeito de reabrir o efeito de busca abaixo sem depender de `atual`/`filtros`/
  // `clicados` terem mudado (ACHADOS #89/#90: a tela se atualiza sozinha).
  const [revalidar, setRevalidar] = useState(0);
  // Saúde das queries do refresh (Marco A6) — monitora atrasos e falhas por query.
  const [saude, setSaude] = useState<RespostaSaude | null>(null);
  // Horário da última atualização automática recebida via SSE (Marco C2).
  const [horaRealtime, setHoraRealtime] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    pegaSaude()
      .then((s) => {
        if (!cancelado) setSaude(s);
      })
      .catch(() => {
        // Rota /api/saude responde silenciosamente se endpoint não responder ou em mock
      });
    return () => {
      cancelado = true;
    };
  }, [revalidar]);

  // O efeito do SSE roda uma vez por sessão de login — ler `atual` fresco de um
  // ref evita reabrir a conexão a cada troca de aba (senão perderia evento no
  // meio da troca, e reconectar sem necessidade é o oposto do que R6 já evita
  // para o `fetch` normal).
  const atualRef = useRef(atual);

  useEffect(() => {
    if (!atual) return;
    const doCache = layoutsVistos.current.get(atual);
    if (doCache) {
      setLayout(doCache);
      return;
    }
    setLayout(null);
    const aborta = new AbortController();
    pegaLayout(atual, aborta.signal)
      .then((l) => {
        layoutsVistos.current.set(atual, l);
        setLayout(l);
      })
      .catch((err: unknown) => {
        if (ehAbortError(err)) return;
        if (ehErroDeSessao(err)) {
          setLogado(false);
          return;
        }
        setErro(err instanceof Error ? err.message : String(err));
      });
    return () => aborta.abort();
  }, [atual]);

  useEffect(() => {
    atualRef.current = atual;
  }, [atual]);

  // ACHADOS #89/#90 — poller de quase-realtime: o servidor empurra por SSE quando
  // detecta mudança no Voalle. Nenhum dado chega pelo evento em si (só o id da
  // página) — a tela reage apagando o cache daquela combinação e, se for a página
  // ABERTA agora, disparando o mesmo `fetch` de sempre, sem F5.
  useEffect(() => {
    if (!logado) return;
    const es = new EventSource('/api/eventos');
    es.onmessage = (ev) => {
      let corpo: { dashboards?: unknown };
      try {
        corpo = JSON.parse(ev.data as string);
      } catch {
        return; // linha de comentário SSE (`: conectado`) não chega aqui — só `data:`.
      }
      const afetados = Array.isArray(corpo.dashboards) ? (corpo.dashboards as string[]) : [];
      if (afetados.length === 0) return;
      for (const id of afetados) apagaPaginaDoCache(paginasVistas.current, id);
      if (atualRef.current && afetados.includes(atualRef.current)) {
        const agora = new Date();
        const horaFmt = agora.toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        setHoraRealtime(horaFmt);
        setRevalidar((n) => n + 1);
      }
    };
    return () => es.close();
  }, [logado]);

  useEffect(() => {

    listaDashboards()
      .then((r) => {
        setPaginas(r.dashboards);
        setAtual((a) => {
          if (a) return a;
          const escolhida = r.dashboards.find((d) => d.pronta)?.id ?? r.dashboards[0]?.id ?? null;
          setFiltros((f) => (f.length > 0 ? f : filtrosPadrao(escolhida)));
          return escolhida;
        });

        // Pré-carregamento em segundo plano sequencial de outras páginas prontas,
        // aguardando a página inicial abrir primeiro para não disputar recursos da API.
        const paginaInicial = inicial.pagina ?? r.dashboards.find((d) => d.pronta)?.id ?? r.dashboards[0]?.id ?? null;
        void (async () => {
          // Pequena pausa para a página em exibição carregar com prioridade máxima
          await new Promise((resolve) => setTimeout(resolve, 800));
          for (const d of r.dashboards) {
            if (!d.pronta || d.id === paginaInicial) continue;
            try {
              let l = layoutsVistos.current.get(d.id);
              if (!l) {
                l = await pegaLayout(d.id);
                layoutsVistos.current.set(d.id, l);
              }
              const f = filtrosPadrao(d.id);
              const opcoesEager = { visuais: idsIniciais(l) };
              const chave = urlDaPagina(d.id, f, opcoesEager, []);
              if (!paginasVistas.current.has(chave)) {
                const p = await pegaPagina(d.id, f, opcoesEager, undefined, []);
                guardaPaginaVista(paginasVistas.current, chave, p);
              }
              // Intervalo leve entre páginas de fundo para manter a API 100% responsiva
              await new Promise((resolve) => setTimeout(resolve, 300));
            } catch {
              // Pré-carregamento em background silencioso
            }
          }
        })();
      })
      .catch((err: unknown) => {
        if (ehErroDeSessao(err)) {
          setLogado(false);
          return;
        }
        setErro(err instanceof Error ? err.message : String(err));
      });
  }, []);

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

  useEffect(() => {
    if (!atual) return;

    const layoutAtual = layoutsVistos.current.get(atual);
    if (!layoutAtual) {
      setCarregando(true);
      setErro(null);
      return;
    }

    const opcoesEager = { visuais: idsIniciais(layoutAtual) };
    const chave = urlDaPagina(atual, filtros, opcoesEager, clicados);
    const doCache = paginasVistas.current.get(chave);
    if (doCache) {
      setPagina(doCache);
      setCarregando(false);
    } else {
      // Se já temos uma página renderizada, mantemos os dados visíveis enquanto o recálculo roda
      setCarregando(pagina === null);
    }

    let cancelado = false;
    const aborta = new AbortController();

    setErro(null);
    const origem = origemDaMudanca.current;
    origemDaMudanca.current = 'outro';
    if (origem !== 'historico') {
      const rota = escreveRota(atual, filtros, clicados);
      if (origem === 'clique') window.history.pushState(null, '', rota);
      else window.history.replaceState(null, '', rota);
    }

    pegaPagina(atual, filtros, opcoesEager, aborta.signal, clicados)
      .then((p) => {
        guardaPaginaVista(paginasVistas.current, chave, p);
        if (!cancelado) {
          setPagina(p);
          setCarregando(false);
        }
      })
      .catch((err: unknown) => {
        if (cancelado || ehAbortError(err)) return;
        if (ehErroDeSessao(err)) {
          setLogado(false);
          return;
        }
        setErro(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    return () => {
      cancelado = true;
      aborta.abort();
    };
  }, [atual, filtros, clicados, layout, revalidar]);

  const escolhe = useCallback((id: string) => {
    const layout = layoutsVistos.current.get(id) ?? null;
    const padrao = filtrosPadrao(id);
    const opcoesEager = layout ? { visuais: idsIniciais(layout) } : undefined;
    const chave = layout ? urlDaPagina(id, padrao, opcoesEager, []) : null;
    const cached = chave ? paginasVistas.current.get(chave) ?? null : null;

    setAtual(id);
    setFiltros(padrao);
    setClicados([]);
    setLayout(layout);
    if (cached) {
      setPagina(cached);
      setCarregando(false);
    }
  }, []);


  // FASE L5, R6 — prefetch da aba sob o cursor. DEPENDE de R5 (`paginasVistas`) já
  // existir: sem cache de página, adiantar o fetch aqui só moveria a espera de "depois
  // do clique" para "antes do clique", sem economizar nada quando o clique realmente
  // vier. Nunca mexe em estado visível (`atual`/`pagina`/`filtros`) — só pré-aquece os
  // dois Maps, para o efeito de cima (e o de `layout`) acharem tudo pronto.
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
      void (async () => {
        let l = layoutsVistos.current.get(id);
        if (!l) {
          try {
            l = await pegaLayout(id);
            layoutsVistos.current.set(id, l);
          } catch {
            return; // prefetch é otimização: falhar aqui não pode aparecer em lugar nenhum visível.
          }
        }
        const filtrosDoPrefetch = filtrosPadrao(id);
        const opcoesEager = { visuais: idsIniciais(l) };
        const chave = urlDaPagina(id, filtrosDoPrefetch, opcoesEager, []);
        if (paginasVistas.current.has(chave)) return; // já quente — nada a adiantar.
        try {
          const p = await pegaPagina(id, filtrosDoPrefetch, opcoesEager, undefined, []);
          guardaPaginaVista(paginasVistas.current, chave, p);
        } catch {
          // idem: sem sinal visível. O clique real vai tentar de novo e, se falhar,
          // é ELE que mostra o erro.
        }
      })();
    }, 60);
  }, [cancelaPrefetch]);

  const mudaFiltro = useCallback(
    (tabela: string, coluna: string, valores: Valor[], nivel?: string) => {
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

  const dataDaTela = dataDaPagina(atual);

  // A segmentação de hierarquia da coluna de data sai da lista: a árvore ocupa o
  // lugar dela. O motor marca aquela como `naoFiltra` ("controle de drill... a
  // escolha ali é um caminho, não um conjunto de valores de um nível"), então ela
  // desenhava um botão que dizia "todos" com a página filtrada em julho. Deixar os
  // dois seria oferecer dois controles para a mesma coluna, um deles morto.
  const segmentacoes = (pagina?.visuais ?? []).filter(
    (v) =>
      v.segmentacao &&
      !(
        dataDaTela !== null &&
        v.segmentacao.tabela === dataDaTela.tabela &&
        v.segmentacao.coluna === dataDaTela.coluna
      ),
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
  const visuais = pagina?.visuais ?? [];

  const nome = paginas.find((p) => p.id === atual)?.nome ?? 'Instalação';

  // O dado não se atualiza sozinho (DECISAO-REALTIME.md).
  // Avaliação de saúde das queries do snapshot (Marco A6): monitora atraso e falhas por query.
  const avisoSaude = avaliaSaudeQueries(saude?.refresh?.queries, pagina?.dadoDe);

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
        sai().finally(() => setLogado(false));
      }}
      titulo={nome}
      sub={
        avisoSaude.temAviso
          ? avisoSaude.mensagem
          : pagina
            ? `dado de ${dataHora(pagina.dadoDe)}`
            : ''
      }
      subAviso={avisoSaude.temAviso}
      avisoSaude={avisoSaude}
      ultimaAtualizacaoRealtime={horaRealtime}
      acoes={
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            className={`secundario ${enquadrado ? 'ativo' : ''}`}
            onClick={() => setEnquadrado((e) => !e)}
            title="Enquadrar conteúdo na tela para visualização em 16:9 sem rolagem"
            style={{
              padding: '6px 12px',
              fontSize: '0.85rem',
              backgroundColor: enquadrado ? '#880F17' : 'transparent',
              color: enquadrado ? '#fff' : 'inherit',
              border: '1px solid #880F17',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {enquadrado ? '🗗 Tamanho normal' : '⛶ Enquadrar na tela'}
          </button>
          <button
            className="primario"
            onClick={() => setFiltros((f) => [...f])}
            disabled={carregando || !atual}
          >
            {carregando ? 'calculando…' : 'Recalcular'}
          </button>
        </div>
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
              desde 26/08 (com `hierarquia-data.ts` testado ao lado) e nunca foi
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
          {segmentacoes.map((v) => {
            const s = v.segmentacao!;
            return (
              <Segmentacao
                key={v.id}
                pagina={atual!}
                spec={s}
                selecao={selecaoDe(filtros, s.tabela, s.coluna, s.nivel)}
                aoMudar={(valores) => mudaFiltro(s.tabela, s.coluna, valores, s.nivel)}
              />
            );
          })}
        </div>
      ) : null}

      {conferencia && pagina ? (
        <div className="faixa">
          <span className="selo">{pagina.resumo.calculados} calculados</span>
          {pagina.resumo.falharam ? (
            <span className="selo ruim">{pagina.resumo.falharam} com erro</span>
          ) : null}
          <span className="selo neutro">{pagina.resumo.semCalculo} sem número</span>
          {filtros.length ? (
            <span className="selo neutro">
              {filtros.length} segmentação(ões) aplicada(s)
            </span>
          ) : (
            <span className="selo apagado">sem filtro da tela</span>
          )}
          <span>{duracao(pagina.ms)} de cálculo</span>
          <span>{pagina.tabelas.map((t) => `${t.nome}: ${inteiro(t.linhas)}`).join(' · ')}</span>
        </div>
      ) : null}

      {carregando && !pagina ? (
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

      <div style={enquadrado ? { transform: 'scale(0.82)', transformOrigin: 'top center', transition: 'transform 0.2s ease-in-out' } : undefined}>
        {/* A CAPA é a única tela escrita à mão, e o motivo é medido: das 30 formas
            que a spec traz para ela, 28 não têm número — a tela gerada renderizava
            DOIS cartões de indicador num vazio. O componente que a substitui existia
            desde 26/08 e nunca foi importado; os dois KPIs continuam abaixo, porque
            são dado de verdade. */}
        {atual === 'capa' ? (
          <Capa dadoDe={pagina?.dadoDe ?? null} queriesSaude={saude?.refresh?.queries} />
        ) : null}

        {/* Faixa de KPIs em Grid Responsivo */}
        <KpiGridSection layout={layout} visuais={visuais} />

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
          />
        </div>
      </div>


      {pagina && visuais.every((v) => v.conteudo === null) ? (
        <div className="vazio-pagina">Esta página não tem visual com número.</div>
      ) : null}
    </AppShell>
  );
}
