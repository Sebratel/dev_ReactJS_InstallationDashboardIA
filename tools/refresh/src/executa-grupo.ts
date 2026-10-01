// Como um grupo de refresh vira um processo — em UM lugar só.
//
// Existem dois chamadores com necessidades opostas, e é por isso que este módulo
// nasceu em vez de o segundo copiar o primeiro:
//
//   `tools/refresh/src/daemon.ts`   — processo dedicado, pode BLOQUEAR (`spawnSync`).
//   `apps/api/src/agendador.ts`     — dentro da API, NÃO pode bloquear nem por um
//                                     milissegundo: o mesmo laço de eventos serve
//                                     HTTP. Um `spawnSync` de 21 minutos ali não
//                                     seria lentidão, seria a tela fora do ar.
//
// O que os dois têm de compartilhar é o **argv**. Ele carrega três decisões que
// divergiriam no primeiro conserto se houvesse duas cópias: o heap do filho, o
// `--refazer` (sem ele o materializador respeita o arquivo em disco e o tick não faz
// nada) e o `--incremental` condicional ao grupo.
//
// REGRA DE SAÍDA: id de grupo, contagem e tempo. Nunca valor de linha — o filho herda
// stdio e a regra de saída dele é a de `tools/snapshot/`.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { argIncremental, type GrupoDeRefresh } from './grupos.ts';
// **Um tipo só, e ele mora em `tick.ts`.** Redeclarar `ResultadoDeExecucao` aqui daria
// duas definições estruturalmente iguais que o compilador aceita e que divergem no dia
// em que uma das duas ganhar um campo.
import type { ResultadoDeExecucao } from './tick.ts';

export type { ResultadoDeExecucao };

/** O heap do filho. 8192 MB é o piso medido: `protocolos-geral` estourou 8 GB uma vez
 *  (commit af82774 devolveu a query para dentro do orçamento) e `protocolos-produtividade`
 *  materializa 76 mil linhas × 51 colunas. Quem precisa de mais passa `memoriaMb`. */
export const MEMORIA_PADRAO_MB = 8192;

/**
 * O argv exato que materializa um grupo. Separado da execução para o teste poder
 * afirmar sobre ele sem criar processo nenhum.
 */
export function argvDoGrupo(
  raiz: string,
  grupo: GrupoDeRefresh,
  memoriaMb: number = MEMORIA_PADRAO_MB,
): string[] {
  return [
    `--max-old-space-size=${memoriaMb}`,
    path.join(raiz, 'tools', 'snapshot', 'src', 'index.ts'),
    `--memoria=${memoriaMb}`,
    `--query=${grupo.queries.join(',')}`,
    '--refazer',
    ...argIncremental(grupo),
  ];
}

/** Quantas linhas finais da saída de erro do filho entram no resumo da falha. */
export const LINHAS_DE_ERRO = 5;
/** Cada uma cortada aqui: é resumo para log, não transcrição. */
const LARGURA_MAXIMA = 200;

export interface OpcoesDeExecucao {
  memoriaMb?: number;
  /** Injetável no teste. Em produção é `node:child_process.spawn`. */
  cria?: typeof spawn;
  /**
   * Mata o filho e devolve `{ ok: false }` quando disparado.
   *
   * Existe por uma causa medida: quando a máquina suspende no meio de uma carga, os
   * sockets do filho com o banco morrem no sono, e ele só descobre isso ao acordar —
   * em 19/09/2026 isso deixou um grupo "em execução" por 2h17min segurando a fila
   * inteira, com `quente` e `frio` parados atrás dele. Quem detecta a suspensão
   * (`apps/api/src/agendador.ts`) aborta por aqui em vez de esperar o filho perceber.
   */
  sinal?: AbortSignal;
}

/** As últimas `LINHAS_DE_ERRO` linhas não vazias, para anexar ao resumo da falha. */
function caudaDeErro(bruto: string): string {
  const linhas = bruto
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .slice(-LINHAS_DE_ERRO)
    .map((l) => (l.length > LARGURA_MAXIMA ? `${l.slice(0, LARGURA_MAXIMA)}...` : l));
  return linhas.join(' | ');
}

