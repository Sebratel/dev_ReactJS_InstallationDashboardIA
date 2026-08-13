// A gravação de tabela calculada — e o bug que ela deixou passar por um commit.
//
// `escreve` lê `linha[nome]` com o nome do **modelo**; o `Dataset` guarda a linha sob
// a chave **normalizada**. Sem `paraGravacao`, toda coluna cujo nome difere do
// normalizado ia para o disco como `null`, e ia calada: `apuraColunas` registra a
// coluna como `tipo: 'vazia'` sem reclamar de nada.
//
// Aconteceu de verdade, e o tamanho importa: `'CALENDARIO CRIADO'[DATA CRIADO]` gravou
// 365 nulos, `'CALENDARIO INSTALADO'[DATA INSTALADO]` idem, e a tabela `calendar`
// gravou 30.009 linhas com as **duas** colunas vazias. São chaves de relacionamento:
// o dashboard lia zero e não tinha como saber.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeName } from '../../semantic-model/src/model.ts';
import type { ModelColumn, ModelTable } from '../../semantic-model/src/types.ts';
import { escreve, le } from '../src/formato.ts';
import { dependeDoRelogio, mesmoDiaLocal, paraGravacao } from '../src/tabelas-calculadas.ts';

/** Uma linha como o `Dataset` a guarda: chaves normalizadas. */
function linhaDoDataset(pares: Record<string, unknown>): Record<string, never> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(pares)) out[normalizeName(k)] = v;
  return out as Record<string, never>;
}

/**
 * **O teste central.** Coluna com nome que difere do normalizado tem de chegar ao
 * arquivo com valor. Se ele cair, a classe inteira de bug voltou.
 */
test('coluna cujo nome difere do normalizado é gravada com valor, não com null', () => {
  const linhas = [
    linhaDoDataset({ 'DATA CRIADO': '2026-01-01', PESO: 1 }),
    linhaDoDataset({ 'DATA CRIADO': '2026-01-02', PESO: 0.5 }),
  ];
  const prontas = paraGravacao(linhas, ['DATA CRIADO', 'PESO'], 'teste');
  assert.deepEqual(prontas, [
    { 'DATA CRIADO': '2026-01-01', PESO: 1 },
    { 'DATA CRIADO': '2026-01-02', PESO: 0.5 },
  ]);
});

/** A mutação: sem a projeção, é isto que ia para o disco. */
test('sem a projeção, a leitura pelo nome do modelo daria undefined', () => {
  const linha = linhaDoDataset({ 'DATA CRIADO': '2026-01-01' });
  assert.equal(linha['DATA CRIADO' as never], undefined, 'a chave crua não existe na linha');
  assert.equal(linha[normalizeName('DATA CRIADO') as never], '2026-01-01');
});

test('linha já preenchida sob o nome de exibição também é encontrada', () => {
  // É o caso das colunas calculadas antigas, que eram gravadas sob o nome cru.
  const linha = { 'Rank Protocolo Dia': 7 } as Record<string, never>;
  assert.deepEqual(paraGravacao([linha], ['Rank Protocolo Dia'], 'teste'), [
    { 'Rank Protocolo Dia': 7 },
  ]);
});

/**
 * O guarda. Coluna do modelo que **não existe** na linha é erro; coluna
 * legitimamente vazia continua passando.
 */
test('coluna que não existe na linha erra alto, dizendo quais', () => {
  const linhas = [linhaDoDataset({ A: 1 })];
  assert.throws(
    () => paraGravacao(linhas, ['A', 'B', 'C'], 'MINHA TABELA'),
    /MINHA TABELA.*2 coluna\(s\).*B, C.*coluna inteira nula/s,
  );
});

test('coluna presente e nula passa — vazio legítimo não é erro', () => {
  const linhas = [linhaDoDataset({ A: null })];
  assert.deepEqual(paraGravacao(linhas, ['A'], 'teste'), [{ A: null }]);
});

test('tabela sem linha nenhuma não dispara o guarda', () => {
  assert.deepEqual(paraGravacao([], ['A', 'B'], 'teste'), []);
});

