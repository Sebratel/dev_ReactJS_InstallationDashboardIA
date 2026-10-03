// Trava de escrita do snapshot: um materializador por vez no mesmo `snapshot/`.
//
// **Por que existe (28/09/2026, ACHADOS #159).** Quem grava no snapshot faz, no fim,
// `leManifesto` → mescla → `escreveManifesto`. A escrita é atômica (temp + rename), mas
// dois processos ao mesmo tempo são um read-modify-write clássico: o segundo a terminar
// regrava o índice sem as tabelas que o primeiro acabou de registrar, sem erro nenhum.
// Dentro de um agendador isso não acontece (a fila é de um), mas havia três escritores
// que não se conheciam: o `refresh` (daemon ou API), o `snapshot-diario` das 3h e um
// `npm run snapshot` manual — e, no pior caso, o `npm start` e a stack Docker juntos no
// mesmo diretório (ACHADOS #148).
//
// **Como.** Um arquivo criado com `wx` (falha se já existe) guarda o dono. O dono
// renova a hora de modificação a cada 30 s. Quem chega e acha a trava:
//   - do MESMO host, com o PID morto → abandonada, toma na hora (o `npm start` que caiu);
//   - sem batimento há mais que `velhaMs` → abandonada (contêiner morto: de outro
//     contêiner não dá para ver o PID, só o relógio);
//   - viva → espera, dizendo de quem, até `esperaMaxMs`, e aí desiste em voz alta.
// Tomar é um `rename` para um nome único: se dois chegam juntos, só um rename vence.
//
// **Filhos herdam.** O materializador roda cada query num subprocesso do próprio
// `index.ts`, e congela as calculadas em outro. Eles gravam sob a trava do pai: a
// variável `SNAPSHOT_TRAVA_HERDADA` (posta pelo pai) faz `adquireTrava` devolver uma
// trava que não trava — senão o filho esperaria o pai, que espera o filho.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ARQUIVO_DA_TRAVA = '.materializando.trava';
export const VAR_TRAVA_HERDADA = 'SNAPSHOT_TRAVA_HERDADA';
export const BATIMENTO_MS = 30_000;
export const VELHA_MS = 10 * 60_000;
export const ESPERA_MAX_MS = 30 * 60_000;

export interface DonoDaTrava {
  pid: number;
  host: string;
  desde: string;
  comando: string;
}

export interface Trava {
  /** Solta a trava — só apaga o arquivo se ele ainda for desta trava. */
  solta(): void;
  /** `true` quando veio de herança (filho de quem já segura). */
  herdada: boolean;
}

export interface OpcoesDaTrava {
  comando: string;
  esperaMaxMs?: number;
  velhaMs?: number;
  pausaMs?: number;
  batimentoMs?: number;
  anuncia?: (linha: string) => void;
  /** Injetável no teste. */
  host?: string;
  pid?: number;
  agora?: () => number;
  env?: NodeJS.ProcessEnv;
}

function pidVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: existe, só não é nosso. ESRCH: não existe.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function leDono(arquivo: string): DonoDaTrava | null {
  try {
    const d = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as Partial<DonoDaTrava>;
    return typeof d.pid === 'number' && typeof d.host === 'string' ? (d as DonoDaTrava) : null;
  } catch {
    return null;
  }
}

function descreve(d: DonoDaTrava | null): string {
  return d ? `PID ${d.pid} em ${d.host}, desde ${d.desde} (${d.comando})` : 'dono ilegível';
}

/** Por que esta trava pode ser tomada — ou `null` se ela está viva. */
export function motivoDeAbandono(
  dono: DonoDaTrava | null,
  idadeDoBatimentoMs: number,
  e: { host: string; velhaMs: number; vivo?: (pid: number) => boolean },
): string | null {
  if (dono && dono.host === e.host && !(e.vivo ?? pidVivo)(dono.pid)) {
    return `o PID ${dono.pid} não existe mais neste host`;
  }
  if (idadeDoBatimentoMs > e.velhaMs) {
    return `sem batimento há ${Math.round(idadeDoBatimentoMs / 60_000)} min`;
  }
  return null;
}

export async function adquireTrava(snapshotDir: string, opts: OpcoesDaTrava): Promise<Trava> {
  const env = opts.env ?? process.env;
  if (env[VAR_TRAVA_HERDADA]) return { solta: () => {}, herdada: true };

  const anuncia = opts.anuncia ?? ((l: string) => console.error(l));
  const agora = opts.agora ?? Date.now;
  const host = opts.host ?? os.hostname();
  const pid = opts.pid ?? process.pid;
  const esperaMaxMs = opts.esperaMaxMs ?? ESPERA_MAX_MS;
  const velhaMs = opts.velhaMs ?? VELHA_MS;
  const pausaMs = opts.pausaMs ?? 5_000;
  const arquivo = path.join(snapshotDir, ARQUIVO_DA_TRAVA);
  fs.mkdirSync(snapshotDir, { recursive: true });

  const inicio = agora();
  let avisou = false;
  for (;;) {
    const dono: DonoDaTrava = { pid, host, desde: new Date(agora()).toISOString(), comando: opts.comando };
    try {
      fs.writeFileSync(arquivo, JSON.stringify(dono), { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const atual = leDono(arquivo);
      let idade = 0;
      try {
        idade = agora() - fs.statSync(arquivo).mtimeMs;
      } catch {
        continue; // sumiu entre o wx e o stat: tenta de novo
      }
      const motivo = motivoDeAbandono(atual, idade, { host, velhaMs });
      if (motivo) {
        const velho = `${arquivo}.abandonada.${pid}.${agora()}`;
        try {
          fs.renameSync(arquivo, velho); // só um vence, se dois chegarem juntos
          fs.rmSync(velho, { force: true });
          anuncia(`[trava] tomando a trava do snapshot: ${motivo} (${descreve(atual)}).`);
        } catch {
          // Outro tomou antes. Volta ao wx.
        }
        continue;
      }
      if (agora() - inicio >= esperaMaxMs) {
        throw new Error(
          `snapshot em uso por outro materializador há mais de ${Math.round(esperaMaxMs / 60_000)} min — ` +
            `${descreve(atual)}. Se esse processo não existe mais, apague ${arquivo}.`,
        );
      }
      if (!avisou) {
        anuncia(`[trava] snapshot em uso por ${descreve(atual)} — esperando a vez.`);
        avisou = true;
      }
      await new Promise((r) => setTimeout(r, pausaMs));
      continue;
    }

    // É nossa. Batimento pela hora de modificação: o conteúdo (o dono) não muda.
    const batimento = setInterval(() => {
      try {
        const t = new Date(agora());
        fs.utimesSync(arquivo, t, t);
      } catch {
        // Tomada por alguém que nos achou mortos: não há o que renovar.
      }
    }, opts.batimentoMs ?? BATIMENTO_MS);
    batimento.unref();
    if (avisou) anuncia(`[trava] vez obtida depois de ${Math.round((agora() - inicio) / 1000)} s.`);

    let solta = false;
    return {
      herdada: false,
      solta: () => {
        if (solta) return;
        solta = true;
        clearInterval(batimento);
        const atual = leDono(arquivo);
        if (atual && atual.pid === pid && atual.host === host && atual.desde === dono.desde) {
          fs.rmSync(arquivo, { force: true });
        }
      },
    };
  }
}
