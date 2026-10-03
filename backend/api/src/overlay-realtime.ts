// O overlay do poller de quase-realtime, na forma que ATRAVESSA a fronteira da
// worker — e a função que o reconstrói do outro lado.
//
// **Por que este arquivo existe, separado de `poller-realtime.ts`.** Duas razões,
// e as duas são consequência de a piscina de workers ser o caminho de produção:
//
//   1. **Closure não atravessa `postMessage`.** `carrega()` recebe o overlay como
//      uma FUNÇÃO por tabela (`CarregaOptions.overlay`), e essa decisão continua
//      certa *dentro* de uma thread — quem sabe mesclar é dono da política, e
//      `backend/packages/snapshot` não precisa conhecer `realtime-poll.yaml`. Mas o
//      structured clone do `postMessage` não serializa função: mandar o `Map` de
//      mescladores para a worker entrega `undefined` do outro lado, sem erro. O
//      que atravessa é `OverlayDeTabela` — dado puro (linhas, corte, chave,
//      marca) — e a worker reconstrói a função com `mesclador()`.
//
//   2. **A worker não pode importar `poller-realtime.ts`.** Aquele módulo importa
//      `connectors-sql.ts` (o driver do Postgres) e `yaml`, porque ele também é
//      quem BUSCA. Uma worker que só precisa MESCLAR carregaria o pool de conexão
//      inteiro no seu próprio grafo de módulos, uma vez por worker, para nunca
//      abrir conexão nenhuma.
//
// `poller-realtime.ts` reexporta os dois nomes daqui: uma definição só, para que
// o produtor do overlay e quem o aplica não possam divergir.

import { mescla } from '../../packages/snapshot/src/incremental.ts';
import type { Escalar } from '../../packages/snapshot/src/formato.ts';

/**
 * O que `carrega()` precisa para mesclar um delta do poller com o que leu do
 * disco — **em dado, não em comportamento**.
 *
 * Todos os campos são clonáveis por estrutura: `linhas` são objetos de escalares
 * (o driver do Postgres já devolve `Date` de verdade, e `Date` atravessa),
 * `corte` é uma `Date`, e os dois arrays são de texto. É essa propriedade que faz
 * o overlay chegar à worker; qualquer campo novo aqui tem de mantê-la.
 */
export interface OverlayDeTabela {
  linhas: readonly Record<string, Escalar>[];
  /** Desde quando o delta é a verdade completa. Ver `DeltaDeTabela.inicioJanela`. */
  corte: Date;
  /** Repassados de `ConfigDePoll` — `mescla()` precisa dos dois para reconciliar. */
  chave: readonly string[];
  marca: readonly string[];
}

/**
 * A função pronta para `CarregaOptions.overlay` — mescla as linhas do disco com o
 * delta do poller, usando `mescla()` (a mesma de `incremental.ts`, mesma
 * semântica de "grupo reentregue inteiro").
 *
 * Chamada nos DOIS lados da fronteira: no processo principal, quando a piscina
 * está desligada e `Servidor.carrega` calcula em linha; e dentro da worker,
 * sobre o `OverlayDeTabela` que acabou de atravessar. É a mesma função nos dois,
 * de propósito — duas cópias divergiriam no primeiro conserto, e a divergência
 * apareceria como número diferente conforme a piscina estivesse ligada ou não.
 */
export function mesclador(
  ov: OverlayDeTabela,
): (doDisco: readonly Record<string, Escalar>[]) => Record<string, Escalar>[] {
  return (doDisco) =>
    mescla({ antigas: doDisco, novas: ov.linhas, chave: ov.chave, marca: ov.marca, corte: ov.corte }).linhas;
}

/** Converte um mapa de overlays (dado) no mapa de funções que `carrega()` espera. */
export function mescladoresDe(
  overlays: ReadonlyMap<string, OverlayDeTabela>,
): Map<string, (doDisco: readonly Record<string, Escalar>[]) => Record<string, Escalar>[]> {
  const out = new Map<string, (doDisco: readonly Record<string, Escalar>[]) => Record<string, Escalar>[]>();
  for (const [tabela, ov] of overlays) out.set(tabela, mesclador(ov));
  return out;
}

/**
 * Quantas linhas o overlay inteiro carrega — o número que diz, sem adivinhação,
 * quanto atravessa a fronteira da worker a cada cálculo.
 *
 * Linhas e não bytes porque medir bytes exigiria serializar o overlay só para
 * medi-lo, no caminho quente, e o `postMessage` já vai serializá-lo em seguida.
 * `podaDelta` (teto de 48 h) é o que mantém este número pequeno; se ele crescer,
 * é sinal de que a poda deixou de dar conta — e é por isso que ele sai em
 * `GET /api/saude` em vez de ficar como suposição.
 */
export function linhasDoOverlay(overlays: ReadonlyMap<string, OverlayDeTabela>): number {
  let n = 0;
  for (const ov of overlays.values()) n += ov.linhas.length;
  return n;
}
