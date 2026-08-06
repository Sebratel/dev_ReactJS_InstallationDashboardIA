// Qual identidade o Google recebe — e por quê. Sem rede, sem arquivo.
//
// Isto é escolha de credencial, e escolher errado em silêncio é o pior resultado
// possível: o 403 que aparece depois tem soluções opostas nos dois caminhos.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlatformConfig } from '../src/config.ts';
import { identidadeGoogle, porQueNaoAOutra } from '../src/google-identidade.ts';
import type { CredencialOAuthGravada } from '../src/google-oauth.ts';

type Gsheets = PlatformConfig['gsheets'];

const gsheets = (over: Partial<Gsheets> = {}): Gsheets => ({
  credentialsPath: '',
  apiKey: '',
  oauth: { clientId: '', clientSecret: '', tokenFile: '' },
  quadroFuncionalId: 'id-qf',
  apuracaoPremiacaoId: 'id-ap',
  capacidadeEquipeId: 'id-ce',
  ...over,
});

const OAUTH_CHEIO = {
  clientId: 'cliente.apps.googleusercontent.com',
  clientSecret: 'segredo',
  tokenFile: '/fora/do/repo/cred.json',
};

const CRED: CredencialOAuthGravada = {
  client_id: 'cliente.apps.googleusercontent.com',
  refresh_token: 'rt',
  scopes: ['escopo/sheets'],
  obtido_em: '2026-08-06T00:00:00.000Z',
  conta: 'erick.azambuja@sebratel.com.br',
  formato: 'nosso',
};

/** O que `gcloud auth application-default login` grava: secret dentro do arquivo. */
const CRED_GCLOUD: CredencialOAuthGravada = {
  client_id: 'gcloud-cliente.apps.googleusercontent.com',
  client_secret: 'segredo-do-gcloud',
  refresh_token: '1//rt',
  scopes: [],
  obtido_em: '',
  formato: 'authorized_user',
};

const SA = {
  client_email: 'robo@projeto.iam.gserviceaccount.com',
  private_key: 'k',
  token_uri: 'https://oauth2.googleapis.com/token',
  project_id: 'projeto',
};

const leSaFalso = () => SA as never;
const leCredFalso = (c: CredencialOAuthGravada | null) => () => c as never;

test('sem OAuth configurado, usa a service account e diz quem é', () => {
  const id = identidadeGoogle(gsheets({ credentialsPath: '/k.json' }), ['escopo/sheets'], {
    leServiceAccount: leSaFalso,
  });
  assert.equal(id.tipo, 'service_account');
  assert.equal(id.rotulo, SA.client_email);
  assert.equal(id.contaDeServico?.client_email, SA.client_email);
});

test('com credencial OAuth gravada, o OAuth tem precedência sobre a service account', () => {
  // Precedência deliberada: o arquivo de refresh token só existe porque alguém
  // rodou `auth:google`. Deixar a chave da service account ganhar faria essa
  // decisão ser ignorada em silêncio.
  const id = identidadeGoogle(
    gsheets({ credentialsPath: '/k.json', oauth: OAUTH_CHEIO }),
    ['escopo/sheets'],
    { leServiceAccount: leSaFalso, leCredencial: leCredFalso(CRED) },
  );
  assert.equal(id.tipo, 'oauth');
  assert.match(id.rotulo, /erick\.azambuja@sebratel\.com\.br/);
  assert.equal(id.contaDeServico, undefined);
});

test('OAuth sem credencial gravada cai para a service account', () => {
  const id = identidadeGoogle(
    gsheets({ credentialsPath: '/k.json', oauth: OAUTH_CHEIO }),
    ['escopo/sheets'],
    { leServiceAccount: leSaFalso, leCredencial: leCredFalso(null) },
  );
  assert.equal(id.tipo, 'service_account');
});

