// A tela: escolhe a página, aplica as segmentações e desenha os visuais em formato Dashboard Sebratel.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listaDashboards,
  pegaPagina,
  type DashboardDaLista,
  type FiltroDaTela,
  type PaginaCalculada,
  type Valor,
} from './api.ts';
import { dataHora, duracao, inteiro } from './formato.ts';
import { aplicaSelecao, escreveRota, leRota, selecaoDe } from './rota.ts';
import { AppShell } from './componentes/AppShell.tsx';
import { Capa } from './componentes/Capa.tsx';
import { Erro } from './componentes/Cartao.tsx';
import { Segmentacao } from './componentes/Segmentacao.tsx';
import { usaModo } from './modo.tsx';
import { ActiveFilterPill } from './atomic/molecules/ActiveFilterPill.tsx';
import { KpiGridSection } from './atomic/organisms/KpiGridSection.tsx';
import { VisualGridSection } from './atomic/organisms/VisualGridSection.tsx';

export function App() {
  const { conferencia } = usaModo();
  const inicial = useMemo(() => leRota(window.location.search), []);
  const [paginas, setPaginas] = useState<DashboardDaLista[]>([]);
  const [atual, setAtual] = useState<string | null>(inicial.pagina);
  const [filtros, setFiltros] = useState<FiltroDaTela[]>(inicial.filtros);
  const [pagina, setPagina] = useState<PaginaCalculada | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    listaDashboards()
      .then((r) => {
        setPaginas(r.dashboards);
        setAtual((a) => a ?? r.dashboards.find((d) => d.pronta)?.id ?? r.dashboards[0]?.id ?? null);
      })
      .catch((err: unknown) => setErro(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!atual) return;
    let cancelado = false;

    setCarregando(true);
    setErro(null);
    window.history.replaceState(null, '', escreveRota(atual, filtros));

    pegaPagina(atual, filtros)
      .then((p) => {
        if (!cancelado) setPagina(p);
      })
      .catch((err: unknown) => {
        if (!cancelado) {
          setPagina(null);
          setErro(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [atual, filtros]);

  const escolhe = useCallback((id: string) => {
    setAtual(id);
    setFiltros([]);
    setPagina(null);
  }, []);

  const mudaFiltro = useCallback(
    (tabela: string, coluna: string, valores: Valor[], nivel?: string) => {
      setFiltros((f) => aplicaSelecao(f, tabela, coluna, valores, nivel));
    },
    [],
  );

  const aoFiltrarValor = useCallback(
    (tabela: string, coluna: string, valor: Valor) => {
      mudaFiltro(tabela, coluna, valor === null ? [] : [valor]);
    },
    [mudaFiltro],
  );

  const segmentacoes = (pagina?.visuais ?? []).filter((v) => v.segmentacao);

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
  const filtrosOcultos = filtros.filter(
    (f) => f.valores.length > 0 && !comSlicer.has(`${f.tabela}.${f.coluna}.${f.nivel ?? ''}`),
  );
  const cards = (pagina?.visuais ?? []).filter((v) => v.conteudo === 'card' && !v.erro);
  const graficos = (pagina?.visuais ?? []).filter((v) => v.conteudo === 'grafico');
  const matrizes = (pagina?.visuais ?? []).filter((v) => v.conteudo === 'matriz');
  const tabelasEBlocos = (pagina?.visuais ?? []).filter(
    (v) => v.sobDemanda || v.erro || (v.conteudo && v.conteudo !== 'card' && v.conteudo !== 'grafico' && v.conteudo !== 'matriz'),
  );

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

      {segmentacoes.length > 0 || filtrosOcultos.length > 0 ? (
        <div className="filtros">
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
        <div className="esqueleto">
          <div className="esqueleto-linha" />
          <div className="esqueleto-linha" />
          <div className="esqueleto-linha" />
        </div>
      ) : null}

      {/* A CAPA é a única tela escrita à mão, e o motivo é medido: das 30 formas
          que a spec traz para ela, 28 não têm número — a tela gerada renderizava
          DOIS cartões de indicador num vazio. O componente que a substitui existia
          desde 26/08 e nunca foi importado; os dois KPIs continuam abaixo, porque
          são dado de verdade. */}
      {atual === 'capa' ? <Capa dadoDe={pagina?.dadoDe ?? null} /> : null}

      {/* Faixa de KPIs em Grid Responsivo */}
      <KpiGridSection pagina={atual!} cards={cards} filtros={filtros} aoFiltrar={aoFiltrarValor} />

      {/* Seção de Gráficos, Matrizes e Análise Detalhada */}
      <VisualGridSection
        pagina={atual!}
        graficos={graficos}
        matrizes={matrizes}
        tabelasEBlocos={tabelasEBlocos}
        filtros={filtros}
        aoFiltrar={aoFiltrarValor}
      />

      {pagina && cards.length === 0 && graficos.length === 0 && matrizes.length === 0 && tabelasEBlocos.length === 0 ? (
        <div className="vazio-pagina">Esta página não tem visual com número.</div>
      ) : null}
    </AppShell>
  );
}
