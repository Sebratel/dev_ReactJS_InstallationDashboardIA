// Testes do SemanticModel. Os unitários montam o modelo à mão; o bloco final
// carrega as specs reais e é a âncora de regressão do extrator.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SemanticModel, normalizeName } from '../src/model.ts';
import { affectedOwners, blockingProblems, checkModelRefs } from '../src/check.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPECS = path.join(ROOT, 'specs');

function modeloMinimo(): SemanticModel {
  const m = new SemanticModel();
  m.addTable({
    id: 'protocolos-geral',
    name: 'PROTOCOLOS GERAL',
    queryRef: 'protocolos-geral',
    columns: [
      { name: 'SOLICITACAO', type: 'string', format: null, sourceColumn: 'SOLICITACAO', calculated: false, dax: null },
      { name: 'DATA INSTALAÇÃO', type: null, format: null, sourceColumn: 'DATA INSTALAÇÃO', calculated: false, dax: null },
      { name: 'TMA', type: null, format: null, sourceColumn: null, calculated: true, dax: 'FORMAT(1, "0")' },
    ],
  });
  m.addTable({
    id: 'calendario-instalado',
    name: 'CALENDARIO INSTALADO',
    queryRef: null,
    columns: [
      { name: 'DATA INSTALADO', type: null, format: null, sourceColumn: '[Date]', calculated: false, dax: null },
      { name: 'PESO', type: null, format: null, sourceColumn: null, calculated: true, dax: 'IF(1=1, 1, 0)' },
    ],
  });
  m.addMeasure({
    name: '# MEDIA AGENDADO',
    table: 'PROTOCOLOS GERAL',
    format: '0',
    displayFolder: null,
    dax: "SUM('CALENDARIO INSTALADO'[PESO])",
  });
  return m;
}

test('normalizeName: identificador DAX não distingue caixa', () => {
  assert.equal(normalizeName('FIELD AGENDA'), normalizeName('Field Agenda'));
  assert.equal(normalizeName('  Protocolo '), 'protocolo');
});

test('resolve tabela, coluna e medida sem depender da caixa', () => {
  const m = modeloMinimo();
  // Não é conveniência: no modelo real a mesma tabela aparece como
  // 'FIELD AGENDA' e 'Field Agenda', e a coluna como [Protocolo] e [protocolo].
  assert.ok(m.table('protocolos geral'));
  assert.ok(m.column('Protocolos Geral', 'solicitacao'));
  assert.ok(m.measure('# media agendado'));
  assert.equal(m.table('NÃO EXISTE'), null);
  assert.equal(m.column('PROTOCOLOS GERAL', 'NÃO EXISTE'), null);
  assert.equal(m.measure('NÃO EXISTE'), null);
});

test('tabela duplicada é erro, não sobrescrita silenciosa', () => {
  const m = modeloMinimo();
  assert.throws(
    () => m.addTable({ id: 'outra', name: 'protocolos geral', queryRef: null, columns: [] }),
    /duplicada/i,
  );
});

test('medida duplicada é erro: em DAX o nome é único no modelo inteiro', () => {
  const m = modeloMinimo();
  assert.throws(
    () =>
      m.addMeasure({
        name: '# MEDIA AGENDADO',
        table: 'CALENDARIO INSTALADO',
        format: null,
        displayFolder: null,
        dax: '1',
      }),
    /duplicada/i,
  );
});

test('calculatedColumns só devolve coluna calculada com DAX', () => {
  const m = modeloMinimo();
  const nomes = m.calculatedColumns.map((c) => `${c.table.name}[${c.column.name}]`).sort();
  assert.deepEqual(nomes, ['CALENDARIO INSTALADO[PESO]', 'PROTOCOLOS GERAL[TMA]']);
});

test('checkModelRefs: referência boa não vira problema', () => {
  const problemas = blockingProblems(checkModelRefs(modeloMinimo()));
  assert.deepEqual(problemas, []);
});

test('checkModelRefs: tabela inexistente é erro', () => {
  const m = modeloMinimo();
  m.addMeasure({
    name: 'QUEBRADA',
    table: 'PROTOCOLOS GERAL',
    format: null,
    displayFolder: null,
    dax: "CALCULATE([# MEDIA AGENDADO], GESTORES[GERENTE] = \"X\")",
  });
  const erros = blockingProblems(checkModelRefs(m));
  assert.equal(erros.length, 1);
  assert.equal(erros[0].kind, 'tabela-inexistente');
  assert.match(erros[0].detail, /GESTORES/);
});

test('checkModelRefs: coluna inexistente em tabela que existe é erro', () => {
  const m = modeloMinimo();
  m.addMeasure({
    name: 'QUEBRADA2',
    table: 'PROTOCOLOS GERAL',
    format: null,
    displayFolder: null,
    dax: "SUM('CALENDARIO INSTALADO'[NAO_EXISTE])",
  });
  const erros = blockingProblems(checkModelRefs(m));
  assert.equal(erros.length, 1);
  assert.equal(erros[0].kind, 'coluna-inexistente');
});

