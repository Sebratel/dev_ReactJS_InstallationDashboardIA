// A tela: escolhe a página, aplica as segmentações e desenha os visuais em formato Dashboard Sebratel.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ehAbortError,
  listaDashboards,
  pegaLayout,
  pegaPagina,
  type DashboardDaLista,
  type FiltroDaTela,
  type LayoutSpec,
  type PaginaCalculada,
  type Valor,
} from './api.ts';
import { dataHora, duracao, inteiro } from './formato.ts';
import { usaAlturaMedida, usaEspacoSemVisual } from './altura-medida.ts';
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
  const [erro, setErro] = useState<string | null>(null);
  // A FORMA da página (Fase L4): não depende de filtro nem de clique, só de qual
  // página está aberta — por isso vive num efeito à parte, e não no de `pegaPagina`
  // abaixo. Cache por página nesta sessão: o arquivo não muda em runtime, e refazer o
  // pedido a cada volta a uma página já vista seria trabalho à toa.
  const [layout, setLayout] = useState<LayoutSpec | null>(null);
  const layoutsVistos = useRef<Map<string, LayoutSpec>>(new Map());

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
        setErro(err instanceof Error ? err.message : String(err));
      });
    return () => aborta.abort();
  }, [atual]);

  useEffect(() => {
    listaDashboards()
      .then((r) => {
        setPaginas(r.dashboards);
        setAtual((a) => {
          if (a) return a;
          // A tela inicial só é conhecida agora: o padrão dela tem de ser semeado
          // aqui, senão a primeira página que qualquer um abre é a única sem filtro.
          const escolhida = r.dashboards.find((d) => d.pronta)?.id ?? r.dashboards[0]?.id ?? null;
          setFiltros((f) => (f.length > 0 ? f : filtrosPadrao(escolhida)));
          return escolhida;
        });
      })
      .catch((err: unknown) => setErro(err instanceof Error ? err.message : String(err)));
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

    // FASE L5, R4: a abertura só pede o que está acima da dobra, não a página
    // inteira — e para saber o corte precisa da FORMA primeiro (`idsIniciais`, lida
    // de `layout.yaml`). Lê do REF (`layoutsVistos`), não do estado `layout`: o ref
    // já está correto no instante em que este efeito roda, mesmo antes de o estado
    // (que só atualiza num próximo render) refletir a troca de página — ler o
    // estado aqui arriscaria montar `idsIniciais` em cima do LAYOUT DA PÁGINA
    // ANTERIOR, por uma corrida entre os dois efeitos desta troca de `atual`.
    // `layout` continua na lista de dependências só para ESTE efeito rodar de novo
    // quando o cache-miss for resolvido (o ref, sozinho, não dispara re-render).
    const layoutAtual = layoutsVistos.current.get(atual);
    if (!layoutAtual) {
      setCarregando(true);
      setErro(null);
      return;
    }

    let cancelado = false;
    // Ver `pegaPagina`: sem cancelar, quatro cliques em rajada viram quatro cálculos
    // completos, e a penúltima resposta pode chegar depois da última.
    const aborta = new AbortController();

    setCarregando(true);
    setErro(null);
    // Voltar/avançar JÁ mexeu no histórico. Escrever de novo aqui criaria uma entrada
    // a cada clique no botão voltar, e a pessoa ficaria presa oscilando entre dois
    // estados sem nunca sair do lugar.
    const origem = origemDaMudanca.current;
    origemDaMudanca.current = 'outro';
    if (origem !== 'historico') {
      const rota = escreveRota(atual, filtros, clicados);
      if (origem === 'clique') window.history.pushState(null, '', rota);
      else window.history.replaceState(null, '', rota);
    }

    pegaPagina(atual, filtros, { visuais: idsIniciais(layoutAtual) }, aborta.signal, clicados)
      .then((p) => {
        if (!cancelado) setPagina(p);
      })
      .catch((err: unknown) => {
        // Pedido cancelado não é falha: quem cancelou foi o clique seguinte, e a tela
        // já está carregando o recorte novo. Pintar "erro" aqui faria a exploração
        // piscar uma mensagem vermelha a cada clique em rajada.
        if (cancelado || ehAbortError(err)) return;
        setPagina(null);
        setErro(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    return () => {
      cancelado = true;
      aborta.abort();
    };
  }, [atual, filtros, clicados, layout]);

  const escolhe = useCallback((id: string) => {
    setAtual(id);
    setFiltros(filtrosPadrao(id));
    setClicados([]);
    setPagina(null);
  }, []);

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

  return (
    <AppShell
      paginas={paginas}
      atual={atual}
      aoEscolher={escolhe}
      titulo={nome}
      sub={pagina ? `dado de ${dataHora(pagina.dadoDe)}` : ''}
      acoes={
        <button
          className="primario"
          onClick={() => setFiltros((f) => [...f])}
          disabled={carregando || !atual}
        >
          {carregando ? 'calculando…' : 'Recalcular'}
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

      {/* A CAPA é a única tela escrita à mão, e o motivo é medido: das 30 formas
          que a spec traz para ela, 28 não têm número — a tela gerada renderizava
          DOIS cartões de indicador num vazio. O componente que a substitui existia
          desde 26/08 e nunca foi importado; os dois KPIs continuam abaixo, porque
          são dado de verdade. */}
      {atual === 'capa' ? <Capa dadoDe={pagina?.dadoDe ?? null} /> : null}

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

      {pagina && visuais.every((v) => v.conteudo === null) ? (
        <div className="vazio-pagina">Esta página não tem visual com número.</div>
      ) : null}
    </AppShell>
  );
}
