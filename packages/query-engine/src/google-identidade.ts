// Escolhe COM QUAL identidade o Google é acessado, e diz qual escolheu.
//
// Existem duas, e a diferença importa para quem lê o erro depois:
//
//   service account — identidade própria da plataforma. Exige que a planilha
//     seja compartilhada com o e-mail dela. É o alvo de produção: não depende de
//     pessoa, não expira quando alguém sai da empresa.
//   OAuth de usuário — a plataforma age como uma pessoa que já tem acesso. Não
//     exige compartilhar nada, e é o que desbloqueia enquanto o compartilhamento
//     não acontece (ACHADOS.md #23).
//
// A escolha é explícita e imprimível de propósito: "sem permissão" tem soluções
// opostas nos dois casos — num, compartilhar com um robô; no outro, reautorizar
// com uma conta que enxergue a planilha.

import { tokenComCache } from './connectors-gsheets.ts';
import type { PlatformConfig } from './config.ts';
import { accessToken, readServiceAccount, type ServiceAccount } from './google-auth.ts';
import {
  leCredencialOAuth,
  tokenDeUsuario,
  type CredencialOAuthGravada,
  type FetchLike,
} from './google-oauth.ts';

export type TipoDeIdentidade = 'oauth' | 'service_account';

export interface IdentidadeGoogle {
  readonly tipo: TipoDeIdentidade;
  /** Quem é, em texto — e-mail da conta de serviço ou da conta que consentiu. */
  readonly rotulo: string;
  /** Access token com cache (o token vale 1h; uma carga faz várias chamadas). */
  readonly token: () => Promise<string>;
  /** A service account, quando é o caso — o probe usa para pedir outro escopo. */
  readonly contaDeServico?: ServiceAccount;
}

export interface OpcoesDeIdentidade {
  readonly fetchImpl?: FetchLike;
  /** Injetável para teste; em produção é o `readServiceAccount` real. */
  readonly leServiceAccount?: typeof readServiceAccount;
  readonly leCredencial?: typeof leCredencialOAuth;
}

/**
 * Resolve a identidade a partir da configuração.
 *
 * Precedência entre as três fontes de OAuth: **`.env` direto (refresh token em
 * `GOOGLE_OAUTH_REFRESH_TOKEN`) vence o arquivo apontado por `tokenFile`.** É a
 * mesma convenção de toda outra credencial deste projeto — `.env` é a fonte
 * simples, sem arquivo à parte — e evitar arquivo é o caso comum: quem colou o
 * refresh token direto no `.env` normalmente não tem (nem quer criar) um JSON à
 * parte, então ler o arquivo mesmo assim seria surpresa, não ajuda.
 *
 * E o par OAuth-vs-service-account: **OAuth ganha quando há refresh token, de
 * qualquer uma das duas fontes.** Não por ser melhor — é o contrário —, mas
 * porque ter um refresh token configurado é decisão deliberada de alguém,
 * enquanto a chave da service account costuma estar sempre lá. Deixar a service
 * account ganhar faria essa decisão ser ignorada em silêncio.
 */
