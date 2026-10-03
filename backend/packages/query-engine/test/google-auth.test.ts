// Testes de `google-auth.ts` sem tocar na rede e sem a chave real.
//
// A chave usada aqui é gerada na hora, dentro do teste. O que se verifica é o que
// o Google verifica do outro lado: que o JWT é assinável, que os claims são os
// exigidos pelo fluxo de service account, e que a assinatura fecha com a chave
// pública correspondente. Se isto passa e o Google recusa, o problema é permissão
// — que é exatamente a distinção que a sonda precisa fazer.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  accessToken,
  readServiceAccount,
  SCOPE_SHEETS_READONLY,
} from '../src/google-auth.ts';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM_PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const CONTA = {
  type: 'service_account',
  project_id: 'projeto-de-teste',
  client_email: 'robo@projeto-de-teste.iam.gserviceaccount.com',
  private_key: PEM_PRIV,
  token_uri: 'https://oauth2.googleapis.com/token',
};

/** Escreve um JSON temporário e devolve o caminho. */
function arquivo(conteudo: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gauth-'));
  const p = path.join(dir, 'cred.json');
  fs.writeFileSync(p, conteudo);
  return p;
}

// ------------------------------------------------------- readServiceAccount
test('readServiceAccount: caminho vazio diz qual variável preencher', () => {
  assert.throws(() => readServiceAccount(''), /GOOGLE_APPLICATION_CREDENTIALS.*vazio/s);
});

test('readServiceAccount: arquivo ausente aparece com o caminho no erro', () => {
  const p = path.join(os.tmpdir(), 'nao-existe-mesmo-12345.json');
  assert.throws(() => readServiceAccount(p), new RegExp(p.replace(/\\/g, '\\\\')));
});

test('readServiceAccount: JSON quebrado não vira erro de propriedade três camadas acima', () => {
  assert.throws(() => readServiceAccount(arquivo('{ nao é json')), /não é JSON válido/);
});

test('readServiceAccount: chave de usuário (type errado) é recusada nomeando o type', () => {
  const p = arquivo(JSON.stringify({ ...CONTA, type: 'authorized_user' }));
  assert.throws(() => readServiceAccount(p), /type="authorized_user".*conta de serviço/s);
});

test('readServiceAccount: campo obrigatório ausente é nomeado', () => {
  const { private_key: _, ...sem } = CONTA;
  assert.throws(() => readServiceAccount(arquivo(JSON.stringify(sem))), /"private_key"/);
});

test('readServiceAccount: credencial válida devolve os campos do fluxo', () => {
  const sa = readServiceAccount(arquivo(JSON.stringify(CONTA)));
  assert.equal(sa.client_email, CONTA.client_email);
  assert.equal(sa.token_uri, CONTA.token_uri);
  assert.equal(sa.project_id, 'projeto-de-teste');
});

// ------------------------------------------------------------- accessToken
/** Troca `fetch` por um espião que devolve o que se pedir e guarda a chamada. */
function comFetch(
  resposta: { status?: number; body: string },
): { chamadas: Array<{ url: string; body: string }>; restaura: () => void } {
  const original = globalThis.fetch;
  const chamadas: Array<{ url: string; body: string }> = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    chamadas.push({ url: String(url), body: String(init?.body ?? '') });
    return new Response(resposta.body, { status: resposta.status ?? 200 });
  }) as typeof fetch;
  return { chamadas, restaura: () => { globalThis.fetch = original; } };
}

/** Decodifica um JWT em header, claims e a parte assinada. */
function abre(jwt: string) {
  const [h, c, s] = jwt.split('.');
  const de = (p: string) => JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  return { header: de(h), claims: de(c), assinado: `${h}.${c}`, assinatura: s };
}

test('accessToken: o JWT enviado tem header, claims e assinatura que o Google exige', async () => {
  const espiao = comFetch({ body: JSON.stringify({ access_token: 'ya29.token-de-teste' }) });
  try {
    const antes = Math.floor(Date.now() / 1000);
    const token = await accessToken(CONTA, [SCOPE_SHEETS_READONLY]);
    assert.equal(token, 'ya29.token-de-teste');
    assert.equal(espiao.chamadas.length, 1);

    const enviado = new URLSearchParams(espiao.chamadas[0].body);
    assert.equal(espiao.chamadas[0].url, CONTA.token_uri);
    assert.equal(enviado.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');

    const { header, claims, assinado, assinatura } = abre(enviado.get('assertion')!);
    assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
    assert.equal(claims.iss, CONTA.client_email);
    assert.equal(claims.aud, CONTA.token_uri);
    assert.equal(claims.scope, SCOPE_SHEETS_READONLY);
    // `exp` uma hora à frente é o máximo que o Google aceita; mais que isso é
    // recusado com invalid_grant, que não parece um erro de relógio.
    assert.equal(claims.exp - claims.iat, 3600);
    assert.ok(claims.iat >= antes && claims.iat <= antes + 5, `iat fora da janela: ${claims.iat}`);

    const confere = crypto
      .createVerify('RSA-SHA256')
      .update(assinado)
      .verify(publicKey, Buffer.from(assinatura, 'base64url'));
    assert.ok(confere, 'a assinatura não fecha com a chave pública do par');
  } finally {
    espiao.restaura();
  }
});

test('accessToken: escopo pedido é o que vai no claim, e vários viram lista', async () => {
  const espiao = comFetch({ body: JSON.stringify({ access_token: 'x' }) });
  try {
    await accessToken(CONTA, ['escopo/a', 'escopo/b']);
    const enviado = new URLSearchParams(espiao.chamadas[0].body);
    assert.equal(abre(enviado.get('assertion')!).claims.scope, 'escopo/a escopo/b');
  } finally {
    espiao.restaura();
  }
});

test('accessToken: HTTP de erro na troca do JWT falha citando status e corpo', async () => {
  const espiao = comFetch({ status: 400, body: '{"error":"invalid_grant"}' });
  try {
    await assert.rejects(
      () => accessToken(CONTA, [SCOPE_SHEETS_READONLY]),
      /HTTP 400.*invalid_grant/s,
    );
  } finally {
    espiao.restaura();
  }
});

test('accessToken: 200 sem access_token não devolve undefined adiante', async () => {
  const espiao = comFetch({ body: '{"expires_in":3600}' });
  try {
    await assert.rejects(() => accessToken(CONTA, [SCOPE_SHEETS_READONLY]), /sem access_token/);
  } finally {
    espiao.restaura();
  }
});

test('o escopo padrão de Sheets é o de leitura — a regra read-only vale aqui também', () => {
  assert.ok(SCOPE_SHEETS_READONLY.endsWith('.readonly'), SCOPE_SHEETS_READONLY);
});