test('checkModelRefs: a mesma referência errada repetida conta uma vez', () => {
  const m = modeloMinimo();
  m.addMeasure({
    name: 'REPETE',
    table: 'PROTOCOLOS GERAL',
    format: null,
    displayFolder: null,
    dax: 'GESTORES[X] + GESTORES[X] + GESTORES[X]',
  });
  const erros = blockingProblems(checkModelRefs(m)).filter((p) => p.owner.includes('REPETE'));
  assert.equal(erros.length, 1, 'sem isso o relatório vira ruído');
});

test('checkModelRefs: [Nome] resolve para coluna da própria tabela', () => {
  const m = modeloMinimo();
  m.addMeasure({
    name: 'USA COLUNA LOCAL',
    table: 'PROTOCOLOS GERAL',
    format: null,
    displayFolder: null,
    dax: 'COUNT([SOLICITACAO])',
  });
  assert.deepEqual(blockingProblems(checkModelRefs(m)), []);
});

// ---------- Integração: specs reais ----------
test('specs reais: o modelo carrega completo', () => {
  const m = SemanticModel.fromSpecsDir(SPECS);
  assert.equal(m.tables.size, 25, 'tabelas');
  assert.equal(m.measures.length, 78, 'medidas');
  assert.equal(m.calculatedColumns.length, 43, 'colunas calculadas com DAX');
  assert.equal(m.relationships.length, 22, 'relacionamentos');
  assert.ok(m.autoDateRelationshipsIgnored > 0, 'hierarquia de datas contada');
});

test('specs reais: nenhuma medida chega vazia ou com cerca do TMDL', () => {
  const m = SemanticModel.fromSpecsDir(SPECS);
  for (const med of m.measures) {
    assert.ok(med.dax.trim().length > 0, `${med.table}[${med.name}] sem DAX`);
    assert.ok(!med.dax.includes('```'), `${med.table}[${med.name}] com cerca do TMDL`);
  }
  for (const { table, column } of m.calculatedColumns) {
    assert.ok(!column.dax!.includes('```'), `${table.name}[${column.name}] com cerca do TMDL`);
  }
});

test('specs reais: PESO existe e depende de FERIADOS', () => {
  const m = SemanticModel.fromSpecsDir(SPECS);
  const peso = m.column('CALENDARIO INSTALADO', 'PESO');
  assert.ok(peso, 'PESO existe');
  assert.equal(peso.calculated, true);
  // PESO é a regra de dia útil que seis medidas somam. Como ela consulta
  // FERIADOS — que para em 2025 — o achado 1 de docs/ACHADOS.md alcança todas
  // elas, não só `# MEDIA CRIADOS`.
  assert.match(peso.dax!, /FERIADOS/);
});

test('specs reais: o relacionamento inativo continua inativo', () => {
  const m = SemanticModel.fromSpecsDir(SPECS);
  const inativos = m.relationships.filter((r) => !r.active);
  assert.equal(inativos.length, 1);
  // Tratar inativo como ativo faria PROTOCOLOS PRODUTIVIDADE filtrar
  // PROTOCOLOS GERAL fora de USERELATIONSHIP e mudaria números.
  assert.equal(inativos[0].fromTable, 'PROTOCOLOS PRODUTIVIDADE');
  assert.ok(!m.activeRelationshipsFor('PROTOCOLOS PRODUTIVIDADE').some((r) => !r.active));
});

// Este teste é o registro executável do achado 6 de docs/ACHADOS.md.
// Se um novo DAX quebrado entrar no PBIP, ele falha aqui em vez de aparecer
// como resultado errado na Fase 2.
const REFERENCIAS_QUEBRADAS_CONHECIDAS = [
  'PROTOCOLOS GERAL[# AA MÉDIA EQUIPES]',
  'PROTOCOLOS GERAL[# AA MÉDIA GERAL]',
  'PROTOCOLOS GERAL[# AA TOTAL EQUIPES]',
];

test('specs reais: só as 3 referências quebradas já conhecidas', () => {
  const m = SemanticModel.fromSpecsDir(SPECS);
  const problemas = checkModelRefs(m);
  assert.deepEqual(
    affectedOwners(problemas),
    REFERENCIAS_QUEBRADAS_CONHECIDAS,
    'referência quebrada nova (ou corrigida) — atualize docs/ACHADOS.md achado 6',
  );
});

test('specs reais: nenhum aviso sobrando — se sobrar, o scanner está errado', () => {
  const m = SemanticModel.fromSpecsDir(SPECS);
  const avisos = checkModelRefs(m).filter((p) => p.severity === 'aviso');
  assert.deepEqual(
    avisos.map((a) => `${a.owner}: ${a.detail}`),
    [],
    'palavra não resolvida: ou é tabela que falta, ou é palavra-chave DAX faltando em DAX_KEYWORDS',
  );
});
