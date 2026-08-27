// A matriz (tabela dinâmica): chaves de linha, chaves de coluna e medidas no cruzamento.
//
// **Matriz larga vira alta.** Uma matriz com poucas linhas e muitas colunas — a
// `VISÃO PRODUTIVA` do Agendamento é 4 status × 194 dias — é ilegível: 194 colunas de
// data que só se leem rolando para o lado, sem conseguir comparar dois dias. Quando a
// matriz cabe inteira em memória e tem muito mais colunas que linhas, ela é exibida
// **transposta** por padrão (datas viram linhas, status viram colunas), e um botão
// alterna a orientação. O CSV continua saindo na orientação original.

import { useState } from 'react';
import type { DadosDeMatriz, FiltroDaTela, VisualCalculado } from '../api.ts';
import { ehColunaDeAno, formata, inteiro } from '../formato.ts';
import { Cartao, Erro } from './Cartao.tsx';
import { Paginacao } from './Paginacao.tsx';
import { usaJanela } from './usaJanela.ts';
import { tituloDoVisual } from '../rotulos.ts';

const COLUNAS_POR_JANELA = 30;

export function Matriz(props: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
}) {
  const janela = usaJanela(props.pagina, props.visual, props.filtros);
  const visual = janela.visual;
  const d = visual.dados as DadosDeMatriz | undefined;

  if (!d || !d.colunas || !d.linhas) return null;

  const semEixoDeColuna = d.colunas.length === 1 && d.colunas[0]?.length === 0;
  const tudoCarregado = d.linhas.length === d.linhasTotais;

  const podeTranspor = !semEixoDeColuna && tudoCarregado && d.colunas.length > 8 && d.linhas.length <= 60;
  const [transposto, setTransposto] = useState(podeTranspor && d.colunas.length > d.linhas.length * 2);

  const rotuloDaLinha = (linha: readonly (string | number | boolean | null)[]) =>
    linha
      .map((x, j) => formata(x, d.tiposDeLinha[j] ?? null, { semAgrupamento: ehColunaDeAno(d.chavesDeLinha[j]?.nome) }).texto)
      .join(' / ');
  const rotuloDaColuna = (c: readonly (string | number | boolean | null)[]) =>
    c
      .map((x, i) => formata(x, d.tiposDeColuna[i] ?? null, { semAgrupamento: ehColunaDeAno(d.chavesDeColuna[i]?.nome) }).texto)
      .join(' / ');
  const nomeChavesLinha = d.chavesDeLinha.map((c) => c.nome ?? c.coluna).join(' / ');
  const nomeChavesColuna = d.chavesDeColuna.map((c) => c.nome ?? c.coluna).join(' / ') || 'Coluna';

  const horizontais = transposto ? d.linhas : d.colunas;
  const totalColunas = horizontais.length;
  // Com setter: sem ele a janela ficava presa na última página e os controles não
  // tinham como existir. `null` = ainda no padrão, então ela acompanha o fim
  // quando um filtro muda o tamanho da matriz.
  const [inicioColuna, setInicioColuna] = useState<number | null>(null);
  const maxInicioColuna = Math.max(0, totalColunas - COLUNAS_POR_JANELA);
  const deColuna = Math.min(inicioColuna ?? maxInicioColuna, maxInicioColuna);
  const ateColuna = Math.min(deColuna + COLUNAS_POR_JANELA, totalColunas);
  const paginaColunas = totalColunas > COLUNAS_POR_JANELA;

  const partes = [`${inteiro(d.linhasTotais)} × ${inteiro(d.colunas.length)}`];
  if (paginaColunas) {
    partes.push(`colunas ${inteiro(deColuna + 1)}–${inteiro(ateColuna)} de ${inteiro(totalColunas)}`);
  }
  if (d.descartadas.linhas || d.descartadas.colunas) {
    partes.push(`${d.descartadas.linhas + d.descartadas.colunas} posição(ões) vazia(s) podada(s)`);
  }
  if (transposto) partes.push('transposta');

  const exportarCSV = () => {
    if (!d.linhas || !d.chavesDeLinha) return;

    const cabecalhoLinha = nomeChavesLinha;
    const cabecalhosColunas = d.colunas.flatMap((c) =>
      d.medidas.map((m) =>
        semEixoDeColuna ? (m ?? '—') : rotuloDaColuna(c) + (d.medidas.length > 1 ? ` · ${m ?? ''}` : ''),
      ),
    );

    const cabecalho = [`"${cabecalhoLinha.replace(/"/g, '""')}"`, ...cabecalhosColunas.map((x) => `"${x.replace(/"/g, '""')}"`)].join(';');

    const corpo = d.linhas
      .map((linha, i) => {
        const rotuloLinha = rotuloDaLinha(linha);
        const celulasLinha = (d.celulas[i] ?? []).flatMap((celula) =>
          celula.map((valor, mi) => formata(valor, d.tiposDeMedida[mi] ?? null).texto),
        );
        return [`"${rotuloLinha.replace(/"/g, '""')}"`, ...celulasLinha.map((x) => `"${x.replace(/"/g, '""')}"`)].join(';');
      })
      .join('\n');

    const blob = new Blob([`﻿${cabecalho}\n${corpo}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${props.pagina}_${props.visual.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const cabecalhoEsquerda = transposto ? nomeChavesColuna : nomeChavesLinha;

  // `slice` ANTES do `flatMap`: é o `flatMap` que multiplica por medida, então
  // cortar depois já teria pago o custo.
  const cabecalhosDireita: string[] = transposto
    ? d.linhas
        .slice(deColuna, ateColuna)
        .flatMap((linha) =>
          d.medidas.map((m) => rotuloDaLinha(linha) + (d.medidas.length > 1 ? ` · ${m ?? ''}` : '')),
        )
    : d.colunas
        .slice(deColuna, ateColuna)
        .flatMap((c) =>
          d.medidas.map((m) => (semEixoDeColuna ? (m ?? '—') : rotuloDaColuna(c) + (d.medidas.length > 1 ? ` · ${m ?? ''}` : ''))),
        );

  // A JANELA CORTA DE VERDADE. Antes daqui `deColuna`/`ateColuna` eram calculados,
  // apareciam no subtítulo e **nada cortava**: a matriz dizia "colunas 1–30 de 197"
  // e desenhava as 197. Um paginador que mente é pior que nenhum — ele promete um
  // custo que não paga (a DIÁRIO INSTALAÇÃO chegava a dezenas de milhares de
  // células) e faz acreditar que o problema de carga já foi resolvido.
  const corpo: { rotulo: string; celulas: { texto: string; vazio: boolean }[] }[] = transposto
    ? d.colunas.map((c, ci) => ({
        rotulo: rotuloDaColuna(c),
        celulas: d.linhas.slice(deColuna, ateColuna).flatMap((_, k) => {
          const li = deColuna + k;
          return (d.celulas[li]?.[ci] ?? d.medidas.map(() => null)).map((valor, mi) => {
            const f = formata(valor, d.tiposDeMedida[mi] ?? null);
            return { texto: f.texto, vazio: f.vazio };
          });
        }),
      }))
    : d.linhas.map((linha, i) => ({
        rotulo: rotuloDaLinha(linha),
        celulas: (d.celulas[i] ?? []).slice(deColuna, ateColuna).flatMap((celula) =>
          celula.map((valor, mi) => {
            const f = formata(valor, d.tiposDeMedida[mi] ?? null);
            return { texto: f.texto, vazio: f.vazio };
          }),
        ),
      }));

  return (
    // `altura="matriz"` NAO e enfeite: sem ela o Cartao cai no padrao `auto`, o
    // `height: clamp(360px, var(--util), 900px)` do `.v-matriz` nunca se aplica, e o
    // cartao cresce com o numero de linhas. Medido em 27/08/2026 na AGENDAMENTO
    // FIELD, a 1366x768: os dois cartoes de matriz tinham **2.386px e 2.123px** —
    // tres telas de card — e a pagina inteira, 8.460px. `.cartao-corpo` e `.rolagem`
    // ja tinham `overflow: auto` e `min-height: 0`; faltava alguem limitar a altura
    // para eles terem o que rolar. Rolagem contida pode; cartao maior que a tela nao.
    <Cartao
      titulo={tituloDoVisual(visual)}
      sub={partes.join(' · ')}
      id={visual.id}
      largo
      altura="matriz"
    >
      <div className="cartao-acoes" style={{ display: 'flex', gap: 6 }}>
        {paginaColunas && (
          <span className="paginador-grafico" title={`${totalColunas} colunas no total`}>
            <button
              type="button"
              title="Primeiras colunas"
              disabled={deColuna === 0}
              onClick={() => setInicioColuna(0)}
            >
              «
            </button>
            <button
              type="button"
              title="Colunas anteriores"
              disabled={deColuna === 0}
              onClick={() => setInicioColuna(Math.max(0, deColuna - COLUNAS_POR_JANELA))}
            >
              ‹
            </button>
            <span className="paginador-rotulo">
              {inteiro(deColuna + 1)}–{inteiro(ateColuna)}{' '}
              <span className="de">de {inteiro(totalColunas)}</span>
            </span>
            <button
              type="button"
              title="Colunas seguintes"
              disabled={deColuna >= maxInicioColuna}
              onClick={() => setInicioColuna(Math.min(maxInicioColuna, deColuna + COLUNAS_POR_JANELA))}
            >
              ›
            </button>
            <button
              type="button"
              title="Últimas colunas (mais recentes)"
              disabled={deColuna >= maxInicioColuna}
              onClick={() => setInicioColuna(maxInicioColuna)}
            >
              »
            </button>
          </span>
        )}
        {podeTranspor && (
          <button
            className="secundario btn-exportar"
            onClick={() => setTransposto((t) => !t)}
            title="Alterna linhas e colunas — útil quando há muitas colunas"
          >
            ⇄ {transposto ? 'Desfazer transposição' : 'Transpor'}
          </button>
        )}
        <button className="secundario btn-exportar" onClick={exportarCSV} title="Exportar matriz em formato CSV">
          📥 Exportar CSV
        </button>
      </div>
      {janela.erro ? <Erro>{janela.erro}</Erro> : null}
      <div className="rolagem">
        <table className="dados">
          <thead>
            <tr>
              <th>{cabecalhoEsquerda}</th>
              {cabecalhosDireita.map((h, i) => (
                <th key={i} className="num">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {corpo.map((linha, i) => (
              <tr key={i}>
                <td>{linha.rotulo}</td>
                {linha.celulas.map((cel, j) => (
                  <td key={j} className={`num${cel.vazio ? ' sem' : ''}`}>
                    {cel.texto}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!transposto && (
        <Paginacao
          janela={{ de: d.de, mostradas: d.linhas.length, total: d.linhasTotais }}
          carregando={janela.carregando}
          vaiPara={janela.vaiPara}
        />
      )}
    </Cartao>
  );
}
