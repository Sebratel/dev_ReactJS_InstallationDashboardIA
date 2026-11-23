// A página do dashboard: compõe o estado da tela (URL), os dados (React Query), o tempo
// real e os pré-carregamentos, e desenha o AppShell com a barra de filtros e os visuais.
//
// Fina de propósito (fase 3 de `docs/PLANO-PADROES-FRONTEND.md`): a lógica mora nos
// hooks — `useEstadoDaTela` (o que a URL diz e o que cada clique faz com ela),
// `useDadosDaTela` (o que o servidor responde), `useTempoReal` (quando buscar de novo),
// `usePreCargas` e `useVizinhanca` (o que adiantar) —, e os pedaços da tela são
// componentes.
//
// **O que a aba É decide todo o resto**, e isso é uma pergunta só: `classificaAba`
// (`utils/abaDaTela.ts`). Antes eram quatro booleanos soltos e três cascatas de
// ternários aninhados — uma para o acesso, uma para o título, uma para o conteúdo —, e
// toda aba nova pedia um ternário a mais em cada uma das três.

import { useMemo, type ReactNode } from 'react';
import { MapPin, Settings, TrendingUp } from 'lucide-react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { CHAVE_INSIGHTS } from '../../services/insightsService.ts';
import { registraAberturaDeAba } from '../../services/dashboardService.ts';
import { sai } from '../../services/authService.ts';
import { useSessaoStore } from '../../store/sessaoStore.ts';
import { useRascunhoDeAcessos } from '../../store/rascunhoDeAcessosStore.ts';
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
import { useAcessosAoVivo } from '../../hooks/useAcessosAoVivo.ts';
import { useAbaPadrao } from '../../hooks/useAbaPadrao.ts';
import { usePreCargaDeAcessos } from '../../hooks/usePreCargaDeAcessos.ts';
import { useAvisoDeAlteracaoNaoSalva } from '../../hooks/useAvisoDeAlteracaoNaoSalva.ts';
import { useRegistroDeAbertura } from '../../hooks/useRegistroDeAbertura.ts';
import {
  ABA_OPERACAO,
  ABA_PERMISSOES,
  ABA_PREVISOES,
  abaLiberada,
  classificaAba,
  ehAbaDoRelatorio,
  tituloDaAba,
} from '../../utils/abaDaTela.ts';
import { mensagemDeErroDaTela } from '../../utils/erroDaTela.ts';
import { avaliaSaudeQueries } from '../../utils/avisoSaude.ts';
import { dataDaPagina } from '../../utils/filtrosPadrao.ts';
import { segmentacoesDaTela } from '../../utils/segmentacoesDaTela.ts';
import { AppShell } from '../../components/layout/AppShell.tsx';
import { BotaoAtualizar } from '../../components/layout/BotaoAtualizar.tsx';
import {
  BarraDeFiltros,
  EsqueletoDaBarraDeFiltros,
} from '../../components/filtros/BarraDeFiltros.tsx';
import { SemAcesso } from '../../components/auth/SemAcesso.tsx';
import { Aviso, Erro } from '../../components/ui/Cartao.tsx';
import { ConteudoDoRelatorio } from './ConteudoDoRelatorio.tsx';
import { ConteudoForaDoRelatorio } from './ConteudoForaDoRelatorio.tsx';

const ICONE_DA_ABA: Record<string, ReactNode> = {
  [ABA_OPERACAO]: <MapPin size={13} aria-hidden />,
  [ABA_PREVISOES]: <TrendingUp size={13} aria-hidden />,
};

