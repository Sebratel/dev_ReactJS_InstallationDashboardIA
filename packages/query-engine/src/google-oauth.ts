// OAuth de usuário no Google — o segundo caminho de acesso às planilhas.
//
// **Por que existe, ao lado da service account.** São credenciais de naturezas
// diferentes, e a diferença é quem tem permissão:
//
//   - service account: identidade própria, e a planilha precisa ser compartilhada
//     com ela. É o caminho certo para produção — não depende de pessoa nenhuma.
//   - OAuth de usuário: a plataforma age *como uma pessoa* que já tem acesso.
//     Não exige compartilhar nada, e é por isso que desbloqueia hoje.
//
// Client ID e client secret **não são acesso**: identificam o aplicativo. O acesso
// vem do consentimento de uma conta Google, uma vez, no navegador — e é o acesso
// *dessa conta* que a plataforma passa a ter. Ver `npm run auth:google`.
//
// O refresh token é credencial de longa duração e vive FORA do repositório
// (`GOOGLE_OAUTH_TOKEN_FILE`), como a chave da service account. Nada aqui loga
// token, código de autorização, secret ou verificador PKCE.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ENDPOINT_AUTORIZACAO = 'https://accounts.google.com/o/oauth2/v2/auth';
export const ENDPOINT_TOKEN = 'https://oauth2.googleapis.com/token';

/** `fetch` injetável — permite testar a troca de código sem rede. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface ClienteOAuth {
  readonly clientId: string;
  readonly clientSecret: string;
}

// ------------------------------------------------------------------- PKCE
export interface Pkce {
  readonly verificador: string;
  readonly desafio: string;
}

/**
 * Par PKCE (S256).
 *
 * Obrigatório para cliente do tipo "Desktop", e barato o suficiente para usar
 * sempre: sem ele, um código de autorização interceptado no loopback pode ser
 * trocado por token por quem o interceptou, já que o secret de cliente desktop
 * não é secreto de verdade (vai distribuído no binário, por definição).
 */
export function pkce(bytes: () => Buffer = () => crypto.randomBytes(32)): Pkce {
  const verificador = bytes().toString('base64url');
  const desafio = crypto.createHash('sha256').update(verificador).digest('base64url');
  return { verificador, desafio };
}

/** Valor anti-CSRF que volta na query string do redirect e precisa conferir. */
export function state(bytes: () => Buffer = () => crypto.randomBytes(16)): string {
  return bytes().toString('base64url');
}

// -------------------------------------------------------- URL de autorização
export interface ParamsDeAutorizacao {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly desafio: string;
  readonly state: string;
  /** Conta sugerida na tela de consentimento — só dica visual, não restrição. */
  readonly loginHint?: string;
}

/**
 * Monta a URL da tela de consentimento.
 *
 * Dois parâmetros que não são opcionais na prática:
 *
 *   - `access_type=offline` é o que faz o Google devolver **refresh token**. Sem
 *     ele vem só um access token de 1h, e a plataforma pediria consentimento a
 *     cada hora.
 *   - `prompt=consent` força a tela mesmo quando a conta já autorizou este
 *     aplicativo antes. Sem isso, a segunda autorização volta **sem**
 *     `refresh_token` — o Google só o emite uma vez por concessão, e o sintoma é
 *     um fluxo que "funcionou" e não deixou credencial nenhuma.
 */
export function urlDeAutorizacao(p: ParamsDeAutorizacao): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: p.scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: p.desafio,
    code_challenge_method: 'S256',
    state: p.state,
  });
  if (p.loginHint) q.set('login_hint', p.loginHint);
  return `${ENDPOINT_AUTORIZACAO}?${q}`;
}

// ------------------------------------------------------------ erros do Google
/**
 * Traduz os erros do endpoint de token em instrução.
 *
 * A lista não é genérica: são os que acontecem ao usar um cliente OAuth que
 * alguém já criou noutro projeto — o caso desta base.
 */
