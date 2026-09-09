// A tabela de detalhe. O corte é dito, nunca silencioso — e agora é navegável e exportável.
//
// Regras de tabela do padrão de dashboards: cabeçalho na primária, numérico à direita
// com `tabular-nums`, ordenação clicável com indicador de direção, e **barra de dados
// dentro da célula** em vez de um gráfico ao lado — é o que o Power BI faz, e economiza
// um visual inteiro. A barra só aparece onde ela significa magnitude: ver `ehMagnitude`.

import { useMemo, useState } from 'react';
import type { DadosDeTabela, FiltroDaTela, Valor, VisualCalculado } from '../api.ts';
import { formata } from '../formato.ts';
import { ehMagnitude, larguraDaBarra } from '../magnitude.ts';
import { Cartao, Erro } from './Cartao.tsx';
import { Paginacao } from './Paginacao.tsx';
import { SetaDeOrdem } from './icones.tsx';
import { usaJanela } from './usaJanela.ts';
import { tituloDeTabela } from '../rotulos.ts';
import { Download } from 'lucide-react';
import { janelaDeServidorPara, LINHAS_VISIVEIS } from '../janela.ts';
import { selecaoDe, type AoFiltrar } from '../rota.ts';

export function Tabela(props: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
  aoFiltrar?: AoFiltrar;
}) {
  const janela = usaJanela(props.pagina, props.visual, props.filtros);
  const d = janela.visual.dados as DadosDeTabela | undefined;

  if (!d || !d.colunas || !d.linhas) {
    const titulo = tituloDeTabela(props.visual, d?.colunas ?? []);
    return (
      <Cartao titulo={titulo} id={props.visual.id} altura="tabela">
        <p className="sob-demanda">Sem dados disponíveis para a tabela.</p>
      </Cartao>
    );
  }

  /**
   * O padrão de ordenação: a primeira coluna de DATA, da mais nova para a mais velha.
   *
   * O servidor (`ordenaPorDataPadrao` em `tabela.ts`) já entrega as linhas nesta ordem —
   * isto só espelha o estado no cabeçalho, para a seta aparecer e o primeiro clique na
   * própria coluna alternar para crescente em vez de saltar de "nada" para "crescente"
   * (o que pareceria inverter o sentido depois de um clique só). Tabela sem coluna de
   * data (ex.: um resumo por cidade) mantém o comportamento antigo — sem ordenação até
   * o usuário pedir.
   */
  const colunaDataPadrao = useMemo(() => d.colunas.findIndex((c) => c.tipo === 'date'), [d.colunas]);
  const temOrdenacaoPadrao = colunaDataPadrao >= 0;

  const [colOrdenada, setColOrdenada] = useState<number | null>(temOrdenacaoPadrao ? colunaDataPadrao : null);
  const [ordemDesc, setOrdemDesc] = useState<boolean>(temOrdenacaoPadrao);
  const [termoBusca, setTermoBusca] = useState<string>('');

  /**
   * Ainda no padrão (nenhum clique de cabeçalho mudou a ordenação)? Isto decide
   * `filtrando` abaixo — sem esta distinção, abrir a tabela já ligaria o aviso "vale só
   * sobre esta fatia" e trocaria a paginação para o universo local (200 linhas), porque
   * `colOrdenada` nasce preenchido pelo padrão de data, não `null`.
   */
  const estaNoPadraoDeOrdenacao = temOrdenacaoPadrao
    ? colOrdenada === colunaDataPadrao && ordemDesc
    : colOrdenada === null;

  const alternarOrdem = (index: number) => {
    if (colOrdenada === index) {
      if (ordemDesc) {
        setColOrdenada(null);
        setOrdemDesc(false);
      } else {
        setOrdemDesc(true);
      }
    } else {
      setColOrdenada(index);
      setOrdemDesc(false);
    }
  };

  const linhasFiltradasEOrdenadas = useMemo(() => {
    if (!d.linhas) return [];
    let resultado = [...d.linhas];

    if (termoBusca.trim() !== '') {
      const termo = termoBusca.toLowerCase().trim();
      resultado = resultado.filter((linha) =>
        linha.some((val) => val !== null && val !== undefined && String(val).toLowerCase().includes(termo)),
      );
    }

    if (colOrdenada !== null) {
      resultado.sort((a, b) => {
        const vA = a[colOrdenada];
        const vB = b[colOrdenada];
        if (vA === null || vA === undefined) return 1;
        if (vB === null || vB === undefined) return -1;
        if (typeof vA === 'number' && typeof vB === 'number') {
          return ordemDesc ? vB - vA : vA - vB;
        }
        const valA = vA as unknown;
        const valB = vB as unknown;
        if (valA instanceof Date && valB instanceof Date) {
          return ordemDesc ? valB.getTime() - valA.getTime() : valA.getTime() - valB.getTime();
        }
        const sA = String(vA).toLowerCase();
        const sB = String(vB).toLowerCase();
        if (sA < sB) return ordemDesc ? 1 : -1;
        if (sA > sB) return ordemDesc ? -1 : 1;
        return 0;
      });
    }

    return resultado;
  }, [d.linhas, termoBusca, colOrdenada, ordemDesc]);

  // O maior valor de cada coluna de magnitude — a escala da barra de dados. Uma escala
  // por coluna é o certo aqui: colunas diferentes medem coisas diferentes.
  const escalas = useMemo(() => {
    const mapa = new Map<number, number>();
    d.colunas?.forEach((c, i) => {
      if (!ehMagnitude(c.nome ?? null, c.tipo)) return;
      let maior = 0;
      let menor = Number.POSITIVE_INFINITY;
      for (const linha of d.linhas ?? []) {
        const v = linha[i];
        if (typeof v !== 'number') continue;
        const a = Math.abs(v);
        if (a > maior) maior = a;
        if (a < menor) menor = a;
      }
      // Coluna em que todo valor é igual não ganha barra. A tabela de PROTOCOLO x
      // QTD tem 1 em todas as linhas: a barra saía cheia em todas elas, ocupando
      // metade da largura da coluna para dizer que nada varia. Barra existe para
      // mostrar diferença — sem diferença, ela é só tinta.
      if (maior > 0 && menor !== maior) mapa.set(i, maior);
    });
    return mapa;
  }, [d.colunas, d.linhas]);

  const renderizaValor = (valor: unknown, tipo: unknown) => {
    const f = formata(valor, tipo as Parameters<typeof formata>[1]);
    if (f.vazio) return <span className="sem">{f.texto}</span>;

    const txt = f.texto.trim();
    if (txt === 'SIM' || txt === 'OK' || txt === 'Concluído' || txt === 'Dentro do SLA') {
      return <span className="badge-status badge-sim">{txt}</span>;
    }
    if (txt === 'NÃO' || txt === 'Não') {
      return <span className="badge-status badge-nao">{txt}</span>;
    }
    if (txt === 'Cancelado' || txt === 'Estourado' || txt.includes('Fora do SLA')) {
      return <span className="badge-status badge-alerta">{txt}</span>;
    }

    return f.texto;
  };

  const exportarCSV = () => {
    if (!d.colunas || !d.linhas) return;
    const cabecalho = d.colunas.map((c) => `"${(c.nome ?? '').replace(/"/g, '""')}"`).join(';');
    const corpo = d.linhas
      .map((linha) =>
        linha
          .map((v, colIdx) => {
            const f = formata(v, d.colunas[colIdx]?.tipo ?? null);
            return `"${f.texto.replace(/"/g, '""')}"`;
          })
          .join(';'),
      )
      .join('\n');
    const conteudo = `﻿${cabecalho}\n${corpo}`;
    const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${props.pagina}_${props.visual.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /* ==========================================================================
     A JANELA DE 20 LINHAS.

     `usaJanela` já traz 200 do servidor; a tela desenhava as 200. Na ANÁLISE
     DETALHADA são seis tabelas lado a lado, então a seção descia ~1.200 linhas e
     a página virava um rolo. Aqui a tela passa a desenhar 20 por vez.

     Virar página DENTRO das 200 já carregadas é instantâneo e não custa
     requisição — só ao sair delas se busca a fatia seguinte. A tela ficou 10x
     mais curta e fez MENOS pedidos, não mais.
     ========================================================================== */
  const [inicioLocal, setInicioLocal] = useState(0);

  // Buscar ou ordenar refaz o conjunto; continuar na página 7 mostraria o vazio.
  // Guardar a "âncora" e comparar é o jeito de reagir a isso durante a
  // renderização, sem `useEffect` (que só corrigiria no quadro seguinte, depois
  // de um quadro em branco).
  const ancora = `${d.de}|${termoBusca}|${String(colOrdenada)}|${String(ordemDesc)}`;
  const [ancoraAnterior, setAncoraAnterior] = useState(ancora);
  if (ancoraAnterior !== ancora) {
    setAncoraAnterior(ancora);
    setInicioLocal(0);
  }

  // Buscar/ordenar só alcança as 200 em memória — a tela diz isso em vez de
  // prometer que filtrou as 32 mil. O padrão de data (acima) não conta como
  // "ordenar": ele já veio do servidor, sobre a consulta inteira.
  const filtrando = termoBusca.trim() !== '' || !estaNoPadraoDeOrdenacao;

  const totalLocal = linhasFiltradasEOrdenadas.length;
  const inicio = Math.min(inicioLocal, Math.max(0, totalLocal - 1));
  const visiveis = linhasFiltradasEOrdenadas.slice(inicio, inicio + LINHAS_VISIVEIS);

  // Filtrando, a paginação é sobre o que foi filtrado (universo local). Sem filtro,
  // ela é sobre a consulta inteira — e aí `de` é o índice GLOBAL da primeira linha.
  const estado = filtrando
    ? { de: inicio, mostradas: visiveis.length, total: totalLocal }
    : { de: d.de + inicio, mostradas: visiveis.length, total: d.linhasTotais };

  /** Recebe um índice GLOBAL e decide se anda em memória ou busca outra fatia. */
  const vaiParaLinha = (linhaGlobal: number) => {
    if (filtrando) {
      setInicioLocal(Math.max(0, Math.min(linhaGlobal, Math.max(0, totalLocal - 1))));
      return;
    }
    const dentroDaFatia = linhaGlobal >= d.de && linhaGlobal < d.de + d.linhas.length;
    if (dentroDaFatia) {
      setInicioLocal(linhaGlobal - d.de);
      return;
    }
    const novaFatia = janelaDeServidorPara(linhaGlobal);
    setInicioLocal(linhaGlobal - novaFatia);
    janela.vaiPara(novaFatia);
  };

  const semLinhas = linhasFiltradasEOrdenadas.length === 0;

  /**
   * O CLIQUE NUMA LINHA — mesma ideia do clique numa categoria do gráfico
   * (`grafico-clique.ts`), só que a "categoria" aqui é a PRIMEIRA coluna da tabela em
   * vez do eixo. No relatório de origem é ela que identifica o registro (PROTOCOLO na
   * grade de Visão Geral, e o mesmo vale nas outras tabelas planas de `PROTOCOLOS
   * GERAL` — todas têm o identificador como primeira coluna), então filtrar por ela
   * já recorta a página inteira para ESTE registro, sem amarrar 23 filtros (um por
   * coluna) que lotariam a barra de chips para dizer a mesma coisa.
   *
   * Sem `tabela`/`coluna` de origem (campo calculado, ou tabela sem coluna nenhuma) o
   * clique não filtra nada — mesma regra de "categoria nula não filtra" do gráfico.
   */
  const colunaDoClique = d.colunas[0];
  const podeClicarNaLinha =
    props.aoFiltrar !== undefined && !!colunaDoClique?.tabela && !!colunaDoClique?.coluna;

  const selecaoDaLinha = podeClicarNaLinha
    ? selecaoDe(props.filtros, colunaDoClique!.tabela!, colunaDoClique!.coluna!)
    : [];
  const haSelecaoDeLinha = selecaoDaLinha.length > 0;
  const linhaEstaSelecionada = (valor: Valor) => selecaoDaLinha.some((v) => Object.is(v, valor));

  const clicaNaLinha = (valor: Valor) => {
    if (!podeClicarNaLinha || valor === null || valor === undefined) return;
    props.aoFiltrar!([{ tabela: colunaDoClique!.tabela!, coluna: colunaDoClique!.coluna!, valor }]);
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
      {semLinhas ? (
        <p className="vazio-pagina">
          {termoBusca ? 'Nenhuma linha para esta busca.' : 'Nenhuma linha para os filtros atuais.'}
        </p>
      ) : (
        <div className="rolagem">
          <table className="dados">
            <thead>
              <tr>
                {d.colunas.map((c, i) => {
                  const ativa = colOrdenada === i;
                  return (
                    <th
                      key={i}
                      className={`th-clicavel ${c.tipo === 'number' || c.tipo === 'date' ? 'num' : ''}`}
                      onClick={() => alternarOrdem(i)}
                      title="Clique para ordenar"
                    >
                      {c.nome ?? '—'}
                      <SetaDeOrdem ativa={ativa} desc={ordemDesc} />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((linha, i) => (
                <tr
                  key={i}
                  className={
                    (podeClicarNaLinha ? 'linha-clicavel' : '') +
                    (haSelecaoDeLinha
                      ? linhaEstaSelecionada(linha[0] as Valor)
                        ? ' linha-selecionada'
                        : ' linha-apagada'
                      : '')
                  }
                  onClick={podeClicarNaLinha ? () => clicaNaLinha(linha[0] as Valor) : undefined}
                  title={podeClicarNaLinha ? 'Clique para filtrar a página inteira a este registro' : undefined}
                >
                  {linha.map((valor, j) => {
                    const f = formata(valor, d.colunas[j]?.tipo ?? null);
                    const escala = escalas.get(j);
                    const temBarra = escala !== undefined && typeof valor === 'number';
                    return (
                      <td
                        key={j}
                        className={`${f.numerico ? 'num' : ''}${temBarra ? ' barra-dado' : ''}`}
                        title={f.texto}
                      >
                        {temBarra ? (
                          <i className="fundo-barra" style={{ width: `${larguraDaBarra(valor as number, escala!)}%` }} />
                        ) : null}
                        <span>{renderizaValor(valor, d.colunas[j]?.tipo ?? null)}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filtrando && totalLocal > 0 && d.linhas.length < d.linhasTotais ? (
        // Dizer o recorte em vez de deixar o número parecer o total: a busca e a
        // ordenação alcançam só as linhas carregadas, não a consulta inteira.
        <p className="filtro-nota">
          Busca e ordenação valem sobre as {d.linhas.length} linhas desta fatia, não
          sobre as {d.linhasTotais} da consulta.
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
