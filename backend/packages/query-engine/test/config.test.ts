// O `application_name` das conexões ao Voalle (PLANO-CARGA 1.5): cada serviço do compose
// declara o seu, e é por ele que `pg_stat_activity` separa quem gasta o banco.

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig, missingFor } from '../src/config.ts';

function comAmbiente<T>(valor: string | undefined, f: () => T): T {
  const antes = process.env.VOALLE_APPLICATION_NAME;
  if (valor === undefined) delete process.env.VOALLE_APPLICATION_NAME;
  else process.env.VOALLE_APPLICATION_NAME = valor;
  try {
    return f();
  } finally {
    if (antes === undefined) delete process.env.VOALLE_APPLICATION_NAME;
    else process.env.VOALLE_APPLICATION_NAME = antes;
  }
}

test('application_name vem de VOALLE_APPLICATION_NAME', () => {
  assert.equal(comAmbiente('analytics-refresh', () => loadConfig().voalle.applicationName), 'analytics-refresh');
});

test('sem a variável (ou só com espaço), continua o nome de antes', () => {
  assert.equal(comAmbiente(undefined, () => loadConfig().voalle.applicationName), 'analytics-platform');
  assert.equal(comAmbiente('   ', () => loadConfig().voalle.applicationName), 'analytics-platform');
});

test('missingFor(maria) não exige MARIA_DATABASE quando ausente pois loadConfig já fornece default DB_Applicattion', () => {
  const antes = {
    MARIA_HOST: process.env.MARIA_HOST,
    MARIA_DATABASE: process.env.MARIA_DATABASE,
    MARIA_USER: process.env.MARIA_USER,
    MARIA_PASSWORD: process.env.MARIA_PASSWORD,
  };
  process.env.MARIA_HOST = '127.0.0.1';
  process.env.MARIA_DATABASE = '';
  process.env.MARIA_USER = 'usr';
  process.env.MARIA_PASSWORD = 'pwd';
  try {
    assert.equal(loadConfig().maria.database, 'DB_Applicattion');
    assert.deepEqual(missingFor('maria'), []);
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
