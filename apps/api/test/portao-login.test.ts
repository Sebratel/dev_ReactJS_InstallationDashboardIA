// A guarda que impede a API de servir dado de cliente sem autenticação.
//
// O caso que dá nome a este arquivo é o PRIMEIRO teste: `GOOGLE_CLIENT_ID: ''`
// com `NODE_ENV: 'production'`. Foi exatamente esse ambiente que a stack de
// `docker-compose.prod.yml` produziu em 04/09/2026 — e a API subiu, e
// `GET /api/dashboards/visao-geral` respondeu 200 sem sessão. Se algum dia este
// teste passar a esperar `exige-credencial` ou `sem-login-declarado`, o defeito
// voltou.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideLogin } from '../src/portao-login.ts';

describe('portão de login: falha fechado', () => {
  it('produção com GOOGLE_CLIENT_ID vazia RECUSA subir (o defeito de 04/09/2026)', () => {
    const d = decideLogin({ NODE_ENV: 'production', GOOGLE_CLIENT_ID: '' });
    assert.equal(d.tipo, 'recusa');
    assert.equal(d.tipo === 'recusa' && d.motivo, 'sem-credencial');
  });

  it('GOOGLE_CLIENT_ID ausente (nem a chave existe) RECUSA subir', () => {
    const d = decideLogin({});
    assert.equal(d.tipo, 'recusa');
    assert.equal(d.tipo === 'recusa' && d.motivo, 'sem-credencial');
  });

  it('SEM_LOGIN=1 junto com NODE_ENV=production RECUSA subir', () => {
    // Desligar o login numa imagem que se diz produção é o pior dos dois
    // mundos: parece endurecida e serve tudo. Recusa, e a mensagem manda tirar
    // o NODE_ENV em vez de mandar tirar a guarda.
    const d = decideLogin({ NODE_ENV: 'production', SEM_LOGIN: '1', GOOGLE_CLIENT_ID: 'x.apps' });
    assert.equal(d.tipo, 'recusa');
    assert.equal(d.tipo === 'recusa' && d.motivo, 'sem-login-em-producao');
  });

  it('a recusa de produção vence a de credencial: a mensagem tem de citar o NODE_ENV', () => {
    // Ordem importa para quem lê o log. Com as duas condições valendo, o
    // problema a resolver é o NODE_ENV, não a credencial ausente.
    const d = decideLogin({ NODE_ENV: 'production', SEM_LOGIN: '1', GOOGLE_CLIENT_ID: '' });
    assert.equal(d.tipo === 'recusa' && d.motivo, 'sem-login-em-producao');
  });

  it('toda recusa traz mensagem que diz o que fazer', () => {
    for (const env of [
      { NODE_ENV: 'production', GOOGLE_CLIENT_ID: '' },
      { NODE_ENV: 'production', SEM_LOGIN: '1' },
      {},
    ]) {
      const d = decideLogin(env);
      assert.equal(d.tipo, 'recusa', `deveria recusar: ${JSON.stringify(env)}`);
      if (d.tipo !== 'recusa') continue;
      assert.match(d.mensagem, /RECUSANDO SUBIR/);
      assert.ok(d.mensagem.length > 120, 'mensagem curta não ensina nada a quem lê o log');
    }
  });
});

describe('portão de login: os dois caminhos que PODEM subir', () => {
  it('com credencial, o portão liga e semLogin é false', () => {
    const d = decideLogin({ NODE_ENV: 'production', GOOGLE_CLIENT_ID: '123.apps.googleusercontent.com' });
    assert.equal(d.tipo, 'exige-credencial');
    assert.equal(d.tipo === 'exige-credencial' && d.semLogin, false);
  });

  it('SEM_LOGIN=1 fora de produção sobe com o login desligado', () => {
    const d = decideLogin({ SEM_LOGIN: '1' });
    assert.equal(d.tipo, 'sem-login-declarado');
    assert.equal(d.tipo === 'sem-login-declarado' && d.semLogin, true);
  });

  it('--sem-login no argv vale o mesmo que SEM_LOGIN=1', () => {
    // É por aqui que `npm run api` e `tools/subir` entram — sem variável de
    // ambiente, sem tocar o `.env`.
    const d = decideLogin({}, ['node', 'index.ts', '--sem-aquecer', '--sem-login']);
    assert.equal(d.tipo, 'sem-login-declarado');
  });

  it('SEM_LOGIN com qualquer outro valor NÃO desliga o login', () => {
    // Só o literal '1'. `SEM_LOGIN=false` desligando o login seria a pior
    // surpresa possível neste arquivo.
    for (const valor of ['0', 'false', 'true', 'sim', '', ' 1 ']) {
      const d = decideLogin({ SEM_LOGIN: valor });
      assert.equal(d.tipo, 'recusa', `SEM_LOGIN=${JSON.stringify(valor)} não deveria valer declaração`);
    }
  });
});

describe('portão de login: o contrato com quem sobe a API de propósito sem login', () => {
  // Estes três entram sem credencial por desenho, e cada um tem de continuar
  // entrando — senão a guarda quebra o desenvolvimento e alguém a remove.
  const casos: Array<[string, Record<string, string | undefined>, readonly string[]]> = [
    ['npm run api', {}, ['node', 'apps/api/src/index.ts', '--sem-login']],
    ['tools/subir', {}, ['node', 'apps/api/src/index.ts', '--sem-aquecer', '--sem-login']],
    ['probe:memoria-api', { SEM_LOGIN: '1', GOOGLE_CLIENT_ID: '' }, ['node', 'apps/api/src/index.ts', '--sem-poller', '--sem-aquecer']],
  ];

  for (const [nome, env, argv] of casos) {
    it(`${nome} sobe`, () => {
      const d = decideLogin(env, argv);
      assert.equal(d.tipo, 'sem-login-declarado', `${nome} deixou de subir`);
    });
  }
});
