// Verifica o ID token que o Firebase Authentication devolve no navegador.
//
// Irmão de `auth-google.ts`, e a separação é a mesma que existe entre aquele e
// `identidade.ts`: aqui se fala de TOKEN (assinatura, validade, emissor), não de
// SESSÃO. Os dois convivem de propósito — `/auth/google` continua atendendo o
// Google Identity Services puro, `/auth/firebase` atende o SDK do Firebase, e
// qual dos dois a tela usa é decisão de configuração, não de código.
//
// ────────────────────────────────────────────────────────────────────────────
// POR QUE ISTO NÃO USA `firebase-admin`
//
// `firebase-admin` faz exatamente o que este arquivo faz — e traz junto
// Firestore, Storage, FCM, gRPC e o cliente de service account. Para conferir a
// assinatura de um JWT, o `verifyIdToken` daquele SDK precisa só do `projectId` e
// das chaves públicas; nada disso exige credencial de serviço. O que está abaixo
// é o mesmo algoritmo, em ~100 linhas, com o buscador de certificados INJETÁVEL —
// que é o que permite testar recusa de assinatura sem rede, igual
// `VerificadorDeToken` faz em `auth-google.ts`.
//
// ────────────────────────────────────────────────────────────────────────────
// A DIFERENÇA DE SEGURANÇA QUE O FIREBASE INTRODUZ — LEIA ANTES DE MEXER
//
// `auth-google.ts` confere o claim `hd` (hosted domain), que o PRÓPRIO Google
// assina e que só existe em conta de um Google Workspace de verdade. **O ID
// token do Firebase não tem `hd`.** O Firebase reemite o token com os claims
// dele (`iss` = securetoken.google.com/<projeto>, `aud` = <projeto>,
// `firebase.sign_in_provider`, `email`, `email_verified`) e descarta o `hd` do
// provedor de origem.
//
// Então a checagem de domínio aqui é, necessariamente, mais fraca: ela olha o
// e-mail. Para que ela não vire a checagem ingênua que `auth-google.ts` recusa
// (`email.endsWith('@' + dominio)`), este arquivo exige TRÊS coisas ao mesmo
// tempo:
//
//   1. `sign_in_provider === 'google.com'` — senão um cadastro por e-mail/senha
//      no mesmo projeto Firebase escolheria o próprio endereço;
//   2. `email_verified === true` — quem afirma isso, para o provedor google.com,
//      é o Google;
//   3. o domínio do e-mail, recortado depois do ÚLTIMO `@`, IGUAL ao
//      corporativo — comparação exata, não sufixo.
//
// Isso fecha o buraco do sufixo, mas não é equivalente ao `hd`: as três juntas
// dizem "é uma conta Google cujo e-mail é @sebratel.com.br", enquanto o `hd`
// dizia "é uma conta DO Workspace sebratel.com.br". Na prática só divergem se
// alguém tiver conta Google pessoal com endereço no domínio — o que o Workspace
// que gere o domínio impede. Registrado aqui porque foi uma troca consciente
// (Erick, 16/09/2026), não um descuido.
//
// O reforço que fecha a diferença de vez é do lado do Firebase, não daqui:
// Authentication → Settings → **blocking function** `beforeSignIn` recusando
// `hd !== 'sebratel.com.br'`. Exige plano Blaze. Enquanto não existir, as três
// checagens acima são o que segura.

import crypto from 'node:crypto';

/** Onde ficam as chaves públicas com que o Firebase assina ID token. São
 *  certificados X.509 em PEM, indexados pelo `kid` do cabeçalho do JWT. */
const URL_CERTIFICADOS =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

/** Tolerância de relógio, em segundos — o mesmo valor que o `firebase-admin`
 *  usa. Sem ela, uma máquina alguns segundos adiantada recusa token recém-emitido. */
const FOLGA_DE_RELOGIO_S = 300;

/** O que este módulo precisa do mundo externo: um mapa `kid -> certificado PEM`.
 *  Injetável para que teste de recusa não dependa de rede — mesmo motivo do
 *  `VerificadorDeToken` de `auth-google.ts`. */
export type BuscaCertificados = () => Promise<Record<string, string>>;

export interface IdentidadeFirebase {
  email: string;
  /** O `sub` do token — o UID do Firebase. Ainda não usado para nada além de
   *  log; entra aqui porque é ele, e não o e-mail, a chave estável da conta no
   *  dia em que houver papéis por usuário. */
  uid: string;
}

/** Cache das chaves públicas, com validade vinda do `Cache-Control` da resposta.
 *  O Google roda essas chaves a cada poucos dias; buscar a cada login seria uma
 *  ida à rede dentro do caminho de autenticação, que é justamente onde latência
 *  é mais visível. */
let cacheCertificados: { valores: Record<string, string>; venceEm: number } | null = null;

/** Zera o cache — só para teste; produção nunca chama. */
export function esqueceCertificados(): void {
  cacheCertificados = null;
}

async function buscaCertificadosDoGoogle(): Promise<Record<string, string>> {
  const agora = Date.now();
  if (cacheCertificados && cacheCertificados.venceEm > agora) return cacheCertificados.valores;

  const resposta = await fetch(URL_CERTIFICADOS);
  if (!resposta.ok) throw new Error(`certificados do Firebase: HTTP ${resposta.status}`);
  const valores = (await resposta.json()) as Record<string, string>;

  // `max-age` do cabeçalho; 1 hora se a resposta não disser nada.
  const controle = resposta.headers.get('cache-control') ?? '';
  const casa = /max-age=(\d+)/.exec(controle);
  const segundos = casa ? Number.parseInt(casa[1]!, 10) : 3600;
  cacheCertificados = { valores, venceEm: agora + segundos * 1000 };
  return valores;
}

