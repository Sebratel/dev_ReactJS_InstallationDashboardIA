// O período ao vivo sai da segmentação da tela, e só dela. O primeiro teste é o que
// importa: o filtro com que `agendamento-field` ABRE (o mês corrente, `filtros-padrao.ts`),
// pelo mesmo caminho da URL, dá o mês inteiro — se a forma do filtro padrão mudar, o ao
// vivo deixa de valer para a abertura da página, e este teste é quem avisa.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import { codificaFiltro, decodificaFiltros, type FiltroDeTela } from '../../widget-engine/src/filtro-url.ts';
import { filtrosPadrao } from '../../widget-engine/src/filtros-padrao.ts';
import { loadDashboards } from '../../widget-engine/src/spec.ts';
import { decideAoVivo, periodoDaTela, visuaisForaDoAoVivo } from '../src/periodo.ts';

const SPECS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'specs');
const model = SemanticModel.fromSpecsDir(SPECS);
const dash = loadDashboards(SPECS).find((d) => d.id === 'agendamento-field')!;

const daTela = (fs: FiltroDeTela[]) => decodificaFiltros(fs.map(codificaFiltro));
const cal = (nivel: string | null, valores: (string | number)[]): FiltroDeTela => ({
  tabela: 'calendar',
  coluna: 'Data',
  ...(nivel ? { nivel } : {}),
  valores,
});

test('o filtro com que a página abre dá o mês inteiro', () => {
  for (const hoje of [new Date(2026, 8, 15), new Date(2026, 11, 3), new Date(2027, 0, 31)]) {
    const p = periodoDaTela(daTela(filtrosPadrao('agendamento-field', hoje)));
    assert.ok('periodo' in p, JSON.stringify(p));
    const ini = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), 1));
    const fim = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() + 1, 1));
    assert.deepEqual(p.periodo, { desde: ini.toISOString().slice(0, 10), ate: fim.toISOString().slice(0, 10) });
  }
});

test('dezembro termina no ano seguinte; meses salteados viram o intervalo que os cobre', () => {
  assert.deepEqual(periodoDaTela(daTela([cal('Ano', [2026]), cal('Mês', ['dezembro'])])), {
    periodo: { desde: '2026-12-01', ate: '2027-01-01' },
  });
  assert.deepEqual(periodoDaTela(daTela([cal('Ano', ['2026']), cal('Mês', ['setembro', 'agosto'])])), {
    periodo: { desde: '2026-08-01', ate: '2026-10-01' },
  });
});

test('sem período reconhecível, o pedido fica no snapshot — e diz por quê', () => {
  const casos: [FiltroDeTela[], RegExp][] = [
    [[], /sem segmentação/],
    [[cal('Mês', ['setembro'])], /mês sem ano/],
    [[cal('Ano', [2026])], /366|365|acima do teto/],
    [[cal('Ano', [2026]), cal('Mês', ['janeiro', 'abril'])], /acima do teto/],
    [[cal('Ano', [2026]), cal('Mês', ['setembro']), cal('Dia', [3])], /nível Dia/],
    [[cal(null, ['2026-09-03'])], /data crua/],
    [[cal('Ano', [2026]), cal('Mês', ['setembr'])], /não é um mês/],
  ];
  for (const [filtros, motivo] of casos) {
    const p = periodoDaTela(daTela(filtros));
    assert.ok('porque' in p, `${JSON.stringify(filtros)} deveria ficar no snapshot`);
    assert.match(p.porque, motivo);
  }
});

test('ficam fora os 6 visuais do grão relato e o horizonte de previsão', () => {
  const fora = visuaisForaDoAoVivo(dash, model);
  assert.equal(fora.size, 7);
  assert.match(fora.get('56d3352b476659cd7972') ?? '', /horizonte de previsão/);
  assert.equal([...fora.values()].filter((p) => /grão relato/.test(p)).length, 6);
});

test('filtro de tela em coluna gatilho tira o pedido inteiro do ao vivo', () => {
  const d = decideAoVivo(dash, daTela([cal('Ano', [2026]), cal('Mês', ['setembro']), { tabela: 'FIELD AGENDA', coluna: 'ClassificacaoRelato', valores: ['x'] }]), model);
  assert.ok('porque' in d);
  assert.match(d.porque, /ClassificacaoRelato/);
  const ok = decideAoVivo(dash, daTela([cal('Ano', [2026]), cal('Mês', ['setembro']), { tabela: 'FIELD AGENDA', coluna: 'Base', valores: ['x'] }]), model);
  assert.ok('periodo' in ok, 'filtro em coluna de slot continua ao vivo');
});
