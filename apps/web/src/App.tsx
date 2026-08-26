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
import { Erro } from './componentes/Cartao.tsx';
import { Segmentacao } from './componentes/Segmentacao.tsx';
import { usaModo } from './modo.tsx';
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

      {segmentacoes.length > 0 ? (
        <div className="filtros">
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
