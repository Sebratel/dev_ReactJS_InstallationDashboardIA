// Qual versão está no ar — QA D-15, uma das duas reprovações do roteiro.
//
// O que se cobra aqui é a ORDEM das fontes e o comportamento quando falta cada uma.
// Versão é informação de diagnóstico: ela nunca pode derrubar a subida da API, e nunca
// pode inventar um número — "não identificada" é resposta, um commit errado não é.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { esqueceVersao, versaoDaInstancia } from '../src/versao.ts';

function dirTemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'versao-'));
}

test('a imagem manda: o `versao.json` do Dockerfile ganha do `.git`', () => {
  esqueceVersao();
  const raiz = dirTemp();
  fs.writeFileSync(
    path.join(raiz, 'versao.json'),
    JSON.stringify({ commit: 'abc1234', construidoEm: '2026-11-16T09:00:00Z', impressao: 'ff00ff00ff00ff00' }),
  );
  fs.mkdirSync(path.join(raiz, '.git'));
  fs.writeFileSync(path.join(raiz, '.git', 'HEAD'), 'ffffffffffffffffffffffffffffffffffffffff\n');

  assert.deepEqual(versaoDaInstancia(raiz), {
    commit: 'abc1234',
    construidoEm: '2026-11-16T09:00:00Z',
    impressao: 'ff00ff00ff00ff00',
    origem: 'imagem',
  });
});

test('commit vazio no build vira null, e a impressão segura a identificação', () => {
  esqueceVersao();
  const raiz = dirTemp();
  // É o que sai quando ninguém passa `COMMIT` — o `ARG` tem padrão vazio de propósito.
  fs.writeFileSync(
    path.join(raiz, 'versao.json'),
    '{"commit":"","construidoEm":"2026-11-16T09:00:00Z","impressao":"0123456789abcdef"}',
  );
  const v = versaoDaInstancia(raiz);
  assert.equal(v.commit, null, 'vazio é "não sei", não string vazia');
  assert.equal(v.impressao, '0123456789abcdef');
  assert.equal(v.origem, 'imagem');
});

test('fora da imagem, o commit sai do `.git` — sem rodar `git`', () => {
  esqueceVersao();
  const raiz = dirTemp();
  const git = path.join(raiz, '.git');
  fs.mkdirSync(path.join(git, 'refs', 'heads'), { recursive: true });
  fs.writeFileSync(path.join(git, 'HEAD'), 'ref: refs/heads/trabalho/x\n');
  fs.mkdirSync(path.join(git, 'refs', 'heads', 'trabalho'), { recursive: true });
  fs.writeFileSync(
    path.join(git, 'refs', 'heads', 'trabalho', 'x'),
    '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b\n',
  );

  const v = versaoDaInstancia(raiz);
  assert.equal(v.commit, '1a2b3c4');
  assert.equal(v.origem, 'git');
  assert.equal(v.impressao, null, 'impressão só existe em imagem');
});

test('ramo empacotado (`packed-refs`) também é lido', () => {
  esqueceVersao();
  const raiz = dirTemp();
  const git = path.join(raiz, '.git');
  fs.mkdirSync(git, { recursive: true });
  fs.writeFileSync(path.join(git, 'HEAD'), 'ref: refs/heads/staging\n');
  fs.writeFileSync(
    path.join(git, 'packed-refs'),
    '# pack-refs with: peeled fully-peeled sorted\n' +
      'aaaaaaabbbbbbbccccccdddddd1111112222223 refs/heads/staging\n',
  );
  assert.equal(versaoDaInstancia(raiz).commit, 'aaaaaaa');
});

test('sem imagem e sem git, diz que não sabe — e não lança', () => {
  esqueceVersao();
  const v = versaoDaInstancia(dirTemp());
  assert.deepEqual(v, { commit: null, construidoEm: null, impressao: null, origem: 'desconhecida' });
});

test('`versao.json` quebrado cai para o git em vez de derrubar a API', () => {
  esqueceVersao();
  const raiz = dirTemp();
  fs.writeFileSync(path.join(raiz, 'versao.json'), '{isto não é json');
  fs.mkdirSync(path.join(raiz, '.git'));
  fs.writeFileSync(path.join(raiz, '.git', 'HEAD'), '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432\n');
  assert.equal(versaoDaInstancia(raiz).commit, '9f8e7d6');
});

test('a leitura é feita uma vez só por processo', () => {
  esqueceVersao();
  const raiz = dirTemp();
  fs.writeFileSync(path.join(raiz, 'versao.json'), '{"commit":"1111111"}');
  assert.equal(versaoDaInstancia(raiz).commit, '1111111');
  fs.writeFileSync(path.join(raiz, 'versao.json'), '{"commit":"2222222"}');
  assert.equal(versaoDaInstancia(raiz).commit, '1111111', 'o conteúdo não muda com o processo vivo');
  esqueceVersao();
  assert.equal(versaoDaInstancia(raiz).commit, '2222222');
});

/**
 * A regra 4 do `CLAUDE.md` é trabalhar em `git worktree` — e lá `.git` é um ARQUIVO
 * (`gitdir: <caminho>`), não um diretório. Sem isto, justamente quem está desenvolvendo
 * via a versão como "não identificada", que é o defeito do D-15 de volta.
 */
test('worktree: `.git` é arquivo, o HEAD mora no gitdir e o ref, no repositório comum', () => {
  esqueceVersao();
  const raiz = dirTemp();
  const comum = path.join(raiz, 'repo-comum', '.git');
  const doWorktree = path.join(comum, 'worktrees', 'metas');
  fs.mkdirSync(path.join(comum, 'refs', 'heads', 'trabalho'), { recursive: true });
  fs.mkdirSync(doWorktree, { recursive: true });

  const arvore = path.join(raiz, 'arvore');
  fs.mkdirSync(arvore);
  fs.writeFileSync(path.join(arvore, '.git'), `gitdir: ${doWorktree}\n`);
  fs.writeFileSync(path.join(doWorktree, 'HEAD'), 'ref: refs/heads/trabalho/metas\n');
  fs.writeFileSync(path.join(doWorktree, 'commondir'), '../..\n');
  fs.writeFileSync(
    path.join(comum, 'refs', 'heads', 'trabalho', 'metas'),
    'beefcafe1234567890abcdefabcdefabcdefabcd\n',
  );

  const v = versaoDaInstancia(arvore);
  assert.equal(v.commit, 'beefcaf');
  assert.equal(v.origem, 'git');
});

test('o próprio repositório desta suíte se identifica', () => {
  esqueceVersao();
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const v = versaoDaInstancia(raiz);
  assert.notEqual(v.origem, 'desconhecida', 'a suíte roda dentro de um repositório git');
});
