// Os arquivos da tela (`frontend` buildado). Saiu de `servidor.ts` em 27/09/2026
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
 * Os arquivos da tela: `webDir` é o build do `frontend` (React). Sem build, a raiz
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
  const raiz = path.resolve(base);
  const alvo = path.resolve(raiz, arquivo);
  const relativo = path.relative(raiz, alvo);
  // `startsWith(raiz)` não basta: `dist-segredos` também começa com `dist`.
  if (relativo === '..' || relativo.startsWith(`..${path.sep}`) || path.isAbsolute(relativo)) {
    responde(res, 403, { erro: 'caminho fora do diretório de arquivos estáticos' });
    return;
  }
  if (!fs.existsSync(alvo) || !fs.statSync(alvo).isFile()) {
    // O React Router entende `/visao-geral`; o servidor de produção precisa entregar
    // a mesma casca que o Vite entrega em desenvolvimento. Arquivo com extensão segue
    // como 404 para não esconder asset quebrado atrás do HTML da aplicação.
    if (!arquivo.includes(path.sep) && !arquivo.includes('/') && path.extname(arquivo) === '') {
      return serveArquivo(res, raiz, 'index.html');
    }
    responde(res, 404, { erro: `arquivo '${arquivo}' não existe` });
    return;
  }
  res.writeHead(200, {
    'content-type': TIPOS[path.extname(alvo)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  res.end(fs.readFileSync(alvo));
}
