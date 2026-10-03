// Utilitários de HTTP da API — responder JSON, ler corpo com teto, comparar segredo em
// tempo constante. Saíram de `servidor.ts` em 27/09/2026 (ACHADOS #158); nenhum depende
// do estado do `Servidor`.

import crypto from 'node:crypto';
import type http from 'node:http';

/**
 * Marca um erro com o status HTTP que ele deve virar, preservando a mensagem.
 *
 * Nasceu com o single-flight: o cálculo saiu de dentro de `pagina()` e foi para
 * dentro de um voo compartilhado, e lá **não existe `res`** — responder 409 na
 * hora serviria um dos N pedidos e deixaria os outros pendurados. O erro tem de
 * voltar carregando o status, para que cada um responda o seu.
 *
 * As mensagens da API dizem o que fazer (o comando de snapshot que falta, o
 * formato do filtro que não decodificou); trocá-las por "HTTP 409" jogaria fora
 * justamente a parte útil, então a mensagem original é mantida intacta.
 */
export function comStatus(err: unknown, status: number): Error {
  const e = err instanceof Error ? err : new Error(String(err));
  return Object.assign(e, { status });
}

export function responde(res: http.ServerResponse, status: number, corpo: unknown): void {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(texto),
  });
  res.end(texto);
}

/** Compara dois segredos em tempo constante — `TOKEN_INTERNO` não é o tipo de
 *  coisa que se compara com `===` e torce para ninguém medir microssegundos. */
export function tokensIguais(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * `JSON.parse` que descarta `__proto__`, `constructor` e `prototype` de
 * QUALQUER nível do objeto, via `reviver`.
 *
 * `JSON.parse` puro já não seta o protótipo de verdade a partir de
 * `{"__proto__": ...}` no texto — a especificação usa `CreateDataProperty`, não
 * o setter mágico de atribuição normal — então o resultado de hoje (só
 * `corpo.idToken`/`corpo.token` são lidos, nunca espalhados/mesclados em outro
 * objeto) já não é explorável. Esta função é a trava para o dia em que algum
 * código futuro fizer `Object.assign(alvo, corpo)` ou equivalente e essa
 * garantia deixar de valer sem ninguém perceber.
 */
export function parseJsonSeguro(texto: string): unknown {
  return JSON.parse(texto, (chave, valor) => {
    if (chave === '__proto__' || chave === 'constructor' || chave === 'prototype') return undefined;
    return valor;
  });
}

/**
 * Lê o corpo de um pedido até `limiteBytes` (padrão 8 KB — um ID token do
 * Google tem ~1-2 KB; a folga é generosa sem abrir a porta para um corpo
 * gigante segurar memória). Único lugar da API que lê corpo — todo o resto é
 * `GET`/`HEAD` sem corpo nenhum.
 */
export function leCorpo(req: http.IncomingMessage, limiteBytes = 8192): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    let excedeu = false;
    const partes: Buffer[] = [];
    // **`req.destroy()` aqui era o bug**: destruir o `IncomingMessage` destrói
    // o SOCKET (é a mesma conexão TCP), e a resposta 400 que `autenticaGoogle`
    // (e as outras duas) tentam mandar em seguida nunca sai — o cliente vê
    // `ECONNRESET`, não 400. A correção é rejeitar sem destruir e DRENAR o
    // resto do corpo (ignorado, nunca empilhado em `partes`, então sem custo
    // de memória) — quando `end` chegar, o socket segue saudável para a
    // resposta e, em keep-alive, para o próximo pedido também.
    req.on('data', (c: Buffer) => {
      if (excedeu) return;
      total += c.length;
      if (total > limiteBytes) {
        excedeu = true;
        reject(new Error('corpo do pedido excede o limite'));
        return;
      }
      partes.push(c);
    });
    req.on('end', () => {
      if (!excedeu) resolve(Buffer.concat(partes).toString('utf8'));
    });
    req.on('error', reject);
  });
}

/** Inteiro de query string, com piso e teto. Valor inválido cai no padrão. */
export function inteiro(bruto: string | null, padrao: number, min: number, max: number): number {
  if (bruto === null) return padrao;
  const n = Number.parseInt(bruto, 10);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, n));
}
