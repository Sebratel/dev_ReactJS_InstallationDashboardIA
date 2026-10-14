// Leitura centralizada das variáveis de ambiente da tela.
//
// **Tudo aqui vai para o pacote do navegador, legível por qualquer um.** O Vite
// substitui cada `import.meta.env.VITE_*` pelo valor no build (o `define` de
// `vite.config.ts`, uma a uma, de propósito). Nenhuma delas é segredo: `apiKey` do
// Firebase é identificador de projeto e o `TOKEN_INTERNO` só é injetado quando NÃO há
// provedor de login nenhum (desenvolvimento) — a regra está no `vite.config.ts`.
//
// Ninguém fora deste arquivo lê `import.meta.env`: um nome novo de variável entra aqui
// e no `define`, e em nenhum outro lugar.

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

export const FIREBASE_CONFIG = {
  apiKey: texto(import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: texto(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: texto(import.meta.env.VITE_FIREBASE_PROJECT_ID),
  appId: texto(import.meta.env.VITE_FIREBASE_APP_ID),
};

/** Permite escolher o botão de login sem carregar o SDK do Firebase no pacote inicial. */
export const TEM_FIREBASE = Boolean(
  FIREBASE_CONFIG.apiKey &&
  FIREBASE_CONFIG.authDomain &&
  FIREBASE_CONFIG.projectId &&
  FIREBASE_CONFIG.appId,
);

/** Google Identity Services puro — o caminho de login anterior ao Firebase. */
export const GOOGLE_CLIENT_ID = texto(import.meta.env.VITE_GOOGLE_CLIENT_ID);

/** Botão de desenvolvimento. Só existe em `vite dev`: no build de produção o `DEV` vira
 *  `false` e o minificador apaga o ramo — o valor nunca chega ao JavaScript público, mesmo
 *  com a variável no ambiente do build (S3, `seguranca.yaml`; o CI prova com um canário). */
export const TOKEN_INTERNO = import.meta.env.DEV ? texto(import.meta.env.VITE_TOKEN_INTERNO) : '';

export const DOMINIO_CORPORATIVO =
  texto(import.meta.env.VITE_DOMINIO_CORPORATIVO) || 'sebratel.com.br';