export function DashboardPage() {
  const clienteDeConsultas = useQueryClient();
  const { conferencia } = useModo();
  const expirou = useSessaoStore((sessao) => sessao.expirou);
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

  const especieDaAba = classificaAba(atual);
  const noRelatorio = ehAbaDoRelatorio(especieDaAba);
  // A página cujo DADO a tela busca: nenhuma fora do relatório — layout, abertura, tempo
  // real e pré-carga ficam parados enquanto uma aba dessas está aberta.
  const paginaDoDado = noRelatorio ? atual : null;
  const buscandoInsights = useIsFetching({ queryKey: CHAVE_INSIGHTS }) > 0;

  // **O estado do servidor mora no React Query** (fase 2): a lista de páginas, a forma
  // de cada uma, a abertura e a saúde. Ver `hooks/useDadosDaTela.ts`.
  const dashboardsQ = useDashboards();
  // Menu, aba Configurações e cache seguem os acessos desta conta sem F5.
  useAcessosAoVivo();
  const paginas = useMemo(() => dashboardsQ.data ?? [], [dashboardsQ.data]);
  const layoutQ = useLayout(paginaDoDado);
  const layout = layoutQ.data ?? null;
  const paginaQ = usePaginaAberta(paginaDoDado, layoutQ.data, filtros, clicados);
  const saude = useSaude().data ?? null;
  const usuarioAtual = useEu().data ?? null;
  const pendentes = useRascunhoDeAcessos((rascunho) => rascunho.pendentes);
  const podeGerir = usuarioAtual?.podeGerir === true;

  // As abas fora do relatório, na ordem em que aparecem à direita da faixa. A de
  // Configurações sai do papel (admin/dev) e vai por ÚLTIMO, encostada na direita, com a
  // engrenagem; as outras saem do servidor, que já aplicou o acesso por aba. O id dela na
  // URL continua `permissoes`: link e favorito antigos seguem abrindo a mesma tela.
  const abasExtras = useMemo(
    () => [
      ...(usuarioAtual?.abasExtras ?? []).map((aba) => ({
        id: aba.id,
        rotulo: aba.nome,
        ...(ICONE_DA_ABA[aba.id] ? { icone: ICONE_DA_ABA[aba.id] } : {}),
      })),
      ...(usuarioAtual?.podeGerir
        ? [
            {
              id: ABA_PERMISSOES,
              rotulo: 'Configurações',
              marca: pendentes,
              icone: <Settings size={13} aria-hidden />,
            },
          ]
        : []),
    ],
    [usuarioAtual?.podeGerir, usuarioAtual?.abasExtras, pendentes],
  );

  const liberada = abaLiberada(especieDaAba, {
    listaDePaginasChegou: dashboardsQ.data !== undefined,
    podeGerir,
    paginasDoRelatorio: paginas,
    abasExtras,
    abaAberta: atual,
  });

  // A matriz de acessos chega antes do clique na aba; a aba que a conta não abre leva a
  // uma liberada; e permissão por salvar não some num fechar de janela.
  usePreCargaDeAcessos(podeGerir);
  useRegistroDeAbertura(paginaDoDado, liberada, registraAberturaDeAba);
  useAvisoDeAlteracaoNaoSalva(pendentes);
  useAbaPadrao({
    abaAberta: atual,
    paginasDisponiveis: dashboardsQ.data,
    liberada,
    iniciaEm,
    escolhe,
  });

  const erro = mensagemDeErroDaTela([dashboardsQ.error, layoutQ.error, paginaQ.error], liberada);

  const { horaRealtime, atualiza } = useTempoReal(paginaDoDado);
  const { prefetchaPagina, cancelaPrefetch, aoPreverAlvos, aoPreverFiltro, aoPreverLimpeza } =
    usePreCargas(paginaDoDado, layout, filtros, clicados);

  // A abertura de OUTRA página nunca é mostrada como se fosse desta (o
  // `placeholderData` mantém a anterior na tela enquanto a nova chega).
  const paginaRecebida = paginaQ.data ?? null;
  const paginaCalculada =
    paginaRecebida && paginaRecebida.id === paginaDoDado ? paginaRecebida : null;
  const visuais = paginaCalculada?.visuais ?? [];
  const dataDaTela = dataDaPagina(paginaDoDado);
  // Do LAYOUT, não do dado: o layout chega antes do cálculo, e trocar para uma página fora
  // do cache deixava a barra só com "Período" até a página chegar — aí ela crescia uma
  // linha e empurrava os cards. `visuais` fica para API antiga, sem `segmentacoes`.
  const segmentacoes = segmentacoesDaTela(layout?.segmentacoes ?? visuais, dataDaTela, filtros);
  // A página parou de mexer: nada de placeholder nem de busca em curso. É a condição
  // para adiantar o que está fora da dobra e a vizinhança de um clique.
  const paginaAssentada =
    paginaCalculada !== null && !paginaQ.isPlaceholderData && !paginaQ.isFetching;

  // Os visuais caros saem junto com a abertura no clique, não depois dela. A lista vem
  // da resposta desta página que está na tela (a anterior, enquanto a nova chega).
  useSobDemandaJunto(paginaDoDado, filtros, clicados, idsSobDemanda(paginaCalculada));

  // O resto da página ESTE recorte, logo depois da abertura: quem rola até o fim não
  // encontra esqueleto. Antes da vizinhança, que espera a página parar 2 s.
  useAbaixoDaDobra(paginaDoDado, layout, filtros, clicados, paginaAssentada);

  // Os estados a um clique de filtro deste, pré-carregados enquanto a pessoa lê — os
  // chips primeiro, que são o clique mais provável (ACHADOS #179).
  useVizinhanca(
    paginaDoDado,
    layout,
    filtros,
    clicados,
    [
      ...(segmentacoes.chips ? [segmentacoes.chips] : []),
      ...segmentacoes.dropdowns.map((dropdown) => dropdown.spec),
    ],
    paginaAssentada,
  );

  // E `--util` também precisa descontar o que a página gasta e NÃO é card: a faixa de
  // indicadores, o título de seção antes da primeira faixa (`--h-antes`) e o outro
  // título, entre as duas faixas (`--h-entre`). Ver `useEspacoSemVisual`.
  const antesDosVisuaisRef = useEspacoSemVisual<HTMLDivElement>('--h-antes', '--h-entre');

  const titulo = tituloDaAba(especieDaAba, {
    paginasDoRelatorio: paginas,
    abasExtras,
    abaAberta: atual,
  });
  // Avaliação de saúde das queries do snapshot (Marco A6): monitora atraso e falhas por
  // query. Fora do relatório não há dado de snapshot para avisar.
  const avisoSaude = noRelatorio
    ? avaliaSaudeQueries(saude?.refresh?.queries, paginaCalculada?.dadoDe)
    : undefined;

  const encerraSessao = () => {
    void sai().finally(() => expirou());
  };

  // Logado, mas nenhuma aba liberada — o acesso nega por padrão (`permissoes.ts`).
  if (dashboardsQ.data && paginas.length === 0) {
    return <SemAcesso usuario={usuarioAtual?.usuario ?? null} aoSair={encerraSessao} />;
  }

  return (
    <AppShell
      paginas={paginas}
      atual={atual}
      aoEscolher={escolhe}
      aoPassarMouse={prefetchaPagina}
      aoSairDoMouse={cancelaPrefetch}
      // Quem barra de verdade é o 403 do servidor (/api/admin/acessos, /api/admin/metas);
      // a faixa só esconde o que a conta não abre.
      abasExtras={abasExtras}
      aoSair={encerraSessao}
      titulo={titulo}
      usuario={usuarioAtual?.usuario}
      nome={usuarioAtual?.nome}
      foto={usuarioAtual?.foto}
      dadoDe={paginaCalculada?.dadoDe ?? null}
      avisoSaude={avisoSaude}
      ultimaAtualizacaoRealtime={horaRealtime}
      barra={
        <BarraDaTela
          pagina={paginaDoDado}
          carregandoLayout={layoutQ.isLoading}
          filtros={filtros}
          dataDaTela={dataDaTela}
          segmentacoes={segmentacoes}
          aoMudar={mudaFiltro}
          aoPrever={aoPreverFiltro}
          aoLimpar={limpaFiltros}
          aoPreverLimpeza={aoPreverLimpeza}
        />
      }
      acoes={
        especieDaAba === 'insights' ? (
          <BotaoAtualizar
            aoClicar={() => void clienteDeConsultas.invalidateQueries({ queryKey: CHAVE_INSIGHTS })}
            desligado={false}
            buscando={buscandoInsights}
          />
        ) : (
          <BotaoAtualizar
            aoClicar={atualiza}
            desligado={!paginaDoDado}
            buscando={paginaQ.isFetching}
          />
        )
      }
    >
      {invalidos.length > 0 ? (
        <Aviso>
          {invalidos.length} filtro(s) da URL foram ignorados: {invalidos.join(' | ')}
        </Aviso>
      ) : null}

      {erro ? <Erro>{erro}</Erro> : null}

      {noRelatorio ? (
        <ConteudoDoRelatorio
          abaAberta={atual ?? ''}
          paginaCalculada={paginaCalculada}
          layout={layout}
          visuais={visuais}
          filtros={filtros}
          clicados={clicados}
          saude={saude}
          quantidadeDeTelas={paginas.length}
          emConferencia={conferencia}
          temErro={erro !== null}
          aoFiltrarAlvos={aoFiltrarAlvos}
          aoPreverAlvos={aoPreverAlvos}
          refDoEspacoAntesDosVisuais={antesDosVisuaisRef}
        />
      ) : (
        <ConteudoForaDoRelatorio
          especie={especieDaAba}
          abaAberta={atual}
          titulo={titulo}
          refDoEspacoAntesDosVisuais={antesDosVisuaisRef}
        />
      )}
    </AppShell>
  );
}

/**
 * A barra de filtros da aba aberta: nada fora do relatório, e esqueleto enquanto o
 * layout não chegou — sem ele a barra nasceria só com "Período" e cresceria uma linha
 * depois, empurrando os cards.
 */
function BarraDaTela({
  pagina,
  carregandoLayout,
  ...resto
}: {
  pagina: string | null;
  carregandoLayout: boolean;
} & Omit<Parameters<typeof BarraDeFiltros>[0], 'pagina'>) {
  if (!pagina) return null;
  if (carregandoLayout) return <EsqueletoDaBarraDeFiltros />;
  return <BarraDeFiltros pagina={pagina} {...resto} />;
}
