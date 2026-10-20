// A página do dashboard: compõe o estado da tela (URL), os dados (React Query), o tempo
// real e os pré-carregamentos, e desenha o AppShell com a barra de filtros e os visuais.
//
// Fina de propósito (fase 3 de `docs/PLANO-PADROES-FRONTEND.md`): a lógica mora nos
// hooks — `useEstadoDaTela` (o que a URL diz e o que cada clique faz com ela),
// `useDadosDaTela` (o que o servidor responde), `useTempoReal` (quando buscar de novo),
// `usePreCargas` e `useVizinhanca` (o que adiantar) —, e os pedaços da tela são
// componentes.

import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ehAbortError,
  ehErroDeAcesso,
  ehErroDeSessao,
  registraAberturaDeAba,
} from '../../services/dashboardService.ts';
import { sai } from '../../services/authService.ts';
import { useSessaoStore } from '../../store/sessaoStore.ts';
import { useRascunhoDeAcessos } from '../../store/rascunhoDeAcessosStore.ts';
import { pegaMatriz, pegaUsoDasTelas } from '../../services/acessoService.ts';
import { useModo } from '../../context/ModoContext.tsx';
import {
  useDashboards,
  idsSobDemanda,
  useEu,
  useLayout,
  usePaginaAberta,
  useSaude,
} from '../../hooks/useDadosDaTela.ts';
import { useEstadoDaTela } from '../../hooks/useEstadoDaTela.ts';
import { useTempoReal } from '../../hooks/useTempoReal.ts';
import { usePreCargas } from '../../hooks/usePreCargas.ts';
import { useVizinhanca } from '../../hooks/useVizinhanca.ts';
import { useAbaixoDaDobra } from '../../hooks/useAbaixoDaDobra.ts';
import { useSobDemandaJunto } from '../../hooks/useSobDemandaJunto.ts';
import { useEspacoSemVisual } from '../../hooks/useAlturaMedida.ts';
import { avaliaSaudeQueries } from '../../utils/avisoSaude.ts';
import { dataDaPagina } from '../../utils/filtrosPadrao.ts';
import { segmentacoesDaTela } from '../../utils/segmentacoesDaTela.ts';
import { AppShell } from '../../components/layout/AppShell.tsx';
import { BotaoAtualizar } from '../../components/layout/BotaoAtualizar.tsx';
import { EsqueletoDaPagina } from '../../components/layout/EsqueletoDaPagina.tsx';
import { FaixaDeConferencia } from '../../components/layout/FaixaDeConferencia.tsx';
import {
  BarraDeFiltros,
  EsqueletoDaBarraDeFiltros,
} from '../../components/filtros/BarraDeFiltros.tsx';
import { Capa } from '../../components/capa/Capa.tsx';
import { SemAcesso } from '../../components/auth/SemAcesso.tsx';
import { CHAVE_ACESSOS, GestaoDeAcessos } from '../../components/acessos/GestaoDeAcessos.tsx';
import { chaveDoUso, PERIODOS_DE_USO } from '../../components/acessos/UsoDasTelas.tsx';
import { Aviso, Erro } from '../../components/ui/Cartao.tsx';
import { KpiGridSection } from '../../components/visuais/KpiGridSection.tsx';
import { VisualGridSection } from '../../components/visuais/VisualGridSection.tsx';
import { Esqueleto, MensagemDeEstado } from '../../components/ui/Estado.tsx';

/** A aba PERMISSÕES na URL (`?pagina=permissoes`). Não é tela do relatório: não tem
 *  layout, filtro nem snapshot, e só admin/dev a recebe na faixa. */
const ABA_PERMISSOES = 'permissoes';