export function explicaErroOAuth(status: number, corpo: string): string {
  let erro = '';
  let descricao = '';
  try {
    const j = JSON.parse(corpo || '{}') as { error?: string; error_description?: string };
    erro = j.error ?? '';
    descricao = j.error_description ?? '';
  } catch {
    descricao = corpo.slice(0, 200);
  }
  const detalhe = [erro, descricao].filter(Boolean).join(': ') || `HTTP ${status}`;
  if (erro === 'redirect_uri_mismatch') {
    return `${detalhe}\n` +
      '  O cliente OAuth não aceita o endereço de loopback usado. Isso quer dizer que\n' +
      '  ele é do tipo "Aplicativo da Web", não "Aplicativo para desktop". Duas saídas:\n' +
      '    a) no console → Credenciais → o cliente → adicionar o URI de redirecionamento\n' +
      '       autorizado exatamente como impresso acima;\n' +
      '    b) criar um cliente do tipo "Aplicativo para desktop", que aceita loopback\n' +
      '       em qualquer porta sem cadastro.';
  }
  if (erro === 'invalid_client') {
    return `${detalhe}\n` +
      '  Client ID ou client secret não conferem. Confira GOOGLE_OAUTH_CLIENT_ID e\n' +
      '  GOOGLE_OAUTH_CLIENT_SECRET no .env — e que os dois são do MESMO cliente.';
  }
  if (erro === 'invalid_grant') {
    return `${detalhe}\n` +
      '  O refresh token não vale mais. As causas comuns: foi revogado, a senha da\n' +
      '  conta mudou, ficou 6 meses sem uso, ou a tela de consentimento está em modo\n' +
      '  "Teste" (nesse modo o Google expira o refresh token em 7 dias).\n' +
      '  Rode `npm run auth:google` de novo.';
  }
  if (erro === 'admin_policy_enforced' || /admin/i.test(descricao)) {
    return `${detalhe}\n` +
      '  O Workspace da organização bloqueia este aplicativo. Só um administrador\n' +
      '  libera (confiar no app pelo client ID). Nesse caso o caminho da service\n' +
      '  account tende a ser mais rápido do que insistir aqui.';
  }
  return detalhe;
}

/** Falha no fluxo OAuth — distinguível de erro de planilha. */
export class OAuthError extends Error {}

async function postToken(
  body: URLSearchParams,
  fetchImpl: FetchLike,
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(ENDPOINT_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });
  const corpo = await res.text();
  if (!res.ok) throw new OAuthError(explicaErroOAuth(res.status, corpo));
  try {
    return JSON.parse(corpo) as Record<string, unknown>;
  } catch {
    throw new OAuthError(`resposta do endpoint de token não é JSON (${corpo.length} bytes)`);
  }
}

// ----------------------------------------------------- troca de código/refresh
export interface TokensObtidos {
  readonly refreshToken: string;
  readonly accessToken: string;
  readonly scopesConcedidos: readonly string[];
  /** Presente quando `openid` está entre os escopos. Só serve para saber QUEM autorizou. */
  readonly idToken?: string;
}