// ---------------------------------------------------------------------------
// A obsolescência que o `daxSha` não vê: o DAX não mudou, o DIA mudou
// ---------------------------------------------------------------------------

function coluna(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

function tabela(tableDax: string | null, colunas: ModelColumn[]): ModelTable {
  return { id: 't', name: 'T', queryRef: null, tableDax, columns: colunas };
}

test('TODAY() no corpo da tabela conta como dependência de relógio', () => {
  assert.equal(dependeDoRelogio(tabela('CALENDAR(TODAY(), TODAY()+30)', [])), true);
});

test('TODAY() numa coluna calculada da tabela também conta', () => {
  const t = tabela("DISTINCT('OS'[CIDADE])", [
    coluna('CIDADE'),
    coluna('VIGENTE', { calculated: true, dax: 'IF([DATA] <= TODAY(), "Sim", "Não")' }),
  ]);
  assert.equal(dependeDoRelogio(t), true);
});

test('NOW, UTCNOW e UTCTODAY contam; SNOWFLAKE não vira NOW por causa do sufixo', () => {
  assert.equal(dependeDoRelogio(tabela('NOW()', [])), true);
  assert.equal(dependeDoRelogio(tabela('UTCNOW()', [])), true);
  assert.equal(dependeDoRelogio(tabela('UTCTODAY()', [])), true);
  assert.equal(dependeDoRelogio(tabela("SUM('T'[SNOWNOW])", [])), false);
});

/**
 * O literal de texto não é chamada de função. Sem isto, uma tabela que só *escreve*
 * "NOW()" num rótulo seria recalculada toda meia-noite — e se ela fosse a de 2,4 h,
 * o guarda passaria a ser o problema.
 */
test('a palavra dentro de um literal de texto não conta', () => {
  const t = tabela(null, [
    coluna('R', { calculated: true, dax: 'IF([X] = 1, "atualizado em NOW()", "antigo")' }),
  ]);
  assert.equal(dependeDoRelogio(t), false);
});

test('tabela sem relógio nenhum é falso — é o caso das caras', () => {
  const t = tabela("DISTINCT('FIELD AGENDA'[Slot])", [
    coluna('Slot'),
    coluna('Rank', { calculated: true, dax: "RANKX(ALL('T'), 'T'[Slot])" }),
  ]);
  assert.equal(dependeDoRelogio(t), false);
});

test('mesmoDiaLocal compara o dia do calendário, não o instante', () => {
  assert.equal(mesmoDiaLocal(new Date(2026, 7, 13, 0, 1), new Date(2026, 7, 13, 23, 59)), true);
  assert.equal(mesmoDiaLocal(new Date(2026, 7, 13, 23, 59), new Date(2026, 7, 14, 0, 1)), false);
  assert.equal(mesmoDiaLocal(new Date(2025, 7, 13), new Date(2026, 7, 13)), false);
});

/**
 * Ponta a ponta contra o formato real: grava e lê de volta. É o teste que teria
 * pegado o bug original, porque o bug só aparecia depois de `escreve`.
 */
test('ida e volta pelo arquivo preserva o valor da coluna de nome composto', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calc-'));
  const arq = path.join(dir, 'calc.teste.jsonl');
  const linhas = [linhaDoDataset({ 'DATA CRIADO': new Date('2026-01-01T00:00:00.000Z'), PESO: 1 })];

  const cab = await escreve(
    arq,
    { query: 'calc.teste', tabelas: ['T'], geradoEm: '2026-08-11T00:00:00.000Z' },
    ['DATA CRIADO', 'PESO'],
    paraGravacao(linhas, ['DATA CRIADO', 'PESO'], 'T') as never,
  );

  const data = cab.colunas.find((c) => c.nome === 'DATA CRIADO')!;
  assert.notEqual(data.tipo, 'vazia', 'a coluna não pode sair vazia');
  assert.equal(data.nulos, 0);

  const lido = await le(arq);
  assert.equal(lido.linhas.length, 1);
});
