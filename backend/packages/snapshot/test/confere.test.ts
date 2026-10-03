// A conferência do snapshot — e a razão de ela existir separada do carregamento.
//
// Coluna inteira nula é calada por construção: `apuraColunas` a registra como
// `tipo: 'vazia'` sem reclamar, o carregamento a lê como BLANK, e o visual mostra
// vazio como se o filtro estivesse apertado. Foi assim que 6 arquivos da base
// chegaram a 13/08/2026 com coluna morta dentro sem ninguém saber.
//
// O que este arquivo trava: que **usada** e **não usada** têm gravidades diferentes.
// Chamar de erro toda coluna vazia ensinaria a ignorar o comando; chamar de aviso a
// que alguém lê esconderia o número errado.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { ColunasUsadas } from '../src/colunas-usadas.ts';
import {
  confereSnapshot,
  contaPorGravidade,
  type ArquivoDeSnapshot,
} from '../src/confere.ts';
import type { CabecalhoDeSnapshot, ColunaDeSnapshot } from '../src/formato.ts';

function coluna(nome: string, nulos: number, tipo: ColunaDeSnapshot['tipo'] = 'string'): ColunaDeSnapshot {
  return { nome, tipo, nulos };
}

function arquivo(
  nome: string,
  cab: Partial<CabecalhoDeSnapshot> & Pick<CabecalhoDeSnapshot, 'linhas' | 'colunas'>,
): ArquivoDeSnapshot {
  return {
    arquivo: nome,
    calculada: nome.startsWith('calc.'),
    cabecalho: {
      formato: 1,
      query: nome.replace('.jsonl', ''),
      tabelas: ['T'],
      geradoEm: '2026-08-12T12:00:00.000Z',
      ...cab,
    },
  };
}

/** `colunasUsadas` devolve tabela normalizada → conjunto de colunas normalizadas. */
function usadas(pares: Record<string, string[]>): ColunasUsadas {
  return new Map(Object.entries(pares).map(([t, cs]) => [t, new Set(cs)]));
}

// ---------------------------------------------------------------------------
// Coluna inteira nula
// ---------------------------------------------------------------------------

test('coluna só de nulos que alguém lê é ERRO', () => {
  const p = confereSnapshot(
    [arquivo('t.jsonl', { linhas: 100, colunas: [coluna('A', 0), coluna('B', 100)] })],
    usadas({ t: ['a', 'b'] }),
  );
  assert.equal(p.length, 1);
  assert.equal(p[0]!.gravidade, 'erro');
  assert.match(p[0]!.onde, /'T'\[B\]/);
  assert.match(p[0]!.detalhe, /100 linhas, todas nulas/);
  assert.match(p[0]!.detalhe, /leem BLANK/);
});

test('coluna só de nulos que ninguém lê é AVISO — ruído não vira falha', () => {
  const p = confereSnapshot(
    [arquivo('t.jsonl', { linhas: 100, colunas: [coluna('B', 100)] })],
    usadas({ t: ['a'] }),
  );
  assert.equal(p[0]!.gravidade, 'aviso');
  assert.match(p[0]!.detalhe, /Ninguém a lê hoje/);
});

test("tipo 'vazia' conta igual a nulos == linhas", () => {
  const p = confereSnapshot(
    [arquivo('t.jsonl', { linhas: 5, colunas: [coluna('B', 5, 'vazia')] })],
    usadas({ t: ['b'] }),
  );
  assert.equal(p.length, 1);
});

/**
 * **A pista que economiza a investigação.** Nome com ponto veio de
 * `Table.ExpandTableColumn`, e mescla inteira nula é a assinatura de uma junção que
 * não casou nunca — o mesmo erro do #58, um andar abaixo, dentro da camada M.
 */
