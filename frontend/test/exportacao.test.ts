import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  coletaMatrizCompleta,
  coletaTabelaCompleta,
  LINHAS_POR_LOTE_DE_EXPORTACAO,
  type BuscaDeExportacao,
} from '../src/services/exportacaoService.ts';
import type { PaginaCalculada } from '../src/services/dashboardService.ts';

function paginaCom(dados: unknown, dadoDe = '2026-10-18T12:00:00.000Z'): PaginaCalculada {
  return {
    id: 'pagina',
    nome: 'Página',
    tamanho: { width: 1, height: 1 },
    dadoDe,
    visuais: [
      {
        id: 'visual',
        tipo: 'tableEx',
        posicao: { x: 0, y: 0, width: 1, height: 1 },
        conteudo: 'tabela',
        dados,
        ms: 0,
      },
    ],
    resumo: { calculados: 1, falharam: 0, semCalculo: 0 },
    ms: 0,
    tabelas: [],
  };
}

test('coleta a tabela inteira em lotes de baixa prioridade', async () => {
  const origem: number[][] = Array.from({ length: LINHAS_POR_LOTE_DE_EXPORTACAO + 2 }, (_, i) => [
    i,
  ]);
  const pedidos: { de: number; linhas: number; origem: string }[] = [];
  const busca: BuscaDeExportacao = async (
    _id,
    _filtros,
    opcoes,
    _signal,
    _clicados,
    origemDoPedido,
  ) => {
    pedidos.push({ de: opcoes.de, linhas: opcoes.linhas, origem: origemDoPedido });
    return paginaCom({
      colunas: [{ nome: 'Número', tipo: 'number', chave: true, tabela: 'T', coluna: 'N' }],
      linhas: origem.slice(opcoes.de, opcoes.de + opcoes.linhas),
      linhasTotais: origem.length,
      de: opcoes.de,
      filtros: [],
    });
  };
  const progresso: number[] = [];

  const completa = await coletaTabelaCompleta(
    {
      pagina: 'pagina',
      visual: 'visual',
      filtros: [],
      aoProgredir: (p) => progresso.push(p.baixadas),
    },
    busca,
  );

  assert.equal(completa.linhas.length, origem.length);
  assert.deepEqual(pedidos, [
    { de: 0, linhas: LINHAS_POR_LOTE_DE_EXPORTACAO, origem: 'export' },
    { de: LINHAS_POR_LOTE_DE_EXPORTACAO, linhas: LINHAS_POR_LOTE_DE_EXPORTACAO, origem: 'export' },
  ]);
  assert.deepEqual(progresso, [LINHAS_POR_LOTE_DE_EXPORTACAO, origem.length]);
});

test('coleta as células de todas as linhas da matriz', async () => {
  const busca: BuscaDeExportacao = async (_id, _filtros, opcoes) => {
    const linhas = [['A'], ['B'], ['C']].slice(opcoes.de, opcoes.de + opcoes.linhas);
    return paginaCom({
      chavesDeLinha: [{ nome: 'Equipe', coluna: 'EQUIPE' }],
      chavesDeColuna: [],
      medidas: ['Qtd'],
      linhas,
      colunas: [[]],
      tiposDeLinha: ['string'],
      tiposDeColuna: [],
      tiposDeMedida: ['number'],
      celulas: linhas.map((_linha, i) => [[opcoes.de + i + 1]]),
      linhasTotais: 3,
      de: opcoes.de,
      descartadas: { linhas: 0, colunas: 0 },
      filtros: [],
    });
  };

  const completa = await coletaMatrizCompleta(
    { pagina: 'pagina', visual: 'visual', filtros: [] },
    busca,
  );

  assert.deepEqual(completa.linhas, [['A'], ['B'], ['C']]);
  assert.deepEqual(completa.celulas, [[[1]], [[2]], [[3]]]);
});
