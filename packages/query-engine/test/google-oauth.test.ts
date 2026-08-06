// Testes do fluxo OAuth. Nenhum toca a rede: `fetch` é injetado.
//
// O que se testa aqui não é "o Google aceita" — é o que a nossa parte precisa
// acertar para o Google aceitar, e o que ela precisa DIZER quando ele recusa.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  accessTokenDeRefresh,
  explicaErroOAuth,
  gravaCredencialOAuth,
  leCredencialOAuth,
  OAuthError,
  pkce,
  state,
  tokenDeUsuario,
  trocaCodigoPorTokens,
  urlDeAutorizacao,
  type FetchLike,
} from '../src/google-oauth.ts';

const CLIENTE = { clientId: 'cliente-123.apps.googleusercontent.com', clientSecret: 'segredo' };

/** `fetch` de teste: registra o que foi enviado e devolve o que se mandar. */
function fetchFalso(
  resposta: { ok?: boolean; status?: number; corpo: string },
): { impl: FetchLike; chamadas: { url: string; body: URLSearchParams }[] } {
  const chamadas: { url: string; body: URLSearchParams }[] = [];
  const impl: FetchLike = async (url, init) => {
    chamadas.push({ url, body: new URLSearchParams(init?.body ?? '') });
    return {
      ok: resposta.ok ?? true,
      status: resposta.status ?? 200,
      text: async () => resposta.corpo,
    };
  };
  return { impl, chamadas };
}

// ---------------------------------------------------------------------- PKCE
test('pkce: o desafio é o sha256 do verificador em base64url', () => {
  const bytes = Buffer.alloc(32, 7);
  const { verificador, desafio } = pkce(() => bytes);
  assert.equal(verificador, bytes.toString('base64url'));
  assert.equal(desafio, crypto.createHash('sha256').update(verificador).digest('base64url'));
  // base64url não tem +, / nem =: se tivesse, o Google recusaria o desafio.
  assert.match(desafio, /^[A-Za-z0-9_-]+$/);
});

test('pkce e state: valores distintos a cada chamada', () => {
  assert.notEqual(pkce().verificador, pkce().verificador);
  assert.notEqual(state(), state());
});

// ------------------------------------------------------- URL de autorização
test('urlDeAutorizacao: pede offline + consent, senão não vem refresh token', () => {
  const url = new URL(
    urlDeAutorizacao({
      clientId: CLIENTE.clientId,
      redirectUri: 'http://localhost:8765/oauth2callback',
      scopes: ['escopo/a', 'escopo/b'],
      desafio: 'DESAFIO',
      state: 'ESTADO',
    }),
  );
  const q = url.searchParams;
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(q.get('access_type'), 'offline');
  assert.equal(q.get('prompt'), 'consent');
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('code_challenge'), 'DESAFIO');
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.equal(q.get('state'), 'ESTADO');
  // escopo é separado por espaço, não por vírgula
  assert.equal(q.get('scope'), 'escopo/a escopo/b');
  assert.equal(q.get('login_hint'), null);
});

test('urlDeAutorizacao: login_hint só aparece quando informado', () => {
  const url = new URL(
    urlDeAutorizacao({
      clientId: 'c',
      redirectUri: 'http://localhost:1/cb',
      scopes: ['s'],
      desafio: 'd',
      state: 'e',
      loginHint: 'alguem@sebratel.com.br',
    }),
  );
  assert.equal(url.searchParams.get('login_hint'), 'alguem@sebratel.com.br');
});

// ------------------------------------------------------------------- erros
test('explicaErroOAuth: redirect_uri_mismatch aponta a causa (cliente do tipo Web)', () => {
  const t = explicaErroOAuth(400, JSON.stringify({ error: 'redirect_uri_mismatch' }));
  assert.match(t, /Aplicativo para desktop/);
  assert.match(t, /URI de redirecionamento/);
});

