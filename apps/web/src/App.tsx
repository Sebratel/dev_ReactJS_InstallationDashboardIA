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
import { usaAlturaMedida } from './altura-medida.ts';
import { dataDaPagina, filtrosPadrao } from './filtros-padrao.ts';
import { aplicaSelecao, escreveRota, leRota, selecaoDe } from './rota.ts';
import { AppShell } from './componentes/AppShell.tsx';
import { Capa } from './componentes/Capa.tsx';
import { Erro } from './componentes/Cartao.tsx';
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
  const [pagina, setPagina] = useState<PaginaCalculada | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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
    setFiltros(filtrosPadrao(id));
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