/**
 * Roda um grupo em subprocesso e resolve quando ele termina. **Nunca rejeita** — uma
 * falha de materialização é um resultado, não uma exceção, e quem chama é um agendador
 * que precisa seguir para o grupo seguinte.
 *
 * **Por que subprocesso, e não dentro do processo que chama.** É a única divergência
 * deliberada em relação ao dashboard comercial (que reconstrói o modelo no próprio
 * processo do Express): lá o modelo inteiro cabe em ~60 MB e a carga mais cara é de
 * ~25 s. Aqui `protocolos-geral` sozinha pede 8 GB de heap e `field-agenda` leva
 * 21 min 49 s (ACHADOS #82). Materializar dentro da API faria o pico de memória da
 * materialização e o da API serem o MESMO pico — e um OOM kill durante a carga
 * derrubaria a tela junto. O filho isola as duas coisas: o heap da API fica plano, e o
 * laço de eventos dela nunca para.
 */
export function rodaGrupoAssincrono(
  raiz: string,
  grupo: GrupoDeRefresh,
  opts: OpcoesDeExecucao = {},
): Promise<ResultadoDeExecucao> {
  const cria = opts.cria ?? spawn;
  const argv = argvDoGrupo(raiz, grupo, opts.memoriaMb ?? MEMORIA_PADRAO_MB);
  return new Promise<ResultadoDeExecucao>((resolve) => {
    let respondido = false;
    const responde = (r: ResultadoDeExecucao): void => {
      if (respondido) return;
      respondido = true;
      resolve(r);
    };
    // `stdout` continua herdado: é o log de progresso do materializador, e ele tem
    // de aparecer ao vivo em quem disparou. `stderr` passou a ser CANALIZADO — e
    // reescrito no nosso `stderr` logo em seguida, então nada se perde da tela.
    //
    // **O motivo é um custo pago.** Com `stdio: 'inherit'` nos dois, a única coisa
    // que sobrava de uma falha era `saiu com código 1`, e foi exatamente o que o
    // `refresh-historico.log` registrou em 19/09/2026. Descobrir a causa exigiu
    // cruzar o histórico com o log de energia do Windows. A cauda do `stderr` teria
    // dito `Connection terminated unexpectedly` na primeira linha.
    const filho = cria(process.execPath, argv, {
      cwd: raiz,
      stdio: ['ignore', 'inherit', 'pipe'],
    });

    let erroDoFilho = '';
    filho.stderr?.on('data', (pedaco: Buffer | string) => {
      const texto = String(pedaco);
      process.stderr.write(texto);
      // Só o fim interessa, e guardar tudo de uma carga longa seria segurar megabytes
      // na memória da API por nada.
      erroDoFilho = (erroDoFilho + texto).slice(-8192);
    });

    if (opts.sinal) {
      const aborta = (): void => {
        // `SIGKILL` e não `SIGTERM`: quem aborta já concluiu que este filho não vai
        // terminar sozinho (ver `sinal` em `OpcoesDeExecucao`). Pedir educadamente a
        // um processo cujas conexões morreram é esperar mais um tempo indefinido.
        try {
          filho.kill?.('SIGKILL');
        } catch {
          // Filho que já morreu não precisa morrer de novo.
        }
        responde({
          ok: false,
          erro: `interrompida: ${String(opts.sinal?.reason ?? 'abortada')}`,
        });
      };
      if (opts.sinal.aborted) aborta();
      else opts.sinal.addEventListener('abort', aborta, { once: true });
    }
    // `'error'` cobre o que `'exit'` não cobre: o binário não existe, a pasta sumiu,
    // o sistema recusou criar processo. Sem este ouvinte o `ChildProcess` emitiria
    // `'error'` sem ninguém escutando — e um `'error'` solto num `EventEmitter`
    // derruba o processo. É o mesmo defeito que o `ioredis` causou na API em
    // 08/09/2026, e o mesmo que `CarimboVigiado` fechou para o `fs.watch`.
    filho.on('error', (err: unknown) => {
      responde({ ok: false, erro: err instanceof Error ? err.message : String(err) });
    });
    filho.on('exit', (codigo, sinal) => {
      if (codigo === 0) return responde({ ok: true });
      const cauda = caudaDeErro(erroDoFilho);
      responde({
        ok: false,
        erro: `saiu com código ${codigo ?? sinal}${cauda ? ` — ${cauda}` : ''}`,
      });
    });
  });
}
