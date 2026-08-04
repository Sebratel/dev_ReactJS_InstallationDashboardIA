// Auditoria dos goldens JÁ GRAVADOS em specs/golden/.
//
// Os outros testes provam que o profiler não vaza dado a partir de linhas
// fabricadas. Este olha os arquivos reais que estão no git, capturados do ERP
// de produção — é a única verificação que pega um vazamento que só aparece com
// dado de verdade, ou uma mudança futura no profiler que passe a gravar valor.
//
// Se um dia alguém rodar com --include-values e commitar, este teste falha e
// explica o que fazer. É de propósito.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GOLDEN_DIR = path.join(ROOT, 'specs', 'golden');

const CHAVES_GOLDEN = new Set([
  'queryId', 'datasource', 'strategy', 'rowCount', 'truncated',
  'profiledRows', 'columnsFromSample', 'columns',
  'schemaFingerprint', 'dataFingerprint', 'capturedAt',
]);

const CHAVES_COLUNA = new Set([
  'name', 'type', 'numericString', 'nulls', 'distinct',
  'min', 'max', 'sum', 'minLength', 'maxLength', 'values',
]);

function goldensGravados(): { file: string; golden: Record<string, unknown> }[] {
  if (!fs.existsSync(GOLDEN_DIR)) return [];
  return fs
    .readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith('.golden.json'))
    .map((file) => ({
      file,
      golden: JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, file), 'utf8')),
    }));
}

test('goldens gravados: nenhuma chave fora do contrato', () => {
  const goldens = goldensGravados();
  if (goldens.length === 0) return; // clone novo, antes do primeiro validate:queries

  for (const { file, golden } of goldens) {
    for (const k of Object.keys(golden)) {
      assert.ok(CHAVES_GOLDEN.has(k), `${file}: chave inesperada no golden: "${k}"`);
    }
    for (const col of golden.columns as Record<string, unknown>[]) {
      for (const k of Object.keys(col)) {
        assert.ok(CHAVES_COLUNA.has(k), `${file}: chave inesperada em coluna "${col.name}": "${k}"`);
      }
    }
  }
});

test('goldens gravados: min/max textual só existe em coluna de data', () => {
  for (const { file, golden } of goldensGravados()) {
    for (const col of golden.columns as Record<string, unknown>[]) {
      for (const k of ['min', 'max'] as const) {
        const v = col[k];
        if (typeof v !== 'string') continue;
        assert.match(
          v,
          /^\d{4}-\d{2}-\d{2}T/,
          `${file}: coluna "${col.name}" tem ${k} com texto livre — é conteúdo de linha, ` +
            `não pode entrar num arquivo commitado`,
        );
      }
    }
  }
});

test('goldens gravados: coluna numérica não expõe min/max (seria um CPF, um protocolo)', () => {
  for (const { file, golden } of goldensGravados()) {
    for (const col of golden.columns as Record<string, unknown>[]) {
      const ehNumerica = col.type === 'number' || col.numericString === true;
      if (!ehNumerica) continue;
      assert.equal(col.min, undefined, `${file}: coluna numérica "${col.name}" gravou min`);
      assert.equal(col.max, undefined, `${file}: coluna numérica "${col.name}" gravou max`);
    }
  }
});

test('goldens gravados: nenhum valor distinto commitado (--include-values não vai para o git)', () => {
  for (const { file, golden } of goldensGravados()) {
    for (const col of golden.columns as Record<string, unknown>[]) {
      assert.equal(
        col.values,
        undefined,
        `${file}: coluna "${col.name}" tem "values". Isso vem de --include-values e pode ` +
          `conter valor real. Regrave sem a flag antes de commitar.`,
      );
    }
  }
});

test('goldens gravados: o básico está coerente', () => {
  const goldens = goldensGravados();
  if (goldens.length === 0) return;

  for (const { file, golden } of goldens) {
    const id = String(golden.queryId);
    assert.equal(`${id}.golden.json`, file, `${file}: queryId não casa com o nome do arquivo`);
    assert.ok(Array.isArray(golden.columns), `${file}: columns não é lista`);
    assert.ok((golden.columns as unknown[]).length > 0, `${file}: nenhuma coluna perfilada`);
    assert.ok(
      (golden.profiledRows as number) <= (golden.rowCount as number),
      `${file}: perfilou mais linhas do que o total`,
    );
    assert.match(String(golden.capturedAt), /^\d{4}-\d{2}-\d{2}T/, `${file}: capturedAt inválido`);
    assert.ok(
      ['wrapped', 'direct'].includes(String(golden.strategy)),
      `${file}: strategy desconhecida`,
    );
  }
});
