// Sessão de login: puro, sem HTTP e sem rede — o teste do portão de sessão
// (401 sem cookie válido) mora em servidor.test.ts, que exercita isto por
// dentro de um pedido de verdade.

import assert from 'node:assert/strict';
import type http from 'node:http';
import test from 'node:test';
import {
  apagaSessaoDoPedido,
  cookieDeSessao,
  criaSessao,
  identificaPorSessao,
  NOME_COOKIE,
  type Sessoes,
} from '../src/identidade.ts';

/** Um `IncomingMessage` de mentira com só o cabeçalho `cookie` que importa aqui. */
function pedidoComCookie(cookie: string | undefined): http.IncomingMessage {
  return { headers: { cookie } } as http.IncomingMessage;
}

test('criaSessao + identificaPorSessao: o token que sai de um entra no outro', () => {
  const sessoes: Sessoes = new Map();
  const token = criaSessao(sessoes, 'fulano@sebratel.com.br', 12);
  const identidade = identificaPorSessao(sessoes, pedidoComCookie(`${NOME_COOKIE}=${token}`));
  assert.deepEqual(identidade, { usuario: 'fulano@sebratel.com.br', papeis: ['autenticado'] });
});

test('sem cookie nenhum, sem identidade', () => {
  const sessoes: Sessoes = new Map();
  assert.equal(identificaPorSessao(sessoes, pedidoComCookie(undefined)), null);
});

test('cookie de um token que o Map nunca viu, sem identidade', () => {
  const sessoes: Sessoes = new Map();
  assert.equal(identificaPorSessao(sessoes, pedidoComCookie(`${NOME_COOKIE}=nunca-existiu`)), null);
});

test('cookie de sessão expirada: sem identidade, e a sessão morta some do Map', () => {
  const sessoes: Sessoes = new Map();
  const token = criaSessao(sessoes, 'fulano@sebratel.com.br', -1); // TTL negativo: já nasce vencida
  assert.equal(identificaPorSessao(sessoes, pedidoComCookie(`${NOME_COOKIE}=${token}`)), null);
  assert.equal(sessoes.has(token), false, 'sessão expirada não deveria continuar ocupando o Map');
});

test('outros cookies ao lado do de sessão não atrapalham a leitura', () => {
  const sessoes: Sessoes = new Map();
  const token = criaSessao(sessoes, 'fulano@sebratel.com.br', 12);
  const identidade = identificaPorSessao(
    sessoes,
    pedidoComCookie(`tema=escuro; ${NOME_COOKIE}=${token}; outro=1`),
  );
  assert.equal(identidade?.usuario, 'fulano@sebratel.com.br');
});

test('apagaSessaoDoPedido: some do Map, e chamar de novo não é erro', () => {
  const sessoes: Sessoes = new Map();
  const token = criaSessao(sessoes, 'fulano@sebratel.com.br', 12);
  apagaSessaoDoPedido(sessoes, pedidoComCookie(`${NOME_COOKIE}=${token}`));
  assert.equal(sessoes.has(token), false);
  assert.doesNotThrow(() => apagaSessaoDoPedido(sessoes, pedidoComCookie(`${NOME_COOKIE}=${token}`)));
});

test('apagaSessaoDoPedido sem cookie nenhum não é erro', () => {
  const sessoes: Sessoes = new Map();
  assert.doesNotThrow(() => apagaSessaoDoPedido(sessoes, pedidoComCookie(undefined)));
});

test('cookieDeSessao: HttpOnly, SameSite=Lax, e Max-Age em segundos', () => {
  const c = cookieDeSessao('abc', 12);
  assert.match(c, /^sessao=abc;/);
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Max-Age=43200/); // 12h * 3600
});

test('cookieDeSessao com ttl 0 (logout): Max-Age=0, apaga o cookie do navegador', () => {
  assert.match(cookieDeSessao('', 0), /Max-Age=0/);
});

test('cookieDeSessao: sem Secure por padrão (sem TLS, seria cookie que o navegador nunca envia)', () => {
  assert.doesNotMatch(cookieDeSessao('abc', 12), /Secure/);
});

test('cookieDeSessao: Secure aparece só quando pedido explicitamente (COOKIE_SECURE=1)', () => {
  assert.match(cookieDeSessao('abc', 12, true), /; Secure$/);
});
