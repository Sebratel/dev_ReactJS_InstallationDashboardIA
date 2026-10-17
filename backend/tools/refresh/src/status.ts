// `snapshot/refresh-status.json` — o que o Refresh Manager sabe sobre si mesmo.
//
// **Por que não mora no manifesto.** `manifesto.json` é lido em TODO cache-miss da
// API (`backend/api/src/servidor.ts`, custo medido de ~0,57ms/pedido — ver o
// comentário em `backend/packages/snapshot/src/manifesto.ts`). Histórico de tentativas
// cresceria esse arquivo sem parar e pagaria esse custo em todo pedido a quente,
// para um dado que só interessa a quem opera o refresh. `refresh-status.json` é
// lido só por `GET /api/saude`, que não é caminho quente.
//
// **Nunca imprime valor de linha** — mesma regra do resto de `backend/tools/snapshot/`.

import fs from 'node:fs';
import path from 'node:path';
import { renomeiaComRetentativa } from '../../../packages/snapshot/src/escrita-atomica.ts';
import { leManifesto } from '../../../packages/snapshot/src/manifesto.ts';
import { leGrupos, type GrupoDeRefresh } from './grupos.ts';
import { emEsperaPorFalhas, proximaTentativa } from './tick.ts';

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
  /** Só presente quando a última falha foi toda de rede — ver `proximaTentativa`. */
  transitoria?: boolean;
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
  /** O grupo do `refresh.yaml` que carrega esta query, quando há um. */
  grupo?: string;
  /** Desde quando está parada (ISO): o último sucesso que conta para `vencida`. */
  paradaDesde?: string;
  /** Quando a próxima carga do grupo deve TERMINAR (ISO) — estimativa, ver `previsaoDaProxima`. */
  proximaCarga?: string;
}

/**
 * Quando o dado novo de um grupo deve aparecer: o daemon roda o grupo no primeiro tick em
 * que ele vence (`estaVencido`: último sucesso + intervalo, contado do INÍCIO da carga), e
 * a carga leva o mesmo que a última. Depois de uma falha o tick seguinte já tenta de novo
 * (`tickMinutos` depois), e a partir da segunda vale a espera crescente de `proximaTentativa`.
 * É estimativa: a duração varia, e grupos do mesmo tick rodam um depois do outro.
 */
export function previsaoDaProxima(
  s: StatusDeGrupo,
  intervaloMinutos: number,
  tickMinutos: number,
): string | undefined {
  const inicioDaUltima = new Date(s.ultimaTentativa).getTime() - s.duracaoMs;
  const espera = proximaTentativa(s, intervaloMinutos);
  let inicio: number;
  if (espera) inicio = espera.getTime();
  else if (!s.ok) inicio = inicioDaUltima + tickMinutos * 60_000;
  else if (s.ultimoSucesso) inicio = new Date(s.ultimoSucesso).getTime() + intervaloMinutos * 60_000;
  else return undefined;
  return Number.isFinite(inicio) ? new Date(inicio + s.duracaoMs).toISOString() : undefined;
}

/**
 * A partir de quantas falhas SEGUIDAS um grupo acende o aviso. Uma é soluço — o próximo
 * ciclo tenta de novo, e é também da segunda em diante que a espera crescente começa
 * (`proximaTentativa` em `tick.ts`). Até 28/09/2026 uma falha já acendia (ACHADOS #160).
 */
export const FALHAS_PARA_AVISO = 2;
/**
 * Um grupo está PARADO quando o último sucesso passou de `FATOR_PARADA × intervalo`. É o
 * que separa "não falhou" de "não rodou" (ACHADOS #129): até 28/09 a régua era 2 DIAS
 * para tudo, e um grupo de 15 min parado havia 5 h ainda saía `ok`.
 */
export const FATOR_PARADA = 2;
/** A régua de quem não está em grupo nenhum (só no manifesto): idade em dias. */
export const DIAS_FORA_DE_GRUPO = 2;

/** O mais recente de dois instantes ISO, ignorando o ausente. */
function maisNovo(a: string | null | undefined, b: string | null | undefined): string | undefined {
  if (!a) return b ?? undefined;
  if (!b) return a;
  return new Date(b).getTime() > new Date(a).getTime() ? b : a;
}

