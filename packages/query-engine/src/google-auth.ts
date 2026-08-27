// Autenticação de service account do Google, sem dependência externa.
//
// O fluxo é o "JWT bearer" documentado em
// https://developers.google.com/identity/protocols/oauth2/service-account:
// assina-se um JWT com a chave privada do arquivo de credencial e troca-se esse
// JWT por um access token. São ~40 linhas com `node:crypto`, e é o motivo de não
// entrar a biblioteca `googleapis` (que traz dezenas de dependências para isto).
//
// Nada aqui loga a chave privada nem o access token.

import crypto from 'node:crypto';
import fs from 'node:fs';

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
  project_id?: string;
}

/**
 * Lê e valida o JSON da service account. Falha alto e dizendo onde: credencial
 * ausente é o erro mais comum de configuração, e "undefined is not a function"
 * três camadas acima não ajuda ninguém.
 */
export function readServiceAccount(credentialsPath: string): ServiceAccount {
  if (!credentialsPath) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS está vazio. Aponte para o JSON da service ' +
        'account, guardado FORA do repositório. Ver .env.example.',
    );
  }
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`GOOGLE_APPLICATION_CREDENTIALS aponta para ${credentialsPath}, que não existe.`);
  }
  let json: Partial<ServiceAccount> & { type?: string };
  try {
    json = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `${credentialsPath} não é JSON válido: ${err instanceof Error ? err.message : err}`,
    );
  }
  if (json.type !== 'service_account') {
    throw new Error(
      `${credentialsPath} tem type="${json.type}", não "service_account". Chave de ` +
        'usuário ou de API não serve aqui — precisa ser conta de serviço.',
    );
  }
  for (const campo of ['client_email', 'private_key', 'token_uri'] as const) {
    if (!json[campo]) throw new Error(`${credentialsPath} não tem o campo "${campo}".`);
  }
  return json as ServiceAccount;
}

const b64url = (v: string | Buffer): string => Buffer.from(v as never).toString('base64url');

/**
 * Troca a credencial por um access token com os escopos pedidos.
 *
 * Peça escopo `.readonly`: a regra read-only do projeto vale para o Google Sheets
 * também, e um escopo de escrita concedido "por engano" é o tipo de coisa que
 * ninguém revisa depois.
 */
export async function accessToken(sa: ServiceAccount, scopes: string[]): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: scopes.join(' '),
      aud: sa.token_uri,
      iat: agora,
      exp: agora + 3600,
    }),
  );
  const assinatura = b64url(
    crypto.createSign('RSA-SHA256').update(`${cabecalho}.${claims}`).sign(sa.private_key),
  );
  const jwt = `${cabecalho}.${claims}.${assinatura}`;

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const corpo = await res.text();
  if (!res.ok) {
    // O corpo do erro do Google não contém a chave, mas contém o client_email;
    // é justamente o que se precisa ver para diagnosticar, então passa.
    throw new Error(`troca de JWT por token falhou: HTTP ${res.status} — ${corpo.slice(0, 300)}`);
  }
  const token = (JSON.parse(corpo) as { access_token?: string }).access_token;
  if (!token) throw new Error(`resposta do token sem access_token: ${corpo.slice(0, 200)}`);
  return token;
}

export const SCOPE_SHEETS_READONLY = 'https://www.googleapis.com/auth/spreadsheets.readonly';

/**
 * Só metadado do Drive (id, nome, dono) — nem conteúdo de arquivo.
 *
 * Usado apenas pelo `probe:gsheets`, para listar o que a conta de serviço
 * alcança. É a diferença entre "acho que compartilhei" e uma contagem: lista
 * vazia prova que o compartilhamento não chegou nesta identidade, sem precisar
 * que alguém abra a caixa de compartilhamento e leia o e-mail em voz alta.
 */
export const SCOPE_DRIVE_METADATA_READONLY =
  'https://www.googleapis.com/auth/drive.metadata.readonly';
