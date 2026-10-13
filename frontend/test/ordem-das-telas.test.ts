import { expect, test } from 'vitest';
import { nomeDaAba, ordenaTelas } from '../src/utils/ordemDasTelas.ts';

test('as abas seguem a ordem do relatório original, com a capa primeiro', () => {
  const daApi = [
    'agendamento-field',
    'capa',
    'diario-instalacao',
    'instalacao-reincidente',
    'manutencao-inicial',
    'premiacao-instalacao',
    'protocolos-detalhados',
    'relatorio-do-ano',
    'relatorio-do-mes',
    'telefonia-ouvidoria',
    'visao-geral',
  ].map((id) => ({ id }));
  expect(ordenaTelas(daApi).map((t) => t.id)).toEqual([
    'capa',
    'visao-geral',
    'agendamento-field',
    'relatorio-do-mes',
    'relatorio-do-ano',
    'premiacao-instalacao',
    'diario-instalacao',
    'protocolos-detalhados',
    'telefonia-ouvidoria',
    'manutencao-inicial',
    'instalacao-reincidente',
  ]);
});

test('tela nova, fora da lista, vai para o fim e não some', () => {
  const ids = ordenaTelas([{ id: 'nova' }, { id: 'capa' }, { id: 'outra' }]).map((t) => t.id);
  expect(ids).toEqual(['capa', 'nova', 'outra']);
});

test('a barra do nome ganha espaço dos dois lados', () => {
  expect(nomeDaAba('INSTALAÇÃO/ REINCIDENTE')).toBe('INSTALAÇÃO / REINCIDENTE');
  expect(nomeDaAba('TELEFONIA & OUVIDORIA')).toBe('TELEFONIA & OUVIDORIA');
});