export async function trocaCodigoPorTokens(
  p: {
    cliente: ClienteOAuth;
    code: string;
    redirectUri: string;
    verificador: string;
  },
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<TokensObtidos> {
  const json = await postToken(
    new URLSearchParams({
      code: p.code,
      client_id: p.cliente.clientId,
      client_secret: p.cliente.clientSecret,
      redirect_uri: p.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: p.verificador,
    }),
    fetchImpl,
  );
  const refreshToken = typeof json.refresh_token === 'string' ? json.refresh_token : '';
  const accessToken = typeof json.access_token === 'string' ? json.access_token : '';
  if (!refreshToken) {
    // Acontece de verdade: sem `prompt=consent`, uma conta que já autorizou este
    // cliente recebe access token e nenhum refresh. Falhar aqui é melhor do que
    // gravar um arquivo que não serve para a próxima execução.
    throw new OAuthError(
      'o Google devolveu access token mas NENHUM refresh token. Sem ele a autorização ' +
        'vale 1h e não dá para reusar. Costuma ser concessão já existente: revogue o ' +
        'acesso em myaccount.google.com/permissions e rode `npm run auth:google` de novo.',
    );
  }
  if (!accessToken) throw new OAuthError('resposta sem access_token.');
  const scope = typeof json.scope === 'string' ? json.scope : '';
  return {
    refreshToken,
    accessToken,
    scopesConcedidos: scope.split(' ').filter(Boolean),
    ...(typeof json.id_token === 'string' ? { idToken: json.id_token } : {}),
  };
}

export async function accessTokenDeRefresh(
  p: { cliente: ClienteOAuth; refreshToken: string },
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<string> {
  const json = await postToken(
    new URLSearchParams({
      client_id: p.cliente.clientId,
      client_secret: p.cliente.clientSecret,
      refresh_token: p.refreshToken,
      grant_type: 'refresh_token',
    }),
    fetchImpl,
  );
  const token = typeof json.access_token === 'string' ? json.access_token : '';
  if (!token) throw new OAuthError('resposta de refresh sem access_token.');
  return token;
}

// -------------------------------------------------------------- arquivo local
/**
 * O que se guarda no disco. `client_id` entra junto de propósito: refresh token
 * é atrelado ao cliente que o emitiu, então trocar o cliente no `.env` sem
 * reautorizar dá `invalid_grant` — erro genérico que custa meia hora. Guardar o
 * id permite dizer a causa exata.
 *
 * `scopes` também: refresh token carrega os escopos do consentimento, e não há
 * como pedir escopo novo na hora do refresh.
 */
export interface CredencialOAuthGravada {
  readonly client_id: string;
  readonly refresh_token: string;
  readonly scopes: string[];
  readonly obtido_em: string;
  readonly conta?: string;
  /**
   * Só vem preenchido quando o arquivo é do formato `authorized_user` do Google,
   * que carrega o secret dentro dele. No nosso formato o secret fica no `.env`.
   */
  readonly client_secret?: string;
  /** De onde o arquivo veio — muda o que se pode afirmar sobre os escopos. */
  readonly formato: 'nosso' | 'authorized_user';
}

export function gravaCredencialOAuth(
  arquivo: string,
  cred: Omit<CredencialOAuthGravada, 'formato'>,
): void {
  const dir = path.dirname(arquivo);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // 0600: no Windows o modo é indicativo, mas a intenção fica registrada e vale
  // em WSL/Linux, onde este repo também roda.
  fs.writeFileSync(arquivo, `${JSON.stringify(cred, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Lê a credencial de usuário, em qualquer um dos dois formatos que aparecem aqui.
 *
 * O segundo formato não é capricho: `gcloud auth application-default login` grava
 * um `authorized_user`, que é **exatamente** o que este módulo precisa — client
 * id, client secret e refresh token de uma pessoa que já consentiu. Aceitá-lo
 * dispensa refazer o consentimento.
 *
 * **O que ele não diz: os escopos.** O arquivo do gcloud não os registra, e o
 * consentimento dele normalmente concede `cloud-platform` — que **não** inclui
 * Sheets nem Drive. Então este caminho pode autenticar e ainda assim ser recusado
 * na leitura; quem diagnostica isso é `explicaErroSheets`, no 403 de escopo.
 */
export function leCredencialOAuth(arquivo: string): CredencialOAuthGravada | null {
  if (!arquivo || !fs.existsSync(arquivo)) return null;
  let json: Partial<CredencialOAuthGravada> & { type?: string; client_secret?: string };
  try {
    json = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch (err) {
    throw new OAuthError(
      `${arquivo} não é JSON válido: ${err instanceof Error ? err.message : err}. ` +
        'Apague e rode `npm run auth:google`.',
    );
  }
  if (json.type === 'service_account') {
    throw new OAuthError(
      `${arquivo} é uma chave de SERVICE ACCOUNT, não credencial de usuário. Ela vai ` +
        'em GOOGLE_APPLICATION_CREDENTIALS, não em GOOGLE_OAUTH_TOKEN_FILE.',
    );
  }
  if (!json.refresh_token) {
    throw new OAuthError(
      `${arquivo} não tem "refresh_token" — sem ele não há acesso reutilizável. ` +
        'Se o arquivo veio de outra pessoa, confira que é o completo; ou rode ' +
        '`npm run auth:google` para gerar um.',
    );
  }
  const authorizedUser = json.type === 'authorized_user';
  return {
    client_id: json.client_id ?? '',
    refresh_token: json.refresh_token,
    // O formato do gcloud não registra escopo. Lista vazia significa "não sei",
    // e é tratada como tal: não bloqueia, e o Google recusa se faltar.
    scopes: json.scopes ?? [],
    obtido_em: json.obtido_em ?? '',
    conta: json.conta,
    ...(json.client_secret ? { client_secret: json.client_secret } : {}),
    formato: authorizedUser ? 'authorized_user' : 'nosso',
  };
}

/**
 * Provedor de access token a partir da credencial gravada.
 *
 * Verifica **antes de qualquer rede** duas coisas que produzem erros obscuros
 * quando passam: cliente diferente do que emitiu o refresh token, e escopo
 * pedido que não foi concedido.
 */
export function tokenDeUsuario(
  p: {
    cliente: ClienteOAuth;
    credencial: CredencialOAuthGravada;
    scopes: readonly string[];
  },
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): () => Promise<string> {
  if (p.credencial.client_id && p.credencial.client_id !== p.cliente.clientId) {
    throw new OAuthError(
      'o refresh token gravado foi emitido para OUTRO cliente OAuth ' +
        `(…${p.credencial.client_id.slice(-14)}), e o .env aponta para ` +
        `…${p.cliente.clientId.slice(-14)}. Refresh token não é transferível entre ` +
        'clientes: rode `npm run auth:google` para reautorizar com o cliente atual.',
    );
  }
  const faltando = p.scopes.filter((s) => !p.credencial.scopes.includes(s));
  if (p.credencial.scopes.length && faltando.length) {
    throw new OAuthError(
      `a autorização gravada não inclui o escopo ${faltando.join(', ')}. Escopo é ` +
        'decidido no consentimento e não pode ser ampliado no refresh — rode ' +
        '`npm run auth:google` de novo.',
    );
  }
  return () =>
    accessTokenDeRefresh(
      { cliente: p.cliente, refreshToken: p.credencial.refresh_token },
      fetchImpl,
    );
}
