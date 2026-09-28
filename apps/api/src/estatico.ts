// Os arquivos da tela (`apps/web` buildado, ou a tela antiga em `/legado`). Saiu de
// `servidor.ts` em 27/09/2026 (ACHADOS #158).

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
 * Os arquivos da tela.
 *
 * **Duas telas convivem, e a ordem entre elas é a decisão.** `dist/` é o build do
 * `apps/web` (React); `index.html` na raiz é a tela de uma página só que existiu
 * antes dele. Quando o build existe, ele é a tela — `npm run api` sozinho serve a
 * aplicação, sem Vite e sem segunda porta. A antiga continua alcançável em
 * `/legado`, porque apagá-la junto com a migração jogaria fora a única referência
 * com que comparar a nova.
 */
export function serveEstatico(res: http.ServerResponse, webDir: string, rota: string): void {
  if (rota === '/legado') return serveArquivo(res, webDir, 'index.html');

  const dist = path.join(webDir, 'dist');
  const temBuild = fs.existsSync(path.join(dist, 'index.html'));
  const arquivo = rota === '/' ? 'index.html' : rota.slice(1);
  return serveArquivo(res, temBuild ? dist : webDir, arquivo);
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
