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
// **Quem abre cada aba mora em `permissoes.ts`** (desde 13/10/2026), lido de
// `backend/specs/_catalog/permissoes.yaml`. Aqui fica só "quem é"; o recorte por
// linha continua fora (`linhas: {}`).
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
  /** Avatar recebido no token assinado do Google. Nunca vem de header do cliente. */
  foto?: string;
  /** Nome recebido no token assinado do Google. Nunca vem de header do cliente. */
  nome?: string;
  /**
   * `['autenticado']` para pessoa (o que ela abre é `permissoes.ts` quem diz, pelo
   * e-mail), `['interno']` para máquina (aquecedor, ferramenta de print) e
   * `['sem-login']` no modo de desenvolvimento sem provedor.
   */
  papeis: string[];
}

interface Sessao {
  usuario: string;
  foto?: string;
  nome?: string;
  criadaEm: number;
  expiraEm: number;
  /** Último pedido com este cookie — a base da expiração por inatividade (S2). */
  ultimoUso: number;
  /** De onde veio o último pedido. Trocar não derruba (S2, `troca_de_ip: registra`). */
  ip: string | null;
}

/** A política de `seguranca.yaml` § `sessao`, aplicada a cada identificação. Tudo
 *  opcional: sem ela, vale só o vencimento absoluto — o comportamento de antes. */
export interface PoliticaDeSessao {
  ociosidadeMs?: number;
  agora?: number;
  ip?: string;
  aoTrocarIp?: (usuario: string, de: string, para: string) => void;
}

/** Uma sessão como o admin a vê — sem o token, que é a própria credencial. */
export interface SessaoVisivel {
  usuario: string;
  criadaEm: string;
  ultimoUso: string;
  expiraEm: string;
  ip: string | null;
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
export function criaSessao(
  sessoes: Sessoes,
  usuario: string,
  ttlHoras: number,
  extra: { agora?: number; ip?: string; foto?: string; nome?: string } = {},
): string {
  const token = crypto.randomUUID();
  const agora = extra.agora ?? Date.now();
  sessoes.set(token, {
    usuario,
    ...(extra.foto ? { foto: extra.foto } : {}),
    ...(extra.nome ? { nome: extra.nome } : {}),
    criadaEm: agora,
    expiraEm: agora + ttlHoras * 3_600_000,
    ultimoUso: agora,
    ip: extra.ip ?? null,
  });
  return token;
}

const mesmoUsuario = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Derruba toda sessão de `usuario` (S2: pessoa removida, ou o admin mandou). Devolve
 *  quantas eram. A próxima chamada daquele cookie leva 401. */
export function derrubaSessoesDe(sessoes: Sessoes, usuario: string): number {
  let n = 0;
  for (const [token, s] of sessoes) {
    if (mesmoUsuario(s.usuario, usuario)) {
      sessoes.delete(token);
      n++;
    }
  }
  return n;
}

/** As sessões vivas, da mais recente para a mais antiga — sem token. As vencidas saem
 *  do `Map` no caminho, como em `identificaPorSessao`. */
export function listaSessoes(sessoes: Sessoes, agora: number, ociosidadeMs?: number): SessaoVisivel[] {
  const vivas: Sessao[] = [];
  for (const [token, s] of sessoes) {
    const ociosa = ociosidadeMs !== undefined && agora - s.ultimoUso > ociosidadeMs;
    if (s.expiraEm < agora || ociosa) sessoes.delete(token);
    else vivas.push(s);
  }
  const iso = (ms: number) => new Date(ms).toISOString();
  return vivas
    .sort((a, b) => b.ultimoUso - a.ultimoUso)
    .map((s) => ({ usuario: s.usuario, criadaEm: iso(s.criadaEm), ultimoUso: iso(s.ultimoUso), expiraEm: iso(s.expiraEm), ip: s.ip }));
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
 * **`secure` é `false` por padrão, e continua sendo por bom motivo.**
 * `docs/DEPLOY.md` §3.3 deixa TLS como decisão de infraestrutura ainda
 * pendente — todo o stack de hoje (dev e o `nginx.conf` da Onda 1) fala HTTP
 * puro. Um cookie `Secure` sobre HTTP simplesmente NUNCA seria enviado pelo
 * navegador, e login pareceria quebrado sem erro nenhum — por isso quem chama
 * isto (`servidor.ts`, via `ServidorOptions.cookieSecure`) só passa `true`
 * quando `COOKIE_SECURE=1` estiver no ambiente, e isso só deve acontecer
 * junto com o bloco `listen 443 ssl` do `nginx.conf` existindo de verdade.
 */
export function cookieDeSessao(token: string, ttlHoras: number, secure = false): string {
  const maxAge = Math.max(0, Math.round(ttlHoras * 3600));
  const base = `${NOME_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
  return secure ? `${base}; Secure` : base;
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
export function identificaPorSessao(
  sessoes: Sessoes,
  req: http.IncomingMessage,
  politica: PoliticaDeSessao = {},
): Identidade | null {
  const token = tokenDoPedido(req);
  if (!token) return null;
  const sessao = sessoes.get(token);
  if (!sessao) return null;
  const agora = politica.agora ?? Date.now();
  const ociosa = politica.ociosidadeMs !== undefined && agora - sessao.ultimoUso > politica.ociosidadeMs;
  if (sessao.expiraEm < agora || ociosa) {
    sessoes.delete(token);
    return null;
  }
  sessao.ultimoUso = agora;
  if (politica.ip !== undefined) {
    if (sessao.ip !== null && sessao.ip !== politica.ip) politica.aoTrocarIp?.(sessao.usuario, sessao.ip, politica.ip);
    sessao.ip = politica.ip;
  }
  // A sessão de `/auth/interno` (só existe com o TOKEN_INTERNO certo) é máquina, não
  // pessoa: passa pelo portão de abas como o aquecedor (`permissoes.ts`). Nenhum login
  // de pessoa produz este nome — o Firebase e o GIS só criam sessão com e-mail.
  if (sessao.usuario === USUARIO_FERRAMENTA) return { usuario: sessao.usuario, papeis: ['interno'] };
  return {
    usuario: sessao.usuario,
    ...(sessao.foto ? { foto: sessao.foto } : {}),
    ...(sessao.nome ? { nome: sessao.nome } : {}),
    papeis: ['autenticado'],
  };
}

export const USUARIO_FERRAMENTA = 'ferramenta-interna';
