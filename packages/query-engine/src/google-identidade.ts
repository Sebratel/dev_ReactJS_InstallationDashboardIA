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
 * Precedência: **OAuth ganha quando há credencial gravada.** Não por ser melhor
 * — é o contrário —, mas porque a existência do arquivo de refresh token é uma
 * decisão deliberada de alguém que rodou `npm run auth:google`, enquanto a
 * chave da service account está sempre lá. Deixar a service account ganhar
 * faria o fluxo autorizado ser ignorado em silêncio.
 */
export function identidadeGoogle(
  gsheets: PlatformConfig['gsheets'],
  scopes: readonly string[],
  opts: OpcoesDeIdentidade = {},
): IdentidadeGoogle {
  const leCred = opts.leCredencial ?? leCredencialOAuth;
  const leSa = opts.leServiceAccount ?? readServiceAccount;
  const { tokenFile } = gsheets.oauth;

  const credencial: CredencialOAuthGravada | null = tokenFile ? leCred(tokenFile) : null;

  // O client id/secret pode vir do `.env` **ou** de dentro do próprio arquivo: o
  // formato `authorized_user` do gcloud carrega os dois. Preferir o `.env` quando
  // existe mantém possível apontar um cliente diferente sem editar a credencial.
  const clientId = gsheets.oauth.clientId || credencial?.client_id || '';
  const clientSecret = gsheets.oauth.clientSecret || credencial?.client_secret || '';

  if (credencial && clientId && clientSecret) {
    const obtem = tokenDeUsuario(
      { cliente: { clientId, clientSecret }, credencial, scopes },
      opts.fetchImpl,
    );
    const origem = credencial.formato === 'authorized_user' ? ' — arquivo do gcloud' : '';
    return {
      tipo: 'oauth',
      rotulo: credencial.conta
        ? `${credencial.conta} (OAuth de usuário${origem})`
        : `conta de usuário via OAuth${origem}`,
      token: tokenComCache(obtem),
    };
  }
  if (credencial && !clientSecret) {
    throw new Error(
      `${tokenFile} tem refresh token, mas falta o client secret para usá-lo. Ele não ` +
        'está no arquivo (formato sem `client_secret`) nem em GOOGLE_OAUTH_CLIENT_SECRET ' +
        'no .env. Refresh token só é trocado por access token pelo cliente que o emitiu.',
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
    'Nenhuma credencial do Google configurada. Há dois caminhos, e basta um:\n' +
      '  a) service account: GOOGLE_APPLICATION_CREDENTIALS apontando para o JSON da\n' +
      '     chave, e cada planilha compartilhada com o e-mail dela como Leitor;\n' +
      '  b) OAuth de usuário: GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET +\n' +
      '     GOOGLE_OAUTH_TOKEN_FILE, e então `npm run auth:google` uma vez.\n' +
      'Ver .env.example.',
  );
}

/** Por que a outra identidade não foi usada — para o probe explicar a escolha. */
export function porQueNaoAOutra(
  gsheets: PlatformConfig['gsheets'],
  escolhida: TipoDeIdentidade,
): string {
  const { clientId, clientSecret, tokenFile } = gsheets.oauth;
  if (escolhida === 'oauth') {
    return gsheets.credentialsPath
      ? 'a service account existe, mas o OAuth gravado tem precedência'
      : 'não há chave de service account configurada';
  }
  if (!tokenFile && !clientId && !clientSecret) return 'OAuth não configurado';
  if (!tokenFile) return 'OAuth sem GOOGLE_OAUTH_TOKEN_FILE definido';
  // Chega aqui com arquivo apontado: ou ele não existe, ou não trouxe o cliente.
  if (!clientId || !clientSecret) {
    return 'OAuth sem client id/secret — nem no .env, nem dentro do arquivo apontado';
  }
  return 'OAuth configurado mas sem credencial gravada — rode `npm run auth:google`';
}
