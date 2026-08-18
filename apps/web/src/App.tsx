// A tela: escolhe a página, aplica as segmentações e desenha os visuais.

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
import { Visual } from './componentes/Visual.tsx';

export function App() {
  const inicial = useMemo(() => leRota(window.location.search), []);
  const [paginas, setPaginas] = useState<DashboardDaLista[]>([]);
  const [atual, setAtual] = useState<string | null>(inicial.pagina);
  const [filtros, setFiltros] = useState<FiltroDaTela[]>(inicial.filtros);
  const [pagina, setPagina] = useState<PaginaCalculada | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // A lista, uma vez. A primeira página pronta é a inicial quando a URL não diz qual.
  useEffect(() => {
    listaDashboards()
      .then((r) => {
        setPaginas(r.dashboards);
        setAtual((a) => a ?? r.dashboards.find((d) => d.pronta)?.id ?? r.dashboards[0]?.id ?? null);
      })
      .catch((err: unknown) => setErro(err instanceof Error ? err.message : String(err)));
  }, []);

  // Realtime EventSource (SSE): ativado via Kafka/CDC em tempo real
  useEffect(() => {
    if (!atual) return;
    const es = new EventSource('/api/realtime');
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { tipo?: string };
        if (data.tipo === 'invalida') {
          pegaPagina(atual, filtros)
            .then((p) => setPagina(p))
            .catch(() => {});
        }
      } catch {
        // ignora mensagens fora do formato
      }
    };
    return () => es.close();
  }, [atual, filtros]);

  // Página ou filtro mudou: pede de novo, e escreve o estado na URL.
  //
  // `cancelado` não é zelo abstrato. Uma página fria leva segundos; trocar de página
  // enquanto a anterior carrega faria a resposta antiga chegar depois e sobrescrever a
  // nova — a tela mostraria os números de uma página com o nome da outra.
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

  const segmentacoes = (pagina?.visuais ?? []).filter((v) => v.segmentacao);
  const cards = (pagina?.visuais ?? []).filter((v) => v.conteudo === 'card' && !v.erro);
  const blocos = (pagina?.visuais ?? []).filter(
    (v) => v.sobDemanda || v.erro || (v.conteudo && v.conteudo !== 'card'),
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
        <div className="grupo-acoes-cabecalho">
          <span className="selo-realtime" title="Conectado ao fluxo de eventos em tempo real via Kafka/Debezium">
            🟢 Realtime CDC
          </span>
        </div>
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

      {filtros.length > 0 ? (
        <div className="painel-filtros-ativos">
          <div className="cabecalho-filtros-ativos">
            <span className="titulo-filtros-ativos">🏷️ Filtros Ativos ({filtros.length}):</span>
            <button className="secundario btn-limpar-tudo" onClick={() => setFiltros([])}>
              🧹 Limpar Todos os Filtros
            </button>
          </div>
          <div className="lista-pills">
            {filtros.map((f) => (
              <span key={`${f.tabela}-${f.coluna}-${f.nivel ?? ''}`} className="pill-filtro">
                <span className="pill-rotulo">{f.coluna}{f.nivel ? `.${f.nivel}` : ''}:</span>
                <span className="pill-valores">
                  {f.valores.map((v) => (v === null ? '(vazio)' : String(v))).join(', ')}
                </span>
                <button
                  className="btn-remover-pill"
                  title="Remover este filtro"
                  onClick={() => mudaFiltro(f.tabela, f.coluna, [], f.nivel)}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {pagina ? (
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

      {cards.length > 0 ? (
        <div className="kpis">
          {cards.map((v) => (
            <Visual
              key={v.id}
              pagina={atual!}
              visual={v}
              filtros={filtros}
              aoFiltrar={(t, c, val) => mudaFiltro(t, c, [val])}
            />
          ))}
        </div>
      ) : null}

      {blocos.map((v) => (
        <Visual
          key={v.id}
          pagina={atual!}
          visual={v}
          filtros={filtros}
          aoFiltrar={(t, c, val) => mudaFiltro(t, c, [val])}
        />
      ))}

      {pagina && cards.length === 0 && blocos.length === 0 ? (
        <div className="vazio-pagina">Esta página não tem visual com número.</div>
      ) : null}
    </AppShell>
  );
}
