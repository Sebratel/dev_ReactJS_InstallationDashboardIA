// A imagem tem de conter tudo que a API importa em runtime.
//
// O DEFEITO QUE ESTE TESTE GUARDA, e ele custou a primeira subida do container.
//
// O `Dockerfile` copiava `tools/layout/` e só ele, justificado no comentário
// como "confirmado por grep: só tools/layout/ é importado em runtime". Era
// verdade quando foi escrito. Depois `servidor.ts` passou a importar
// `tools/refresh/src/status.ts` (o Refresh Manager, ACHADOS #84), e a imagem
// passou a morrer no arranque:
//
//     Error [ERR_MODULE_NOT_FOUND]: Cannot find module
//     '/repo/tools/refresh/src/status.ts' imported from /repo/apps/api/src/servidor.ts
//
// Nada apontou o problema por 3 dias: `npm test` passa (roda do checkout, onde
// o arquivo existe), o build da imagem passa (é só `COPY`), e o container só
// falha quando ALGUÉM O EXECUTA. Foi executado pela primeira vez em 04/09/2026.
//
// POR QUE UM TESTE E NÃO SÓ O CONSERTO. O conserto foi copiar `tools/` inteiro
// (1,2 MB contra 558 MB de imagem). Mas o defeito de forma é "lista de
// dependências mantida à mão em outro arquivo", e ele volta na primeira vez que
// alguém quiser enxugar a imagem. Este teste faz a lista se defender: ele lê os
// imports de verdade e cobra a `COPY` correspondente.
//
// O que ele NÃO faz: rodar Docker. Ele compara texto — os imports reais contra
// as linhas `COPY` do Dockerfile — e por isso roda em qualquer máquina, sem
// engine e sem rede, junto com o resto da suíte.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Diretórios de topo do repositório que o runtime pode precisar. */
const DIRETORIOS_DE_TOPO = ['packages', 'tools', 'specs', 'apps'];

/**
 * Varre os imports relativos de um conjunto de arquivos e devolve os
 * diretórios de topo alcançados (`packages`, `tools`, ...).
 *
 * Regex e não parser de propósito: o alvo é `from '../../../tools/x/src/y.ts'`,
 * que é a única forma que este repositório usa (não há workspaces npm reais em
 * `packages/` nem em `tools/` — são TypeScript puro por caminho relativo).
 */
function diretoriosImportados(arquivos: string[]): Set<string> {
  const achados = new Set<string>();
  for (const arq of arquivos) {
    // `cache-resposta.ts` tem byte NUL (mesmo caso de incremental.ts, ver
    // CLAUDE.md) — ler como latin1 evita o descarte silencioso que `utf8`
    // faria, e para casar caminho ASCII dá no mesmo.
    const texto = fs.readFileSync(arq, 'latin1');
    for (const m of texto.matchAll(/from\s+'((?:\.\.\/)+)([a-z-]+)\//g)) {
      const dir = m[2]!;
      if (DIRETORIOS_DE_TOPO.includes(dir)) achados.add(dir);
    }
  }
  return achados;
}

function arquivosDe(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => path.join(dir, e.name));
}

test('o Dockerfile copia todo diretório de topo que a API importa em runtime', () => {
  const dockerfile = fs.readFileSync(path.join(RAIZ, 'Dockerfile'), 'utf8');

  // Só o estágio de runtime interessa: o de build faz `COPY . .`, então ele
  // nunca falta nada — e é justamente por isso que o build não pegava o erro.
  const runtime = dockerfile.slice(dockerfile.indexOf('AS runtime'));
  assert.ok(runtime.length > 0, 'o Dockerfile não tem estágio nomeado `runtime`');

  const copiados = new Set<string>();
  for (const m of runtime.matchAll(/^COPY\s+--from=build\s+\/repo\/([a-z-]+)/gim)) {
    copiados.add(m[1]!);
  }

  const importados = diretoriosImportados(arquivosDe(path.join(RAIZ, 'apps', 'api', 'src')));

  // `apps` é o próprio código da API, copiado como `apps/api`.
  importados.delete('apps');

  const faltando = [...importados].filter((d) => !copiados.has(d)).sort();

  assert.deepEqual(
    faltando,
    [],
    `apps/api/src importa de ${faltando.join(', ')} e o estágio runtime do ` +
      `Dockerfile não copia esse(s) diretório(s). O container vai morrer no ` +
      `arranque com ERR_MODULE_NOT_FOUND, e nem npm test nem docker build pegam ` +
      `isso — só executar o container. Acrescente a linha COPY.\n` +
      `  importados: ${[...importados].sort().join(', ')}\n` +
      `  copiados:   ${[...copiados].sort().join(', ')}`,
  );
});

test('o estágio runtime não copia `tools/` seletivamente', () => {
  // A regressão específica: `COPY /repo/tools/layout ./tools/layout` passa o
  // teste acima (o diretório de topo `tools` aparece como copiado) e continua
  // errado, porque só um subdiretório entra. Copiar `tools/` inteiro custa
  // 1,2 MB numa imagem de 558 MB — não há economia que pague a quebra.
  const dockerfile = fs.readFileSync(path.join(RAIZ, 'Dockerfile'), 'utf8');
  const runtime = dockerfile.slice(dockerfile.indexOf('AS runtime'));

  const seletivas = [...runtime.matchAll(/^COPY\s+--from=build\s+\/repo\/tools\/(\S+)/gim)].map(
    (m) => m[1]!,
  );

  assert.deepEqual(
    seletivas,
    [],
    `o runtime copia subdiretório de tools/ (${seletivas.join(', ')}) em vez de ` +
      `tools/ inteiro. Foi assim que a imagem passou 3 dias sem conseguir subir: ` +
      `a lista à mão não acompanhou um import novo em servidor.ts.`,
  );
});

test('o healthcheck do compose bate na rota que a API realmente serve', () => {
  // Outro erro da mesma família — configuração que só falha ao executar. Se a
  // rota do healthcheck mudar de nome, o container fica "unhealthy" para
  // sempre, o `depends_on: service_healthy` do proxy nunca libera, e a stack
  // não sobe. Nenhum teste veria.
  const compose = fs.readFileSync(path.join(RAIZ, 'docker-compose.prod.yml'), 'utf8');
  const rota = /\/api\/[a-z-]+/.exec(compose.slice(compose.indexOf('healthcheck')))?.[0];
  assert.ok(rota, 'não achei a rota do healthcheck em docker-compose.prod.yml');

  const servidor = fs.readFileSync(
    path.join(RAIZ, 'apps', 'api', 'src', 'servidor.ts'),
    'latin1',
  );
  assert.ok(
    servidor.includes(`'${rota}'`),
    `o healthcheck pede ${rota} e servidor.ts não trata essa rota. ` +
      `O container ficaria "unhealthy" e o proxy nunca subiria.`,
  );
});
