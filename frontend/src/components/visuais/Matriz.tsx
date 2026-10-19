// A matriz (tabela dinâmica): chaves de linha, chaves de coluna e medidas no cruzamento.
//
// **Matriz larga vira alta.** Uma matriz com poucas linhas e muitas colunas — a
// `VISÃO PRODUTIVA` do Agendamento é 4 status × 194 dias — é ilegível: 194 colunas de
// data que só se leem rolando para o lado. Quando a matriz cabe inteira em memória e tem
// muito mais colunas que linhas, ela é exibida **transposta** por padrão, e um botão
// alterna a orientação. O CSV continua saindo na orientação original.
//
// **Barra de dados por medida (Fase L6, §8)** — ver `escalasPorMedida`. As contas estão
// em `utils/matrizDados.ts`.

import { useMemo, useState } from 'react';
import type {
  DadosDeMatriz,
  FiltroDaTela,
  VisualCalculado,
} from '../../services/dashboardService.ts';
import { inteiro } from '../../utils/formato.ts';
import { baixaCsv, textoCsv } from '../../utils/csv.ts';
import { coletaMatrizCompleta } from '../../services/exportacaoService.ts';
import {
  cabecalhosDaDireita,
  corpoDaMatriz,
  csvDaMatriz,
  escalasPorMedida,
  semEixoDeColuna,
} from '../../utils/matrizDados.ts';
import { Cartao, Erro } from '../ui/Cartao.tsx';
import { Paginacao } from '../ui/Paginacao.tsx';
import { PaginadorDeJanela } from '../ui/PaginadorDeJanela.tsx';
import { Transpor } from '../ui/icones.tsx';
import { useJanela } from '../../hooks/useJanela.ts';
import { tituloDeMatriz } from '../../utils/rotulos.ts';
import { Download } from 'lucide-react';
import { MensagemDeEstado } from '../ui/Estado.tsx';

const COLUNAS_POR_JANELA = 30;

/** Dá para transpor: tudo carregado, eixo de coluna de verdade, muitas colunas e poucas linhas. */
const podeTransporA = (d: DadosDeMatriz | undefined): boolean =>
  !!d &&
  !!d.colunas &&
  !!d.linhas &&
  !semEixoDeColuna(d) &&
  d.linhas.length === d.linhasTotais &&
  d.colunas.length > 8 &&
  d.linhas.length <= 60;

