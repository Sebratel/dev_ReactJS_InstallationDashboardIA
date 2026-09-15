// Linha duplicada por restauração ruim — a classe de defeito que deixa uma
// ferramenta MORTA sem ninguém notar.
//
// **Por que isto existe.** O commit `0aae15c` ("restaurar 100% do estado do dia 26")
// duplicou linhas adjacentes em quatro arquivos. Em dois deles era um `import`, e um
// `import` repetido do mesmo identificador é **SyntaxError**: `npm run run:mlayer` e
// `tools/probe/src/gsheets.ts` não arrancavam desde então — morriam no carregamento do
// módulo, antes da primeira linha de código rodar. Nos outros dois era um `else if`
// idêntico ao anterior, que nunca é alcançado.
//
// Passou despercebido por **onze dias** porque a suíte não toca nesses arquivos:
// `test:mlayer` exercita `tools/mrun/src/args.ts`, não o `index.ts` que morre. Um CLI
// sem teste que o carregue pode estar quebrado indefinidamente, e o sintoma só aparece
// quando alguém precisa dele — que foi o que aconteceu ao ir medir a camada M.
//
// Este teste não é um lint de estilo. Ele cobre exatamente as duas formas do dano:
// identificador importado duas vezes (o que quebra de verdade) e sentença repetida
// colada na anterior (o que fica morto em silêncio). Repetição legítima — fechar
// bloco, comentário, dois elementos iguais numa lista, duas chamadas iguais num teste
// — não entra, e é por isso que a segunda regra só olha `import`, `export` e `else if`.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const AREAS = ['apps', 'packages', 'tools'];

function fontes(): string[] {
  const fora: string[] = [];
  const anda = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'dist' && e.name !== '.git') anda(p);
        continue;
      }
      if (/\.(ts|tsx)$/.test(e.name)) fora.push(p);
    }
  };
  for (const a of AREAS) anda(path.join(RAIZ, a));
  return fora;
}

/** O caminho a partir da raiz, com `/`, para a mensagem de erro ser clicável. */
function relativo(p: string): string {
  return path.relative(RAIZ, p).split(path.sep).join('/');
}

/** Os nomes que uma linha `import { … } from` traz, já sem `as` e sem `type`. */
function nomesImportados(linha: string): string[] {
  const m = /^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s/.exec(linha.trim());
  if (!m) return [];
  return m[1]!
    .split(',')
    .map((b) => b.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim() ?? '')
    .filter(Boolean);
}

test('nenhum arquivo importa o mesmo identificador duas vezes', () => {
  // É a forma que QUEBRA: o módulo nem carrega, e o erro é
  // `SyntaxError: Identifier 'x' has already been declared`.
  const erros: string[] = [];
  for (const arq of fontes()) {
    const linhas = fs.readFileSync(arq, 'utf8').split(/\r?\n/);
    const vistos = new Map<string, number>();
    for (let i = 0; i < linhas.length; i++) {
      for (const nome of nomesImportados(linhas[i]!)) {
        const antes = vistos.get(nome);
        if (antes !== undefined) {
          erros.push(`${relativo(arq)}:${i + 1} — '${nome}' já foi importado na linha ${antes}`);
        } else {
          vistos.set(nome, i + 1);
        }
      }
    }
  }
  assert.deepEqual(erros, [], `import duplicado é SyntaxError — o arquivo não carrega:\n${erros.join('\n')}`);
});

test('nenhum arquivo declara um nome que ele também importa', () => {
  // A SEGUNDA forma do mesmo dano, e a que custou mais caro: `tools/mrun/src/index.ts`
  // importava `parseArgs` de `./args.ts` e trazia uma cópia INLINE dela — a versão
  // anterior à extração, sem o campo `segundos`. Não carregava; e se carregasse, o
  // `statement_timeout` do programa viraria `NaN` em silêncio.
  const erros: string[] = [];
  const DECLARA = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/;
  for (const arq of fontes()) {
    const linhas = fs.readFileSync(arq, 'utf8').split(/\r?\n/);
    const importados = new Map<string, number>();
    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i]!;
      const nomes = nomesImportados(linha);
      if (nomes.length > 0) {
        for (const n of nomes) if (!importados.has(n)) importados.set(n, i + 1);
        continue;
      }
      // Só declaração no nível do módulo: indentada é escopo interno, e aí sombrear
      // um import é legítimo (e a linguagem permite).
      if (/^\s/.test(linha)) continue;
      const d = DECLARA.exec(linha.trim());
      if (!d) continue;
      const onde = importados.get(d[1]!);
      if (onde !== undefined) {
        erros.push(`${relativo(arq)}:${i + 1} — '${d[1]}' é declarado aqui e importado na linha ${onde}`);
      }
    }
  }
  assert.deepEqual(erros, [], `nome importado e redeclarado é SyntaxError:\n${erros.join('\n')}`);
});

test('nenhuma sentença de `import`, `export` ou `else if` repete a linha de cima', () => {
  // É a forma que fica MORTA em silêncio: um `else if` idêntico ao anterior nunca é
  // alcançado, e nada reclama.
  const erros: string[] = [];
  for (const arq of fontes()) {
    const linhas = fs.readFileSync(arq, 'utf8').split(/\r?\n/);
    for (let i = 1; i < linhas.length; i++) {
      const a = linhas[i - 1]!.trim();
      if (a.length < 12 || a !== linhas[i]!.trim()) continue;
      if (!/^(import |export |else if )/.test(a)) continue;
      erros.push(`${relativo(arq)}:${i + 1} — repete a linha ${i}: ${a.slice(0, 80)}`);
    }
  }
  assert.deepEqual(erros, [], `linha duplicada por restauração:\n${erros.join('\n')}`);
});
