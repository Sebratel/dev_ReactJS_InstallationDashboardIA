#!/usr/bin/env node
// `npm run api` — sobe a API de leitura e a tela.
//
// Não busca nada de fonte: lê o `snapshot/` que `npm run snapshot` deixou em
// disco. Sem snapshot ela sobe do mesmo jeito e `GET /api/saude` diz o que falta —
// morrer no arranque só esconderia a mensagem.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv } from '../../../packages/query-engine/src/config.ts';
import { RedisCache } from '../../../packages/query-engine/src/cache-redis.ts';
import type { Cache } from '../../../packages/query-engine/src/types.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { Aquecedor } from './aquecedor.ts';
import { Servidor } from './servidor.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(AQUI, '..', '..', '..');
applyDotEnv(ROOT);

/**
 * O Redis, se houver `REDIS_URL`.
 *
 * **Sem ele a API sobe igual**, com o cache em memória: o Redis acelera o segundo
 * pedido *depois de um restart*, e nada mais. Trocar isso por uma dependência de
 * arranque transformaria uma otimização em motivo de a tela não abrir.
 *
 * O `import` é dinâmico porque `ioredis` abre conexão ao ser instanciado, e quem
 * roda sem `REDIS_URL` não deve pagar nem por carregar o driver.
 */
async function cacheDaEnv(): Promise<Cache | undefined> {
  const url = process.env.REDIS_URL;
  if (!url) return undefined;
  try {
    const { default: Redis } = await import('ioredis');
    // `lazyConnect`: a conexão sai na primeira operação, não no arranque. Um Redis
    // fora do ar vira miss em `CacheDeResposta`, e não uma exceção aqui.
    return new RedisCache(new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 }));
  } catch (err) {
    console.error(
      `[cache] REDIS_URL existe mas o driver não subiu (seguindo em memória): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

const cache = await cacheDaEnv();
const porta = Number.parseInt(process.env.PORT ?? '3100', 10);

/**
 * O aquecedor só nasce depois do `listen` — ele precisa da porta. Até lá a saúde
 * responde "desligado", que é a verdade naquele instante.
 */
let aquecedor: Aquecedor | null = null;

const servidor = new Servidor({
  root: ROOT,
  snapshotDir: path.join(ROOT, DIRETORIO_PADRAO),
  webDir: path.resolve(AQUI, '..', 'web'),
  aquecimento: () => ({ ativo: aquecedor !== null, pronto: aquecedor?.pronto ?? false }),
  ...(cache ? { cache } : {}),
});

/**
 * O aquecimento é ligado por padrão e sai com `--sem-aquecer`.
 *
 * Sair é útil para depurar uma página: com o aquecedor no ar, todo pedido é acerto
 * de cache, e medir o caminho frio fica impossível.
 */
const semAquecer = process.argv.includes('--sem-aquecer') || process.env.SEM_AQUECER === '1';

servidor.criaHttp().listen(porta, () => {
  console.log(`\nAnalytics Platform — API de leitura`);
  console.log(`  tela  http://localhost:${porta}/`);
  console.log(`  saúde http://localhost:${porta}/api/saude`);
  console.log(`\n  Somente GET. Nenhuma rota escreve em fonte nenhuma.`);
  console.log(`  Os dados vêm do snapshot em disco, não das fontes.`);
  console.log(`  Cache da resposta: ${cache ? 'Redis (REDIS_URL)' : 'memória'}`);
  console.log(`  Reaquecimento: ${semAquecer ? 'desligado (--sem-aquecer)' : 'automático'}\n`);

  if (!semAquecer) {
    // `127.0.0.1` e não `localhost`: em máquina com IPv6 o `localhost` pode resolver
    // para `::1` primeiro e gastar uma tentativa recusada por pedido.
    aquecedor = new Aquecedor({
      base: `http://127.0.0.1:${porta}`,
      carimbo: () => servidor.identidadeAtual(),
    });
    aquecedor.inicia();
  }
});
