// Sessão: as únicas rotas da API que escrevem estado (o cookie), fora de `/api/*` de
// propósito. Os três caminhos de login terminam igual — cookie emitido pela nossa API —
// e é o cookie, não o token do provedor, que autentica `/api/*`.

type CaminhoDeSessao = '/auth/firebase' | '/auth/google' | '/auth/interno';

/** Mensagem de erro de uma resposta JSON de erro da API, com um genérico de
 *  reserva — mesmo formato que `pega()` já usa em `dashboardService.ts`. */
async function erroDaResposta(r: Response): Promise<string> {
  const corpo: unknown = await r.json().catch(() => null);
  if (corpo && typeof corpo === 'object' && 'erro' in corpo)
    return String((corpo as { erro: unknown }).erro);
  return `Não foi possível entrar (HTTP ${r.status}).`;
}

/**
 * Troca a credencial do provedor por sessão nossa. Devolve `null` quando entrou e a
 * mensagem legível quando a API recusou; falha de rede SOBE — cada caminho de login
 * mostra a sua (o Firebase distingue "fechou a janela" de erro de verdade).
 */
async function abreSessao(
  caminho: CaminhoDeSessao,
  corpo: Record<string, string>,
): Promise<string | null> {
  const r = await fetch(caminho, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return r.ok ? null : erroDaResposta(r);
}

export const abreSessaoFirebase = (idToken: string) => abreSessao('/auth/firebase', { idToken });
export const abreSessaoGoogle = (idToken: string) => abreSessao('/auth/google', { idToken });
export const abreSessaoInterna = (token: string) => abreSessao('/auth/interno', { token });

/** Apaga a sessão do lado do servidor. O cookie sai na resposta; quem chama
 *  ainda precisa tirar a tela do ar (ver `App.tsx`). */
export const sai = (): Promise<void> =>
  fetch('/auth/logout', { method: 'POST' }).then(() => undefined);
