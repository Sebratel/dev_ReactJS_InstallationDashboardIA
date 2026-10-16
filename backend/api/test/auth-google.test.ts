// Verificação do ID token do Google — sem rede: o cliente é injetado (mesmo
// padrão de `ServidorOptions.identifica`), então "válido"/"inválido" é o
// próprio teste decidindo, não uma resposta real do Google.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { TokenPayload } from 'google-auth-library';
import { verificaIdToken, type VerificadorDeToken } from '../src/auth-google.ts';

const CLIENT_ID = '123.apps.googleusercontent.com';
const DOMINIO = 'sebratel.com.br';

function clienteQueDevolve(payload: Partial<TokenPayload> | undefined): VerificadorDeToken {
  return {
    async verifyIdToken() {
      return { getPayload: () => payload as TokenPayload | undefined };
    },
  };
}

function clienteQueRecusa(mensagem = 'assinatura inválida'): VerificadorDeToken {
  return {
    async verifyIdToken() {
      throw new Error(mensagem);
    },
  };
}

test('token válido, domínio certo: devolve o perfil do Google', async () => {
  const cliente = clienteQueDevolve({
    email: 'fulano@sebratel.com.br',
    hd: DOMINIO,
    name: 'Fulano da Silva',
    picture: 'https://lh3.googleusercontent.com/a/foto-do-fulano',
  });
  const r = await verificaIdToken('token-qualquer', { clientId: CLIENT_ID, dominioCorporativo: DOMINIO, cliente });
  assert.deepEqual(r, {
    email: 'fulano@sebratel.com.br',
    foto: 'https://lh3.googleusercontent.com/a/foto-do-fulano',
    nome: 'Fulano da Silva',
  });
});

test('domínio (hd) diferente do corporativo: recusado', async () => {
  const cliente = clienteQueDevolve({ email: 'fulano@gmail.com', hd: 'gmail.com' });
  const r = await verificaIdToken('token-qualquer', { clientId: CLIENT_ID, dominioCorporativo: DOMINIO, cliente });
  assert.equal(r, null);
});

test('sem claim "hd" (conta pessoal do Google, não Workspace): recusado', async () => {
  // Contas pessoais do Google não carregam "hd" — só confiar no sufixo do
  // e-mail (como o HUBBI faz) deixaria passar `fulano@sebratel.com.br.evil.com`;
  // aqui a ausência do claim já recusa, mesmo que o e-mail "pareça" certo.
  const cliente = clienteQueDevolve({ email: 'fulano@sebratel.com.br' });
  const r = await verificaIdToken('token-qualquer', { clientId: CLIENT_ID, dominioCorporativo: DOMINIO, cliente });
  assert.equal(r, null);
});

test('payload sem e-mail: recusado', async () => {
  const cliente = clienteQueDevolve({ hd: DOMINIO });
  const r = await verificaIdToken('token-qualquer', { clientId: CLIENT_ID, dominioCorporativo: DOMINIO, cliente });
  assert.equal(r, null);
});

test('token expirado ou assinatura inválida: a lib lança, e a função devolve null (não propaga)', async () => {
  const cliente = clienteQueRecusa('Token used too late');
  const r = await verificaIdToken('token-vencido', { clientId: CLIENT_ID, dominioCorporativo: DOMINIO, cliente });
  assert.equal(r, null);
});

test('getPayload() devolvendo undefined (token sem corpo decodificável): recusado', async () => {
  const cliente = clienteQueDevolve(undefined);
  const r = await verificaIdToken('token-qualquer', { clientId: CLIENT_ID, dominioCorporativo: DOMINIO, cliente });
  assert.equal(r, null);
});
