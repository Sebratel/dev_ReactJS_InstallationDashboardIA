// O snapshot do período tem de ser o que o refresh grava: os cabeçalhos que o carregador
// confere (tabelas da query, `tabelaSha` da calculada, o mesmo `geradoEm`), as queries
// pequenas copiadas sem mudar um byte, e a calculada com as colunas do modelo.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import { escreve, le, leCabecalho } from '../../snapshot/src/formato.ts';
import { arquivoDaQuery, arquivoDeEscrita, leManifesto } from '../../snapshot/src/manifesto.ts';
import { arquivoDaCalculada, shaDaCalculada } from '../../snapshot/src/tabelas-calculadas.ts';
import { calculadasCongeladas, escreveSnapshotDoPeriodo } from '../src/snapshot-do-periodo.ts';

const SPECS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'specs');
const model = SemanticModel.fromSpecsDir(SPECS);
const GERADO = '2026-10-23T12:00:00.000Z';

const temporario = (t: { after: (f: () => void) => void }): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-vivo-teste-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const status = [
  { dia: new Date('2026-09-10T00:00:00Z'), status: 'Produtivo', protocolo: '1', 'base dia': 'Canoas', 'turno dia': 'Manhã', 'rank protocolo dia': 1, 'tipo protocolo dia': 'TEC - Instalação' },
  { dia: new Date('2026-09-11T00:00:00Z'), status: 'Sem Ação', protocolo: '2', 'base dia': 'Canoas', 'turno dia': 'Tarde', 'rank protocolo dia': 1, 'tipo protocolo dia': 'TEC - Troca' },
];

test('grava as queries, copia as pequenas e grava Status Protocolo Dia pronta como o refresh', async (t) => {
  const origem = temporario(t);
  const dir = temporario(t);
  // Uma query pequena "do snapshot de hoje", com carimbo próprio.
  await escreve(arquivoDeEscrita(origem, 'hora-atualizado', true), { query: 'hora-atualizado', tabelas: ['HORA ATUALIZADO'], geradoEm: '2026-10-23T11:50:00.000Z' }, ['Hora'], [{ Hora: 'x' }]);

  await escreveSnapshotDoPeriodo(
    dir,
    model,
    {
      consultas: [{ query: 'field-agenda-slot', colunas: ['Protocolo', 'Slot Agenda'], linhas: [{ Protocolo: '1', 'Slot Agenda': new Date('2026-09-10T08:00:00Z') }] }],
      // Como `congelaStatusDoDia` a entrega, depois da tradução nativa.
      calculadas: [{ tabela: 'Status Protocolo Dia', linhas: status }],
    },
    GERADO,
    { dir: origem, queries: ['hora-atualizado'] },
  );

  const agenda = leCabecalho(arquivoDaQuery(dir, 'field-agenda-slot'));
  assert.deepEqual(agenda.tabelas, ['FIELD AGENDA'], 'a query padrão do grão reduzido carrega FIELD AGENDA');
  assert.equal(agenda.geradoEm, GERADO);

  const copiada = arquivoDaQuery(dir, 'hora-atualizado');
  assert.deepEqual(fs.readFileSync(copiada), fs.readFileSync(arquivoDaQuery(origem, 'hora-atualizado')), 'cópia byte a byte');

  const t0 = model.table('Status Protocolo Dia')!;
  const calc = leCabecalho(arquivoDaCalculada(dir, t0.name));
  assert.equal(calc.tabelaSha, shaDaCalculada(t0));
  assert.equal(calc.geradoEm, GERADO, 'a calculada não pode ser mais velha que as origens');
  assert.deepEqual(
    calc.colunas.map((c) => c.nome),
    [...t0.columns.filter((c) => !c.calculated), ...t0.columns.filter((c) => c.calculated && c.dax)].map((c) => c.name),
    'as físicas e depois as calculadas, como calculadas.ts grava',
  );
  const { linhas } = await le(arquivoDaCalculada(dir, t0.name));
  assert.equal(linhas.length, 2);
  assert.equal(linhas.filter((l) => l['status'] === 'Produtivo').length, 1);

  const m = leManifesto(dir)!;
  assert.deepEqual(m.tabelas.map((e) => e.query), ['field-agenda-slot', 'hora-atualizado']);
});

test('a calculada congelada vem do snapshot de hoje com o carimbo novo — e recusa se o DAX mudou', async (t) => {
  const origem = temporario(t);
  const tCal = model.table('CALENDARIO INSTALADO')!;
  const nomes = [...tCal.columns.filter((c) => !c.calculated), ...tCal.columns.filter((c) => c.calculated && c.dax)].map((c) => c.name);
  const linha = Object.fromEntries(nomes.map((n) => [n, null])) as Record<string, null | Date>;
  linha['DATA INSTALADO'] = new Date('2025-01-02T00:00:00Z');
  const cab = { query: 'calc.calendario-instalado', tabelas: [tCal.name], geradoEm: '2026-10-24T03:00:00.000Z' };
  await escreve(arquivoDaCalculada(origem, tCal.name), { ...cab, tabelaSha: shaDaCalculada(tCal) }, nomes, [linha]);

  const prontas = await calculadasCongeladas(origem, model, ['CALENDARIO INSTALADO']);
  assert.equal(prontas[0]!.linhas.length, 1);
  const dir = temporario(t);
  await escreveSnapshotDoPeriodo(dir, model, { consultas: [], calculadas: prontas }, GERADO);
  const gravada = leCabecalho(arquivoDaCalculada(dir, tCal.name));
  assert.equal(gravada.geradoEm, GERADO, 'o carimbo é o do snapshot do período — senão o carregador a recusaria por idade');
  assert.equal(gravada.tabelaSha, shaDaCalculada(tCal));
  const { linhas } = await le(arquivoDaCalculada(dir, tCal.name));
  assert.equal((linhas[0]!['data instalado'] as Date).toISOString(), '2025-01-02T00:00:00.000Z', 'o calendário de 2025 sobrevive');

  const velha = temporario(t);
  await escreve(arquivoDaCalculada(velha, tCal.name), { ...cab, tabelaSha: 'outro-dax' }, nomes, [linha]);
  await assert.rejects(calculadasCongeladas(velha, model, ['CALENDARIO INSTALADO']), /mudou desde o congelamento/);
  await assert.rejects(calculadasCongeladas(temporario(t), model, ['CALENDARIO INSTALADO']), /não está em/);
});

test('recusa pasta com coisa dentro e query pequena que não existe na origem', async (t) => {
  const dir = temporario(t);
  fs.writeFileSync(path.join(dir, 'resto.txt'), 'x');
  await assert.rejects(escreveSnapshotDoPeriodo(dir, model, { consultas: [], statusProtocoloDia: [] }, GERADO), /não está vazio/);

  const vazio = temporario(t);
  const origem = temporario(t);
  await assert.rejects(
    escreveSnapshotDoPeriodo(vazio, model, { consultas: [], statusProtocoloDia: [] }, GERADO, { dir: origem, queries: ['clima-tempo'] }),
    /'clima-tempo' não está em/,
  );
});
