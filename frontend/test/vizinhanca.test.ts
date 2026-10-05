// A vizinhança de um estado (ACHADOS #179): os estados a um clique de filtro.
//
// O que importa aqui é a URL: o pré-carregamento só serve se cair na MESMA chave que o
// clique de verdade vai pedir. Por isso cada caso compara com a conta do clique
// (`aplicaSelecao` + a seleção alternada), e não com um valor escrito à mão.

import assert from 'node:assert/strict';
import test from 'node:test';
import { urlDaPagina, type FiltroDaTela } from '../src/services/dashboardService.ts';
import { aplicaSelecao, selecaoDe } from '../src/utils/rota.ts';
import { alternaValor, estadosVizinhos } from '../src/utils/vizinhanca.ts';

const TIPO = { tabela: 'PROTOCOLOS GERAL', coluna: 'TIPO DE PROTOCOLO', valores: ['Instalação', 'Mudança', 'Reparo'] };
const CIDADE = { tabela: 'PROTOCOLOS GERAL', coluna: 'CIDADE', valores: ['Canoas', 'Esteio'] };
const MES: FiltroDaTela = { tabela: 'calendar', coluna: 'Date', nivel: 'Mês', valores: ['outubro'] };

test('alternaValor: entra se não estava, sai se estava', () => {
  assert.deepEqual(alternaValor([], 'a'), ['a']);
  assert.deepEqual(alternaValor(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(alternaValor(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(alternaValor([null], null), []);
});

test('cada vizinho é a URL do clique de verdade', () => {
  const filtros: FiltroDaTela[] = [MES, { tabela: TIPO.tabela, coluna: TIPO.coluna, valores: ['Mudança'] }];
  const vizinhos = estadosVizinhos({ filtros, clicados: [] }, [TIPO, CIDADE], 99);
  assert.equal(vizinhos.length, 5);
  let i = 0;
  for (const s of [TIPO, CIDADE]) {
    for (const v of s.valores) {
      const doClique = aplicaSelecao(filtros, s.tabela, s.coluna, alternaValor(selecaoDe(filtros, s.tabela, s.coluna), v));
      assert.equal(urlDaPagina('p', vizinhos[i]!.filtros), urlDaPagina('p', doClique), `vizinho ${i}`);
      i++;
    }
  }
  // Clicar no valor já marcado desmarca — e a seleção vazia tira o filtro da coluna.
  assert.deepEqual(vizinhos[1]!.filtros, [MES]);
  // O filtro de período fica em todos.
  for (const viz of vizinhos) assert.ok(viz.filtros.some((f) => f.nivel === 'Mês'));
});

test('mexer numa segmentação tira o clicado daquela coluna, e só dela', () => {
  const clicados = [{ tabela: CIDADE.tabela, coluna: CIDADE.coluna }, { tabela: 'EQUIPES', coluna: 'NOME' }];
  const [doTipo] = estadosVizinhos({ filtros: [], clicados }, [TIPO], 1);
  const [daCidade] = estadosVizinhos({ filtros: [], clicados }, [CIDADE], 1);
  assert.deepEqual(doTipo!.clicados, clicados);
  assert.deepEqual(daCidade!.clicados, [{ tabela: 'EQUIPES', coluna: 'NOME' }]);
});

test('o teto corta, na ordem das segmentações', () => {
  const vizinhos = estadosVizinhos({ filtros: [], clicados: [] }, [TIPO, CIDADE], 4);
  assert.equal(vizinhos.length, 4);
  assert.deepEqual(vizinhos.map((v) => v.filtros[0]!.valores[0]), ['Instalação', 'Mudança', 'Reparo', 'Canoas']);
});
