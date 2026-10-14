// A página do dashboard: compõe o estado da tela (URL), os dados (React Query), o tempo
// real e os pré-carregamentos, e desenha o AppShell com a barra de filtros e os visuais.
//
// Fina de propósito (fase 3 de `docs/PLANO-PADROES-FRONTEND.md`): a lógica mora nos
// hooks — `useEstadoDaTela` (o que a URL diz e o que cada clique faz com ela),
// `useDadosDaTela` (o que o servidor responde), `useTempoReal` (quando buscar de novo),
// `usePreCargas` e `useVizinhanca` (o que adiantar) —, e os pedaços da tela são
// componentes.

import { useEffect, useMemo, useState } from 'react';
import { UserCog } from 'lucide-react';
import { ehAbortError, ehErroDeAcesso, ehErroDeSessao } from '../../services/dashboardService.ts';
import { sai } from '../../services/authService.ts';
import { useSessaoStore } from '../../store/sessaoStore.ts';
import { useModo } from '../../context/ModoContext.tsx';
import {
  useDashboards,
  useEu,
  useLayout,
  usePaginaAberta,
  useSaude,
} from '../../hooks/useDadosDaTela.ts';
import { useEstadoDaTela } from '../../hooks/useEstadoDaTela.ts';
import { useTempoReal } from '../../hooks/useTempoReal.ts';
import { usePreCargas } from '../../hooks/usePreCargas.ts';
import { useVizinhanca } from '../../hooks/useVizinhanca.ts';
import { useEspacoSemVisual } from '../../hooks/useAlturaMedida.ts';
import { avaliaSaudeQueries } from '../../utils/avisoSaude.ts';
import { dataDaPagina } from '../../utils/filtrosPadrao.ts';
import { segmentacoesDaTela } from '../../utils/segmentacoesDaTela.ts';
import { AppShell } from '../../components/layout/AppShell.tsx';
import { BotaoAtualizar } from '../../components/layout/BotaoAtualizar.tsx';
import { EsqueletoDaPagina } from '../../components/layout/EsqueletoDaPagina.tsx';
import { FaixaDeConferencia } from '../../components/layout/FaixaDeConferencia.tsx';
import { BarraDeFiltros } from '../../components/filtros/BarraDeFiltros.tsx';
import { Capa } from '../../components/capa/Capa.tsx';
import { SemAcesso } from '../../components/auth/SemAcesso.tsx';
import { GestaoDeAcessos } from '../../components/acessos/GestaoDeAcessos.tsx';
import { BotaoDeIcone } from '../../components/ui/BotaoDeIcone.tsx';
import { Aviso, Erro } from '../../components/ui/Cartao.tsx';
import { KpiGridSection } from '../../components/visuais/KpiGridSection.tsx';
import { VisualGridSection } from '../../components/visuais/VisualGridSection.tsx';
import { Esqueleto, MensagemDeEstado } from '../../components/ui/Estado.tsx';

export function DashboardPage() {
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

  // **O estado do servidor mora no React Query** (fase 2): a lista de páginas, a forma
  // de cada uma, a abertura e a saúde. Ver `hooks/useDadosDaTela.ts`.
  const dashboardsQ = useDashboards();
  const paginas = useMemo(() => dashboardsQ.data ?? [], [dashboardsQ.data]);
  const layoutQ = useLayout(atual);
  const layout = layoutQ.data ?? null;
  const paginaQ = usePaginaAberta(atual, layoutQ.data, filtros, clicados);
  const saude = useSaude().data ?? null;
  const eu = useEu().data ?? null;
  const [gerindo, setGerindo] = useState(false);
  // A lista já vem só com as abas desta conta (`permissoes.ts`, filtrado no servidor).
  // `null` enquanto ela não chegou: até lá, uma aba da URL pode ser uma que a conta não abre.
  const atualLiberada = dashboardsQ.data ? paginas.some((p) => p.id === atual) : null;
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

  const { horaRealtime, atualiza } = useTempoReal(atual);
  const { prefetchaPagina, cancelaPrefetch, aoPreverAlvos, aoPreverFiltro, aoPreverLimpeza } =
    usePreCargas(dashboardsQ.data, atual, layout, filtros, clicados);

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
  const paginaValida = pagina && pagina.id === atual ? pagina : null;
  const visuais = paginaValida?.visuais ?? [];
  const dataDaTela = dataDaPagina(atual);
  const segmentacoes = segmentacoesDaTela(visuais, dataDaTela, filtros);

  // Os estados a um clique de filtro deste, pré-carregados enquanto a pessoa lê — os
  // chips primeiro, que são o clique mais provável (ACHADOS #179).
  useVizinhanca(
    atual,
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

  const nome = paginas.find((p) => p.id === atual)?.nome ?? 'Instalação';
  // Avaliação de saúde das queries do snapshot (Marco A6): monitora atraso e falhas por query.
  const avisoSaude = avaliaSaudeQueries(saude?.refresh?.queries, paginaValida?.dadoDe);

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
      aoSair={() => {
        sai().finally(() => expirou());
      }}
      titulo={nome}
      dadoDe={paginaValida?.dadoDe ?? null}
      avisoSaude={avisoSaude}
      ultimaAtualizacaoRealtime={horaRealtime}
      barra={
        atual ? (
          <BarraDeFiltros
            pagina={atual}
            filtros={filtros}
            dataDaTela={dataDaTela}
            segmentacoes={segmentacoes}
            aoMudar={mudaFiltro}
            aoPrever={aoPreverFiltro}
            aoLimpar={limpaFiltros}
            aoPreverLimpeza={aoPreverLimpeza}
          />
        ) : null
      }
      acoes={
        <>
          {/* Só admin/dev vê o botão; quem barra de verdade é o 403 de /api/admin/acessos. */}
          {eu?.podeGerir ? (
            <BotaoDeIcone
              onClick={() => setGerindo(true)}
              title="Acessos às abas"
              aria-label="Acessos às abas"
            >
              <UserCog size={15} aria-hidden="true" />
            </BotaoDeIcone>
          ) : null}
          <BotaoAtualizar aoClicar={atualiza} desligado={!atual} buscando={paginaQ.isFetching} />
        </>
      }
    >
      {gerindo ? <GestaoDeAcessos aoFechar={() => setGerindo(false)} /> : null}

      {invalidos.length > 0 ? (
        <Aviso>
          {invalidos.length} filtro(s) da URL foram ignorados: {invalidos.join(' | ')}
        </Aviso>
      ) : null}

      {erro ? <Erro>{erro}</Erro> : null}

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
    </AppShell>
  );
}
