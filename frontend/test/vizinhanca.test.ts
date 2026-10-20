// A vizinhança de um estado (ACHADOS #179): os estados a um clique de filtro.
//
// O que importa aqui é a URL: o pré-carregamento só serve se cair na MESMA chave que o
// clique de verdade vai pedir. Por isso cada caso compara com a conta do clique
// (`aplicaSelecao` + a seleção alternada), e não com um valor escrito à mão.

import assert from 'node:assert/strict';
import { describe, expect, it, test } from 'vitest';
import { urlDaPagina, type FiltroDaTela } from '../src/services/dashboardService.ts';
import { aplicaSelecao, selecaoDe } from '../src/utils/rota.ts';
import { alternaValor, estadosDoPeriodo, estadosVizinhos } from '../src/utils/vizinhanca.ts';
import type { AnoDaArvore } from '../src/utils/hierarquiaData.ts';

const TIPO = {
  tabela: 'PROTOCOLOS GERAL',
  coluna: 'TIPO DE PROTOCOLO',
  valores: ['Instalação', 'Mudança', 'Reparo'],
};
const CIDADE = { tabela: 'PROTOCOLOS GERAL', coluna: 'CIDADE', valores: ['Canoas', 'Esteio'] };
const MES: FiltroDaTela = {
  tabela: 'calendar',
  coluna: 'Date',
  nivel: 'Mês',
  valores: ['outubro'],
};

test('alternaValor: entra se não estava, sai se estava', () => {
  assert.deepEqual(alternaValor([], 'a'), ['a']);
  assert.deepEqual(alternaValor(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(alternaValor(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(alternaValor([null], null), []);
});

test('cada vizinho é a URL do clique de verdade', () => {
  const filtros: FiltroDaTela[] = [
    MES,
    { tabela: TIPO.tabela, coluna: TIPO.coluna, valores: ['Mudança'] },
  ];
  const vizinhos = estadosVizinhos({ filtros, clicados: [] }, [TIPO, CIDADE], 99);
  assert.equal(vizinhos.length, 5);
  let i = 0;
  for (const s of [TIPO, CIDADE]) {
    for (const v of s.valores) {
      const doClique = aplicaSelecao(
        filtros,
        s.tabela,
        s.coluna,
        alternaValor(selecaoDe(filtros, s.tabela, s.coluna), v),
      );
      assert.equal(
        urlDaPagina('p', vizinhos[i]!.filtros),
        urlDaPagina('p', doClique),
        `vizinho ${i}`,
      );
      i++;
    }
  }
  // Clicar no valor já marcado desmarca — e a seleção vazia tira o filtro da coluna.
  assert.deepEqual(vizinhos[1]!.filtros, [MES]);
  // O filtro de período fica em todos.
  for (const viz of vizinhos) assert.ok(viz.filtros.some((f) => f.nivel === 'Mês'));
});

test('mexer numa segmentação tira o clicado daquela coluna, e só dela', () => {
  const clicados = [
    { tabela: CIDADE.tabela, coluna: CIDADE.coluna },
    { tabela: 'EQUIPES', coluna: 'NOME' },
  ];
  const [doTipo] = estadosVizinhos({ filtros: [], clicados }, [TIPO], 1);
  const [daCidade] = estadosVizinhos({ filtros: [], clicados }, [CIDADE], 1);
  assert.deepEqual(doTipo!.clicados, clicados);
  assert.deepEqual(daCidade!.clicados, [{ tabela: 'EQUIPES', coluna: 'NOME' }]);
});

test('o teto corta, na ordem das segmentações', () => {
  const vizinhos = estadosVizinhos({ filtros: [], clicados: [] }, [TIPO, CIDADE], 4);
  assert.equal(vizinhos.length, 4);
  assert.deepEqual(
    vizinhos.map((v) => v.filtros[0]!.valores[0]),
    ['Instalação', 'Mudança', 'Reparo', 'Canoas'],
  );
});

describe('estadosDoPeriodo', () => {
  const DATA = { tabela: 'CAL', coluna: 'DATA' };
  const ARVORE: AnoDaArvore[] = [
    { ano: 2025, meses: [{ indice: 11, nome: 'dezembro', dias: [1] }] },
    {
      ano: 2026,
      meses: [
        { indice: 8, nome: 'setembro', dias: [1] },
        { indice: 9, nome: 'outubro', dias: [1] },
      ],
    },
  ];

  it('vizinhos de quem está num mês: os meses do ano marcado e cada ano, com a conta do clique', () => {
    const estado = {
      filtros: [
        { tabela: 'CAL', coluna: 'DATA', nivel: 'Ano', valores: [2026] },
        { tabela: 'CAL', coluna: 'DATA', nivel: 'Mês', valores: ['outubro'] },
      ],
      clicados: [{ tabela: 'CAL', coluna: 'DATA' }],
    };
    const out = estadosDoPeriodo(estado, DATA, ARVORE, 10);
    // outubro (desmarca), setembro (soma), 2026 (desmarca o ano), 2025 (soma o ano).
    expect(out).toHaveLength(4);
    const meses = (e: (typeof out)[number]) =>
      e.filtros.find((f) => f.nivel === 'Mês')?.valores ?? [];
    const anos = (e: (typeof out)[number]) =>
      e.filtros.find((f) => f.nivel === 'Ano')?.valores ?? [];
    expect(meses(out[0]!)).toEqual([]);
    expect(meses(out[1]!)).toEqual(['setembro', 'outubro']);
    expect(anos(out[3]!)).toEqual([2025, 2026]);
    // O período passou a ser do controle: a marca de clique sai, como em `mudaFiltro`.
    expect(out.every((e) => e.clicados.length === 0)).toBe(true);
  });

  it('sem ano marcado, os meses vêm do ano mais recente; respeita o teto', () => {
    const out = estadosDoPeriodo({ filtros: [], clicados: [] }, DATA, ARVORE, 3);
    expect(out).toHaveLength(3);
    expect(out[0]!.filtros.find((f) => f.nivel === 'Mês')?.valores).toEqual(['outubro']);
    expect(out[0]!.filtros.find((f) => f.nivel === 'Ano')?.valores).toEqual([2026]);
  });
});
