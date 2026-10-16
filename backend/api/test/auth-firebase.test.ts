// Verificação do ID token do Firebase — sem rede.
//
// Diferente de `auth-google.test.ts`, aqui a assinatura é DE VERDADE: o teste
// gera um par RSA, assina o JWT e injeta a chave pública pelo mesmo ponto por
// onde as chaves do Google entrariam. É o que permite provar que assinatura
// errada recusa — com um verificador de mentira, o teste provaria só que a
// função chama o que mandaram chamar.
//
// O caso que dá nome a este arquivo é `o token de OUTRO projeto Firebase é
// recusado`: qualquer projeto Firebase do mundo emite token assinado pela MESMA
// chave do Google (`securetoken@system.gserviceaccount.com`). Se `aud` e `iss`
// não forem conferidos contra o nosso projeto, um token legítimo emitido por um
// projeto qualquer — que qualquer pessoa cria em dois minutos — vira sessão
// válida aqui.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { verificaIdTokenFirebase } from '../src/auth-firebase.ts';

const PROJETO = 'installation-dashboard-307fd';
const DOMINIO = 'sebratel.com.br';
const KID = 'chave-de-teste';

const par = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const certificados = async () => ({
  [KID]: par.publicKey.export({ type: 'spki', format: 'pem' }) as string,
});

const AGORA_S = 1_758_000_000;
const agora = () => AGORA_S * 1000;

function b64(valor: unknown): string {
  return Buffer.from(JSON.stringify(valor), 'utf8').toString('base64url');
}

/** Um ID token do Firebase como o SDK emite, com os campos que o teste quiser
 *  estragar. `chave` diferente = assinado por outra pessoa. */
function token(
  claims: Record<string, unknown> = {},
  opts: { cabecalho?: Record<string, unknown>; chave?: crypto.KeyObject } = {},
): string {
  const cabecalho = { alg: 'RS256', kid: KID, typ: 'JWT', ...opts.cabecalho };
  const corpo = {
    iss: `https://securetoken.google.com/${PROJETO}`,
    aud: PROJETO,
    sub: 'uid-do-fulano',
    iat: AGORA_S - 60,
    exp: AGORA_S + 3600,
    email: 'fulano@sebratel.com.br',
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
    ...claims,
  };
  const assinavel = `${b64(cabecalho)}.${b64(corpo)}`;
  const assinatura = crypto
    .sign('RSA-SHA256', Buffer.from(assinavel, 'utf8'), opts.chave ?? par.privateKey)
    .toString('base64url');
  return `${assinavel}.${assinatura}`;
}

const verifica = (t: string) =>
  verificaIdTokenFirebase(t, { projectId: PROJETO, dominioCorporativo: DOMINIO, certificados, agora });

test('token válido do nosso projeto, domínio certo: devolve e-mail, uid e foto HTTPS', async () => {
  const r = await verifica(token({ picture: 'https://lh3.googleusercontent.com/a/foto-do-fulano' }));
  assert.deepEqual(r, {
    email: 'fulano@sebratel.com.br',
    uid: 'uid-do-fulano',
    foto: 'https://lh3.googleusercontent.com/a/foto-do-fulano',
  });
});

test('o token de OUTRO projeto Firebase é recusado (aud e iss)', async () => {
  // Assinado pela mesma chave, formato perfeito — só o projeto é outro.
  const outro = token({ aud: 'projeto-de-qualquer-um', iss: 'https://securetoken.google.com/projeto-de-qualquer-um' });
  assert.equal(await verifica(outro), null);
  // E não adianta acertar só um dos dois.
  assert.equal(await verifica(token({ aud: 'projeto-de-qualquer-um' })), null);
  assert.equal(await verifica(token({ iss: 'https://securetoken.google.com/outro' })), null);
});

test('assinatura de outra chave é recusada', async () => {
  const impostor = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.equal(await verifica(token({}, { chave: impostor.privateKey })), null);
});

test('alg fora de RS256 é recusado antes de olhar a assinatura', async () => {
  // `alg: none` e a troca RS256 -> HS256 são o ataque clássico de confusão de
  // algoritmo. Os dois têm de morrer no cabeçalho.
  assert.equal(await verifica(token({}, { cabecalho: { alg: 'none' } })), null);
  assert.equal(await verifica(token({}, { cabecalho: { alg: 'HS256' } })), null);
});

test('kid desconhecido é recusado', async () => {
  assert.equal(await verifica(token({}, { cabecalho: { kid: 'kid-que-nao-existe' } })), null);
});

test('token expirado é recusado — mas com a folga de relógio de 5 min', async () => {
  assert.equal(await verifica(token({ exp: AGORA_S - 3600 })), null);
  // Vencido há 1 minuto: dentro da folga, ainda entra. É o que impede que uma
  // máquina poucos segundos adiantada recuse token recém-emitido.
  assert.ok(await verifica(token({ exp: AGORA_S - 60 })));
});

test('iat no futuro é recusado', async () => {
  assert.equal(await verifica(token({ iat: AGORA_S + 3600 })), null);
});

test('provedor diferente de google.com é recusado', async () => {
  // O MESMO projeto Firebase pode ter e-mail/senha ligado. Sem esta checagem,
  // qualquer pessoa se cadastraria escolhendo o próprio endereço @sebratel.
  for (const provedor of ['password', 'anonymous', 'microsoft.com', undefined]) {
    const r = await verifica(token({ firebase: { sign_in_provider: provedor } }));
    assert.equal(r, null, `sign_in_provider=${String(provedor)} deveria recusar`);
  }
});

test('email_verified diferente de true é recusado', async () => {
  for (const valor of [false, undefined, 'true', 1]) {
    assert.equal(await verifica(token({ email_verified: valor })), null, `email_verified=${String(valor)}`);
  }
});

test('o domínio é comparado EXATO, não por sufixo', async () => {
  // O ataque que o `hd` de `auth-google.ts` cobria de graça e que aqui precisa
  // de checagem explícita. Se algum dia isto passar a usar `endsWith`, estes
  // endereços voltam a logar.
  for (const email of [
    'fulano@sebratel.com.br.evil.com',
    'fulano@evil-sebratel.com.br',
    'fulano@gmail.com',
    'fulano@sub.sebratel.com.br',
    'fulano@sebratel.com',
  ]) {
    assert.equal(await verifica(token({ email })), null, `${email} deveria recusar`);
  }
  // Caixa não importa — o Google devolve o endereço como a pessoa digitou.
  assert.ok(await verifica(token({ email: 'Fulano@Sebratel.Com.BR' })));
});

test('lixo no lugar do token não explode: devolve null', async () => {
  for (const lixo of ['', 'abc', 'a.b', 'a.b.c', 'nao.eh.jwt']) {
    assert.equal(await verifica(lixo), null, JSON.stringify(lixo));
  }
});

test('falha ao buscar os certificados recusa — não deixa passar', async () => {
  const r = await verificaIdTokenFirebase(token(), {
    projectId: PROJETO,
    dominioCorporativo: DOMINIO,
    certificados: async () => {
      throw new Error('rede fora');
    },
    agora,
  });
  assert.equal(r, null);
});
