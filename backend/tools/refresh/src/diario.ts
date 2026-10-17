// Snapshot COMPLETO da madrugada, disparado de dentro do daemon do `refresh` (17/10/2026).
//
// Até aqui ele era um contêiner próprio (`snapshot-diario`, com `cron`), com o seu próprio
// `mem_limit` de 1450m — e os dois tetos somavam 2,9 GB reservados para um trabalho que
// NUNCA roda em paralelo: os dois materializadores dividem a trava do snapshot
// (`backend/packages/snapshot/src/trava.ts`), e quem chega com a trava ocupada espera.
// No mesmo contêiner a regra é a mesma, e a reserva cai para um teto só.
//
// O comando é o mesmo que o crontab rodava: um subprocesso do `snapshot` com
// `--refazer` sobre TODA query de `refresh.yaml` — a lista não é mais mantida à mão; é
// a união dos grupos, que era exatamente o que o teste do crontab cobrava.
import { spawn } from 'node:child_process';
import type { GrupoDeRefresh } from './grupos.ts';

/** 06:00 UTC = 03:00 em Brasília (sem horário de verão desde 2019). */
export const HORARIO_PADRAO_UTC = '06:00';

export interface HorarioUtc {
  hora: number;
  minuto: number;
}

/** `"HH:MM"` em UTC. `null` para vazio, `"0"`/`"off"` (desligado) ou lixo. */
export function leHorarioUtc(texto: string | undefined): HorarioUtc | null {
  const m = texto?.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hora = Number(m[1]);
  const minuto = Number(m[2]);
  if (hora > 23 || minuto > 59) return null;
  return { hora, minuto };
}

/** Milissegundos até a próxima ocorrência do horário, sempre > 0 (no minuto exato, amanhã). */
export function msAteProximo(agora: Date, h: HorarioUtc): number {
  const alvo = new Date(agora);
  alvo.setUTCHours(h.hora, h.minuto, 0, 0);
  if (alvo.getTime() <= agora.getTime()) alvo.setUTCDate(alvo.getUTCDate() + 1);
  return alvo.getTime() - agora.getTime();
}

/** Toda query de `refresh.yaml`, sem repetição e em ordem estável. */
export function queriesDoDiario(grupos: Iterable<GrupoDeRefresh>): string[] {
  const todas = new Set<string>();
  for (const g of grupos) for (const q of g.queries) todas.add(q);
  return [...todas].sort();
}

/** Os argumentos do `node` do filho — os mesmos da linha do antigo crontab. */
export function argumentosDoDiario(queries: string[], memoriaMb: number): string[] {
  return [
    '--expose-gc',
    `--max-old-space-size=${memoriaMb}`,
    'backend/tools/snapshot/src/index.ts',
    `--query=${queries.join(',')}`,
    '--refazer',
    `--memoria=${memoriaMb}`,
  ];
}

export interface OpcoesDoDiario {
  raiz: string;
  horario: HorarioUtc;
  queries: string[];
  memoriaMb: number;
  agora?: () => Date;
  /** Roda o filho e resolve com o código de saída. Trocável em teste. */
  executa?: (args: string[], raiz: string) => { fim: Promise<number>; mata: () => void };
  log?: (linha: string) => void;
}

export interface SnapshotDiario {
  /** Desarma o relógio e pede ao filho em voo que solte a trava e saia. */
  encerra(): void;
  /** Quantas cargas já dispararam (para teste e diagnóstico). */
  readonly disparos: number;
}

function executaFilho(args: string[], raiz: string): { fim: Promise<number>; mata: () => void } {
  const filho = spawn(process.execPath, args, { cwd: raiz, stdio: 'inherit', env: process.env });
  const fim = new Promise<number>((resolve) => {
    filho.on('exit', (codigo, sinal) => resolve(codigo ?? (sinal ? 128 : 1)));
    filho.on('error', () => resolve(1));
  });
  // SIGTERM e não SIGKILL: o `snapshot` solta a trava ao receber SIGTERM.
  return { fim, mata: () => void filho.kill('SIGTERM') };
}

export function iniciaSnapshotDiario(opts: OpcoesDoDiario): SnapshotDiario {
  const agora = opts.agora ?? (() => new Date());
  const executa = opts.executa ?? executaFilho;
  const log = opts.log ?? ((l: string) => console.log(l));
  let timer: NodeJS.Timeout | undefined;
  let emVoo: { mata: () => void } | undefined;
  let encerrado = false;
  let disparos = 0;

  const arma = (): void => {
    if (encerrado) return;
    timer = setTimeout(dispara, msAteProximo(agora(), opts.horario));
  };

  const dispara = (): void => {
    arma();
    // Uma madrugada que ainda roda 24 h depois é defeito, não fila: não empilha outra.
    if (emVoo) {
      log('[diario] a carga completa anterior ainda está em voo — esta foi pulada.');
      return;
    }
    disparos++;
    const inicio = Date.now();
    log(`[diario] carga completa: ${opts.queries.length} queries (--refazer, heap ${opts.memoriaMb} MB).`);
    const filho = executa(argumentosDoDiario(opts.queries, opts.memoriaMb), opts.raiz);
    emVoo = filho;
    void filho.fim.then((codigo) => {
      emVoo = undefined;
      const s = Math.round((Date.now() - inicio) / 1000);
      log(codigo === 0 ? `[diario] concluída em ${s}s.` : `[diario] FALHOU (código ${codigo}) após ${s}s.`);
    });
  };

  arma();
  const h = String(opts.horario.hora).padStart(2, '0');
  const m = String(opts.horario.minuto).padStart(2, '0');
  log(`[diario] carga completa agendada para ${h}:${m} UTC, todo dia.`);

  return {
    encerra() {
      encerrado = true;
      if (timer) clearTimeout(timer);
      emVoo?.mata();
    },
    get disparos() {
      return disparos;
    },
  };
}