function decodifica(parte: string): unknown {
  return JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'));
}

interface CabecalhoJwt {
  alg?: string;
  kid?: string;
}

interface ClaimsFirebase {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  email?: string;
  email_verified?: boolean;
  firebase?: { sign_in_provider?: string };
}

/**
 * Verifica `idToken` como ID token do projeto Firebase `projectId`, e confere
 * que a conta pertence ao `dominioCorporativo`.
 *
 * Devolve `null` para QUALQUER motivo de recusa — assinatura inválida, token
 * expirado, `aud`/`iss` errados, provedor errado, e-mail não verificado, domínio
 * errado. Deliberado, e pelo mesmo motivo de `auth-google.ts`: quem chama só
 * precisa saber "autentica ou não"; o motivo detalhado vai para o log, nunca
 * para a resposta HTTP — não dar pista de qual checagem falhou a quem está
 * tentando adivinhar.
 */
export async function verificaIdTokenFirebase(
  idToken: string,
  opts: {
    projectId: string;
    dominioCorporativo: string;
    certificados?: BuscaCertificados;
    agora?: () => number;
  },
): Promise<IdentidadeFirebase | null> {
  const recusa = (motivo: string): null => {
    console.error(`[auth-firebase] token recusado: ${motivo}`);
    return null;
  };

  const partes = idToken.split('.');
  if (partes.length !== 3) return recusa('não tem as três partes de um JWT');

  let cabecalho: CabecalhoJwt;
  let claims: ClaimsFirebase;
  try {
    cabecalho = decodifica(partes[0]!) as CabecalhoJwt;
    claims = decodifica(partes[1]!) as ClaimsFirebase;
  } catch {
    return recusa('cabeçalho ou corpo não são JSON em base64url');
  }

  // `alg` é conferido ANTES de olhar a assinatura, e contra uma lista de um
  // elemento só. É a defesa contra o ataque clássico de confusão de algoritmo
  // (`alg: none`, ou trocar RS256 por HS256 usando a chave pública como
  // segredo HMAC).
  if (cabecalho.alg !== 'RS256') return recusa(`alg '${cabecalho.alg ?? '(nenhum)'}' != RS256`);
  if (!cabecalho.kid) return recusa('sem kid no cabeçalho');

  if (claims.aud !== opts.projectId) {
    return recusa(`aud '${claims.aud ?? '(nenhum)'}' != '${opts.projectId}'`);
  }
  const emissorEsperado = `https://securetoken.google.com/${opts.projectId}`;
  if (claims.iss !== emissorEsperado) {
    return recusa(`iss '${claims.iss ?? '(nenhum)'}' != '${emissorEsperado}'`);
  }
  if (!claims.sub) return recusa('sem sub (uid)');

  const agoraS = Math.floor((opts.agora?.() ?? Date.now()) / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + FOLGA_DE_RELOGIO_S < agoraS) {
    return recusa('expirado');
  }
  if (typeof claims.iat !== 'number' || claims.iat - FOLGA_DE_RELOGIO_S > agoraS) {
    return recusa('iat no futuro');
  }

  // A assinatura por último: as checagens acima são baratas e não tocam a rede,
  // então um token obviamente errado nunca provoca busca de certificado.
  let certificados: Record<string, string>;
  try {
    certificados = await (opts.certificados ?? buscaCertificadosDoGoogle)();
  } catch (err) {
    return recusa(
      `não deu para buscar os certificados: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const pem = certificados[cabecalho.kid];
  if (!pem) return recusa(`kid '${cabecalho.kid}' não está entre as chaves públicas do Firebase`);

  let assinaturaConfere: boolean;
  try {
    // O Google serve CERTIFICADO X.509; um `BEGIN PUBLIC KEY` cru só aparece
    // quando `certificados` foi injetado (teste), porque gerar um X.509
    // autoassinado exigiria uma dependência só para isso. Aceitar os dois não
    // afrouxa nada: o que decide de quem é a chave é a origem do mapa, não o
    // formato do PEM.
    const chave = pem.includes('BEGIN CERTIFICATE')
      ? new crypto.X509Certificate(pem).publicKey
      : crypto.createPublicKey(pem);
    assinaturaConfere = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${partes[0]}.${partes[1]}`, 'utf8'),
      chave,
      Buffer.from(partes[2]!, 'base64url'),
    );
  } catch (err) {
    return recusa(`certificado ilegível: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!assinaturaConfere) return recusa('assinatura não confere');

  // ---- domínio corporativo: as três checagens do cabeçalho deste arquivo ----
  const provedor = claims.firebase?.sign_in_provider;
  if (provedor !== 'google.com') {
    return recusa(`sign_in_provider '${provedor ?? '(nenhum)'}' != google.com`);
  }
  if (claims.email_verified !== true) return recusa('email_verified não é true');
  if (!claims.email) return recusa('sem email');
  // Recorte pelo ÚLTIMO '@' e comparação EXATA, não `endsWith`: sufixo é a
  // checagem que `auth-google.ts` recusa, e um dia alguém a escreveria sem o
  // '@' no literal — aí `...@sebratel.com.br.evil.com` passaria.
  const dominio = claims.email.slice(claims.email.lastIndexOf('@') + 1).toLowerCase();
  if (dominio !== opts.dominioCorporativo.toLowerCase()) {
    return recusa(`domínio '${dominio}' != '${opts.dominioCorporativo}'`);
  }

  return { email: claims.email, uid: claims.sub };
}