export function identidadeGoogle(
  gsheets: PlatformConfig['gsheets'],
  scopes: readonly string[],
  opts: OpcoesDeIdentidade = {},
): IdentidadeGoogle {
  const leCred = opts.leCredencial ?? leCredencialOAuth;
  const leSa = opts.leServiceAccount ?? readServiceAccount;
  const { tokenFile, refreshToken } = gsheets.oauth;

  const credencial: CredencialOAuthGravada | null = refreshToken
    ? { client_id: gsheets.oauth.clientId, refresh_token: refreshToken, scopes: [], obtido_em: '', formato: 'nosso' }
    : tokenFile
      ? leCred(tokenFile)
      : null;
  const doEnvDireto = Boolean(refreshToken);

  // O client id/secret pode vir do `.env` **ou** de dentro do arquivo apontado: o
  // formato `authorized_user` do gcloud carrega os dois. Preferir o `.env` quando
  // existe mantém possível apontar um cliente diferente sem editar a credencial.
  const clientId = gsheets.oauth.clientId || credencial?.client_id || '';
  const clientSecret = gsheets.oauth.clientSecret || credencial?.client_secret || '';

  if (credencial && clientId && clientSecret) {
    const obtem = tokenDeUsuario(
      { cliente: { clientId, clientSecret }, credencial, scopes },
      opts.fetchImpl,
    );
    const origem = doEnvDireto
      ? ''
      : credencial.formato === 'authorized_user'
        ? ' — arquivo do gcloud'
        : ` — arquivo ${tokenFile}`;
    return {
      tipo: 'oauth',
      rotulo: credencial.conta
        ? `${credencial.conta} (OAuth de usuário${origem})`
        : `conta de usuário via OAuth${origem}`,
      token: tokenComCache(obtem),
    };
  }
  if (credencial && !clientSecret) {
    const onde = doEnvDireto ? 'GOOGLE_OAUTH_REFRESH_TOKEN' : tokenFile;
    throw new Error(
      `Há refresh token em ${onde}, mas falta o client secret para usá-lo. Ele não ` +
        'está em GOOGLE_OAUTH_CLIENT_SECRET no .env' +
        (doEnvDireto ? '' : ' nem no arquivo (formato sem `client_secret`)') +
        '. Refresh token só é trocado por access token pelo cliente que o emitiu.',
    );
  }

  if (gsheets.credentialsPath) {
    const sa = leSa(gsheets.credentialsPath);
    return {
      tipo: 'service_account',
      rotulo: sa.client_email,
      token: tokenComCache(() => accessToken(sa, [...scopes])),
      contaDeServico: sa,
    };
  }

  throw new Error(
    'Nenhuma credencial do Google configurada. Há caminhos, e basta um:\n' +
      '  a) service account: GOOGLE_APPLICATION_CREDENTIALS apontando para o JSON da\n' +
      '     chave, e cada planilha compartilhada com o e-mail dela como Leitor;\n' +
      '  b) OAuth de usuário, direto no .env: GOOGLE_OAUTH_CLIENT_ID + _CLIENT_SECRET\n' +
      '     + GOOGLE_OAUTH_REFRESH_TOKEN (peça a quem já autorizou, ou rode\n' +
      '     `npm run auth:google` e copie o refresh_token do arquivo gerado);\n' +
      '  c) OAuth de usuário via arquivo: GOOGLE_OAUTH_TOKEN_FILE apontando para o\n' +
      '     JSON gerado por `npm run auth:google` ou por\n' +
      '     `gcloud auth application-default login`.\n' +
      'Ver .env.example.',
  );
}

/** Por que a outra identidade não foi usada — para o probe explicar a escolha. */
export function porQueNaoAOutra(
  gsheets: PlatformConfig['gsheets'],
  escolhida: TipoDeIdentidade,
): string {
  const { clientId, clientSecret, tokenFile, refreshToken } = gsheets.oauth;
  if (escolhida === 'oauth') {
    return gsheets.credentialsPath
      ? 'a service account existe, mas o OAuth configurado tem precedência'
      : 'não há chave de service account configurada';
  }
  if (!tokenFile && !refreshToken && !clientId && !clientSecret) return 'OAuth não configurado';
  if (!tokenFile && !refreshToken) {
    return 'OAuth sem refresh token — falta GOOGLE_OAUTH_REFRESH_TOKEN ou GOOGLE_OAUTH_TOKEN_FILE';
  }
  // Chega aqui com refresh token (do .env ou de arquivo): falta o cliente.
  if (!clientId || !clientSecret) {
    return refreshToken
      ? 'OAuth com refresh token no .env, mas sem GOOGLE_OAUTH_CLIENT_ID/_SECRET'
      : 'OAuth sem client id/secret — nem no .env, nem dentro do arquivo apontado';
  }
  return 'OAuth configurado mas sem credencial gravada — rode `npm run auth:google`';
}
