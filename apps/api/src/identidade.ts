// Quem está pedindo — a costura por onde o Permission Engine entra.
//
// **Até 01/09/2026 a API não autenticava ninguém**: esta é a implementação real,
// depois da decisão do Erick — identidade vem do SSO do HUBBI, que na prática é
// cada app do HUBBI validando a MESMA conta Google corporativa
// (`@sebratel.com.br`, Google Identity Services) e emitindo sua própria sessão —
// não existe um provedor nem uma sessão compartilhados entre apps do HUBBI
// (investigado no código-fonte do HUBBI antes de decidir, não suposto). Este
// arquivo faz a metade daqui: guarda a sessão
// (`criaSessao`) e resolve quem é o dono de um cookie (`identificaPorSessao`). A
// verificação do token do Google mora em `auth-google.ts` — arquivos separados
// porque um é sobre SESSÃO (não fala com o Google) e o outro é sobre TOKEN (fala
// com o Google), e um teste de sessão não deveria precisar de rede para rodar.
//
// **Escopo desta etapa, por decisão do Erick: só o portão de entrada.** Toda
// conta autenticada vê tudo, exatamente como via antes de existir login — o
// desenho de papéis/recorte por linha de `specs/_catalog/permissoes.yaml`
// continua "ESTADO: DESENHO", para depois.
//
// **A parte que não é só desenho: a chave do cache já carrega o usuário.** O
// cache da resposta guarda JSON pronto. No dia em que existir recorte por
// linha, uma chave sem identidade devolveria a página do gestor A para o
// gestor B — cache virando vazamento. O campo já existia antes do login (era
// sempre `'local'`); agora carrega o e-mail de verdade.

import crypto from 'node:crypto';
import type http from 'node:http';

export interface Identidade {
  /** Quem pediu. É o que entra na chave do cache. */
  usuario: string;
  /**
   * Os papéis, como em `specs/_catalog/permissoes.yaml`. Hoje sempre
   * `['autenticado']` — não há papel nenhum além de "tem sessão válida" nesta
   * etapa (decisão do Erick: portão de entrada primeiro, papéis depois).
   */
  papeis: string[];
}

interface Sessao {
  usuario: string;
  expiraEm: number;
}

/** O estado de sessões ativas — em memória, um `Map` como as outras caches
 *  deste servidor (`carregadas`, `completos`). Não sobrevive a um restart do
 *  processo, e está certo: perder sessão pede login de novo, nunca serve dado
 *  de ninguém. */
export type Sessoes = Map<string, Sessao>;

export const NOME_COOKIE = 'sessao';

function tokenDoPedido(req: http.IncomingMessage): string | null {
  const cabecalho = req.headers.cookie;
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(';')) {
    const igual = parte.indexOf('=');
    if (igual === -1) continue;
    if (parte.slice(0, igual).trim() !== NOME_COOKIE) continue;
    try {
      return decodeURIComponent(parte.slice(igual + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** Cria uma sessão nova para `usuario` e devolve o token — ainda sem o `Set-Cookie`
 *  em volta, que é responsabilidade de quem monta a resposta HTTP. */
export function criaSessao(sessoes: Sessoes, usuario: string, ttlHoras: number): string {
  const token = crypto.randomUUID();
  sessoes.set(token, { usuario, expiraEm: Date.now() + ttlHoras * 3_600_000 });
  return token;
}

/** Apaga a sessão do cookie do pedido, se houver uma. Idempotente: chamar sem
 *  sessão ativa (ou duas vezes) não é erro. */
export function apagaSessaoDoPedido(sessoes: Sessoes, req: http.IncomingMessage): void {
  const token = tokenDoPedido(req);
  if (token) sessoes.delete(token);
}

/**
 * O cabeçalho `Set-Cookie` que grava (ou, com `ttlHoras: 0`, apaga) a sessão.
 *
 * **Sem `Secure`, de propósito, por enquanto.** `docs/DEPLOY.md` §3.3 deixa
 * TLS como decisão de infraestrutura ainda pendente — todo o stack de hoje
 * (dev e o `nginx.conf` da Onda 1) fala HTTP puro. Um cookie `Secure` sobre
 * HTTP simplesmente NUNCA seria enviado pelo navegador, e login pareceria
 * quebrado sem erro nenhum. Quando o TLS existir, `Secure` entra aqui junto —
 * registrado para não ficar esquecido, não escondido.
 */
export function cookieDeSessao(token: string, ttlHoras: number): string {
  const maxAge = Math.max(0, Math.round(ttlHoras * 3600));
  return `${NOME_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

/**
 * A identidade de um pedido, a partir do cookie de sessão.
 *
 * `null` quando não há cookie, o token é desconhecido, ou a sessão expirou —
 * os três casos são "sem sessão válida" e a rota chamando isto decide o que
 * fazer (hoje: 401 antes do roteamento de `/api/*`, `docs/DEPLOY.md` §2.1).
 * Sessão expirada é removida na hora, para o `Map` não crescer sem limite com
 * gente que nunca mais voltou.
 */
export function identificaPorSessao(sessoes: Sessoes, req: http.IncomingMessage): Identidade | null {
  const token = tokenDoPedido(req);
  if (!token) return null;
  const sessao = sessoes.get(token);
  if (!sessao) return null;
  if (sessao.expiraEm < Date.now()) {
    sessoes.delete(token);
    return null;
  }
  return { usuario: sessao.usuario, papeis: ['autenticado'] };
}
