import assert from 'node:assert/strict';
import test from 'node:test';
import { configDoAmbiente } from '../src/loja-acesso-maria.ts';

test('banco de acesso não cai para MARIA_USER compartilhado', () => {
  assert.equal(
    configDoAmbiente({ MARIA_HOST: 'maria', MARIA_USER: 'geral', MARIA_PASSWORD: 'senha' }),
    null,
  );
});

test('banco de acesso usa somente a credencial dedicada e habilita TLS quando declarado', () => {
  const cfg = configDoAmbiente({
    ACESSO_DB_HOST: 'acesso',
    ACESSO_DB_USER: 'installation_access',
    ACESSO_DB_PASSWORD: 'senha',
    ACESSO_DB_SSL: '1',
  });
  assert.deepEqual(cfg, {
    host: 'acesso',
    port: 3306,
    database: 'DB_InstallationDashboard',
    user: 'installation_access',
    password: 'senha',
    ssl: { rejectUnauthorized: true },
  });
});