/** Resumo para o topo de `GET /api/saude`: há o que avisar, e por quê (por grupo). */
export function resumeDegradacao(queries: readonly QuerySaude[]): { degradado: boolean; motivos: string[] } {
  const porChave = new Map<string, { status: QuerySaude['status']; erro?: string; desde?: string; ids: string[] }>();
  for (const q of queries) {
    if (q.status === 'ok') continue;
    const chave = `${q.status}\u0000${q.grupo ?? q.id}`;
    const m = porChave.get(chave) ?? { status: q.status, erro: q.erro, desde: q.paradaDesde ?? q.ultimaCarga, ids: [] };
    m.ids.push(q.id);
    porChave.set(chave, m);
  }
  const motivos = [...porChave.entries()].map(([chave, m]) => {
    const quem = chave.split('\u0000')[1];
    const onde = queries.some((q) => q.grupo === quem) ? `grupo ${quem} (${m.ids.length} queries)` : quem;
    return m.status === 'falhou'
      ? `${onde}: falhando seguido${m.erro ? ` — ${m.erro}` : ''}`
      : `${onde}: parado desde ${m.desde ?? 'sempre'}`;
  });
  return { degradado: motivos.length > 0, motivos };
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
 * (`manifesto.json`) e a lista declarada em `backend/specs/_catalog/refresh.yaml`.
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

  // O daemon acorda na cadência do grupo mais curto (`REFRESH_INTERVAL_MINUTOS`, 15 hoje).
  const tickMinutos = Math.min(...[...grupos.values()].map((g) => g.intervaloMinutos));
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
    // Gravou na última tentativa do grupo, mesmo que o grupo tenha falhado? O snapshot põe
    // no manifesto toda query que deu certo, falhe outra ou não; até 09/10/2026 uma falha do
    // Google pintava de "carga falhou" as tabelas do Voalle do mesmo grupo (PLANO-MESTRE B.3).
    const geradoEm = geradoEmPorQuery.get(id);
    const inicioDaTentativa = grupoStatus
      ? new Date(grupoStatus.ultimaTentativa).getTime() - grupoStatus.duracaoMs
      : Number.POSITIVE_INFINITY;
    const gravouNaTentativa = geradoEm !== undefined && new Date(geradoEm).getTime() >= inicioDaTentativa;
    // Para quem está em grupo, "parado" se mede pelo último SUCESSO do grupo — a pergunta
    // é "rodou?", e o `geradoEm` de uma query pode não andar numa incremental sem novidade.
    // Mas vale o mais novo dos dois: a query que gravou numa tentativa falha rodou, e a
    // carga da madrugada (`diario.ts`, no próprio `refresh` desde 17/10/2026) renova o arquivo sem passar pelo grupo — até
    // 09/10/2026 a saúde seguia "parado desde sexta" depois dela (PLANO-MESTRE R.1b).
    const paradaDesde = grupo ? (maisNovo(grupoStatus?.ultimoSucesso, geradoEm) ?? ultimaCarga) : ultimaCarga;

    // "Falhando" pressupõe alguém tentando. Em 07/10/2026 o agendador ficou 24 h parado
    // depois de duas falhas de rede, e este arquivo dizia "falhando seguido" o dia todo —
    // a pista certa ("ninguém está rodando") só aparecia em `docker ps`.
    const semTentar =
      grupo !== undefined &&
      grupoStatus !== undefined &&
      !emEsperaPorFalhas(grupoStatus, grupo.intervaloMinutos, agora) &&
      agora.getTime() - new Date(grupoStatus.ultimaTentativa).getTime() > FATOR_PARADA * grupo.intervaloMinutos * 60_000;

    if (
      grupoStatus &&
      !grupoStatus.ok &&
      grupoStatus.falhasConsecutivas >= FALHAS_PARA_AVISO &&
      !semTentar &&
      !gravouNaTentativa
    ) {
      status = 'falhou';
      erro = grupoStatus.erro ?? `Grupo '${grupo!.id}' falhou no refresh`;
    } else if (grupo) {
      const limiteMs = FATOR_PARADA * grupo.intervaloMinutos * 60_000;
      if (!paradaDesde || agora.getTime() - new Date(paradaDesde).getTime() > limiteMs) status = 'vencida';
    } else if (id === 'protocolos-produtividade' && idadeDias > 7) {
      status = 'vencida';
    } else if (idadeDias > DIAS_FORA_DE_GRUPO) {
      status = 'vencida';
    }

    const proximaCarga =
      grupo && grupoStatus && !semTentar
        ? previsaoDaProxima(grupoStatus, grupo.intervaloMinutos, tickMinutos)
        : undefined;
    queriesSaude.push({
      id,
      ...(ultimaCarga ? { ultimaCarga } : {}),
      idadeDias,
      status,
      ...(erro ? { erro } : {}),
      ...(grupo ? { grupo: grupo.id } : {}),
      ...(status === 'vencida' && paradaDesde ? { paradaDesde } : {}),
      ...(proximaCarga ? { proximaCarga } : {}),
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
