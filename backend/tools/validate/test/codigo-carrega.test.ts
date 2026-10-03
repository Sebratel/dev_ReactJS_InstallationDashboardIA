// Todo arquivo do repositório **consegue rodar**: nenhum nome indefinido, nenhum
// redeclarado.
//
// **O defeito que trouxe este teste ao mundo.** O commit `0aae15c` ("restaurar 100% do
// estado do dia 26") danificou cinco arquivos de quatro jeitos, e três deles impedem o
// programa de existir:
//
//   1. o mesmo `import` duas ou três vezes ... SyntaxError no carregamento do módulo
//   2. um nome importado E redeclarado ....... SyntaxError no carregamento do módulo
//   3. um `import` que sumiu, nome em uso .... ReferenceError durante a execução
//   4. funções chamadas que nunca vieram ..... ReferenceError durante a execução
//
// `npm run run:mlayer`, `npm run probe:gsheets` e `npm run powerbi` ficaram **onze
// dias sem rodar**, e a suíte não pegou nada: ela exercita `backend/tools/mrun/src/args.ts`,
// não o `index.ts` que morria. Um CLI sem teste que o carregue pode estar quebrado por
// tempo indeterminado — o sintoma só aparece quando alguém precisa dele, que foi o que
// aconteceu ao ir medir a camada M para a migração de passos de M para SQL.
//
// **Por que um verificador de tipos, e não um `import()` no teste.** Carregar um CLI
// executa o CLI: ele lê `process.argv`, abre pool de banco e escreve em disco. O `tsc`
// responde à mesma pergunta sem rodar nada — e responde a mais: os casos 3 e 4 não são
// erro de carregamento, são `ReferenceError` lá dentro de funções que só rodam contra
// o banco de verdade. Nenhum teste de fumaça razoável chegaria lá.
//
// **Isto NÃO transforma o projeto em typechecked.** O repositório é strip-only de
// propósito e não tem `tsconfig.json`. Este teste monta uma configuração **em disco
// temporário**, fora da árvore, e **reprova só três diagnósticos**, todos da família
// "este código não pode rodar":
//
//   TS2304  Cannot find name ........ nome usado, nunca importado nem declarado
//   TS2300  Duplicate identifier .... o mesmo nome declarado duas vezes
//   TS2451  Cannot redeclare ........ idem, para `const`/`let`
//   TS2305  No exported member ...... importa um nome que o módulo não exporta
//
// O TS2305 entrou depois dos outros três, e por medição: ao conferir que o teste
// REPROVA o defeito original, a primeira tentativa reverteu só metade dele — e o teste
// passou. Meia reversão (o `import` novo, o módulo velho) não dá "cannot find name",
// dá "no exported member", que o filtro não tinha. Em ESM os dois são igualmente
// fatais: o Node recusa o módulo com `SyntaxError: The requested module does not
// provide an export named 'x'`. Achou de quebra um import errado de onze meses —
// `EngineEvent` pedido a `types.ts`, onde nunca esteve; era `import type`, então o
// Node o apagava antes de ligar o módulo e nada denunciava.
//
// Erro de TIPO — incompatibilidade, propriedade que não existe, `any` implícito — não
// reprova nada aqui, e é isso que mantém o teste honesto: ele não cobra do projeto uma
// disciplina que o projeto não adotou. Cobra só que o arquivo consiga executar.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const AREAS = ['backend', 'frontend'];

/** Os quatro diagnósticos que significam "este arquivo não roda". */
const FATAIS = /error TS(2304|2300|2451|2305):/;

function fontes(): string[] {
  const fora: string[] = [];
  const anda = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'dist' && e.name !== '.git') anda(p);
        continue;
      }
      // `.tsx` entra junto: `frontend` é React, e o dano não escolhe extensão.
      if (/\.(ts|tsx)$/.test(e.name)) fora.push(path.resolve(p));
    }
  };
  for (const a of AREAS) anda(path.join(RAIZ, a));
  return fora;
}

test('nenhum arquivo usa nome indefinido nem redeclara um importado', () => {
  const arquivos = fontes();
  assert.ok(arquivos.length > 300, `a varredura achou só ${arquivos.length} arquivos — o caminho mudou?`);

  // O `tsconfig` sai num diretório temporário, e não na árvore: pôr um na raiz mudaria
  // o que editor e ferramenta fazem com o projeto inteiro, que é decisão de outra
  // ordem. `files` absoluto porque o arquivo não mora ao lado do código.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carrega-'));
  const cfg = path.join(dir, 'tsconfig.json');
  fs.writeFileSync(
    cfg,
    JSON.stringify({
      compilerOptions: {
        noEmit: true,
        // O projeto importa com a extensão `.ts` escrita — é assim que o Node
        // strip-only resolve. Sem estas duas, todo import vira "módulo não encontrado"
        // e o teste falharia por 371 motivos falsos.
        allowImportingTsExtensions: true,
        module: 'preserve',
        moduleResolution: 'bundler',
        target: 'es2023',
        jsx: 'react-jsx',
        skipLibCheck: true,
        strict: false,
        noImplicitAny: false,
      },
      files: arquivos,
    }),
  );

  let saida = '';
  try {
    // O `tsc` sai com código ≠ 0 quando há QUALQUER diagnóstico, inclusive os de tipo
    // que este teste ignora de propósito — então o código de saída não decide nada.
    // Quem decide é o filtro sobre as linhas.
    execFileSync(process.execPath, [path.join(RAIZ, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', cfg], {
      encoding: 'utf8',
      cwd: RAIZ,
    });
  } catch (e) {
    saida = String((e as { stdout?: string }).stdout ?? '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const problemas = saida
    .split(/\r?\n/)
    .filter((l) => FATAIS.test(l))
    .map((l) => l.replace(RAIZ + path.sep, '').split(path.sep).join('/'))
    .sort();

  assert.deepEqual(
    problemas,
    [],
    `nome indefinido ou redeclarado — o arquivo não roda:\n${problemas.join('\n')}`,
  );
});
