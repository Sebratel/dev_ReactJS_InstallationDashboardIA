import assert from 'node:assert/strict';
import test from 'node:test';
import { mensagemDaConfiguracaoDeProducao, problemasDaConfiguracaoDeProducao } from '../src/configuracao-producao.ts';

// O que a stack do Portainer declara: porta publicada direto, sem proxy na frente.
const PRODUCAO_DIRETA = {
  NODE_ENV: 'production',
  PUBLICACAO: 'direta',
  COOKIE_SECURE: '0',
  CONFIA_PROXY: '0',
  VOALLE_SSL: '0',
  MARIA_SSL: '0',
  MARIA_HOST: 'mariadb.interno',
  MARIA_USER: 'conta-existente',
  MARIA_PASSWORD: 'nao-e-um-segredo-real',
};

// O que a stack do Portainer declara: o contêiner `web` (nginx, HTTP) na frente da API.
const PRODUCAO_WEB_HTTP = {
  ...PRODUCAO_DIRETA,
  PUBLICACAO: 'web-http',
  CONFIA_PROXY: '1',
};

const PRODUCAO_ATRAS_DE_PROXY = {
  ...PRODUCAO_DIRETA,
  PUBLICACAO: 'proxy-https',
  COOKIE_SECURE: '1',
  CONFIA_PROXY: '1',
};

const chaves = (env: Record<string, string | undefined>) =>
  problemasDaConfiguracaoDeProducao(env).map((p) => p.chave);

test('produção sem nada declarado recusa: publicação e conta Maria ausente', () => {
  const problemas = problemasDaConfiguracaoDeProducao({ NODE_ENV: 'production' });
  assert.deepEqual(
    problemas.map((p) => p.chave),
    ['PUBLICACAO', 'MARIA_HOST', 'MARIA_USER', 'MARIA_PASSWORD'],
  );
  const mensagem = mensagemDaConfiguracaoDeProducao(problemas);
  assert.match(mensagem, /RECUSANDO SUBIR/);
  assert.doesNotMatch(mensagem, /nao-e-um-segredo-real/);
});

test('publicação direta (stack do Portainer) pode subir', () => {
  assert.deepEqual(chaves(PRODUCAO_DIRETA), []);
});

test('publicação pelo contêiner web (stack do Portainer) pode subir', () => {
  assert.deepEqual(chaves(PRODUCAO_WEB_HTTP), []);
});

test('pelo contêiner web, confiar no X-Real-IP é obrigatório: senão todos dividem o rate limit', () => {
  assert.deepEqual(chaves({ ...PRODUCAO_WEB_HTTP, CONFIA_PROXY: '0' }), ['CONFIA_PROXY']);
  assert.deepEqual(chaves({ ...PRODUCAO_WEB_HTTP, CONFIA_PROXY: undefined }), ['CONFIA_PROXY']);
});

test('pelo contêiner web continua HTTP: cookie Secure recusado', () => {
  assert.deepEqual(chaves({ ...PRODUCAO_WEB_HTTP, COOKIE_SECURE: '1' }), ['COOKIE_SECURE']);
});

test('publicação atrás de proxy HTTPS pode subir', () => {
  assert.deepEqual(chaves(PRODUCAO_ATRAS_DE_PROXY), []);
});

test('publicação direta recusa confiar no X-Real-IP: sem proxy, quem escreve o cabeçalho é o cliente', () => {
  assert.deepEqual(chaves({ ...PRODUCAO_DIRETA, CONFIA_PROXY: '1' }), ['CONFIA_PROXY']);
  assert.deepEqual(chaves({ ...PRODUCAO_DIRETA, CONFIA_PROXY: 'true' }), ['CONFIA_PROXY']);
});

test('publicação direta recusa cookie Secure: em HTTP o navegador não o devolve e o login não fecha', () => {
  assert.deepEqual(chaves({ ...PRODUCAO_DIRETA, COOKIE_SECURE: '1' }), ['COOKIE_SECURE']);
});

test('atrás de proxy, HTTPS e X-Real-IP reescrito continuam obrigatórios', () => {
  assert.deepEqual(chaves({ ...PRODUCAO_ATRAS_DE_PROXY, COOKIE_SECURE: '0', CONFIA_PROXY: undefined }), [
    'COOKIE_SECURE',
    'CONFIA_PROXY',
  ]);
});

test('publicação com valor desconhecido recusa em vez de adivinhar', () => {
  assert.deepEqual(chaves({ ...PRODUCAO_DIRETA, PUBLICACAO: 'Direta' }), ['PUBLICACAO']);
});

test('TLS dos bancos é opção, não exigência: sobe com ele ligado ou desligado', () => {
  for (const base of [PRODUCAO_DIRETA, PRODUCAO_WEB_HTTP, PRODUCAO_ATRAS_DE_PROXY]) {
    assert.deepEqual(chaves({ ...base, VOALLE_SSL: undefined, MARIA_SSL: undefined }), []);
    assert.deepEqual(chaves({ ...base, VOALLE_SSL: '1', MARIA_SSL: '1' }), []);
  }
});

test('desenvolvimento não herda as exigências de infraestrutura da produção', () => {
  assert.deepEqual(problemasDaConfiguracaoDeProducao({ NODE_ENV: 'development' }), []);
});
