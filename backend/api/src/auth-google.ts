// Verifica o ID token que o Google Identity Services devolve no navegador.
//
// Separado de `identidade.ts` de propósito: aquele arquivo é sobre SESSÃO (um
// `Map` em memória, nunca fala com rede); este é sobre TOKEN (fala com o Google
// para confirmar assinatura e validade). Um teste de sessão não deveria
// precisar de rede para rodar, e um teste deste arquivo injeta o cliente —
// mesmo padrão de `ServidorOptions.identifica`, dar de testar sem depender do
// serviço externo.
//
// **Por que confere `hd` (hosted domain) e não só o sufixo do e-mail.** O
// backend do HUBBI confere sufixo (`email.endsWith('@' + dominio)`) — mais
// fácil de escrever, mas um e-mail pessoal tipo `fulano@sebratel.com.br.evil.com`
// passaria nessa checagem. `hd` é um claim do PRÓPRIO Google, presente só em
// contas de um Google Workspace de verdade, e não pode ser forjado sem quebrar
// a assinatura do token. Divergência do padrão do HUBBI, registrada aqui —
// não copiada calada.

import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { fotoDePerfilSegura } from './foto-perfil.ts';

/** O que este módulo precisa do `OAuth2Client` — não a classe inteira, só o
 *  método usado. Permite injetar um cliente de mentira em teste. */
export interface VerificadorDeToken {
  verifyIdToken(opts: { idToken: string; audience: string }): Promise<{ getPayload(): TokenPayload | undefined }>;
}

export interface IdentidadeGoogle {
  email: string;
  foto?: string;
}

/**
 * Verifica `idToken` contra `clientId` e confere que a conta pertence ao
 * `dominioCorporativo`. Devolve `null` para QUALQUER motivo de recusa —
 * assinatura inválida, token expirado, `aud` errado, domínio errado, e-mail
 * ausente — de propósito: quem chama só precisa saber "autentica ou não", o
 * motivo detalhado vai para o log, não para a resposta HTTP (não dar pista de
 * qual parte da checagem falhou a quem está tentando adivinhar).
 */
export async function verificaIdToken(
  idToken: string,
  opts: { clientId: string; dominioCorporativo: string; cliente?: VerificadorDeToken },
): Promise<IdentidadeGoogle | null> {
  const cliente = opts.cliente ?? new OAuth2Client(opts.clientId);
  let payload: TokenPayload | undefined;
  try {
    const ticket = await cliente.verifyIdToken({ idToken, audience: opts.clientId });
    payload = ticket.getPayload();
  } catch (err) {
    console.error(`[auth-google] token recusado: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (!payload?.email) return null;
  if (payload.hd !== opts.dominioCorporativo) {
    console.error(`[auth-google] domínio '${payload.hd ?? '(nenhum)'}' != '${opts.dominioCorporativo}'`);
    return null;
  }
  const foto = fotoDePerfilSegura(payload.picture);
  return { email: payload.email, ...(foto ? { foto } : {}) };
}
