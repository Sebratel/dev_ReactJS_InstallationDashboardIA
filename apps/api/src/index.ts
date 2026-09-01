#!/usr/bin/env node
// `npm run api` — sobe a API de leitura e a tela.
//
// Não busca nada de fonte: lê o `snapshot/` que `npm run snapshot` deixou em
// disco. Sem snapshot ela sobe do mesmo jeito e `GET /api/saude` diz o que falta —
// morrer no arranque só esconderia a mensagem.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv } from '../../../packages/query-engine/src/config.ts';
import { CacheEmCamadas } from '../../../packages/query-engine/src/cache-camadas.ts';
import { MemoryCache } from '../../../packages/query-engine/src/cache-memory.ts';
import { RedisCache } from '../../../packages/query-engine/src/cache-redis.ts';
import type { Cache } from '../../../packages/query-engine/src/types.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { Aquecedor } from './aquecedor.ts';
import { comoLiberar } from './porta.ts';
import { Servidor } from './servidor.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(AQUI, '..', '..', '..');
applyDotEnv(ROOT);

/**
 * O Redis, se houver `REDIS_URL` — **na frente dele, sempre a memória**.
 *
 * **Sem ele a API sobe igual.** Trocar isso por uma dependência de arranque
 * transformaria uma otimização em motivo de a tela não abrir.
 *
 * **E com ele a API não fica mais lenta**, que é o que aconteceria na versão
 * anterior desta função. Ela devolvia o `RedisCache` **no lugar** do `MemoryCache`,
 * e ligar o Redis teria feito cada acerto pagar uma ida e volta de rede mais um
 * `JSON.parse` de até 172 KB, no lugar de uma leitura de `Map`. As duas camadas
 * resolvem coisas diferentes: a memória dá a latência, o Redis dá a permanência
 * (sobreviver ao restart, e ser compartilhado entre processos). Ver
 * `cache-camadas.ts`.
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
    const redis = new RedisCache(new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 }));
    return new CacheEmCamadas({
      rapida: new MemoryCache(),
      duravel: redis,
      aoFalhar: (op, err) => {
        console.error(
          `[cache] Redis falhou em ${op} (a memória continua servindo): ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      },
    });
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
 * Teto do cache de resultado inteiro por visual, em MB. `CACHE_VISUAL_MB=0` desliga.
 *
 * Existe como saída de emergência, não como afinação: numa máquina apertada é melhor
 * a paginação recalcular do que a API morrer sem memória. Ver `cache-visual.ts`.
 */
const tetoDeVisuaisMB = process.env.CACHE_VISUAL_MB
  ? Number.parseInt(process.env.CACHE_VISUAL_MB, 10)
  : undefined;

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
  ...(tetoDeVisuaisMB !== undefined && Number.isFinite(tetoDeVisuaisMB)
    ? { tetoDeVisuaisMB }
    : {}),
  ...(process.env.GOOGLE_CLIENT_ID ? { googleClientId: process.env.GOOGLE_CLIENT_ID } : {}),
  ...(process.env.DOMINIO_CORPORATIVO ? { dominioCorporativo: process.env.DOMINIO_CORPORATIVO } : {}),
  ...(process.env.SESSAO_TTL_HORAS
    ? { sessaoTtlHoras: Number.parseFloat(process.env.SESSAO_TTL_HORAS) }
    : {}),
  ...(process.env.TOKEN_INTERNO ? { tokenInterno: process.env.TOKEN_INTERNO } : {}),
});

/**
 * O aquecimento é ligado por padrão e sai com `--sem-aquecer`.
 *
 * Sair é útil para depurar uma página: com o aquecedor no ar, todo pedido é acerto
 * de cache, e medir o caminho frio fica impossível.
 */
const semAquecer = process.argv.includes('--sem-aquecer') || process.env.SEM_AQUECER === '1';

const http = servidor.criaHttp();

/**
 * `EADDRINUSE` não pode sair como stack trace.
 *
 * A guarda do `tools/subir` roda ANTES de subir, e não alcança quem chega por outro
 * caminho: `npm run api`, um script, ou um `npm start` que perdeu a corrida entre a
 * checagem e o `listen`. Nesses casos o Node emitia `Unhandled 'error' event` com 12
 * linhas de pilha e nenhuma palavra sobre o que fazer — e a saída era procurar o PID à
 * mão, toda vez. Aqui a mensagem é a mesma do `tools/subir`, do mesmo módulo, porque
 * duas cópias do mesmo texto divergem no primeiro conserto.
 */
http.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(comoLiberar(porta));
  process.exit(1);
});

http.listen(porta, () => {
  console.log(`\nAnalytics Platform — API de leitura`);
  console.log(`  tela  http://localhost:${porta}/`);
  console.log(`  saúde http://localhost:${porta}/api/saude`);
  console.log(`\n  Somente GET (e POST /auth/*). Nenhuma rota escreve em fonte nenhuma.`);
  console.log(`  Os dados vêm do snapshot em disco, não das fontes.`);
  console.log(
    `  Login: ${process.env.GOOGLE_CLIENT_ID
      ? `Google SSO, domínio ${process.env.DOMINIO_CORPORATIVO ?? 'sebratel.com.br'}`
      : 'DESLIGADO — GOOGLE_CLIENT_ID ausente, /auth/google recusa todo token'}`,
  );
  console.log(
    `  Cache da resposta: ${cache ? 'memória + Redis (REDIS_URL)' : 'memória'}`,
  );
  console.log(`  Reaquecimento: ${semAquecer ? 'desligado (--sem-aquecer)' : 'automático'}`);
  console.log(
    `  Paginação: ${tetoDeVisuaisMB === 0 ? 'sem cache de visual (CACHE_VISUAL_MB=0) — cada janela recalcula' : 'janela sai do resultado já calculado'}\n`,
  );

  if (!semAquecer) {
    // `127.0.0.1` e não `localhost`: em máquina com IPv6 o `localhost` pode resolver
    // para `::1` primeiro e gastar uma tentativa recusada por pedido.
    aquecedor = new Aquecedor({
      base: `http://127.0.0.1:${porta}`,
      carimbo: () => servidor.identidadeAtual(),
      // O login gate (`/api/*` exige sessão) bloquearia o próprio Aquecedor,
      // que bate nessas rotas por HTTP de propósito (ver comentário de
      // `segredoAquecedor` em servidor.ts). Este cabeçalho é o reconhecimento
      // — gerado uma vez por processo, nunca configurável, nunca visto fora
      // deste ir-e-vir local.
      buscar: (url, init) =>
        fetch(url, { ...init, headers: { ...init?.headers, 'x-aquecedor-interno': servidor.segredoInterno() } }),
    });
    aquecedor.inicia();
  }
});
