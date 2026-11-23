// Qual erro das consultas a tela mostra — e em que texto.
//
// Nem todo erro vira mensagem: o de sessão vira login (no `QueryCache`), pedido
// cancelado não é erro (é o pedido seguinte fazendo o trabalho certo), e o 403 de uma
// aba fora da lista também não — para esse, quem resolve é o `useAbaPadrao`, levando a
// pessoa para uma aba liberada.

import { ehAbortError, ehErroDeAcesso, ehErroDeSessao } from '../services/dashboardService.ts';

/** O texto de um erro desconhecido, sem `[object Object]` na cara do usuário. */
export function textoDoErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * A mensagem a mostrar, ou `null` quando nenhum dos erros merece a tela.
 *
 * @param erros        os erros das consultas da tela, na ordem de prioridade
 * @param abaLiberada  se a aba aberta está liberada para esta conta (`null` = ainda não
 *                     dá para saber); um 403 de aba não liberada é silenciado
 */
export function mensagemDeErroDaTela(
  erros: readonly unknown[],
  abaLiberada: boolean | null,
): string | null {
  const relevante = erros.find((erro) => erroMereceATela(erro, abaLiberada));
  return relevante === undefined ? null : textoDoErro(relevante);
}

function erroMereceATela(erro: unknown, abaLiberada: boolean | null): boolean {
  if (!erro) return false;
  if (ehErroDeSessao(erro) || ehAbortError(erro)) return false;
  return !(ehErroDeAcesso(erro) && abaLiberada !== true);
}
