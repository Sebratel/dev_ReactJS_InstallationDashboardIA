import assert from 'node:assert/strict';
import test from 'node:test';
import { mensagemDaConfiguracaoDeProducao, problemasDaConfiguracaoDeProducao } from '../src/configuracao-producao.ts';

const PRODUCAO_SEGURA = {
  NODE_ENV: 'production',
  COOKIE_SECURE: '1',
  CONFIA_PROXY: '1',
  VOALLE_SSL: '1',
  VOALLE_SSL_REJECT_UNAUTHORIZED: '1',
  ACESSO_DB_SSL: '1',
  ACESSO_DB_HOST: 'mariadb.interno',
  ACESSO_DB_USER: 'installation_access',
  ACESSO_DB_PASSWORD: 'nao-e-um-segredo-real',
};

test('produção recusa HTTP, proxy não confiável, banco sem TLS e credencial de acesso ausente', () => {
  const problemas = problemasDaConfiguracaoDeProducao({ NODE_ENV: 'production' });
  assert.deepEqual(
    problemas.map((p) => p.chave),
    [
      'COOKIE_SECURE', 'CONFIA_PROXY', 'VOALLE_SSL', 'VOALLE_SSL_REJECT_UNAUTHORIZED', 'ACESSO_DB_SSL',
      'ACESSO_DB_HOST', 'ACESSO_DB_USER', 'ACESSO_DB_PASSWORD',
    ],
  );
  const mensagem = mensagemDaConfiguracaoDeProducao(problemas);
  assert.match(mensagem, /RECUSANDO SUBIR/);
  assert.doesNotMatch(mensagem, /nao-e-um-segredo-real/);
});

test('produção com todo o contrato seguro pode subir', () => {
  assert.deepEqual(problemasDaConfiguracaoDeProducao(PRODUCAO_SEGURA), []);
});

test('desenvolvimento não herda as exigências de infraestrutura da produção', () => {
  assert.deepEqual(problemasDaConfiguracaoDeProducao({ NODE_ENV: 'development' }), []);
});
