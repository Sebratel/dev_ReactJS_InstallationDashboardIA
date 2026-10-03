// Os arquivos da tela (`apps/web` buildado). Saiu de `servidor.ts` em 27/09/2026
// (ACHADOS #158).

import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { responde } from './http-util.ts';

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

/**
 * Os arquivos da tela: `webDir` é o build do `apps/web` (React). Sem build, a raiz
 * responde 404 dizendo como gerá-lo — `npm run api` sozinho só serve a aplicação
 * depois de `npm run web:build`.
 */
export function serveEstatico(res: http.ServerResponse, webDir: string, rota: string): void {
  if (!fs.existsSync(path.join(webDir, 'index.html'))) {
    responde(res, 404, { erro: `tela não compilada em '${webDir}' — rode 'npm run web:build'` });
    return;
  }
  return serveArquivo(res, webDir, rota === '/' ? 'index.html' : rota.slice(1));
}

function serveArquivo(res: http.ServerResponse, base: string, arquivo: string): void {
  // Só o que está dentro da base: `..` no caminho sairia do diretório.
  const alvo = path.resolve(base, arquivo);
  if (!alvo.startsWith(path.resolve(base))) {
    responde(res, 403, { erro: 'caminho fora do diretório de arquivos estáticos' });
    return;
  }
  if (!fs.existsSync(alvo) || !fs.statSync(alvo).isFile()) {
    responde(res, 404, { erro: `arquivo '${arquivo}' não existe` });
    return;
  }
  res.writeHead(200, {
    'content-type': TIPOS[path.extname(alvo)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  res.end(fs.readFileSync(alvo));
}
