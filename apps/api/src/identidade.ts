// Quem está pedindo — a costura por onde o Permission Engine entra.
//
// **A API não autentica ninguém hoje**, e este arquivo não muda isso: a audiência
// da plataforma em 11/08/2026 é uma pessoa, na máquina dela, e escrever login agora
// seria trabalho com chance real de ser jogado fora.
//
// O que ele resolve é outra coisa. Identidade é o tipo de parâmetro que, quando
// chega tarde, atravessa meia dúzia de assinaturas de função de uma vez — e a
// alternativa costuma ser uma variável global, que é como um recorte de um usuário
// acaba servido para outro. Com a costura no lugar, o que falta para a Fase 4 é o
// provedor e o leitor de `specs/_catalog/permissoes.yaml`, não uma refatoração.
//
// **A parte que não é só desenho: a chave do cache já carrega o usuário.** O cache
// da resposta guarda JSON pronto. No dia em que existir recorte por linha, uma
// chave sem identidade devolveria a página do gestor A para o gestor B — cache
// virando vazamento. Pôr `usuario` na chave depois exigiria lembrar disso na hora
// certa; pôr agora custa um campo.

import type http from 'node:http';

export interface Identidade {
  /** Quem pediu. É o que entra na chave do cache. */
  usuario: string;
  /**
   * Os papéis, como em `specs/_catalog/permissoes.yaml`. Hoje sempre `['local']`.
   * Lista, e não um papel só, porque a pessoa que é gestor **e** diretoria não
   * deveria precisar de dois logins.
   */
  papeis: string[];
}

/** O usuário fixo de uma instalação de uma pessoa só. */
export const LOCAL: Identidade = { usuario: 'local', papeis: ['local'] };

/**
 * A identidade de um pedido.
 *
 * **Devolve sempre `LOCAL`, e isso é a implementação inteira.** Não lê cabeçalho,
 * não lê cookie e não confia em nada que o cliente mande — um `X-Usuario` aceito
 * sem verificação seria pior que não ter identidade nenhuma, porque a plataforma
 * passaria a *parecer* que controla acesso.
 *
 * Quando houver login, é esta função que muda, e só ela.
 */
export function identificaLocal(_req: http.IncomingMessage): Identidade {
  return LOCAL;
}
