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
import { leManifesto } from '../../../packages/snapshot/src/manifesto.ts';
import { leGrupos, type GrupoDeRefresh } from './grupos.ts';

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

/**
 * Contrato A2 ↔ A6: o status de saúde e idade por query consumido pelo front-end.
 */
export interface QuerySaude {
  id: string;
  ultimaCarga?: string;
  idadeDias: number;
  status: 'ok' | 'vencida' | 'falhou';
  erro?: string;
}

export interface StatusDeRefreshCompleto {
  [grupo: string]: StatusDeGrupo | QuerySaude[] | undefined;
  queries?: QuerySaude[];
}

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

/**
 * Constrói a visão agregada de saúde do refresh para `GET /api/saude`.
 * Combina o histórico dos grupos (`refresh-status.json`), as tabelas em disco
 * (`manifesto.json`) e a lista declarada em `specs/_catalog/refresh.yaml`.
 */
export function montaStatusDeRefresh(
  snapshotDir: string,
  specsDir?: string,
  agora: Date = new Date(),
): StatusDeRefreshCompleto {
  const statusBruto = leStatus(snapshotDir);
  const temStatus = Object.keys(statusBruto).length > 0;
  const manifesto = leManifesto(snapshotDir);
  const temManifesto = Boolean(manifesto && manifesto.tabelas.length > 0);

  if (!temStatus && !temManifesto) {
    return {};
  }

  let grupos: Map<string, GrupoDeRefresh> = new Map();
  if (specsDir) {
    try {
      grupos = leGrupos(specsDir);
    } catch {
      // Ignora erro de catálogo ausente em ambiente de teste temporário
    }
  }

  const queryParaGrupo = new Map<string, GrupoDeRefresh>();
  for (const g of grupos.values()) {
    for (const q of g.queries) {
      queryParaGrupo.set(q, g);
    }
  }

  const idsQueries = new Set<string>();
  for (const q of queryParaGrupo.keys()) {
    idsQueries.add(q);
  }
  if (manifesto?.tabelas) {
    for (const t of manifesto.tabelas) {
      if (t.query) idsQueries.add(t.query);
    }
  }

  // Queries críticas e históricas sempre avaliadas
  idsQueries.add('protocolos-produtividade');
  idsQueries.add('field-agenda');
  idsQueries.add('protocolos-geral');

  const geradoEmPorQuery = new Map<string, string>();
  if (manifesto?.tabelas) {
    for (const t of manifesto.tabelas) {
      if (t.query && t.geradoEm) {
        const existente = geradoEmPorQuery.get(t.query);
        if (!existente || new Date(t.geradoEm) > new Date(existente)) {
          geradoEmPorQuery.set(t.query, t.geradoEm);
        }
      }
    }
  }

  const queriesSaude: QuerySaude[] = [];

  for (const id of Array.from(idsQueries).sort()) {
    const grupo = queryParaGrupo.get(id);
    const grupoStatus = grupo ? statusBruto[grupo.id] : undefined;

    let ultimaCarga = geradoEmPorQuery.get(id);
    if (!ultimaCarga && grupoStatus?.ultimoSucesso) {
      ultimaCarga = grupoStatus.ultimoSucesso;
    }

    let idadeDias = 999;
    if (ultimaCarga) {
      const diffMs = agora.getTime() - new Date(ultimaCarga).getTime();
      const dias = Math.max(0, diffMs / 86_400_000);
      idadeDias = Number(dias.toFixed(1));
    }

    let status: 'ok' | 'vencida' | 'falhou' = 'ok';
    let erro: string | undefined;

    if (grupoStatus && !grupoStatus.ok && grupoStatus.falhasConsecutivas > 0) {
      status = 'falhou';
      erro = grupoStatus.erro ?? `Grupo '${grupo!.id}' falhou no refresh`;
    } else if (id === 'protocolos-produtividade' && idadeDias > 7) {
      status = 'vencida';
    } else if (idadeDias > 2) {
      status = 'vencida';
    }

    queriesSaude.push({
      id,
      ...(ultimaCarga ? { ultimaCarga } : {}),
      idadeDias,
      status,
      ...(erro ? { erro } : {}),
    });
  }

  return {
    ...statusBruto,
    queries: queriesSaude,
  };
}

/** Atômica pela mesma razão de `escreveManifesto`: outro leitor pode ter o arquivo aberto. */
export async function escreveStatus(snapshotDir: string, status: StatusDeRefresh): Promise<void> {
  fs.mkdirSync(snapshotDir, { recursive: true });
  const destino = path.join(snapshotDir, ARQUIVO);
  const temp = `${destino}.parcial`;
  fs.writeFileSync(temp, JSON.stringify(status, null, 2) + '\n', 'utf8');
  await renomeiaComRetentativa(temp, destino);
}
