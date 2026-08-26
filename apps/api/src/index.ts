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
    //
    // **`enableOfflineQueue: false` é o que impede a espera**, e o motivo tem número.
    // Com a fila ligada (o padrão), um comando emitido enquanto não há conexão fica
    // **enfileirado** até o `ioredis` conseguir conectar ou desistir. Medido em
    // 24/08/2026 nesta máquina, com `REDIS_URL=redis://localhost:6379/0` no `.env` e
    // nada escutando: cada miss de cache pagava a espera duas vezes — no `get` e no
    // `set` — e custava **15 a 20 s**. Sem a fila, o comando falha na hora, e a falha
    // é o que `CacheEmCamadas` já sabe tratar.
    //
    // O `connectTimeout` e o `retryStrategy` fecham o resto: um Redis que existe mas
    // está lento não pode segurar a resposta, e a reconexão não pode virar uma
    // tentativa por milissegundo.
    const cliente = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1_000,
      retryStrategy: (tentativas: number) => Math.min(tentativas * 1_000, 30_000),
    });

    // **Conecta AQUI, e não na primeira operação.** `lazyConnect` sozinho já servia,
    // mas junto com `enableOfflineQueue: false` ele custava o arranque: a primeira
    // operação é a que dispara a conexão *e* é rejeitada por ela ainda não existir
    // (`Stream isn't writeable`). Essa rejeição abre o disjuntor de `CacheEmCamadas`
    // por 5 s, e nesse intervalo o aquecedor calcula páginas cujo resultado não chega
    // ao Redis — logo o cache durável nasce furado justamente na volta que mais
    // escreve. Reproduzido em 25/08/2026: 1ª operação falha, 2ª e 3ª passam.
    //
    // O `await` não é risco de arranque: `connectTimeout` é 1 s e a falha é engolida
    // logo abaixo. Redis fora do ar continua sendo degradação silenciosa e não motivo
    // para a tela não abrir — que é a promessa desta função desde o começo.
    try {
      await cliente.connect();
    } catch (err) {
      console.error(
        `[cache] Redis não conectou no arranque (seguindo em memória, e ele entra ` +
          `sozinho quando voltar): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const redis = new RedisCache(cliente);
    return new CacheEmCamadas({
      rapida: new MemoryCache(),
      duravel: redis,
      aoFalhar: (op, err) => {
        console.error(
          `[cache] Redis falhou em ${op} — a memória continua servindo, e o Redis fica ` +
            `de fora por alguns segundos antes da próxima tentativa: ` +
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
      // Fecha a ponte com a tela. `avisaClientes` e não `notificaInvalida`: o aviso sai
      // com as páginas **já quentes**, e descartar `carregadas` neste ponto desfaria o
      // aquecimento que acabou de ser pago. Ver `servidor.avisaClientes`.
      aoMudar: () => {
        servidor.avisaClientes('*');
        console.error('[aquecedor] a tela foi avisada — o dado novo já está quente.');
      },
    });
    aquecedor.inicia();
  }
});