test('explicaErroOAuth: invalid_client fala das duas variáveis do .env', () => {
  const t = explicaErroOAuth(401, JSON.stringify({ error: 'invalid_client' }));
  assert.match(t, /GOOGLE_OAUTH_CLIENT_ID/);
  assert.match(t, /GOOGLE_OAUTH_CLIENT_SECRET/);
});

test('explicaErroOAuth: invalid_grant cita o prazo de 7 dias do modo Teste', () => {
  const t = explicaErroOAuth(400, JSON.stringify({ error: 'invalid_grant' }));
  assert.match(t, /7 dias/);
  assert.match(t, /auth:google/);
});

test('explicaErroOAuth: bloqueio de administrador sugere a service account', () => {
  const t = explicaErroOAuth(403, JSON.stringify({ error: 'admin_policy_enforced' }));
  assert.match(t, /administrador/);
  assert.match(t, /service\s*account/i);
});

test('explicaErroOAuth: corpo que não é JSON não estoura', () => {
  const t = explicaErroOAuth(502, '<html>gateway</html>');
  assert.match(t, /gateway/);
});

// --------------------------------------------------------- troca de código
test('trocaCodigoPorTokens: envia code_verifier e grant_type correto', async () => {
  const { impl, chamadas } = fetchFalso({
    corpo: JSON.stringify({
      access_token: 'at',
      refresh_token: 'rt',
      scope: 'escopo/a escopo/b',
      id_token: 'a.b.c',
    }),
  });
  const t = await trocaCodigoPorTokens(
    { cliente: CLIENTE, code: 'CODIGO', redirectUri: 'http://localhost:8765/cb', verificador: 'V' },
    impl,
  );
  assert.equal(t.refreshToken, 'rt');
  assert.equal(t.accessToken, 'at');
  assert.deepEqual([...t.scopesConcedidos], ['escopo/a', 'escopo/b']);
  assert.equal(t.idToken, 'a.b.c');

  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, 'https://oauth2.googleapis.com/token');
  const b = chamadas[0].body;
  assert.equal(b.get('grant_type'), 'authorization_code');
  assert.equal(b.get('code'), 'CODIGO');
  assert.equal(b.get('code_verifier'), 'V');
  assert.equal(b.get('client_secret'), 'segredo');
});

test('trocaCodigoPorTokens: access token sem refresh token é FALHA, não sucesso', async () => {
  // O caso real: conta que já autorizou este cliente antes. Gravar um arquivo sem
  // refresh token daria um fluxo "bem-sucedido" que não serve na próxima execução.
  const { impl } = fetchFalso({ corpo: JSON.stringify({ access_token: 'at', scope: 'x' }) });
  await assert.rejects(
    () =>
      trocaCodigoPorTokens(
        { cliente: CLIENTE, code: 'c', redirectUri: 'http://x/cb', verificador: 'v' },
        impl,
      ),
    (err: Error) => {
      assert.ok(err instanceof OAuthError);
      assert.match(err.message, /NENHUM refresh token/);
      assert.match(err.message, /permissions/);
      return true;
    },
  );
});

test('trocaCodigoPorTokens: HTTP de erro vira instrução, não código', async () => {
  const { impl } = fetchFalso({
    ok: false,
    status: 400,
    corpo: JSON.stringify({ error: 'redirect_uri_mismatch' }),
  });
  await assert.rejects(
    () =>
      trocaCodigoPorTokens(
        { cliente: CLIENTE, code: 'c', redirectUri: 'http://x/cb', verificador: 'v' },
        impl,
      ),
    /Aplicativo para desktop/,
  );
});

test('trocaCodigoPorTokens: sem id_token o campo não aparece', async () => {
  const { impl } = fetchFalso({
    corpo: JSON.stringify({ access_token: 'at', refresh_token: 'rt', scope: 's' }),
  });
  const t = await trocaCodigoPorTokens(
    { cliente: CLIENTE, code: 'c', redirectUri: 'http://x/cb', verificador: 'v' },
    impl,
  );
  assert.equal('idToken' in t, false);
});

