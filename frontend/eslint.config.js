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

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // `_` na frente é "ignorado de propósito", a mesma convenção que o
      // `noUnusedParameters` do TypeScript já respeita.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Os testes e as configs rodam no Node.
    files: ['test/**/*.ts', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
