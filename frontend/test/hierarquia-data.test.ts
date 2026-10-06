import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clicaAno,
  clicaDia,
  clicaMes,
  limpaTudo,
  montaArvore,
  resumoDeData,
  selecaoDeData,
  type SelecaoDeData,
} from '../src/utils/hierarquiaData.ts';

const d = (iso: string) => ({ valor: iso });
const vazia: SelecaoDeData = { anos: [], meses: [], dias: [] };

test('a árvore só oferece mês e dia que existem na base', () => {
  const a = montaArvore([
    d('2026-01-02T00:00:00.000Z'),
    d('2026-01-05T00:00:00.000Z'),
    d('2026-03-01T00:00:00.000Z'),
  ]);
  const dois026 = a.find((x) => x.ano === 2026)!;
  assert.deepEqual(
    dois026.meses.map((m) => m.nome),
    ['janeiro', 'março'],
  );
  assert.deepEqual(dois026.meses[0]!.dias, [2, 5]);
});

test('2025 aparece mesmo sem dado, marcado como semDado', () => {
  // A origem de PROTOCOLOS GERAL corta em 2026-01-01 e o CALENDARIO INSTALADO começa
  // na menor data instalada: sem o piso, o seletor mostraria só 2026 e pareceria
  // defeito da tela. Com o piso, o ano é clicável e o motivo é dito.
  const a = montaArvore([d('2026-05-10T00:00:00.000Z')]);
  assert.deepEqual(
    a.map((x) => x.ano),
    [2025, 2026],
  );
  assert.equal(a[0]!.semDado, true);
  assert.equal(a[1]!.semDado, false);
});

test('data é lida em UTC — 01/01 não vira 31/12 do ano anterior', () => {
  const a = montaArvore([d('2026-01-01T00:00:00.000Z')], []);

  // A asserção era `a.map(x => x.ano)` igual a `[2026]`, e isso passou a testar
  // duas coisas ao mesmo tempo: a leitura em UTC E a ausência do piso de ano
  // vazio. Quando o piso entrou, este teste caiu sem que a leitura em UTC tivesse
  // qualquer problema. Agora ele verifica só o que o nome dele promete.
  const comDado = a.filter((x) => !x.semDado);
  assert.deepEqual(
    comDado.map((x) => x.ano),
    [2026],
    'o ano com dado é 2026, não 2025',
  );
  assert.deepEqual(
    comDado[0]!.meses.map((m) => m.nome),
    ['janeiro'],
    'janeiro, não dezembro',
  );
  assert.deepEqual(comDado[0]!.meses[0]!.dias, [1], 'dia 1, não 31');
});

test('época 1899 (campo só-de-hora) não vira ano na árvore', () => {
  const a = montaArvore([d('1899-12-30T18:23:00.000Z')], []);
  assert.deepEqual(a, []);
});

test('clicar num mês marca também o ano que o contém', () => {
  const m = clicaMes(vazia, 2026, 'janeiro');
  assert.deepEqual(m, [
    { nivel: 'Mês', valores: ['janeiro'] },
    { nivel: 'Ano', valores: [2026] },
  ]);
});

test('clicar num dia marca dia, mês e ano', () => {
  const m = clicaDia(vazia, 2026, 'março', 15);
  assert.deepEqual(m, [
    { nivel: 'Dia', valores: [15] },
    { nivel: 'Mês', valores: ['março'] },
    { nivel: 'Ano', valores: [2026] },
  ]);
});

test('desmarcar não cascateia: tirar o ano preserva o mês escolhido', () => {
  const sel: SelecaoDeData = { anos: [2026], meses: ['março'], dias: [] };
  assert.deepEqual(clicaAno(sel, 2026), [{ nivel: 'Ano', valores: [] }]);
});

test('desmarcar um dia não remarca o mês nem o ano', () => {
  const sel: SelecaoDeData = { anos: [2026], meses: ['março'], dias: [15] };
  assert.deepEqual(clicaDia(sel, 2026, 'março', 15), [{ nivel: 'Dia', valores: [] }]);
});

test('meses saem em ordem de calendário, não de clique', () => {
  const sel: SelecaoDeData = { anos: [2026], meses: ['março'], dias: [] };
  const mes = clicaMes(sel, 2026, 'janeiro').find((m) => m.nivel === 'Mês')!;
  assert.deepEqual(mes.valores, ['janeiro', 'março']);
});

test('limpar zera os três níveis — um filtro por nível, três remoções', () => {
  assert.deepEqual(limpaTudo(), [
    { nivel: 'Ano', valores: [] },
    { nivel: 'Mês', valores: [] },
    { nivel: 'Dia', valores: [] },
  ]);
});

test('a seleção sai dos filtros da tela, por nível', () => {
  const sel = selecaoDeData(
    [
      { tabela: 'T', coluna: 'D', nivel: 'Ano', valores: [2026] },
      { tabela: 'T', coluna: 'D', nivel: 'Mês', valores: ['agosto'] },
      { tabela: 'T', coluna: 'OUTRA', nivel: 'Dia', valores: [9] },
    ],
    'T',
    'D',
  );
  assert.deepEqual(sel, { anos: [2026], meses: ['agosto'], dias: [] });
});

test('o resumo do botão é curto e conta quando passa de dois', () => {
  assert.equal(resumoDeData(vazia), 'todo o período');
  assert.equal(resumoDeData({ anos: [2026], meses: ['agosto'], dias: [] }), '26 · ago');
  assert.equal(resumoDeData({ anos: [2025, 2026], meses: [], dias: [1] }), '25/26 · 01');
  assert.equal(
    resumoDeData({ anos: [2026], meses: ['janeiro', 'março', 'maio'], dias: [] }),
    '26 · 3 meses',
  );
});