export function DashboardPage() {
  const qc = useQueryClient();
  const { conferencia } = useModo();
  const expirou = useSessaoStore((s) => s.expirou);
  const {
    atual,
    filtros,
    clicados,
    invalidos,
    escolhe,
    iniciaEm,
    mudaFiltro,
    aoFiltrarAlvos,
    limpaFiltros,
  } = useEstadoDaTela();
  const naGestao = atual === ABA_PERMISSOES;
  // A página cujo DADO a tela busca: nenhuma na PERMISSÕES — layout, abertura, tempo real
  // e pré-carga ficam parados enquanto ela está aberta.
  const paginaDoDado = naGestao ? null : atual;

  // **O estado do servidor mora no React Query** (fase 2): a lista de páginas, a forma
  // de cada uma, a abertura e a saúde. Ver `hooks/useDadosDaTela.ts`.
  const dashboardsQ = useDashboards();
  const paginas = useMemo(() => dashboardsQ.data ?? [], [dashboardsQ.data]);
  const layoutQ = useLayout(paginaDoDado);
  const layout = layoutQ.data ?? null;
  const paginaQ = usePaginaAberta(paginaDoDado, layoutQ.data, filtros, clicados);
  const saude = useSaude().data ?? null;
  const eu = useEu().data ?? null;
  const pendentes = useRascunhoDeAcessos((s) => s.pendentes);
  // A lista já vem só com as abas desta conta (`permissoes.ts`, filtrado no servidor).
  // `null` enquanto ela não chegou: até lá, uma aba da URL pode ser uma que a conta não abre.
  // A PERMISSÕES não está na lista: vale para quem pode gerir.
  const atualLiberada = dashboardsQ.data
    ? naGestao
      ? eu?.podeGerir === true
      : paginas.some((p) => p.id === atual)
    : null;

  // A matriz chega antes do clique na aba (`feedback-tudo-pre-carregado`) — só para quem
  // a vê; para os outros o servidor responderia 403.
  useEffect(() => {
    if (!eu?.podeGerir) return;
    void qc.prefetchQuery({ queryKey: CHAVE_ACESSOS, queryFn: pegaMatriz });
    // Os três períodos do cartão "Uso das abas": trocar o seletor não mostra "Lendo…".
    for (const dias of PERIODOS_DE_USO) {
      void qc.prefetchQuery({ queryKey: chaveDoUso(dias), queryFn: () => pegaUsoDasTelas(dias) });
    }
  }, [eu?.podeGerir, qc]);

  // Só a troca efetiva de aba dispara isto. Filtro, prefetch e aquecimento não alteram
  // `paginaDoDado`; a API ainda aplica as exclusões e a deduplicação de 30 minutos.
  useEffect(() => {
    if (paginaDoDado && atualLiberada === true) registraAberturaDeAba(paginaDoDado);
  }, [paginaDoDado, atualLiberada]);

  // Alteração de permissão por salvar não some calada num recarregar ou fechar de aba
  // do navegador. Trocar de aba DENTRO do relatório não perde nada (o rascunho mora na
  // store) — por isso não pergunta.
  useEffect(() => {
    if (pendentes === 0) return;
    const segura = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', segura);
    return () => window.removeEventListener('beforeunload', segura);
  }, [pendentes]);
  // Erro que a tela mostra: o de sessão vira login (no `QueryCache`), e pedido
  // cancelado não é erro — é o pedido seguinte fazendo o trabalho certo. O 403 de uma
  // aba fora da lista também não: o efeito abaixo leva para uma aba liberada.
  const erroDeConsulta = [dashboardsQ.error, layoutQ.error, paginaQ.error].find(
    (e) =>
      e && !ehErroDeSessao(e) && !ehAbortError(e) && !(ehErroDeAcesso(e) && atualLiberada !== true),
  );
  const erro = erroDeConsulta
    ? erroDeConsulta instanceof Error
      ? erroDeConsulta.message
      : String(erroDeConsulta)
    : null;

  const { horaRealtime, atualiza } = useTempoReal(paginaDoDado);
  const { prefetchaPagina, cancelaPrefetch, aoPreverAlvos, aoPreverFiltro, aoPreverLimpeza } =
    usePreCargas(paginaDoDado, layout, filtros, clicados);

  // A página inicial, quando a URL não trouxe uma: a primeira pronta da lista.
  useEffect(() => {
    const lista = dashboardsQ.data;
    if (!lista || atual) return;
    const escolhida = lista.find((d) => d.pronta)?.id ?? lista[0]?.id;
    if (escolhida) iniciaEm(escolhida);
  }, [dashboardsQ.data, atual, iniciaEm]);

  // A URL trouxe uma aba que esta conta não abre (link compartilhado, favorito antigo):
  // vai para a primeira liberada. Quem barra o dado é o 403 do servidor; isto é só não
  // deixar a pessoa parada diante dele.
  useEffect(() => {
    if (atualLiberada !== false || !atual) return;
    const destino = paginas.find((d) => d.pronta)?.id ?? paginas[0]?.id;
    if (destino) escolhe(destino);
  }, [atualLiberada, atual, paginas, escolhe]);

  // A abertura de OUTRA página nunca é mostrada como se fosse desta (o
  // `placeholderData` mantém a anterior na tela enquanto a nova chega).
  const pagina = paginaQ.data ?? null;
  const paginaValida = pagina && pagina.id === paginaDoDado ? pagina : null;
  const visuais = paginaValida?.visuais ?? [];
  const dataDaTela = dataDaPagina(paginaDoDado);
  // Do LAYOUT, não do dado: o layout chega antes do cálculo, e trocar para uma página fora
  // do cache deixava a barra só com "Período" até a página chegar — aí ela crescia uma
  // linha e empurrava os cards. `visuais` fica para API antiga, sem `segmentacoes`.
  const segmentacoes = segmentacoesDaTela(layout?.segmentacoes ?? visuais, dataDaTela, filtros);

  // Os visuais caros saem junto com a abertura no clique, não depois dela. A lista vem
  // da resposta desta página que está na tela (a anterior, enquanto a nova chega).
  useSobDemandaJunto(paginaDoDado, filtros, clicados, idsSobDemanda(paginaValida));

  // O resto da página ESTE recorte, logo depois da abertura: quem rola até o fim não
  // encontra esqueleto. Antes da vizinhança, que espera a página parar 2 s.
  useAbaixoDaDobra(
    paginaDoDado,
    layout,
    filtros,
    clicados,
    paginaValida !== null && !paginaQ.isPlaceholderData && !paginaQ.isFetching,
  );

  // Os estados a um clique de filtro deste, pré-carregados enquanto a pessoa lê — os
  // chips primeiro, que são o clique mais provável (ACHADOS #179).
  useVizinhanca(
    paginaDoDado,
    layout,
    filtros,
    clicados,
    [
      ...(segmentacoes.chips ? [segmentacoes.chips] : []),
      ...segmentacoes.dropdowns.map((d) => d.spec),
    ],
    paginaValida !== null && !paginaQ.isPlaceholderData && !paginaQ.isFetching,
  );

  // E `--util` também precisa descontar o que a página gasta e NÃO é card: a faixa de
  // indicadores, o título de seção antes da primeira faixa (`--h-antes`) e o outro
  // título, entre as duas faixas (`--h-entre`). Ver `useEspacoSemVisual`.
  const antesDosVisuaisRef = useEspacoSemVisual<HTMLDivElement>('--h-antes', '--h-entre');

  const nome = naGestao
    ? 'Permissões'
    : (paginas.find((p) => p.id === atual)?.nome ?? 'Instalação');
  // Avaliação de saúde das queries do snapshot (Marco A6): monitora atraso e falhas por query.
  // Na PERMISSÕES não há dado de snapshot para avisar.
  const avisoSaude = naGestao
    ? undefined
    : avaliaSaudeQueries(saude?.refresh?.queries, paginaValida?.dadoDe);

  // Logado, mas nenhuma aba liberada — o acesso nega por padrão (`permissoes.ts`).
  if (dashboardsQ.data && paginas.length === 0) {
    return (
      <SemAcesso usuario={eu?.usuario ?? null} aoSair={() => void sai().finally(() => expirou())} />
    );
  }

  return (
    <AppShell
      paginas={paginas}
      atual={atual}
      aoEscolher={escolhe}
      aoPassarMouse={prefetchaPagina}
      aoSairDoMouse={cancelaPrefetch}
      // Só admin/dev vê a aba; quem barra de verdade é o 403 de /api/admin/acessos.
      abaExtra={
        eu?.podeGerir ? { id: ABA_PERMISSOES, rotulo: 'Permissões', marca: pendentes } : undefined
      }
      aoSair={() => {
        sai().finally(() => expirou());
      }}
      titulo={nome}
      usuario={eu?.usuario}
      nome={eu?.nome}
      foto={eu?.foto}
      dadoDe={paginaValida?.dadoDe ?? null}
      avisoSaude={avisoSaude}
      ultimaAtualizacaoRealtime={horaRealtime}
      barra={
        paginaDoDado ? (
          layoutQ.isLoading ? (
            <EsqueletoDaBarraDeFiltros />
          ) : (
            <BarraDeFiltros
              pagina={paginaDoDado}
              filtros={filtros}
              dataDaTela={dataDaTela}
              segmentacoes={segmentacoes}
              aoMudar={mudaFiltro}
              aoPrever={aoPreverFiltro}
              aoLimpar={limpaFiltros}
              aoPreverLimpeza={aoPreverLimpeza}
            />
          )
        ) : null
      }
      acoes={
        <BotaoAtualizar
          aoClicar={atualiza}
          desligado={!paginaDoDado}
          buscando={paginaQ.isFetching}
        />
      }
    >
      {invalidos.length > 0 ? (
        <Aviso>
          {invalidos.length} filtro(s) da URL foram ignorados: {invalidos.join(' | ')}
        </Aviso>
      ) : null}

      {erro ? <Erro>{erro}</Erro> : null}

      {naGestao ? (
        // A PERMISSÕES dentro do mesmo nó medido: a matriz é um cartão `matriz`, e a
        // altura dele sai de `--util`, que desconta o `--h-antes` medido aqui.
        <div ref={antesDosVisuaisRef} className="flex flex-col gap-[var(--gap)]">
          <GestaoDeAcessos />
        </div>
      ) : (
        <>
          {conferencia && paginaValida ? (
            <FaixaDeConferencia pagina={paginaValida} filtros={filtros} />
          ) : null}

          {atual !== null && !paginaValida && !erro ? (
            layout ? (
              <EsqueletoDaPagina layout={layout} />
            ) : (
              // Janela residual em que nem `layout` chegou ainda — tipicamente um
              // sub-frame (Fase L4: o endpoint é um mapa em memória). Sem a forma real
              // ainda para copiar, o bloco genérico de antes é o fallback.
              <Esqueleto />
            )
          ) : null}

          {/* A CAPA é a única tela escrita à mão, e o motivo é medido: das 30 formas que a
            spec traz para ela, 28 não têm número — a tela gerada renderizava DOIS cartões
            de indicador num vazio. Os dois KPIs são dado de verdade e continuam na tela,
            como selo da faixa da capa. */}
          {atual === 'capa' ? (
            <Capa
              dadoDe={paginaValida?.dadoDe ?? null}
              saude={saude}
              telas={paginas.length}
              visuais={visuais}
            />
          ) : (
            <KpiGridSection layout={layout} visuais={visuais} />
          )}

          {/* O `div` existe para medir: é dele que sai `--h-antes`, a distância do topo do
            conteúdo até o primeiro card. Ele não tem estilo — a grade continua sendo a do
            `VisualGridSection`. */}
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

          {paginaValida && visuais.every((v) => v.conteudo === null) ? (
            <MensagemDeEstado como="div">Esta página não tem visual com número.</MensagemDeEstado>
          ) : null}
        </>
      )}
    </AppShell>
  );
}
