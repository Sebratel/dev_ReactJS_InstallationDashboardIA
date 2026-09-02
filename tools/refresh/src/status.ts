// `snapshot/refresh-status.json` — o que o Refresh Manager sabe sobre si mesmo.
//
// **Por que não mora no manifesto.** `manifesto.json` é lido em TODO cache-miss da
// API (`apps/api/src/servidor.ts`, custo medido de ~0,57ms/pedido — ver o
// comentário em `packages/snapshot/src/manifesto.ts`). Histórico de tentativas
// cresceria esse arquivo sem parar e pagaria esse custo em todo pedido a quente,
// para um dado que só interessa a quem opera o refresh. `refresh-status.json` é
// lido só por `GET /api/saude`, que não é caminho quente.
//
// **Nunca imprime valor de linha** — mesma regra do resto de `tools/snapshot/`.

import fs from 'node:fs';
import path from 'node:path';
import { renomeiaComRetentativa } from '../../../packages/snapshot/src/escrita-atomica.ts';

const ARQUIVO = 'refresh-status.json';

export interface StatusDeGrupo {
  /** ISO UTC da última vez que este grupo foi disparado, sucesso ou falha. */
  ultimaTentativa: string;
  /** ISO UTC do último sucesso. `null`: nunca teve um, desde que o arquivo existe. */
  ultimoSucesso: string | null;
  duracaoMs: number;
  ok: boolean;
  /** Zera em todo sucesso. É o que decidiria mudar de tom numa notificação futura. */
  falhasConsecutivas: number;
  /** Só presente quando `ok: false`. Resumo — o log completo do filho vai pro stderr. */
  erro?: string;
}

export type StatusDeRefresh = Record<string, StatusDeGrupo>;

/** Sem o arquivo, é como se o Refresh Manager nunca tivesse rodado — não é erro. */
export function leStatus(snapshotDir: string): StatusDeRefresh {
  const p = path.join(snapshotDir, ARQUIVO);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as StatusDeRefresh;
  } catch {
    // Arquivo corrompido não pode derrubar `/api/saude` nem o próximo tick — o
    // próximo tick bem-sucedido o reescreve inteiro de qualquer forma.
    return {};
  }
}

/** Atômica pela mesma razão de `escreveManifesto`: outro leitor pode ter o arquivo aberto. */
export async function escreveStatus(snapshotDir: string, status: StatusDeRefresh): Promise<void> {
  fs.mkdirSync(snapshotDir, { recursive: true });
  const destino = path.join(snapshotDir, ARQUIVO);
  const temp = `${destino}.parcial`;
  fs.writeFileSync(temp, JSON.stringify(status, null, 2) + '\n', 'utf8');
  await renomeiaComRetentativa(temp, destino);
}
