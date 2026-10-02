// O cliente do Firebase Authentication — a única peça de Firebase nesta tela.
//
// **O que NÃO entra aqui, e por quê.**
//
// - `getAnalytics`. A configuração que o console do Firebase entrega vem com ele
//   ligado, e ele é a primeira coisa que se copia sem pensar. Esta tela exibe
//   CLIENTE, TELEFONE e endereço (regra 6 do `CLAUDE.md`); o Analytics manda
//   `page_path`, id de dispositivo e o `measurementId` para o Google a cada
//   navegação. Não há métrica de produto que pague isso. O `measurementId`
//   continua no `.env.example`, inerte, só para não sumir da documentação.
// - Firestore, Storage, Functions. Nada nesta aplicação escreve — a API é
//   estritamente GET/HEAD, e a sessão vive num `Map` do servidor.
//
// **O que o login por Firebase custa no pacote, medido em 16/09/2026** — os dois
// builds lado a lado, o segundo com este módulo desligado do `Login.tsx`:
//
//     com Firebase ..... 392,42 kB  (gzip 124,50 kB)
//     sem Firebase ..... 292,61 kB  (gzip  93,58 kB)
//     diferença ........  +99,81 kB (gzip +30,92 kB)
//
// É o preço de importar só `firebase/app` e `firebase/auth` — o resto do SDK o
// bundler poda. Se um dia esse número saltar, alguém importou `firebase`
// inteiro, ou trouxe Firestore/Storage junto.
//
// **A configuração é pública, e isso está certo.** `apiKey` do Firebase não é
// segredo — é identificador de projeto, vai no HTML de qualquer app Firebase do
// mundo. Quem decide quem entra é o domínio autorizado no console (Authentication
// → Settings → Authorized domains) e, do nosso lado, `auth-firebase.ts`. Por isso
// estes valores podem viver no `.env` sem `VITE_` virar vazamento.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserPopupRedirectResolver,
  getAuth,
  GoogleAuthProvider,
  inMemoryPersistence,
  signInWithPopup,
  type Auth,
} from 'firebase/auth';
import { FIREBASE_CONFIG } from '../config.ts';

/** Injetada pelo `define` do Vite — ver `vite.config.ts` e `config.ts`. Vazia em
 *  ambiente sem Firebase configurado, e é isso que faz `Login.tsx` cair no GIS ou no
 *  botão de desenvolvimento. */
const CONFIG = FIREBASE_CONFIG;

/** Há Firebase configurado neste ambiente? Só `projectId` e `apiKey` são
 *  indispensáveis para autenticar; os outros dois entram junto porque faltar um
 *  deles produz erro de runtime do SDK, e não um "login indisponível" legível. */
export function temFirebase(): boolean {
  return Boolean(CONFIG.apiKey && CONFIG.authDomain && CONFIG.projectId && CONFIG.appId);
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

/** Inicializa uma vez só. O SDK reclama de `initializeApp` repetido, e este
 *  módulo é importado por um componente que remonta (troca de tema, retry
 *  depois de erro) — mesmo cuidado que `carregaScriptGis` já tinha. */
function pegaAuth(): Auth {
  if (!auth) {
    app = initializeApp(CONFIG);
    auth = getAuth(app);
    // PERSISTÊNCIA EM MEMÓRIA, DE PROPÓSITO — não é descuido.
    //
    // O padrão do SDK é `localStorage`: o ID token do Firebase ficaria gravado
    // no navegador, sobrevivendo ao fechamento da aba. Mas quem manda aqui é a
    // sessão do NOSSO servidor (cookie `HttpOnly`, `identidade.ts`), com TTL
    // próprio. Guardar o token do Firebase em paralelo criaria uma segunda
    // credencial, mais longeva que a sessão, legível por qualquer script da
    // página — sem nenhum ganho: o token só serve para a troca única em
    // `/auth/firebase`, e depois dela é lixo.
    void auth.setPersistence(inMemoryPersistence);
    // A tela é em português; sem isto a janela do Google aparece no idioma da
    // conta, que nem sempre é o da pessoa.
    auth.languageCode = 'pt-BR';
  }
  return auth;
}

/**
 * Abre a janela do Google e devolve o ID token do Firebase, pronto para
 * `POST /auth/firebase`.
 *
 * `hd` em `setCustomParameters` é CONVENIÊNCIA, NÃO SEGURANÇA: ele faz o Google
 * mostrar direto as contas `@sebratel.com.br` em vez do seletor cheio, e nada
 * mais — qualquer pessoa pode editar o parâmetro antes de enviar. Quem recusa
 * conta de fora é `auth-firebase.ts`, no servidor. Ver o cabeçalho de lá.
 */
export async function entraComGoogle(dominioCorporativo: string): Promise<string> {
  const provedor = new GoogleAuthProvider();
  provedor.setCustomParameters({ hd: dominioCorporativo, prompt: 'select_account' });
  // O resolvedor de popup é passado explicitamente porque `firebase/auth` só o
  // registra sozinho quando se importa o pacote inteiro — sem ele, o
  // `signInWithPopup` falha com `auth/argument-error` num build podado.
  const credencial = await signInWithPopup(pegaAuth(), provedor, browserPopupRedirectResolver);
  return credencial.user.getIdToken();
}

/** Mensagem de erro em português para os códigos que uma pessoa realmente
 *  encontra. O resto cai no genérico — texto do SDK é em inglês e cita API
 *  interna, o que não ajuda ninguém na tela de login. */
export function mensagemDeErro(err: unknown): string | null {
  const codigo = (err as { code?: string } | null)?.code ?? '';
  switch (codigo) {
    // As duas formas de fechar a janela sem escolher conta. Não são erro: não
    // adianta pintar de vermelho quem só desistiu.
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return null;
    case 'auth/popup-blocked':
      return 'O navegador bloqueou a janela do Google. Libere pop-ups para este endereço e tente de novo.';
    case 'auth/unauthorized-domain':
      return 'Este endereço não está autorizado no Firebase (Authentication → Settings → Authorized domains).';
    case 'auth/network-request-failed':
      return 'Sem rede para falar com o Google.';
    default:
      return 'Não foi possível entrar com o Google.';
  }
}
