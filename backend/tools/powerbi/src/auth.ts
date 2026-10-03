// Token do Power BI por device code — o login é seu, no navegador.
//
// **Por que device code e não client secret.** Segredo de aplicação exigiria
// registrar um service principal e habilitá-lo no tenant, que é pedido a
// administrador. O device code usa a **sua** conta: você já tem acesso ao
// relatório, e o token herda exatamente esse acesso — nem mais, nem menos.
//
// **O token é credencial e não entra no repositório.** Ele é gravado em
// `~/.secrets/powerbi-token.json` por padrão, pela mesma razão que
// `GOOGLE_OAUTH_TOKEN_FILE` não tem default dentro do repo: o `Desktop` inteiro é
// um repositório git com remoto configurado.
//
// **Onde a garantia de somente-leitura realmente mora.** NÃO é no escopo: o
// `ESCOPO` abaixo pede `.default`, que devolve tudo o que a sua conta pode fazer
// no Power BI — inclusive escrita. Quem impede a escrita é `assertSomenteEvaluate`
// em `api.ts`, que recusa qualquer DAX que não comece por `EVALUATE`, e o fato de
// a Execute Queries API não ter verbo de gravação. Trate o arquivo de token como
// credencial plena da sua conta, não como um token de leitura.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Client id público do Azure CLI.
 *
 * Cliente de primeira parte da Microsoft, público (sem segredo), usado por device
 * code em ferramenta de linha de comando. Não dá acesso a nada sozinho: o acesso
 * vem do login da pessoa e do consentimento do tenant. Se o tenant da Sebratel
 * bloquear este client, registre um app próprio e ponha o id em `AZURE_CLIENT_ID`.
 */
const CLIENT_ID_PADRAO = '04b07795-8ddb-461a-bbee-02f9e1bf7b46';

const ESCOPO = 'https://analysis.windows.net/powerbi/api/.default offline_access';

export interface TokenGuardado {
  access_token: string;
  refresh_token?: string;
  /** Epoch ms em que expira. */
  expira_em: number;
  tenant: string;
}

export function arquivoDeToken(): string {
  return (
    process.env.POWERBI_TOKEN_FILE ??
    path.join(os.homedir(), '.secrets', 'powerbi-token.json')
  );
}

function leGuardado(): TokenGuardado | null {
  const f = arquivoDeToken();
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8')) as TokenGuardado;
  } catch {
    return null;
  }
}

function grava(t: TokenGuardado): void {
  const f = arquivoDeToken();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(t, null, 2), 'utf8');
  // Sem imprimir o token. O caminho, sim — para você saber onde apagar.
  console.error(`  token guardado em ${f}`);
}

async function postForm(url: string, corpo: Record<string, string>): Promise<Record<string, unknown>> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(corpo).toString(),
  });
  return (await r.json()) as Record<string, unknown>;
}

/** Renova pelo refresh token. `null` se não deu — quem chama cai no device code. */
async function renova(t: TokenGuardado, clientId: string): Promise<TokenGuardado | null> {
  if (!t.refresh_token) return null;
  const r = await postForm(
    `https://login.microsoftonline.com/${t.tenant}/oauth2/v2.0/token`,
    {
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: t.refresh_token,
      scope: ESCOPO,
    },
  );
  if (typeof r['access_token'] !== 'string') return null;
  return {
    access_token: r['access_token'],
    refresh_token: (r['refresh_token'] as string) ?? t.refresh_token,
    expira_em: Date.now() + Number(r['expires_in'] ?? 3600) * 1000,
    tenant: t.tenant,
  };
}

/**
 * Um access token válido. Renova se der; senão pede o login no navegador.
 *
 * A margem de 60 s evita o caso em que o token vence entre a checagem e a chamada
 * — numa validação de 75 medidas isso aconteceria no meio da execução.
 */
export async function pegaToken(tenant: string): Promise<string> {
  const clientId = process.env.AZURE_CLIENT_ID ?? CLIENT_ID_PADRAO;

  const guardado = leGuardado();
  if (guardado && guardado.tenant === tenant) {
    if (guardado.expira_em > Date.now() + 60_000) return guardado.access_token;
    const novo = await renova(guardado, clientId);
    if (novo) {
      grava(novo);
      return novo.access_token;
    }
  }

  const inicio = await postForm(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/devicecode`,
    { client_id: clientId, scope: ESCOPO },
  );
  if (typeof inicio['device_code'] !== 'string') {
    throw new Error(
      `Não consegui iniciar o login: ${String(inicio['error_description'] ?? JSON.stringify(inicio))}`,
    );
  }

  console.error(`\n  ${String(inicio['message'])}\n`);

  const deviceCode = inicio['device_code'];
  const intervalo = Number(inicio['interval'] ?? 5) * 1000;
  const prazo = Date.now() + Number(inicio['expires_in'] ?? 900) * 1000;

  while (Date.now() < prazo) {
    await new Promise((r) => setTimeout(r, intervalo));
    const r = await postForm(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        client_id: clientId,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
      },
    );
    if (typeof r['access_token'] === 'string') {
      const t: TokenGuardado = {
        access_token: r['access_token'],
        refresh_token: r['refresh_token'] as string | undefined,
        expira_em: Date.now() + Number(r['expires_in'] ?? 3600) * 1000,
        tenant,
      };
      grava(t);
      return t.access_token;
    }
    const erro = String(r['error'] ?? '');
    // `authorization_pending` é o caso normal: você ainda não terminou no navegador.
    if (erro === 'authorization_pending' || erro === 'slow_down') continue;
    throw new Error(`Login falhou: ${String(r['error_description'] ?? erro)}`);
  }
  throw new Error('O código do login expirou antes de você concluir no navegador.');
}