export function Matriz(props: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
}) {
  const janela = useJanela(props.pagina, props.visual, props.filtros);
  const visual = janela.visual;
  const d = visual.dados as DadosDeMatriz | undefined;
  const temDados = !!d && !!d.colunas && !!d.linhas;

  // TODOS os hooks antes do `return` de "sem dados" (fase 4): estavam depois dele.
  const podeTranspor = podeTransporA(d);
  const [transposto, setTransposto] = useState(
    podeTranspor && d!.colunas.length > d!.linhas.length * 2,
  );
  const escalas = useMemo(() => (temDados ? escalasPorMedida(d!) : []), [temDados, d]);
  // Com setter: sem ele a janela ficava presa na última página. `null` = ainda no padrão,
  // então ela acompanha o fim quando um filtro muda o tamanho da matriz.
  const [inicioColuna, setInicioColuna] = useState<number | null>(null);
  const [exportando, setExportando] = useState(false);
  const [progressoDaExportacao, setProgressoDaExportacao] = useState<{
    baixadas: number;
    total: number;
  } | null>(null);
  const [erroDaExportacao, setErroDaExportacao] = useState<string | null>(null);

  if (!d || !d.colunas || !d.linhas) {
    return (
      <Cartao titulo={tituloDeMatriz(visual, d)} id={visual.id} altura="matriz">
        <MensagemDeEstado>Sem dados disponíveis para a matriz.</MensagemDeEstado>
      </Cartao>
    );
  }

  const totalColunas = (transposto ? d.linhas : d.colunas).length;
  const maxInicioColuna = Math.max(0, totalColunas - COLUNAS_POR_JANELA);
  const deColuna = Math.min(inicioColuna ?? maxInicioColuna, maxInicioColuna);
  const ateColuna = Math.min(deColuna + COLUNAS_POR_JANELA, totalColunas);
  const paginaColunas = totalColunas > COLUNAS_POR_JANELA;

  const partes = [`${inteiro(d.linhasTotais)} × ${inteiro(d.colunas.length)}`];
  if (paginaColunas)
    partes.push(
      `colunas ${inteiro(deColuna + 1)}–${inteiro(ateColuna)} de ${inteiro(totalColunas)}`,
    );
  if (d.descartadas.linhas || d.descartadas.colunas) {
    partes.push(`${d.descartadas.linhas + d.descartadas.colunas} posição(ões) vazia(s) podada(s)`);
  }
  // A ressalva vem da API (`nota`) e não é cosmética: este visual ignora o mês do seletor
  // de propósito, e sem dizer isso pareceria discordar dos vizinhos sem motivo.
  if (visual.nota) partes.push(visual.nota);
  if (transposto) partes.push('transposta');

  const nomeChavesLinha = d.chavesDeLinha.map((c) => c.nome ?? c.coluna).join(' / ');
  const nomeChavesColuna = d.chavesDeColuna.map((c) => c.nome ?? c.coluna).join(' / ') || 'Coluna';
  const corpo = corpoDaMatriz(d, transposto, deColuna, ateColuna, escalas);

  const exportarCSV = async () => {
    if (exportando) return;
    setExportando(true);
    setErroDaExportacao(null);
    setProgressoDaExportacao({ baixadas: 0, total: d.linhasTotais });
    try {
      const completa = await coletaMatrizCompleta({
        pagina: props.pagina,
        visual: props.visual.id,
        filtros: props.filtros,
        aoProgredir: setProgressoDaExportacao,
      });
      const { cabecalho, linhas } = csvDaMatriz(completa);
      baixaCsv(`${props.pagina}_${props.visual.id}.csv`, textoCsv(cabecalho, linhas));
    } catch (err) {
      setErroDaExportacao(
        err instanceof Error ? err.message : 'Não foi possível exportar os dados.',
      );
    } finally {
      setExportando(false);
      setProgressoDaExportacao(null);
    }
  };

  return (
    // `altura="matriz"` NAO e enfeite: sem ela o Cartao cai no padrao `auto` e cresce com
    // o numero de linhas — medido em 27/08/2026 na AGENDAMENTO FIELD, cartoes de 2.386px
    // e 2.123px. Rolagem contida pode; cartao maior que a tela nao.
    <Cartao
      titulo={tituloDeMatriz(visual, d)}
      sub={partes.join(' · ')}
      id={visual.id}
      largo
      altura="matriz"
      // No cabeçalho, como na tabela: `.cartao-acoes` tem letra `--pbi-sobre-primary` e só
      // se lê sobre o bordô. Dentro do corpo, os botões saíam branco no branco.
      acoes={
        <>
          {paginaColunas && (
            <PaginadorDeJanela
              elemento="span"
              de={deColuna}
              ate={ateColuna}
              total={totalColunas}
              maxInicio={maxInicioColuna}
              passo={COLUNAS_POR_JANELA}
              aoIr={setInicioColuna}
              resumo={`${totalColunas} colunas no total`}
              titulos={{
                primeira: 'Primeiras colunas',
                anterior: 'Colunas anteriores',
                proxima: 'Colunas seguintes',
                ultima: 'Últimas colunas (mais recentes)',
              }}
            />
          )}
          {podeTranspor && (
            <button
              onClick={() => setTransposto((t) => !t)}
              title="Alterna linhas e colunas — útil quando há muitas colunas"
            >
              <Transpor /> {transposto ? 'Desfazer transposição' : 'Transpor'}
            </button>
          )}
          <button
            onClick={() => void exportarCSV()}
            disabled={exportando}
            title="Exportar todas as linhas do período filtrado em formato CSV"
          >
            <Download size={12} />{' '}
            {exportando && progressoDaExportacao
              ? `CSV ${progressoDaExportacao.baixadas}/${progressoDaExportacao.total}`
              : 'CSV'}
          </button>
        </>
      }
    >
      {janela.erro ? <Erro>{janela.erro}</Erro> : null}
      {erroDaExportacao ? <Erro>{erroDaExportacao}</Erro> : null}
      <div className="rolagem">
        <table className="dados">
          <thead>
            <tr>
              <th>{transposto ? nomeChavesColuna : nomeChavesLinha}</th>
              {cabecalhosDaDireita(d, transposto, deColuna, ateColuna).map((h, i) => (
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
                  <td
                    key={j}
                    className={`num${cel.vazio ? ' sem' : ''}${cel.largura !== undefined ? ' barra-dado' : ''}`}
                  >
                    {cel.largura !== undefined ? (
                      <i className="fundo-barra" style={{ width: `${cel.largura}%` }} />
                    ) : null}
                    <span>{cel.texto}</span>
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
