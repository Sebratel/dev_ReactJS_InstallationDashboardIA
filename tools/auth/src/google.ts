#!/usr/bin/env node
// `npm run auth:google` — autoriza UMA vez e grava o refresh token.
//
// Roda o fluxo "authorization code + PKCE" com redirecionamento para loopback:
// sobe um servidor em 127.0.0.1, abre a tela de consentimento do Google, recebe o
// código de volta e o troca por um refresh token.
//
// O QUE ISTO CONCEDE: o acesso da conta Google que você escolher na tela. É o
// ponto todo — as 3 planilhas não estão compartilhadas com a service account, mas
// estão com pessoas. Escolha uma conta que enxergue as planilhas.
//
// NÃO IMPRIME credencial: nem código de autorização, nem access token, nem
// refresh token. A saída diz apenas em qual arquivo gravou, qual conta autorizou
// e quais escopos foram concedidos — segura para colar em ticket.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv, loadConfig } from '../../../packages/query-engine/src/config.ts';
import {
  SCOPE_DRIVE_METADATA_READONLY,
  SCOPE_SHEETS_READONLY,
} from '../../../packages/query-engine/src/google-auth.ts';
import {
  gravaCredencialOAuth,
  pkce,
  state as geraState,
  trocaCodigoPorTokens,
  urlDeAutorizacao,
  OAuthError,
} from '../../../packages/query-engine/src/google-oauth.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);
const cfg = loadConfig();

const PORTA = Number.parseInt(process.env.GOOGLE_OAUTH_PORT ?? '8765', 10);
const CAMINHO_CALLBACK = '/oauth2callback';
const REDIRECT_URI = `http://localhost:${PORTA}${CAMINHO_CALLBACK}`;
const ESPERA_MS = 5 * 60 * 1000;

// `openid`/`email` só servem para registrar QUAL conta autorizou. O problema desta
// fase é justamente identidade — um arquivo de credencial anônimo obrigaria a
// adivinhar de quem é o acesso na próxima vez que der 403.
const ESCOPOS = [SCOPE_SHEETS_READONLY, SCOPE_DRIVE_METADATA_READONLY, 'openid', 'email'];

const { clientId, clientSecret, tokenFile } = cfg.gsheets.oauth;
if (!clientId || !clientSecret) {
  console.error(
    'Faltam GOOGLE_OAUTH_CLIENT_ID e/ou GOOGLE_OAUTH_CLIENT_SECRET no .env.\n' +
      'São os dados do cliente OAuth (console.cloud.google.com → APIs e serviços →\n' +
      'Credenciais). Eles identificam o APLICATIVO — não dão acesso a planilha\n' +
      'nenhuma sozinhos; o acesso vem do consentimento que este comando coleta.',
  );
  process.exit(2);
}
if (!tokenFile) {
  console.error(
    'Falta GOOGLE_OAUTH_TOKEN_FILE no .env — o caminho onde gravar o refresh token.\n' +
      'Aponte para FORA de qualquer repositório git, junto da chave da service account:\n' +
      '  GOOGLE_OAUTH_TOKEN_FILE=C:/Users/<voce>/.secrets/google-oauth-sheets.json',
  );
  process.exit(2);
}

// Guarda de vazamento: refresh token é credencial de longa duração, e este projeto
// vive dentro de uma pasta que é um repositório git (o Desktop) sem .gitignore.
// Em vez de confiar em lembrar disso, procura-se `.git` subindo do destino.
const repo = repositorioAcima(path.resolve(tokenFile));
if (repo) {
  console.error(
    `GOOGLE_OAUTH_TOKEN_FILE aponta para dentro de um repositório git (${repo}).\n` +
      'Recuso gravar credencial de longa duração aí: basta um `git add -A` de alguém\n' +
      'para ela ir para o remoto. Escolha um caminho fora de qualquer repo, como\n' +
      '  C:/Users/<voce>/.secrets/google-oauth-sheets.json',
  );
  process.exit(2);
}

function repositorioAcima(alvo: string): string | null {
  let dir = path.dirname(alvo);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const pai = path.dirname(dir);
    if (pai === dir) return null;
    dir = pai;
  }
}

// ------------------------------------------------------------------ o fluxo
const { verificador, desafio } = pkce();
const estado = geraState();
const url = urlDeAutorizacao({
  clientId,
  redirectUri: REDIRECT_URI,
  scopes: ESCOPOS,
  desafio,
  state: estado,
});

console.log('── Autorização do Google ─────────────────────────────');
console.log(`cliente:   …${clientId.slice(-16)}`);
console.log(`redirect:  ${REDIRECT_URI}`);
console.log(`escopos:   ${ESCOPOS.join('\n           ')}`);
console.log(`grava em:  ${path.resolve(tokenFile)}`);
console.log(
  '\nESCOLHA UMA CONTA QUE ENXERGUE AS PLANILHAS. O acesso que a plataforma\n' +
    'passa a ter é o dessa conta — não o do projeto no Google Cloud.\n',
);
console.log('Abrindo o navegador. Se não abrir, cole esta URL:\n');
console.log(url);
console.log('');

const resultado = await esperaCodigo();
if ('erro' in resultado) {
  console.error(`\nAutorização não concluída: ${resultado.erro}`);
  if (/access_denied/.test(resultado.erro)) {
    console.error(
      '  "access_denied" costuma ser um destes: você clicou em Cancelar; a tela de\n' +
        '  consentimento está em modo "Teste" e sua conta não está na lista de usuários\n' +
        '  de teste; ou o app é interno a outra organização.',
    );
  }
  process.exit(1);
}

