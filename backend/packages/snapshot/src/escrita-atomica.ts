// Renomear `X.parcial` por cima de `X` para publicar uma escrita de uma vez só —
// e, no Windows, isso falha sempre que outro processo tem `X` aberto, mesmo só para
// leitura. Não é caso raro: medido localmente em 02/09/2026, 100% de falha
// (`EPERM`) em 600 tentativas com o arquivo aberto (`fs.openSync` e
// `fs.createReadStream` pausado, os dois jeitos como `formato.ts` lê). O handle some
// assim que o leitor termina — `le()`/`leCabecalho()` abrem, leem e fecham por
// pedido, nunca guardam um handle entre pedidos —, então tentar de novo com espera
// crescente resolve sem o escritor precisar saber quem está lendo. Com leituras de
// 5–25 ms, 3 tentativas (25/50/100 ms) bastaram sempre; o orçamento abaixo é maior
// de propósito, para sobrar margem para arquivo maior ou uma pausa do antivírus do
// servidor de deploy — ainda não medida (ver DEPLOY.md §4.2).
//
// Em POSIX o rename nunca falha por handle aberto (é a base do padrão
// temp+rename ali). As tentativas custam uma chamada de sistema e nunca disparam —
// o código não se ramifica por plataforma de propósito: um ramo que só roda no
// Windows é um ramo que o CI (se rodar em Linux) nunca exercita.

import fs from 'node:fs';

/** Em milissegundos, crescente. Soma ~1,575 s no pior caso — ver o comentário acima. */
const ESPERAS_MS = [25, 50, 100, 200, 400, 800] as const;

function espera(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `renomeia(origem, destino)` com novas tentativas se falhar por `EPERM`/`EBUSY` —
 * a cara de "destino está aberto em outro processo" no Windows. Qualquer outro
 * código de erro (ex.: `ENOENT`, origem não existe) sobe na primeira tentativa: não
 * adianta esperar por um erro que esperar não resolve.
 *
 * `opts.renomeia` e `opts.esperasMs` existem para o teste — trocar `fs.renameSync`
 * por uma função que falha um número exato de vezes é verificar a lógica de novas
 * tentativas sem depender de segurar um handle de verdade.
 */
export async function renomeiaComRetentativa(
  origem: string,
  destino: string,
  opts?: {
    renomeia?: (origem: string, destino: string) => void;
    esperasMs?: readonly number[];
  },
): Promise<void> {
  const renomeia = opts?.renomeia ?? fs.renameSync;
  const esperasMs = opts?.esperasMs ?? ESPERAS_MS;
  for (let tentativa = 0; ; tentativa++) {
    try {
      renomeia(origem, destino);
      return;
    } catch (err) {
      const codigo = (err as NodeJS.ErrnoException).code;
      if (tentativa >= esperasMs.length || (codigo !== 'EPERM' && codigo !== 'EBUSY')) {
        throw err;
      }
      await espera(esperasMs[tentativa]!);
    }
  }
}
