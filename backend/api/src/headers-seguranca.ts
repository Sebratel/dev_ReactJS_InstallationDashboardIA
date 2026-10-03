// Os headers de resposta que não dependem de rota — aplicados a TODO pedido,
// antes de qualquer roteamento, para cobrir 200, 401, 404, 405 e 500 por
// igual (mesmo espírito de `criaHttp()` medir a duração por fora de `pagina()`).
//
// **A CSP é montada a partir do que a tela REALMENTE carrega**, não de um molde
// genérico — e cada host abaixo entrou porque um carregamento de verdade, num
// Chromium de verdade, foi BLOQUEADO sem ele (17/09/2026, `checa-csp.mjs` do
// plano de endurecimento de perímetro):
//
// - `accounts.google.com` — `Login.tsx` injeta o script do GIS de lá, e o
//   popup do Google (Firebase e GIS puro) sai do mesmo host.
// - `apis.google.com` — o `signInWithPopup` do Firebase carrega o `gapi`
//   (`/js/api.js`) para montar o iframe-relé do popup. **Foi exatamente esta
//   a linha que faltava**: sem ela o login morre com "Não foi possível entrar
//   com o Google", e o servidor não registra nada.
// - `<projeto>.firebaseapp.com` — o iframe `/__/auth/iframe` que o gapi cria.
//   Cai no `default-src 'self'` se não estiver em `frame-src`.
// - `identitytoolkit`/`securetoken` — a troca do token do popup pelo SDK.
// - `fonts.googleapis.com`/`fonts.gstatic.com` — a fonte Inter de `estilo.css`.
//
// Apertar além disso quebra login sem aviso nenhum no servidor — só no console
// do navegador. Por isso a verificação no navegador é passo obrigatório do
// plano, e não "se der tempo".

import type http from 'node:http';

export interface OpcoesHeadersSeguranca {
  /** Liga `Strict-Transport-Security`. Só faz sentido com TLS de verdade na
   *  frente — ver `identidade.ts` (`cookieSecure`) para o mesmo gatilho. */
  cookieSecure: boolean;
  /** O projeto do Firebase Authentication, quando há um. Dele sai o domínio do
   *  iframe de popup (`<projeto>.firebaseapp.com`) que precisa entrar em
   *  `frame-src` — vazio significa ambiente sem Firebase, e aí a diretiva sai
   *  da CSP em vez de liberar host que ninguém usa. */
  firebaseProjectId?: string;
}

/** Monta a CSP. É função do projeto do Firebase porque o domínio do iframe de
 *  autenticação muda com ele; o resultado é memoizado, já que o valor não muda
 *  durante a vida do processo. */
export function montaCsp(firebaseProjectId?: string): string {
  const emCache = cspPorProjeto.get(firebaseProjectId ?? '');
  if (emCache) return emCache;

  const dominioFirebase = firebaseProjectId ? `https://${firebaseProjectId}.firebaseapp.com` : '';
  const frameSrc = ['https://accounts.google.com', dominioFirebase].filter(Boolean).join(' ');

  const csp = [
    "default-src 'self'",
    "script-src 'self' https://accounts.google.com https://apis.google.com",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    [
      "connect-src 'self'",
      'https://accounts.google.com',
      'https://apis.google.com',
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com',
      dominioFirebase,
    ]
      .filter(Boolean)
      .join(' '),
    `frame-src ${frameSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');

  cspPorProjeto.set(firebaseProjectId ?? '', csp);
  return csp;
}

const cspPorProjeto = new Map<string, string>();

/**
 * Aplica os headers fixos. Chamar ANTES de `res.writeHead`/`res.end` — em
 * `node:http`, `setHeader` depois do corpo já ter saído é ignorado em
 * silêncio, e o único lugar seguro para isto é o topo de `atende()`.
 */
export function aplicaHeadersDeSeguranca(res: http.ServerResponse, opts: OpcoesHeadersSeguranca): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
  res.setHeader('Content-Security-Policy', montaCsp(opts.firebaseProjectId));
  // HSTS sobre HTTP puro é uma promessa que a infraestrutura ainda não cumpre
  // (nginx.conf só tem `listen 80` até existir certificado) — um navegador que
  // obedecesse a um HSTS mentiroso tentaria HTTPS numa porta que não escuta,
  // e o site pareceria fora do ar. Liga junto com o cookie `Secure`.
  if (opts.cookieSecure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}
