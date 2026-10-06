// A tabela de detalhe. O corte é dito, nunca silencioso — e agora é navegável e exportável.
//
// Regras de tabela do padrão de dashboards: cabeçalho na primária, numérico à direita
// com `tabular-nums`, ordenação clicável com indicador de direção, e **barra de dados
// dentro da célula** em vez de um gráfico ao lado — é o que o Power BI faz, e economiza
// um visual inteiro. A barra só aparece onde ela significa magnitude: ver `ehMagnitude`.
// As contas estão em `utils/tabelaDados.ts`; o `<table>`, em `tabela/CorpoDaTabela.tsx`.

import { useEffect, useMemo, useState } from 'react';
import type {
  DadosDeTabela,
  FiltroDaTela,
  Valor,
  VisualCalculado,
} from '../../services/dashboardService.ts';
import { formata } from '../../utils/formato.ts';
import { baixaCsv, textoCsv } from '../../utils/csv.ts';
import { escalasDaTabela, ordenaLinhas } from '../../utils/tabelaDados.ts';
import { Cartao, Erro } from '../ui/Cartao.tsx';
import { Paginacao } from '../ui/Paginacao.tsx';
import { useJanela } from '../../hooks/useJanela.ts';
import { tituloDeTabela } from '../../utils/rotulos.ts';
import { Download } from 'lucide-react';
import { janelaDeServidorPara, LINHAS_VISIVEIS } from '../../utils/janela.ts';
import { selecaoDe, type AoFiltrar } from '../../utils/rota.ts';
import { CorpoDaTabela } from './tabela/CorpoDaTabela.tsx';
import { useOrdemDaTabela } from '../../hooks/useOrdemDaTabela.ts';

/**
 * Quanto o pedido de busca espera depois da última tecla. Sem isto, `1784218` são sete
 * requisições — e as seis primeiras são perguntas que ninguém fez.
 */
const ESPERA_DA_BUSCA_MS = 250;

