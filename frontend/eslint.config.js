// ESLint do frontend — fase 5 de `docs/PLANO-PADROES-FRONTEND.md`.
//
// O que ele existe para pegar, acima de tudo, são as regras de hooks: `Tabela` e
// `Matriz` chamaram `useState`/`useMemo` depois de um `return` por meses (ACHADOS #181),
// e nem build, nem teste, nem console acusavam. `react-hooks/rules-of-hooks` acusa.
//
// Rodar: `npm run lint` na raiz (ou `npx eslint .` aqui).

import module, { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// **Dois TypeScripts no monorepo, e o ESLint precisa do certo.** A raiz está no
// TypeScript 7 (o nativo, sem a API JavaScript), o frontend no 5.9. O npm pôs o
// `ts-api-utils` (dependência do typescript-eslint) na raiz, onde ele resolve o
// `typescript` da raiz e quebra ao carregar ("reading 'Intrinsic'"). `overrides` não
// resolve: é dependência *peer*, e o npm não aninha peer. Este gancho, que só vale
// dentro do processo do ESLint, aponta o `typescript` pedido pelo `ts-api-utils` para o
// do frontend. Some quando as duas pontas estiverem na mesma versão.
const tsDoFrontend = pathToFileURL(createRequire(import.meta.url).resolve('typescript')).href;
module.registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === 'typescript' && contexto.parentURL?.includes('/ts-api-utils/')) {
      return { url: tsDoFrontend, format: 'commonjs', shortCircuit: true };
    }
    return proximo(especificador, contexto);
  },
});

// Depois do gancho: um `import` estático seria avaliado antes dele.
const { default: js } = await import('@eslint/js');
const { default: globals } = await import('globals');
const { default: reactHooks } = await import('eslint-plugin-react-hooks');
const { default: tseslint } = await import('typescript-eslint');
const { default: sonarjs } = await import('eslint-plugin-sonarjs');

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      // **A régua de complexidade (23/11/2026).** `eslint-plugin-sonarjs` é o mesmo
      // analisador do SonarLint/SonarQube: o que ele acusa aqui é o que apareceria num
      // gate do Sonar, sem precisar de servidor Java nem de scanner no CI.
      sonarjs.configs.recommended,
    ],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // `_` na frente é "ignorado de propósito", a mesma convenção que o
      // `noUnusedParameters` do TypeScript já respeita.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // O `_` descartado também vale para a regra equivalente do Sonar.
      'sonarjs/no-unused-vars': 'off',

      // **Complexidade cognitiva**: o limite do Sonar. Uma função acima disto não se lê
      // de uma vez — quebre em funções ou componentes com nome.
      'sonarjs/cognitive-complexity': ['error', 15],

      // **Nada de laço dentro de laço, nem de `if` em quarto nível.** Agrupe antes
      // (um `Map`) ou extraia a parte de dentro para uma função nomeada.
      'max-depth': ['error', 3],
      'max-nested-callbacks': ['error', 3],

      // **`sonarjs/todo-tag` fica DESLIGADA de propósito.** A documentação e os
      // comentários deste repositório são em português (CLAUDE.md, regra 6), e a regra
      // marca a palavra "todo"/"TODO" do português — "TODO filtro da página", "todo
      // render" — como se fosse marcador de tarefa. Eram 7 ocorrências, 7 falsos
      // positivos. Marcador de tarefa de verdade aqui vira issue, não comentário.
      'sonarjs/todo-tag': 'off',
    },
  },
  {
    // Os testes e as configs rodam no Node.
    files: ['test/**/*.{ts,tsx}', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // **O que vale no código de produção não vale no de teste.** Estas três acusam
      // risco de entrada hostil ou de rede — num teste a entrada é a que o próprio
      // teste escreve, e o "servidor" é um `fetch` trocado por uma função:
      //   - `super-linear-regex`: a regex varre uma string literal do próprio arquivo;
      //   - `no-hardcoded-ip`: o IP é o da sessão falsa que o teste monta;
      //   - `no-clear-text-protocols`: `http://localhost` de URL de fixture.
      'sonarjs/super-linear-regex': 'off',
      'sonarjs/no-hardcoded-ip': 'off',
      'sonarjs/no-clear-text-protocols': 'off',
      // Um `static` de apoio dentro de um teste não é contrato de ninguém.
      'sonarjs/public-static-readonly': 'off',
      // `describe` > `it` > callback já são três: o teste respira um nível a mais.
      'max-nested-callbacks': ['error', 5],
    },
  },
);
