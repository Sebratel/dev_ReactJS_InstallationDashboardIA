// Sentença repetida colada na de cima — o dano que fica MORTO em silêncio.
//
// Companheiro de `codigo-carrega.test.ts`, e a divisão entre os dois é exata: lá o
// `tsc` pega tudo que impede o arquivo de existir (nome indefinido, redeclarado,
// importado de um módulo que não o exporta). Aqui fica o que é **TypeScript válido** e
// mesmo assim é defeito:
//
//     else if (k === '--refaz') a.refaz = true;
//     else if (k === '--refaz') a.refaz = true;      <- nunca alcançada
//
// Nenhum verificador de tipos reclama disso, e nada em tempo de execução também não:
// o programa roda, a segunda linha só não faz nada. Foi assim que `tools/powerbi` e
// `tools/mrun` carregaram um ramo morto cada, do mesmo commit `0aae15c` que quebrou
// de vez outros três arquivos.
//
// **Só `import`, `export` e `else if`.** Repetir linha é legítimo em quase todo lugar
// — dois elementos iguais numa lista, duas chamadas iguais num teste, dois `break`. A
// regra fica estreita de propósito: nestas três formas, a repetição imediata não tem
// leitura inocente.

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

test('nenhuma sentença de `import`, `export` ou `else if` repete a linha de cima', () => {
  const erros: string[] = [];
  for (const arq of fontes()) {
    const linhas = fs.readFileSync(arq, 'utf8').split(/\r?\n/);
    for (let i = 1; i < linhas.length; i++) {
      const a = linhas[i - 1]!.trim();
      if (a.length < 12 || a !== linhas[i]!.trim()) continue;
      if (!/^(import |export |else if )/.test(a)) continue;
      const onde = path.relative(RAIZ, arq).split(path.sep).join('/');
      erros.push(`${onde}:${i + 1} — repete a linha ${i}: ${a.slice(0, 80)}`);
    }
  }
  assert.deepEqual(erros, [], `linha duplicada por restauração:\n${erros.join('\n')}`);
});

test('nenhum bloco de 8 linhas ou mais aparece duas vezes seguidas', () => {
  // A forma em ESCALA do mesmo dano: `tools/probe/src/gsheets.ts` tinha um bloco de 74
  // linhas **três vezes**, e `tools/mrun/src/index.ts` imprimia "Onde o tempo vai"
  // duas vezes na saída — dava para ver rodando a ferramenta, e ninguém viu, porque
  // quem lê uma saída longa não conta seções.
  //
  // Oito linhas é o piso: abaixo disso aparecem repetições legítimas (dois `catch`
  // iguais, duas entradas de tabela de teste), e o teste viraria ruído.
  const MIN = 8;
  const erros: string[] = [];
  for (const arq of fontes()) {
    const L = fs.readFileSync(arq, 'utf8').split(/\r?\n/);
    for (let i = 0; i < L.length; i++) {
      // Do maior período para o menor: interessa o bloco inteiro, não o pedaço dele.
      for (let P = Math.floor((L.length - i) / 2); P >= MIN; P--) {
        let igual = true;
        for (let k = 0; k < P; k++) {
          if (L[i + k] !== L[i + P + k]) { igual = false; break; }
        }
        if (!igual) continue;
        // Exige conteúdo de verdade: um bloco de linhas em branco e `}` repete à toa.
        if (L.slice(i, i + P).filter((s) => s.trim().length > 0).length < MIN) continue;
        const onde = path.relative(RAIZ, arq).split(path.sep).join('/');
        const amostra = L.slice(i, i + P).find((s) => s.trim().length > 0) ?? '';
        erros.push(`${onde}:${i + 1} — bloco de ${P} linhas repetido logo em seguida: ${amostra.trim().slice(0, 70)}`);
        i += P * 2 - 1;
        break;
      }
    }
  }
  assert.deepEqual(erros, [], `bloco duplicado por restauração:\n${erros.join('\n')}`);
});