export function Tabela(props: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
  aoFiltrar?: AoFiltrar;
}) {
  // **Duas velocidades, e por isso dois estados.** `termoBusca` é o que está escrito no
  // campo e acompanha a tecla; `termoAplicado` é o que já virou pedido. A normalização
  // acontece aqui (para `1784218 ` não gastar um pedido) e de novo no servidor (a
  // garantia, porque a URL pode chegar de qualquer lugar).
  const [termoBusca, setTermoBusca] = useState<string>('');
  const [termoAplicado, setTermoAplicado] = useState<string>('');
  useEffect(() => {
    const t = setTimeout(
      () => setTermoAplicado(termoBusca.trim().toLowerCase()),
      ESPERA_DA_BUSCA_MS,
    );
    return () => clearTimeout(t);
  }, [termoBusca]);

  const janela = useJanela(props.pagina, props.visual, props.filtros, termoAplicado);
  const d = janela.visual.dados as DadosDeTabela | undefined;
  const temDados = !!d && !!d.colunas && !!d.linhas;
  const colunas = useMemo(() => (temDados ? d!.colunas : []), [temDados, d]);
  const linhas = useMemo(() => (temDados ? d!.linhas : []), [temDados, d]);

  // TODOS os hooks antes do `return` de "sem dados" (fase 4): eles estavam depois dele,
  // e uma tabela que perdesse os dados entre dois quadros derrubaria a árvore.

  const colunaDataPadrao = useMemo(() => colunas.findIndex((c) => c.tipo === 'date'), [colunas]);
  const ordem = useOrdemDaTabela(colunaDataPadrao);
  const colOrdenada = ordem.coluna;
  const ordemDesc = ordem.desc;

  // **Só ordena.** A busca saiu daqui em 16/09/2026 e foi para o servidor (`janelaDe`/
  // `casaComTermo`): peneirar as 200 linhas da janela baixada não é buscar.
  const ordenadas = useMemo(
    () => ordenaLinhas(linhas, colOrdenada, ordemDesc),
    [linhas, colOrdenada, ordemDesc],
  );
  const escalas = useMemo(() => escalasDaTabela(colunas, linhas), [colunas, linhas]);

  /* A JANELA DE 20 LINHAS. `useJanela` traz 200 do servidor; a tela desenha 20 por vez.
     Virar página DENTRO das 200 é instantâneo e não custa requisição — só ao sair delas
     se busca a fatia seguinte. A ANÁLISE DETALHADA ficou 10x mais curta e com MENOS
     pedidos. */
  const [inicioLocal, setInicioLocal] = useState(0);
  // Buscar ou ordenar refaz o conjunto; continuar na página 7 mostraria o vazio. Comparar
  // a "âncora" durante a renderização volta ao início sem o quadro em branco de um efeito.
  const ancora = `${d?.de}|${termoAplicado}|${String(colOrdenada)}|${String(ordemDesc)}`;
  const [ancoraAnterior, setAncoraAnterior] = useState(ancora);
  if (ancoraAnterior !== ancora) {
    setAncoraAnterior(ancora);
    setInicioLocal(0);
  }

  if (!d || !d.colunas || !d.linhas) {
    return (
      <Cartao
        titulo={tituloDeTabela(props.visual, d?.colunas ?? [])}
        id={props.visual.id}
        altura="tabela"
      >
        <p className="sob-demanda">Sem dados disponíveis para a tabela.</p>
      </Cartao>
    );
  }

  const filtrando = ordem.foraDoPadrao;

  const totalLocal = ordenadas.length;
  const inicio = Math.min(inicioLocal, Math.max(0, totalLocal - 1));
  const visiveis = ordenadas.slice(inicio, inicio + LINHAS_VISIVEIS);

  // Filtrando, a paginação é sobre o universo local. Sem filtro, ela é sobre a consulta
  // inteira — e aí `de` é o índice GLOBAL da primeira linha.
  const estado = filtrando
    ? { de: inicio, mostradas: visiveis.length, total: totalLocal }
    : {
        de: d.de + inicio,
        mostradas: visiveis.length,
        total: d.linhasTotais,
        totalSemBusca: d.totalSemBusca,
      };

  /** Recebe um índice GLOBAL e decide se anda em memória ou busca outra fatia. */
  const vaiParaLinha = (linhaGlobal: number) => {
    if (filtrando) {
      setInicioLocal(Math.max(0, Math.min(linhaGlobal, Math.max(0, totalLocal - 1))));
      return;
    }
    if (linhaGlobal >= d.de && linhaGlobal < d.de + d.linhas.length) {
      setInicioLocal(linhaGlobal - d.de);
      return;
    }
    const novaFatia = janelaDeServidorPara(linhaGlobal);
    setInicioLocal(linhaGlobal - novaFatia);
    janela.vaiPara(novaFatia);
  };

  /**
   * O CLIQUE NUMA LINHA filtra pela PRIMEIRA coluna — no relatório de origem é ela que
   * identifica o registro (PROTOCOLO), então recorta a página inteira para ESTE registro
   * sem amarrar um filtro por coluna. Sem tabela/coluna de origem, o clique não filtra.
   */
  const colunaDoClique = d.colunas[0];
  const podeClicarNaLinha =
    props.aoFiltrar !== undefined && !!colunaDoClique?.tabela && !!colunaDoClique?.coluna;
  const selecaoDaLinha = podeClicarNaLinha
    ? selecaoDe(props.filtros, colunaDoClique!.tabela!, colunaDoClique!.coluna!)
    : [];
  const clicaNaLinha = (valor: Valor) => {
    if (valor === null || valor === undefined) return;
    props.aoFiltrar!([{ tabela: colunaDoClique!.tabela!, coluna: colunaDoClique!.coluna!, valor }]);
  };

  const exportarCSV = () => {
    const cabecalho = d.colunas.map((c) => c.nome ?? '');
    const corpo = d.linhas.map((linha) =>
      linha.map((v, j) => formata(v, d.colunas[j]?.tipo ?? null).texto),
    );
    baixaCsv(`${props.pagina}_${props.visual.id}.csv`, textoCsv(cabecalho, corpo));
  };

  return (
    <Cartao
      titulo={tituloDeTabela(props.visual, d.colunas)}
      id={props.visual.id}
      largo
      altura="tabela"
      acoes={
        <>
          <input
            type="text"
            className="tabela-busca-input"
            placeholder="Filtrar…"
            value={termoBusca}
            onChange={(e) => setTermoBusca(e.target.value)}
          />
          <button onClick={exportarCSV} title="Exportar dados da tabela em formato CSV">
            <Download size={12} /> CSV
          </button>
        </>
      }
    >
      {janela.erro ? <Erro>{janela.erro}</Erro> : null}
      {totalLocal === 0 ? (
        <p className="vazio-pagina">
          {termoBusca ? 'Nenhuma linha para esta busca.' : 'Nenhuma linha para os filtros atuais.'}
        </p>
      ) : (
        <CorpoDaTabela
          colunas={d.colunas}
          linhas={visiveis}
          escalas={escalas}
          colOrdenada={colOrdenada}
          ordemDesc={ordemDesc}
          aoOrdenar={ordem.alterna}
          aoClicarLinha={podeClicarNaLinha ? clicaNaLinha : undefined}
          haSelecao={selecaoDaLinha.length > 0}
          estaSelecionada={(valor) => selecaoDaLinha.some((v) => Object.is(v, valor))}
        />
      )}
      {filtrando && totalLocal > 0 && d.linhas.length < d.linhasTotais ? (
        // Dizer o recorte em vez de deixar o número parecer o total.
        <p className="filtro-nota">
          Busca e ordenação valem sobre as {d.linhas.length} linhas desta fatia, não sobre as{' '}
          {d.linhasTotais} da consulta.
        </p>
      ) : null}
      <Paginacao
        janela={estado}
        carregando={janela.carregando}
        vaiPara={vaiParaLinha}
        passo={LINHAS_VISIVEIS}
      />
    </Cartao>
  );
}
