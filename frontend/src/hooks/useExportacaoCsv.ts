// A exportação da tabela de detalhe em CSV.
//
// Estava no corpo do componente `Tabela`, com três `useState` e um `try/finally` de
// trinta linhas no meio do resto — boa parte da complexidade cognitiva 20 que o SonarJS
// acusava lá. Aqui fica o estado do progresso, o erro e a regra de quando NÃO buscar
// nada do servidor.

import { useState } from 'react';
import type { DadosDeTabela, FiltroDaTela, VisualCalculado } from '../services/dashboardService.ts';
import { coletaTabelaCompleta } from '../services/exportacaoService.ts';
import { baixaCsv, textoCsv } from '../utils/csv.ts';
import { ordenaLinhas } from '../utils/tabelaDados.ts';
import { textoDoErro } from '../utils/erroDaTela.ts';

export interface ProgressoDaExportacao {
  baixadas: number;
  total: number;
}

interface OpcoesDaExportacao {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
  clicados: readonly { tabela: string; coluna: string }[] | undefined;
  /** A busca já aplicada — o CSV sai do mesmo recorte que a tela mostra. */
  busca: string;
  /** A ordem do cabeçalho, para o arquivo sair na ordem que a pessoa vê. */
  ordem: { coluna: number | null; desc: boolean };
  /** Como escrever cada célula; a mesma função que a tela usa. */
  escreveCelula: (valor: unknown, coluna: DadosDeTabela['colunas'][number] | undefined) => string;
}

/**
 * A janela já tem a tabela inteira?
 *
 * Quando tem, exportar é instantâneo e NÃO recalcula a query — é o que conserta o CSV
 * lento de tabela de poucas linhas cujo cálculo por trás é caro (ex.: PROTOCOLOS POR
 * BASE, 2 linhas, ~15 s). Só vale quando a janela começa em 0 e cobre o total.
 */
function jaVeioInteira(dados: DadosDeTabela): boolean {
  return dados.de === 0 && dados.linhas.length >= dados.linhasTotais;
}

export function useExportacaoCsv(opcoes: OpcoesDaExportacao) {
  const [exportando, setExportando] = useState(false);
  const [progresso, setProgresso] = useState<ProgressoDaExportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const exporta = async (daTela: DadosDeTabela) => {
    if (exportando) return;
    setExportando(true);
    setErro(null);
    setProgresso({ baixadas: 0, total: daTela.linhasTotais });
    try {
      const completa = jaVeioInteira(daTela)
        ? daTela
        : await coletaTabelaCompleta({
            pagina: opcoes.pagina,
            visual: opcoes.visual.id,
            filtros: opcoes.filtros,
            clicados: opcoes.clicados,
            busca: opcoes.busca,
            aoProgredir: setProgresso,
          });

      const cabecalho = completa.colunas.map((coluna) => coluna.nome ?? '');
      const ordenadas = ordenaLinhas(completa.linhas, opcoes.ordem.coluna, opcoes.ordem.desc);
      const corpo = ordenadas.map((linha) =>
        linha.map((valor, indice) => opcoes.escreveCelula(valor, completa.colunas[indice])),
      );
      baixaCsv(`${opcoes.pagina}_${opcoes.visual.id}.csv`, textoCsv(cabecalho, corpo));
    } catch (problema) {
      setErro(
        problema instanceof Error ? textoDoErro(problema) : 'Não foi possível exportar os dados.',
      );
    } finally {
      setExportando(false);
      setProgresso(null);
    }
  };

  /** O rótulo do botão: "CSV" ou o andamento do download. */
  const rotuloDoBotao =
    exportando && progresso ? `CSV ${progresso.baixadas}/${progresso.total}` : 'CSV';

  return { exportando, erro, rotuloDoBotao, exporta };
}