test('coluna de mescla diz que é de mescla e manda conferir o tipo das chaves', () => {
  const p = confereSnapshot(
    [arquivo('t.jsonl', { linhas: 9, colunas: [coluna('TECNICOS AUXILIARES.AUXILIAR', 9)] })],
    usadas({ t: ['tecnicos auxiliares.auxiliar'] }),
  );
  assert.match(p[0]!.detalhe, /expansão de mescla/);
  assert.match(p[0]!.detalhe, /m_expression/);
});

test('coluna preenchida, ainda que com muitos nulos, não é apontada', () => {
  const p = confereSnapshot(
    [arquivo('t.jsonl', { linhas: 100, colunas: [coluna('B', 99)] })],
    usadas({ t: ['b'] }),
  );
  assert.deepEqual(p, []);
});

test('tabela sem linha nenhuma não vira 30 problemas de coluna vazia', () => {
  const p = confereSnapshot(
    [arquivo('t.jsonl', { linhas: 0, colunas: [coluna('A', 0), coluna('B', 0)] })],
    usadas({ t: ['a', 'b'] }),
  );
  assert.deepEqual(p, []);
});

test('sem modelo, tudo cai para aviso — não se afirma o que não se sabe', () => {
  const p = confereSnapshot(
    [arquivo('t.jsonl', { linhas: 3, colunas: [coluna('B', 3)] })],
    null,
  );
  assert.equal(p[0]!.gravidade, 'aviso');
});

// ---------------------------------------------------------------------------
// Tabela calculada mais velha que o dado dela
// ---------------------------------------------------------------------------

test('calculada congelada antes da query mais nova é ERRO, e diz o comando', () => {
  const p = confereSnapshot(
    [
      arquivo('q.jsonl', { linhas: 1, colunas: [coluna('A', 0)], geradoEm: '2026-08-12T14:00:00.000Z' }),
      arquivo('calc.c.jsonl', {
        linhas: 1, colunas: [coluna('A', 0)],
        tabelas: ['MINHA CALC'], geradoEm: '2026-08-11T09:00:00.000Z',
      }),
    ],
    usadas({}),
  );
  assert.equal(p.length, 1);
  assert.equal(p[0]!.tipo, 'calculada-obsoleta');
  // Com ASPAS: o nome tem espaço, e o comando existe para ser colado num terminal.
  // Sem elas, `--tabela=MINHA CALC` vira `--tabela=MINHA` mais um argumento solto —
  // um remédio impresso que não funciona justamente onde o nome é composto, que é o
  // caso de duas das tabelas calculadas reais (`Status Protocolo Dia`).
  assert.match(p[0]!.detalhe, /npm run snapshot:calculadas -- --tabela="MINHA CALC"/);
});

test('calculada mais nova que toda query está em dia', () => {
  const p = confereSnapshot(
    [
      arquivo('q.jsonl', { linhas: 1, colunas: [coluna('A', 0)], geradoEm: '2026-08-12T14:00:00.000Z' }),
      arquivo('calc.c.jsonl', { linhas: 1, colunas: [coluna('A', 0)], geradoEm: '2026-08-13T09:00:00.000Z' }),
    ],
    usadas({}),
  );
  assert.deepEqual(p, []);
});

/** Uma calculada velha em relação a **outra calculada** não é problema: só query conta. */
test('a comparação é contra query, não contra outra calculada', () => {
  const p = confereSnapshot(
    [
      arquivo('calc.a.jsonl', { linhas: 1, colunas: [coluna('A', 0)], geradoEm: '2026-08-13T20:00:00.000Z' }),
      arquivo('calc.b.jsonl', { linhas: 1, colunas: [coluna('A', 0)], geradoEm: '2026-08-13T09:00:00.000Z' }),
    ],
    usadas({}),
  );
  assert.deepEqual(p, []);
});

test('contaPorGravidade separa o que derruba o comando do que só informa', () => {
  const p = confereSnapshot(
    [
      arquivo('t.jsonl', { linhas: 4, colunas: [coluna('A', 4), coluna('B', 4)] }),
    ],
    usadas({ t: ['a'] }),
  );
  assert.deepEqual(contaPorGravidade(p), { erro: 1, aviso: 1 });
});