// ------------------------------------------------------------------ refresh
test('accessTokenDeRefresh: usa grant_type=refresh_token e não manda code', async () => {
  const { impl, chamadas } = fetchFalso({ corpo: JSON.stringify({ access_token: 'novo' }) });
  const t = await accessTokenDeRefresh({ cliente: CLIENTE, refreshToken: 'rt' }, impl);
  assert.equal(t, 'novo');
  const b = chamadas[0].body;
  assert.equal(b.get('grant_type'), 'refresh_token');
  assert.equal(b.get('refresh_token'), 'rt');
  assert.equal(b.get('code'), null);
});

test('accessTokenDeRefresh: resposta sem access_token falha alto', async () => {
  const { impl } = fetchFalso({ corpo: JSON.stringify({ expires_in: 3599 }) });
  await assert.rejects(
    () => accessTokenDeRefresh({ cliente: CLIENTE, refreshToken: 'rt' }, impl),
    /sem access_token/,
  );
});

// ------------------------------------------------------------ arquivo local
function comPastaTemporaria(fn: (dir: string) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-teste-'));
    try {
      await fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

test(
  'grava/le credencial: ida e volta preserva cliente, escopos e conta',
  comPastaTemporaria((dir) => {
    const arquivo = path.join(dir, 'sub', 'cred.json');
    gravaCredencialOAuth(arquivo, {
      client_id: CLIENTE.clientId,
      refresh_token: 'rt',
      scopes: ['a', 'b'],
      obtido_em: '2026-08-06T00:00:00.000Z',
      conta: 'alguem@sebratel.com.br',
    });
    // cria a pasta que faltava
    assert.ok(fs.existsSync(arquivo));
    const lida = leCredencialOAuth(arquivo)!;
    assert.equal(lida.refresh_token, 'rt');
    assert.equal(lida.client_id, CLIENTE.clientId);
    assert.deepEqual(lida.scopes, ['a', 'b']);
    assert.equal(lida.conta, 'alguem@sebratel.com.br');
  }),
);

test(
  'leCredencialOAuth: aceita o formato authorized_user do gcloud, com secret dentro',
  comPastaTemporaria((dir) => {
    // É o arquivo que `gcloud auth application-default login` grava. Contém
    // exatamente o que precisamos, e recusá-lo obrigaria a refazer consentimento
    // que já existe.
    const arquivo = path.join(dir, 'adc.json');
    fs.writeFileSync(
      arquivo,
      JSON.stringify({
        client_id: 'gcloud-cliente.apps.googleusercontent.com',
        client_secret: 'segredo-do-gcloud',
        refresh_token: '1//rt',
        type: 'authorized_user',
        quota_project_id: 'projeto-qualquer',
      }),
    );
    const cred = leCredencialOAuth(arquivo)!;
    assert.equal(cred.formato, 'authorized_user');
    assert.equal(cred.client_secret, 'segredo-do-gcloud');
    assert.equal(cred.refresh_token, '1//rt');
    // O gcloud não registra escopo: lista vazia significa "não sei", e por isso
    // não pode virar bloqueio — quem recusa por escopo é o Google.
    assert.deepEqual(cred.scopes, []);
  }),
);

test(
  'leCredencialOAuth: chave de service account no lugar errado diz qual variável usar',
  comPastaTemporaria((dir) => {
    const arquivo = path.join(dir, 'sa.json');
    fs.writeFileSync(arquivo, JSON.stringify({ type: 'service_account', client_email: 'x@y' }));
    assert.throws(() => leCredencialOAuth(arquivo), (err: Error) => {
      assert.match(err.message, /GOOGLE_APPLICATION_CREDENTIALS/);
      assert.match(err.message, /GOOGLE_OAUTH_TOKEN_FILE/);
      return true;
    });
  }),
);

test(
  'gravaCredencialOAuth: o nosso formato é lido de volta como "nosso"',
  comPastaTemporaria((dir) => {
    const arquivo = path.join(dir, 'nosso.json');
    gravaCredencialOAuth(arquivo, {
      client_id: CLIENTE.clientId,
      refresh_token: 'rt',
      scopes: ['a'],
      obtido_em: '2026-08-06T00:00:00.000Z',
    });
    assert.equal(leCredencialOAuth(arquivo)!.formato, 'nosso');
  }),
);

test('leCredencialOAuth: arquivo ausente é null, não erro', () => {
  assert.equal(leCredencialOAuth(path.join(os.tmpdir(), 'nao-existe-oauth-xyz.json')), null);
  assert.equal(leCredencialOAuth(''), null);
});

test(
  'leCredencialOAuth: JSON quebrado e falta de refresh_token falham dizendo o que fazer',
  comPastaTemporaria((dir) => {
    const quebrado = path.join(dir, 'quebrado.json');
    fs.writeFileSync(quebrado, '{ não é json');
    assert.throws(() => leCredencialOAuth(quebrado), /auth:google/);

    const semToken = path.join(dir, 'sem.json');
    fs.writeFileSync(semToken, JSON.stringify({ client_id: 'x' }));
    assert.throws(() => leCredencialOAuth(semToken), /refresh_token/);
  }),
);

// --------------------------------------------------------- tokenDeUsuario
test('tokenDeUsuario: refresh token de outro cliente falha ANTES de tocar a rede', () => {
  let chamou = false;
  const impl: FetchLike = async () => {
    chamou = true;
    return { ok: true, status: 200, text: async () => '{}' };
  };
  assert.throws(
    () =>
      tokenDeUsuario(
        {
          cliente: CLIENTE,
          credencial: {
            client_id: 'outro-cliente.apps.googleusercontent.com',
            refresh_token: 'rt',
            scopes: [],
            obtido_em: '',
          },
          scopes: [],
        },
        impl,
      ),
    /OUTRO cliente OAuth/,
  );
  assert.equal(chamou, false);
});

test('tokenDeUsuario: escopo não concedido falha dizendo que refresh não amplia escopo', () => {
  assert.throws(
    () =>
      tokenDeUsuario({
        cliente: CLIENTE,
        credencial: {
          client_id: CLIENTE.clientId,
          refresh_token: 'rt',
          scopes: ['escopo/a'],
          obtido_em: '',
        },
        scopes: ['escopo/a', 'escopo/b'],
      }),
    /escopo\/b/,
  );
});

test('tokenDeUsuario: credencial sem lista de escopos não é bloqueada', async () => {
  // Arquivo antigo, gravado antes de guardarmos escopos: recusar aqui inventaria
  // um problema. Se o escopo realmente faltar, o Google recusa e o erro é dele.
  const { impl } = fetchFalso({ corpo: JSON.stringify({ access_token: 'at' }) });
  const token = tokenDeUsuario(
    {
      cliente: CLIENTE,
      credencial: { client_id: CLIENTE.clientId, refresh_token: 'rt', scopes: [], obtido_em: '' },
      scopes: ['qualquer'],
    },
    impl,
  );
  assert.equal(await token(), 'at');
});

test('tokenDeUsuario: caso bom troca refresh por access token', async () => {
  const { impl, chamadas } = fetchFalso({ corpo: JSON.stringify({ access_token: 'at' }) });
  const token = tokenDeUsuario(
    {
      cliente: CLIENTE,
      credencial: {
        client_id: CLIENTE.clientId,
        refresh_token: 'rt',
        scopes: ['escopo/a'],
        obtido_em: '',
      },
      scopes: ['escopo/a'],
    },
    impl,
  );
  assert.equal(await token(), 'at');
  assert.equal(chamadas[0].body.get('refresh_token'), 'rt');
});
