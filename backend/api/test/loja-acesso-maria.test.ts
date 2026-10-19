import assert from 'node:assert/strict';
import test from 'node:test';
import { configDoAmbiente } from '../src/loja-acesso-maria.ts';

test('banco de acesso fica desabilitado sem as credenciais Maria completas', () => {
  assert.equal(
    configDoAmbiente({ MARIA_HOST: 'maria', MARIA_USER: 'geral' }),
    null,
  );
});

test('banco de acesso usa a conta Maria e o banco de permissões com TLS', () => {
  const cfg = configDoAmbiente({
    MARIA_HOST: 'maria',
    MARIA_USER: 'geral',
    MARIA_PASSWORD: 'senha',
    MARIA_DATABASE: 'fonte_do_refresh',
    MARIA_SSL: '1',
    MARIA_SSL_REJECT_UNAUTHORIZED: '1',
  });
  assert.deepEqual(cfg, {
    host: 'maria',
    port: 3306,
    database: 'DB_InstallationDashboard',
    user: 'geral',
    password: 'senha',
    ssl: { rejectUnauthorized: true },
  });
});
