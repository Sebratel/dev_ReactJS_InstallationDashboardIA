#!/usr/bin/env node
// `npm run api` — sobe a API de leitura e a tela.
//
// Não busca nada de fonte: lê o `snapshot/` que `npm run snapshot` deixou em
// disco. Sem snapshot ela sobe do mesmo jeito e `GET /api/saude` diz o que falta —
// morrer no arranque só esconderia a mensagem.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { Servidor } from './servidor.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(AQUI, '..', '..', '..');

const porta = Number.parseInt(process.env.PORT ?? '3100', 10);
const servidor = new Servidor({
  root: ROOT,
  snapshotDir: path.join(ROOT, DIRETORIO_PADRAO),
  webDir: path.resolve(AQUI, '..', 'web'),
});

servidor.criaHttp().listen(porta, () => {
  console.log(`\nAnalytics Platform — API de leitura`);
  console.log(`  tela  http://localhost:${porta}/`);
  console.log(`  saúde http://localhost:${porta}/api/saude`);
  console.log(`\n  Somente GET. Nenhuma rota escreve em fonte nenhuma.`);
  console.log(`  Os dados vêm do snapshot em disco, não das fontes.\n`);
});