test('credencial do gcloud dispensa client id/secret no .env: eles estão no arquivo', () => {
  const id = identidadeGoogle(
    gsheets({
      credentialsPath: '/k.json',
      oauth: { clientId: '', clientSecret: '', tokenFile: '/fora/adc.json' },
    }),
    ['escopo/sheets'],
    { leServiceAccount: leSaFalso, leCredencial: leCredFalso(CRED_GCLOUD) },
  );
  assert.equal(id.tipo, 'oauth');
  // O rótulo diz de onde veio: o arquivo do gcloud não registra escopo, então
  // saber a origem é o que explica um 403 de escopo depois.
  assert.match(id.rotulo, /gcloud/);
});

test('refresh token sem secret em lugar nenhum falha dizendo por quê', () => {
  assert.throws(
    () =>
      identidadeGoogle(
        gsheets({
          credentialsPath: '/k.json',
          oauth: { clientId: 'c', clientSecret: '', tokenFile: '/fora/cred.json' },
        }),
        ['escopo/sheets'],
        { leServiceAccount: leSaFalso, leCredencial: leCredFalso({ ...CRED, client_secret: undefined }) },
      ),
    /client secret/,
  );
});

test('client id/secret sem tokenFile não vira OAuth: nem tenta ler arquivo', () => {
  let leu = false;
  const id = identidadeGoogle(
    gsheets({
      credentialsPath: '/k.json',
      oauth: { clientId: 'c', clientSecret: 's', tokenFile: '' },
    }),
    ['escopo/sheets'],
    {
      leServiceAccount: leSaFalso,
      leCredencial: () => {
        leu = true;
        return null as never;
      },
    },
  );
  assert.equal(id.tipo, 'service_account');
  assert.equal(leu, false);
});

test('credencial OAuth sem conta registrada ainda produz rótulo legível', () => {
  const id = identidadeGoogle(gsheets({ oauth: OAUTH_CHEIO }), ['escopo/sheets'], {
    leCredencial: leCredFalso({ ...CRED, conta: undefined }),
  });
  assert.equal(id.rotulo, 'conta de usuário via OAuth');
});

test('nenhuma credencial: o erro ensina os dois caminhos', () => {
  assert.throws(() => identidadeGoogle(gsheets(), ['escopo/sheets']), (err: Error) => {
    assert.match(err.message, /GOOGLE_APPLICATION_CREDENTIALS/);
    assert.match(err.message, /GOOGLE_OAUTH_CLIENT_ID/);
    assert.match(err.message, /auth:google/);
    return true;
  });
});

test('escopo não concedido no consentimento falha na escolha da identidade', () => {
  assert.throws(
    () =>
      identidadeGoogle(gsheets({ oauth: OAUTH_CHEIO }), ['escopo/drive'], {
        leCredencial: leCredFalso(CRED),
      }),
    /escopo\/drive/,
  );
});

test('porQueNaoAOutra explica a escolha em cada combinação', () => {
  assert.match(
    porQueNaoAOutra(gsheets({ credentialsPath: '/k.json', oauth: OAUTH_CHEIO }), 'oauth'),
    /precedência/,
  );
  assert.match(porQueNaoAOutra(gsheets({ oauth: OAUTH_CHEIO }), 'oauth'), /não há chave/);
  assert.equal(
    porQueNaoAOutra(gsheets({ credentialsPath: '/k.json' }), 'service_account'),
    'OAuth não configurado',
  );
  assert.match(
    porQueNaoAOutra(
      gsheets({
        credentialsPath: '/k.json',
        oauth: { clientId: 'c', clientSecret: 's', tokenFile: '' },
      }),
      'service_account',
    ),
    /GOOGLE_OAUTH_TOKEN_FILE/,
  );
  // Arquivo apontado mas sem cliente: o texto tem de dizer que o arquivo também
  // conta como fonte do client id/secret, senão manda mexer só no .env.
  assert.match(
    porQueNaoAOutra(
      gsheets({
        credentialsPath: '/k.json',
        oauth: { clientId: '', clientSecret: '', tokenFile: '/fora/adc.json' },
      }),
      'service_account',
    ),
    /dentro do arquivo/,
  );
  assert.match(
    porQueNaoAOutra(gsheets({ credentialsPath: '/k.json', oauth: OAUTH_CHEIO }), 'service_account'),
    /auth:google/,
  );
});
