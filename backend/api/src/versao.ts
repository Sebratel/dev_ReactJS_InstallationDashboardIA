// Qual versão está no ar — QA D-15, e uma das duas reprovações do roteiro de QA
// ("versão no ar sem identificação", 11/11/2026).
//
// **O problema é que ninguém conseguia responder.** A stack constrói a imagem no
// Portainer (`pull_policy: build`), não baixa de registro, então não há tag de imagem
// para olhar; o `.dockerignore` tira o `.git/` do contexto, então dentro do contêiner
// não existe repositório para perguntar; e o `package.json` tem `version: 0.0.0` desde
// sempre. Resultado: diante de um número errado em tela, a primeira pergunta — "esta é
// a versão com o conserto?" — não tinha resposta.
//
// **Duas fontes, e a ordem importa.**
//
//   1. `versao.json`, escrito pelo Dockerfile no build da imagem. Tem o commit (quando
//      quem construiu informou), a hora do build e a IMPRESSÃO: o sha256 de tudo que
//      embarcou (`backend/`, `frontend/dist`, `package*.json`).
//   2. O `.git/` do próprio repositório, para quem roda `npm start` fora do contêiner.
//
// **Por que a impressão existe, mesmo com o commit.** O commit é um ARG: quem constrói
// informa, e um ARG pode vir vazio — ou, pior, vir ERRADO, se alguém fixar o valor na
// stack do Portainer e esquecer dele. A impressão não depende de ninguém informar nada:
// ela é calculada do que entrou na imagem. Commit vazio é um "não sei" honesto; commit
// errado é uma mentira plausível, e a impressão é o que permite desconfiar dela — duas
// imagens com a mesma impressão são a mesma coisa, tenham o commit que tiverem.

import fs from 'node:fs';
import path from 'node:path';

export interface Versao {
  /** O commit informado no build. `null` quando ninguém informou. */
  commit: string | null;
  /** ISO-8601 do build da imagem, ou da leitura do `.git` em desenvolvimento. */
  construidoEm: string | null;
  /** sha256 (16 caracteres) do que embarcou. Só existe em imagem. */
  impressao: string | null;
  /** De onde saiu o que está acima — entra na resposta para o leitor saber o que crer. */
  origem: 'imagem' | 'git' | 'desconhecida';
}

const DESCONHECIDA: Versao = {
  commit: null,
  construidoEm: null,
  impressao: null,
  origem: 'desconhecida',
};

/** O `versao.json` que o Dockerfile escreve. Ausente fora de imagem — não é erro. */
export function versaoDaImagem(root: string): Versao | null {
  try {
    const cru = fs.readFileSync(path.join(root, 'versao.json'), 'utf8');
    const o = JSON.parse(cru) as Partial<Record<keyof Versao, unknown>>;
    const texto = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
    return {
      commit: texto(o.commit),
      construidoEm: texto(o.construidoEm),
      impressao: texto(o.impressao),
      origem: 'imagem',
    };
  } catch {
    // Sem arquivo, ou com JSON quebrado: cai para o `.git`. Versão é informação de
    // diagnóstico — ela nunca pode ser o motivo de a API não subir.
    return null;
  }
}

/**
 * O commit do repositório, lido do `.git/` DIRETO — sem rodar `git`.
 *
 * Em `npm start` o repositório está ali do lado, e um `child_process` na subida da API
 * para descobrir um texto de diagnóstico seria caro e assustador num processo que se
 * quer previsível. `.git/HEAD` ou é um sha, ou é `ref: refs/heads/<ramo>`; no segundo
 * caso o sha está no arquivo apontado — e, se o ramo tiver sido empacotado, em
 * `packed-refs`.
 *
 * **Worktree conta**, e não é detalhe aqui: a regra 4 do `CLAUDE.md` é trabalhar em
 * `git worktree`, e nela `.git` é um ARQUIVO com `gitdir: <caminho>`. O `HEAD` fica
 * nesse diretório, mas os refs ficam no repositório COMUM, que `commondir` aponta.
 */
function dirDoGit(root: string): { git: string; comum: string } | null {
  const ponto = path.join(root, '.git');
  let st: fs.Stats;
  try {
    st = fs.statSync(ponto);
  } catch {
    return null;
  }
  if (st.isDirectory()) return { git: ponto, comum: ponto };
  const apontado = fs.readFileSync(ponto, 'utf8').trim();
  if (!apontado.startsWith('gitdir:')) return null;
  const git = path.resolve(root, apontado.slice('gitdir:'.length).trim());
  let comum = git;
  try {
    comum = path.resolve(git, fs.readFileSync(path.join(git, 'commondir'), 'utf8').trim());
  } catch {
    // Sem `commondir` o próprio diretório serve — é o caso de um `.git` comum.
  }
  return { git, comum };
}

function doGit(root: string): Versao | null {
  try {
    const dirs = dirDoGit(root);
    if (!dirs) return null;
    const head = fs.readFileSync(path.join(dirs.git, 'HEAD'), 'utf8').trim();
    const sha = (() => {
      if (!head.startsWith('ref:')) return head;
      const ref = head.slice(4).trim();
      for (const base of [dirs.git, dirs.comum]) {
        try {
          return fs.readFileSync(path.join(base, ref), 'utf8').trim();
        } catch {
          // Tenta o próximo lugar: num worktree o ref mora no repositório comum.
        }
      }
      try {
        const empacotadas = fs.readFileSync(path.join(dirs.comum, 'packed-refs'), 'utf8');
        const linha = empacotadas
          .split('\n')
          .find((l) => l.trim().endsWith(` ${ref}`) && !l.startsWith('#'));
        return linha?.trim().split(' ')[0] ?? '';
      } catch {
        return '';
      }
    })();
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return null;
    return { commit: sha.slice(0, 7), construidoEm: null, impressao: null, origem: 'git' };
  } catch {
    return null;
  }
}

/**
 * A versão desta instância. Lida uma vez e guardada: o conteúdo não muda enquanto o
 * processo vive, e `/api/saude` é polida a cada 30 s pelo healthcheck.
 */
let guardada: Versao | null = null;

export function versaoDaInstancia(root: string): Versao {
  guardada ??= versaoDaImagem(root) ?? doGit(root) ?? DESCONHECIDA;
  return guardada;
}

/** Só para teste: a próxima chamada lê de novo. */
export function esqueceVersao(): void {
  guardada = null;
}