let tokens;
try {
  tokens = await trocaCodigoPorTokens({
    cliente: { clientId, clientSecret },
    code: resultado.code,
    redirectUri: REDIRECT_URI,
    verificador,
  });
} catch (err) {
  console.error(`\nTroca do código por token falhou:\n  ${err instanceof Error ? err.message : err}`);
  if (err instanceof OAuthError && /redirect_uri_mismatch/.test(err.message)) {
    console.error(`\n  O URI a cadastrar é exatamente: ${REDIRECT_URI}`);
  }
  process.exit(1);
}

const conta = contaDoIdToken(tokens.idToken);
gravaCredencialOAuth(path.resolve(tokenFile), {
  client_id: clientId,
  refresh_token: tokens.refreshToken,
  scopes: [...tokens.scopesConcedidos],
  obtido_em: new Date().toISOString(),
  ...(conta ? { conta } : {}),
});

console.log('\n── Autorizado ────────────────────────────────────────');
console.log(`conta:     ${conta ?? '(não informada pelo Google)'}`);
console.log(`escopos:   ${tokens.scopesConcedidos.join('\n           ') || '(nenhum declarado)'}`);
console.log(`gravado:   ${path.resolve(tokenFile)}`);
const faltam = [SCOPE_SHEETS_READONLY, SCOPE_DRIVE_METADATA_READONLY].filter(
  (s) => !tokens.scopesConcedidos.includes(s),
);
if (faltam.length) {
  console.log(`\nATENÇÃO: escopo não concedido — ${faltam.join(', ')}`);
  console.log('  Sem ele a leitura vai falhar. Rode de novo e aceite todas as caixas.');
}
console.log('\nAgora `npm run probe:gsheets` usa esta identidade. Nada mais a configurar.');

// ------------------------------------------------------------------ loopback
type Recebido = { code: string } | { erro: string };

function esperaCodigo(): Promise<Recebido> {
  return new Promise<Recebido>((resolve) => {
    const servidor = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', `http://localhost:${PORTA}`);
      if (u.pathname !== CAMINHO_CALLBACK) {
        res.writeHead(404).end('não é aqui');
        return;
      }
      const erroGoogle = u.searchParams.get('error');
      const code = u.searchParams.get('code');
      const estadoVolta = u.searchParams.get('state');
      const responde = (titulo: string, corpo: string, status = 200): void => {
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>${titulo}</title>` +
            '<body style="font:16px/1.5 system-ui;max-width:34rem;margin:6rem auto;padding:0 1rem">' +
            `<h1 style="font-size:1.3rem">${titulo}</h1><p>${corpo}</p></body>`,
        );
      };

      if (erroGoogle) {
        responde('Autorização recusada', 'Volte ao terminal — o motivo está lá.', 400);
        encerra({ erro: erroGoogle });
        return;
      }
      // O state é verificado ANTES de tocar no código: sem isso, um link malicioso
      // conseguiria injetar um código de autorização de outra conta neste servidor.
      if (estadoVolta !== estado) {
        responde('Requisição inesperada', 'O parâmetro <code>state</code> não confere.', 400);
        encerra({ erro: 'state não confere — a resposta não é do fluxo que este comando iniciou' });
        return;
      }
      if (!code) {
        responde('Resposta sem código', 'Volte ao terminal.', 400);
        encerra({ erro: 'redirect sem parâmetro `code`' });
        return;
      }
      responde('Pronto', 'Pode fechar esta aba e voltar ao terminal.');
      encerra({ code });
    });

    let terminado = false;
    const encerra = (r: Recebido): void => {
      if (terminado) return;
      terminado = true;
      clearTimeout(prazo);
      // `close` espera as conexões abertas; a resposta acima já foi enviada, mas o
      // keep-alive do navegador manteria o processo vivo sem o unref/destroy.
      servidor.closeAllConnections?.();
      servidor.close(() => resolve(r));
    };

    const prazo = setTimeout(() => {
      encerra({ erro: `ninguém autorizou em ${ESPERA_MS / 60_000} minutos` });
    }, ESPERA_MS);

    servidor.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        encerra({
          erro:
            `a porta ${PORTA} já está em uso. Rode com outra: ` +
            `GOOGLE_OAUTH_PORT=8766 npm run auth:google`,
        });
        return;
      }
      encerra({ erro: `servidor de loopback falhou: ${err.message}` });
    });

    servidor.listen(PORTA, '127.0.0.1', () => abreNavegador(url));
  });
}

function abreNavegador(alvo: string): void {
  // `rundll32` em vez de `cmd /c start`: o `start` reprocessa a string e engole o
  // `&` da query string, o que produz uma URL truncada e um erro do Google que não
  // aponta para a causa.
  const cmd =
    process.platform === 'win32'
      ? { exe: 'rundll32', args: ['url.dll,FileProtocolHandler', alvo] }
      : process.platform === 'darwin'
        ? { exe: 'open', args: [alvo] }
        : { exe: 'xdg-open', args: [alvo] };
  try {
    spawn(cmd.exe, cmd.args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // A URL já foi impressa; abrir é conveniência, não requisito.
  }
}

/**
 * E-mail de dentro do id_token, só para rotular o arquivo de credencial.
 *
 * Não valida assinatura, e não precisa: o token veio do endpoint do Google por
 * TLS nesta mesma execução, e o valor é usado para IMPRIMIR quem autorizou —
 * nunca para autorizar nada.
 */
function contaDoIdToken(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined;
  const payload = idToken.split('.')[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: string;
    };
    return json.email;
  } catch {
    return undefined;
  }
}
