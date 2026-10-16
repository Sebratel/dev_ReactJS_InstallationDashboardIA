// O histórico congelado da `protocolos-geral`: o corte, a costura no SQL e o arquivo.
//
// A paridade da divisão (histórico ∪ recente = consulta inteira) é medida no banco, não
// aqui: `npm run probe:paridade-divisao`. Aqui fica o que dá para travar sem banco.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import {
  arquivoDoHistorico,
  corteDoMes,
  gravaHistorico,
  HISTORICOS,
  leHistorico,
  shaDoSql,
  sqlComCorte,
} from '../src/historico-congelado.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const P = HISTORICOS.get('protocolos-geral')!;

test('o corte é o 1º dia do mês, três meses antes do corrente — atravessando o ano', () => {
  assert.equal(corteDoMes(new Date(2026, 9, 16), 3), '2026-07-01');
  assert.equal(corteDoMes(new Date(2026, 9, 1, 0, 5), 3), '2026-07-01');
  assert.equal(corteDoMes(new Date(2027, 1, 10), 3), '2026-11-01');
});

test('o SQL real da protocolos-geral tem o piso exatamente uma vez', () => {
  const spec = yaml.parse(
    fs.readFileSync(path.join(ROOT, 'backend/specs/_catalog/queries/protocolos-geral.spec.yaml'), 'utf8'),
  ) as { sql: string };
  const hist = sqlComCorte(spec.sql, P, '<', '2026-07-01');
  const rec = sqlComCorte(spec.sql, P, '>=', '2026-07-01');
  assert.ok(hist.includes("a.created >= '2025-01-01' AND a.created < '2026-07-01'"));
  assert.ok(rec.includes("a.created >= '2025-01-01' AND a.created >= '2026-07-01'"));
});

test('costura ausente, repetida ou corte malformado erra alto', () => {
  assert.throws(() => sqlComCorte('SELECT 1', P, '<', '2026-07-01'), /0 ocorrência/);
  assert.throws(() => sqlComCorte(`${P.piso} OR ${P.piso}`, P, '<', '2026-07-01'), /2 ocorrência/);
  assert.throws(() => sqlComCorte(P.piso, P, '<', "2026-07-01' OR 1=1 --"), /corte inválido/);
});

test('o histórico volta do disco com os mesmos valores e tipos, e com o corte', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'historico-'));
  const arquivo = arquivoDoHistorico(dir, 'protocolos-geral');
  const linhas = [
    { SOLICITACAO: 'A1', 'DATA CRIADO': new Date('2025-03-04T10:11:12.345Z'), SLOT: 3, LATITUDE: '-29.1', PLANO: null },
    { SOLICITACAO: 'A2', 'DATA CRIADO': new Date('2026-06-30T23:59:59.000Z'), SLOT: null, LATITUDE: '', PLANO: 'X/ Y' },
  ];
  const agora = new Date('2026-10-16T06:00:00Z');
  await gravaHistorico(arquivo, 'protocolos-geral', { corte: '2026-07-01', linhas }, shaDoSql('sql'), agora);

  const r = await leHistorico(arquivo, shaDoSql('sql'), new Date('2026-10-16T20:00:00Z'), P);
  assert.ok('historico' in r);
  assert.equal(r.historico.corte, '2026-07-01');
  assert.deepEqual(r.historico.linhas, linhas);
  assert.deepEqual(Object.keys(r.historico.linhas[0]!), Object.keys(linhas[0]!));
});

test('histórico ausente, de outro SQL ou velho demais não serve — e diz por quê', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'historico-'));
  const arquivo = arquivoDoHistorico(dir, 'protocolos-geral');
  const agora = new Date('2026-10-16T06:00:00Z');
  assert.deepEqual(await leHistorico(arquivo, shaDoSql('sql'), agora, P), { motivo: 'sem histórico em disco' });

  await gravaHistorico(arquivo, 'protocolos-geral', { corte: '2026-07-01', linhas: [{ A: 1 }] }, shaDoSql('sql'), agora);
  const outroSql = await leHistorico(arquivo, shaDoSql('sql novo'), agora, P);
  assert.ok('motivo' in outroSql && /SQL mudou/.test(outroSql.motivo));

  const depois = new Date(agora.getTime() + 31 * 3_600_000);
  const velho = await leHistorico(arquivo, shaDoSql('sql'), depois, P);
  assert.ok('motivo' in velho && /31\.0 h/.test(velho.motivo));
});
