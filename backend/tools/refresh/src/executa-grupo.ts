// Como um grupo de refresh vira um processo — em UM lugar só.
//
// Existem dois chamadores com necessidades opostas, e é por isso que este módulo
// nasceu em vez de o segundo copiar o primeiro:
//
//   `backend/tools/refresh/src/daemon.ts`   — processo dedicado, pode BLOQUEAR (`spawnSync`).
//   `backend/api/src/agendador.ts`     — dentro da API, NÃO pode bloquear nem por um
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
// stdio e a regra de saída dele é a de `backend/tools/snapshot/`.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { CODIGO_FALHA_TRANSITORIA } from '../../../packages/snapshot/src/erro.ts';
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
 * Nenhuma carga pode segurar a fila para sempre. O maior grupo já medido levou
 * pouco mais de 20 min; 30 min preserva essa folga e corta socket de banco que
 * ficou pendurado. A falha sai como transitória para o daemon tentar de novo.
 */
export const TEMPO_MAXIMO_GRUPO_PADRAO_MS = 30 * 60_000;

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
    '--expose-gc',
    `--max-old-space-size=${memoriaMb}`,
    path.join(raiz, 'backend', 'tools', 'snapshot', 'src', 'index.ts'),
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
  /** Mata a árvore do materializador se ela ultrapassar este prazo. Zero desliga. */
  tempoMaximoMs?: number;
  /** Injetável no teste. Em produção é `node:child_process.spawn`. */
  cria?: typeof spawn;
  /**
   * Mata o filho e devolve `{ ok: false }` quando disparado.
   *
   * Existe por uma causa medida: quando a máquina suspende no meio de uma carga, os
   * sockets do filho com o banco morrem no sono, e ele só descobre isso ao acordar —
   * em 19/09/2026 isso deixou um grupo "em execução" por 2h17min segurando a fila
   * inteira, com `quente` e `frio` parados atrás dele. Quem detecta a suspensão
   * (`backend/api/src/agendador.ts`) aborta por aqui em vez de esperar o filho perceber.
   */
  sinal?: AbortSignal;
}

/** Mata o grupo inteiro no Linux; matar só o pai deixaria a query órfã no snapshot. */
function mataArvore(filho: { pid?: number; kill?: (sinal?: NodeJS.Signals) => boolean }): void {
  if (process.platform !== 'win32' && typeof filho.pid === 'number') {
    try {
      process.kill(-filho.pid, 'SIGKILL');
      return;
    } catch {
      // O filho pode ter saído entre a checagem e o sinal; tenta o PID direto.
    }
  }
  try {
    filho.kill?.('SIGKILL');
  } catch {
    // Filho já encerrado não precisa morrer de novo.
  }
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
    let temporizador: ReturnType<typeof setTimeout> | null = null;
    let aoAbortar: (() => void) | null = null;
    const limpa = (): void => {
      if (temporizador !== null) clearTimeout(temporizador);
      if (aoAbortar && opts.sinal) opts.sinal.removeEventListener('abort', aoAbortar);
    };
    const responde = (r: ResultadoDeExecucao): void => {
      if (respondido) return;
      respondido = true;
      limpa();
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
      // No Linux, abre uma sessão própria para o vigia encerrar também os filhos
      // que o materializador cria para cada query. No Windows o fallback mata o pai.
      detached: process.platform !== 'win32',
    });

    let erroDoFilho = '';
    filho.stderr?.on('data', (pedaco: Buffer | string) => {
      const texto = String(pedaco);
      process.stderr.write(texto);
      // Só o fim interessa, e guardar tudo de uma carga longa seria segurar megabytes
      // na memória da API por nada.
      erroDoFilho = (erroDoFilho + texto).slice(-8192);
    });

    const interrompe = (motivo: string, transitoria = false): void => {
      // `SIGKILL` e não `SIGTERM`: quem aborta já concluiu que este filho não vai
      // terminar sozinho. Pedir educadamente a um processo com socket pendurado é
      // esperar mais um tempo indefinido.
      mataArvore(filho);
      responde({ ok: false, erro: `interrompida: ${motivo}`, ...(transitoria ? { transitoria: true } : {}) });
    };

    if (opts.sinal) {
      aoAbortar = (): void => interrompe(String(opts.sinal?.reason ?? 'abortada'));
      if (opts.sinal.aborted) aoAbortar();
      else opts.sinal.addEventListener('abort', aoAbortar, { once: true });
    }

    const tempoMaximoMs = opts.tempoMaximoMs ?? TEMPO_MAXIMO_GRUPO_PADRAO_MS;
    if (!respondido && Number.isFinite(tempoMaximoMs) && tempoMaximoMs > 0) {
      temporizador = setTimeout(() => {
        interrompe(`vigia de refresh: grupo '${grupo.id}' passou de ${Math.round(tempoMaximoMs / 60_000)} min`, true);
      }, tempoMaximoMs);
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
      responde(resultadoDaSaida(codigo, sinal, caudaDeErro(erroDoFilho)));
    });
  });
}

/** 75 é o materializador dizendo "só rede" — ver `CODIGO_FALHA_TRANSITORIA`. */
function resultadoDaSaida(codigo: number | null, sinal: string | null, cauda = ''): ResultadoDeExecucao {
  if (codigo === 0) return { ok: true };
  return {
    ok: false,
    erro: `saiu com código ${codigo ?? sinal}${cauda ? ` — ${cauda}` : ''}`,
    ...(codigo === CODIGO_FALHA_TRANSITORIA ? { transitoria: true } : {}),
  };
}
