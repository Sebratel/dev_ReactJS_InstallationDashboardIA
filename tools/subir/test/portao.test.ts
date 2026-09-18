// A regra de `precisaDeclararSemLogin` tem de ser a MESMA de `decideLogin`, e o
// jeito de garantir isso não é lê-las lado a lado: é rodar as duas sobre os mesmos
// ambientes e exigir que concordem. Foi a divergência entre duas condições
// parecidas em dois arquivos que produziu o defeito do #136.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { precisaDeclararSemLogin, precisaDeclararSemLoginNaRaiz } from '../src/portao.ts';
import { decideLogin } from '../../../apps/api/src/portao-login.ts';

describe('precisaDeclararSemLogin', () => {
  test('sem provedor nenhum: precisa declarar, senão a API recusa subir', () => {
    const env = { GOOGLE_CLIENT_ID: '', FIREBASE_PROJECT_ID: undefined };
    assert.equal(precisaDeclararSemLogin(env), true);
    // e é exatamente o que `decideLogin` diz sobre o mesmo ambiente
    assert.equal(decideLogin(env, []).tipo, 'recusa');
    assert.equal(decideLogin(env, ['--sem-login']).tipo, 'sem-login-declarado');
  });

  test('com Firebase: NÃO declara — a API sobe exigindo sessão', () => {
    const env = { FIREBASE_PROJECT_ID: 'algum-projeto' };
    assert.equal(precisaDeclararSemLogin(env), false);
    assert.equal(decideLogin(env, []).tipo, 'exige-credencial');
  });

  test('com Google Identity: idem', () => {
    const env = { GOOGLE_CLIENT_ID: 'algum-id.apps.googleusercontent.com' };
    assert.equal(precisaDeclararSemLogin(env), false);
    assert.equal(decideLogin(env, []).tipo, 'exige-credencial');
  });

  test('string VAZIA não conta como provedor — é o caso real deste .env', () => {
    // A armadilha original de 04/09: `GOOGLE_CLIENT_ID=` no arquivo, presente e
    // vazia. `!== undefined` a teria aceitado como credencial.
    assert.equal(precisaDeclararSemLogin({ GOOGLE_CLIENT_ID: '', FIREBASE_PROJECT_ID: '' }), true);
  });

  // O invariante que amarra os dois arquivos: `npm start` nunca pode passar
  // `--sem-login` num ambiente em que isso faça a API ANUNCIAR que serve sem
  // sessão enquanto o portão do Servidor exige uma. Com provedor configurado, o
  // Servidor exige — então a bandeira não pode ir.
  test('as duas decisões concordam em todo ambiente que importa', () => {
    const ambientes = [
      {},
      { GOOGLE_CLIENT_ID: '' },
      { FIREBASE_PROJECT_ID: '' },
      { GOOGLE_CLIENT_ID: '', FIREBASE_PROJECT_ID: '' },
      { FIREBASE_PROJECT_ID: 'p' },
      { GOOGLE_CLIENT_ID: 'g' },
      { GOOGLE_CLIENT_ID: 'g', FIREBASE_PROJECT_ID: 'p' },
    ];
    for (const env of ambientes) {
      const declara = precisaDeclararSemLogin(env);
      const semBandeira = decideLogin(env, []);
      if (declara) {
        assert.equal(
          semBandeira.tipo,
          'recusa',
          `${JSON.stringify(env)}: declaramos --sem-login, então a API tinha de recusar sem ela`,
        );
      } else {
        assert.equal(
          semBandeira.tipo,
          'exige-credencial',
          `${JSON.stringify(env)}: não declaramos, então a API tem de subir exigindo sessão`,
        );
      }
    }
  });
});

describe('precisaDeclararSemLoginNaRaiz', () => {
  // O teste que teria poupado a primeira versão errada desta correção: ela
  // consultava `process.env`, que em `subir` ainda está vazio neste ponto.
  test('lê o .env do disco mesmo com o process.env vazio', () => {
    const leArquivo = () => ({ FIREBASE_PROJECT_ID: 'algum-projeto' });
    assert.equal(precisaDeclararSemLoginNaRaiz('/qualquer', leArquivo, {}), false);
  });

  test('sem provedor no arquivo nem no ambiente, declara', () => {
    assert.equal(precisaDeclararSemLoginNaRaiz('/qualquer', () => ({}), {}), true);
  });

  test('o ambiente vence o arquivo — a mesma precedência de applyDotEnv', () => {
    // Arquivo sem provedor, ambiente com: não precisa declarar.
    assert.equal(
      precisaDeclararSemLoginNaRaiz('/qualquer', () => ({}), { GOOGLE_CLIENT_ID: 'g' }),
      false,
    );
    // E o contrário: `undefined` no ambiente NÃO apaga o que o arquivo traz.
    assert.equal(
      precisaDeclararSemLoginNaRaiz(
        '/qualquer',
        () => ({ FIREBASE_PROJECT_ID: 'p' }),
        { FIREBASE_PROJECT_ID: undefined },
      ),
      false,
    );
  });

  test('o .env REAL deste repositório tem provedor — logo npm start não declara', () => {
    const raiz = path.resolve(import.meta.dirname, '..', '..', '..');
    if (!fs.existsSync(path.join(raiz, '.env'))) return; // máquina sem .env: nada a afirmar
    assert.equal(
      precisaDeclararSemLoginNaRaiz(raiz),
      false,
      'com FIREBASE_PROJECT_ID preenchida, passar --sem-login faz a API anunciar que ' +
        'serve sem sessão enquanto exige uma (ACHADOS #136)',
    );
  });
});
